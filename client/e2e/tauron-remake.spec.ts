import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  A_ROW_D,
  A_D0,
  CST_D1,
  C_D0,
  C_END,
  C_ROW_D,
  C_TOP,
  C_WALK_Y,
  LEVEL_B,
  TUN_STAIR_D1,
  columnPoint,
  layout,
} from '@ai-gaem/shared/tauron-remake';

/**
 * `tauron-remake` walkthrough (offline, no game server):
 *   pnpm --filter client exec playwright test tauron-remake
 * Walks floor → A aisle → vomitory → concourse → C stair → C aisle to the top, checking that the
 * player never drops through the geometry; then screenshots ~12 viewpoints and logs FPS / draw calls.
 */

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'tauron-remake');
mkdirSync(OUT, { recursive: true });

type Win = Window & {
  game: {
    ready: boolean;
    player: { feet: { x: number; y: number; z: number }; yaw: number; pitch: number };
    input: { padPlaying: boolean; keys: Set<string> };
    rc: { renderer: { info: { reset(): void; render: { calls: number; triangles: number } }; render(s: unknown, c: unknown): void }; scene: unknown; camera: unknown };
  };
  __game: { teleport(x: number, y: number, z: number, yaw?: number): void; lookAt(x: number, y: number, z: number): void; getState(): { ready: boolean; weaponId: string } };
  __gameError?: string;
};

async function boot(page: Page) {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/?offline=1&e2e=1&map=tauron-remake');
  await page.waitForFunction(
    () => {
      const w = window as unknown as Win;
      if (w.__gameError) throw new Error(w.__gameError);
      const s = w.__game?.getState?.();
      return !!s && s.ready;
    },
    null,
    { timeout: 120_000, polling: 200 },
  );
  await page.waitForTimeout(1500);
  return logs;
}

interface Walk {
  ok: boolean;
  pos: [number, number, number];
  maxDrop: number;
  minY: number;
  frames: number;
}

/** hold W and steer toward (x, z) until within `tol` m (fixed-step physics keeps time real) */
function walkTo(page: Page, x: number, z: number, timeoutMs = 25_000, tol = 0.5): Promise<Walk> {
  return page.evaluate(
    ([x, z, timeoutMs, tol]) =>
      new Promise<Walk>((res) => {
        const g = (window as unknown as Win).game;
        g.input.padPlaying = true;
        g.input.keys.add('KeyW');
        const t0 = performance.now();
        let lastY = g.player.feet.y;
        let maxDrop = 0;
        let minY = lastY;
        let frames = 0;
        const tick = () => {
          const f = g.player.feet;
          const dx = x - f.x, dz = z - f.z;
          const dist = Math.hypot(dx, dz);
          maxDrop = Math.max(maxDrop, lastY - f.y);
          minY = Math.min(minY, f.y);
          lastY = f.y;
          frames++;
          if (dist < tol || performance.now() - t0 > timeoutMs) {
            g.input.keys.delete('KeyW');
            res({ ok: dist < tol, pos: [f.x, f.y, f.z], maxDrop, minY, frames });
            return;
          }
          g.player.yaw = Math.atan2(-dx, -dz);
          g.player.pitch = 0;
          requestAnimationFrame(tick);
        };
        tick();
      }),
    [x, z, timeoutMs, tol] as const,
  );
}

const colOf = (pred: (c: ReturnType<typeof layout>['columns'][number]) => boolean) => layout().columns.find(pred)!;
const P = (j: number, d: number, f = 0.5) => columnPoint(j, f, d);

test('tauron-remake: walk floor → tier C via aisle, vomitory, concourse, C stair', async ({ page }) => {
  test.setTimeout(400_000);
  await page.setViewportSize({ width: 640, height: 360 });
  const logs = await boot(page);
  const mapLog = logs.find((l) => l.includes('[map] tauron-remake'));
  console.log(mapLog);
  expect(mapLog).toBeTruthy();

  // the first sector of the north side: A aisle == vomitory column, C stairs in the same unit
  const va = colOf((c) => c.part === 'N' && c.a === 'aisle' && c.b === 'vom');
  const cs = layout().columns.filter((c) => c.part === 'N' && c.b === 'cstair')[1]!;
  const start = P(va.index, -3.5);
  await page.evaluate(([x, z]) => (window as unknown as Win).__game.teleport(x, 0.05, z), [start.x, start.z]);
  await page.waitForTimeout(500);

  const legs: { name: string; x: number; z: number; expectY: number }[] = [
    { name: 'A aisle foot', ...xz(P(va.index, -1.6)), expectY: 0 },
    { name: 'A aisle row 7', ...xz(P(va.index, A_D0 + 7.5 * A_ROW_D)), expectY: 5.46 },
    { name: 'cross aisle', ...xz(P(va.index, 15.1)), expectY: LEVEL_B },
    { name: 'vomitory', ...xz(P(va.index, 17.8)), expectY: LEVEL_B },
    { name: 'concourse', ...xz(P(va.index, 23.5)), expectY: LEVEL_B },
    { name: 'concourse ring → C stair', ...xz(P(cs.index, CST_D1 + 1.0)), expectY: LEVEL_B },
    { name: 'C stair top', ...xz(P(cs.index, C_D0 - 0.5)), expectY: C_WALK_Y },
    { name: 'C walkway → aisle', ...xz(P(va.index, C_D0 - 0.6)), expectY: C_WALK_Y },
    { name: 'C aisle top', ...xz(P(va.index, C_END - 0.3)), expectY: C_TOP },
  ];
  const report: unknown[] = [];
  for (const leg of legs) {
    const r = await walkTo(page, leg.x, leg.z);
    report.push({ leg: leg.name, ...r, expectY: leg.expectY });
    console.log(`[walk] ${leg.name}: ok=${r.ok} pos=${r.pos.map((v) => v.toFixed(2)).join(',')} maxDrop=${r.maxDrop.toFixed(2)} frames=${r.frames}`);
    expect(r.ok, `${leg.name} reached`).toBe(true);
    expect(Math.abs(r.pos[1] - leg.expectY), `${leg.name} height`).toBeLessThan(0.45);
    expect(r.maxDrop, `${leg.name}: no falls`).toBeLessThan(0.7);
  }
  // C aisle → back down to check the rows hold (no falling through between rows)
  const down = await walkTo(page, ...xzArr(P(va.index, C_D0 + 3 * C_ROW_D)));
  expect(down.minY).toBeGreaterThan(C_WALK_Y - 0.1);
  // second route: event floor → player tunnel under tier A → stairwell up into the concourse
  const tun = colOf((c) => c.part === 'E' && c.a === 'tunnel');
  const t0 = P(tun.index, -4, 1);
  await page.evaluate(([x, z]) => (window as unknown as Win).__game.teleport(x, 0.05, z), [t0.x, t0.z]);
  await page.waitForTimeout(400);
  for (const leg of [
    { name: 'tunnel portal', ...xz(P(tun.index, 1, 1)), expectY: 0 },
    { name: 'tunnel under tier A', ...xz(P(tun.index, 11.5, 0.5)), expectY: 0 },
    { name: 'tunnel stair → concourse', ...xz(P(tun.index, TUN_STAIR_D1 + 1, 0.5)), expectY: LEVEL_B },
  ]) {
    const r = await walkTo(page, leg.x, leg.z);
    report.push({ leg: leg.name, ...r, expectY: leg.expectY });
    console.log(`[walk] ${leg.name}: ok=${r.ok} pos=${r.pos.map((v) => v.toFixed(2)).join(',')} maxDrop=${r.maxDrop.toFixed(2)} frames=${r.frames}`);
    expect(r.ok, `${leg.name} reached`).toBe(true);
    expect(Math.abs(r.pos[1] - leg.expectY), `${leg.name} height`).toBeLessThan(0.45);
    expect(r.maxDrop, `${leg.name}: no falls`).toBeLessThan(0.7);
  }
  writeFileSync(resolve(OUT, 'walk.json'), JSON.stringify(report, null, 2));
});

function xz(p: { x: number; z: number }) {
  return { x: p.x, z: p.z };
}
function xzArr(p: { x: number; z: number }): [number, number] {
  return [p.x, p.z];
}

test('tauron-remake: viewpoints + perf', async ({ page }) => {
  test.setTimeout(400_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page);

  const va = colOf((c) => c.part === 'N' && c.a === 'aisle' && c.b === 'vom');
  const box = colOf((c) => c.part === 'S' && c.b === 'box');
  const tun = colOf((c) => c.part === 'E' && c.a === 'tunnel');
  const cs = colOf((c) => c.part === 'S' && c.b === 'cstair');
  const corner = colOf((c) => c.part === 'SW' && c.b === 'box');
  const pt = (j: number, d: number, y: number, f = 0.5): [number, number, number] => {
    const p = P(j, d, f);
    return [p.x, y, p.z];
  };
  const views: { name: string; feet: [number, number, number]; look: [number, number, number] }[] = [
    { name: '01-floor-centre-looking-up-north', feet: [0, 0.05, -6], look: [0, 14, 40] },
    { name: '02-floor-east-looking-west-stage', feet: [30, 0.05, 4], look: [-30, 4, 0] },
    { name: '03-stage-deck-looking-at-bowl', feet: [-27, 1.55, 3], look: [30, 8, -10] },
    { name: '04-tier-a-row10-looking-at-floor', feet: pt(box.index, A_D0 + 10.4 * A_ROW_D, 7.25), look: [0, 0, 0] },
    { name: '05-vomitory-looking-into-bowl', feet: pt(va.index, 19.2, LEVEL_B + 0.05), look: [0, 6, 0] },
    { name: '06-concourse-along-ring', feet: pt(va.index, 24.0, LEVEL_B + 0.05), look: pt(va.index + 14, 24.5, LEVEL_B + 1.6) },
    { name: '07-tier-c-top-overview', feet: pt(corner.index, C_END - 0.4, C_TOP + 0.05), look: [5, 2, 5] },
    { name: '08-player-tunnel-looking-at-floor', feet: pt(tun.index, 10, 0.05, 1), look: [0, 1.4, 0] },
    { name: '09-scoreboard-from-tier-c', feet: pt(box.index, C_D0 + 1.5 * C_ROW_D, 13.6 + 0.05), look: [0, 20.5, 0] },
    { name: '10-box-through-glass', feet: pt(box.index, 18.6, LEVEL_B + 0.05), look: [0, 3, 0] },
    { name: '11-c-stair-from-concourse', feet: pt(cs.index, 25.5, LEVEL_B + 0.05, 0.5), look: pt(cs.index, 17.5, 12.5) },
    { name: '12-cross-aisle-ring', feet: pt(va.index, 15.0, LEVEL_B + 0.05), look: pt(va.index + 20, 15.0, LEVEL_B + 1.0) },
  ];
  for (const v of views) {
    await page.evaluate(
      ([f, l]) => {
        const h = (window as unknown as Win).__game;
        h.teleport(f[0], f[1], f[2]);
        h.lookAt(l[0], l[1], l[2]);
      },
      [v.feet, v.look] as const,
    );
    await page.waitForTimeout(700);
    await page.evaluate(([l]) => (window as unknown as Win).__game.lookAt(l[0], l[1], l[2]), [v.look] as const);
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(OUT, `${v.name}.png`) });
  }

  // ---- perf: rAF rate over 3 s from the floor (whole bowl in view) + draw calls of one frame
  await page.evaluate(() => {
    const h = (window as unknown as Win).__game;
    h.teleport(30, 0.05, 0);
    h.lookAt(-30, 6, 0);
  });
  await page.waitForTimeout(500);
  const perf = await page.evaluate(
    () =>
      new Promise<{ fps: number; calls: number; triangles: number }>((res) => {
        const g = (window as unknown as Win).game;
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 3000) return requestAnimationFrame(tick);
          const r = g.rc.renderer;
          r.info.reset();
          r.render(g.rc.scene, g.rc.camera);
          res({ fps: (n * 1000) / (performance.now() - t0), calls: r.info.render.calls, triangles: r.info.render.triangles });
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`[perf] fps=${perf.fps.toFixed(1)} (SwiftShader software GL) drawCalls=${perf.calls} triangles=${perf.triangles}`);
  writeFileSync(resolve(OUT, 'perf.json'), JSON.stringify(perf, null, 2));
  expect(perf.calls).toBeLessThan(150);
});
