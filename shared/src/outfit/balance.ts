// Body balance: the outfit's body proportions -> max HP, hitbox and movement speed. Pure and
// dependency-free (runs in the SpacetimeDB module, which computes these from the sanitized outfit
// and never trusts client numbers).
//
// Rationale (see docs/characters.md):
// - size (height) is capped to 0.8 .. 1.08 (1.44 m .. 1.94 m). Above ~1.08 the standing capsule
//   + Rapier's 0.4 m autostep lift no longer clears the C-stair ceiling (2.9 m over a tread;
//   checked by tauronRemake.test.ts), below 0.8 the head (12.8 cm radius) gets too small to land
//   headshots on. Bulk goes wider instead (build up to 1.3: hitbox only, the collision capsule
//   radius stays 0.35 m so every door / corridor still fits).
// - max HP follows the hitbox cross-section A = size^2 * (0.85 * build + 0.15 * head^2)
//   (body capsule ~85 % of the frontal area, head sphere ~15 %), compressed with A^0.75:
//   strictly proportional HP would make giants unkillable for sloppy aim and tiny players
//   one-tap fodder for precise aim. With ^0.75 HP per unit of hitbox area varies < 1.5x between
//   the extremes (flat 100 HP: 3.2x), so a bigger body is a real trade (more HP, easier to hit,
//   slower) instead of a free win or a free loss.
// - speed is slightly inverse to size (-7 % .. +7 %) and stacks with weapon carry weight inside
//   the overall MOVE_MULT_MIN .. MOVE_MULT_MAX window.

import type { OutfitBody } from './types';

export const BODY_LIMITS = {
  size: [0.8, 1.08],
  build: [0.85, 1.3],
  head: [0.85, 1.2],
  limbs: [0.85, 1.15],
} as const;

export const DEFAULT_BODY: OutfitBody = { size: 1, build: 1, head: 1, limbs: 1 };

export const BODY_HP_MIN = 70;
export const BODY_HP_MAX = 140;
export const BODY_SPEED_MIN = 0.92;
export const BODY_SPEED_MAX = 1.07;

/** What gameplay needs of a body (hitbox scale). */
export interface BodyDims {
  /** overall size */
  scale: number;
  /** width / bulk */
  build: number;
  /** relative head size */
  head: number;
}

export const DEFAULT_DIMS: BodyDims = { scale: 1, build: 1, head: 1 };

export type SizeClass = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface BodyStats extends BodyDims {
  maxHp: number;
  /** movement multiplier from the body alone (stacks with weapon carry weight) */
  speedMult: number;
  sizeClass: SizeClass;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function lim(v: unknown, [lo, hi]: readonly [number, number], dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : dflt;
  return r3(clamp(n, lo, hi));
}

/** Clamp body proportions to BODY_LIMITS (3 decimals; idempotent). */
export function clampBody(raw: unknown): OutfitBody {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    size: lim(r.size ?? r.scale ?? r.height, BODY_LIMITS.size, 1),
    build: lim(r.build ?? r.bulk, BODY_LIMITS.build, 1),
    head: lim(r.head, BODY_LIMITS.head, 1),
    limbs: lim(r.limbs ?? r.arms, BODY_LIMITS.limbs, 1),
  };
}

/** Frontal hitbox area relative to the standard body. */
export function hitboxArea(b: Pick<OutfitBody, 'size' | 'build' | 'head'>): number {
  return b.size * b.size * (0.85 * b.build + 0.15 * b.head * b.head);
}

export function bodyMaxHp(b: Pick<OutfitBody, 'size' | 'build' | 'head'>): number {
  const hp = 100 * Math.pow(hitboxArea(b), 0.75);
  return clamp(Math.round(hp / 5) * 5, BODY_HP_MIN, BODY_HP_MAX);
}

export function bodySpeedMult(b: Pick<OutfitBody, 'size' | 'build'>): number {
  return r3(clamp(1 - 0.3 * (b.size - 1) - 0.15 * (b.build - 1), BODY_SPEED_MIN, BODY_SPEED_MAX));
}

/** size label from the hitbox area (height and bulk both count) */
export function sizeClassOf(area: number): SizeClass {
  if (area < 0.72) return 'XS';
  if (area < 0.9) return 'S';
  if (area <= 1.1) return 'M';
  if (area <= 1.3) return 'L';
  return 'XL';
}

/** Everything gameplay derives from a (raw or clamped) body. */
export function bodyStats(raw: unknown): BodyStats {
  const b = clampBody(raw);
  return { scale: b.size, build: b.build, head: b.head, maxHp: bodyMaxHp(b), speedMult: bodySpeedMult(b), sizeClass: sizeClassOf(hitboxArea(b)) };
}

/** "HP 120 · Speed −5% · Size L" */
export function bodyStatsLine(s: Pick<BodyStats, 'maxHp' | 'speedMult' | 'sizeClass'>): string {
  const pct = Math.round((s.speedMult - 1) * 100);
  const sp = pct === 0 ? '±0%' : pct > 0 ? `+${pct}%` : `−${-pct}%`;
  return `HP ${s.maxHp} · Speed ${sp} · Size ${s.sizeClass}`;
}

// ---------------------------------------------------------------------------
// Hitbox geometry (feet-relative, metres). DEFAULT_DIMS reproduces the old constants exactly:
// head centre 1.66 m (r 0.16), eye 1.62 m, 1.8 m / 1.2 m tall, body radius 0.3 (0.35 checked).
// ---------------------------------------------------------------------------

/** standing / crouched capsule height (collision) */
export const standHeight = (d: BodyDims) => 1.8 * d.scale;
export const crouchHeight = (d: BodyDims) => 1.2 * d.scale;
/** how far crouching lowers the head / eye */
export const crouchDrop = (d: BodyDims) => 0.6 * d.scale;
export const headRadius = (d: BodyDims) => 0.16 * d.scale * d.head;
/** head sphere centre above the feet for crouch blend t (0 standing .. 1 crouched) */
export const headCenter = (d: BodyDims, t = 0) => d.scale * (1.51 + 0.15 * d.head) - crouchDrop(d) * t;
/** camera eye height above the feet */
export const eyeHeight = (d: BodyDims, t = 0) => d.scale * (1.51 + 0.11 * d.head) - crouchDrop(d) * t;
/** client body capsule radius */
export const bodyRadius = (d: BodyDims) => 0.3 * d.scale * d.build;
/** server body radius (client hitbox + 5 cm at size 1) */
export const bodyRadiusCheck = (d: BodyDims) => 0.35 * d.scale * d.build;
/** top of the head above the feet */
export const bodyTop = (d: BodyDims, t = 0) => headCenter(d, t) + headRadius(d);

/** Movement multiplier: weapon carry weight x body, inside the global window. */
export function combinedMoveMult(carry: number, body: number, lo = 0.72, hi = 1.22): number {
  return r3(clamp(carry * body, lo, hi));
}
