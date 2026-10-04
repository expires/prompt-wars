// Arena establishing shot (tauron-remake) through the real game render, for slides, over live bot
// fights, in one continuous drone move: a wide, high arc around the bowl (FOV 72) that eases into
// a push-in, descending and closing on the stage (FOV 55), ending medium-wide on the fighters and
// the HACK YEAH sign.
//
//   pnpm video:flyover   -> video/out/arena-flyover.mp4 (1920x1080 30 fps H.264, yuv420p, faststart,
//                           no audio, < 4 MB)
//
// Live action: scripts/fighters.ts runs 8 real bot clients against a fresh LOCAL SpacetimeDB
// (fire / ice / shock / poison weapons, rockets, a grenade lobber, a bubble stream), dueling in
// view; the spectator page is a normal client of the same database that never deploys.
//
// Camera: no client changes. The script swaps game.rc.render for one that places the camera on
// the orbit at the current time and draws only the world (no viewmodel pass); every DOM overlay
// (HUD, crosshair, menus) is hidden.
//
// Safety check before capturing (path sampled every 0.1 s):
//   - Rapier (the map's colliders): a 1.5 m ball must not intersect anything, plus the sight line
//     to the target must be clear up to the stage deck (the subject; truss towers count). Candidate orbits
//     (end azimuth / direction / start height / radius) are searched until one passes.
//   - three.js meshes (also the visual-only roof, truss frame, speaker arrays) for the chosen
//     orbit: 14 rays of 1.5 m around the camera + the sight line. Instanced meshes (the seats) are
//     skipped: they sit beyond the stored-seat wall (>= 23 m), which Rapier already covers.
//   The minimum clearance (Rapier point projection) is logged.
//
// Flags: --dur <s> (default 14), --max-mb <n> (default 4), --headless, --db <name>

import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { startFighters } from './fighters';
import { VIEWPORT, chromiumPath, clientDir, encode, freshLocalDb, gpuArgs, killAll, outDir, sleep, startScreencast, startVite, videoDir } from './lib';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : d;
};
const DUR = Number(opt('dur', '14'));
const MAX_MB = Number(opt('max-mb', '4'));
const HEADLESS = argv.includes('--headless');
const DB = opt('db', 'prompt-wars-video');
const PORT = Number(process.env.VIDEO_VITE_PORT ?? 5193);
const framesDir = join(videoDir, '.capture-tmp');
const log = (m: string) => console.log(`[flyover] ${m}`);

/**
 * Bounds (shared/src/tauronRemake): the floor is a rounded rectangle |x| < 36, |z| < 23 whose edge
 * is the stored-seat wall (the stands rise behind it): nearest inner face 23 m from the centre.
 * Stage deck |x| < 6, |z| < 4 (1.2 m), truss towers + speaker stacks at (±8, ±6.6), LED frame
 * overhead at ~10.5-10.9 m; desk rows 0.75 m high; roof apex 36 m.
 *
 * Two beats in one continuous move:
 *   1. wide establishing arc (first ~45 %): high in the bowl near the lights, large radius, FOV 72,
 *      looking at a point below the stage so the floor, desk rows and the 360 stands all read;
 *   2. push-in: descends and closes the radius onto the stage, the look-at blends up onto the
 *      deck and the FOV narrows to 55, ending medium-wide on the fights on and around the stage.
 */
interface Shot {
  /** wide beat: radius, height, FOV, look-at */
  rW: number;
  yW: number;
  fovW: number;
  lookW: number[];
  /** end of the push-in */
  rP: number;
  yP: number;
  fovP: number;
  lookP: number[];
  /** azimuth (rad; x = r cos a, z = r sin a) at the start / end */
  a0: number;
  a1: number;
}

/** sight-line checks aim at the stage (the subject) whatever the look-at blend */
const TARGET = [0, 2, 0];
const deg = Math.PI / 180;

/** candidates, best first: end on the east side looking west at the stage (the HACK YEAH sign
 *  reads correctly from there; from the west its letter blocks are mirrored) */
function candidates(): Shot[] {
  const out: Shot[] = [];
  for (const end of [8, -8, 20, -20, 0])
    for (const dir of [1, -1])
      for (const sweep of [120, 105])
        for (const yW of [24, 22, 20])
          for (const rW of [19, 17.5, 16])
            out.push({ rW, yW, fovW: 72, lookW: [0, -2, 0], rP: 11, yP: 5.5, fovP: 55, lookP: [0, 1.4, 0], a0: (end - dir * sweep) * deg, a1: end * deg });
  return out;
}

/**
 * The subject: the stage deck and what stands on it (HACK YEAH sign, health pack: |x| <= 6.5,
 * |z| <= 4.5) and the LED truss frame overhead (y >= 10 over the truss footprint): a descending
 * camera has to look past that frame at some point. The towers / speaker stacks at the corners
 * (below 10 m) are outside it and count as obstructions.
 */
const IN_STAGE = `(x, y, z) => (Math.abs(x) <= 6.5 && Math.abs(z) <= 4.5) || (y >= 10 && Math.abs(x) <= 8.8 && Math.abs(z) <= 7.2)`;

/** in-page: { p, look, fov } at normalised time u */
const POSE_FN = `(o, u) => {
  // azimuth: constant angular speed with eased ends
  const lin = 0.55 * u + 0.45 * (0.5 - 0.5 * Math.cos(Math.PI * u));
  const a = o.a0 + (o.a1 - o.a0) * lin;
  // push-in blend: 0 through the wide beat, smoothstep to 1 by the end
  const k = Math.min(1, Math.max(0, (u - 0.42) / 0.58));
  const b = k * k * (3 - 2 * k);
  const mix = (w, p) => w + (p - w) * b;
  const r = mix(o.rW, o.rP), y = mix(o.yW, o.yP);
  return { p: [r * Math.cos(a), y, r * Math.sin(a)], look: [0, 1, 2].map((i) => mix(o.lookW[i], o.lookP[i])), fov: mix(o.fovW, o.fovP) };
}`;

interface Check {
  ok: boolean;
  minClear: number;
  minAt: number;
  hits: string[];
}

/** Rapier search over the candidates: the first fully clear orbit (+ its clearance) */
async function searchRapier(page: Page, cands: Shot[], skip: number): Promise<{ idx: number; check: Check } | null> {
  return page.evaluate(`(() => {
    const cands = ${JSON.stringify(cands)}, T = ${JSON.stringify(TARGET)}, dur = ${DUR}, skip = ${skip};
    const pose = ${POSE_FN}, inStage = ${IN_STAGE};
    const { RAPIER: R, world } = window.game.physics;
    const FLAGS = 2 | 4 | 8; // skip kinematic / dynamic bodies (players) and sensors
    const ball = new R.Ball(1.5), rot = { x: 0, y: 0, z: 0, w: 1 };
    for (let k = skip; k < cands.length; k++) {
      const o = cands[k];
      let ok = true, minClear = Infinity, minAt = 0;
      const hits = [];
      for (let s = 0; s <= dur + 1e-6 && ok; s += 0.1) {
        const [x, y, z] = pose(o, Math.min(1, s / dur)).p;
        const c = { x, y, z };
        if (world.intersectionWithShape(c, rot, ball, FLAGS)) { ok = false; hits.push('ball@' + s.toFixed(1)); break; }
        const pr = world.projectPoint(c, true, FLAGS);
        if (pr) { const d = Math.hypot(pr.point.x - x, pr.point.y - y, pr.point.z - z); if (d < minClear) { minClear = d; minAt = s; } }
        const v = { x: T[0] - x, y: T[1] - y, z: T[2] - z }, len = Math.hypot(v.x, v.y, v.z);
        const dir = { x: v.x / len, y: v.y / len, z: v.z / len };
        const hit = world.castRay(new R.Ray(c, dir), len, true, FLAGS);
        const toi = hit ? hit.timeOfImpact : 0;
        if (hit && !inStage(x + dir.x * toi, y + dir.y * toi, z + dir.z * toi)) { ok = false; hits.push('sight@' + s.toFixed(1)); }
      }
      if (ok) return { idx: k, check: { ok, minClear: +minClear.toFixed(2), minAt: +minAt.toFixed(1), hits } };
    }
    return null;
  })()`) as Promise<{ idx: number; check: Check } | null>;
}

/** three.js check of one orbit against the (non-instanced) scene meshes */
async function checkMeshes(page: Page, o: Shot): Promise<Check> {
  const threeUrl = `/@fs${join(clientDir, 'node_modules', 'three', 'build', 'three.module.js')}`;
  return page.evaluate(`(async () => {
    const THREE = (window.__THREE ??= await import(${JSON.stringify(threeUrl)}));
    const o = ${JSON.stringify(o)}, T = ${JSON.stringify(TARGET)}, dur = ${DUR};
    const pose = ${POSE_FN}, inStage = ${IN_STAGE};
    const scene = window.game.rc.scene;
    // world meshes: skip instanced (seats, beyond the wall) and anything under a player / bot root
    const isActor = (m) => { for (let p = m; p; p = p.parent) { const n = (p.name || '').toLowerCase(); if (n.includes('player') || n.includes('remote') || n.includes('ragdoll') || n.includes('projectile') || n.includes('fx')) return true; } return false; };
    const world = [];
    scene.traverse((m) => { if (m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh && m.visible && !isActor(m)) world.push(m); });
    const rc = new THREE.Raycaster();
    const dirs = [];
    for (let i = 0; i < 14; i++) { const t = Math.acos(1 - 2 * (i + 0.5) / 14), p = Math.PI * (1 + Math.sqrt(5)) * i; dirs.push(new THREE.Vector3(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p))); }
    let minClear = Infinity, minAt = 0;
    const hits = [];
    const tgt = new THREE.Vector3(...T);
    for (let s = 0, n = 0; s <= dur + 1e-6; s += 0.1, n++) {
      const c = new THREE.Vector3(...pose(o, Math.min(1, s / dur)).p);
      // the 1.5 m probe every 0.2 s (raycasts against the merged map meshes are costly); sight every 0.1 s
      if (n % 2 === 0) for (const d of dirs) {
        rc.set(c, d); rc.near = 0; rc.far = 3;
        const h = rc.intersectObjects(world, false)[0];
        if (h && h.distance < minClear) { minClear = h.distance; minAt = s; }
        if (h && h.distance < 1.5) hits.push('sphere@' + s.toFixed(1) + ':' + (h.object.name || h.object.type) + ':' + h.distance.toFixed(2));
      }
      const v = tgt.clone().sub(c), len = v.length();
      rc.set(c, v.normalize()); rc.near = 0; rc.far = len;
      const h = rc.intersectObjects(world, false).find((x) => !inStage(x.point.x, x.point.y, x.point.z));
      if (h) hits.push('sight@' + s.toFixed(1) + ':' + (h.object.name || h.object.type) + ':(' + h.point.x.toFixed(1) + ',' + h.point.y.toFixed(1) + ',' + h.point.z.toFixed(1) + ')');
    }
    return { ok: hits.length === 0, minClear: +minClear.toFixed(2), minAt: +minAt.toFixed(1), hits: hits.slice(0, 8), meshes: world.length };
  })()`) as Promise<Check>;
}

function rig(o: Shot) {
  return `(() => {
    const o = ${JSON.stringify(o)}, T = ${JSON.stringify(TARGET)}, dur = ${DUR};
    const pose = ${POSE_FN};
    const rc = window.game.rc;
    const cine = (window.__cine = { t0: null, start() { this.t0 = performance.now(); } });
    const lens = (cam, fov) => { if (Math.abs(cam.fov - fov) > 1e-4 || cam.near !== 0.1) { cam.fov = fov; cam.near = 0.1; cam.updateProjectionMatrix(); } };
    rc.renderer.domElement.classList.add('cine-canvas');
    if (!document.getElementById('cine-style')) {
      const st = document.createElement('style');
      st.id = 'cine-style';
      st.textContent = 'body * { visibility: hidden !important; } canvas.cine-canvas { visibility: visible !important; } body { cursor: none !important; }';
      document.head.append(st);
    }
    rc.render = function () {
      const u = cine.t0 === null ? 0 : Math.min(1, (performance.now() - cine.t0) / 1000 / dur);
      const q = pose(o, u), p = q.p, cam = rc.camera;
      lens(cam, q.fov);
      cam.position.set(p[0], p[1], p[2]);
      cam.up.set(0, 1, 0);
      cam.lookAt(q.look[0], q.look[1], q.look[2]);
      cam.updateMatrixWorld();
      rc.renderer.clear();
      rc.renderer.render(rc.scene, cam);
    };
    return true;
  })()`;
}

async function main() {
  await freshLocalDb(DB, log);
  const base = await startVite(PORT, 'http://127.0.0.1:9');
  const url = `${base}/?server=local&db=${DB}&e2e=1&fresh=1&quality=high&name=Spectator`;
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: chromiumPath(), args: gpuArgs(HEADLESS) });
  let fights: Awaited<ReturnType<typeof startFighters>> | null = null;
  try {
    const page = await (await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })).newPage();
    page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
    page.on('crash', () => log('PAGE CRASHED'));
    log(`opening ${url}`);
    await page.goto(url);
    await page.waitForFunction('(() => { const s = window.__game && window.__game.getState(); return !!s && s.ready && s.connected; })()', undefined, { timeout: 120_000, polling: 250 });
    await sleep(1500);

    // ---- camera path: Rapier search, then the mesh check on the winner
    const cands = candidates();
    let chosen: Shot | null = null;
    let clearance = { rapier: 0, mesh: 0 };
    let meshChecks = 0;
    for (let skip = 0; skip < cands.length && !chosen && meshChecks < 6; meshChecks++) {
      const found = await searchRapier(page, cands, skip);
      if (!found) break;
      const o = cands[found.idx]!;
      const m = await checkMeshes(page, o);
      const desc = `end ${(o.a1 / deg).toFixed(0)}deg, sweep ${((o.a1 - o.a0) / deg).toFixed(0)}deg, wide r ${o.rW} m y ${o.yW} m -> r ${o.rP} m y ${o.yP} m`;
      log(`candidate #${found.idx} (${desc}): rapier clear (min ${found.check.minClear} m), meshes ${m.ok ? 'clear' : 'HIT'} (min ${m.minClear} m)${m.ok ? '' : ' ' + m.hits.join(' ')}`);
      if (m.ok) {
        chosen = o;
        clearance = { rapier: found.check.minClear, mesh: m.minClear };
      } else skip = found.idx + 1;
    }
    if (!chosen) throw new Error('no collision-free orbit found');

    // ---- fights (warm up so duels are under way, a few deaths already happened)
    fights = await startFighters({ uri: 'ws://127.0.0.1:3000', db: DB, log: (m) => log(`bots: ${m}`) });
    await sleep(6000);
    log(`bots warmed up: ${fights.kills()} kills so far`);

    await page.evaluate(rig(chosen));
    await sleep(800);
    const cast = await startScreencast(page, 1, framesDir);
    await sleep(400);
    const k0 = fights.kills();
    const t0 = Date.now() / 1000;
    await page.evaluate('window.__cine.start()');
    await sleep(DUR * 1000 + 600);
    await cast.stop();
    const onCam = fights.kills() - k0;
    const fr = cast.frames.filter((f) => f.t >= t0);
    log(`screencast: ${fr.length} frames over ${(fr.at(-1)!.t - fr[0]!.t).toFixed(1)}s; ${onCam} kills during the shot`);
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, 'arena-flyover.mp4');
    const kbps = Math.floor((MAX_MB * 8000 * 0.92) / (DUR + 0.6));
    encode(cast.frames, out, framesDir, { from: t0, kbps, fps: 30 });
    let mb = statSync(out).size / 1e6;
    if (mb > MAX_MB) {
      log(`${mb.toFixed(1)} MB > ${MAX_MB} MB: re-encoding at 1600 wide`);
      encode(cast.frames, out, framesDir, { from: t0, kbps: Math.floor(kbps * 0.85), fps: 30, width: 1600 });
      mb = statSync(out).size / 1e6;
    }
    const o = chosen;
    log(`shot: end ${(o.a1 / deg).toFixed(0)}deg, ${(Math.abs(o.a1 - o.a0) / deg).toFixed(0)}deg over ${DUR}s, wide r ${o.rW} m y ${o.yW} m FOV ${o.fovW} -> r ${o.rP} m y ${o.yP} m FOV ${o.fovP}; min clearance ${clearance.rapier} m (colliders), ${clearance.mesh} m (meshes, 3 m probe)`);
    log(`done: ${out} (${mb.toFixed(2)} MB)`);
  } finally {
    fights?.stop();
    await browser.close().catch(() => {});
    killAll();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`[flyover] FAILED: ${(e as Error).stack ?? e}`);
    killAll();
    process.exit(1);
  },
);
