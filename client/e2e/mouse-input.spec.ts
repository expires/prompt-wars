import { expect, firefox, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
// @ts-expect-error plain JS helper shared with e2e/measure-mouse.mjs
import { gameReadyInPage, streamMouseInPage } from './mouse-stream.mjs';

/**
 * High-polling-rate mice (1-8 kHz): every movementX/Y delta must reach the camera (no rounding,
 * filtering or dropped events), the listener must stay cheap, and rendering must keep going.
 * Offline mode: no SpacetimeDB needed.
 */
interface StreamResult {
  events: number;
  eventsPerSec: number;
  sumX: number;
  yawDelta: number;
  expectedYawDelta: number;
  yawError: number;
  pitchError: number;
  usPerEvent: number;
  fps: number;
  frameMsP99: number;
  perf: { fps: number; mouseHz: number; mouseEvents: number } | null;
  inactiveFrames: number;
  alive: boolean;
  screen: string;
}

async function boot(page: Page) {
  await page.goto('/?offline=1&e2e=1&fresh=1&map=testmap&name=MouseTest');
  await page.waitForFunction(gameReadyInPage, null, { timeout: 120_000, polling: 250 });
  // a known floor spot on the test map (random spawns near the edge can fall out mid-test)
  await page.evaluate(() => (window as unknown as { __game: { teleport(x: number, y: number, z: number, yaw?: number): void } }).__game.teleport(8, 0.1, -24, 0));
  await page.waitForTimeout(1000);
}

async function check(page: Page, label: string) {
  for (const hz of [1000, 8000]) {
    const r = (await page.evaluate(streamMouseInPage, { hz, ms: 2000 })) as StreamResult;
    console.log(
      `[${label}] ${hz} Hz: ${r.events} events (${r.eventsPerSec}/s), yaw ${r.yawDelta.toFixed(4)} vs ${r.expectedYawDelta.toFixed(4)} rad, ` +
        `${r.usPerEvent.toFixed(2)} us/event, ${r.fps} fps (p99 ${r.frameMsP99.toFixed(1)} ms), F3 ${r.perf?.mouseHz} ev/s, ` +
        `inactive frames ${r.inactiveFrames} alive ${r.alive} screen ${r.screen}`,
    );
    expect(r.events).toBeGreaterThan(hz * 1.5);
    expect(r.inactiveFrames, 'player stayed alive + locked during the stream').toBe(0);
    // every count applied exactly once: total yaw == sum(dx) * sensitivity
    expect(Math.abs(r.yawError)).toBeLessThan(1e-9);
    expect(Math.abs(r.pitchError)).toBeLessThan(1e-9);
    // generous bound (software GPU, CI): the listener + synthetic dispatch stays in the microseconds
    expect(r.usPerEvent).toBeLessThan(50);
    expect(r.fps).toBeGreaterThan(20);
    expect(r.perf?.mouseHz ?? 0).toBeGreaterThan(hz * 0.5);
  }
}

test('mouse: 1-8 kHz synthetic stream, no lost deltas (chromium)', async ({ page }) => {
  await boot(page);
  await check(page, 'chromium');
});

test('mouse: 1-8 kHz synthetic stream, no lost deltas (firefox)', async ({ baseURL }) => {
  test.skip(!existsSync(firefox.executablePath()), 'playwright firefox not installed (npx playwright install firefox)');
  const browser = await firefox.launch({ executablePath: firefox.executablePath(), args: [] });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1280, height: 720 } });
    await boot(page);
    await check(page, 'firefox');
  } finally {
    await browser.close();
  }
});
