// Offline generator (no ANTHROPIC_API_KEY): assembles a design from the best matching templates
// (catalog parts placed with assembleWeapon, converted to catalogPart components) with randomized
// palette / proportions plus a couple of from-scratch shape components, streamed with small delays.

import * as THREE from 'three';
import { assembleWeapon, getPart, type Template } from '@ai-gaem/parts';
import { inferElementFromText, templateToRawWeapon } from '@ai-gaem/shared';
import type { DesignAssembler } from './assembler';
import type { PromptContext } from './prompt';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORY_ROLE: Record<string, string> = {
  core: 'core', barrel: 'barrel', muzzle: 'muzzle', stock: 'stock', grip: 'grip', magazine: 'mag', sight: 'sight',
  underbarrel: 'under', tank: 'tank', launcher: 'barrel', crossbow: 'core', blade: 'blade', head: 'head', guard: 'guard',
  pommel: 'pommel', deco: 'deco',
};

const hsl = (h: number, s: number, l: number) => `#${new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l).getHexString()}`;
const r4 = (v: number) => Number(v.toFixed(4));

function templateComponents(t: Template, rand: () => number, rejected: (label: string) => boolean): Record<string, unknown>[] {
  const g = assembleWeapon({ name: t.name, class: t.class, parts: t.parts });
  const missing = new Set<string>([...(g.userData.missing ?? []), ...(g.userData.unplaced ?? [])]);
  const placed = t.parts.filter(p => !missing.has(p.partId));
  const jitter = 0.9 + rand() * 0.2;
  const out: Record<string, unknown>[] = [];
  const euler = new THREE.Euler();
  g.children.forEach((obj, i) => {
    const rp = placed[i];
    if (!rp) return;
    const def = getPart(rp.partId);
    if (!def) return;
    const first = def.desc.split(/[,.;]/)[0];
    const label = (first.length > 48 ? first.slice(0, 48).replace(/\s+\S*$/, '') : first) || def.category;
    if (rejected(label)) return;
    euler.setFromQuaternion(obj.quaternion, 'XYZ');
    const s = (rp.scale ?? 1) * jitter;
    out.push({
      t: 'component',
      id: `${CATEGORY_ROLE[def.category] ?? 'deco'}-${i}`,
      label,
      role: CATEGORY_ROLE[def.category] ?? 'deco',
      transform: {
        pos: obj.position.toArray().map(v => r4(v * jitter)),
        rot: [euler.x, euler.y, euler.z].map(v => r4((v * 180) / Math.PI)),
        scale: [s, s, s].map(r4),
      },
      catalogPart: { partId: rp.partId, ...(rp.color ? { color: rp.color } : {}), ...(rp.accent ? { accent: rp.accent } : {}) },
    });
  });
  return out;
}

/** A few from-scratch flourishes so the mock exercises the shape pipeline too. */
function flourishes(coreId: string, rand: () => number, melee: boolean): Record<string, unknown>[] {
  const pool: Record<string, unknown>[] = [
    { label: 'glowing power gem', role: 'deco', attach: 'top', transform: { pos: [0, 0.02, 0] }, shapes: [{ type: 'sphere', r: 0.025, wseg: 8, hseg: 6, scale: [1, 1.4, 1], material: { color: 'glow', emissive: 'glow', emissiveIntensity: 1.2 } }] },
    { label: 'racing stripe fin', role: 'deco', attach: 'top', transform: { pos: [0, 0.01, 0.02] }, shapes: [{ type: 'extrude', rot: [0, 90, 0], depth: 0.01, outline: [[0.06, 0], [-0.06, 0], [-0.08, 0.05], [0.0, 0.03]], material: { color: 'accent' } }] },
    { label: 'brass coil wrap', role: 'deco', attach: 'center', transform: {}, shapes: [{ type: 'torus', r: 0.05, tube: 0.006, seg: 12, material: { color: 'accent', metalness: 0.8 } }, { type: 'torus', r: 0.05, tube: 0.006, seg: 12, pos: [0, 0, 0.03], material: { color: 'accent', metalness: 0.8 } }] },
    { label: 'dangling lucky charm', role: 'deco', attach: 'bottom', transform: { pos: [0.02, -0.01, 0] }, shapes: [{ type: 'tube', r: 0.003, seg: 4, path: [[0, 0, 0], [0.005, -0.03, 0.01], [0, -0.05, 0]], material: { color: '#dddddd' } }, { type: 'cone', r: 0.015, h: 0.03, seg: 6, pos: [0, -0.065, 0], rot: [180, 0, 0], material: { color: 'glow', emissive: 'glow' } }] },
    { label: 'cooling vent rings', role: 'deco', attach: 'front', transform: { pos: [0, 0, 0.02] }, shapes: [{ type: 'cylinder', rTop: 0.03, rBottom: 0.03, h: 0.01, seg: 8, rot: [90, 0, 0], material: { color: 'secondary' } }] },
  ];
  if (melee) pool.push({ label: 'wrapped grip tape', role: 'deco', attach: [0, 0, 0.04], transform: {}, shapes: [{ type: 'capsule', r: 0.02, h: 0.1, seg: 6, rot: [90, 0, 0], material: { color: 'secondary', roughness: 1 } }] });
  const n = 1 + Math.floor(rand() * 2);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const pick = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    out.push({ t: 'component', id: `fx-${i}`, parent: coreId, ...pick });
  }
  return out;
}

const NAME_BITS = ['Mk II', 'Deluxe', 'Prototype', 'Custom', 'XL', 'Turbo', 'Mini', 'Supreme', 'Classic'];

export async function generateMock(
  opts: { signal: AbortSignal; delayMs: number; seed?: number },
  ctx: PromptContext,
  asm: DesignAssembler,
): Promise<void> {
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) + ctx.variant * 7919;
  const rand = mulberry32(seed);
  const sleep = (ms: number) =>
    new Promise<void>((res, rej) => {
      if (opts.signal.aborted) return rej(new Error('aborted'));
      const t = setTimeout(res, ms);
      opts.signal.addEventListener('abort', () => (clearTimeout(t), rej(new Error('aborted'))), { once: true });
    });
  const delay = () => (opts.delayMs > 0 ? sleep(opts.delayMs * (0.6 + rand() * 0.8)) : Promise.resolve());

  const pool = ctx.templates.length ? ctx.templates : [];
  const t = pool[Math.min(pool.length - 1, Math.floor(rand() * Math.min(pool.length, 3)))];
  const hue = rand();
  const palette = {
    primary: hsl(hue, 0.35 + rand() * 0.4, 0.3 + rand() * 0.2),
    secondary: hsl(hue + 0.08, 0.2 + rand() * 0.3, 0.2 + rand() * 0.15),
    accent: hsl(hue + 0.5, 0.7, 0.55),
    glow: hsl(hue + 0.45, 0.9, 0.65),
  };
  const raw = t ? templateToRawWeapon({ ...t, statHints: t.statHints }) : { class: ctx.classHint ?? 'weird' };
  const baseName = t?.name ?? 'Mystery Device';
  const bit = NAME_BITS[Math.floor(rand() * NAME_BITS.length)];
  const name = baseName.length + bit.length < 40 ? `${baseName} ${bit}` : baseName;
  await delay();
  asm.push({ t: 'meta', name, class: raw.class, fireMode: raw.fireMode, palette, fx: { muzzleFlashColor: palette.glow, projectileColor: palette.accent, trail: rand() < 0.5 ? 'smoke' : 'spark' } });

  const rejected = (label: string) => ctx.rejected.some(r => r && label.toLowerCase().includes(r.toLowerCase()));
  const comps = t ? templateComponents(t, rand, rejected) : [];
  if (!comps.length) {
    comps.push({ t: 'component', id: 'core', label: 'mystery box', role: 'core', transform: { pos: [0, 0.06, 0] }, shapes: [{ type: 'box', size: [0.06, 0.08, 0.3], material: { color: 'primary' } }] });
  }
  comps.push(...flourishes(String(comps[0].id), rand, raw.fireMode === 'melee'));
  for (const c of comps) {
    await delay();
    asm.push(c);
  }
  await delay();
  const { parts: _p, name: _n, class: _c, fireMode: _f, ...stats } = raw as Record<string, unknown>;
  for (const k of ['damage', 'fireRate', 'range'] as const) if (typeof stats[k] === 'number') stats[k] = (stats[k] as number) * (0.85 + rand() * 0.3);
  // the request names an element ("frost cannon", "flaming axe"): the mock honours it like the LLM would
  const element = inferElementFromText(ctx.prompt);
  if (element) stats.element = element;
  asm.push({ t: 'stats', ...stats });
}
