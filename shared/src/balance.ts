// Server-enforced weapon balance. `clampWeapon` turns any raw (LLM / client) input into a
// legal, budgeted Weapon. Deterministic and dependency-free so it can run inside the
// SpacetimeDB module (no Math.random, no Date).

import {
  FIRE_MODES,
  WEAPON_CLASSES,
  type FireMode,
  type RawWeapon,
  type Vec3,
  type Weapon,
  type WeaponClass,
  type WeaponColors,
  type WeaponPart,
} from './weapon';
import { effectiveReach, sanitizeMeleeMeta, type MeleeMeta } from './melee';

export const NUMERIC_STATS = [
  'damage',
  'pellets',
  'fireRate',
  'magSize',
  'reloadTime',
  'range',
  'spread',
  'projectileSpeed',
  'splashRadius',
  'gravityScale',
  'fuseTime',
  'dotDamage',
  'dotDuration',
  'knockback',
  'slowPercent',
  'chargeTime',
  'headshotMultiplier',
] as const;
export type NumericStat = (typeof NUMERIC_STATS)[number];
export type StatBounds = Record<NumericStat, [number, number]>;
export type StatValues = Record<NumericStat, number>;

// ---------------------------------------------------------------------------
// Budget constants
// ---------------------------------------------------------------------------

/** Sustained DPS cap for ordinary weapons. */
export const DPS_CAP = 55;
/** Melee gets more DPS in exchange for <= 3 m range. */
export const MELEE_DPS_CAP = 80;
/** Streams get more DPS at very short range, tapering to DPS_CAP at STREAM_MAX_RANGE. */
export const STREAM_DPS_CAP = 70;
export const STREAM_FULL_CAP_RANGE = 8;
export const STREAM_MAX_RANGE = 12;
export const MELEE_MAX_RANGE = 3;
/** Max damage a single shot can do (direct + DoT), so nothing one-shots a 100 HP player. */
export const MAX_SHOT_DAMAGE = 95;
/** Shots above this damage are limited to HEAVY_SHOT_MAX_FIRE_RATE. */
export const HEAVY_SHOT_THRESHOLD = 60;
export const HEAVY_SHOT_MAX_FIRE_RATE = 0.8;
export const MAX_PARTS = 64;

/** Hard limits that apply to every class (including 'weird'). */
export const GLOBAL_BOUNDS: StatBounds = {
  damage: [0.5, 95],
  pellets: [1, 12],
  fireRate: [0.2, 20],
  magSize: [1, 300],
  reloadTime: [0, 6],
  range: [1, 200],
  spread: [0, 90],
  projectileSpeed: [0, 150],
  splashRadius: [0, 6],
  gravityScale: [0, 3],
  fuseTime: [0, 5],
  dotDamage: [0, 60],
  dotDuration: [0, 8],
  knockback: [0, 20],
  slowPercent: [0, 60],
  chargeTime: [0, 2],
  headshotMultiplier: [1, 3],
};

/** Default head damage multiplier; per-class overrides below (sniper higher, shotguns / explosives 1). */
export const DEFAULT_HEADSHOT_MULTIPLIER = 2;

const ZERO_EXTRAS = {
  projectileSpeed: 0,
  splashRadius: 0,
  gravityScale: 0,
  fuseTime: 0,
  dotDamage: 0,
  dotDuration: 0,
  knockback: 0,
  slowPercent: 0,
  chargeTime: 0,
};

// ---------------------------------------------------------------------------
// Class templates
// ---------------------------------------------------------------------------

export interface ClassTemplate {
  class: WeaponClass;
  /** Allowed fire modes; first is the default. */
  modes: FireMode[];
  defaults: StatValues;
  /** Per-class bounds; anything missing falls back to GLOBAL_BOUNDS. */
  bounds: Partial<StatBounds>;
  /** One-line flavour for LLM prompts. */
  blurb: string;
}

function tpl(
  cls: WeaponClass,
  modes: FireMode[],
  blurb: string,
  defaults: Partial<StatValues> & Pick<StatValues, 'damage' | 'fireRate' | 'magSize' | 'reloadTime' | 'range' | 'spread'>,
  bounds: Partial<StatBounds>,
): ClassTemplate {
  return {
    class: cls,
    modes,
    blurb,
    defaults: { pellets: 1, ...ZERO_EXTRAS, headshotMultiplier: DEFAULT_HEADSHOT_MULTIPLIER, ...defaults },
    bounds,
  };
}

export const CLASS_TEMPLATES: Record<WeaponClass, ClassTemplate> = {
  pistol: tpl('pistol', ['hitscan', 'projectile'], 'Sidearm: accurate, mid damage, quick reload.',
    { damage: 20, fireRate: 3, magSize: 12, reloadTime: 1.2, range: 35, spread: 1.5, headshotMultiplier: 2 },
    { damage: [10, 45], pellets: [1, 2], fireRate: [1, 6], magSize: [5, 20], reloadTime: [0.8, 2], range: [20, 50], spread: [0.5, 4], projectileSpeed: [0, 120], splashRadius: [0, 1], headshotMultiplier: [1.5, 2.5] }),
  smg: tpl('smg', ['hitscan'], 'Fast-firing, low damage, short range, high spread.',
    { damage: 8, fireRate: 12, magSize: 30, reloadTime: 2, range: 25, spread: 3.5, headshotMultiplier: 1.75 },
    { damage: [5, 18], pellets: [1, 1], fireRate: [8, 18], magSize: [20, 50], reloadTime: [1.2, 3], range: [15, 35], spread: [2, 6], splashRadius: [0, 0], headshotMultiplier: [1.25, 2] }),
  rifle: tpl('rifle', ['hitscan'], 'Automatic or burst rifle: all-rounder, long range.',
    { damage: 12, fireRate: 10, magSize: 20, reloadTime: 2.4, range: 70, spread: 1.2, headshotMultiplier: 2 },
    { damage: [8, 35], pellets: [1, 1], fireRate: [3, 12], magSize: [10, 40], reloadTime: [1.5, 3.5], range: [40, 90], spread: [0.5, 3], splashRadius: [0, 0], headshotMultiplier: [1.5, 2.5] }),
  shotgun: tpl('shotgun', ['hitscan', 'projectile'], 'Many pellets, wide spread, devastating up close.',
    { damage: 8, pellets: 8, fireRate: 0.8, magSize: 6, reloadTime: 2.5, range: 15, spread: 7, knockback: 4, headshotMultiplier: 1 },
    { damage: [3, 14], pellets: [4, 12], fireRate: [0.5, 3], magSize: [2, 10], reloadTime: [1.5, 3.5], range: [8, 25], spread: [4, 14], projectileSpeed: [0, 90], splashRadius: [0, 0], headshotMultiplier: [1, 1.25] }),
  sniper: tpl('sniper', ['hitscan'], 'Huge single shots, slow, very long range, optional charge.',
    { damage: 80, fireRate: 0.6, magSize: 5, reloadTime: 3, range: 150, spread: 0.1, headshotMultiplier: 2.5 },
    { damage: [50, 95], pellets: [1, 1], fireRate: [0.3, 0.8], magSize: [1, 6], reloadTime: [2, 4], range: [80, 200], spread: [0, 1], splashRadius: [0, 0], chargeTime: [0, 1.5], headshotMultiplier: [2, 3] }),
  lmg: tpl('lmg', ['hitscan'], 'Huge magazine, long reload, sustained suppressing fire.',
    { damage: 8, fireRate: 9, magSize: 100, reloadTime: 4.5, range: 50, spread: 3.5, headshotMultiplier: 1.75 },
    { damage: [6, 20], pellets: [1, 1], fireRate: [6, 14], magSize: [50, 150], reloadTime: [3.5, 6], range: [35, 70], spread: [2, 6], splashRadius: [0, 0], headshotMultiplier: [1.25, 2] }),
  rocket_launcher: tpl('rocket_launcher', ['projectile'], 'Slow straight rockets with splash damage and knockback.',
    { damage: 90, fireRate: 0.6, magSize: 1, reloadTime: 2, range: 100, spread: 0.5, projectileSpeed: 30, splashRadius: 4, knockback: 8, headshotMultiplier: 1 },
    { damage: [50, 95], pellets: [1, 1], fireRate: [0.3, 0.8], magSize: [1, 4], reloadTime: [1.5, 4], range: [60, 150], spread: [0, 2], projectileSpeed: [15, 50], splashRadius: [2, 6], gravityScale: [0, 0.3], headshotMultiplier: [1, 1] }),
  grenade_launcher: tpl('grenade_launcher', ['arc'], 'Lobbed bouncing grenades with a fuse and splash.',
    { damage: 70, fireRate: 0.8, magSize: 6, reloadTime: 3, range: 50, spread: 1, projectileSpeed: 22, splashRadius: 3.5, gravityScale: 1, fuseTime: 1.5, knockback: 6, headshotMultiplier: 1 },
    { damage: [35, 90], pellets: [1, 1], fireRate: [0.5, 1.5], magSize: [2, 8], reloadTime: [2.5, 4], range: [25, 60], spread: [0, 3], projectileSpeed: [12, 35], splashRadius: [2.5, 5], gravityScale: [0.6, 1.5], fuseTime: [0, 3], headshotMultiplier: [1, 1] }),
  flamethrower: tpl('flamethrower', ['stream'], 'Short-range cone of fire; burns (DoT).',
    { damage: 4, fireRate: 15, magSize: 150, reloadTime: 3, range: 7, spread: 18, dotDamage: 10, dotDuration: 2, headshotMultiplier: 1 },
    { damage: [2, 8], pellets: [1, 1], fireRate: [10, 20], magSize: [60, 300], reloadTime: [2, 4], range: [4, 10], spread: [10, 30], dotDamage: [0, 25], dotDuration: [1, 4], headshotMultiplier: [1, 1] }),
  bubble_gun: tpl('bubble_gun', ['stream', 'projectile'], 'Silly bubbles that slow and push targets, low damage.',
    { damage: 2, fireRate: 10, magSize: 100, reloadTime: 2, range: 10, spread: 12, slowPercent: 40, knockback: 3, headshotMultiplier: 1 },
    { damage: [1, 8], pellets: [1, 4], fireRate: [4, 15], magSize: [20, 200], reloadTime: [1.5, 3.5], range: [6, 12], spread: [4, 25], projectileSpeed: [0, 15], splashRadius: [0, 1.5], slowPercent: [15, 60], knockback: [0, 8], headshotMultiplier: [1, 1] }),
  blowgun: tpl('blowgun', ['projectile'], 'Quiet poison darts: small hit, heavy poison DoT.',
    { damage: 15, fireRate: 1.2, magSize: 1, reloadTime: 1, range: 40, spread: 0.3, projectileSpeed: 45, gravityScale: 0.3, dotDamage: 40, dotDuration: 4, headshotMultiplier: 1.5 },
    { damage: [5, 30], pellets: [1, 1], fireRate: [0.8, 2], magSize: [1, 5], reloadTime: [0.8, 2], range: [25, 60], spread: [0, 1.5], projectileSpeed: [30, 70], gravityScale: [0.1, 0.6], dotDamage: [10, 60], dotDuration: [2, 6], splashRadius: [0, 0], headshotMultiplier: [1, 2] }),
  crossbow: tpl('crossbow', ['projectile'], 'Heavy bolts with slight drop and a draw (charge) time.',
    { damage: 75, fireRate: 0.7, magSize: 1, reloadTime: 1.5, range: 80, spread: 0.2, projectileSpeed: 80, gravityScale: 0.25, chargeTime: 0.5, knockback: 5, headshotMultiplier: 2 },
    { damage: [40, 95], pellets: [1, 3], fireRate: [0.4, 1], magSize: [1, 5], reloadTime: [1, 2.5], range: [50, 120], spread: [0, 1], projectileSpeed: [50, 110], gravityScale: [0.1, 0.5], chargeTime: [0, 1.2], knockback: [0, 6], splashRadius: [0, 0], headshotMultiplier: [1.5, 2.5] }),
  melee: tpl('melee', ['melee'], 'Close-range swing (<= 3 m). Highest DPS, no ammo.',
    { damage: 45, fireRate: 1.5, magSize: 1, reloadTime: 0, range: 2.5, spread: 70, knockback: 5, headshotMultiplier: 1 },
    { damage: [20, 80], pellets: [1, 1], fireRate: [0.5, 2.5], magSize: [1, 1], reloadTime: [0, 0], range: [1.5, 3], spread: [20, 140], knockback: [0, 12], headshotMultiplier: [1, 1.5] }),
  weird: tpl('weird', ['projectile', 'hitscan', 'arc', 'stream', 'melee'], 'Anything goes; balance budget still applies.',
    { damage: 15, pellets: 3, fireRate: 1.5, magSize: 5, reloadTime: 2.5, range: 40, spread: 6, projectileSpeed: 25, gravityScale: 0.5, splashRadius: 1.5, knockback: 10, slowPercent: 20, headshotMultiplier: 1.5 },
    { headshotMultiplier: [1, 2.5] }),
};

// ---------------------------------------------------------------------------
// Stats / budget
// ---------------------------------------------------------------------------

export interface WeaponStats {
  /** damage * pellets */
  directPerShot: number;
  /** directPerShot + dotDamage */
  perShot: number;
  /** Seconds for a full magazine cycle including reload. */
  cycleTime: number;
  /** Shots per second, sustained over a full mag + reload. */
  sustainedShotsPerSec: number;
  /** Raw sustained DPS: damage*pellets*magSize / (magSize/fireRate + reloadTime) (+charge) + DoT. */
  sustainedDps: number;
  /** sustainedDps scaled by utility (splash, slow, knockback) — compared to the cap. */
  effectiveDps: number;
  dpsCap: number;
}

export function dpsCapFor(w: Pick<Weapon, 'fireMode' | 'range'>): number {
  if (w.fireMode === 'melee') return MELEE_DPS_CAP;
  if (w.fireMode === 'stream') {
    if (w.range <= STREAM_FULL_CAP_RANGE) return STREAM_DPS_CAP;
    const t = Math.min(1, (w.range - STREAM_FULL_CAP_RANGE) / (STREAM_MAX_RANGE - STREAM_FULL_CAP_RANGE));
    return STREAM_DPS_CAP + (DPS_CAP - STREAM_DPS_CAP) * t;
  }
  return DPS_CAP;
}

export function utilityMultiplier(w: Pick<Weapon, 'splashRadius' | 'slowPercent' | 'knockback'>): number {
  return 1 + 0.06 * w.splashRadius + w.slowPercent / 150 + w.knockback / 60;
}

export function computeWeaponStats(w: Weapon): WeaponStats {
  const directPerShot = w.damage * w.pellets;
  const perShot = directPerShot + w.dotDamage;
  const shotInterval = 1 / w.fireRate + w.chargeTime;
  const cycleTime = w.magSize * shotInterval + w.reloadTime;
  const sustainedShotsPerSec = w.magSize / cycleTime;
  const directDps = directPerShot * sustainedShotsPerSec;
  // DoT refreshes rather than stacks: it can never deal more than dotDamage/dotDuration per second.
  const dotDps =
    w.dotDamage > 0
      ? Math.min(w.dotDamage * sustainedShotsPerSec, w.dotDamage / Math.max(w.dotDuration, 0.5))
      : 0;
  const sustainedDps = directDps + dotDps;
  return {
    directPerShot,
    perShot,
    cycleTime,
    sustainedShotsPerSec,
    sustainedDps,
    effectiveDps: sustainedDps * utilityMultiplier(w),
    dpsCap: dpsCapFor(w),
  };
}

// ---------------------------------------------------------------------------
// Sanitisers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const floorTo = (v: number, step: number) => Math.floor(v / step + 1e-9) * step;
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const ceilTo = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step;
const fix = (v: number) => Number(v.toFixed(4));

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
function hex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (HEX.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  }
  return undefined;
}

function vec3(v: unknown, lo: number, hi: number): Vec3 | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  const out = v.map(num);
  if (out.some(x => x === undefined)) return undefined;
  return (out as number[]).map(x => fix(clamp(x, lo, hi))) as Vec3;
}

const PART_ID = /^[A-Za-z0-9_.:\-/]{1,80}$/;

export function sanitizeParts(raw: unknown): WeaponPart[] {
  if (!Array.isArray(raw)) return [];
  const out: WeaponPart[] = [];
  for (const p of raw) {
    if (out.length >= MAX_PARTS) break;
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const partId = typeof r.partId === 'string' ? r.partId.trim() : typeof r.id === 'string' ? r.id.trim() : '';
    if (!PART_ID.test(partId)) continue;
    const part: WeaponPart = { partId };
    const s = num(r.scale);
    if (s !== undefined) part.scale = fix(clamp(s, 0.05, 5));
    else {
      const sv = vec3(r.scale, 0.05, 5);
      if (sv) part.scale = sv;
    }
    const c = hex(r.color);
    if (c) part.color = c;
    const o = vec3(r.offset, -2, 2);
    if (o) part.offset = o;
    const a = hex(r.accent);
    if (a) part.accent = a;
    if (typeof r.socket === 'string' && /^[a-z]{1,16}$/.test(r.socket)) part.socket = r.socket;
    out.push(part);
  }
  return out;
}

const DEFAULT_COLORS: WeaponColors = { primary: '#3a3f47', secondary: '#8a8f99', accent: '#ff7a1a' };

export function sanitizeColors(raw: unknown): WeaponColors {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    primary: hex(r.primary) ?? DEFAULT_COLORS.primary,
    secondary: hex(r.secondary) ?? DEFAULT_COLORS.secondary,
    accent: hex(r.accent) ?? DEFAULT_COLORS.accent,
  };
}

export function isWeaponClass(v: unknown): v is WeaponClass {
  return typeof v === 'string' && (WEAPON_CLASSES as readonly string[]).includes(v);
}
export function isFireMode(v: unknown): v is FireMode {
  return typeof v === 'string' && (FIRE_MODES as readonly string[]).includes(v);
}

const CLASS_ALIASES: Record<string, WeaponClass> = {
  rocket: 'rocket_launcher', rocketlauncher: 'rocket_launcher', launcher: 'rocket_launcher', bazooka: 'rocket_launcher',
  grenade: 'grenade_launcher', grenadelauncher: 'grenade_launcher',
  flame: 'flamethrower', flamer: 'flamethrower',
  bubble: 'bubble_gun', bubblegun: 'bubble_gun',
  dart: 'blowgun', bow: 'crossbow',
  ar: 'rifle', assault_rifle: 'rifle', machinegun: 'lmg', machine_gun: 'lmg',
  sword: 'melee', knife: 'melee', hammer: 'melee', axe: 'melee',
};

export function normalizeClass(v: unknown): WeaponClass {
  if (isWeaponClass(v)) return v;
  if (typeof v === 'string') {
    const k = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (isWeaponClass(k)) return k;
    // own properties only: '__proto__' / 'constructor' must not resolve to Object.prototype members
    const own = (key: string) => (Object.prototype.hasOwnProperty.call(CLASS_ALIASES, key) ? CLASS_ALIASES[key] : undefined);
    const alias = own(k) ?? own(k.replace(/_/g, ''));
    if (alias) return alias;
  }
  return 'weird';
}

/** Effective bounds for a class + fire mode (class bounds ∩ global bounds ∩ mode rules). */
export function boundsFor(cls: WeaponClass, mode: FireMode): StatBounds {
  const t = CLASS_TEMPLATES[cls];
  const b = {} as StatBounds;
  for (const k of NUMERIC_STATS) {
    const [glo, ghi] = GLOBAL_BOUNDS[k];
    const [clo, chi] = t.bounds[k] ?? GLOBAL_BOUNDS[k];
    b[k] = [Math.max(glo, clo), Math.min(ghi, chi)];
  }
  // Intersect with a mode rule; if the intersection is empty the mode rule wins.
  const set = (k: NumericStat, lo: number, hi: number) => {
    const nlo = Math.max(lo, b[k][0]);
    const nhi = Math.min(hi, b[k][1]);
    b[k] = nlo <= nhi ? [nlo, nhi] : [lo, hi];
  };
  switch (mode) {
    case 'hitscan':
      set('projectileSpeed', 0, 0);
      set('gravityScale', 0, 0);
      set('fuseTime', 0, 0);
      set('splashRadius', 0, Math.min(b.splashRadius[1], 1.5));
      break;
    case 'projectile':
      b.projectileSpeed = [Math.max(10, b.projectileSpeed[0]), Math.max(10, b.projectileSpeed[1])];
      set('gravityScale', b.gravityScale[0], Math.min(b.gravityScale[1], 1));
      break;
    case 'arc':
      b.projectileSpeed = [Math.max(8, b.projectileSpeed[0]), clamp(b.projectileSpeed[1], 8, 60)];
      b.gravityScale = [Math.max(0.3, b.gravityScale[0]), Math.max(0.3, b.gravityScale[1])];
      break;
    case 'stream':
      set('projectileSpeed', 0, 0);
      set('gravityScale', 0, 0);
      set('fuseTime', 0, 0);
      set('chargeTime', 0, 0);
      set('splashRadius', 0, 0);
      set('pellets', 1, 1);
      set('headshotMultiplier', 1, 1);
      b.range = [Math.min(b.range[0], STREAM_MAX_RANGE), Math.min(b.range[1], STREAM_MAX_RANGE)];
      break;
    case 'melee':
      set('projectileSpeed', 0, 0);
      set('gravityScale', 0, 0);
      set('fuseTime', 0, 0);
      set('splashRadius', 0, 0);
      set('pellets', 1, 1);
      b.magSize = [1, 1];
      b.reloadTime = [0, 0];
      b.range = [Math.min(b.range[0], MELEE_MAX_RANGE), Math.min(b.range[1], MELEE_MAX_RANGE)];
      break;
  }
  return b;
}

// ---------------------------------------------------------------------------
// clampWeapon
// ---------------------------------------------------------------------------

/**
 * Turn any raw weapon description into a legal, balanced Weapon.
 *
 * 1. Normalise class / fire mode (unknown class -> 'weird'; illegal mode -> class default).
 * 2. Fill missing stats from the class template and clamp to class + mode bounds.
 * 3. Per-shot damage (direct + DoT) capped at 95 so nothing one-shots from 100 HP.
 * 4. Shots doing more than 60 are limited to 0.8 shots/s.
 * 5. Headshot multiplier in [1, 3] (class bounds; 1 for streams and splash weapons). Head damage
 *    per shot is capped at MAX_HEADSHOT_DAMAGE (150) by `zoneDamage`; body shots stay <= 95.
 * 6. Sustained effective DPS must fit the budget (55; melee 80; streams up to 70 at short range).
 *    Over-budget weapons scale damage and fire rate down proportionally.
 */
export function clampWeapon(input: RawWeapon | Weapon | unknown): Weapon {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const cls = normalizeClass(raw.class ?? raw.weaponClass ?? raw.type);
  const t = CLASS_TEMPLATES[cls];
  const mode: FireMode = isFireMode(raw.fireMode) && t.modes.includes(raw.fireMode) ? raw.fireMode : t.modes[0];
  const b = boundsFor(cls, mode);

  const v = {} as StatValues;
  for (const k of NUMERIC_STATS) {
    const given = num(raw[k]);
    const base = given ?? t.defaults[k];
    v[k] = clamp(base, b[k][0], b[k][1]);
  }

  // Integers + tidy rounding for non-budget fields.
  v.pellets = Math.round(v.pellets);
  v.magSize = Math.round(v.magSize);
  v.reloadTime = ceilTo(v.reloadTime, 0.05);
  v.chargeTime = ceilTo(v.chargeTime, 0.05);
  v.range = roundTo(v.range, 0.1);
  v.spread = roundTo(v.spread, 0.05);
  v.projectileSpeed = roundTo(v.projectileSpeed, 0.5);
  v.splashRadius = floorTo(v.splashRadius, 0.1);
  v.gravityScale = roundTo(v.gravityScale, 0.05);
  v.fuseTime = roundTo(v.fuseTime, 0.05);
  v.knockback = floorTo(v.knockback, 0.5);
  v.slowPercent = Math.floor(v.slowPercent);
  // Explosives: splash already rewards near misses, so no headshot bonus.
  v.headshotMultiplier = v.splashRadius > 0 ? 1 : roundTo(v.headshotMultiplier, 0.05);
  if (v.dotDamage > 0) v.dotDuration = clamp(Math.max(v.dotDuration, 0.5), 0.5, b.dotDuration[1] || 8);
  else v.dotDuration = 0;

  // (3) Per-shot cap.
  const perShot = v.damage * v.pellets + v.dotDamage;
  if (perShot > MAX_SHOT_DAMAGE) {
    const f = MAX_SHOT_DAMAGE / perShot;
    v.damage *= f;
    v.dotDamage *= f;
  }

  // (4) Heavy shots fire slowly.
  if (v.damage * v.pellets + v.dotDamage > HEAVY_SHOT_THRESHOLD) {
    v.fireRate = Math.min(v.fireRate, HEAVY_SHOT_MAX_FIRE_RATE);
  }

  const name = sanitizeName(raw.name, cls);
  const parts = sanitizeParts(raw.parts);
  let melee: MeleeMeta | undefined;
  const build = (): Weapon => ({
    name,
    class: cls,
    fireMode: mode,
    ...v,
    parts,
    colors: sanitizeColors(raw.colors),
    ...(melee ? { melee } : {}),
  });

  // (5) DPS budget: first pass splits the reduction between damage and fire rate,
  // second pass makes damage absorb whatever is left (exact, since DPS is linear in damage).
  for (let pass = 0; pass < 3; pass++) {
    const s = computeWeaponStats(build());
    if (s.effectiveDps <= s.dpsCap) break;
    const f = s.dpsCap / s.effectiveDps;
    if (pass === 0) {
      const k = Math.sqrt(f);
      v.damage *= k;
      v.dotDamage *= k;
      v.fireRate = Math.max(Math.min(b.fireRate[0], v.fireRate), v.fireRate * k);
    } else {
      v.damage *= f;
      v.dotDamage *= f;
    }
  }

  // Round budget fields *down* so rounding never pushes us over a cap.
  v.damage = Math.max(0.1, floorTo(v.damage, 0.1));
  v.dotDamage = floorTo(v.dotDamage, 0.1);
  v.fireRate = Math.max(0.1, floorTo(v.fireRate, 0.01));
  // (6) Melee metadata (swing / hand->tip reach / weight; inferred when missing). The stored
  // range becomes the effective hit reach (eye -> impact) so stats and validation agree.
  if (mode === 'melee') {
    melee = sanitizeMeleeMeta(raw.melee, { name, parts, damage: v.damage, fireRate: v.fireRate, range: v.range });
    v.range = clamp(roundTo(effectiveReach(melee.reach), 0.1), b.range[0], b.range[1]);
  }
  for (const k of NUMERIC_STATS) v[k] = fix(v[k]);

  return build();
}

function sanitizeName(v: unknown, cls: WeaponClass): string {
  if (typeof v === 'string') {
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    if (s) return s;
  }
  return cls.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Mk I';
}

/** Compact bounds description for LLM prompts. */
export function describeTemplateForPrompt(cls: WeaponClass): string {
  const t = CLASS_TEMPLATES[cls];
  const lines = [`class "${cls}": ${t.blurb}`, `allowed fireMode: ${t.modes.join(' | ')}`];
  const b = boundsFor(cls, t.modes[0]);
  for (const k of NUMERIC_STATS) lines.push(`  ${k}: ${b[k][0]}..${b[k][1]} (typical ${t.defaults[k]})`);
  return lines.join('\n');
}
