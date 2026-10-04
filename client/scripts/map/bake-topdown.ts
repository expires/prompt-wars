#!/usr/bin/env node
/**
 * Bake a hill-shaded top-down map image of a processed visual GLB (the explorer's map screen).
 *
 *   node client/scripts/map/bake-topdown.ts <visual.glb> <out.png> --min -446,-258 --max 412,240 [--ppm 2]
 *
 * Rasterises every triangle's top surface into a height + material grid (world x -> image x,
 * world z -> image y), then colours it by material name with a light from the north-west.
 * Same bounds as bake-navgrid.ts so the client maps world <-> pixels with one transform.
 */
import { parseArgs } from 'node:util';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { min: { type: 'string' }, max: { type: 'string' }, ppm: { type: 'string' } },
});
const [glbPath, outPath] = positionals;
if (!glbPath || !outPath || !values.min || !values.max) {
  console.error('usage: node bake-topdown.ts <visual.glb> <out.png> --min x,z --max x,z [--ppm 2]');
  process.exit(1);
}
const pair = (s: string) => s.split(',').map(Number) as [number, number];
const [minX, minZ] = pair(values.min);
const [maxX, maxZ] = pair(values.max);
const ppm = Number(values.ppm ?? 2) || 2;
const W = Math.round((maxX - minX) * ppm);
const H = Math.round((maxZ - minZ) * ppm);

/** muted, map-like colours per material name (anything else: stone grey) */
const PALETTE: Record<string, [number, number, number]> = {
  roof: [196, 98, 74],
  roof2: [206, 128, 92],
  roof3: [176, 92, 70],
  roof4: [150, 74, 66],
  brick: [170, 96, 78],
  stone1: [204, 198, 186],
  stone2: [172, 168, 158],
  glass1: [150, 180, 200],
  metal1: [120, 128, 140],
  wood1: [140, 104, 72],
  gold: [232, 190, 70],
  cobble: [236, 220, 178],
  ground: [222, 208, 178],
  grass: [138, 176, 110],
  water: [110, 158, 206],
};

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(glbPath);
const heights = new Float32Array(W * H).fill(-1e9);
const mats = new Uint8Array(W * H).fill(255);
const names: string[] = [];

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? '';
    let mi = names.indexOf(name);
    if (mi < 0) mi = names.push(name) - 1;
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const n = pos.getCount();
    const P = new Float32Array(n * 3);
    const v = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      pos.getElement(i, v);
      P[i * 3] = (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] - minX) * ppm;
      P[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
      P[i * 3 + 2] = (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] - minZ) * ppm;
    }
    const idx = prim.getIndices()?.getArray();
    const count = idx ? idx.length : n;
    for (let t = 0; t < count; t += 3) {
      const a = idx ? idx[t]! : t;
      const b = idx ? idx[t + 1]! : t + 1;
      const c = idx ? idx[t + 2]! : t + 2;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue; // vertical: no top-down footprint
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const z0 = Math.max(0, Math.floor(Math.min(az, bz, cz)));
      const z1 = Math.min(H - 1, Math.ceil(Math.max(az, bz, cz)));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const pz = z + 0.5;
          const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
          const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
          const y = w0 * ay + w1 * by + w2 * cy;
          const k = z * W + x;
          if (y > heights[k]) {
            heights[k] = y;
            mats[k] = mi;
          }
        }
      }
    }
  }
}

// colour + hill shade (light from the north-west of the image, i.e. -x / -z)
const img = Buffer.alloc(W * H * 3);
const hAt = (x: number, z: number) => heights[Math.min(H - 1, Math.max(0, z)) * W + Math.min(W - 1, Math.max(0, x))];
for (let z = 0; z < H; z++) {
  for (let x = 0; x < W; x++) {
    const k = z * W + x;
    const col = PALETTE[names[mats[k]] ?? ''] ?? (heights[k] < -1e8 ? PALETTE.grass : [180, 176, 166]);
    const slope = (hAt(x - 1, z - 1) - hAt(x + 1, z + 1)) * ppm * 0.5;
    const shade = Math.max(0.55, Math.min(1.25, 1 - slope * 0.12));
    for (let ch = 0; ch < 3; ch++) img[k * 3 + ch] = Math.max(0, Math.min(255, Math.round(col[ch] * shade)));
  }
}
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9, palette: true, colors: 96 }).toFile(outPath);
console.error(`[topdown] ${W}x${H} @ ${ppm} px/m -> ${outPath}`);
