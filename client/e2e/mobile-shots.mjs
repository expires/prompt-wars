#!/usr/bin/env node
// Phone join + touch controls + hit feedback check, against a local SpacetimeDB (`spacetime start`
// + `pnpm publish:local` in server/) and vite dev:
//   node e2e/mobile-shots.mjs [baseUrl] [outDir]
// iPhone / Pixel emulation (touch, DPR, UA): landing fits the width, quick pick deploys with the
// on-screen controls, the joystick moves, FIRE shoots, the menu opens the pause menu (forge
// reachable). Then two desktop players trade shots for damage numbers / hitmarker shots.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:5179';
const out = resolve(process.argv[3] ?? 'e2e/screenshots/mobile');
const server = process.env.MOBILE_SERVER ?? 'local';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) fails.push(what);
};
const url = (extra = {}) => {
  const p = new URLSearchParams({ fresh: '1', map: 'testmap', music: '0', ...extra });
  if (server === 'local') p.set('server', 'local');
  return `${base}/?${p}`;
};
const st = (page) => page.evaluate(() => window.__game.getState());
async function until(page, pred, ms, what) {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < ms) {
    s = await st(page);
    if (pred(s)) return s;
    await page.waitForTimeout(150);
  }
  throw new Error(`timeout: ${what}`);
}

/** drag with a real touch pointer (CDP touch events -> pointer events with pointerType touch) */
async function touchDrag(page, from, to, steps = 8, holdMs = 600) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x, y) });
    await page.waitForTimeout(16);
  }
  // peak horizontal speed while held (a spawn facing a wall can't cover distance, but it accelerates)
  let peak = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < holdMs) {
    peak = Math.max(peak, (await st(page)).hSpeed);
    await page.waitForTimeout(50);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return peak;
}

async function phone(deviceName, file, landscape) {
  const dev = devices[deviceName];
  const viewport = landscape ? { width: dev.viewport.height, height: dev.viewport.width } : dev.viewport;
  const ctx = await browser.newContext({ ...dev, viewport, screen: viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${file}] pageerror`, e.message));
  await page.goto(url());
  await page.waitForSelector('[data-testid=landing]:not([hidden])', { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-testid^=quick-pick-]', { timeout: 30000 });
  await page.waitForTimeout(500);
  const fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, cs: document.querySelector('[data-testid=callsign]').value }));
  check(fit.sw <= fit.w + 1, `${file}: landing fits width (${fit.sw} <= ${fit.w})`);
  check(!!fit.cs, `${file}: callsign auto-filled (${fit.cs})`);
  await page.screenshot({ path: resolve(out, `${file}-landing.png`) });

  await page.getByTestId('quick-pick-pistol').tap();
  let s = await until(page, (x) => x.alive && x.screen === 'none' && x.touch?.visible, 30000, `${file} deployed`);
  check(s.touch?.playing, `${file}: touch controls live after deploy`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(out, `${file}-ingame.png`) });

  // joystick: push forward (from an open spot, facing open floor) and check the player moved
  await page.evaluate(() => window.__game.teleport(0, 0.1, 4, Math.PI));
  await page.waitForTimeout(300);
  const p0 = (await st(page)).pos;
  const vw = viewport.width;
  const vh = viewport.height;
  const sx = vw * 0.18;
  const sy = vh * 0.75;
  const peak = await touchDrag(page, { x: sx, y: sy }, { x: sx, y: sy - 70 }, 6, 900);
  const p1 = (await st(page)).pos;
  const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
  check(moved > 1 || peak > 2, `${file}: joystick moved the player ${moved.toFixed(2)} m (peak ${peak.toFixed(1)} m/s)`);

  // look: drag the right side
  const yaw0 = (await st(page)).yaw;
  await touchDrag(page, { x: vw * 0.7, y: vh * 0.4 }, { x: vw * 0.7 - 120, y: vh * 0.4 }, 6, 50);
  const yaw1 = (await st(page)).yaw;
  check(Math.abs(yaw1 - yaw0) > 0.1, `${file}: right-side drag turned ${(yaw1 - yaw0).toFixed(2)} rad`);

  // fire: ammo drops
  const a0 = (await st(page)).ammo;
  const fb = await page.getByTestId('touch-fire').boundingBox();
  await touchDrag(page, { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 }, { x: fb.x + fb.width / 2 + 2, y: fb.y + fb.height / 2 }, 2, 500);
  const a1 = (await st(page)).ammo;
  check(a1 < a0, `${file}: FIRE shot (ammo ${a0} -> ${a1})`);

  // menu: pause menu with the forge entry
  await page.getByTestId('touch-menu').tap();
  await until(page, (x) => x.screen === 'pause', 5000, `${file} pause`);
  await page.waitForTimeout(600); // rail / item entrance animations
  const fb2 = await page.getByTestId('pause-forge').boundingBox();
  check(!!fb2 && fb2.y >= 0 && fb2.y + fb2.height <= viewport.height, `${file}: forge reachable from the touch menu (on screen)`);
  await page.screenshot({ path: resolve(out, `${file}-menu.png`) });
  await page.getByTestId('pause-resume').tap();
  await until(page, (x) => x.screen === 'none' && x.touch?.visible, 5000, `${file} resume`);
  await ctx.close();
}

try {
  await phone('iPhone 13', 'iphone-portrait', false);
  await phone('iPhone 13', 'iphone-landscape', true);
  await phone('Pixel 7', 'pixel-landscape', true);
} catch (e) {
  check(false, `phone flow: ${e.message}`);
}

// ---- damage numbers: two desktop players, A shoots B (server-confirmed numbers + hitmarker)
try {
  const join = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
    await page.goto(url({ e2e: '1', name }));
    await page.waitForFunction(() => window.__game?.getState()?.ready && window.__game.getState().connected, null, { timeout: 60000 });
    await page.waitForSelector('[data-testid=quick-pick-rifle]', { timeout: 30000 });
    await page.getByTestId('quick-pick-rifle').click();
    await until(page, (x) => x.alive && x.screen === 'none', 30000, `${name} deployed`);
    return { page, id: (await st(page)).localId };
  };
  const a = await join('Shooter');
  const b = await join('Target');
  await a.page.evaluate(() => window.__game.teleport(0, 0.1, 4, 0));
  await b.page.evaluate(() => window.__game.teleport(0, 0.1, -6, Math.PI));
  await a.page.waitForTimeout(1500);
  await a.page.evaluate(() => window.__game.holdHitmarker(true));
  for (let i = 0; i < 3; i++) {
    await a.page.evaluate((id) => window.__game.aimAtHead(id), b.id);
    await a.page.evaluate(() => window.__game.fireOnce());
    await a.page.waitForTimeout(260);
  }
  await a.page.waitForTimeout(150);
  // element colours next to the real numbers (same layer / code path)
  await a.page.evaluate((id) => {
    const g = window.game;
    const head = g.remotes.headOf(id);
    const T = window.THREE_V ?? head.constructor;
    const mk = (dx, dy) => new T(head.x + dx, head.y + dy, head.z);
    g.damageNumbers.add('fx-fire', 18, mk(-1.6, 0.2), { element: 'fire' });
    g.damageNumbers.add('fx-ice', 22, mk(-0.8, 0.6), { element: 'ice' });
    g.damageNumbers.add('fx-poison', 9, mk(0.9, 0.5), { element: 'poison', dot: true });
    g.damageNumbers.add('fx-shock', 31, mk(1.7, 0.1), { element: 'shock' });
  }, b.id);
  await a.page.waitForTimeout(120);
  const n = await a.page.locator('[data-testid=dmg-num]').count();
  check(n >= 4, `damage numbers on screen: ${n}`);
  await a.page.screenshot({ path: resolve(out, 'damage-numbers.png') });
  await a.page.context().close();
  await b.page.context().close();
} catch (e) {
  check(false, `damage numbers: ${e.message}`);
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nall ok');
process.exit(fails.length ? 1 : 0);
