#!/usr/bin/env node
// Leak soak test: plays the game OFFLINE (bots, default venue map) for a while, continuously firing,
// swapping weapons and dying / respawning, and samples GPU + heap counters every ~10 s. Fails
// (exit 1) when GPU resources / scene objects / JS heap keep growing after warm-up.
//
//   node e2e/soak.mjs                       starts its own Vite dev server on SOAK_PORT (5191)
//   SOAK_URL=http://localhost:5181 node e2e/soak.mjs    use a server that's already running
//
// env:
//   SOAK_MS        duration (default 240000 = 4 min)
//   SOAK_SAMPLE_MS sample interval (default 10000)
//   SOAK_PORT      dev server port when starting one (default 5191)
//   SOAK_MAP       map param (default: none = the default venue; falls back to testmap if it fails)
//   SOAK_BOTS      offline bots (default 3)
//   SOAK_GPU=1     host GPU (Metal via ANGLE) instead of SwiftShader (headless default)
//   SOAK_HEADED=1  show the browser
//   SOAK_OUT       write the samples as JSON to this file
//
// Verdict: average of the last 3 samples vs samples 3-5 (after warm-up). FAIL if geometries /
// textures / programs / scene objects grow by more than max(+20, 10%), or the heap by more than 30%.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, '..');
const DURATION = Number(process.env.SOAK_MS ?? 240_000);
const SAMPLE_MS = Number(process.env.SOAK_SAMPLE_MS ?? 10_000);
const PORT = Number(process.env.SOAK_PORT ?? 5191);
const BOTS = Number(process.env.SOAK_BOTS ?? 3);
const GPU = process.env.SOAK_GPU === '1';
const log = (...a) => console.log('[soak]', ...a);

/** same lookup as playwright.config.ts: Playwright's chromium, else a cached Chrome for Testing */
function chromiumPath() {
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

async function up(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

let vite;
async function startServer() {
  if (process.env.SOAK_URL) return process.env.SOAK_URL.replace(/\/$/, '');
  const base = `http://localhost:${PORT}`;
  if (await up(base)) {
    log(`using the server already on ${base}`);
    return base;
  }
  log(`starting vite on :${PORT} ...`);
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: clientDir,
    env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' },
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 120 && !(await up(base)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up(base))) throw new Error(`vite did not come up on ${base}`);
  return base;
}

function stopServer() {
  if (vite?.pid) {
    try {
      process.kill(-vite.pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
}

async function openGame(browser, base, map) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('crash', () => errors.push('PAGE CRASHED'));
  // why a page reloaded: dev server HMR / dep optimization, or the game's own fatal / GPU-loss reload
  page.on('console', (m) => {
    const t = m.text();
    if (/\[vite\]|fatal|context|Graphics|reload/i.test(t)) log(`console.${m.type()}: ${t.slice(0, 200)}`);
  });
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) log(`navigated: ${f.url()}`);
  });
  const p = new URLSearchParams({ offline: '1', e2e: '1', fresh: '1', bots: String(BOTS), name: 'Soak' });
  if (map) p.set('map', map);
  await page.goto(`${base}/?${p}`);
  await page.waitForFunction(
    () => {
      if (window.__gameError) throw new Error(window.__gameError);
      const s = window.__game?.getState?.();
      return !!s && s.ready && !!s.weaponId;
    },
    null,
    { timeout: 180_000, polling: 250 },
  );
  return { ctx, page, errors };
}

/** page-side driver: aim at bots + fire, swap weapons, die + respawn (runs on its own timers) */
function installDriver() {
  const g = window.__game;
  const st = { shots: 0, swaps: 0, botSwaps: 0, deaths: 0, respawns: 0, errors: 0, lastErr: '' };
  window.__soak = st;
  let wi = 0;
  let botI = 0;
  const guard = (fn) => () => {
    try {
      fn();
    } catch (e) {
      st.errors++;
      st.lastErr = String(e?.message ?? e);
    }
  };
  g.setPerfectAim(false);
  // fire: aim at a bot (hits -> damage numbers, kills, status fx) and shoot / swing
  const fire = setInterval(
    guard(() => {
      const s = g.getState();
      if (!s.alive) return;
      const bots = s.playersSeen.filter((p) => p.alive);
      if (bots.length) g.aimAt(bots[botI++ % bots.length].id);
      if (s.melee) g.meleeSwing(Math.random() < 0.3 ? 1 : 0);
      else if (g.fireOnce()) st.shots++;
      if (s.ammo <= 0 && !s.melee) g.reload();
    }),
    120,
  );
  // swap weapons through every sample (built-in kit, library parts, melee samples once loaded)
  const swap = setInterval(
    guard(() => {
      if (!g.getState().alive) return;
      const n = g.sampleCount();
      g.equipSample(wi++ % n);
      st.swaps++;
    }),
    1500,
  );
  // offline bots: swap their weapons (remote weapon models) and make one leave + rejoin
  let bi = 0;
  const bots = setInterval(
    guard(() => {
      if (g.botsCycle(++bi % 3 === 0)) st.botSwaps++;
    }),
    2000,
  );
  // die + respawn
  // (deadline kept in the counters: the driver is reinstalled around every sample)
  st.nextDeathAt = Date.now() + 6000;
  const die = setInterval(
    guard(() => {
      if (Date.now() < st.nextDeathAt || !g.getState().alive) return;
      st.nextDeathAt = Date.now() + 12_000;
      g.killSelf();
      st.deaths++;
      setTimeout(() => {
        g.respawnNow().then(
          (ok) => ok && st.respawns++,
          (e) => {
            st.errors++;
            st.lastErr = String(e?.message ?? e);
          },
        );
      }, 1200);
    }),
    500,
  );
  window.__soakStop = () => [fire, swap, bots, die].forEach(clearInterval);
}

/**
 * Put the game in the same state before every sample, so the counters compare like with like:
 * driver paused, alive, sample weapon 0 held, every bot holding sample 1, transient effects expired.
 */
async function settle(page) {
  await page.evaluate(async () => {
    window.__soakStop?.();
    const g = window.__game;
    await g.respawnNow().catch(() => {});
    g.equipSample(0);
    g.botsCycle(false, 1);
    await new Promise((r) => setTimeout(r, 2000));
  });
}

async function sample(page, cdp, t0) {
  const alive = await page.evaluate(() => !!(window.__soak && window.__game));
  if (!alive) throw new Error('the page reloaded mid-run (dev server re-optimized deps?): rerun');
  await settle(page);
  // force a full GC first so the heap number is the live set, not garbage awaiting collection
  try {
    await cdp.send('HeapProfiler.collectGarbage');
  } catch {
    /* not available */
  }
  const m = await page.evaluate(() => (window.__soak && window.__game ? { ...window.__game.memStats(), soak: { ...window.__soak } } : null));
  if (!m) throw new Error('the page reloaded mid-run (dev server re-optimized deps?): rerun');
  // resume the driver (fresh timers; counters carry on)
  await page.evaluate(installDriver);
  await page.evaluate((st) => Object.assign(window.__soak, st), m.soak);
  return { t: Math.round((Date.now() - t0) / 1000), ...m };
}

const fmtMB = (b) => (b == null ? '-' : (b / 1048576).toFixed(1));
function row(s) {
  return {
    t: s.t,
    geo: s.geometries,
    tex: s.textures,
    prog: s.programs,
    heapMB: fmtMB(s.jsHeap),
    scene: s.sceneObjects,
    view: s.viewObjects,
    meshes: s.sceneMeshes,
    design: `${s.designCache.entries}/${s.designCache.refs}`,
    proj: s.projectiles,
    fx: s.effects,
    parts: s.particles,
    bodies: s.rapierBodies,
    colls: s.rapierColliders,
    dom: s.domNodes,
    killLog: s.killLog,
    shots: s.soak.shots,
    swaps: s.soak.swaps,
    botSw: s.soak.botSwaps,
    deaths: s.soak.deaths,
  };
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function verdict(samples) {
  if (samples.length < 8) return { ok: false, lines: [`only ${samples.length} samples: need >= 8 (raise SOAK_MS)`] };
  const base = samples.slice(2, 5);
  const last = samples.slice(-3);
  const checks = [
    ['geometries', (s) => s.geometries, 'abs'],
    ['textures', (s) => s.textures, 'abs'],
    ['programs', (s) => s.programs, 'abs'],
    ['sceneObjects', (s) => s.sceneObjects, 'abs'],
    ['viewObjects', (s) => s.viewObjects, 'abs'],
    ['rapierColliders', (s) => s.rapierColliders, 'abs'],
    ['jsHeap', (s) => s.jsHeap, 'heap'],
  ];
  let ok = true;
  const lines = [];
  for (const [name, get, kind] of checks) {
    if (base.some((s) => get(s) == null)) {
      lines.push(`  ${name.padEnd(16)} n/a`);
      continue;
    }
    const b = avg(base.map(get));
    const l = avg(last.map(get));
    const d = l - b;
    const pct = b > 0 ? (d / b) * 100 : 0;
    const bad = kind === 'heap' ? pct > 30 : d > Math.max(20, b * 0.1);
    if (bad) ok = false;
    const show = (v) => (kind === 'heap' ? `${fmtMB(v)} MB` : v.toFixed(1));
    lines.push(`  ${bad ? 'FAIL' : 'ok  '} ${name.padEnd(16)} ${show(b).padStart(10)} -> ${show(l).padStart(10)}  (${d >= 0 ? '+' : ''}${kind === 'heap' ? fmtMB(d) + ' MB' : d.toFixed(1)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
  }
  return { ok, lines };
}

async function main() {
  const base = await startServer();
  const executablePath = chromiumPath();
  const browser = await chromium.launch({
    headless: process.env.SOAK_HEADED !== '1',
    executablePath,
    args: [
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
      ...(GPU
        ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal']
        : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']),
    ],
  });
  let game;
  const map = process.env.SOAK_MAP;
  if (vite) {
    // a fresh dev server optimizes lazily discovered deps (parts library, map loaders) on first use
    // and then full-reloads the page: load the game once and let it settle before measuring
    log('warm-up load (dev server dependency optimization) ...');
    try {
      const w = await openGame(browser, base, map);
      await w.page.evaluate(() => window.__game.respawnNow());
      // exercise every lazy path once (weapons, firing, death screen, respawn), then idle
      await w.page.evaluate(installDriver);
      await w.page.waitForTimeout(4000);
      await w.page.evaluate(() => window.__game.killSelf());
      await w.page.waitForTimeout(2500);
      await w.page.evaluate(() => window.__game.respawnNow()).catch(() => {});
      await w.page.waitForTimeout(12_000);
      await w.ctx.close();
    } catch (e) {
      log(`warm-up failed (${e.message.split('\n')[0]}), continuing`);
    }
  }
  try {
    game = await openGame(browser, base, map);
  } catch (e) {
    if (map === 'testmap') throw e;
    log(`default map failed to load (${e.message.split('\n')[0]}): falling back to testmap`);
    game = await openGame(browser, base, 'testmap');
  }
  const { page, errors } = game;
  const mapLog = await page.evaluate(() => window.game?.map?.id ?? '?');
  log(`map: ${mapLog}, bots: ${BOTS}, duration ${DURATION / 1000}s, sample every ${SAMPLE_MS / 1000}s, ${GPU ? 'host GPU' : 'SwiftShader'}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable').catch(() => {});

  let t0 = 0;
  let samples = [];
  let restarts = 0;
  const begin = async () => {
    // offline new players may sit on the landing screen: deploy
    await page.evaluate(() => window.__game.respawnNow());
    await page.evaluate(installDriver);
    t0 = Date.now();
    samples = [await sample(page, cdp, t0)];
    log(`t=0 geo=${samples[0].geometries} tex=${samples[0].textures} prog=${samples[0].programs} heap=${fmtMB(samples[0].jsHeap)}MB`);
  };
  await begin();
  while (Date.now() - t0 < DURATION) {
    const next = t0 + samples.length * SAMPLE_MS;
    await page.waitForTimeout(Math.max(0, next - Date.now()));
    let s;
    try {
      s = await sample(page, cdp, t0);
    } catch (e) {
      // dev server full reload (late dependency optimization): wait for the game and start over
      if (!/reloaded|memStats|context was destroyed/i.test(String(e?.message)) || ++restarts > 3) throw e;
      log(`page reloaded at t=${Math.round((Date.now() - t0) / 1000)}s: restarting the measurement (${restarts}/3)`);
      await page.waitForFunction(() => window.__game?.getState?.().ready && !!window.__game.getState().weaponId, null, { timeout: 180_000, polling: 250 });
      await begin();
      continue;
    }
    samples.push(s);
    log(`t=${s.t}s geo=${s.geometries} tex=${s.textures} prog=${s.programs} heap=${fmtMB(s.jsHeap)}MB scene=${s.sceneObjects} shots=${s.soak.shots} swaps=${s.soak.swaps} deaths=${s.soak.deaths} errs=${s.soak.errors}`);
  }
  await page.evaluate(() => window.__soakStop?.());
  console.table(samples.map(row));
  const v = verdict(samples);
  const last = samples.at(-1).soak;
  console.log(`\nactivity: ${last.shots} shots, ${last.swaps} weapon swaps, ${last.botSwaps} bot weapon swaps (1/3 with a leave + rejoin), ${last.deaths} deaths / ${last.respawns} respawns, ${last.errors} driver errors${last.lastErr ? ` (last: ${last.lastErr})` : ''}`);
  if (errors.length) console.log(`page errors (${errors.length}, first 5):\n  ${errors.slice(0, 5).join('\n  ')}`);
  console.log(`\nlast 3 vs samples 3-5:\n${v.lines.join('\n')}`);
  const crashed = errors.includes('PAGE CRASHED');
  if (crashed) v.ok = false;
  console.log(`\nVERDICT: ${v.ok ? 'PASS (flat)' : crashed ? 'FAIL (page crashed)' : 'FAIL (growth)'}`);
  if (process.env.SOAK_OUT) writeFileSync(process.env.SOAK_OUT, JSON.stringify({ map: mapLog, samples }, null, 2));
  await browser.close();
  return v.ok ? 0 : 1;
}

main()
  .then((code) => {
    stopServer();
    process.exit(code);
  })
  .catch((err) => {
    console.error('[soak]', err?.stack ?? err);
    stopServer();
    process.exit(1);
  });
