#!/usr/bin/env node
/**
 * Scrape a Matterport tour into an OBJ + MTL + textures for the map pipeline.
 *
 *   node client/scripts/map/scrape-matterport.mjs <modelId> --name <id> [--out scans]
 *
 * Example (the K2 / Tauron Arena Kraków tour):
 *   node client/scripts/map/scrape-matterport.mjs eECbFJAzMzz --name tauron-arena
 *   node client/scripts/map/process-scan.ts scans/tauron-arena/tauron-arena.obj --name tauron-arena --up z
 *
 * How it works: the `show/` page embeds a signed `GetModelPrefetch` asset manifest (valid ~24h)
 * listing the 50k `.dam` mesh and the `_50k_texture_jpg_low` texture template. `.dam` is an
 * uncompressed, tiled format — each tile is `{ positions f32x3, uvs f32x2, LEB128 indices }`
 * plus a group name and a texture filename. We decode tiles to a single indexed OBJ.
 *
 * NOTE: this downloads someone else's model. Only use it for a model you are allowed to use,
 * and do not redistribute the result without permission (ToS / copyright).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const SHOW = (id) => `https://my.matterport.com/show/?m=${id}`;

function varint(b, i) {
  let r = 0;
  let sh = 0;
  for (;;) {
    const x = b[i++];
    r |= (x & 0x7f) << sh;
    if (!(x & 0x80)) return [r >>> 0, i];
    sh += 7;
  }
}

function readField(b, i) {
  const [key, j] = varint(b, i);
  const fn = key >>> 3;
  const wt = key & 7;
  if (wt !== 2) throw new Error(`field ${fn} wiretype ${wt} not length-delimited`);
  const [len, k] = varint(b, j);
  return [fn, k, len, k + len];
}

function decodeVarints(b, off, end) {
  const out = [];
  let i = off;
  while (i < end) {
    const [v, j] = varint(b, i);
    out.push(v);
    i = j;
  }
  return out;
}

/** Parse a `.dam` buffer into tiles. */
function parseDam(d) {
  const tiles = [];
  let i = 0;
  while (i < d.length - 4) {
    let inner;
    try {
      inner = readField(d, i);
    } catch {
      break;
    }
    const end = inner[3];
    if (end > d.length) break;
    try {
      const [, o, l1] = readField(d, inner[1]); // inner f1 (positions + uvs)
      const [, po, pl] = readField(d, o); // positions
      const [, uo, ul] = readField(d, po + pl); // uvs
      const [, o3, l2] = readField(d, o + l1); // f2 (indices)
      const [, bo, bl] = readField(d, o3); // index blob
      const [, to, tl, afterName] = readField(d, o3 + l2); // f3 group name
      const [, fo, fl] = readField(d, afterName); // f4 texture filename
      const n = pl / 12;
      if (ul / 8 !== n) throw new Error('uv/vertex mismatch');
      const tex = Buffer.from(d.subarray(fo, fo + fl)).toString('ascii').trim();
      const indices = decodeVarints(d, bo, bo + bl);
      tiles.push({ po, pl, uo, ul, n, indices, tex });
    } catch {
      break;
    }
    i = end;
  }
  return tiles;
}

function uniqueTextures(tiles) {
  return [...new Set(tiles.map((t) => t.tex).filter(Boolean))];
}

async function writeObj(outDir, name, d, tiles) {
  const texDir = path.join(outDir, 'textures');
  await mkdir(texDir, { recursive: true });

  const mtl = uniqueTextures(tiles)
    .map((t) => `newmtl ${path.parse(t).name}\nKd 1 1 1\nKa 0 0 0\nKs 0 0 0\nillum 1\nmap_Kd textures/${t}\n`)
    .join('\n');
  await writeFile(path.join(outDir, `${name}.mtl`), `${mtl}\n`);

  const lines = [`mtllib ${name}.mtl`];
  let vbase = 1;
  for (const { po, uo, n, indices, tex } of tiles) {
    lines.push(`usemtl ${path.parse(tex).name}`);
    for (let k = 0; k < n; k++) {
      lines.push(`v ${d.readFloatLE(po + k * 12).toFixed(4)} ${d.readFloatLE(po + k * 12 + 4).toFixed(4)} ${d.readFloatLE(po + k * 12 + 8).toFixed(4)}`);
    }
    for (let k = 0; k < n; k++) {
      lines.push(`vt ${d.readFloatLE(uo + k * 8).toFixed(5)} ${d.readFloatLE(uo + k * 8 + 4).toFixed(5)}`);
    }
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = vbase + indices[t];
      const b = vbase + indices[t + 1];
      const c = vbase + indices[t + 2];
      lines.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
    }
    vbase += n;
  }
  await writeFile(path.join(outDir, `${name}.obj`), `${lines.join('\n')}\n`);
  return { vertices: tiles.reduce((s, t) => s + t.n, 0), faces: tiles.reduce((s, t) => s + Math.floor(t.indices.length / 3) + ((t.indices.length % 3) ? 1 : 0), 0) };
}

async function downloadTextures(outDir, template, textures) {
  const dir = path.join(outDir, 'textures');
  let ok = 0;
  await Promise.all(
    textures.map(async (file) => {
      const idx = file.replace(/^.*_50k_/, '').replace(/\.jpg$/, '');
      const url = template.replace('<texture>', idx);
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`texture ${file}: HTTP ${res.status}`);
      await writeFile(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
      ok++;
    }),
  );
  return ok;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { name: { type: 'string' }, out: { type: 'string' } },
  });
  const modelId = positionals[0];
  const name = values.name;
  if (!modelId || !name) {
    console.error('usage: node client/scripts/map/scrape-matterport.mjs <modelId> --name <id> [--out scans]');
    process.exit(1);
  }
  const outDir = path.resolve(values.out ?? 'scans', name);
  await mkdir(outDir, { recursive: true });

  console.log(`[scrape] fetching ${SHOW(modelId)}`);
  const html = await (await fetch(SHOW(modelId), { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
  const unescaped = html
    .replace(/\\u003D/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u003C/gi, '<')
    .replace(/\\u003E/gi, '>');

  const meshUrl = unescaped.match(/https:\/\/cdn-[^"'\\\s]*_50k\.dam\?t=[^"'\\\s]*/)?.[0];
  const texTemplate = unescaped.match(/https:\/\/cdn-[^"'\\\s]*_50k_texture_jpg_low\/[^"'\\\s]*_50k_<texture>\.jpg\?t=[^"'\\\s&]*&k=[^"'\\\s]*/)?.[0];
  if (!meshUrl) throw new Error('could not find the 50k .dam mesh URL in the tour page (model may not be public)');
  if (!texTemplate) throw new Error('could not find the texture template in the tour page');

  console.log('[scrape] downloading mesh  (_50k.dam)');
  const dam = Buffer.from(await (await fetch(meshUrl, { headers: { 'user-agent': 'Mozilla/5.0' } })).arrayBuffer());
  const tiles = parseDam(dam);
  if (!tiles.length) throw new Error('no tiles decoded from .dam (format changed?)');
  const textures = uniqueTextures(tiles);
  const stats = await writeObj(outDir, name, dam, tiles);
  console.log(`[scrape] tiles=${tiles.length} vertices=${stats.vertices} faces=${stats.faces} textures=${textures.length}`);

  console.log('[scrape] downloading textures');
  const ok = await downloadTextures(outDir, texTemplate, textures);
  console.log(`[scrape] textures ${ok}/${textures.length}`);
  console.log(`[scrape] wrote ${path.join(outDir, `${name}.obj`)}`);
  console.log(`[scrape] next: node client/scripts/map/process-scan.ts ${path.relative(process.cwd(), path.join(outDir, `${name}.obj`))} --name ${name} --up z`);
}

main().catch((e) => {
  console.error(`[scrape] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
