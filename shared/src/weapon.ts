// Weapon schema shared by the client, the SpacetimeDB module and weapon generation.
// Keep this file free of runtime dependencies: it is bundled into the server module.

import type { MeleeMeta } from './melee';

export const WEAPON_CLASSES = [
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
  'throwable',
  'weird',
] as const;
export type WeaponClass = (typeof WEAPON_CLASSES)[number];

/**
 * - hitscan:    instant ray, `range` metres.
 * - projectile: straight-flying projectile at `projectileSpeed` m/s (gravityScale usually ~0).
 * - arc:        lobbed projectile affected by gravity (`gravityScale`), may use `fuseTime`.
 * - stream:     short-range cone (flamethrower / bubbles). `damage` is per tick, `fireRate` is
 *               ticks per second, `magSize` is fuel in ticks, `spread` is the cone angle.
 * - melee:      swing; `range` <= 3 m, `fireRate` is swings per second, `spread` is swing arc.
 */
export const FIRE_MODES = ['hitscan', 'projectile', 'arc', 'stream', 'melee'] as const;
export type FireMode = (typeof FIRE_MODES)[number];

export type Vec3 = [number, number, number];

export interface WeaponPart {
  /** Id from @ai-gaem/parts catalog.json */
  partId: string;
  /** Uniform scale or per-axis scale. */
  scale?: number | Vec3;
  /** Hex colour override, e.g. "#ff8800". */
  color?: string;
  /** Local offset in metres relative to the weapon origin. */
  offset?: Vec3;
  /** Secondary/accent hex colour passed to the part builder. */
  accent?: string;
  /** Explicit parent socket name (defaults to the part's own `attach`). */
  socket?: string;
}

export interface WeaponColors {
  primary: string;
  secondary: string;
  accent: string;
}

/** A fully clamped, balanced weapon. Every numeric field is always present. */
export interface Weapon {
  name: string;
  class: WeaponClass;
  fireMode: FireMode;
  /** Direct damage per pellet (per tick for streams, per swing for melee). */
  damage: number;
  /** Pellets per shot (integer, 1 for most weapons). */
  pellets: number;
  /** Shots (or stream ticks / swings) per second. */
  fireRate: number;
  /** Rounds per magazine (integer). Fuel ticks for streams. 1 for melee. */
  magSize: number;
  /** Seconds. 0 for melee. */
  reloadTime: number;
  /** Metres. Max hit distance (hitscan/melee/stream) or projectile lifetime distance. */
  range: number;
  /** Degrees. Cone half-angle-ish spread; stream cone angle; melee swing arc. */
  spread: number;
  /** m/s. 0 = hitscan / stream / melee. */
  projectileSpeed: number;
  /** Metres. 0 = no splash. Splash damage falls off linearly to SPLASH_EDGE_FRACTION at the edge. */
  splashRadius: number;
  /** Multiplier on world gravity for projectiles (0 = straight line). */
  gravityScale: number;
  /** Seconds before an arc projectile detonates; 0 = detonate on impact. */
  fuseTime: number;
  /** Total damage-over-time applied per hit (burn / poison), spread over dotDuration. Refreshes, does not stack. */
  dotDamage: number;
  /** Seconds. */
  dotDuration: number;
  /** Impulse in m/s applied to the target on hit. */
  knockback: number;
  /** 0-60. Percent movement slow applied on hit for ~SLOW_DURATION seconds. */
  slowPercent: number;
  /** Seconds the trigger must be held before each shot fires. */
  chargeTime: number;
  /**
   * Damage multiplier for a direct hit on the head hitbox (1-3). Applied server-side; head
   * damage per shot is capped at MAX_HEADSHOT_DAMAGE. Always 1 for streams and splash weapons.
   */
  headshotMultiplier: number;
  parts: WeaponPart[];
  colors: WeaponColors;
  /**
   * Melee only (always set on clamped melee weapons): swing animation type, hand -> tip reach and
   * weight class (swing timing). See shared/src/melee.ts.
   */
  melee?: MeleeMeta;
}

/** Loose input shape: anything an LLM or client might send. */
export type RawWeapon = {
  [K in keyof Weapon]?: unknown;
} & Record<string, unknown>;

export const MAX_HP = 100;
export const SPLASH_EDGE_FRACTION = 0.25;
export const SLOW_DURATION = 1.5;
export const RESPAWN_DELAY_SECONDS = 3;

/** Hit zones reported by clients (`report_hit.zone`). */
export const HIT_ZONE_BODY = 0;
export const HIT_ZONE_HEAD = 1;
/** Max damage a single headshot can deal (body shots stay capped at 95 by clampWeapon). */
export const MAX_HEADSHOT_DAMAGE = 150;

/**
 * Player hitbox geometry (feet-relative, metres), shared by the client hitboxes and the
 * server's headshot plausibility check. Crouching shrinks the player from 1.8 m to 1.2 m.
 */
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.2;
export const HEAD_RADIUS = 0.16;
/** head sphere centre above the feet */
export const HEAD_CENTER_STANDING = 1.66;
export const HEAD_CENTER_CROUCHED = HEAD_CENTER_STANDING - (PLAYER_HEIGHT - PLAYER_CROUCH_HEIGHT);
/** eye height above the feet (client camera; server melee origin check) */
export const STAND_EYE_OFFSET = 1.62;
export const CROUCH_EYE_OFFSET = STAND_EYE_OFFSET - (PLAYER_HEIGHT - PLAYER_CROUCH_HEIGHT);

/** Damage of a direct hit: body = `bodyDamage`, head = bodyDamage * multiplier, capped at 150. */
export function zoneDamage(weapon: Pick<Weapon, 'headshotMultiplier'>, bodyDamage: number, zone: number): number {
  if (zone !== HIT_ZONE_HEAD) return bodyDamage;
  const mult = Math.min(3, Math.max(1, weapon.headshotMultiplier || 1));
  return Math.min(bodyDamage * mult, Math.max(bodyDamage, MAX_HEADSHOT_DAMAGE));
}

/** Splash damage at `distance` from the impact point, linear falloff to 25% at the edge. */
export function splashDamageAt(weapon: Pick<Weapon, 'damage' | 'pellets' | 'splashRadius'>, distance: number): number {
  if (weapon.splashRadius <= 0 || distance > weapon.splashRadius) return 0;
  const t = Math.max(0, distance) / weapon.splashRadius;
  const base = weapon.damage * weapon.pellets;
  return base * (1 - t * (1 - SPLASH_EDGE_FRACTION));
}
