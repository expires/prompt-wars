/**
 * Client weapon types: the shared schema from @ai-gaem/shared (the same shape the server
 * stores and balances with clampWeapon), plus an optional client-side id.
 *
 * Units (see shared/src/weapon.ts for the full description):
 *  - damage: HP per pellet/projectile (players have 100 HP)
 *  - fireRate: shots per second
 *  - reloadTime: seconds
 *  - range: meters (melee: reach)
 *  - spread: cone half-angle in degrees
 *  - projectileSpeed: m/s (projectile/arc fire modes; 0 for hitscan)
 *  - splashRadius: meters (0 = no splash)
 */
import type { FireMode, Weapon as SharedWeapon, WeaponClass, WeaponColors, WeaponPart } from '@ai-gaem/shared';

export type { FireMode, WeaponClass, WeaponColors };

/** A part reference. `color` may also be a palette key: 'primary' | 'secondary' | 'accent'. */
export type WeaponPartRef = WeaponPart;

export interface Weapon extends SharedWeapon {
  /** server weapon id (stringified u64) or a local id */
  id?: string;
}

/** Fire mode of a weapon (always set on clamped weapons; kept as a helper for older call sites). */
export function resolveFireMode(w: Pick<Weapon, 'fireMode' | 'class'>): FireMode {
  if (w.fireMode) return w.fireMode;
  switch (w.class) {
    case 'melee':
      return 'melee';
    case 'flamethrower':
    case 'bubble_gun':
      return 'stream';
    case 'grenade_launcher':
      return 'arc';
    case 'rocket_launcher':
    case 'crossbow':
    case 'blowgun':
      return 'projectile';
    default:
      return 'hitscan';
  }
}
