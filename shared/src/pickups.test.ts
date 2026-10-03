import { describe, expect, it } from 'vitest';
import { MAPS, activeMap, effectiveSpawns, mapPickups } from './maps';
import {
  HEALTH_PACK_HEAL,
  PICKUP_RESPAWN_SECONDS,
  PICKUP_SERVER_RADIUS,
  PICKUP_TOUCH_RADIUS,
  clampRespawnSeconds,
  healAmount,
  pickupInReach,
} from './pickups';

describe('pickups', () => {
  it('heals +50, capped at max HP, nothing at full HP', () => {
    expect(HEALTH_PACK_HEAL).toBe(50);
    expect(healAmount(20)).toBe(50);
    expect(healAmount(70)).toBe(30);
    expect(healAmount(99.5)).toBeCloseTo(0.5);
    expect(healAmount(100)).toBe(0);
    expect(healAmount(120)).toBe(0);
    expect(healAmount(NaN)).toBe(0);
    expect(healAmount(-5)).toBe(50);
  });

  it('reach: horizontal radius + vertical tolerance; server is more generous than the client', () => {
    const p = { x: 0, y: 1.2, z: 0 };
    expect(PICKUP_SERVER_RADIUS).toBeGreaterThan(PICKUP_TOUCH_RADIUS);
    expect(pickupInReach({ x: 0.5, y: 1.25, z: 0.5 }, p, PICKUP_TOUCH_RADIUS)).toBe(true);
    expect(pickupInReach({ x: 1.2, y: 1.25, z: 0 }, p, PICKUP_TOUCH_RADIUS)).toBe(false);
    expect(pickupInReach({ x: 1.2, y: 1.25, z: 0 }, p, PICKUP_SERVER_RADIUS)).toBe(true);
    // jumping over it counts; far above it doesn't
    expect(pickupInReach({ x: 0, y: 2.4, z: 0 }, p, PICKUP_TOUCH_RADIUS)).toBe(true);
    expect(pickupInReach({ x: 0, y: 3.5, z: 0 }, p, PICKUP_SERVER_RADIUS)).toBe(false);
  });

  it('respawn defaults to 60 s; test overrides are clamped', () => {
    expect(PICKUP_RESPAWN_SECONDS).toBe(60);
    expect(clampRespawnSeconds(3)).toBe(3);
    expect(clampRespawnSeconds(0)).toBe(1);
    expect(clampRespawnSeconds(1e9)).toBe(600);
    expect(clampRespawnSeconds(NaN)).toBe(60);
  });

  it('the active map has a health pack, clear of every spawn', () => {
    const def = activeMap();
    const packs = mapPickups(def);
    expect(packs.length).toBeGreaterThan(0);
    for (const p of packs) {
      for (const s of effectiveSpawns(def)) {
        // a spawn must never auto-collect the pack (even with the server's radius)
        expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(PICKUP_SERVER_RADIUS + 0.5);
      }
    }
    expect(mapPickups(MAPS.testmap)).toEqual([]);
  });
});
