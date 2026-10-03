// Server-side hit validation + damage helpers shared by the SpacetimeDB module, the client
// (local damage estimates) and tests. Keep this file free of runtime dependencies.

import {
  HIT_ZONE_BODY,
  HIT_ZONE_HEAD,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  type FireMode,
  type Weapon,
} from './weapon';
import { meleeSwingRate } from './melee';
import { DEFAULT_DIMS, bodyRadiusCheck, bodyTop, headCenter, headRadius, standHeight, type BodyDims } from './outfit/balance';

// ---------------------------------------------------------------------------
// Pose flags (pose.flags / pose_state.flags)
// ---------------------------------------------------------------------------

export const POSE_FLAG_CROUCH = 1;
export const POSE_FLAG_GROUNDED = 2;
/** the pose is a teleport / spawn: remote clients snap instead of interpolating */
export const POSE_FLAG_TELEPORT = 4;
/** blocking with a melee weapon (front melee hits do BLOCK_DAMAGE_MULT damage) */
export const POSE_FLAG_BLOCK = 8;

// ---------------------------------------------------------------------------
// Damage falloff
// ---------------------------------------------------------------------------

/** Full damage up to this fraction of the weapon's range ... */
export const FALLOFF_START = 0.6;
/** ... then linear down to this multiplier at max range (and beyond). */
export const FALLOFF_MIN = 0.75;

/** Range falloff multiplier at `distance` for a weapon with `range` metres. */
export function rangeFalloff(range: number, distance: number): number {
  if (!(range > 0)) return 1;
  const start = range * FALLOFF_START;
  if (distance <= start) return 1;
  const t = Math.min(1, (distance - start) / (range - start));
  return 1 - t * (1 - FALLOFF_MIN);
}

/** Which fire modes have range falloff on direct hits (projectiles, splash and melee don't). */
export function hasFalloff(mode: FireMode): boolean {
  return mode === 'hitscan' || mode === 'stream';
}

/** Body damage of a direct hit at `distance` (before the head multiplier). */
export function directHitDamage(w: Pick<Weapon, 'damage' | 'range' | 'fireMode'>, pellets: number, distance: number): number {
  const base = w.damage * pellets;
  return hasFalloff(w.fireMode) ? base * rangeFalloff(w.range, distance) : base;
}

// ---------------------------------------------------------------------------
// Fire rate: token bucket
// ---------------------------------------------------------------------------

/**
 * Shots per second actually allowed (fire rate + charge time). Melee: never faster than the swing
 * animation of its weight class (see meleeSwingRate).
 */
export function effectiveFireRate(w: Pick<Weapon, 'fireRate' | 'chargeTime'> & Partial<Pick<Weapon, 'fireMode' | 'melee'>>): number {
  const rate = w.fireMode === 'melee' && w.melee ? meleeSwingRate(w as Pick<Weapon, 'fireRate'>, w.melee) : w.fireRate;
  return 1 / (1 / Math.max(0.05, rate) + Math.max(0, w.chargeTime));
}

/**
 * Bucket size: tolerates ~0.25 s of network bunching (SDK batching, TCP coalescing) while the
 * long-run rate stays exact. Minimum 1.5 (not 2): a full bucket of 2 would let a heavy weapon
 * (e.g. 80-damage sniper) double-tap, breaking the "no one-shot body kills" balance rule.
 */
export function fireCreditsMax(rate: number): number {
  return Math.max(1.5, 1 + 0.25 * rate);
}

/** Refill `credits` after `elapsedSeconds` and try to spend one. */
export function spendFireCredit(credits: number, elapsedSeconds: number, rate: number): { ok: boolean; credits: number } {
  const max = fireCreditsMax(rate);
  const c = Math.min(max, credits + Math.max(0, elapsedSeconds) * rate);
  if (c < 1 - 1e-6) return { ok: false, credits: c };
  return { ok: true, credits: c - 1 };
}

// ---------------------------------------------------------------------------
// Favor-the-shooter hit validation
// ---------------------------------------------------------------------------

/** How far back (seconds) a hit may be validated against the victim's previous pose. */
export const LAG_COMP_WINDOW = 0.25;
/** Base positional tolerance (m), plus victim speed * LAG_COMP_WINDOW. */
export const HIT_TOLERANCE = 0.3;
/** Horizontal head tolerance (m) on top of the speed term. */
export const HEAD_HORIZ_TOLERANCE = 0.5;
/** Speed used for the tolerance is capped (m/s). */
export const MAX_TOLERANCE_SPEED = 15;
/** body radius used for validation at the standard body (client hitbox 0.3 m); see bodyRadiusCheck */
export const BODY_RADIUS_CHECK = 0.35;

export interface PoseSample {
  x: number;
  y: number;
  z: number;
  crouching: boolean;
}

/**
 * The victim's recent trajectory: `prev` (may be null) -> `cur`, plus its speed (m/s). The impact
 * is accepted if it is within the hitbox (+ tolerance) anywhere along that segment.
 */
export interface SweptPose {
  prev: PoseSample | null;
  cur: PoseSample;
  speed: number;
}

function speedTol(speed: number) {
  return Math.min(MAX_TOLERANCE_SPEED, Math.max(0, speed || 0)) * LAG_COMP_WINDOW;
}

const SAMPLES = 8;

function forEachSample(p: SweptPose, fn: (x: number, y: number, z: number, crouching: boolean) => boolean): boolean {
  const { prev, cur } = p;
  if (!prev) return fn(cur.x, cur.y, cur.z, cur.crouching);
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const x = prev.x + (cur.x - prev.x) * t;
    const y = prev.y + (cur.y - prev.y) * t;
    const z = prev.z + (cur.z - prev.z) * t;
    // crouch transition: accept either height on the part of the segment where it changed
    if (fn(x, y, z, t < 0.5 ? prev.crouching : cur.crouching)) return true;
    if (prev.crouching !== cur.crouching && fn(x, y, z, t < 0.5 ? cur.crouching : prev.crouching)) return true;
  }
  return false;
}

/**
 * Is the impact plausibly on the victim's head (sphere centred HEAD_CENTER_* above the feet)?
 * Vertical tolerance HIT_TOLERANCE + speed term, horizontal HEAD_HORIZ_TOLERANCE + speed term.
 */
export function isPlausibleHeadHit(pose: SweptPose, impact: readonly [number, number, number], dims: BodyDims = DEFAULT_DIMS): boolean {
  const st = speedTol(pose.speed);
  const r = headRadius(dims);
  const vTol = r + HIT_TOLERANCE + st;
  const hTol = r + HEAD_HORIZ_TOLERANCE + st;
  return forEachSample(pose, (x, y, z, crouching) => {
    const centre = y + headCenter(dims, crouching ? 1 : 0);
    if (Math.abs(impact[1] - centre) > vTol) return false;
    return Math.hypot(impact[0] - x, impact[2] - z) <= hTol;
  });
}

/** Is the impact plausibly anywhere on the victim (feet .. top of the head)? */
export function isPlausibleBodyHit(pose: SweptPose, impact: readonly [number, number, number], dims: BodyDims = DEFAULT_DIMS): boolean {
  const tol = HIT_TOLERANCE + speedTol(pose.speed);
  const rad = bodyRadiusCheck(dims);
  return forEachSample(pose, (x, y, z, crouching) => {
    const top = Math.max(bodyTop(dims, crouching ? 1 : 0), crouching ? PLAYER_CROUCH_HEIGHT * dims.scale : PLAYER_HEIGHT * dims.scale);
    const dy = impact[1] - y;
    if (dy < -tol || dy > top + tol) return false;
    return Math.hypot(impact[0] - x, impact[2] - z) <= rad + tol;
  });
}

/**
 * Validate a claimed direct hit. Returns the zone to apply (head only if claimed *and*
 * plausible), or -1 if the impact isn't plausibly on the victim at all (hit rejected).
 */
export function classifyHit(pose: SweptPose, impact: readonly [number, number, number], claimedZone: number, dims: BodyDims = DEFAULT_DIMS): number {
  if (claimedZone === HIT_ZONE_HEAD && isPlausibleHeadHit(pose, impact, dims)) return HIT_ZONE_HEAD;
  return isPlausibleBodyHit(pose, impact, dims) ? HIT_ZONE_BODY : -1;
}

/**
 * Splash distance: closest distance from the blast point to the victim's body centre
 * (feet + 0.9 m, as the client measures it) along the trajectory, minus the lag tolerance.
 */
export function splashDistance(pose: SweptPose, p: readonly [number, number, number], dims: BodyDims = DEFAULT_DIMS): number {
  let best = Infinity;
  forEachSample(pose, (x, y, z, crouching) => {
    const cy = y + (crouching ? PLAYER_CROUCH_HEIGHT * dims.scale : standHeight(dims)) / 2;
    best = Math.min(best, Math.hypot(p[0] - x, p[1] - cy, p[2] - z));
    return false;
  });
  return Math.max(0, best - HIT_TOLERANCE - speedTol(pose.speed));
}

/**
 * Build the swept pose used for validation from the stored previous / current poses and their
 * server timestamps (seconds). Only the part of prev -> cur inside the last LAG_COMP_WINDOW
 * seconds counts; if the current pose itself is older the victim was standing still at it.
 */
export function sweptPoseAt(
  prev: PoseSample | null,
  prevAt: number,
  cur: PoseSample,
  curAt: number,
  now: number,
  speed: number,
): SweptPose {
  const from = now - LAG_COMP_WINDOW;
  if (!prev || curAt < from || curAt <= prevAt) return { prev: null, cur, speed };
  if (prevAt >= from) return { prev, cur, speed };
  const t = (from - prevAt) / (curAt - prevAt);
  return {
    prev: {
      x: prev.x + (cur.x - prev.x) * t,
      y: prev.y + (cur.y - prev.y) * t,
      z: prev.z + (cur.z - prev.z) * t,
      crouching: prev.crouching,
    },
    cur,
    speed,
  };
}
