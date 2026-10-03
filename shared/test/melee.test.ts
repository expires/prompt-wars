import { describe, expect, it } from 'vitest';
import {
  BLOCK_DAMAGE_MULT,
  CHARGED_BODY_CAP,
  CHARGED_HEAD_CAP,
  HIT_ZONE_BODY,
  HIT_ZONE_HEAD,
  MELEE_CHARGE_SLACK,
  MELEE_DPS_CAP,
  MELEE_PHASES,
  MELEE_REACH_MAX,
  MELEE_REACH_MIN,
  MELEE_SWINGS,
  PRESET_WEAPONS,
  blockCovers,
  clampWeapon,
  computeWeaponStats,
  effectiveFireRate,
  grantedCharge,
  inferMeleeMeta,
  isMeleeReachValid,
  meleeArcPoint,
  meleeHitDamage,
  meleeReach,
  meleeSwingDuration,
  parseTemplateSummaries,
  sampleMeleeArc,
  templateToRawWeapon,
} from '../src';

const DEG = 180 / Math.PI;
const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * DEG;

describe('melee metadata in clampWeapon', () => {
  it('melee weapons always get meta; ranged weapons never', () => {
    const m = PRESET_WEAPONS.melee;
    expect(m.melee).toBeDefined();
    expect(m.melee!.swing).toBe('slash'); // Machete
    expect(PRESET_WEAPONS.pistol.melee).toBeUndefined();
    expect(clampWeapon(m)).toEqual(m);
  });

  it('infers swing from name / parts', () => {
    const base = { damage: 45, fireRate: 1.5, range: 2.5, parts: [] };
    expect(inferMeleeMeta({ ...base, name: 'Big Sledgehammer' }).swing).toBe('overhead');
    expect(inferMeleeMeta({ ...base, name: 'Frying Pan of Justice' }).swing).toBe('overhead');
    expect(inferMeleeMeta({ ...base, name: 'Ronin Katana' }).swing).toBe('slash');
    expect(inferMeleeMeta({ ...base, name: 'x', parts: [{ partId: 'head-spear-leaf-1' }] }).swing).toBe('thrust');
    expect(inferMeleeMeta({ ...base, name: 'Grandma umbrella' }).swing).toBe('thrust');
    expect(inferMeleeMeta({ ...base, name: 'Riot Shield' }).swing).toBe('bash');
    expect(inferMeleeMeta({ ...base, name: 'Japanese Katana' }).swing).toBe('slash'); // "pan" inside a word
    expect(inferMeleeMeta({ ...base, name: 'x', damage: 70, fireRate: 0.8 }).weight).toBe('heavy');
  });

  it('keeps template meta, clamps reach and floors the effective reach', () => {
    const w = clampWeapon({ class: 'melee', name: 'Kettlebell', melee: { swing: 'bash', reach: 0.05, weight: 'heavy' } });
    expect(w.melee).toEqual({ swing: 'bash', reach: 0.3, weight: 'heavy' });
    expect(meleeReach(w)).toBe(MELEE_REACH_MIN);
    const spear = clampWeapon({ class: 'melee', name: 'Pike', melee: { swing: 'thrust', reach: 9, weight: 'medium' } });
    expect(meleeReach(spear)).toBe(MELEE_REACH_MAX);
    expect(spear.range).toBeLessThanOrEqual(3);
    expect(clampWeapon(spear)).toEqual(spear);
    const bad = clampWeapon({ class: 'melee', name: 'Odd Sword', melee: { swing: 'twirl', weight: 'huge' } });
    expect(bad.melee!.swing).toBe('slash');
  });

  it('swing rate never exceeds the weight animation and stays within the melee budget', () => {
    const heavy = clampWeapon({ class: 'melee', damage: 40, fireRate: 2.5, melee: { swing: 'overhead', reach: 1, weight: 'heavy' } });
    expect(effectiveFireRate(heavy)).toBeCloseTo(1 / 0.9, 5);
    expect(computeWeaponStats(heavy).effectiveDps).toBeLessThanOrEqual(MELEE_DPS_CAP + 1e-6);
  });
});

describe('swing arc sampling', () => {
  it('every swing type sweeps a unit-direction arc with the documented shape', () => {
    for (const s of MELEE_SWINGS) {
      for (let u = 0; u <= 1; u += 0.1) {
        const p = meleeArcPoint(s, 0, u, 90);
        expect(Math.hypot(...p.dir)).toBeCloseTo(1, 6);
        expect(p.reachFrac).toBeGreaterThan(0.5 - 1e-9);
        expect(p.reachFrac).toBeLessThanOrEqual(1);
      }
      expect(MELEE_PHASES[s].strikeStart).toBeLessThan(MELEE_PHASES[s].strikeEnd);
    }
    // slash combo alternates direction: combo 0 goes right -> left, combo 1 left -> right
    expect(meleeArcPoint('slash', 0, 0, 90).dir[0]).toBeGreaterThan(0.3);
    expect(meleeArcPoint('slash', 0, 1, 90).dir[0]).toBeLessThan(-0.3);
    expect(meleeArcPoint('slash', 1, 0, 90).dir[0]).toBeLessThan(-0.3);
    expect(meleeArcPoint('slash', 1, 1, 90).dir[0]).toBeGreaterThan(0.3);
    // overhead goes from above to below the crosshair, through the centre
    expect(meleeArcPoint('overhead', 0, 0).dir[1]).toBeGreaterThan(0.7);
    expect(meleeArcPoint('overhead', 0, 1).dir[1]).toBeLessThan(-0.4);
    // thrust stays near the crosshair and lunges out to full reach
    expect(angle(meleeArcPoint('thrust', 0, 0.5).dir, [0, 0, -1])).toBeLessThan(8);
    expect(meleeArcPoint('thrust', 0, 0).reachFrac).toBeLessThan(meleeArcPoint('thrust', 0, 1).reachFrac);
    // spin covers behind the player
    expect(meleeArcPoint('spin', 0, 0).dir[2]).toBeGreaterThan(0.9);
    expect(meleeArcPoint('spin', 0, 0.5).dir[2]).toBeLessThan(-0.9);
  });

  it('samples are dense enough (<= 3 deg) and cover the arc without gaps across frames', () => {
    for (const s of MELEE_SWINGS) {
      const frames = [0, 0.13, 0.4, 0.41, 0.77, 1];
      const all = [];
      for (let i = 1; i < frames.length; i++) all.push(...sampleMeleeArc(s, 1, frames[i - 1], frames[i], 120, 3));
      expect(all[0].u).toBe(0);
      expect(all[all.length - 1].u).toBe(1);
      for (let i = 1; i < all.length; i++) {
        expect(all[i].u).toBeGreaterThan(all[i - 1].u);
        expect(angle(all[i].dir, all[i - 1].dir)).toBeLessThan(3.2);
      }
    }
    expect(sampleMeleeArc('slash', 0, 0.5, 0.2)).toEqual([]);
  });
});

describe('server melee validation', () => {
  const w = clampWeapon({ class: 'melee', name: 'Katana', damage: 45, fireRate: 1.2, headshotMultiplier: 1.5, melee: { swing: 'slash', reach: 0.75, weight: 'medium' } });

  it('reach: within weapon reach + tolerance only, longer when charged', () => {
    const r = meleeReach(w);
    expect(r).toBeCloseTo(1.5, 5);
    expect(isMeleeReachValid([0, 1.6, 0], [0, 1.6, -r], r)).toBe(true);
    expect(isMeleeReachValid([0, 1.6, 0], [0, 1.6, -(r + 0.35)], r)).toBe(true);
    expect(isMeleeReachValid([0, 1.6, 0], [0, 1.6, -(r + 0.6)], r)).toBe(false);
    expect(meleeReach(w, 1)).toBeCloseTo(r * 1.25, 5);
  });

  it('charge is bounded by the time since the last swing', () => {
    expect(grantedCharge(1, 5)).toBe(1);
    expect(grantedCharge(1, 0.4)).toBeCloseTo(0.4 + MELEE_CHARGE_SLACK, 6);
    expect(grantedCharge(1, 0)).toBeLessThanOrEqual(MELEE_CHARGE_SLACK); // slack only
    expect(grantedCharge(0.1, 5)).toBe(0);
    expect(grantedCharge(Number.NaN, 5)).toBe(0);
    expect(grantedCharge(7, 5)).toBe(1);
  });

  it('charged damage: more than plain, within the caps; block reduces', () => {
    const plain = meleeHitDamage(w, 0, HIT_ZONE_BODY);
    expect(plain).toBe(w.damage);
    const full = meleeHitDamage(w, 1, HIT_ZONE_BODY);
    expect(full).toBeGreaterThan(plain);
    expect(full).toBeLessThanOrEqual(CHARGED_BODY_CAP);
    const head = meleeHitDamage(w, 1, HIT_ZONE_HEAD);
    expect(head).toBeLessThanOrEqual(CHARGED_HEAD_CAP);
    expect(head).toBeGreaterThanOrEqual(full);
    expect(meleeHitDamage(w, 1, HIT_ZONE_BODY, true)).toBeCloseTo(full * BLOCK_DAMAGE_MULT, 6);
    // a heavy 80-damage weapon: charge can't push it above its own plain hit + caps
    const big = clampWeapon({ class: 'melee', damage: 80, fireRate: 0.5 });
    expect(meleeHitDamage(big, 1, HIT_ZONE_BODY)).toBe(big.damage);
  });

  it('block covers the front 120 degree cone only', () => {
    // victim at origin facing -Z (yaw 0)
    expect(blockCovers([0, 0, 0], 0, [0, 0, -2])).toBe(true);
    expect(blockCovers([0, 0, 0], 0, [1.5, 0, -2])).toBe(true); // ~37 deg
    expect(blockCovers([0, 0, 0], 0, [2, 0, 0])).toBe(false); // 90 deg
    expect(blockCovers([0, 0, 0], 0, [0, 0, 2])).toBe(false); // behind
    expect(blockCovers([0, 0, 0], Math.PI, [0, 0, 2])).toBe(true);
  });

  it('swing duration by weight, slower when charged', () => {
    expect(meleeSwingDuration('light')).toBeCloseTo(0.35);
    expect(meleeSwingDuration('medium')).toBeCloseTo(0.55);
    expect(meleeSwingDuration('heavy')).toBeCloseTo(0.9);
    expect(meleeSwingDuration('medium', 1)).toBeGreaterThan(0.55);
  });
});

describe('templates', () => {
  it('parses client summaries defensively and builds a legal weapon from one', () => {
    const json = JSON.stringify([
      {
        id: 'melee-x', name: "Grandma's Golf Umbrella Sword", class: 'melee', fireMode: 'melee',
        parts: [{ partId: 'core-handle-pan' }, { partId: 'blade-umbrella-classic' }],
        statHints: { damage: 'low', fireRate: 'fast', range: 'short' },
        melee: { swing: 'thrust', reach: 1.05, weight: 'light' },
      },
      { name: 'no parts', class: 'pistol', parts: [] },
      'junk',
    ]);
    const list = parseTemplateSummaries(json);
    expect(list).toHaveLength(1);
    const w = clampWeapon(templateToRawWeapon(list[0]));
    expect(w.class).toBe('melee');
    expect(w.name).toContain('Umbrella');
    expect(w.melee).toEqual({ swing: 'thrust', reach: 1.05, weight: 'light' });
    expect(w.damage).toBeLessThan(PRESET_WEAPONS.melee.damage);
    expect(parseTemplateSummaries('not json')).toEqual([]);
    expect(parseTemplateSummaries('x'.repeat(20_000))).toEqual([]);
  });
});
