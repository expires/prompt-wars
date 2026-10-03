#!/usr/bin/env node
// Probe (offline): walk the east player-tunnel stairs with a Closet body and log the climb.
//   node e2e/probe-tunnel.mjs [baseUrl] [outfitId|0] [x z yaw]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5191';
const outfit = process.argv[3] ?? 'preset-tank';
const [x, z, yaw] = (process.argv.slice(4).length ? process.argv.slice(4) : ['34.5', '-0.68', String(-Math.PI / 2)]).map(Number);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?offline=1&e2e=1&music=0`);
await page.waitForFunction(() => window.__game?.getState().ready, null, { timeout: 90000 });
if (outfit !== '0') await page.evaluate((id) => window.__game.equipOutfit(null, 'probe', id), outfit);
await page.evaluate(([x, z, yaw]) => window.__game.teleport(x, 0.05, z, yaw), [x, z, yaw]);
await page.waitForTimeout(500);
await page.evaluate(() => window.__game.setAutoRun(true));
let last = '';
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => window.__game.getState());
  const line = `${s.pos.map((v) => v.toFixed(2)).join(',')} crouch=${s.crouching} hs=${s.hSpeed.toFixed(2)} dims=${s.playerDims?.scale}`;
  if (line !== last) console.log(line);
  last = line;
}
await browser.close();
