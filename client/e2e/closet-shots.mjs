#!/usr/bin/env node
// Closet screenshot tour (offline, no SpacetimeDB): the Closet editor with generated outfits and a
// line-up of bots in different outfits (small / normal / big) in the arena.
//   node e2e/closet-shots.mjs [baseUrl] [outDir]
// baseUrl: vite dev with FORGE_PROXY at a mock forge (default http://localhost:5191).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5191';
const out = resolve(process.argv[3] ?? 'e2e/screenshots/closet');
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
const shot = async (name) => {
  if (only && !only.has(name)) return;
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log('shot', name);
};
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${base}/?offline=1&e2e=1&name=Eli&bots=9&music=0`);
await page.waitForFunction(() => window.__game?.getState().ready, null, { timeout: 90000 });
await page.evaluate(() => document.fonts.ready);

// ---- Closet editor
for (const [i, prompt] of ['medieval knight with a red cape', 'astronaut', 'banana suit', 'giant heavy robot', 'tiny ninja'].entries()) {
  await page.evaluate(() => window.__game.openCloset('pause'));
  await page.waitForSelector('[data-testid=closet-editor]');
  await page.fill('[data-testid=closet-prompt]', prompt);
  await page.click('[data-testid=closet-reforge]');
  if (i === 0) {
    await page.waitForFunction(() => (window.__game.getState().closet?.busy && document.querySelectorAll('[data-testid=closet-piece]').length >= 3), null, { timeout: 30000 }).catch(() => {});
    await shot('01-closet-streaming');
  }
  await page.waitForFunction(() => { const c = window.__game.getState().closet; return c && !c.busy && c.outfit; }, null, { timeout: 60000 });
  await wait(1200);
  await shot(`0${i + 2}-closet-${prompt.split(' ').slice(-2).join('-')}`);
  if (i === 0) {
    const cards = page.locator('[data-testid=closet-piece]');
    await cards.nth(0).locator('[data-testid=piece-lock]').click();
    await cards.nth(2).locator('[data-testid=piece-reject]').click();
    await cards.nth(1).hover();
    await wait(600);
    await shot('07-closet-marks');
  }
  await page.click('[data-testid=closet-close]');
  await wait(300);
}
// preset quick pick
await page.evaluate(() => window.__game.openCloset('pause'));
await page.waitForSelector('[data-testid=closet-editor]');
await page.locator('[data-testid=closet-preset]').nth(2).click();
await wait(1000);
await shot('08-closet-preset-tank');
await page.locator('[data-testid=closet-preset]').nth(0).click();
await wait(1000);
await shot('09-closet-preset-scout');
await page.click('[data-testid=closet-close]');
await wait(300);
await page.evaluate(() => { const p = window.game.flow.pause; if (p.visible) p.hide(); });

// ---- arena line-up: bots stand in a row (presets small -> big, then themed looks)
await page.evaluate(() => {
  const g = window.game;
  const bots = g.net.bots;
  const ids = ['preset-scout', 'example-2', 'preset-soldier', 'example-3', 'example-4', 'example-0', 'example-1', 'example-5', 'preset-tank'];
  window.__game.botsOutfits(ids);
  // on the central stage deck (x -6..6, z -4..4, top 1.2 m), facing +Z (the camera)
  bots.forEach((b, i) => { b.cx = -4 + i * 1.0; b.cz = -2.5; b.r = 0; b.speed = 0; b.phase = 0; b.still = true; b.pos = [b.cx, 1.2, b.cz]; });
  window.__game.teleport(0, 1.25, 3.6, 0);
});
await wait(2500);
const V = (x, y, z) => page.evaluate(([x, y, z]) => { const g = window.game; g.lookAt(new (g.player.feet.constructor)(x, y, z)); }, [x, y, z]);
await page.evaluate(() => window.game.hud.setVisible(false));
await V(0, 2.0, -2.5);
await wait(1500);
await shot('10-arena-lineup');
await page.evaluate(() => window.__game.teleport(-2.6, 1.25, 0.6, 0));
await V(-2.6, 2.1, -2.5);
await wait(1500);
await shot('11-arena-closeup');
await page.evaluate(() => { window.game.hud.setVisible(true); window.__game.forceScoreboard(true); });
await wait(800);
await shot('12-scoreboard');
const st = await page.evaluate(() => window.__game.getState().playersSeen.map((p) => ({ name: p.name, outfit: p.outfit, maxHp: p.maxHp })));
console.log(JSON.stringify(st));
console.log(JSON.stringify(await page.evaluate(() => window.__game.memStats().outfitCache)));
await browser.close();
