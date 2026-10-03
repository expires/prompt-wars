import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameTestHook } from '../src/testHook';

export type GameState = ReturnType<GameTestHook['getState']>;
type Win = Window & { __game: GameTestHook; __gameError?: string };

export const SERVER = process.env.E2E_SERVER === 'maincloud' ? 'maincloud' : 'local';
export const SCREENSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

export function gameUrl(name: string) {
  const p = new URLSearchParams({ e2e: '1', fresh: '1', name });
  if (SERVER === 'local') p.set('server', 'local');
  return `/?${p}`;
}

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  id: string;
}

/**
 * Open the game as a new player. New players land on the landing screen (server needsLoadout):
 * by default they quick-pick the pistol preset and deploy; `loadout: 'none'` stops at the landing.
 */
export async function joinGame(browser: Browser, name: string, opts: { loadout?: string | 'none' } = {}): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  // count WebSocket frames / bytes in both directions (works for any client version)
  await page.addInitScript(() => {
    const stats = { sent: 0, sentBytes: 0, recv: 0, recvBytes: 0 };
    (window as unknown as { __ws: typeof stats }).__ws = stats;
    const size = (d: unknown) =>
      typeof d === 'string' ? d.length : d instanceof ArrayBuffer ? d.byteLength : ArrayBuffer.isView(d) ? d.byteLength : d instanceof Blob ? d.size : 0;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data: Parameters<WebSocket['send']>[0]) {
      stats.sent++;
      stats.sentBytes += size(data);
      if (!(this as unknown as { __counted?: boolean }).__counted) {
        (this as unknown as { __counted?: boolean }).__counted = true;
        this.addEventListener('message', (e) => {
          stats.recv++;
          stats.recvBytes += size(e.data);
        });
      }
      return send.call(this, data);
    };
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${name}] ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`));
  await page.goto(gameUrl(name));
  await page.waitForFunction(
    () => {
      const w = window as unknown as Win;
      if (w.__gameError) throw new Error(w.__gameError);
      const s = w.__game?.getState();
      return !!s && s.ready && s.connected && !!s.localId && (s.needsLoadout ? s.screen === 'landing' : !!s.weaponId);
    },
    undefined,
    { timeout: 45_000 },
  );
  let s = await state(page);
  const loadout = opts.loadout ?? 'pistol';
  if (s.needsLoadout && loadout !== 'none') {
    await expect(page.getByTestId('landing')).toBeVisible();
    await page.getByTestId(`quick-pick-${loadout}`).click();
    s = await waitForState(page, (x) => x.alive && !!x.weaponId && !x.needsLoadout && x.screen === 'none', 20_000, `${name} deployed with ${loadout}`);
  }
  return { name, context, page, id: s.localId };
}

export function state(page: Page): Promise<GameState> {
  return page.evaluate(() => (window as unknown as Win).__game.getState());
}

/** poll getState() until `pred` holds (pred runs in Node) */
export async function waitForState(page: Page, pred: (s: GameState) => boolean, timeout = 15_000, what = 'state'): Promise<GameState> {
  const t0 = Date.now();
  let last: GameState | undefined;
  while (Date.now() - t0 < timeout) {
    last = await state(page);
    if (pred(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`timeout waiting for ${what}; last state: ${JSON.stringify(summary(last))}`);
}

export function summary(s?: GameState) {
  if (!s) return s;
  const { weapon: _w, ...rest } = s;
  return rest;
}

export async function teleport(p: Player, pos: [number, number, number], yaw?: number) {
  await p.page.evaluate(([x, y, z, yw]) => (window as unknown as Win).__game.teleport(x, y, z, yw ?? undefined), [
    ...pos,
    yaw ?? null,
  ] as [number, number, number, number | null]);
}

export async function aimAt(p: Player, targetId: string) {
  const ok = await p.page.evaluate((id) => (window as unknown as Win).__game.aimAt(id), targetId);
  expect(ok, `${p.name} can aim at ${targetId}`).toBe(true);
}

export async function aimAtHead(p: Player, targetId: string) {
  const ok = await p.page.evaluate((id) => (window as unknown as Win).__game.aimAtHead(id), targetId);
  expect(ok, `${p.name} can aim at ${targetId}'s head`).toBe(true);
}

/** run `fn(window.__game, args)` in the page */
export function hook<A = undefined, R = unknown>(p: Player, fn: (g: GameTestHook, args: A) => R, args?: A): Promise<R> {
  return p.page.evaluate(
    ([src, a]) => {
      // eslint-disable-next-line no-new-func
      const f = new Function(`return (${src})`)() as (g: GameTestHook, args: unknown) => R;
      return f((window as unknown as Win).__game, a);
    },
    [fn.toString(), args ?? null] as const,
  ) as Promise<R>;
}

export async function fireOnce(p: Player) {
  return p.page.evaluate(() => (window as unknown as Win).__game.fireOnce());
}

export async function shot(p: Player, file: string) {
  await p.page.screenshot({ path: resolve(SCREENSHOT_DIR, SERVER === 'maincloud' ? `maincloud-${file}` : file) });
}

/** wait until `viewer` renders `target` (interpolated) within `tol` m of pos (x/z) */
export async function waitSeenAt(viewer: Player, targetId: string, pos: [number, number, number], tol = 0.5, timeout = 10_000) {
  return waitForState(
    viewer.page,
    (s) => {
      const r = s.playersSeen.find((p) => p.id === targetId);
      return !!r && r.visible && Math.hypot(r.pos[0] - pos[0], r.pos[2] - pos[2]) < tol;
    },
    timeout,
    `${viewer.name} to see ${targetId.slice(0, 8)} at ${pos}`,
  );
}

export interface WsStats {
  sent: number;
  sentBytes: number;
  recv: number;
  recvBytes: number;
}

export function wsStats(p: Player): Promise<WsStats> {
  return p.page.evaluate(() => ({ ...(window as unknown as { __ws: WsStats }).__ws }));
}

/** reducer calls (by name) + WebSocket traffic of `p` over `ms`, per second */
export async function measureRates(p: Player, ms: number) {
  const calls = () => hook(p, (g) => g.netStats()?.calls ?? {}) as Promise<Record<string, number>>;
  const [c0, w0] = await Promise.all([calls(), wsStats(p)]);
  await p.page.waitForTimeout(ms);
  const [c1, w1] = await Promise.all([calls(), wsStats(p)]);
  const s = ms / 1000;
  const byName: Record<string, number> = {};
  let total = 0;
  for (const k of Object.keys(c1)) {
    const d = (c1[k] ?? 0) - (c0[k] ?? 0);
    if (d) byName[k] = +(d / s).toFixed(2);
    total += d;
  }
  return {
    callsPerSec: +(total / s).toFixed(2),
    byName,
    wsSentPerSec: +((w1.sent - w0.sent) / s).toFixed(2),
    wsSentBytesPerSec: Math.round((w1.sentBytes - w0.sentBytes) / s),
    wsRecvPerSec: +((w1.recv - w0.recv) / s).toFixed(2),
    wsRecvBytesPerSec: Math.round((w1.recvBytes - w0.recvBytes) / s),
  };
}

/**
 * Smoothness of a rendered trajectory sampled once per frame: per-frame speed (step / frame
 * time). Hold-then-rush shows up as frames with ~0 movement followed by frames much faster than
 * the mean.
 */
export function smoothness(samples: { t: number; x: number; z: number }[]) {
  const speeds: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt < 0.004) continue;
    speeds.push(Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z) / dt);
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
  const sorted = [...speeds].sort((a, b) => a - b);
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    frames: speeds.length,
    meanSpeed: +mean.toFixed(3),
    maxOverMean: +(Math.max(...speeds) / mean).toFixed(3),
    minOverMean: +(Math.min(...speeds) / mean).toFixed(3),
    p05OverMean: +(pct(0.05) / mean).toFixed(3),
    p95OverMean: +(pct(0.95) / mean).toFixed(3),
    /** frames with < 20% of the mean speed (holds) */
    stalls: speeds.filter((v) => v < 0.2 * mean).length,
    /** frames with > 2x the mean speed (rushes) */
    rushes: speeds.filter((v) => v > 2 * mean).length,
  };
}
