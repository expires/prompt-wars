// Stats panel math for the Forge: rows vs class average, TTK @100HP, balance budget usage and the
// "server will nerf" preview (the server re-runs clampWeapon on register_design).
import {
  CLASS_TEMPLATES,
  MAX_HEADSHOT_DAMAGE,
  boundsFor,
  clampWeapon,
  slowDurationFor,
  computeWeaponStats,
  type DesignStats,
  type FireMode,
  type Weapon,
  type WeaponClass,
} from '@ai-gaem/shared';

export interface StatRow {
  key: string;
  label: string;
  /** display value */
  value: string;
  /** 0..1 position of the value on the class scale */
  norm: number;
  /** 0..1 class-average tick */
  avg: number;
  /** better (+1) / worse (-1) / same (0) than the reference (previous design or class average) */
  delta: -1 | 0 | 1;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function weaponFromStats(stats: Partial<DesignStats>, cls: string, mode: string, name = ''): Weapon {
  return clampWeapon({ ...stats, class: cls, fireMode: mode, name: name || undefined });
}

export function classAverage(cls: WeaponClass, mode: FireMode): Weapon {
  return clampWeapon({ ...CLASS_TEMPLATES[cls].defaults, class: cls, fireMode: mode });
}

/** Seconds to kill a 100 HP target with body shots (null when it can't, e.g. 0 damage). */
export function ttk(w: Weapon, hp = 100): number | null {
  const per = w.damage * w.pellets;
  if (per <= 0) return null;
  const shots = Math.ceil(hp / per);
  const reloads = w.fireMode === 'melee' ? 0 : Math.floor((shots - 1) / Math.max(1, w.magSize));
  return (shots - 1) / w.fireRate + shots * w.chargeTime + reloads * w.reloadTime;
}

/** 0..100 "handling": accuracy (spread vs the class range) and reload speed */
export function handling(w: Weapon): number {
  const b = boundsFor(w.class, w.fireMode);
  const spr = b.spread[1] > b.spread[0] ? (w.spread - b.spread[0]) / (b.spread[1] - b.spread[0]) : 0.5;
  const rl = b.reloadTime[1] > b.reloadTime[0] ? (w.reloadTime - b.reloadTime[0]) / (b.reloadTime[1] - b.reloadTime[0]) : 0.5;
  return Math.round(100 * (0.25 + 0.45 * (1 - clamp01(spr)) + 0.3 * (1 - clamp01(rl))));
}

interface RowDef {
  key: string;
  label: string;
  get: (w: Weapon) => number;
  fmt: (w: Weapon) => string;
  range: (w: Weapon) => [number, number];
  /** lower is better */
  invert?: boolean;
}

const b = (k: keyof ReturnType<typeof boundsFor>) => (w: Weapon) => boundsFor(w.class, w.fireMode)[k];
const headDmg = (w: Weapon) => Math.min(MAX_HEADSHOT_DAMAGE, w.damage * w.pellets * w.headshotMultiplier);

const RANGED: RowDef[] = [
  {
    key: 'dmg',
    label: 'DMG body / head',
    get: (w) => w.damage * w.pellets,
    fmt: (w) => `${fmtN(w.damage * w.pellets)} / ${fmtN(headDmg(w))}`,
    range: (w) => [b('damage')(w)[0] * w.pellets, Math.max(b('damage')(w)[1] * w.pellets, 1)],
  },
  { key: 'rpm', label: 'RPM', get: (w) => w.fireRate * 60, fmt: (w) => `${Math.round(w.fireRate * 60)}`, range: (w) => [b('fireRate')(w)[0] * 60, b('fireRate')(w)[1] * 60] },
  { key: 'range', label: 'Range', get: (w) => w.range, fmt: (w) => `${Math.round(w.range)} m`, range: b('range') },
  { key: 'mag', label: 'Magazine', get: (w) => w.magSize, fmt: (w) => `${w.magSize}`, range: b('magSize') },
  { key: 'reload', label: 'Reload', get: (w) => w.reloadTime, fmt: (w) => `${w.reloadTime.toFixed(1)} s`, range: b('reloadTime'), invert: true },
  { key: 'handling', label: 'Handling', get: handling, fmt: (w) => `${handling(w)}`, range: () => [0, 100] },
];

const MELEE: RowDef[] = [
  { key: 'dmg', label: 'DMG per swing', get: (w) => w.damage, fmt: (w) => fmtN(w.damage), range: b('damage') },
  { key: 'rpm', label: 'Swings / min', get: (w) => w.fireRate * 60, fmt: (w) => `${Math.round(w.fireRate * 60)}`, range: (w) => [b('fireRate')(w)[0] * 60, b('fireRate')(w)[1] * 60] },
  { key: 'range', label: 'Reach', get: (w) => w.range, fmt: (w) => `${w.range.toFixed(1)} m`, range: b('range') },
  { key: 'arc', label: 'Swing arc', get: (w) => w.spread, fmt: (w) => `${Math.round(w.spread)}°`, range: b('spread') },
  { key: 'knock', label: 'Knockback', get: (w) => w.knockback, fmt: (w) => fmtN(w.knockback), range: b('knockback') },
  { key: 'handling', label: 'Handling', get: handling, fmt: (w) => `${handling(w)}`, range: () => [0, 100] },
];

function fmtN(v: number) {
  return v >= 10 ? `${Math.round(v)}` : `${+v.toFixed(1)}`;
}

export function statRows(w: Weapon, ref?: Weapon | null): StatRow[] {
  const avg = classAverage(w.class, w.fireMode);
  const defs = w.fireMode === 'melee' ? MELEE : RANGED;
  return defs.map((d) => {
    const [lo, hi] = d.range(w);
    const n = (v: number) => (hi > lo ? clamp01((v - lo) / (hi - lo)) : 0.5);
    const v = d.get(w);
    const r = d.get(ref ?? avg);
    const diff = (v - r) / Math.max(1e-6, Math.abs(r));
    const better = d.invert ? diff < -0.02 : diff > 0.02;
    const worse = d.invert ? diff > 0.02 : diff < -0.02;
    return {
      key: d.key,
      label: d.label,
      value: d.fmt(w),
      norm: d.invert ? 1 - n(v) : n(v),
      avg: d.invert ? 1 - n(d.get(avg)) : n(d.get(avg)),
      delta: better ? 1 : worse ? -1 : 0,
    };
  });
}

export interface BudgetInfo {
  /** effective DPS / cap of the stats as designed (before the server clamp) */
  usage: number;
  /** stat changes the server's clampWeapon will make (e.g. "DMG −12%") */
  nerfs: string[];
}

/**
 * Budget usage of the (possibly unbalanced) streamed stats and what the server clamp changes.
 * `raw` = stats as the forge produced them; the server re-runs clampWeapon on register_design.
 */
export function budgetOf(raw: Partial<DesignStats>, cls: string, mode: string): BudgetInfo {
  const clamped = weaponFromStats(raw, cls, mode);
  // usage of the raw numbers: same formula as the clamp's budget check, inputs filled from the clamp
  const asIs = { ...clamped } as Weapon;
  for (const k of ['damage', 'fireRate', 'pellets', 'magSize', 'reloadTime', 'dotDamage', 'chargeTime'] as const) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) (asIs as unknown as Record<string, number>)[k] = v;
  }
  const s = computeWeaponStats(asIs);
  const usage = s.effectiveDps / Math.max(1, s.dpsCap);
  const nerfs: string[] = [];
  const pct = (k: 'damage' | 'fireRate' | 'magSize' | 'range', label: string) => {
    const v = raw[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return;
    const d = (clamped[k] - v) / v;
    if (d < -0.02) nerfs.push(`${label} −${Math.round(-d * 100)}%`);
  };
  pct('damage', 'DMG');
  pct('fireRate', 'RPM');
  pct('magSize', 'MAG');
  pct('range', 'RANGE');
  return { usage, nerfs };
}

/** "FIRE · burn 4/s for 3 s" style one-liner for the weapon's element ('' when none) */
export function elementBlurb(w: Weapon): string {
  const e = w.element;
  if (!e) return '';
  const n = (v: number) => `${+v.toFixed(1)}`;
  if (e === 'fire' || e === 'poison') {
    const dps = w.dotDuration > 0 ? w.dotDamage / w.dotDuration : 0;
    return `${e.toUpperCase()} · ${e === 'fire' ? 'burn' : 'poison'} ${n(dps)}/s for ${n(w.dotDuration)} s`;
  }
  const dur = slowDurationFor(e);
  return `${e.toUpperCase()} · slow ${Math.round(w.slowPercent)}% for ${n(dur)} s${e === 'ice' ? ' (stacks to 60%)' : ''}`;
}
