// One preset per class. All presets are passed through clampWeapon so they are guaranteed legal.
// `parts` are left empty: render presets with the per-class recipes from @ai-gaem/parts until
// real part ids are assigned.

import { clampWeapon } from './balance';
import type { RawWeapon, Weapon, WeaponClass } from './weapon';

const RAW_PRESETS: Record<WeaponClass, RawWeapon> = {
  pistol: {
    name: 'Service Pistol', class: 'pistol', fireMode: 'hitscan',
    damage: 20, fireRate: 3, magSize: 12, reloadTime: 1.2, range: 35, spread: 1.5,
    colors: { primary: '#2b2e33', secondary: '#6b7078', accent: '#e0b040' },
  },
  smg: {
    name: 'Buzzsaw SMG', class: 'smg', fireMode: 'hitscan',
    damage: 8, fireRate: 12, magSize: 30, reloadTime: 2, range: 25, spread: 3.5,
    colors: { primary: '#1f2a1f', secondary: '#4f5f4f', accent: '#9cff3a' },
  },
  rifle: {
    name: 'AR-12', class: 'rifle', fireMode: 'hitscan',
    damage: 12, fireRate: 10, magSize: 20, reloadTime: 2.4, range: 70, spread: 1.2,
    colors: { primary: '#3b3a33', secondary: '#7d7a68', accent: '#ff6a00' },
  },
  shotgun: {
    name: 'Boomstick', class: 'shotgun', fireMode: 'hitscan',
    damage: 8, pellets: 8, fireRate: 0.8, magSize: 6, reloadTime: 2.5, range: 15, spread: 7, knockback: 4,
    colors: { primary: '#5a3a22', secondary: '#2b2b2b', accent: '#c0c0c0' },
  },
  sniper: {
    name: 'Longshot', class: 'sniper', fireMode: 'hitscan',
    damage: 80, fireRate: 0.6, magSize: 5, reloadTime: 3, range: 150, spread: 0.1,
    colors: { primary: '#2f3b2f', secondary: '#141414', accent: '#40c0ff' },
  },
  lmg: {
    name: 'Mulcher', class: 'lmg', fireMode: 'hitscan',
    damage: 8, fireRate: 9, magSize: 100, reloadTime: 4.5, range: 50, spread: 3.5,
    colors: { primary: '#333333', secondary: '#5c4a32', accent: '#ffcc00' },
  },
  rocket_launcher: {
    name: 'Rocket Launcher', class: 'rocket_launcher', fireMode: 'projectile',
    damage: 90, fireRate: 0.6, magSize: 1, reloadTime: 2, range: 100, spread: 0.5,
    projectileSpeed: 30, splashRadius: 4, knockback: 8,
    colors: { primary: '#3d4a2a', secondary: '#202020', accent: '#ff3b1f' },
  },
  grenade_launcher: {
    name: 'Thumper', class: 'grenade_launcher', fireMode: 'arc',
    damage: 70, fireRate: 0.8, magSize: 6, reloadTime: 3, range: 50, spread: 1,
    projectileSpeed: 22, splashRadius: 3.5, gravityScale: 1, fuseTime: 1.5, knockback: 6,
    colors: { primary: '#4a4a30', secondary: '#262626', accent: '#ffa500' },
  },
  flamethrower: {
    name: 'Torchbearer', class: 'flamethrower', fireMode: 'stream',
    damage: 4, fireRate: 15, magSize: 150, reloadTime: 3, range: 7, spread: 18,
    dotDamage: 10, dotDuration: 2,
    colors: { primary: '#7a1f12', secondary: '#303030', accent: '#ffb000' },
  },
  bubble_gun: {
    name: 'Bubblizer', class: 'bubble_gun', fireMode: 'stream',
    damage: 2, fireRate: 10, magSize: 100, reloadTime: 2, range: 10, spread: 12,
    slowPercent: 40, knockback: 3,
    colors: { primary: '#ff7ad9', secondary: '#7ad9ff', accent: '#ffffff' },
  },
  blowgun: {
    name: 'Viper Dart', class: 'blowgun', fireMode: 'projectile',
    damage: 15, fireRate: 1.2, magSize: 1, reloadTime: 1, range: 40, spread: 0.3,
    projectileSpeed: 45, gravityScale: 0.3, dotDamage: 40, dotDuration: 4,
    colors: { primary: '#6b8e23', secondary: '#3b2f1e', accent: '#a0ff40' },
  },
  crossbow: {
    name: 'Bolt Thrower', class: 'crossbow', fireMode: 'projectile',
    damage: 75, fireRate: 0.7, magSize: 1, reloadTime: 1.5, range: 80, spread: 0.2,
    projectileSpeed: 80, gravityScale: 0.25, chargeTime: 0.5, knockback: 5,
    colors: { primary: '#5b3b1f', secondary: '#2a2a2a', accent: '#d0d0d0' },
  },
  melee: {
    name: 'Machete', class: 'melee', fireMode: 'melee',
    damage: 45, fireRate: 1.5, magSize: 1, reloadTime: 0, range: 2.5, spread: 70, knockback: 5,
    colors: { primary: '#b0b4ba', secondary: '#3a2a1a', accent: '#ff3030' },
  },
  throwable: {
    name: 'Bar Stool', class: 'throwable', fireMode: 'arc',
    damage: 34, fireRate: 1.2, magSize: 1, reloadTime: 1, range: 30, spread: 2,
    projectileSpeed: 18, gravityScale: 0.8, splashRadius: 1, knockback: 6,
    colors: { primary: '#9a6a3a', secondary: '#5a3a22', accent: '#c0c0c0' },
  },
  weird: {
    name: 'Rubber Chicken Cannon', class: 'weird', fireMode: 'projectile',
    damage: 15, pellets: 3, fireRate: 1.5, magSize: 5, reloadTime: 2.5, range: 40, spread: 6,
    projectileSpeed: 25, gravityScale: 0.5, splashRadius: 1.5, knockback: 10, slowPercent: 20,
    colors: { primary: '#ffd400', secondary: '#ff7a00', accent: '#ff2a2a' },
  },
};

export const PRESET_WEAPONS: Record<WeaponClass, Weapon> = Object.fromEntries(
  Object.entries(RAW_PRESETS).map(([k, raw]) => [k, clampWeapon(raw)]),
) as Record<WeaponClass, Weapon>;

/** The four "starter" presets from the design doc. */
export const DEFAULT_LOADOUT: Weapon[] = [
  PRESET_WEAPONS.pistol,
  PRESET_WEAPONS.rifle,
  PRESET_WEAPONS.rocket_launcher,
  PRESET_WEAPONS.shotgun,
];
