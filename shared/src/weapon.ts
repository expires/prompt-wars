// Weapon schema shared by the client, the SpacetimeDB module and weapon generation.
// Keep this file free of runtime dependencies: it is bundled into the server module.

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
  parts: WeaponPart[];
  colors: WeaponColors;
}

/** Loose input shape: anything an LLM or client might send. */
export type RawWeapon = {
  [K in keyof Weapon]?: unknown;
} & Record<string, unknown>;

export const MAX_HP = 100;
export const SPLASH_EDGE_FRACTION = 0.25;
export const SLOW_DURATION = 1.5;
export const RESPAWN_DELAY_SECONDS = 3;

/** Splash damage at `distance` from the impact point, linear falloff to 25% at the edge. */
export function splashDamageAt(weapon: Pick<Weapon, 'damage' | 'pellets' | 'splashRadius'>, distance: number): number {
  if (weapon.splashRadius <= 0 || distance > weapon.splashRadius) return 0;
  const t = Math.max(0, distance) / weapon.splashRadius;
  const base = weapon.damage * weapon.pellets;
  return base * (1 - t * (1 - SPLASH_EDGE_FRACTION));
}
