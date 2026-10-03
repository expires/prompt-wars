import { describe, expect, it } from 'vitest';
import {
  CLASS_TEMPLATES,
  DPS_CAP,
  MAX_SHOT_DAMAGE,
  MELEE_DPS_CAP,
  PRESET_WEAPONS,
  WEAPON_CLASSES,
  clampWeapon,
  computeWeaponStats,
  filterCatalogForClass,
  parseJsonObject,
  splashDamageAt,
  type CatalogEntry,
} from '../src';

const legal = (w: ReturnType<typeof clampWeapon>) => {
  const s = computeWeaponStats(w);
  expect(s.perShot).toBeLessThanOrEqual(MAX_SHOT_DAMAGE + 1e-9);
  expect(s.effectiveDps).toBeLessThanOrEqual(s.dpsCap + 1e-6);
  if (s.perShot > 60) expect(w.fireRate).toBeLessThanOrEqual(0.8);
  for (const k of ['damage', 'fireRate', 'magSize', 'range'] as const) expect(Number.isFinite(w[k])).toBe(true);
};

describe('clampWeapon', () => {
  it('keeps the design-doc presets intact', () => {
    expect(PRESET_WEAPONS.pistol).toMatchObject({ damage: 20, fireRate: 3 });
    expect(PRESET_WEAPONS.rifle).toMatchObject({ damage: 12, fireRate: 10 });
    expect(PRESET_WEAPONS.rocket_launcher).toMatchObject({ damage: 90, fireRate: 0.6, splashRadius: 4 });
    expect(PRESET_WEAPONS.shotgun).toMatchObject({ damage: 8, pellets: 8 });
  });

  it('every preset is legal and idempotent under clamp', () => {
    for (const cls of WEAPON_CLASSES) {
      const p = PRESET_WEAPONS[cls];
      legal(p);
      expect(clampWeapon(p)).toEqual(p);
    }
  });

  it('caps absurd LLM output', () => {
    const w = clampWeapon({ class: 'rifle', damage: 9999, fireRate: 9999, magSize: 9999, reloadTime: 0 });
    legal(w);
    expect(computeWeaponStats(w).effectiveDps).toBeLessThanOrEqual(DPS_CAP);
  });

  it('never allows a one-shot from 100 HP, including DoT', () => {
    const w = clampWeapon({ class: 'blowgun', damage: 30, dotDamage: 60 });
    expect(w.damage * w.pellets + w.dotDamage).toBeLessThanOrEqual(95);
    const s = clampWeapon({ class: 'shotgun', damage: 14, pellets: 12 });
    expect(s.damage * s.pellets).toBeLessThanOrEqual(95);
    expect(s.fireRate).toBeLessThanOrEqual(0.8);
  });

  it('limits heavy shots to 0.8/s', () => {
    const w = clampWeapon({ class: 'sniper', damage: 90, fireRate: 5 });
    expect(w.fireRate).toBeLessThanOrEqual(0.8);
  });

  it('forces melee to <= 3 m and gives it a higher budget', () => {
    const w = clampWeapon({ class: 'melee', range: 50, damage: 80, fireRate: 3 });
    expect(w.range).toBeLessThanOrEqual(3);
    expect(w.magSize).toBe(1);
    expect(w.reloadTime).toBe(0);
    expect(computeWeaponStats(w).dpsCap).toBe(MELEE_DPS_CAP);
    legal(w);
  });

  it('caps stream range and DPS', () => {
    const w = clampWeapon({ class: 'flamethrower', range: 40, damage: 50, fireRate: 50, magSize: 1000 });
    expect(w.range).toBeLessThanOrEqual(12);
    expect(w.projectileSpeed).toBe(0);
    legal(w);
  });

  it('unknown class becomes weird, illegal fire mode falls back to template', () => {
    const w = clampWeapon({ class: 'banana-phone', fireMode: 'teleport' });
    expect(w.class).toBe('weird');
    expect(CLASS_TEMPLATES.weird.modes).toContain(w.fireMode);
    const r = clampWeapon({ class: 'rocket', fireMode: 'hitscan' });
    expect(r.class).toBe('rocket_launcher');
    expect(r.fireMode).toBe('projectile');
    expect(r.projectileSpeed).toBeGreaterThan(0);
  });

  it('survives garbage input', () => {
    for (const junk of [null, undefined, 42, 'x', [], { damage: 'NaN', parts: 'nope', colors: 7 }]) {
      const w = clampWeapon(junk);
      legal(w);
      expect(Array.isArray(w.parts)).toBe(true);
      expect(w.colors.primary).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('sanitises parts', () => {
    const w = clampWeapon({
      class: 'pistol',
      parts: [
        { partId: 'barrel_short', scale: 99, offset: [0, 0, -50], color: '#F00' },
        { partId: 'bad id with spaces' },
        { partId: 'grip_a', scale: [1, 2, 3] },
      ],
    });
    expect(w.parts).toEqual([
      { partId: 'barrel_short', scale: 5, offset: [0, 0, -2], color: '#ff0000' },
      { partId: 'grip_a', scale: [1, 2, 3] },
    ]);
  });

  it('random fuzz is always legal', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const raw: Record<string, unknown> = {
        class: WEAPON_CLASSES[Math.floor(rnd() * WEAPON_CLASSES.length)],
        fireMode: ['hitscan', 'projectile', 'arc', 'stream', 'melee'][Math.floor(rnd() * 5)],
      };
      for (const k of ['damage', 'pellets', 'fireRate', 'magSize', 'reloadTime', 'range', 'splashRadius', 'dotDamage', 'dotDuration', 'knockback', 'slowPercent', 'chargeTime'])
        raw[k] = rnd() * 300 - 20;
      legal(clampWeapon(raw));
    }
  });
});

describe('helpers', () => {
  it('splash falls off to 25% at the edge', () => {
    const w = { damage: 80, pellets: 1, splashRadius: 4 };
    expect(splashDamageAt(w, 0)).toBe(80);
    expect(splashDamageAt(w, 4)).toBeCloseTo(20);
    expect(splashDamageAt(w, 4.1)).toBe(0);
  });

  it('parses JSON out of chatty model text', () => {
    expect(parseJsonObject('Sure! ```json\n{"a":{"b":"}"}}\n```')).toEqual({ a: { b: '}' } });
    expect(parseJsonObject('nope')).toBeUndefined();
  });

  it('filters catalog by class', () => {
    const cat: CatalogEntry[] = [
      { id: 'tank_fuel', category: 'magazine', classes: ['flamethrower'], tags: ['fuel'], desc: 'fuel tank' },
      { id: 'scope_long', category: 'sight', classes: ['sniper'], tags: [], desc: '' },
      { id: 'grip_any', category: 'grip', classes: [], tags: [], desc: '' },
    ];
    expect(filterCatalogForClass(cat, 'flamethrower', 'dragon').map(e => e.id).sort()).toEqual(['grip_any', 'tank_fuel']);
  });
});
