#!/usr/bin/env node
// Live smoke (production): join, quick-pick a pistol, tailor one outfit with the LIVE closet
// (one generation), wear it, check the server-derived max HP on Maincloud.
//   node e2e/closet-live-smoke.mjs [baseUrl] [prompt] [outPng]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://187.7.27.171';
const prompt = process.argv[3] ?? 'a big armoured riot cop';
const out = process.argv[4];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const st = () => page.evaluate(() => window.__game.getState());
await page.goto(`${base}/?e2e=1&fresh=1&name=ClosetSmoke&music=0`);
await page.waitForFunction(() => { const s = window.__game?.getState(); return s?.ready && s.connected && s.localId; }, null, { timeout: 90000 });
if ((await st()).needsLoadout) {
  await page.getByTestId('quick-pick-pistol').click();
  await page.waitForFunction(() => { const s = window.__game.getState(); return s.alive && !s.needsLoadout && s.screen === 'none'; }, null, { timeout: 30000 });
}
await page.evaluate(() => window.__game.openCloset('pause'));
await page.waitForSelector('[data-testid=closet-editor]');
await page.fill('[data-testid=closet-prompt]', prompt);
const t0 = Date.now();
await page.click('[data-testid=closet-reforge]');
await page.waitForFunction(() => { const c = window.__game.getState().closet; return c && !c.busy && (c.outfit || c.error); }, null, { timeout: 90000 });
const c = (await st()).closet;
console.log(`generated in ${Date.now() - t0} ms:`, c.error ?? `${c.outfit.name} body=${JSON.stringify(c.outfit.body)} pieces=${c.outfit.pieces.length}`);
await page.waitForTimeout(1500);
if (out) await page.screenshot({ path: out });
if (c.outfit) {
  await page.click('[data-testid=closet-equip]');
  await page.waitForFunction(() => { const s = window.__game.getState(); return s.alive && s.outfit && s.screen === 'none'; }, null, { timeout: 30000 });
  const s = await st();
  console.log(`wearing outfit #${s.outfitId} "${s.outfit.name}": serverMaxHp=${s.serverMaxHp} serverHp=${s.serverHp} speed=${s.bodySpeedMult} dims=${JSON.stringify(s.outfit.dims)}`);
}
await browser.close();
