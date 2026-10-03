import type { WeaponClass } from '@ai-gaem/shared';
import type { Weapon } from './types';

/**
 * Client-side weapon handling (accuracy + recoil feel), derived from the weapon class and its
 * balanced stats. Purely cosmetic/skill-related: damage is still server-authoritative.
 *
 * Effective spread (degrees, cone half-angle) for hitscan / projectile weapons:
 *   (spread + hipSpread when not aiming) * adsMult * crouchMult * (1 + moveSpread * speedFrac) * airMult
 *   + bloom (grows per shot, recovers over time) + moveFloor * speedFrac (+ airFloor)
 * Streams (cone = spread) and melee ignore all of it.
 */
export interface Handling {
  /** can aim down sights */
  canAds: boolean;
  /** FOV multiplier at full ADS */
  adsZoom: number;
  /** spread multiplier while aimed */
  adsSpread: number;
  /** extra spread (deg) when hip-firing (snipers / crossbows are inaccurate unscoped) */
  hipSpread: number;
  /** spread multiplier added at walk speed (scaled by speed / walk speed) */
  moveSpread: number;
  /** spread multiplier while airborne */
  airSpread: number;
  /** spread multiplier while crouched on the ground */
  crouchSpread: number;
  /** recoil aim punch per shot, degrees up */
  kickPitch: number;
  /** recoil yaw jitter, +- degrees */
  kickYaw: number;
  /** spread bloom added per shot (deg), cap, and recovery (deg/s) */
  bloomPerShot: number;
  bloomMax: number;
  bloomRecovery: number;
  /** viewmodel kick strength */
  vmKick: number;
}

type ClassHandling = Omit<Handling, 'kickPitch' | 'kickYaw'> & { kickMul: number; yawMul: number };

const BASE: ClassHandling = {
  canAds: true,
  adsZoom: 0.75,
  adsSpread: 0.5,
  hipSpread: 0,
  moveSpread: 1.2,
  airSpread: 5,
  crouchSpread: 0.75,
  bloomPerShot: 0.25,
  bloomMax: 3,
  bloomRecovery: 5,
  vmKick: 0.6,
  kickMul: 1,
  yawMul: 0.35,
};

const CLASS: Partial<Record<WeaponClass, Partial<ClassHandling>>> = {
  pistol: { adsZoom: 0.8, moveSpread: 0.8, bloomPerShot: 0.35, bloomRecovery: 6 },
  smg: { adsZoom: 0.8, adsSpread: 0.6, moveSpread: 0.5, airSpread: 3, crouchSpread: 0.8, kickMul: 0.8, bloomPerShot: 0.18, bloomRecovery: 7, vmKick: 0.35, yawMul: 0.5 },
  rifle: { adsZoom: 0.72, adsSpread: 0.45, moveSpread: 1.6, crouchSpread: 0.7, bloomPerShot: 0.22, bloomMax: 3.5, vmKick: 0.45, yawMul: 0.45 },
  shotgun: { adsZoom: 0.85, adsSpread: 0.8, moveSpread: 0.25, airSpread: 1.6, crouchSpread: 0.9, bloomPerShot: 0.4, bloomMax: 2, bloomRecovery: 4, vmKick: 1.4, kickMul: 0.8 },
  sniper: { adsZoom: 0.4, adsSpread: 0.1, hipSpread: 2.5, moveSpread: 3, airSpread: 8, crouchSpread: 0.6, bloomPerShot: 1.5, bloomMax: 4, bloomRecovery: 2.5, vmKick: 1.2, kickMul: 0.8, yawMul: 0.2 },
  lmg: { adsSpread: 0.55, moveSpread: 1.6, crouchSpread: 0.6, bloomPerShot: 0.15, bloomMax: 4, bloomRecovery: 3, vmKick: 0.4, yawMul: 0.6 },
  rocket_launcher: { adsZoom: 0.8, adsSpread: 0.6, moveSpread: 0.5, airSpread: 2, crouchSpread: 0.8, bloomPerShot: 0, vmKick: 1.2, kickMul: 0.6 },
  grenade_launcher: { adsZoom: 0.85, adsSpread: 0.7, moveSpread: 0.5, airSpread: 2, crouchSpread: 0.8, bloomPerShot: 0, vmKick: 1.2, kickMul: 0.6 },
  blowgun: { adsZoom: 0.7, adsSpread: 0.3, moveSpread: 1.5, airSpread: 4, crouchSpread: 0.7, bloomPerShot: 0.5, vmKick: 0.3, kickMul: 0.4 },
  crossbow: { adsZoom: 0.55, adsSpread: 0.2, hipSpread: 1, moveSpread: 1.5, crouchSpread: 0.7, bloomPerShot: 0.5, vmKick: 1, kickMul: 0.7 },
  flamethrower: { canAds: false, kickMul: 0.05, vmKick: 0.08, bloomPerShot: 0 },
  bubble_gun: { canAds: false, kickMul: 0.05, vmKick: 0.08, bloomPerShot: 0 },
  melee: { canAds: false, kickMul: 0, vmKick: 0, bloomPerShot: 0 },
};

export function weaponHandling(w: Weapon): Handling {
  const c: ClassHandling = { ...BASE, ...(CLASS[w.class] ?? {}) };
  if (w.fireMode === 'stream' || w.fireMode === 'melee') {
    c.canAds = false;
    c.bloomPerShot = 0;
  }
  // recoil scales with per-shot damage: ~0.6 deg for an SMG, ~1.1 pistol, ~3 sniper
  const perShot = w.damage * w.pellets;
  const kickPitch = Math.min(3.5, Math.max(0.2, 0.3 + perShot * 0.035)) * c.kickMul;
  const { kickMul: _k, yawMul, ...rest } = c;
  return { ...rest, kickPitch, kickYaw: kickPitch * yawMul };
}

export interface MoveState {
  /** horizontal speed m/s */
  speed: number;
  grounded: boolean;
  crouched: boolean;
  /** 0..1 ADS blend */
  ads: number;
}

/** effective spread (degrees) for a hitscan / projectile shot right now */
export function effectiveSpread(w: Weapon, h: Handling, m: MoveState, bloom: number, walkSpeed: number): number {
  const speedFrac = Math.min(1.6, m.speed / walkSpeed);
  const ads = h.canAds ? m.ads : 0;
  let mult = 1 + (h.adsSpread - 1) * ads;
  if (m.crouched && m.grounded) mult *= h.crouchSpread;
  mult *= 1 + h.moveSpread * speedFrac * speedFrac;
  if (!m.grounded) mult *= h.airSpread;
  const base = w.spread + h.hipSpread * (1 - ads);
  const floor = 0.6 * speedFrac + (m.grounded ? 0 : 1.5);
  return base * mult + bloom + floor;
}
