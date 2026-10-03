/**
 * EVERYDAY OBJECT framework.
 *
 * An ObjSpec describes one kind of everyday object (frying pan, umbrella, guitar ...) with a
 * parametric `draw` and a few curated parameter `variants`. Each variant is turned into several
 * PARTS, one per ROLE, all from the same drawing:
 *
 *   core   `core-<kind>-<v>`   whole object as the weapon body (melee-able and/or gun body)
 *   head   `head-<kind>-<v>`   business end for handle cores (attach 'head', extends -Z)
 *   blade  `blade-<kind>-<v>`  whole object as a sword blade (attach 'blade', extends -Z)
 *   barrel `barrel-<kind>-<v>` whole object as a gun barrel (attach 'barrel', exposes muzzle)
 *   muzzle `muzzle-<kind>-<v>` small object on the muzzle / as a rocket warhead
 *   mag    `mag-<kind>-<v>`    object hanging under the gun as a magazine
 *   deco   `deco-<kind>-<v>`   mini object sitting on top
 *
 * CANONICAL FRAME used by `draw` (same as every weapon in the library):
 *   forward / business end = -Z, up = +Y, right = +X, meters.
 *   The ORIGIN is where the hand holds it (top of the handle, like melee handle cores whose grip
 *   runs toward +Z). Things without a handle put the origin where you'd grab them.
 *   The object should be roughly centred on x = 0.
 *
 * `anchors(p)` returns surface points (pure math, no geometry) used for sockets:
 *   tip   -> 'muzzle' (the most -Z point on the centreline; where shots come out)
 *   rear  -> 'stock' / 'pommel' (the most +Z point)
 *   top   -> 'top'  (on the upper surface, a sight sits here)
 *   grip  -> 'grip' (underside near the origin; a pistol grip hangs here)
 *   under -> 'under' (underside toward the front)
 *   mag   -> 'mag'  (optional; default: midway between grip and under)
 *   side  -> 'side' on +X (mirrored to -X for 'deco')
 * Every anchor must lie ON the drawn surface (tests check <= 2.5 cm).
 */
import type { PartDef, Socket, Vec3 } from '../../types';
import { part, S } from '../../lib/define';
import type { Kit } from '../../lib/kit';

export type ObjGroup = 'kitchen' | 'household' | 'garden' | 'sports' | 'music' | 'office' | 'toy' | 'food' | 'weapon';
export type Role = 'core' | 'head' | 'blade' | 'barrel' | 'muzzle' | 'mag' | 'deco';
export type Swing = 'slash' | 'overhead' | 'thrust' | 'bash' | 'spin';
export type Weight = 'light' | 'medium' | 'heavy';
export type P = Record<string, number>;

export interface Anchors {
  tip: Vec3;
  rear: Vec3;
  top: Vec3;
  grip: Vec3;
  under: Vec3;
  side: Vec3;
  mag?: Vec3;
}

export interface ObjVariant {
  /** short word, e.g. 'deep', 'cast', 'long' (NOT a bare number; keeps ids collision-free) */
  v: string;
  p: P;
  /** optional variant description (<= 8 words); defaults to spec.desc */
  desc?: string;
  /** optional display noun override, e.g. 'Wok' */
  noun?: string;
}

export interface ObjSpec {
  /** kebab-case kind, e.g. 'frying-pan' */
  kind: string;
  group: ObjGroup;
  /** display noun used in template names, e.g. 'Frying Pan' */
  noun: string;
  /** search synonyms, e.g. ['pan', 'skillet', 'cookware'] */
  syn: string[];
  /** style tags, e.g. ['kitchen', 'metal', 'silly'] (group is added automatically) */
  tags: string[];
  /** <= 8 words */
  desc: string;
  color: string;
  accent: string;
  variants: ObjVariant[];
  draw(k: Kit, p: P): void;
  anchors(p: P): Anchors;
  /** optional business-end-only drawing for the 'head' role (z <= 0, extending toward -Z) */
  head?: (k: Kit, p: P) => void;
  /** roles to emit besides 'core' */
  roles: Role[];
  /** emit a core part (default true) */
  core?: boolean;
  /** melee-able as a core: how it swings */
  melee?: { swing: Swing; weight: Weight };
  /** ranged weapon classes this object makes sense as a gun body for */
  guns?: string[];
  /** override weapon classes per role */
  roleClasses?: Partial<Record<Role, string[]>>;
  /** deco role target size (longest dimension, m). default 0.075 */
  decoSize?: number;
  /** the object already has its own pistol-style handle (hair dryer, drill, water gun): templates add no grip */
  selfGrip?: boolean;
  /** preferred fire mode when used as a gun body ('stream' for a hose, 'projectile' for a slingshot ...) */
  fireMode?: 'hitscan' | 'projectile' | 'arc' | 'stream';
  /** what it fires, for template descriptions, e.g. 'baguettes', 'hot coffee' */
  ammo?: string;
}

export const ALL_CLASSES = [
  'pistol',
  'smg',
  'rifle',
  'shotgun',
  'sniper',
  'lmg',
  'rocket_launcher',
  'grenade_launcher',
  'flamethrower',
  'bubble_gun',
  'blowgun',
  'crossbow',
  'melee',
  'weird',
];
const GUN6 = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg'];
const DEFAULT_ROLE_CLASSES: Record<Role, string[]> = {
  core: [],
  head: ['melee', 'weird'],
  blade: ['melee', 'weird'],
  barrel: [...GUN6, 'flamethrower', 'bubble_gun', 'weird'],
  muzzle: [...GUN6, 'rocket_launcher', 'flamethrower', 'bubble_gun', 'blowgun', 'weird'],
  mag: [...GUN6, 'grenade_launcher', 'bubble_gun', 'weird'],
  deco: ALL_CLASSES,
};
const ROLE_CATEGORY: Record<Role, string> = {
  core: 'core',
  head: 'head',
  blade: 'blade',
  barrel: 'barrel',
  muzzle: 'muzzle',
  mag: 'magazine',
  deco: 'deco',
};
const ROLE_ATTACH: Record<Role, string> = { core: '', head: 'head', blade: 'blade', barrel: 'barrel', muzzle: 'muzzle', mag: 'mag', deco: 'deco' };
const ROLE_LEN: Partial<Record<Role, [number, number]>> = {
  blade: [0.35, 0.95],
  barrel: [0.18, 0.55],
  muzzle: [0.05, 0.14],
  head: [0.15, 0.6],
};

/** Metadata about an object-derived part (for templates / search). */
export interface ObjPartInfo {
  spec: ObjSpec;
  variant: ObjVariant;
  role: Role;
  /** distance from origin (hand) to tip, meters, in the part's own frame */
  reach: number;
}

export const OBJ_INFO = new Map<string, ObjPartInfo>();

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const r4 = (a: Vec3): Vec3 => [+a[0].toFixed(4), +a[1].toFixed(4), +a[2].toFixed(4)];

function lenOf(a: Anchors): number {
  return Math.max(a.rear[2] - a.tip[2], 0.01);
}

function roleScale(role: Role, a: Anchors): number {
  const range = ROLE_LEN[role];
  if (!range) return 1;
  const L = lenOf(a);
  const t = Math.min(Math.max(L, range[0]), range[1]);
  return t / L;
}

function words(s: string): string[] {
  return s.trim().split(/\s+/);
}
function clampDesc(s: string, max = 12): string {
  const w = words(s);
  return w.length <= max ? s : w.slice(0, max).join(' ');
}

const ROLE_DESC: Record<Role, (d: string) => string> = {
  core: (d) => d,
  head: (d) => `${d} head`,
  blade: (d) => `${d} as blade`,
  barrel: (d) => `${d} as barrel`,
  muzzle: (d) => `${d} muzzle piece`,
  mag: (d) => `${d} as magazine`,
  deco: (d) => `mini ${d}`,
};

function makeRole(spec: ObjSpec, v: ObjVariant, role: Role): PartDef {
  const p = v.p;
  const a = spec.anchors(p);
  const id = `${role === 'mag' ? 'mag' : role}-${spec.kind}-${v.v}`;
  const baseDesc = v.desc ?? spec.desc;
  const tags = [...new Set([spec.group, ...spec.tags])];
  let classes = spec.roleClasses?.[role] ?? DEFAULT_ROLE_CLASSES[role];
  if (role === 'core') classes = [...new Set([...(spec.melee ? ['melee'] : []), ...(spec.guns ?? []), 'weird'])];
  let sockets: Record<string, Socket> = {};
  let draw: (k: Kit) => void;
  let reach = 0;

  if (role === 'core') {
    const mag = a.mag ?? mul3(add3(a.grip, a.under), 0.5);
    sockets = {
      muzzle: S(r4(a.tip)),
      grip: S(r4(a.grip)),
      mag: S(r4(mag)),
      under: S(r4(a.under)),
      top: S(r4(a.top)),
      side: S(r4(a.side), [1, 0, 0]),
      deco: S(r4([-a.side[0], a.side[1], a.side[2]]), [-1, 0, 0]),
      stock: S(r4(a.rear)),
      pommel: S(r4(a.rear)),
    };
    draw = (k) => spec.draw(k, p);
    reach = Math.max(-a.tip[2], 0.05);
  } else if (role === 'head' && spec.head) {
    sockets = { deco: S([0.03, 0, -0.04], [1, 0, 0]) };
    draw = (k) => spec.head!(k, p);
    reach = Math.max(-a.tip[2], 0.1);
  } else if (role === 'head' || role === 'blade' || role === 'barrel' || role === 'muzzle') {
    const s = roleScale(role, a);
    const tf = (q: Vec3) => r4(mul3(sub3(q, a.rear), s));
    if (role === 'blade') sockets = { muzzle: S(tf(a.tip)), deco: S(tf(a.side), [1, 0, 0]) };
    else if (role === 'barrel') sockets = { muzzle: S(tf(a.tip)), under: S(tf(a.under)) };
    else if (role === 'head') sockets = { deco: S(tf(a.side), [1, 0, 0]) };
    draw = (k) => {
      spec.draw(k, p);
      k.transformAll({ p: mul3(a.rear, -1) });
      if (s !== 1) k.transformAll({ s });
    };
    reach = lenOf(a) * s;
  } else if (role === 'mag') {
    draw = (k) => {
      spec.draw(k, p);
      k.transformAll({ p: mul3(a.rear, -1) });
      k.transformAll({ r: [-Math.PI / 2, 0, 0] });
      const b = k.bounds();
      const dim = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 1e-4);
      const s = Math.min(Math.max(dim, 0.06), 0.11) / dim;
      k.transformAll({ p: [-(b.min.x + b.max.x) / 2, -b.max.y, -(b.min.z + b.max.z) / 2] });
      k.transformAll({ s });
    };
  } else {
    // deco
    const target = spec.decoSize ?? 0.075;
    draw = (k) => {
      spec.draw(k, p);
      const b = k.bounds();
      const dim = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 1e-4);
      k.transformAll({ p: [-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2] });
      k.transformAll({ s: target / dim });
    };
  }

  const def = part({
    id,
    category: ROLE_CATEGORY[role],
    classes,
    tags,
    desc: clampDesc(ROLE_DESC[role](baseDesc)),
    attach: ROLE_ATTACH[role],
    sockets,
    color: spec.color,
    accent: spec.accent,
    draw,
  });
  OBJ_INFO.set(id, { spec, variant: v, role, reach: +reach.toFixed(3) });
  return def;
}

/** Expand specs into parts (one per variant per role). */
export function objParts(specs: ObjSpec[]): PartDef[] {
  const out: PartDef[] = [];
  for (const spec of specs) {
    const roles: Role[] = [...(spec.core === false ? [] : (['core'] as Role[])), ...spec.roles.filter((r) => r !== 'core')];
    for (const v of spec.variants) for (const r of roles) out.push(makeRole(spec, v, r));
  }
  return out;
}

/* ---------------- small helpers for spec authors ---------------- */

/** Anchors for a simple rod/handle-shaped object along Z (tip at z0 < 0, rear at z1 > 0, radius r). */
export function rodAnchors(z0: number, z1: number, r: number, y = 0): Anchors {
  return {
    tip: [0, y, z0],
    rear: [0, y, z1],
    top: [0, y + r, z0 * 0.3],
    grip: [0, y - r, Math.min(z1 * 0.4, 0.06)],
    under: [0, y - r, z0 * 0.5],
    side: [r, y, z0 * 0.3],
  };
}
