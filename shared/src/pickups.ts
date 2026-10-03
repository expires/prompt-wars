// Map pickups (health packs). Positions come from the map registry (MapDef.pickups); the server
// seeds one `pickup` row per entry and validates `take_pickup` with these helpers, the client
// renders them and auto-collects on overlap.
import { MAX_HP } from './weapon';

export type PickupKind = 'health';

export interface MapPickup {
  kind: PickupKind;
  /** feet-level anchor (the surface the pack sits on) */
  x: number;
  y: number;
  z: number;
}

/** HP restored by a health pack (capped at MAX_HP) */
export const HEALTH_PACK_HEAL = 50;
/** a taken pickup comes back after this long (production; the admin can shorten it for tests) */
export const PICKUP_RESPAWN_SECONDS = 60;
/** client: the local player's feet within this horizontal distance collect it */
export const PICKUP_TOUCH_RADIUS = 0.9;
/** server: accepted horizontal distance from the stored pose (generous for latency) */
export const PICKUP_SERVER_RADIUS = 1.5;
/** vertical slack between the feet and the pickup anchor (jumping over it still counts) */
export const PICKUP_HEIGHT_TOLERANCE = 1.6;

/** HP a health pack would restore right now (0 at full HP: the pack is not consumed then) */
export function healAmount(hp: number, max = MAX_HP): number {
  if (!Number.isFinite(hp) || hp >= max) return 0;
  return Math.min(HEALTH_PACK_HEAL, max - Math.max(0, hp));
}

/** feet position within reach of a pickup (horizontal radius + vertical tolerance) */
export function pickupInReach(
  feet: { x: number; y: number; z: number },
  p: { x: number; y: number; z: number },
  radius: number,
): boolean {
  return Math.hypot(feet.x - p.x, feet.z - p.z) <= radius && Math.abs(feet.y - p.y) <= PICKUP_HEIGHT_TOLERANCE;
}

export function clampRespawnSeconds(s: number): number {
  if (!Number.isFinite(s)) return PICKUP_RESPAWN_SECONDS;
  return Math.min(600, Math.max(1, s));
}
