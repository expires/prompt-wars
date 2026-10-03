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

export async function joinGame(browser: Browser, name: string): Promise<Player> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
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
      return !!s && s.ready && s.connected && !!s.localId && !!s.weaponId;
    },
    undefined,
    { timeout: 45_000 },
  );
  const s = await state(page);
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
