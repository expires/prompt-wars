#!/usr/bin/env node
// Auto-reconnect check against a LOCAL SpacetimeDB (`spacetime start` + `pnpm --filter @ai-gaem/server
// publish:local`): drop the websocket under a playing client and expect the "Reconnecting" banner,
// then the same identity back online with a pose slot, without leaving the match.
//   node e2e/reconnect.mjs [baseUrl]      (default http://localhost:5173)
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exitCode = 1;
};

await page.goto(`${base}/?server=local&e2e=1&music=0&fresh=1&name=ReconnectTest`, { timeout: 120_000 });
await page.waitForFunction(() => window.game?.ready && window.game.net.connected, null, { timeout: 180_000, polling: 200 });
const before = await page.evaluate(() => ({ id: window.game.net.localId, screen: window.game.flow.screen }));
console.log('connected as', before.id.slice(0, 12), 'screen', before.screen);

for (let round = 1; round <= 2; round++) {
  // kill the socket (what a network blip / server restart looks like to the client)
  await page.evaluate(() => window.game.net.conn.ws.close());
  await page.waitForFunction(() => !!document.querySelector('[data-testid="banner-net"]'), null, { timeout: 10_000 }).catch(() => fail('no reconnect banner'));
  const banner = await page.evaluate(() => document.querySelector('[data-testid="banner-net"]')?.textContent);
  console.log(`round ${round}: banner "${banner}"`);
  await page
    .waitForFunction(() => window.game.net.connected && !document.querySelector('[data-testid="banner-net"]'), null, { timeout: 30_000, polling: 200 })
    .catch(() => fail('did not reconnect within 30 s'));
  const after = await page.evaluate(() => ({ id: window.game.net.localId, screen: window.game.flow.screen, me: window.game.net.getLocal?.() }));
  console.log(`round ${round}: reconnected as`, after.id.slice(0, 12), 'online', after.me?.online, 'screen', after.screen);
  if (after.id !== before.id) fail('identity changed across reconnect');
  if (!after.me?.online) fail('player row not online after reconnect');
}
if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
await browser.close();
console.log(process.exitCode ? 'RECONNECT: FAIL' : 'RECONNECT: PASS');
