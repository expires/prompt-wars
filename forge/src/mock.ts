// Offline generator (no ANTHROPIC_API_KEY): assembles a design from the best matching templates
// (catalog parts placed with assembleWeapon, converted to catalogPart components) with randomized
// palette / proportions plus a couple of from-scratch shape components, streamed with small delays.

import * as THREE from 'three';
import { assembleWeapon, getPart, type Template } from '@ai-gaem/parts';
import { CLASS_TEMPLATES, inferElementFromText, templateToRawWeapon, type WeaponClass } from '@ai-gaem/shared';
import { firesProjectiles } from '@ai-gaem/shared/forge';
import {
  EXAMPLE_BANANA_LAUNCHER,
  EXAMPLE_BUBBLE_GUN,
  EXAMPLE_AK,
  EXAMPLE_FRYING_PAN,
  EXAMPLE_GLOCK,
  EXAMPLE_KARAMBIT,
  EXAMPLE_KATANA,
  EXAMPLE_PUMP_SHOTGUN,
  EXAMPLE_REVOLVER,
  EXAMPLE_THROWN_FISH,
} from '@ai-gaem/shared/forge/examples';
import { archetypeFromText, type Archetype } from '@ai-gaem/shared/forge/refine';
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

type Raw = Record<string, unknown>;
const mat = (color: string, extra: Raw = {}): Raw => ({ color, ...extra });

/** Throwable objects: shapes centred on the origin (held in the hand and thrown as the projectile). */
const THROW_OBJECTS: { re: RegExp; name: string; label: string; shapes: Raw[] }[] = [
  {
    re: /stool|chair|seat/i, name: 'Bar Stool', label: 'wooden bar stool',
    shapes: [
      { type: 'cylinder', rTop: 0.17, rBottom: 0.17, h: 0.05, seg: 10, pos: [0, 0.2, 0], material: mat('primary', { roughness: 0.8 }) },
      { type: 'cylinder', rTop: 0.018, rBottom: 0.022, h: 0.4, seg: 5, pos: [0.11, 0, 0.06], rot: [-8, 0, -8], material: mat('secondary') },
      { type: 'cylinder', rTop: 0.018, rBottom: 0.022, h: 0.4, seg: 5, pos: [-0.11, 0, 0.06], rot: [-8, 0, 8], material: mat('secondary') },
      { type: 'cylinder', rTop: 0.018, rBottom: 0.022, h: 0.4, seg: 5, pos: [0, 0, -0.12], rot: [10, 0, 0], material: mat('secondary') },
      { type: 'torus', r: 0.11, tube: 0.01, seg: 10, pos: [0, -0.05, 0], rot: [90, 0, 0], material: mat('accent', { metalness: 0.7 }) },
    ],
  },
  {
    re: /bottle|molotov|beer|wine/i, name: 'Bottle Lob', label: 'glass bottle',
    shapes: [
      { type: 'lathe', seg: 10, rot: [-90, 0, 0], pos: [0, 0, 0.13], points: [[0, 0], [0.04, 0], [0.042, 0.16], [0.015, 0.22], [0.015, 0.27], [0, 0.27]], material: mat('primary', { opacity: 0.6, roughness: 0.1 }) },
      { type: 'cylinder', rTop: 0.017, rBottom: 0.017, h: 0.02, seg: 8, pos: [0, 0, -0.135], rot: [90, 0, 0], material: mat('accent') },
    ],
  },
  { re: /fish/i, name: 'Flounder Fling', label: 'slippery fish', shapes: EXAMPLE_THROWN_FISH.projectile.shapes },
  { re: /banana/i, name: 'Banana Hurl', label: 'ripe banana', shapes: EXAMPLE_BANANA_LAUNCHER.projectile.shapes },
  {
    re: /brick|rock|stone/i, name: 'Brick Toss', label: 'red brick',
    shapes: [{ type: 'box', size: [0.1, 0.065, 0.2], material: mat('primary', { roughness: 1 }) }],
  },
];

/** Projectile for a mock design (palette tokens, centred, flight = -Z). */
function mockProjectile(cls: WeaponClass, prompt: string, rand: () => number): Raw | null {
  if (cls === 'throwable') {
    const o = THROW_OBJECTS.find(x => x.re.test(prompt)) ?? THROW_OBJECTS[0];
    return { label: o.label, shapes: o.shapes, spin: { axis: 'x', rate: 1.5 + rand() }, impact: 'shatter' };
  }
  if (/banana/i.test(prompt)) return { ...EXAMPLE_BANANA_LAUNCHER.projectile };
  if (/fish/i.test(prompt)) return { ...EXAMPLE_THROWN_FISH.projectile };
  if (cls === 'bubble_gun' || /bubble|soap/i.test(prompt)) {
    return {
      label: 'wobbly soap bubble',
      shapes: [
        { type: 'sphere', r: 0.12, wseg: 12, hseg: 8, material: mat('glow', { opacity: 0.3, roughness: 0.1, emissive: 'glow', emissiveIntensity: 0.3, flatShading: false }) },
        { type: 'sphere', r: 0.025, wseg: 6, hseg: 4, pos: [0.05, 0.05, -0.05], material: mat('#ffffff', { opacity: 0.85, emissive: '#ffffff', emissiveIntensity: 0.6 }) },
      ],
      wobble: 0.7, trail: 'bubble', impact: 'splash',
    };
  }
  if (cls === 'rocket_launcher' || cls === 'grenade_launcher') {
    const fins = rand() < 0.5 ? 3 : 4;
    const shapes: Raw[] = [
      { type: 'cylinder', rTop: 0.05, rBottom: 0.05, h: 0.32, seg: 8, rot: [90, 0, 0], material: mat('secondary', { metalness: 0.4 }) },
      { type: 'cone', r: 0.05, h: 0.12, seg: 8, pos: [0, 0, -0.22], rot: [-90, 0, 0], material: mat('accent') },
      { type: 'cone', r: 0.04, h: 0.12, seg: 6, pos: [0, 0, 0.22], rot: [90, 0, 0], material: mat('#ffb040', { emissive: '#ff7a1a', emissiveIntensity: 2, opacity: 0.85 }) },
    ];
    for (let i = 0; i < fins; i++) {
      const a = (i / fins) * 360;
      shapes.push({ type: 'extrude', depth: 0.006, rot: [0, 90, a], pos: [0, 0, 0.13], outline: [[0.04, 0.04], [-0.04, 0.04], [-0.04, 0.1], [0.0, 0.1]], material: mat('accent') });
    }
    return { label: cls === 'rocket_launcher' ? 'finned rocket' : 'stubby grenade', shapes, spin: { axis: 'z', rate: 2 }, trail: 'smoke', impact: 'burst' };
  }
  if (cls === 'crossbow' || cls === 'blowgun') {
    return {
      label: cls === 'crossbow' ? 'fletched bolt' : 'feathered dart',
      shapes: [
        { type: 'cylinder', rTop: 0.007, rBottom: 0.007, h: 0.34, seg: 5, rot: [90, 0, 0], material: mat('secondary') },
        { type: 'cone', r: 0.016, h: 0.06, seg: 4, pos: [0, 0, -0.2], rot: [-90, 0, 0], material: mat('#c0c0c0', { metalness: 0.8 }) },
        { type: 'box', size: [0.05, 0.003, 0.06], pos: [0, 0, 0.14], material: mat('accent') },
        { type: 'box', size: [0.003, 0.05, 0.06], pos: [0, 0, 0.14], material: mat('accent') },
      ],
      trail: 'none', impact: 'spark',
    };
  }
  return {
    label: 'glowing slug',
    shapes: [
      { type: 'capsule', r: 0.03, h: 0.08, seg: 6, rot: [90, 0, 0], material: mat('glow', { emissive: 'glow', emissiveIntensity: 1.5 }) },
      { type: 'torus', r: 0.035, tube: 0.008, seg: 8, material: mat('accent') },
    ],
    spin: { axis: 'z', rate: 3 }, trail: 'glow', impact: 'spark',
  };
}

/** Hand-built designs the mock streams when the prompt names their archetype (offline quality). */
const EXAMPLE_BY_ARCHETYPE: Partial<Record<Archetype, Record<string, unknown>>> = {
  karambit: EXAMPLE_KARAMBIT,
  katana: EXAMPLE_KATANA,
  shotgun: EXAMPLE_PUMP_SHOTGUN,
  revolver: EXAMPLE_REVOLVER,
  bubble_gun: EXAMPLE_BUBBLE_GUN,
  pan: EXAMPLE_FRYING_PAN,
  pistol: EXAMPLE_GLOCK,
  rifle: EXAMPLE_AK,
};

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

  const throwable = ctx.classHint === 'throwable' || /\b(throw|toss|lob|hurl|chuck|fling|yeet)/i.test(ctx.prompt);
  const arch = archetypeFromText(ctx.prompt);
  const example = !throwable && arch ? EXAMPLE_BY_ARCHETYPE[arch] : undefined;
  if (example) {
    const rejected = (label: string) => ctx.rejected.some(r => r && label.toLowerCase().includes(r.toLowerCase()));
    const ex = example as { name: string; class: string; fireMode: string; palette: Record<string, string>; fx: unknown; stats: Record<string, unknown>; components: Record<string, unknown>[]; projectile?: unknown };
    const bit = NAME_BITS[Math.floor(rand() * NAME_BITS.length)];
    await delay();
    asm.push({ t: 'meta', name: ex.name.length + bit.length < 40 ? `${ex.name} ${bit}` : ex.name, class: ex.class, fireMode: ex.fireMode, palette: { ...ex.palette, accent: hsl(rand(), 0.75, 0.55) }, fx: ex.fx });
    for (const c of ex.components) {
      if (rejected(String(c.label))) continue;
      await delay();
      asm.push({ t: 'component', ...c });
    }
    if (ex.projectile) {
      await delay();
      asm.push({ t: 'projectile', ...(ex.projectile as Record<string, unknown>) });
    }
    await delay();
    const stats = { ...ex.stats };
    const element = inferElementFromText(ctx.prompt);
    if (element) stats.element = element;
    asm.push({ t: 'stats', ...stats });
    return;
  }
  const pool = ctx.templates.length && !throwable ? ctx.templates : [];
  const t = pool[Math.min(pool.length - 1, Math.floor(rand() * Math.min(pool.length, 3)))];
  const hue = rand();
  const palette = {
    primary: hsl(hue, 0.35 + rand() * 0.4, 0.3 + rand() * 0.2),
    secondary: hsl(hue + 0.08, 0.2 + rand() * 0.3, 0.2 + rand() * 0.15),
    accent: hsl(hue + 0.5, 0.7, 0.55),
    glow: hsl(hue + 0.45, 0.9, 0.65),
  };
  const throwObj = throwable ? (THROW_OBJECTS.find(x => x.re.test(ctx.prompt)) ?? THROW_OBJECTS[0]) : null;
  const raw: Record<string, unknown> = t
    ? templateToRawWeapon({ ...t, statHints: t.statHints })
    : throwable
      ? { ...CLASS_TEMPLATES.throwable.defaults, class: 'throwable', fireMode: 'arc' }
      : { class: ctx.classHint ?? 'weird' };
  const baseName = t?.name ?? throwObj?.name ?? 'Mystery Device';
  const bit = NAME_BITS[Math.floor(rand() * NAME_BITS.length)];
  const name = baseName.length + bit.length < 40 ? `${baseName} ${bit}` : baseName;
  await delay();
  asm.push({ t: 'meta', name, class: raw.class, fireMode: raw.fireMode, palette, fx: { muzzleFlashColor: palette.glow, projectileColor: palette.accent, trail: rand() < 0.5 ? 'smoke' : 'spark' } });

  const rejected = (label: string) => ctx.rejected.some(r => r && label.toLowerCase().includes(r.toLowerCase()));
  const comps = t ? templateComponents(t, rand, rejected) : [];
  if (throwObj && !rejected(throwObj.label)) {
    // held object, hand near its bottom / back
    comps.push({ t: 'component', id: 'object', label: throwObj.label, role: 'core', transform: { pos: [0, 0.08, -0.12] }, shapes: throwObj.shapes });
  }
  if (!comps.length) {
    comps.push({ t: 'component', id: 'core', label: 'mystery box', role: 'core', transform: { pos: [0, 0.06, 0] }, shapes: [{ type: 'box', size: [0.06, 0.08, 0.3], material: { color: 'primary' } }] });
  }
  if (!throwObj) comps.push(...flourishes(String(comps[0].id), rand, raw.fireMode === 'melee'));
  for (const c of comps) {
    await delay();
    asm.push(c);
  }
  const cls = (raw.class as WeaponClass) ?? 'weird';
  const mode = (raw.fireMode as string | undefined) ?? CLASS_TEMPLATES[cls]?.modes[0];
  if (firesProjectiles(mode)) {
    const proj = mockProjectile(cls, ctx.prompt, rand);
    if (proj) {
      await delay();
      asm.push({ t: 'projectile', ...proj });
    }
  }
  await delay();
  const { parts: _p, name: _n, class: _c, fireMode: _f, ...stats } = raw as Record<string, unknown>;
  for (const k of ['damage', 'fireRate', 'range'] as const) if (typeof stats[k] === 'number') stats[k] = (stats[k] as number) * (0.85 + rand() * 0.3);
  // the request names an element ("frost cannon", "flaming axe"): the mock honours it like the LLM would
  const element = inferElementFromText(ctx.prompt);
  if (element) stats.element = element;
  asm.push({ t: 'stats', ...stats });
}
