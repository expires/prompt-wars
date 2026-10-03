/**
 * Deterministic template generator: class x theme x (core, compatible part sets) -> ~20k weapon
 * templates with readable names, theme palettes, stat hints and melee metadata.
 *
 * Every template is checked with a socket simulation that mirrors assembleWeapon(), so all parts
 * attach (no missing ids, no unplaced parts).
 */
import type { PartDef, RecipePart, WeaponClass } from '../types';
import { PARTS, getPart } from '../registry';
import { SOCKET_ALIASES } from '../assemble';
import { RECIPES } from '../recipes';
import { OBJ_INFO, type ObjPartInfo } from '../gen/obj';
import { THEMES, THEME_BY_ID, themeAllowsGroup, type Palette, type Theme } from './themes';
import { BASE_STATS, BLADE_NOUNS, CLASS_NOUNS, DEFAULT_FIRE, HEAD_NOUNS, SWING_VERB, lookupNoun } from './vocab';
import type { FireMode, MeleeMeta, MeleeWeight, StatHints, Swing, Template } from './types';

export const TEMPLATE_VERSION = 1;

/* ------------------------------------------------------------------ */
/* rng / hashing                                                       */
/* ------------------------------------------------------------------ */

type Rng = () => number;

export function hashStr(s: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a: number): Rng {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickArr = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];

/* ------------------------------------------------------------------ */
/* part pools                                                          */
/* ------------------------------------------------------------------ */

type SlotKey =
  | 'barrel'
  | 'limbs'
  | 'muzzle'
  | 'stirrup'
  | 'bolt'
  | 'stock'
  | 'grip'
  | 'mag'
  | 'magTop'
  | 'magSide'
  | 'magUnder'
  | 'sight'
  | 'under'
  | 'side'
  | 'tank'
  | 'deco'
  | 'sticker';

/** which attach + categories each slot draws from */
const SLOT_DEF: Record<SlotKey, { attach: string; cats: string[] }> = {
  barrel: { attach: 'barrel', cats: ['barrel', 'launcher'] },
  limbs: { attach: 'barrel', cats: ['crossbow'] },
  muzzle: { attach: 'muzzle', cats: ['muzzle', 'launcher'] },
  stirrup: { attach: 'muzzle', cats: ['crossbow'] },
  bolt: { attach: 'top', cats: ['crossbow'] },
  stock: { attach: 'stock', cats: ['stock', 'launcher'] },
  grip: { attach: 'grip', cats: ['grip'] },
  mag: { attach: 'mag', cats: ['magazine', 'launcher'] },
  magTop: { attach: 'top', cats: ['magazine'] },
  magSide: { attach: 'side', cats: ['magazine'] },
  magUnder: { attach: 'under', cats: ['magazine'] },
  sight: { attach: 'top', cats: ['sight', 'launcher'] },
  under: { attach: 'under', cats: ['underbarrel'] },
  side: { attach: 'side', cats: ['underbarrel', 'launcher', 'crossbow'] },
  tank: { attach: 'tank', cats: ['tank'] },
  deco: { attach: 'deco', cats: ['deco'] },
  sticker: { attach: 'side', cats: ['deco'] },
};

/** slots that may fall back to socket aliases (others must find their exact socket) */
const ALIAS_OK = new Set<string>(['deco', 'barrel', 'muzzle', 'tank', 'mag', 'stock', 'pommel', 'head', 'blade', 'guard']);

/** gun schemas: ordered (slot, probability) */
const SCHEMA: Record<string, [SlotKey, number][]> = {
  pistol: [['barrel', 0.95], ['muzzle', 0.3], ['grip', 1], ['mag', 0.85], ['sight', 0.45], ['under', 0.2], ['side', 0.1], ['deco', 0.2], ['sticker', 0.1]],
  smg: [['barrel', 0.95], ['muzzle', 0.45], ['stock', 0.65], ['grip', 1], ['mag', 1], ['sight', 0.55], ['under', 0.4], ['side', 0.15], ['deco', 0.15], ['sticker', 0.08]],
  rifle: [['barrel', 1], ['muzzle', 0.65], ['stock', 0.95], ['grip', 1], ['mag', 1], ['sight', 0.8], ['under', 0.45], ['side', 0.2], ['deco', 0.12], ['sticker', 0.06]],
  shotgun: [['barrel', 1], ['muzzle', 0.3], ['stock', 0.85], ['grip', 1], ['magUnder', 0.45], ['mag', 0.35], ['under', 0.45], ['magSide', 0.2], ['sight', 0.35], ['deco', 0.15]],
  sniper: [['barrel', 1], ['muzzle', 0.7], ['stock', 1], ['grip', 1], ['mag', 0.9], ['sight', 1], ['under', 0.6], ['side', 0.1], ['deco', 0.08]],
  lmg: [['barrel', 1], ['muzzle', 0.6], ['stock', 0.75], ['grip', 1], ['mag', 0.95], ['magTop', 0.2], ['sight', 0.55], ['under', 0.6], ['magSide', 0.15], ['deco', 0.12]],
  rocket_launcher: [['barrel', 0.25], ['muzzle', 0.92], ['stock', 0.55], ['grip', 0.9], ['sight', 0.6], ['under', 0.5], ['side', 0.2], ['deco', 0.25]],
  grenade_launcher: [['barrel', 0.75], ['stock', 0.6], ['grip', 0.9], ['mag', 0.55], ['sight', 0.45], ['under', 0.3], ['side', 0.2], ['deco', 0.2]],
  flamethrower: [['barrel', 0.6], ['muzzle', 0.9], ['stock', 0.3], ['grip', 0.9], ['tank', 1], ['sight', 0.15], ['under', 0.35], ['deco', 0.25]],
  bubble_gun: [['barrel', 0.45], ['muzzle', 0.9], ['grip', 0.9], ['tank', 0.75], ['mag', 0.35], ['magTop', 0.2], ['deco', 0.35]],
  blowgun: [['muzzle', 0.7], ['bolt', 0.25], ['stock', 0.8], ['mag', 0.5], ['sight', 0.15], ['deco', 0.35], ['sticker', 0.1]],
  crossbow: [['limbs', 1], ['bolt', 0.85], ['stirrup', 0.45], ['stock', 0.7], ['grip', 0.9], ['sight', 0.45], ['side', 0.25], ['deco', 0.2]],
  weird: [['barrel', 0.6], ['muzzle', 0.8], ['stock', 0.4], ['grip', 0.85], ['mag', 0.6], ['sight', 0.4], ['tank', 0.3], ['deco', 0.7], ['sticker', 0.3]],
};

/** object-core gun schema per class (the object itself is the body + barrel) */
function objSchema(cls: string, selfGrip: boolean): [SlotKey, number][] {
  const s: [SlotKey, number][] = [];
  if (cls === 'crossbow') s.push(['limbs', 0.45], ['bolt', 0.6]);
  else s.push(['barrel', 0.1]);
  const mz = cls === 'rocket_launcher' ? 0.8 : cls === 'flamethrower' ? 0.75 : cls === 'bubble_gun' ? 0.7 : cls === 'blowgun' ? 0.5 : 0.35;
  s.push(['muzzle', mz]);
  s.push(['stock', cls === 'sniper' || cls === 'rifle' ? 0.25 : 0.1]);
  if (!selfGrip) s.push(['grip', cls === 'blowgun' ? 0.2 : 0.92]);
  if (cls === 'flamethrower') s.push(['tank', 0.85]);
  else if (cls === 'bubble_gun') s.push(['tank', 0.5], ['mag', 0.25]);
  else if (cls !== 'rocket_launcher' && cls !== 'crossbow' && cls !== 'blowgun') s.push(['mag', cls === 'grenade_launcher' ? 0.4 : 0.55]);
  s.push(['sight', cls === 'sniper' ? 0.95 : 0.4], ['under', 0.15], ['deco', 0.5], ['sticker', 0.15]);
  return s;
}

const isObj = (id: string) => OBJ_INFO.has(id);
const objInfo = (id: string): ObjPartInfo | undefined => OBJ_INFO.get(id);
const isEverydayObj = (id: string) => {
  const i = OBJ_INFO.get(id);
  return !!i && i.spec.group !== 'weapon';
};

interface Pools {
  slot: Map<string, PartDef[]>;
  gunCores: Map<string, PartDef[]>;
  objCores: PartDef[];
  handles: Map<string, PartDef>;
  heads: PartDef[];
  blades: PartDef[];
  guards: PartDef[];
  pommels: PartDef[];
  decos: PartDef[];
  stickers: PartDef[];
}

let POOLS: Pools | null = null;

function pools(): Pools {
  if (POOLS) return POOLS;
  const slot = new Map<string, PartDef[]>();
  const gunCores = new Map<string, PartDef[]>();
  const objCores: PartDef[] = [];
  const handles = new Map<string, PartDef>();
  const heads: PartDef[] = [];
  const blades: PartDef[] = [];
  const guards: PartDef[] = [];
  const pommels: PartDef[] = [];
  const decos: PartDef[] = [];
  const stickers: PartDef[] = [];
  for (const p of PARTS) {
    if (p.category === 'core') {
      if (isObj(p.id)) objCores.push(p);
      else if (p.id.startsWith('core-handle-')) handles.set(p.id, p);
      else for (const c of p.classes) (gunCores.get(c) ?? gunCores.set(c, []).get(c)!).push(p);
      continue;
    }
    if (p.category === 'head') heads.push(p);
    if (p.category === 'blade') blades.push(p);
    if (p.category === 'guard') guards.push(p);
    if (p.category === 'pommel') pommels.push(p);
    if (p.category === 'deco' && p.attach === 'deco') decos.push(p);
    if (p.category === 'deco' && p.attach === 'side') stickers.push(p);
    for (const [k, d] of Object.entries(SLOT_DEF)) {
      if (d.attach !== p.attach || !d.cats.includes(p.category)) continue;
      (slot.get(k) ?? slot.set(k, []).get(k)!).push(p);
    }
  }
  POOLS = { slot, gunCores, objCores, handles, heads, blades, guards, pommels, decos, stickers };
  return POOLS;
}

/* weighted pools cached per (key, theme) */
interface WPool {
  items: PartDef[];
  cum: Float64Array;
  total: number;
}
const wcache = new Map<Theme, Map<string, WPool>>();

const likeSets = new Map<string, [Set<string>, Set<string>]>();
const twCache = new Map<Theme, Map<PartDef, number>>();
function themeWeight(p: PartDef, t: Theme): number {
  let m = twCache.get(t);
  if (!m) twCache.set(t, (m = new Map()));
  let v = m.get(p);
  if (v === undefined) m.set(p, (v = themeWeightRaw(p, t)));
  return v;
}
function themeWeightRaw(p: PartDef, t: Theme): number {
  let ls = likeSets.get(t.id);
  if (!ls) likeSets.set(t.id, (ls = [new Set(t.like), new Set(t.avoid)]));
  let like = 0;
  let avoid = 0;
  for (const tag of p.tags) {
    if (ls[0].has(tag)) like++;
    if (ls[1].has(tag)) avoid++;
  }
  let w = 1 + 2.5 * like - 3 * avoid;
  const info = objInfo(p.id);
  if (info) {
    const g = themeAllowsGroup(t, info.spec.group);
    if (g === 0) return 0;
    w *= g === 2 ? 3 : 0.6;
  }
  return Math.max(w, 0.08);
}

function wpool(key: string, t: Theme, itemsOrFn: PartDef[] | (() => PartDef[]), extra?: (p: PartDef) => number): WPool {
  let tm = wcache.get(t);
  if (!tm) wcache.set(t, (tm = new Map()));
  let wp = tm.get(key);
  if (wp) return wp;
  const items = typeof itemsOrFn === 'function' ? itemsOrFn() : itemsOrFn;
  const kept: PartDef[] = [];
  const ws: number[] = [];
  for (const p of items) {
    let w = themeWeight(p, t);
    if (extra) w *= extra(p);
    if (w > 0) {
      kept.push(p);
      ws.push(w);
    }
  }
  const cum = new Float64Array(kept.length);
  let total = 0;
  for (let i = 0; i < kept.length; i++) cum[i] = total += ws[i];
  wp = { items: kept, cum, total };
  tm.set(key, wp);
  return wp;
}

function wpick(r: Rng, wp: WPool): PartDef | undefined {
  if (!wp.items.length) return undefined;
  const x = r() * wp.total;
  let lo = 0;
  let hi = wp.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (wp.cum[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return wp.items[lo];
}

const baseCache = new Map<string, PartDef[]>();
function baseList(key: string, fn: () => PartDef[]): PartDef[] {
  let l = baseCache.get(key);
  if (!l) baseCache.set(key, (l = fn()));
  return l;
}

const dbCache = new Map<Theme, (p: PartDef) => number>();
const decoBoost = (t: Theme) => {
  let f = dbCache.get(t);
  if (!f) {
    const re = new RegExp(t.decoWords.map((w) => w.replace(/[^a-z0-9-]/g, '')).join('|'));
    dbCache.set(t, (f = (p: PartDef) => (re.test(p.id) ? 6 : 1)));
  }
  return f;
};

const SLOT_KEYS = new Map<string, Map<string, string>>();
function slotKey(slot: string, cls: string, mode: string): string {
  let m = SLOT_KEYS.get(slot);
  if (!m) SLOT_KEYS.set(slot, (m = new Map()));
  const k2 = mode === 'obj' ? cls + '*' : cls;
  let k = m.get(k2);
  if (!k) m.set(k2, (k = `slot:${slot}:${cls}:${mode}`));
  return k;
}

/** slot pool filtered for a class. mode 'std' damps object parts, 'obj' keeps only everyday-object parts */
function slotPool(slot: SlotKey, cls: string, t: Theme, mode: 'std' | 'obj' = 'std'): WPool {
  const P = pools();
  const base = P.slot.get(slot) ?? [];
  const key = slotKey(slot, cls, mode);
  return wpool(
    key,
    t,
    () => baseList(key, () => base.filter((p) => {
      if (mode === 'obj' && !isEverydayObj(p.id)) return false;
      if (p.classes.includes(cls)) return true;
      if (cls === 'weird') return p.tags.includes('silly') || p.tags.includes('toy') || isEverydayObj(p.id);
      return false;
    })),
    (p) => {
      let w = slot === 'deco' || slot === 'sticker' ? decoBoost(t)(p) : 1;
      if (mode === 'std' && isObj(p.id)) w *= slot === 'deco' ? 0.6 : 0.12;
      return w;
    },
  );
}

/* ------------------------------------------------------------------ */
/* socket simulation (mirrors assembleWeapon)                          */
/* ------------------------------------------------------------------ */

class Build {
  parts: RecipePart[] = [];
  defs: PartDef[] = [];
  private placed: { s: Record<string, unknown>; used: Set<string> }[] = [];

  /** returns true if the part was placed (and appended) */
  add(def: PartDef | undefined, color?: string, accent?: string, aliasOk = true): boolean {
    if (!def) return false;
    for (let i = 0; i < this.defs.length; i++) if (this.defs[i] === def) return false;
    if (this.placed.length === 0) {
      this.placed.push({ s: def.sockets, used: new Set() });
    } else {
      const want = def.attach || 'deco';
      const names = aliasOk && ALIAS_OK.has(want) ? [want, ...(SOCKET_ALIASES[want] ?? [])] : [want];
      let hit: { i: number; name: string } | null = null;
      outer: for (const name of names) {
        for (let i = this.placed.length - 1; i >= 0; i--) {
          const p = this.placed[i];
          if (p.s[name] && !p.used.has(name)) {
            hit = { i, name };
            break outer;
          }
        }
      }
      if (!hit) return false;
      this.placed[hit.i].used.add(hit.name);
      this.placed.push({ s: def.sockets, used: new Set() });
    }
    const rp: RecipePart = { partId: def.id };
    if (color) rp.color = color;
    if (accent) rp.accent = accent;
    this.parts.push(rp);
    this.defs.push(def);
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* naming helpers                                                      */
/* ------------------------------------------------------------------ */

function clampWords(s: string, n: number): string {
  const w = s.split(/\s+/);
  return w.length <= n ? s : w.slice(0, n).join(' ').replace(/[,;]$/, '') + '.';
}

const lc = (s: string) => s.toLowerCase();
const an = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
/** core desc trimmed to a short noun phrase */
const shortDesc = (d: string) => {
  const w = d.split(/[(,]/)[0].trim().split(/\s+/).slice(0, 6);
  while (w.length > 1 && /^(with|and|for|of|on|in|a|the|to)$/.test(w[w.length - 1])) w.pop();
  return w.join(' ');
};

function classNoun(r: Rng, cls: string, t: Theme): string {
  const o = t.nouns?.[cls];
  if (o && r() < 0.5) return pickArr(r, o);
  return pickArr(r, CLASS_NOUNS[cls] ?? ['Weapon']);
}

function objNoun(info: ObjPartInfo): string {
  return info.variant.noun ?? info.spec.noun;
}

function featureWord(defs: PartDef[]): string | undefined {
  for (const d of defs) {
    const id = d.id;
    if (d.category === 'magazine' && /drum/.test(id)) return 'Drum';
    if (d.category === 'magazine' && /belt/.test(id)) return 'Belt-Fed';
    if (d.category === 'muzzle' && /suppressor|silencer/.test(id)) return 'Silenced';
    if (d.category === 'sight' && /scope/.test(id)) return 'Scoped';
    if (d.category === 'barrel' && /rotary/.test(id)) return 'Rotary';
    if (d.category === 'barrel' && /-(sbs|ou)-/.test(id)) return 'Double-Barrel';
    if (d.category === 'core' && /bullpup/.test(id)) return 'Bullpup';
    if (d.category === 'underbarrel' && /bayonet/.test(id)) return 'Bayonet';
    if (d.category === 'barrel' && /coil/.test(id)) return 'Coil';
    if (d.category === 'stock' && /sawnoff/.test(id)) return 'Sawn-Off';
  }
  return undefined;
}

/** "Adj Noun" unless the adjective repeats a word of the noun ("Laser Laser Sword") */
function combo(adj: string, noun: string): string | null {
  const a = adj.toLowerCase().split(/[\s-]+/);
  const n = noun.toLowerCase().split(/[\s-]+/);
  return a.some((w) => n.includes(w)) ? null : `${adj} ${noun}`;
}

const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/* ------------------------------------------------------------------ */
/* the generator                                                       */
/* ------------------------------------------------------------------ */

/** signatures already emitted during a generateTemplates() run (drafts bail out early on dupes) */
let SEEN: Set<string> | null = null;
function dupe(b: Build): boolean {
  return !!SEEN && SEEN.has(signature(b.parts));
}

interface Draft {
  b: Build;
  name: string;
  /** alternative names if `name` is taken */
  alts: string[];
  cls: WeaponClass;
  fireMode: FireMode;
  desc: string;
  keywords: string[];
  tags: string[];
  melee?: MeleeMeta;
  stats?: StatHints;
}

const GUN_CLASSES: WeaponClass[] = [
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
];

export const CLASS_TARGET: Record<string, number> = {
  pistol: 1150,
  smg: 1100,
  rifle: 1200,
  shotgun: 1200,
  sniper: 1050,
  lmg: 1050,
  rocket_launcher: 1100,
  grenade_launcher: 1050,
  flamethrower: 1100,
  bubble_gun: 1000,
  blowgun: 900,
  crossbow: 950,
  weird: 1500,
  melee: 5900,
};

function colorFor(r: Rng, pal: Palette, role: 'core' | 'main' | 'dark' | 'accent' | 'keep'): [string | undefined, string | undefined] {
  switch (role) {
    case 'core':
      return [pal[0], pal[1]];
    case 'main':
      return [pal[0], pal[1]];
    case 'dark':
      return [pal[2], pal[1]];
    case 'accent':
      return [pal[1], pal[0]];
    default:
      return r() < 0.3 ? [undefined, pal[1]] : [undefined, undefined];
  }
}

const SLOT_COLOR: Record<SlotKey, 'main' | 'dark' | 'accent' | 'keep'> = {
  barrel: 'dark',
  limbs: 'dark',
  muzzle: 'dark',
  stirrup: 'dark',
  bolt: 'keep',
  stock: 'main',
  grip: 'dark',
  mag: 'dark',
  magTop: 'accent',
  magSide: 'dark',
  magUnder: 'dark',
  sight: 'dark',
  under: 'dark',
  side: 'dark',
  tank: 'main',
  deco: 'keep',
  sticker: 'keep',
};

function addSlot(r: Rng, b: Build, slot: SlotKey, cls: string, t: Theme, pal: Palette, mode: 'std' | 'obj' = 'std'): PartDef | undefined {
  const wp = slotPool(slot, cls, t, mode);
  for (let tries = 0; tries < 3; tries++) {
    const p = wpick(r, wp);
    if (!p) return undefined;
    let [c, a] = colorFor(r, pal, SLOT_COLOR[slot]);
    if (isObj(p.id) && (themeAllowsGroup(t, objInfo(p.id)!.spec.group) === 2 || r() < 0.6)) [c, a] = [undefined, undefined];
    if (b.add(p, c, a, ALIAS_OK.has(SLOT_DEF[slot].attach))) return p;
  }
  return undefined;
}

function statsFor(cls: string, defs: PartDef[], t: Theme, melee?: MeleeMeta): StatHints {
  if (melee) {
    const w = melee.weight;
    return { damage: w === 'heavy' ? 'high' : w === 'light' ? 'low' : 'med', fireRate: w === 'heavy' ? 'slow' : w === 'light' ? 'fast' : 'med', range: melee.reach > 1.1 ? 'med' : 'short' };
  }
  const s: StatHints = { ...BASE_STATS[cls] };
  for (const d of defs) {
    if (d.category === 'magazine' && /drum|belt|huge|extended|pan|helical/.test(d.id)) s.magSize = 'large';
    if (d.category === 'sight' && /scope/.test(d.id)) s.range = 'long';
    if (d.category === 'barrel' && /rotary/.test(d.id)) s.fireRate = 'fast';
  }
  if (t.id === 'toy' || t.id === 'party') s.damage = s.damage === 'high' ? 'med' : 'low';
  return s;
}

function fireFor(cls: string, defs: PartDef[], r: Rng): FireMode {
  const core = objInfo(defs[0].id);
  if ((cls === 'weird' || cls === 'bubble_gun') && core?.spec.fireMode) return core.spec.fireMode;
  if (cls !== 'weird') return DEFAULT_FIRE[cls];
  for (const d of defs) {
    if (/flame|tank-/.test(d.id)) return 'stream';
    if (/bubble|soap/.test(d.id)) return 'projectile';
    if (/warhead|launcher-tube/.test(d.id)) return 'projectile';
    if (/core-grenade/.test(d.id)) return 'arc';
  }
  return pickArr(r, ['projectile', 'projectile', 'arc', 'hitscan'] as FireMode[]);
}

function tagsFor(t: Theme, cls: string, defs: PartDef[], extra: string[] = []): string[] {
  const out = new Set<string>([t.id, cls, ...extra]);
  let everyday = false;
  for (const d of defs) {
    const i = objInfo(d.id);
    if (i && i.spec.group !== 'weapon' && i.role !== 'deco') {
      everyday = true;
      out.add(i.spec.group);
    }
  }
  if (everyday) out.add('everyday');
  for (const tag of defs[0].tags) if (out.size < 9) out.add(tag);
  return [...out];
}

function keywordsFor(t: Theme, cls: string, defs: PartDef[], nouns: string[], extra: string[] = []): string[] {
  const k = new Set<string>();
  for (const n of nouns) for (const w of lc(n).split(/[\s-]+/)) if (w.length > 1) k.add(w);
  for (const d of defs) {
    const i = objInfo(d.id);
    if (i) {
      for (const w of lc(objNoun(i)).split(/\s+/)) k.add(w);
      for (const s of i.spec.syn.slice(0, 4)) k.add(lc(s));
      if (i.spec.ammo) k.add(lc(i.spec.ammo));
    }
  }
  for (const e of extra) k.add(lc(e));
  for (const w of t.keywords.slice(0, 3)) k.add(w);
  k.add(cls.replace('_', ' '));
  return [...k].slice(0, 14);
}

/* ----------------------------- guns ------------------------------- */

function gunDraft(r: Rng, cls: WeaponClass, t: Theme, mode: 'std' | 'objcore' | 'objpart'): Draft | null {
  const P = pools();
  const pal = pickArr(r, t.palettes);
  const b = new Build();
  let coreInfo: ObjPartInfo | undefined;

  if (mode === 'objcore') {
    const wp = wpool(`objcore:${cls}`, t, () => baseList(`objcore:${cls}`, () => P.objCores.filter((p) => cls === 'weird' || objInfo(p.id)!.spec.guns?.includes(cls))));
    const core = wpick(r, wp);
    if (!core) return null;
    coreInfo = objInfo(core.id)!;
    const home = themeAllowsGroup(t, coreInfo.spec.group) === 2;
    const [c, a] = home && r() < 0.65 ? [undefined, undefined] : [pal[0], pal[1]];
    b.add(core, c, a);
    for (const [slot, prob] of objSchema(cls, !!coreInfo.spec.selfGrip)) {
      if (r() >= prob) continue;
      if (slot === 'muzzle' && r() < 0.35) addSlot(r, b, slot, cls, t, pal, 'obj') || addSlot(r, b, slot, cls, t, pal);
      else if (slot === 'mag' && r() < 0.5) addSlot(r, b, slot, cls, t, pal, 'obj') || addSlot(r, b, slot, cls, t, pal);
      else addSlot(r, b, slot, cls, t, pal);
    }
  } else {
    const core = wpick(r, wpool(`gcore:${cls}`, t, () => (P.gunCores.get(cls) ?? []).filter((p) => p.sockets.barrel || p.sockets.muzzle)));
    if (!core) return null;
    b.add(core, pal[0], pal[1]);
    const schema = SCHEMA[cls];
    let forced: SlotKey | undefined;
    if (mode === 'objpart') {
      const cands = (['barrel', 'muzzle', 'mag'] as SlotKey[]).filter((s) => schema.some(([k]) => k === s) && slotPool(s, cls, t, 'obj').items.length);
      if (!cands.length) return null;
      forced = pickArr(r, cands);
    }
    for (const [slot, prob] of schema) {
      if (slot === forced) {
        if (!addSlot(r, b, slot, cls, t, pal, 'obj')) return null;
        continue;
      }
      if (r() < prob) addSlot(r, b, slot, cls, t, pal);
    }
    if (forced && !b.defs.some((d) => isEverydayObj(d.id))) return null;
  }
  if (b.defs.length < 2 || dupe(b)) return null;

  // naming
  const noun = classNoun(r, cls, t);
  const adjs = [...t.adj];
  const adj = pickArr(r, adjs);
  const names: string[] = [];
  let desc: string;
  const kwNouns: string[] = [noun];
  if (coreInfo) {
    const on = objNoun(coreInfo);
    kwNouns.push(on);
    const home = themeAllowsGroup(t, coreInfo.spec.group) === 2;
    if (home && r() < 0.5) names.push(`${on} ${noun}`);
    for (let i = 0; i < 4; i++) {
      const c = combo(pickArr(r, adjs), `${on} ${noun}`);
      if (c) names.push(c);
    }
    names.push(`${on} ${noun}`);
    desc = `${an(on) === 'an' ? 'An' : 'A'} ${lc(on)} rigged up as ${an(noun)} ${lc(noun)}${coreInfo.spec.ammo ? `, firing ${coreInfo.spec.ammo}` : ''}.`;
  } else {
    const objPart = b.defs.slice(1).find((d) => isEverydayObj(d.id));
    if (objPart) {
      const oi = objInfo(objPart.id)!;
      const on = objNoun(oi);
      kwNouns.push(on);
      const suffix = oi.role === 'barrel' ? '-Barrel' : oi.role === 'mag' ? '-Fed' : '-Tipped';
      for (let i = 0; i < 4; i++) {
        const c = combo(pickArr(r, adjs), `${on}${suffix} ${noun}`);
        if (c) names.push(c);
      }
      names.push(`${on}${suffix} ${noun}`);
      desc = `${an(t.label) === 'an' ? 'An' : 'A'} ${lc(t.label)} ${lc(noun)} with ${an(on)} ${lc(on)} ${oi.role === 'mag' ? 'for a magazine' : oi.role === 'barrel' ? 'for a barrel' : 'on the muzzle'}.`;
    } else {
      const feat = featureWord(b.defs);
      const push = (c: string | null) => c && names.push(c);
      if (feat && r() < 0.6) push(combo(adj, `${feat} ${noun}`));
      for (let i = 0; i < 4; i++) push(combo(pickArr(r, adjs), noun));
      if (feat) push(combo(pickArr(r, adjs), `${feat} ${noun}`));
      if (!names.length) names.push(`${t.label} ${noun}`);
      const coreDesc = shortDesc(b.defs[0].desc);
      desc = `${t.label} ${lc(noun)} built on ${an(coreDesc)} ${coreDesc}.`;
    }
  }
  const fireMode = fireFor(cls, b.defs, r);
  return {
    b,
    name: names[0],
    alts: names.slice(1),
    cls,
    fireMode,
    desc: clampWords(desc, 15),
    keywords: keywordsFor(t, cls, b.defs, kwNouns, [adj]),
    tags: tagsFor(t, cls, b.defs),
    stats: statsFor(cls, b.defs, t),
  };
}

/* ----------------------------- melee ------------------------------ */

const H = (id: string) => pools().handles.get(id);
const handleLen = (h: PartDef) => (h.sockets.pommel ? h.sockets.pommel.pos[2] : 0.2);
const handOffset = (h: PartDef) => Math.min(Math.max(handleLen(h) * 0.45, 0.05), 0.85);
const round05 = (x: number) => Math.round(x * 20) / 20;

type BladeFam = 'eastern' | 'energy' | 'knife' | 'great' | 'western' | 'silly';

function bladeFamily(p: PartDef): BladeFam {
  const id = p.id;
  if (isObj(id)) return 'silly';
  if (/katana|wakizashi|nodachi/.test(id)) return 'eastern';
  if (/energy|lightning|crystal/.test(id)) return 'energy';
  if (/dagger|bowie|tanto|cleaver|karambit|kris|serrated|machete/.test(id)) return 'knife';
  if (/great|zweihander|flamberge|broadsword|jagged-2|chainsaw/.test(id)) return 'great';
  if (p.tags.includes('silly') || p.tags.includes('toy')) return 'silly';
  return 'western';
}

const FAM_HANDLES: Record<BladeFam, string[]> = {
  eastern: ['core-handle-tsuka-short', 'core-handle-tsuka-long'],
  energy: ['core-handle-hilt', 'core-handle-hilt-short'],
  knife: ['core-handle-knife', 'core-handle-knife-big', 'core-handle-dagger'],
  great: ['core-handle-greatsword', 'core-handle-bastard'],
  western: ['core-handle-sword', 'core-handle-bastard', 'core-handle-dagger', 'core-handle-bone'],
  silly: ['core-handle-foam', 'core-handle-sword', 'core-handle-pan', 'core-handle-bone', 'core-handle-bat'],
};

function guardOk(fam: BladeFam, g: PartDef): boolean {
  const id = g.id;
  if (fam === 'eastern') return id.includes('tsuba');
  if (fam === 'energy') return id.includes('emitter');
  if (fam === 'knife') return id.includes('bolster') || id.includes('knucklebow') || id.includes('cross-short');
  if (/tsuba|emitter|bolster/.test(id)) return false;
  if (fam === 'silly') return true;
  return !/toy|trigger/.test(id);
}

/** theme melee noun overrides only apply to fitting blades */
const MELEE_OVERRIDE_OK: Record<string, (id: string, fam: BladeFam) => boolean> = {
  Katana: (id) => /katana|nodachi/.test(id),
  Blade: (_id, fam) => fam === 'eastern',
  Cutlass: (id) => /sabre|scimitar|falchion|machete/.test(id),
  Bowie: (id) => /bowie/.test(id),
  Saber: (_id, fam) => fam === 'energy',
};

function bladeColor(r: Rng, t: Theme, pal: Palette, p: PartDef): [string | undefined, string | undefined] {
  if (isObj(p.id)) return [undefined, undefined];
  if (t.blade === 'glow' && /energy|crystal|lightning/.test(p.id)) return [undefined, pal[1]];
  if (t.blade === 'palette' && r() < 0.7) return [pal[0], pal[1]];
  if (p.tags.includes('silly') || p.tags.includes('toy')) return [undefined, undefined];
  return r() < 0.15 ? [pal[0], pal[1]] : [undefined, pal[1]];
}

function meleeName(r: Rng, t: Theme, noun: string, extra: string[] = []): string[] {
  const out: string[] = [...extra];
  if (r() < 0.25) out.push(`${noun} of ${pickArr(r, t.epithets)}`);
  for (let i = 0; i < 4; i++) {
    const c = combo(pickArr(r, t.adj), noun);
    if (c) out.push(c);
  }
  out.push(`${noun} of ${pickArr(r, t.epithets)}`);
  return out;
}

function meleeDraft(b: Build, _r: Rng, t: Theme, names: string[] | (() => string[]), noun: string, swing: Swing, weight: MeleeWeight, reach: number, extraKw: string[] = []): Draft {
  if (typeof names === 'function') names = names();
  const melee: MeleeMeta = { swing, reach: Math.min(2.5, Math.max(0.3, round05(reach))), weight };
  const heavy = weight === 'heavy' ? ' with crushing force' : weight === 'light' ? ' with quick strikes' : '';
  const desc = clampWords(`${an(t.label) === 'an' ? 'An' : 'A'} ${lc(t.label)} ${lc(noun)} that ${SWING_VERB[swing]} foes${heavy}.`, 15);
  return {
    b,
    name: names[0],
    alts: names.slice(1),
    cls: 'melee',
    fireMode: 'melee',
    desc,
    keywords: keywordsFor(t, 'melee', b.defs, [noun], [swing, ...extraKw]),
    tags: tagsFor(t, 'melee', b.defs, [swing]),
    melee,
    stats: statsFor('melee', b.defs, t, melee),
  };
}

function addMeleeExtras(r: Rng, b: Build, t: Theme, pal: Palette, pPommel: number, pDeco: number, pSticker = 0.1) {
  const P = pools();
  if (r() < pPommel) {
    const pm = wpick(r, wpool('pommel', t, P.pommels));
    b.add(pm, r() < 0.5 ? pal[1] : undefined, pal[1]);
  }
  if (r() < pDeco) {
    const d = wpick(r, wpool('mdeco', t, P.decos, (p) => decoBoost(t)(p) * (isObj(p.id) ? 0.5 : 1)));
    b.add(d, undefined, r() < 0.4 ? pal[1] : undefined);
  }
  if (r() < pSticker) b.add(wpick(r, wpool('sticker', t, P.stickers, decoBoost(t))), undefined, pal[1]);
}

function meleeObjCore(r: Rng, t: Theme): Draft | null {
  const P = pools();
  const core = wpick(r, wpool('objmelee', t, () => P.objCores.filter((p) => objInfo(p.id)!.spec.melee)));
  if (!core) return null;
  const info = objInfo(core.id)!;
  const pal = pickArr(r, t.palettes);
  const home = themeAllowsGroup(t, info.spec.group) === 2;
  const b = new Build();
  const [c, a] = home && r() < 0.6 ? [undefined, undefined] : [pal[0], pal[1]];
  b.add(core, c, a);
  addMeleeExtras(r, b, t, pal, 0.25, 0.6, 0.15);
  if (dupe(b)) return null;
  const noun = objNoun(info);
  const names = meleeName(r, t, noun, home && r() < 0.3 ? [`${pickArr(r, t.adj)} ${noun}`] : []);
  const m = info.spec.melee!;
  return meleeDraft(b, r, t, names, noun, m.swing, m.weight, info.reach + 0.06);
}

function meleeSword(r: Rng, t: Theme, objBlade: boolean): Draft | null {
  const P = pools();
  const blade = wpick(r, wpool(objBlade ? 'oblade' : 'blade', t, () => (objBlade ? P.blades.filter((p) => isEverydayObj(p.id)) : P.blades.filter((p) => !isObj(p.id)))));
  if (!blade) return null;
  const fam = bladeFamily(blade);
  const handle = wpick(r, wpool(`fh:${fam}`, t, () => FAM_HANDLES[fam].map(H).filter(Boolean) as PartDef[]));
  if (!handle) return null;
  const pal = pickArr(r, t.palettes);
  const b = new Build();
  b.add(handle, pal[2], pal[1]);
  if (r() < (fam === 'knife' ? 0.5 : objBlade ? 0.6 : 0.88)) {
    const g = wpick(r, wpool(`guard:${fam}`, t, () => P.guards.filter((g) => guardOk(fam, g))));
    b.add(g, r() < 0.5 ? pal[1] : undefined, pal[1]);
  }
  const [bc, ba] = bladeColor(r, t, pal, blade);
  if (!b.add(blade, bc, ba)) return null;
  addMeleeExtras(r, b, t, pal, fam === 'energy' ? 0.5 : 0.75, 0.12, 0.05);
  if (dupe(b)) return null;
  let noun: string;
  let swing: Swing;
  let weight: MeleeWeight;
  const oi = objInfo(blade.id);
  if (oi) {
    noun = `${objNoun(oi)} Sword`;
    swing = oi.spec.melee?.swing === 'thrust' ? 'thrust' : 'slash';
    weight = oi.spec.melee?.weight ?? 'light';
  } else [noun, swing, weight] = lookupNoun(BLADE_NOUNS, blade.id);
  const thn = (t.nouns?.melee ?? []).filter((n) => MELEE_OVERRIDE_OK[n]?.(blade.id, fam));
  if (!oi && thn.length && r() < 0.3) noun = pickArr(r, thn);
  const bladeLen = blade.sockets.muzzle ? -blade.sockets.muzzle.pos[2] : 0.6;
  return meleeDraft(b, r, t, meleeName(r, t, noun), noun, swing, weight, bladeLen + 0.03 + handOffset(handle), oi ? [objNoun(oi), 'sword'] : []);
}

function headHandles(swing: Swing, id: string, long: boolean): string[] {
  if (/scythe/.test(id)) return ['core-handle-snath', 'core-handle-shaft'];
  if (swing === 'thrust' || long) return ['core-handle-shaft', 'core-handle-shaft-long'];
  if (swing === 'slash') return ['core-handle-shaft', 'core-handle-shaft-long', 'core-handle-haft-long'];
  if (swing === 'overhead') return ['core-handle-haft-short', 'core-handle-haft-long', 'core-handle-mace', 'core-handle-bone'];
  return ['core-handle-haft-short', 'core-handle-bat', 'core-handle-mace', 'core-handle-pan', 'core-handle-foam', 'core-handle-bone'];
}

const HANDLE_NOUN: Record<string, string> = {
  'core-handle-shaft': 'Polearm',
  'core-handle-shaft-long': 'Pike',
  'core-handle-haft-short': 'Club',
  'core-handle-haft-long': 'Maul',
  'core-handle-mace': 'Mace',
  'core-handle-bat': 'Bat',
  'core-handle-pan': 'Whacker',
  'core-handle-foam': 'Bopper',
  'core-handle-bone': 'Club',
  'core-handle-snath': 'Reaper',
};

function meleeHafted(r: Rng, t: Theme, objHead: boolean): Draft | null {
  const P = pools();
  const head = wpick(r, wpool(objHead ? 'ohead' : 'head', t, () => (objHead ? P.heads.filter((p) => isObj(p.id)) : P.heads.filter((p) => !isObj(p.id)))));
  if (!head) return null;
  const oi = objInfo(head.id);
  let noun: string;
  let swing: Swing;
  let weight: MeleeWeight;
  let headLen: number;
  if (oi) {
    noun = objNoun(oi);
    swing = oi.spec.melee?.swing ?? 'bash';
    weight = oi.spec.melee?.weight ?? 'medium';
    headLen = oi.reach;
  } else {
    [noun, swing, weight] = lookupNoun(HEAD_NOUNS, head.id);
    headLen = swing === 'thrust' || swing === 'slash' ? 0.3 : 0.18;
  }
  const long = (!!oi && oi.spec.group !== 'weapon' && headLen > 0.35) || /halberd|poleaxe|bardiche|lance|war-scythe/.test(head.id);
  const handle = wpick(r, wpool(`hh:${swing}:${long}:${/scythe/.test(head.id)}`, t, () => headHandles(swing, head.id, long).map(H).filter(Boolean) as PartDef[]));
  if (!handle) return null;
  const pal = pickArr(r, t.palettes);
  const b = new Build();
  b.add(handle, pal[2], pal[1]);
  const metal = !oi && !head.tags.includes('silly') && !head.tags.includes('toy');
  const [hc, ha] = oi ? [undefined, undefined] : metal ? (r() < 0.25 ? [pal[0], pal[1]] : [undefined, pal[1]]) : r() < 0.5 ? [pal[0], pal[1]] : [undefined, undefined];
  if (!b.add(head, hc, ha)) return null;
  addMeleeExtras(r, b, t, pal, 0.45, 0.3, 0.08);
  if (dupe(b)) return null;
  if (handleLen(handle) > 1.0 && weight === 'medium') weight = 'heavy';
  let fullNoun = noun;
  if (oi && oi.spec.group !== 'weapon') {
    const hn = HANDLE_NOUN[handle.id] ?? 'Stick';
    fullNoun = r() < 0.5 ? `${noun} ${hn}` : `${noun}-on-a-Stick`;
  }
  return meleeDraft(b, r, t, meleeName(r, t, fullNoun), fullNoun, swing, weight, headLen + handOffset(handle), [noun]);
}

/* ----------------------------- driver ----------------------------- */

const MELEE_MODES: [string, number][] = [
  ['objcore', 0.4],
  ['sword', 0.22],
  ['hafted', 0.2],
  ['objhead', 0.1],
  ['objblade', 0.08],
];

function pickMode(r: Rng, modes: [string, number][]): string {
  let tot = 0;
  for (const [, w] of modes) tot += w;
  let x = r() * tot;
  for (const [m, w] of modes) {
    x -= w;
    if (x <= 0) return m;
  }
  return modes[modes.length - 1][0];
}

const PART_NUM = new Map<string, number>();
function signature(parts: RecipePart[]): string {
  const nums: number[] = [];
  for (const p of parts) {
    let n = PART_NUM.get(p.partId);
    if (n === undefined) PART_NUM.set(p.partId, (n = PART_NUM.size));
    nums.push(n);
  }
  nums.sort((a, b) => a - b);
  return nums.join('+');
}

function toBase36(h1: number, h2: number): string {
  return (h1.toString(36) + h2.toString(36).padStart(7, '0')).slice(0, 12);
}

function meleeFromRecipe(parts: RecipePart[]): MeleeMeta {
  const defs = parts.map((p) => getPart(p.partId)).filter(Boolean) as PartDef[];
  const handle = defs[0];
  const blade = defs.find((d) => d.category === 'blade');
  const head = defs.find((d) => d.category === 'head');
  if (blade) {
    const [, swing, weight] = lookupNoun(BLADE_NOUNS, blade.id);
    const len = blade.sockets.muzzle ? -blade.sockets.muzzle.pos[2] : 0.6;
    return { swing, weight, reach: round05(len + 0.03 + handOffset(handle)) };
  }
  if (head) {
    const [, swing, weight] = lookupNoun(HEAD_NOUNS, head.id);
    const len = swing === 'thrust' || swing === 'slash' ? 0.3 : 0.18;
    return { swing, weight, reach: Math.max(0.3, round05(len + handOffset(handle))) };
  }
  return { swing: 'bash', weight: 'medium', reach: 0.6 };
}

function inferTheme(defs: PartDef[], name: string): Theme {
  const ln = lc(name);
  let best = THEMES[0];
  let bestScore = -1;
  for (const t of THEMES) {
    let s = 0;
    for (const d of defs) s += Math.max(themeWeight(d, t), 0) - 1;
    for (const k of t.keywords) if (ln.includes(k)) s += 6;
    for (const a of t.adj) if (ln.includes(lc(a))) s += 6;
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
}

export function curatedTemplates(): Template[] {
  return RECIPES.map((rc) => {
    const defs = rc.parts.map((p) => getPart(p.partId)).filter(Boolean) as PartDef[];
    const t = inferTheme(defs, rc.name);
    const cls = rc.class as WeaponClass;
    const melee = cls === 'melee' ? meleeFromRecipe(rc.parts) : undefined;
    const words = rc.name.split(/\s+/);
    const slug = lc(rc.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      id: `curated-${slug}`,
      name: rc.name,
      class: cls,
      fireMode: cls === 'weird' ? fireFor(cls, defs, mulberry32(hashStr(rc.name))) : DEFAULT_FIRE[cls],
      tags: [...new Set([t.id, cls, 'curated', ...(melee ? [melee.swing] : []), ...defs[0].tags])].slice(0, 9),
      theme: t.id,
      desc: clampWords(`Hand-made ${lc(t.label)} ${cls.replace('_', ' ')}: ${lc(rc.name)}.`, 15),
      keywords: [...new Set([...words.map(lc), ...t.keywords.slice(0, 3), cls.replace('_', ' ')])].slice(0, 14),
      parts: rc.parts.map((p) => ({ ...p })),
      statHints: statsFor(cls, defs, t, melee),
      ...(melee ? { melee } : {}),
      curated: true,
    };
  });
}

/** Generate all templates (curated first). Deterministic. */
export function generateTemplates(): Template[] {
  const out: Template[] = curatedTemplates();
  const sigs = new Set<string>(out.map((t) => signature(t.parts)));
  SEEN = sigs;
  const names = new Set<string>(out.map((t) => t.name));
  const ids = new Set<string>(out.map((t) => t.id));
  const classes: WeaponClass[] = [...GUN_CLASSES, 'weird', 'melee'];

  const finish = (d: Draft, t: Theme): boolean => {
    const sig = signature(d.b.parts);
    if (sigs.has(sig)) return false;
    let name = d.name;
    if (names.has(name)) {
      const alt = d.alts.find((a) => !names.has(a));
      if (alt) name = alt;
      else {
        let k = 0;
        while (k < ROMAN.length && names.has(`${d.name} Mk ${ROMAN[k]}`)) k++;
        name = k < ROMAN.length ? `${d.name} Mk ${ROMAN[k]}` : `${d.name} ${hashStr(sig) % 1000}`;
      }
    }
    if (names.has(name)) return false;
    const idSig = d.b.parts.map((p) => p.partId).sort().join('+');
    let id = `${d.cls}-${toBase36(hashStr(idSig), hashStr(idSig, 0x9e3779b9))}`;
    while (ids.has(id)) id += 'x';
    sigs.add(sig);
    names.add(name);
    ids.add(id);
    const tpl: Template = {
      id,
      name,
      class: d.cls,
      fireMode: d.fireMode,
      tags: d.tags,
      theme: t.id,
      desc: d.desc,
      keywords: d.keywords,
      parts: d.b.parts,
      statHints: d.stats,
    };
    if (d.melee) tpl.melee = d.melee;
    out.push(tpl);
    return true;
  };

  for (const cls of classes) {
    const per = Math.ceil(CLASS_TARGET[cls] / THEMES.length);
    for (const t of THEMES) {
      const r = mulberry32(hashStr(`${TEMPLATE_VERSION}:${cls}:${t.id}`));
      let made = 0;
      let attempts = 0;
      const gunModes: [string, number][] =
        cls === 'weird'
          ? [['objcore', 0.4], ['objpart', 0.2], ['std', 0.4]]
          : [['objcore', 0.45], ['objpart', 0.15], ['std', 0.4]];
      while (made < per && attempts < per * 14) {
        attempts++;
        let d: Draft | null;
        if (cls === 'melee') {
          const m = pickMode(r, MELEE_MODES);
          d = m === 'objcore' ? meleeObjCore(r, t) : m === 'sword' ? meleeSword(r, t, false) : m === 'objblade' ? meleeSword(r, t, true) : meleeHafted(r, t, m === 'objhead');
        } else {
          const m = pickMode(r, gunModes) as 'std' | 'objcore' | 'objpart';
          d = gunDraft(r, cls, t, m) ?? (m !== 'std' ? gunDraft(r, cls, t, 'std') : null);
        }
        if (d && finish(d, t)) made++;
      }
    }
  }
  SEEN = null;
  return out;
}

export { THEMES, THEME_BY_ID };
