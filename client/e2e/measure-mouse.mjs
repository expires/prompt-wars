#!/usr/bin/env node
// Mouse-look stress measurement: streams synthetic high-polling-rate mouse movement into the
// game (offline mode) and reports lost deltas, dispatch cost per event and frame rate.
//
//   node e2e/measure-mouse.mjs [url] [chromium|firefox|webkit] [hz,hz,...]
//   node e2e/measure-mouse.mjs http://187.7.27.171 firefox 1000,8000
//
// Default url: http://localhost:5179 (a running `pnpm dev --port 5179`). Headless browsers render
// on a software GPU, so absolute FPS is low; compare runs, not absolute numbers.
import { chromium, firefox, webkit } from '@playwright/test';
import { gameReadyInPage, streamMouseInPage } from './mouse-stream.mjs';

const base = process.argv[2] ?? 'http://localhost:5179';
const which = process.argv[3] ?? 'chromium';
const rates = (process.argv[4] ?? '1000,4000,8000').split(',').map(Number);
const type = { chromium, firefox, webkit }[which];
if (!type) throw new Error(`unknown browser ${which}`);

const launchOpts =
  which === 'chromium'
    ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
    : {};
const browser = await type.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?offline=1&e2e=1&fresh=1&map=testmap&name=MouseBench`);
await page.waitForFunction(gameReadyInPage, null, { timeout: 120_000, polling: 250 });
// a known floor spot on the test map (random spawns near the edge can fall out mid-run)
await page.evaluate(() => window.__game.teleport(8, 0.1, -24, 0));
await page.waitForTimeout(1500);
console.log(`${which} ${await browser.version()}  ${base}`);
for (const hz of rates) {
  const r = await page.evaluate(streamMouseInPage, { hz, ms: 3000 });
  console.log(
    `${String(hz).padStart(5)} Hz: ${r.events} events (${r.eventsPerSec}/s)  sum dx ${r.sumX}  ` +
      `yaw err ${r.yawError.toExponential(2)} rad  pitch err ${r.pitchError.toExponential(2)}  ` +
      `${r.usPerEvent.toFixed(2)} us/event  fps ${r.fps}  frame p50 ${r.frameMsP50.toFixed(1)} p99 ${r.frameMsP99.toFixed(1)} max ${r.frameMsMax.toFixed(1)} ms` +
      (r.perf ? `  [F3: ${r.perf.fps} fps, ${r.perf.mouseHz} ev/s]` : '') +
      (r.inactiveFrames ? `  (${r.inactiveFrames} frames dead / unlocked: input discarded, screen ${r.screen})` : ''),
  );
}
await browser.close();
