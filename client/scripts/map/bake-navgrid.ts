#!/usr/bin/env node
/**
 * Bake a walkable nav grid for a processed collision GLB, headlessly (no browser).
 *
 *   node client/scripts/map/bake-navgrid.ts <collision.glb> <out.nav.gz> \
 *     --min -446,-258 --max 412,240 --cell 0.5 --seed 70,-60
 *
 * For every column it casts down through every surface (so gate passages and arcades under a
 * floor count), keeps upward-facing floors the player capsule fits on, then flood-fills from
 * `--seed` across neighbours whose height differs by at most a stair step. Output is gzip'd
 * Int16 floor heights in centimetres, row-major (z rows, x columns), NAV_BLOCKED where unreachable.
 * The grid's origin / size / cell go in the TS header the client imports (printed on stdout).
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

import RAPIER from '@dimforge/rapier3d-compat';

const NAV_BLOCKED = -32768;
/** highest floor considered (wall walks / roofs above are ignored) */
const TOP = 60;
/** a neighbour within this height difference is reachable (Rapier autostep is 0.4 m) */
const MAX_STEP = 0.42;
/** capsule clearance test: bottom lifted this far off the floor (slopes, stair noses) */
const LIFT = 0.35;
const CAP_R = 0.3;
const CAP_HALF = 0.45;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { min: { type: 'string' }, max: { type: 'string' }, cell: { type: 'string' }, seed: { type: 'string' } },
});
const [glbPath, outPath] = positionals;
if (!glbPath || !outPath || !values.min || !values.max || !values.seed) {
  console.error('usage: node bake-navgrid.ts <collision.glb> <out.nav.gz> --min x,z --max x,z --seed x,z [--cell 0.5]');
  process.exit(1);
}
const pair = (s: string) => s.split(',').map(Number) as [number, number];
const [minX, minZ] = pair(values.min);
const [maxX, maxZ] = pair(values.max);
const [seedX, seedZ] = pair(values.seed);
const cell = Number(values.cell ?? 0.5) || 0.5;
const W = Math.ceil((maxX - minX) / cell);
const H = Math.ceil((maxZ - minZ) / cell);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(glbPath);
const positions: number[] = [];
const indices: number[] = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const base = positions.length / 3;
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      positions.push(
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
      );
    }
    const idx = prim.getIndices()?.getArray();
    if (idx) for (let i = 0; i < idx.length; i++) indices.push(idx[i]! + base);
    else for (let i = 0; i < pos.getCount(); i++) indices.push(base + i);
  }
}

// the compat build (wasm inlined) loads in Node; the client's ESM-wasm build does not
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
world.createCollider(
  RAPIER.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(indices), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES),
);
world.step();
console.error(`[navgrid] ${indices.length / 3} tris, grid ${W}x${H} @ ${cell} m`);

/**
 * Inside a hollow, single-sided shell (the hills are just a surface over the base plane) the
 * player would walk on hidden ground, seeing the back-face-culled hill from inside. There, the
 * first thing above is the back of a triangle (a real ceiling shows its front) AND every
 * horizontal ray hits a back face too. A gate passage under a single-sided roof opens at both
 * ends, so it passes. For a trimesh, Rapier's ray featureId is 0 for a front face, 1 for a back face.
 */
const backHit = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number) => {
  const hit = world.castRayAndGetNormal(new RAPIER.Ray(o, d), max, false);
  return !!hit && hit.featureId === 1;
};
const underShell = (x: number, y: number, z: number) => {
  if (!backHit({ x, y: y + 0.05, z }, { x: 0, y: 1, z: 0 }, 200)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (!backHit({ x, y: y + 1, z }, { x: Math.cos(a), y: 0, z: Math.sin(a) }, 80)) return false;
  }
  return true;
};

const capsule = new RAPIER.Capsule(CAP_HALF, CAP_R);
const rot = { x: 0, y: 0, z: 0, w: 1 };
const fits = (x: number, y: number, z: number) =>
  !world.intersectionWithShape({ x, y: y + LIFT + CAP_R + CAP_HALF, z }, rot, capsule);

// ---- every standable floor per column (up to 4 layers) ----
const LAYERS = 4;
const floors = new Float32Array(W * H * LAYERS).fill(NaN);
const t0 = Date.now();
for (let j = 0; j < H; j++) {
  const z = minZ + (j + 0.5) * cell;
  for (let i = 0; i < W; i++) {
    const x = minX + (i + 0.5) * cell;
    let y = TOP;
    let n = 0;
    for (let guard = 0; guard < 12 && n < LAYERS; guard++) {
      const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }), y + 10, false);
      if (!hit) break;
      const hy = y - hit.timeOfImpact;
      if (hit.normal.y > 0.7 && fits(x, hy, z) && !underShell(x, hy, z)) floors[(j * W + i) * LAYERS + n++] = hy;
      y = hy - 0.05;
    }
  }
  if (j % 100 === 0) console.error(`[navgrid] row ${j}/${H} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// ---- flood fill from the seed over stair-step neighbours ----
const out = new Int16Array(W * H).fill(NAV_BLOCKED);
const si = Math.floor((seedX - minX) / cell);
const sj = Math.floor((seedZ - minZ) / cell);
let seedLayer = -1;
for (let l = 0; l < LAYERS; l++) {
  const h = floors[(sj * W + si) * LAYERS + l];
  if (!Number.isNaN(h) && (seedLayer < 0 || h < floors[(sj * W + si) * LAYERS + seedLayer])) seedLayer = l;
}
if (seedLayer < 0) throw new Error(`seed ${seedX},${seedZ} is not standable`);
const queue = new Int32Array(W * H);
let qh = 0;
let qt = 0;
out[sj * W + si] = Math.round(floors[(sj * W + si) * LAYERS + seedLayer] * 100);
queue[qt++] = sj * W + si;
let reached = 0;
while (qh < qt) {
  const c = queue[qh++];
  reached++;
  const h = out[c] / 100;
  const ci = c % W;
  const cj = (c - ci) / W;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = ci + di;
    const nj = cj + dj;
    if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
    const nc = nj * W + ni;
    if (out[nc] !== NAV_BLOCKED) continue;
    // the closest layer in height (an underpass and the bridge above it stay apart)
    let best = NaN;
    for (let l = 0; l < LAYERS; l++) {
      const nh = floors[nc * LAYERS + l];
      if (!Number.isNaN(nh) && Math.abs(nh - h) <= MAX_STEP && (Number.isNaN(best) || Math.abs(nh - h) < Math.abs(best - h))) best = nh;
    }
    if (Number.isNaN(best)) continue;
    out[nc] = Math.round(best * 100);
    queue[qt++] = nc;
  }
}

const gz = gzipSync(Buffer.from(out.buffer), { level: 9 });
writeFileSync(outPath, gz);
console.error(`[navgrid] ${reached} reachable cells (${((reached * cell * cell) / 1e4).toFixed(1)} ha), ${(gz.length / 1024).toFixed(0)} KB -> ${outPath}`);
console.log(JSON.stringify({ minX, minZ, cell, width: W, height: H }));
