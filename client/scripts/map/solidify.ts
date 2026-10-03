#!/usr/bin/env node
/**
 * Solidify a scan's collision mesh: rebuild it as a watertight voxel shell so holes in the
 * photogrammetry can't be walked through.
 *
 *   node client/scripts/map/solidify.ts <in_collision.glb> <out_collision.glb> \
 *     [--pitch 0.6] [--close 1] [--tris 300000]
 *
 * Pipeline: rasterize the triangle surface into a voxel grid, morphologically close it
 * (dilate then erode) so gaps up to ~2*close*pitch metres are bridged, then emit only the
 * exposed cell faces as a single indexed triangle mesh. The result is a closed shell you can
 * collide against; the visual map is untouched, so texture holes stay cosmetic only.
 *
 * Feed it the *raw* collision GLB (from process-scan). Re-run process-scan first if you need
 * to regenerate the raw geometry.
 */
import { parseArgs } from 'node:util';

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    pitch: { type: 'string' },
    close: { type: 'string' },
    tris: { type: 'string' },
  },
});
const [inPath, outPath] = positionals;
if (!inPath || !outPath) {
  console.error('usage: node client/scripts/map/solidify.ts <in_collision.glb> <out_collision.glb> [--pitch 0.6] [--close 1] [--tris 300000]');
  process.exit(1);
}
const pitch = Number(values.pitch ?? 0.6) || 0.6;
const close = Math.max(1, Math.round(Number(values.close ?? 1) || 1));
const triBudget = Number(values.tris ?? 300000) || 300000;

// ---- read triangles -------------------------------------------------------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc: Document = await io.read(inPath);
const px: number[] = [];
const idx: number[] = [];
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')?.getArray();
    if (!pos) continue;
    const base = px.length / 3;
    for (let i = 0; i < pos.length; i++) px.push(pos[i]!);
    const src = prim.getIndices()?.getArray();
    if (src) for (let i = 0; i < src.length; i++) idx.push(src[i]! + base);
    else for (let i = 0; i < pos.length / 3; i++) idx.push(base + i);
  }
}
console.error(`[solidify] input ${idx.length / 3} tris`);

// ---- bounds + grid --------------------------------------------------------
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < px.length; i += 3) {
  if (px[i]! < minX) minX = px[i]!;
  if (px[i]! > maxX) maxX = px[i]!;
  if (px[i + 1]! < minY) minY = px[i + 1]!;
  if (px[i + 1]! > maxY) maxY = px[i + 1]!;
  if (px[i + 2]! < minZ) minZ = px[i + 2]!;
  if (px[i + 2]! > maxZ) maxZ = px[i + 2]!;
}
const pad = 2 * pitch;
minX -= pad; minY -= pad; minZ -= pad; maxX += pad; maxY += pad; maxZ += pad;
const nx = Math.ceil((maxX - minX) / pitch) + 1;
const ny = Math.ceil((maxY - minY) / pitch) + 1;
const nz = Math.ceil((maxZ - minZ) / pitch) + 1;
const N = nx * ny * nz;
console.error(`[solidify] grid ${nx}x${ny}x${nz} = ${(N / 1e6).toFixed(1)}M cells (pitch ${pitch})`);
const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
const occ = new Uint8Array(N);

// rasterize: sample each triangle densely enough to hit every traversed cell
const mark = (x: number, y: number, z: number) => {
  const ix = Math.floor((x - minX) / pitch);
  const iy = Math.floor((y - minY) / pitch);
  const iz = Math.floor((z - minZ) / pitch);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return;
  occ[at(ix, iy, iz)] = 1;
};
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
  const ax = px[a]!, ay = px[a + 1]!, az = px[a + 2]!;
  const bx = px[b]!, by = px[b + 1]!, bz = px[b + 2]!;
  const cx = px[c]!, cy = px[c + 1]!, cz = px[c + 2]!;
  const e1 = Math.hypot(bx - ax, by - ay, bz - az);
  const e2 = Math.hypot(cx - ax, cy - ay, cz - az);
  const n = Math.max(1, Math.ceil(Math.max(e1, e2) / (pitch * 0.5)));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    for (let j = 0; j <= n - i; j++) {
      const v = j / n;
      mark(ax + (bx - ax) * u + (cx - ax) * v, ay + (by - ay) * u + (cy - ay) * v, az + (bz - az) * u + (cz - az) * v);
    }
  }
}

// ---- morphological closing: dilate then erode ------------------------------
const NEI = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function dilate(src: Uint8Array, rounds: number): Uint8Array {
  let cur = src;
  for (let r = 0; r < rounds; r++) {
    const next = Uint8Array.from(cur);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          if (!cur[at(x, y, z)]) continue;
          for (const [dx, dy, dz] of NEI) {
            const jx = x + dx, jy = y + dy, jz = z + dz;
            if (jx >= 0 && jy >= 0 && jz >= 0 && jx < nx && jy < ny && jz < nz) next[at(jx, jy, jz)] = 1;
          }
        }
    cur = next;
  }
  return cur;
}
function erode(src: Uint8Array, rounds: number): Uint8Array {
  let cur = src;
  for (let r = 0; r < rounds; r++) {
    const next = Uint8Array.from(cur);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          if (!cur[at(x, y, z)]) continue;
          for (const [dx, dy, dz] of NEI) {
            const jx = x + dx, jy = y + dy, jz = z + dz;
            if (jx < 0 || jy < 0 || jz < 0 || jx >= nx || jy >= ny || jz >= nz || !cur[at(jx, jy, jz)]) {
              next[at(x, y, z)] = 0;
              break;
            }
          }
        }
    cur = next;
  }
  return cur;
}
console.error(`[solidify] closing x${close}`);
const solid = erode(dilate(occ, close), close);

// ---- extract exposed faces with deduped corners ----------------------------
const cornerId = new Int32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(-1);
const verts: number[] = [];
const faces: number[] = [];
const corner = (x: number, y: number, z: number) => {
  const k = x + (nx + 1) * (y + (ny + 1) * z);
  let id = cornerId[k];
  if (id < 0) {
    id = verts.length / 3;
    cornerId[k] = id;
    verts.push(minX + x * pitch, minY + y * pitch, minZ + z * pitch);
  }
  return id;
};
const quad = (a: number, b: number, c: number, d: number) => {
  faces.push(a, b, c, a, c, d);
};
for (let z = 0; z < nz; z++)
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      if (!solid[at(x, y, z)]) continue;
      if (x === 0 || !solid[at(x - 1, y, z)]) quad(corner(x, y, z), corner(x, y, z + 1), corner(x, y + 1, z + 1), corner(x, y + 1, z));
      if (x === nx - 1 || !solid[at(x + 1, y, z)]) quad(corner(x + 1, y, z), corner(x + 1, y + 1, z), corner(x + 1, y + 1, z + 1), corner(x + 1, y, z + 1));
      if (y === 0 || !solid[at(x, y - 1, z)]) quad(corner(x, y, z), corner(x + 1, y, z), corner(x + 1, y, z + 1), corner(x, y, z + 1));
      if (y === ny - 1 || !solid[at(x, y + 1, z)]) quad(corner(x, y + 1, z), corner(x, y + 1, z + 1), corner(x + 1, y + 1, z + 1), corner(x + 1, y + 1, z));
      if (z === 0 || !solid[at(x, y, z - 1)]) quad(corner(x, y, z), corner(x, y + 1, z), corner(x + 1, y + 1, z), corner(x + 1, y, z));
      if (z === nz - 1 || !solid[at(x, y, z + 1)]) quad(corner(x, y, z + 1), corner(x + 1, y, z + 1), corner(x + 1, y + 1, z + 1), corner(x, y + 1, z + 1));
    }
console.error(`[solidify] shell ${verts.length / 3} verts, ${faces.length / 3} tris`);

// ---- write glTF, weld + simplify ------------------------------------------
const out = new Document();
const buf = out.createBuffer();
const posAcc = out.createAccessor('POSITION').setType('VEC3').setArray(new Float32Array(verts));
posAcc.setBuffer(buf);
const idxAcc = out.createAccessor('indices').setType('SCALAR').setArray(new Uint32Array(faces));
idxAcc.setBuffer(buf);
const prim = out.createPrimitive().setAttribute('POSITION', posAcc).setIndices(idxAcc);
const mesh = out.createMesh('collision').addPrimitive(prim);
const node = out.createNode('collision').setMesh(mesh);
out.createScene('Scene').addChild(node);

await dedup()(out);
await weld({ tolerance: 0.0001 })(out);
await MeshoptSimplifier.ready;
const before = faces.length / 3;
if (before > triBudget) {
  await simplify({ simplifier: MeshoptSimplifier, ratio: triBudget / before, error: 0.05, lockBorder: false })(out);
}
prune()(out);
const io2 = new NodeIO();
await io2.write(outPath, out);
const outTris = out.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getIndices()?.getCount() ?? 0;
console.error(`[solidify] wrote ${outPath} (${outTris / 3} tris)`);
