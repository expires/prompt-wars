// Capture the real Prompt Wars client for the promo video: landing -> PLAY -> Closet (type the
// armour prompt, stream the outfit build) -> "Next: weapon" -> Forge (type the weapon prompt,
// stream the build) -> "Equip & deploy" -> a few seconds in game.
//
//   pnpm video:record     record mode: forge calls go to the real forge (live VPS) and the NDJSON
//                         streams are saved to video/fixtures/ (costs two forge generations)
//   pnpm video:capture    replay mode: forge calls are answered from the fixtures with their
//                         original timing -> identical takes, no API cost
//
// Output: video/public/capture.mp4 (+ capture.json: segment markers and the 3D-stage rects that
// the Remotion composition cuts and zooms on). Frames come from a CDP screencast of the page (the
// real UI pixels, nothing re-rendered) and are laid on a constant 60 fps timeline by ffmpeg.
//
// Flags:
//   --record              record fixtures from the real forge (see above)
//   --record-only <kind>  with --record: record just 'outfit' or 'weapon', replay the other
//   --live                drive the live site (http://187.7.27.171) instead of the local stack
//                         (Maincloud DB: creates a real player; prefer local)
//   --base-url <url>      drive an already running client instead of starting Vite
//   --upstream <url>      forge to record from (default http://187.7.27.171)
//   --armour "<prompt>"   Closet prompt     (default: medieval knight in battered steel plate armour)
//   --weapon "<prompt>"   Forge prompt      (default: tactical karambit with a black blade and orange grip)
//   --name <callsign>     player name       (default PromptWarsDemo)
//   --headless            headless Chromium on SwiftShader (default: headed, real GPU, smoother)
//   --dpr <1|2>           device scale factor (2 = 4K frames, crisper zooms; default 1)
//   --no-deploy           stop after the Forge build (skip "Equip & deploy")
//   --no-publish          don't (re)publish the module to the local SpacetimeDB
//   --db <name>           local database (default prompt-wars-video)
//   --speed <x>           replay speed of the forge streams (default 1 = recorded timing)
//   --fixtures <dir>      fixture directory (default video/fixtures)

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startForgeProxy, type ForgeProxy } from './forgeProxy';

const here = dirname(fileURLToPath(import.meta.url));
const videoDir = resolve(here, '..');
const repoDir = resolve(videoDir, '..');
const clientDir = join(repoDir, 'client');
const serverDir = join(repoDir, 'server');
const publicDir = join(videoDir, 'public');
const framesDir = join(videoDir, '.capture-tmp');

const LIVE_URL = 'http://187.7.27.171';
const VITE_PORT = Number(process.env.VIDEO_VITE_PORT ?? 5193);
const PROXY_PORT = Number(process.env.VIDEO_FORGE_PORT ?? 8794);
const VIEWPORT = { width: 1920, height: 1080 };

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : d;
};
const args = {
  record: flag('record'),
  recordOnly: opt('record-only', '') as '' | 'outfit' | 'weapon',
  live: flag('live'),
  baseUrl: opt('base-url', ''),
  upstream: opt('upstream', LIVE_URL),
  armour: opt('armour', 'medieval knight in battered steel plate armour'),
  weapon: opt('weapon', 'tactical karambit with a black blade and orange grip'),
  name: opt('name', 'PromptWarsDemo'),
  headless: flag('headless'),
  dpr: Number(opt('dpr', '1')) || 1,
  deploy: !flag('no-deploy'),
  publish: !flag('no-publish'),
  db: opt('db', 'prompt-wars-video'),
  speed: Number(opt('speed', '1')) || 1,
  fixtures: resolve(opt('fixtures', join(videoDir, 'fixtures'))),
};

const env = { ...process.env, PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH}` };
const log = (m: string) => console.log(`[capture] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ local stack

const children: ChildProcess[] = [];
function killAll() {
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
}
process.on('SIGINT', () => {
  killAll();
  process.exit(130);
});

async function httpOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    return r.status < 500;
  } catch {
    return false;
  }
}

async function waitHttp(url: string, ms: number, what: string) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await httpOk(url)) return;
    await sleep(500);
  }
  throw new Error(`${what} did not come up at ${url}`);
}

async function localStack(proxyUrl: string): Promise<string> {
  // SpacetimeDB on :3000 (reuse a running one)
  if (!(await httpOk('http://127.0.0.1:3000/v1/ping'))) {
    log('starting local SpacetimeDB ...');
    const st = spawn('spacetime', ['start'], { env, detached: true, stdio: 'ignore' });
    children.push(st);
    await waitHttp('http://127.0.0.1:3000/v1/ping', 30_000, 'SpacetimeDB');
  }
  if (args.publish) {
    // a clean database every take: the client answers a prompt it has seen before from the
    // server's weapon rows (no forge call, no build-up), so a previous take would spoil this one.
    // LOCAL server only, and never the game's own database name.
    if (args.db === 'prompt-wars-63xhe') throw new Error('refusing to wipe prompt-wars-63xhe: pick a dedicated --db for captures');
    log(`publishing the module to a fresh local database ${args.db} ...`);
    const sync = spawnSync('node', ['scripts/sync-catalog.mjs'], { cwd: serverDir, env, stdio: 'inherit' });
    if (sync.status !== 0) throw new Error('sync-catalog failed');
    const pub = spawnSync('spacetime', ['publish', '--server', 'local', '--module-path', '.', args.db, '--delete-data', '--yes'], { cwd: serverDir, env, stdio: 'inherit' });
    if (pub.status !== 0) throw new Error('spacetime publish (local) failed');
  }
  // Vite dev server; its /api/forge proxy points at the record / replay server, never the live forge
  log(`starting Vite on :${VITE_PORT} (forge -> ${proxyUrl}) ...`);
  const vite = spawn('pnpm', ['exec', 'vite', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: clientDir,
    env: { ...env, FORGE_PROXY: proxyUrl },
    detached: true,
    stdio: 'ignore',
  });
  children.push(vite);
  await waitHttp(`http://localhost:${VITE_PORT}/`, 60_000, 'Vite');
  return `http://localhost:${VITE_PORT}`;
}

// ------------------------------------------------------------------ browser

/** Playwright's own Chromium, else the newest cached Chrome for Testing (same logic as client/playwright.config.ts) */
function chromiumPath(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  try {
    const own = chromium.executablePath();
    if (existsSync(own)) return own;
  } catch {
    /* fall through */
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const sub of ['chrome-mac-arm64', 'chrome-mac']) {
      const exe = join(cache, d, sub, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

type Win = Window & { __game: { getState(): Record<string, any> }; __gameError?: string };

async function getState(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (window as unknown as Win).__game.getState());
}

async function waitState(page: Page, pred: (s: Record<string, any>) => boolean, timeout: number, what: string) {
  const t0 = Date.now();
  let last: Record<string, any> | undefined;
  while (Date.now() - t0 < timeout) {
    last = await getState(page);
    if (pred(last)) return last;
    await sleep(80);
  }
  throw new Error(`timeout waiting for ${what}`);
}

/** seeded PRNG so the typing rhythm is the same every take */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** type like a person: ~55-120 ms per key, a little longer after spaces / punctuation */
async function humanType(page: Page, text: string, seed: number) {
  const r = rng(seed);
  for (const ch of text) {
    await page.keyboard.type(ch);
    let d = 55 + r() * 65;
    if (ch === ' ') d += 40 + r() * 60;
    if (/[,.]/.test(ch)) d += 120;
    await sleep(d);
  }
}

/** glide the (invisible) mouse onto an element so its hover state shows, then click */
async function glideClick(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await el.waitFor({ state: 'visible' });
  const b = (await el.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
  await sleep(260);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function rectOf(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
}

// ------------------------------------------------------------------ screencast

interface Frame {
  file: string;
  t: number;
}

async function startScreencast(page: Page, dpr: number) {
  const cdp = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const writes: Promise<void>[] = [];
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  cdp.on('Page.screencastFrame', (f) => {
    const file = join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    writes.push(writeFile(file, Buffer.from(f.data, 'base64')));
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: VIEWPORT.width * dpr,
    maxHeight: VIEWPORT.height * dpr,
    everyNthFrame: 1,
  });
  return {
    frames,
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
    },
  };
}

/** frames (variable rate, wall-clock stamped) -> constant 60 fps H.264 */
function encode(frames: Frame[], out: string) {
  if (frames.length < 2) throw new Error('screencast produced no frames');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const next = frames[i + 1]?.t ?? frames[i]!.t + 1 / 60;
    lines.push(`file '${frames[i]!.file}'`, `duration ${Math.max(0.001, next - frames[i]!.t).toFixed(6)}`);
  }
  lines.push(`file '${frames.at(-1)!.file}'`);
  const list = join(framesDir, 'frames.ffconcat');
  writeFileSync(list, lines.join('\n') + '\n');
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=60,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-movflags', '+faststart', out],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error('ffmpeg encode failed');
}

// ------------------------------------------------------------------ main

async function main() {
  const proxy: ForgeProxy = await startForgeProxy({ mode: args.record ? 'record' : 'replay', port: PROXY_PORT, recordKinds: args.recordOnly ? [args.recordOnly] : undefined, fixturesDir: args.fixtures, upstream: args.upstream, speed: args.speed });
  log(`forge ${args.record ? `RECORD ${args.recordOnly || 'outfit+weapon'} from ${args.upstream}` : 'REPLAY from fixtures'} at ${proxy.url}`);

  const base = args.baseUrl || (args.live ? LIVE_URL : await localStack(proxy.url));
  const query = new URLSearchParams({ e2e: '1', fresh: '1', closet: '1', name: args.name });
  if (!args.live && !args.baseUrl) {
    query.set('server', 'local');
    query.set('db', args.db);
  }
  const url = `${base}/?${query}`;

  const gpuArgs = args.headless
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const browser: Browser = await chromium.launch({
    headless: args.headless,
    executablePath: chromiumPath(),
    args: [...gpuArgs, `--window-size=${VIEWPORT.width},${VIEWPORT.height + 140}`, '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb'],
  });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: args.dpr });
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') log(`console error: ${m.text()}`);
  });
  // every forge call goes to the record / replay server (works for any origin, the live site too)
  await page.route('**/api/forge/**', (route) => {
    const u = new URL(route.request().url());
    return route.continue({ url: `${proxy.url}${u.pathname}${u.search}` });
  });

  const markers: Record<string, number> = {};
  let cast: Awaited<ReturnType<typeof startScreencast>> | null = null;
  const mark = (k: string) => {
    markers[k] = Date.now() / 1000;
    log(`> ${k}`);
  };

  try {
    log(`opening ${url}`);
    await page.goto(url);
    await page.waitForFunction(
      () => {
        const w = window as unknown as Win;
        if (w.__gameError) throw new Error(w.__gameError);
        const s = w.__game?.getState();
        return !!s && s.ready && s.connected && s.screen === 'landing';
      },
      undefined,
      { timeout: 120_000, polling: 250 },
    );
    // (a string: tsx's keepNames helpers don't exist in the page)
    const fps = await page.evaluate<number>(
      `new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => (++n, performance.now() - t0 < 1000 ? requestAnimationFrame(tick) : r(n)); requestAnimationFrame(tick); })`,
    );
    log(`render loop: ~${fps} fps`);
    await page.getByTestId('landing').waitFor({ state: 'visible' });
    await sleep(1500); // fonts + landing intro animation

    cast = await startScreencast(page, args.dpr);
    await sleep(300);
    mark('start');
    await sleep(1800);

    // ---- Closet (step 1)
    mark('play');
    await glideClick(page, 'landing-play');
    await page.getByTestId('closet-editor').waitFor({ state: 'visible', timeout: 60_000 });
    mark('closetOpen');
    await sleep(1400);
    const closetStage = await rectOf(page, '[data-testid="closet-editor"] .forge-stage');
    await page.getByTestId('closet-prompt').click();
    await page.getByTestId('closet-prompt').fill('');
    mark('closetType');
    await humanType(page, args.armour, 7);
    await sleep(500);
    mark('closetGenerate');
    await glideClick(page, 'closet-reforge');
    await waitState(page, (s) => !!s.closet?.busy, 10_000, 'closet busy (no forge call?)');
    await waitState(page, (s) => !!s.closet && !s.closet.busy && !!s.closet.outfit, 120_000, 'closet build done');
    mark('closetDone');
    const outfit = (await getState(page)).closet?.outfit;
    log(`outfit: ${outfit?.name} (${outfit?.pieces?.length} pieces)`);
    await sleep(4500);

    // ---- Forge (step 2)
    mark('next');
    await glideClick(page, 'closet-equip');
    await page.getByTestId('forge-editor').waitFor({ state: 'visible', timeout: 60_000 });
    mark('forgeOpen');
    await sleep(1400);
    const forgeStage = await rectOf(page, '[data-testid="forge-editor"] .forge-stage');
    await page.getByTestId('forge-prompt').click();
    await page.getByTestId('forge-prompt').fill('');
    mark('forgeType');
    await humanType(page, args.weapon, 11);
    await sleep(500);
    mark('forgeGenerate');
    await glideClick(page, 'forge-reforge');
    await waitState(page, (s) => !!s.forge?.busy, 10_000, 'forge busy (no forge call: a client prompt-cache hit? the --db must be fresh)');
    await waitState(page, (s) => !!s.forge && !s.forge.busy && !!s.forge.design, 120_000, 'forge build done');
    mark('forgeDone');
    const design = (await getState(page)).forge?.design;
    log(`weapon: ${design?.name} (${design?.components?.length} components)`);
    await sleep(5000);

    // ---- deploy
    if (args.deploy) {
      mark('deploy');
      await glideClick(page, 'forge-equip');
      await waitState(page, (s) => s.alive && !s.needsLoadout && s.screen === 'none', 30_000, 'deployed');
      mark('inGame');
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
      await sleep(5000);
    }
    mark('end');
    await cast.stop();

    const frames = cast.frames;
    const t0 = frames[0]!.t;
    const dur = frames.at(-1)!.t - t0;
    log(`screencast: ${frames.length} frames over ${dur.toFixed(1)}s (~${(frames.length / dur).toFixed(0)} fps captured)`);
    mkdirSync(publicDir, { recursive: true });
    const out = join(publicDir, 'capture.mp4');
    log('encoding -> video/public/capture.mp4 ...');
    encode(frames, out);
    const rel: Record<string, number> = {};
    for (const [k, v] of Object.entries(markers)) rel[k] = +(v - t0).toFixed(3);
    const meta = {
      video: 'capture.mp4',
      capturedAt: new Date().toISOString(),
      mode: args.record ? 'record' : 'replay',
      source: args.live ? LIVE_URL : args.baseUrl || 'local',
      viewport: VIEWPORT,
      dpr: args.dpr,
      durationSec: +dur.toFixed(3),
      capturedFps: +(frames.length / dur).toFixed(1),
      renderFps: fps,
      prompts: { armour: args.armour, weapon: args.weapon },
      outfit: outfit ? { name: outfit.name, pieces: outfit.pieces.length } : null,
      weapon: design ? { name: design.name, components: design.components.length } : null,
      /** seconds from the first video frame */
      markers: rel,
      /** CSS px in the 1920x1080 viewport */
      rects: { closetStage, forgeStage },
      forge: proxy.served,
    };
    writeFileSync(join(publicDir, 'capture.json'), JSON.stringify(meta, null, 2) + '\n');
    rmSync(framesDir, { recursive: true, force: true });
    log(`done: video/public/capture.mp4 (${dur.toFixed(1)}s) + capture.json`);
  } finally {
    await cast?.stop().catch(() => {});
    await browser.close().catch(() => {});
    await proxy.close().catch(() => {});
    killAll();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`[capture] FAILED: ${(e as Error).stack ?? e}`);
    killAll();
    process.exit(1);
  },
);
