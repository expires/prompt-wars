// Shared bits of the capture scripts: child processes, the Vite dev server, the browser binary,
// the CDP screencast and the frames -> constant-rate H.264 encode.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
export const videoDir = resolve(here, '..');
export const repoDir = resolve(videoDir, '..');
export const clientDir = join(repoDir, 'client');
export const publicDir = join(videoDir, 'public');
export const outDir = join(videoDir, 'out');
export const VIEWPORT = { width: 1920, height: 1080 };

export const env = { ...process.env, PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH}` };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ processes

export const children: ChildProcess[] = [];
export function killAll() {
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

export async function httpOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    return r.status < 500;
  } catch {
    return false;
  }
}

export async function waitHttp(url: string, ms: number, what: string) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await httpOk(url)) return;
    await sleep(500);
  }
  throw new Error(`${what} did not come up at ${url}`);
}

/** the client's Vite dev server (detached; killAll() stops it). FORGE_PROXY: where /api/forge goes. */
export async function startVite(port: number, forgeProxy: string): Promise<string> {
  const vite = spawn('pnpm', ['exec', 'vite', '--port', String(port), '--strictPort'], {
    cwd: clientDir,
    env: { ...env, FORGE_PROXY: forgeProxy },
    detached: true,
    stdio: 'ignore',
  });
  children.push(vite);
  await waitHttp(`http://localhost:${port}/`, 60_000, 'Vite');
  return `http://localhost:${port}`;
}

// ------------------------------------------------------------------ browser

/** Playwright's own Chromium, else the newest cached Chrome for Testing (same logic as client/playwright.config.ts) */
export function chromiumPath(): string | undefined {
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

/** launch args: headed = the real GPU (smooth); headless = SwiftShader */
export function gpuArgs(headless: boolean): string[] {
  const gpu = headless
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  return [...gpu, `--window-size=${VIEWPORT.width},${VIEWPORT.height + 140}`, '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb'];
}

// ------------------------------------------------------------------ screencast

export interface Frame {
  file: string;
  t: number;
}

/** CDP screencast of the page: every composited frame as a JPEG, wall-clock stamped */
export async function startScreencast(page: Page, dpr: number, framesDir: string) {
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

/**
 * Frames (variable rate, wall-clock stamped) -> constant 60 fps H.264 (yuv420p, faststart).
 * `from`/`to`: optional window in seconds of the frame clock; `crf` | `kbps` (average bitrate cap),
 * `width`, `fps`: output size knobs.
 */
export function encode(frames: Frame[], out: string, framesDir: string, o: { from?: number; to?: number; crf?: number; width?: number; fps?: number; kbps?: number } = {}) {
  const sel = frames.filter((f) => (o.from === undefined || f.t >= o.from) && (o.to === undefined || f.t <= o.to));
  if (sel.length < 2) throw new Error('screencast produced no frames');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < sel.length; i++) {
    const next = sel[i + 1]?.t ?? sel[i]!.t + 1 / 60;
    lines.push(`file '${sel[i]!.file}'`, `duration ${Math.max(0.001, next - sel[i]!.t).toFixed(6)}`);
  }
  lines.push(`file '${sel.at(-1)!.file}'`);
  const list = join(framesDir, 'frames.ffconcat');
  writeFileSync(list, lines.join('\n') + '\n');
  const scale = o.width ? `scale=${o.width}:-2:flags=lanczos,` : '';
  const r = spawnSync(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', `fps=${o.fps ?? 60},${scale}pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow',
      ...(o.kbps ? ['-b:v', `${o.kbps}k`, '-maxrate', `${Math.round(o.kbps * 1.4)}k`, '-bufsize', `${o.kbps * 2}k`] : ['-crf', String(o.crf ?? 14)]),
      '-an', '-movflags', '+faststart', out,
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error('ffmpeg encode failed');
}

// ------------------------------------------------------------------ local SpacetimeDB

/**
 * A local SpacetimeDB on :3000 (started if none runs; killAll() stops it) with the module freshly
 * published to `db`, data wiped. LOCAL only, and never the game's own database name.
 */
export async function freshLocalDb(db: string, log: (m: string) => void) {
  if (db === 'prompt-wars-63xhe') throw new Error('refusing to wipe prompt-wars-63xhe: pick a dedicated database for captures');
  if (!(await httpOk('http://127.0.0.1:3000/v1/ping'))) {
    log('starting local SpacetimeDB ...');
    children.push(spawn('spacetime', ['start'], { env, detached: true, stdio: 'ignore' }));
    await waitHttp('http://127.0.0.1:3000/v1/ping', 30_000, 'SpacetimeDB');
  }
  const serverDir = join(repoDir, 'server');
  log(`publishing the module to a fresh local database ${db} ...`);
  if (spawnSync('node', ['scripts/sync-catalog.mjs'], { cwd: serverDir, env, stdio: 'ignore' }).status !== 0) throw new Error('sync-catalog failed');
  const pub = spawnSync('spacetime', ['publish', '--server', 'local', '--module-path', '.', db, '--delete-data', '--yes'], { cwd: serverDir, env, stdio: 'ignore' });
  if (pub.status !== 0) throw new Error('spacetime publish (local) failed');
}
