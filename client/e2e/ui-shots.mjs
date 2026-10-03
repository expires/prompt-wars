#!/usr/bin/env node
// UI screenshot tour (offline mode, no SpacetimeDB needed): landing, forge (mid-stream, done,
// variants), HUD, pause menu + settings tabs, death screen.
//   node e2e/ui-shots.mjs [baseUrl] [outDir] [w] [h]
// baseUrl defaults to http://localhost:5199 (vite dev with FORGE_PROXY at a mock forge).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5199';
const out = resolve(process.argv[3] ?? 'e2e/screenshots/ui');
const W = Number(process.argv[4] ?? 1600);
const H = Number(process.argv[5] ?? 900);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
const shot = async (name) => {
  if (only && !only.has(name)) return;
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  console.log('shot', name);
};
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`${base}/?offline=1&e2e=1&name=Eli`);
await page.waitForFunction(() => window.__game?.getState().ready, null, { timeout: 60000 });
await page.evaluate(() => window.game.flow.showLanding());
await page.waitForSelector('[data-testid=landing]:not([hidden])');
await page.evaluate(() => document.fonts.ready);
await wait(800);
await shot('01-landing');

// forge: stream a design
await page.click('[data-testid=landing-forge]');
await page.waitForSelector('[data-testid=forge-editor]');
await wait(500);
await shot('02-forge-empty');
await page.fill('[data-testid=forge-prompt]', 'a steampunk crocodile revolver');
await page.click('[data-testid=forge-reforge]');
await page.waitForFunction(() => (window.__game.getState().forge?.drafts[0]?.components ?? 0) >= 3, null, { timeout: 30000 });
await shot('03-forge-streaming');
await page.waitForFunction(() => window.__game.getState().forge && !window.__game.getState().forge.busy, null, { timeout: 60000 });
await wait(900);
await shot('04-forge-done');
// mark + hover
const cards = page.locator('[data-testid=forge-comp]');
await cards.nth(1).locator('[data-testid=comp-lock]').click();
await cards.nth(2).locator('[data-testid=comp-reject]').click();
await cards.nth(0).locator('[data-testid=comp-keep]').click();
await cards.nth(3).hover();
await wait(600);
await shot('05-forge-marks-hover');
// variants
await page.click('[data-testid=forge-variants-3]');
await page.fill('[data-testid=forge-prompt]', 'make it chrome');
await page.click('[data-testid=forge-reforge]');
await page.waitForFunction(() => window.__game.getState().forge && !window.__game.getState().forge.busy, null, { timeout: 60000 });
await wait(900);
await shot('06-forge-variants');
await page.hover('[data-testid=forge-variant-B]');
await wait(400);
await shot('07-forge-variant-hover');
await page.click('[data-testid=forge-compare]');
await wait(300);
await shot('08-forge-compare');
await page.keyboard.press('Escape');
await page.click('[data-testid=forge-equip]');
await page.waitForFunction(() => !window.__game.getState().forge && window.__game.getState().alive, null, { timeout: 30000 });
await wait(1200);
await shot('09-hud');
await page.evaluate(() => window.__game.forceScoreboard(true));
await wait(300);
await shot('10-scoreboard');
await page.evaluate(() => window.__game.forceScoreboard(false));
await page.evaluate(() => window.__game.openPause());
await wait(500);
await shot('11-pause');
await page.click('[data-testid=pause-settings]');
for (const t of ['controls', 'mouse', 'gamepad', 'video', 'audio']) {
  const tab = page.locator(`[role=tab][data-tab="${t}"], [data-testid="settings-tab-${t}"]`).first();
  if (await tab.count()) await tab.click();
  await wait(250);
  await shot(`12-settings-${t}`);
}
await page.click('[data-testid=pause-resume]');
await page.evaluate(() => window.game.die('Killed'));
await wait(600);
await shot('13-death');
await browser.close();
