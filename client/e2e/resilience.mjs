#!/usr/bin/env node
// Crash-resilience checks (offline mode, no game server needed):
//   - a throwing frame is logged + reported and the loop keeps running
//   - WebGL context loss shows the "Graphics reset" banner, restore hides it and rendering resumes
//   - graphics quality switches (Low: pixel ratio <= 1, no shadows, decor hidden; High restores)
//   - telemetry reports reach POST /api/forge/telemetry (run the dev server with FORGE_PROXY at a
//     local forge whose FORGE_TELEMETRY_LOG you can inspect)
//
//   node e2e/resilience.mjs [baseUrl]      (default http://localhost:5173)
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const url = `${base}/?offline=1&bots=1&e2e=1&music=0&telemetry=1`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const posts = [];
page.on('request', (r) => {
  if (r.url().includes('/api/forge/telemetry')) posts.push(r.postData() ?? '');
});
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exitCode = 1;
};

await page.goto(url, { timeout: 120_000 });
await page.waitForFunction(() => window.game?.ready, null, { timeout: 180_000, polling: 200 });
console.log('game ready; quality =', await page.evaluate(() => window.game.quality?.level));

const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(window.game.perf.frames + window.game.perf.windowStart))));

// 1) a throwing frame must not kill the loop
await page.evaluate(() => {
  const g = window.game;
  const orig = g.hud.update.bind(g.hud);
  let n = 0;
  g.hud.update = (dt) => {
    if (n++ < 3) throw new Error('resilience-test frame error');
    orig(dt);
  };
});
await page.waitForTimeout(500);
const f1 = await frames();
await page.waitForTimeout(800);
const f2 = await frames();
if (f2 === f1) fail('frame loop stopped after an exception');
else console.log('ok: frame loop survives exceptions');

// 2) context loss / restore
const gfx = await page.evaluate(async () => {
  const r = window.game.rc.renderer;
  r.forceContextLoss();
  await new Promise((res) => setTimeout(res, 600));
  const shown = !!document.querySelector('[data-testid="banner-gfx"]');
  const lost = window.game.contextLost;
  r.forceContextRestore();
  await new Promise((res) => setTimeout(res, 1500));
  return { shown, lost, after: !!document.querySelector('[data-testid="banner-gfx"]'), stillLost: window.game.contextLost, calls: r.info.render.calls };
});
console.log('context loss:', gfx);
if (!gfx.shown || !gfx.lost) fail('no banner / state on context loss');
if (gfx.after || gfx.stillLost) fail('context not restored');
if (gfx.calls === 0) fail('nothing rendered after restore');

// 3) quality switching
const q = await page.evaluate(async () => {
  const g = window.game;
  const vis = (n) => g.rc.scene.getObjectByName(n)?.visible;
  g.quality.apply('low', 'test');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const low = { pr: g.rc.renderer.getPixelRatio(), shadows: g.rc.renderer.shadowMap.enabled, clutter: vis('desk-clutter'), folded: vis('seats-folded'), chairs: g.rc.scene.getObjectByName('chairs')?.count };
  g.quality.apply('high', 'test');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const high = { pr: g.rc.renderer.getPixelRatio(), shadows: g.rc.renderer.shadowMap.enabled, clutter: vis('desk-clutter'), folded: vis('seats-folded'), chairs: g.rc.scene.getObjectByName('chairs')?.count };
  return { low, high, map: g.map.id };
});
console.log('quality:', JSON.stringify(q));
if (q.low.pr > 1 || q.low.shadows) fail('low quality did not drop pixel ratio / shadows');
if (q.map === 'tauron-remake' && (q.low.clutter !== false || q.high.clutter !== true || !(q.high.chairs > q.low.chairs))) fail('decor not toggled by quality');

// 4) telemetry
await page.waitForTimeout(5000);
const all = posts.join('\n');
console.log(`telemetry posts: ${posts.length}`);
for (const kind of ['session', 'error', 'contextlost']) {
  if (!all.includes(`"kind":"${kind}"`)) fail(`no ${kind} telemetry report sent`);
}
const unexpected = errors.filter((e) => !e.includes('resilience-test'));
if (unexpected.length) fail(`page errors: ${unexpected.join(' | ')}`);
await browser.close();
console.log(process.exitCode ? 'RESILIENCE: FAIL' : 'RESILIENCE: PASS');
