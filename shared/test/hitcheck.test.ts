import { describe, expect, it } from 'vitest';
import {
  FALLOFF_MIN,
  HEAD_CENTER_CROUCHED,
  HEAD_CENTER_STANDING,
  HIT_ZONE_BODY,
  HIT_ZONE_HEAD,
  PRESET_WEAPONS,
  classifyHit,
  directHitDamage,
  effectiveFireRate,
  fireCreditsMax,
  isPlausibleHeadHit,
  rangeFalloff,
  spendFireCredit,
  splashDistance,
  sweptPoseAt,
  type SweptPose,
} from '../src';

const still = (x: number, y: number, z: number, crouching = false): SweptPose => ({ prev: null, cur: { x, y, z, crouching }, speed: 0 });

describe('rangeFalloff', () => {
  it('is full damage to 60% of range, then linear to 75% at max range', () => {
    expect(rangeFalloff(100, 0)).toBe(1);
    expect(rangeFalloff(100, 60)).toBe(1);
    expect(rangeFalloff(100, 80)).toBeCloseTo(0.875, 6);
    expect(rangeFalloff(100, 100)).toBeCloseTo(FALLOFF_MIN, 6);
    expect(rangeFalloff(100, 500)).toBeCloseTo(FALLOFF_MIN, 6);
  });
  it('applies to hitscan, not projectiles', () => {
    const pistol = PRESET_WEAPONS.pistol; // range 35
    expect(directHitDamage(pistol, 1, 10)).toBe(pistol.damage);
    expect(directHitDamage(pistol, 1, 35)).toBeCloseTo(pistol.damage * 0.75, 6);
    const rocket = PRESET_WEAPONS.rocket_launcher;
    expect(directHitDamage(rocket, 1, rocket.range)).toBe(rocket.damage);
  });
});

describe('fire credits (token bucket)', () => {
  it('long-run rate is exact, bursts are bounded', () => {
    const rate = 10;
    let c = fireCreditsMax(rate);
    let accepted = 0;
    // 10 s of shots attempted every 10 ms (way faster than allowed)
    for (let i = 0; i < 1000; i++) {
      const r = spendFireCredit(c, i === 0 ? 0 : 0.01, rate);
      c = r.credits;
      if (r.ok) accepted++;
    }
    expect(accepted).toBeLessThanOrEqual(Math.floor(fireCreditsMax(rate) + 10 * rate));
    expect(accepted).toBeGreaterThanOrEqual(10 * rate);
  });
  it('tolerates up to 0.2 s of arrival jitter at the nominal rate', () => {
    for (const rate of [0.6, 3, 10, 12]) {
      // deterministic pseudo-random jitter in [0, 0.2] s
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const arrivals = Array.from({ length: 200 }, (_, i) => i / rate + rnd() * 0.2).sort((a, b) => a - b);
      let c = fireCreditsMax(rate);
      let last = arrivals[0];
      let ok = 0;
      for (const a of arrivals) {
        const r = spendFireCredit(c, a - last, rate);
        last = a;
        c = r.credits;
        ok += Number(r.ok);
      }
      expect(ok, `rate ${rate}`).toBe(200);
    }
  });
  it('heavy weapons cannot double-tap', () => {
    const sniper = PRESET_WEAPONS.sniper;
    const rate = effectiveFireRate(sniper);
    const a = spendFireCredit(fireCreditsMax(rate), 100, rate);
    const b = spendFireCredit(a.credits, 0.05, rate);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });
});

describe('hit validation', () => {
  it('accepts head hits only at the head', () => {
    const p = still(0, 0, 0);
    expect(classifyHit(p, [0, HEAD_CENTER_STANDING, 0], HIT_ZONE_HEAD)).toBe(HIT_ZONE_HEAD);
    expect(classifyHit(p, [0.1, HEAD_CENTER_STANDING + 0.1, 0.05], HIT_ZONE_HEAD)).toBe(HIT_ZONE_HEAD);
    // claimed head at the feet => body
    expect(classifyHit(p, [0, 0.3, 0], HIT_ZONE_HEAD)).toBe(HIT_ZONE_BODY);
    // 1.2 m to the side at head height: neither (old check allowed 1.5 m)
    expect(isPlausibleHeadHit(p, [1.2, HEAD_CENTER_STANDING, 0])).toBe(false);
    expect(classifyHit(p, [1.5, HEAD_CENTER_STANDING, 0], HIT_ZONE_HEAD)).toBe(-1);
  });
  it('crouched: standing head height is not a head (nor body) hit', () => {
    const p = still(0, 0, 0, true);
    expect(classifyHit(p, [0, HEAD_CENTER_CROUCHED, 0], HIT_ZONE_HEAD)).toBe(HIT_ZONE_HEAD);
    expect(classifyHit(p, [0, HEAD_CENTER_STANDING + 0.3, 0], HIT_ZONE_HEAD)).toBe(-1);
  });
  it('accepts hits anywhere along the recent trajectory (favor the shooter)', () => {
    const p: SweptPose = { prev: { x: 0, y: 0, z: 0, crouching: false }, cur: { x: 2, y: 0, z: 0, crouching: false }, speed: 0 };
    expect(classifyHit(p, [1, HEAD_CENTER_STANDING, 0], HIT_ZONE_HEAD)).toBe(HIT_ZONE_HEAD);
    expect(classifyHit(p, [0, 1, 0], HIT_ZONE_BODY)).toBe(HIT_ZONE_BODY);
    expect(classifyHit(p, [-1.5, 1, 0], HIT_ZONE_BODY)).toBe(-1);
    // speed widens the tolerance: 6 m/s => +1.5 m
    expect(classifyHit({ ...p, speed: 6 }, [-1.5, 1, 0], HIT_ZONE_BODY)).toBe(HIT_ZONE_BODY);
  });
  it('sweptPoseAt keeps only the last 250 ms of the trajectory', () => {
    const prev = { x: 0, y: 0, z: 0, crouching: false };
    const cur = { x: 10, y: 0, z: 0, crouching: false };
    expect(sweptPoseAt(prev, 0, cur, 1, 5, 0).prev).toBeNull(); // pose is old: standing still
    expect(sweptPoseAt(prev, 9.9, cur, 10, 10, 0).prev).toEqual(prev);
    const s = sweptPoseAt(prev, 9.5, cur, 10, 10, 0); // window starts at 9.75 => halfway
    expect(s.prev!.x).toBeCloseTo(5, 6);
  });
  it('splash distance is measured to the body centre minus tolerance', () => {
    expect(splashDistance(still(0, 0, 0), [0, 0.9, 0])).toBe(0);
    expect(splashDistance(still(0, 0, 0), [3, 0.9, 0])).toBeCloseTo(2.7, 6);
  });
});
