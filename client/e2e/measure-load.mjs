#!/usr/bin/env node
// Time-to-playable under a throttled network (CDP: ~1.5 Mbps down, 200 ms latency, cache off).
//   node e2e/measure-load.mjs [url] [runs]
// Default url: http://187.7.27.171/?offline=1 (offline => no game server involved; measures load only).
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://187.7.27.171/?offline=1';
const runs = Number(process.argv[3] ?? 2);
const browser = await chromium.launch();
const results = [];
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 200,
    downloadThroughput: (1.5 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  let bytes = 0;
  let reqs = 0;
  const urls = new Map();
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength;
    reqs++;
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit', timeout: 180_000 });
  const fcpP = page
    .waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0, null, { timeout: 180_000, polling: 50 })
    .then(() => page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0].startTime));
  await page.waitForFunction(
    () => {
      const w = window;
      if (w.__gameError) throw new Error(w.__gameError);
      const s = w.__game?.getState?.();
      return !!s && s.ready && !!s.weaponId;
    },
    null,
    { timeout: 180_000, polling: 50 },
  );
  const playable = Date.now() - t0;
  const bytesAtPlayable = bytes;
  const fcp = await fcpP;
  // let lazy chunks (parts library / templates prefetch) finish
  await page.waitForTimeout(1500);
  await page.waitForLoadState('networkidle', { timeout: 180_000 }).catch(() => {});
  const full = Date.now() - t0;
  results.push({ run: i + 1, fcpMs: Math.round(fcp), playableMs: playable, bytesAtPlayable, idleMs: full, totalBytes: bytes, requests: reqs });
  await ctx.close();
}
await browser.close();
console.table(results);
