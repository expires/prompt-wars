import { describe, expect, it } from 'vitest';
import {
  ELEMENT_EFFECTS,
  MOVE_MULT_MAX,
  MOVE_MULT_MIN,
  PRESET_WEAPONS,
  WEAPON_CLASSES,
  carryMultiplier,
  clampWeapon,
  computeWeaponStats,
  designBulkPenalty,
  designToWeapon,
  elementCode,
  elementFromCode,
  inferElementFromText,
  moveSpeedLabel,
  sanitizeDesign,
  sanitizeElement,
  slowDurationFor,
  stackedSlow,
  utilityMultiplier,
  weaponMoveMultiplier,
} from '../src';
import { EXAMPLE_REVOLVER } from '../src/forge/examples';

describe('carry weight (movement speed multiplier)', () => {
  it('big weapons slow you down, melee and sidearms speed you up', () => {
    const m = (cls: keyof typeof PRESET_WEAPONS) => PRESET_WEAPONS[cls].moveSpeedMult!;
    expect(m('pistol')).toBeGreaterThanOrEqual(1.05);
    expect(m('pistol')).toBeLessThanOrEqual(1.08);
    expect(m('smg')).toBeGreaterThanOrEqual(1.05);
    expect(m('blowgun')).toBeGreaterThanOrEqual(1.05);
    expect(m('rifle')).toBe(1);
    expect(m('shotgun')).toBe(1);
    expect(m('crossbow')).toBe(1);
    expect(m('sniper')).toBeCloseTo(0.92, 3);
    expect(m('lmg')).toBeLessThanOrEqual(0.92);
    expect(m('rocket_launcher')).toBeCloseTo(0.88, 3);
    expect(m('grenade_launcher')).toBeCloseTo(0.88, 3);
    expect(m('flamethrower')).toBeLessThanOrEqual(0.88);
    expect(carryMultiplier({ class: 'melee', fireMode: 'melee', meleeWeight: 'light', magSize: 1, partCount: 3 })).toBeCloseTo(1.1, 3);
    expect(carryMultiplier({ class: 'melee', fireMode: 'melee', meleeWeight: 'medium', magSize: 1, partCount: 3 })).toBeCloseTo(1.05, 3);
    expect(carryMultiplier({ class: 'melee', fireMode: 'melee', meleeWeight: 'heavy', magSize: 1, partCount: 3 })).toBeLessThan(1);
  });

  it('is always within 0.85 - 1.12 and set on every clamped weapon', () => {
    for (const cls of WEAPON_CLASSES) {
      for (const given of [undefined, 0, 0.5, 1, 1.5, 9, 'fast', -1]) {
        const w = clampWeapon({ class: cls, moveSpeedMult: given, magSize: 300, parts: Array.from({ length: 40 }, () => ({ partId: 'x' })) });
        expect(w.moveSpeedMult).toBeGreaterThanOrEqual(MOVE_MULT_MIN);
        expect(w.moveSpeedMult).toBeLessThanOrEqual(MOVE_MULT_MAX);
      }
    }
  });

  it('a given value may only deviate a little from the derived one', () => {
    const base = clampWeapon({ class: 'rocket_launcher' }).moveSpeedMult!;
    expect(clampWeapon({ class: 'rocket_launcher', moveSpeedMult: 1.12 }).moveSpeedMult).toBeCloseTo(base + 0.02, 3);
    expect(clampWeapon({ class: 'rocket_launcher', moveSpeedMult: 0.5 }).moveSpeedMult).toBeCloseTo(Math.max(MOVE_MULT_MIN, base - 0.05), 3);
  });

  it('huge magazines / many parts weigh more', () => {
    expect(carryMultiplier({ class: 'lmg', fireMode: 'hitscan', magSize: 150, partCount: 4 })).toBeLessThan(carryMultiplier({ class: 'lmg', fireMode: 'hitscan', magSize: 50, partCount: 4 }));
    expect(carryMultiplier({ class: 'rifle', fireMode: 'hitscan', magSize: 20, partCount: 30 })).toBeLessThan(1);
  });

  it('faster movement costs DPS budget, slower does not refund it', () => {
    const w = { splashRadius: 0, slowPercent: 0, knockback: 0 };
    expect(utilityMultiplier({ ...w, moveSpeedMult: 1.1 })).toBeCloseTo(1.05, 6);
    expect(utilityMultiplier({ ...w, moveSpeedMult: 0.88 })).toBe(1);
    // same raw stats: the light melee weapon ends up with less damage than the heavy one
    const raw = { class: 'melee', damage: 55, fireRate: 2.5 }; // way over the 80 DPS melee budget
    const light = clampWeapon({ ...raw, melee: { swing: 'slash', reach: 1, weight: 'light' } });
    const heavy = clampWeapon({ ...raw, melee: { swing: 'slash', reach: 1, weight: 'heavy' } });
    expect(light.moveSpeedMult).toBeGreaterThan(heavy.moveSpeedMult!);
    expect(light.damage * light.fireRate).toBeLessThan(heavy.damage * heavy.fireRate);
    for (const x of [light, heavy]) {
      const s = computeWeaponStats(x);
      expect(s.effectiveDps).toBeLessThanOrEqual(s.dpsCap + 1e-6);
    }
  });

  it('labels and legacy weapons', () => {
    expect(moveSpeedLabel(1.08)).toBe('+8%');
    expect(moveSpeedLabel(0.88)).toBe('−12%');
    expect(moveSpeedLabel(1)).toBe('±0%');
    // a weapon row stored before moveSpeedMult existed: derived on the fly
    const { moveSpeedMult: _m, ...legacy } = PRESET_WEAPONS.sniper;
    expect(weaponMoveMultiplier(legacy)).toBeCloseTo(0.92, 3);
  });

  it('big forge designs get an extra penalty (designToWeapon keeps it)', () => {
    expect(designBulkPenalty(1, 6, false)).toBe(0);
    expect(designBulkPenalty(2.5, 24, false)).toBeGreaterThan(0.03);
    expect(designBulkPenalty(2.5, 24, false)).toBeLessThanOrEqual(0.05);
    const small = sanitizeDesign(EXAMPLE_REVOLVER).design;
    const big = sanitizeDesign({
      ...EXAMPLE_REVOLVER,
      components: [
        ...EXAMPLE_REVOLVER.components,
        { id: 'pole', label: 'very long pole', role: 'deco', transform: { pos: [0, 0, -1] }, shapes: [{ type: 'box', size: [0.05, 0.05, 2.4] }] },
      ],
    }).design;
    expect(big.stats.moveSpeedMult).toBeLessThan(small.stats.moveSpeedMult!);
    expect(designToWeapon(big).moveSpeedMult).toBeCloseTo(big.stats.moveSpeedMult!, 4);
    // a design can't claim a faster carry than its model allows
    const cheat = sanitizeDesign({ ...big, stats: { ...big.stats, moveSpeedMult: 1.12 } }).design;
    expect(cheat.stats.moveSpeedMult).toBeCloseTo(big.stats.moveSpeedMult!, 4);
  });
});

describe('elements', () => {
  it('codes round-trip', () => {
    for (const e of ['fire', 'ice', 'poison', 'shock'] as const) expect(elementFromCode(elementCode(e))).toBe(e);
    expect(elementFromCode(0)).toBeNull();
    expect(elementCode(null)).toBe(0);
  });

  it('sanitizes and infers from text', () => {
    expect(sanitizeElement('FIRE')).toBe('fire');
    expect(sanitizeElement('none')).toBeNull();
    expect(sanitizeElement(null)).toBeNull();
    expect(sanitizeElement(undefined)).toBeUndefined();
    expect(sanitizeElement('frost')).toBe('ice');
    expect(sanitizeElement(42)).toBeUndefined();
    expect(inferElementFromText('Lava Lobber')).toBe('fire');
    expect(inferElementFromText('Frostbite SMG')).toBe('ice');
    expect(inferElementFromText('Snowball Launcher')).toBe('ice');
    expect(inferElementFromText('Tesla Coil')).toBe('shock');
    expect(inferElementFromText('Venom Spitter')).toBe('poison');
    // no false positives on common names
    expect(inferElementFromText('Service Pistol')).toBeNull();
    expect(inferElementFromText('Device of Dice')).toBeNull();
  });

  it('presets map onto the element system (existing DoT / slow kept)', () => {
    expect(PRESET_WEAPONS.flamethrower.element).toBe('fire');
    expect(PRESET_WEAPONS.flamethrower.dotDamage).toBeGreaterThan(0);
    expect(PRESET_WEAPONS.blowgun.element).toBe('poison');
    expect(PRESET_WEAPONS.blowgun.dotDamage).toBeGreaterThan(30); // its own heavy poison is kept
    expect(PRESET_WEAPONS.bubble_gun.element).toBeNull();
    expect(PRESET_WEAPONS.bubble_gun.slowPercent).toBe(40); // plain bubble slow still works
    expect(PRESET_WEAPONS.pistol.element).toBeNull();
    expect(PRESET_WEAPONS.rifle.element).toBeNull();
  });

  it('elemental weapons get the default effect, inside the budget', () => {
    const fire = clampWeapon({ class: 'rifle', element: 'fire' });
    expect(fire.dotDamage).toBeGreaterThan(0);
    expect(fire.dotDamage / fire.dotDuration).toBeLessThanOrEqual(ELEMENT_EFFECTS.fire.dotDamage / ELEMENT_EFFECTS.fire.dotDuration + 1e-9);
    const ice = clampWeapon({ class: 'pistol', name: 'Frost Pistol' });
    expect(ice.element).toBe('ice');
    expect(ice.slowPercent).toBe(ELEMENT_EFFECTS.ice.slowPercent);
    const shock = clampWeapon({ class: 'smg', element: 'shock' });
    expect(shock.slowPercent).toBe(ELEMENT_EFFECTS.shock.slowPercent);
    const poison = clampWeapon({ class: 'crossbow', element: 'poison' });
    expect(poison.dotDuration).toBe(ELEMENT_EFFECTS.poison.dotDuration);
    // explicit null beats the name
    expect(clampWeapon({ class: 'pistol', name: 'Frost Pistol', element: null }).element).toBeNull();
    // the element costs budget: same raw stats, less direct damage than the plain weapon
    const raw = { class: 'smg', damage: 18, fireRate: 18, magSize: 50, reloadTime: 1.2 };
    const plain = clampWeapon({ ...raw, element: null });
    for (const e of ['fire', 'ice', 'poison', 'shock']) {
      const w = clampWeapon({ ...raw, element: e });
      expect(w.damage).toBeLessThan(plain.damage);
      const s = computeWeaponStats(w);
      expect(s.effectiveDps).toBeLessThanOrEqual(s.dpsCap + 1e-6);
      expect(s.perShot).toBeLessThanOrEqual(95);
    }
  });

  it('clamping is idempotent with elements + carry weight', () => {
    const inputs = [
      { class: 'melee', name: 'Inferno Axe', damage: 80, fireRate: 3 },
      { class: 'shotgun', element: 'ice', pellets: 12, damage: 14 },
      { class: 'sniper', element: 'shock', moveSpeedMult: 1.2 },
      { class: 'flamethrower' },
      { class: 'weird', element: 'poison', slowPercent: 60, splashRadius: 6 },
      ...WEAPON_CLASSES.map((c) => ({ class: c, element: 'fire' })),
    ];
    for (const raw of inputs) {
      const a = clampWeapon(raw);
      expect(clampWeapon(a)).toEqual(a);
      expect(clampWeapon(JSON.parse(JSON.stringify(a)))).toEqual(a);
    }
  });

  it('slow application: ice stacks to 60 %, shock is brief, plain slows refresh', () => {
    expect(stackedSlow('ice', 35, null)).toBe(35);
    expect(stackedSlow('ice', 35, { percent: 35, element: 'ice' })).toBeCloseTo(52.5, 6);
    expect(stackedSlow('ice', 35, { percent: 52.5, element: 'ice' })).toBe(60);
    expect(stackedSlow('ice', 35, { percent: 40, element: null })).toBe(35); // bubbles don't stack into ice
    expect(stackedSlow(null, 40, { percent: 40, element: null })).toBe(40);
    expect(stackedSlow('shock', 60, null)).toBe(60);
    expect(slowDurationFor('shock')).toBeCloseTo(0.4, 6);
    expect(slowDurationFor('ice')).toBeCloseTo(1.5, 6);
    expect(slowDurationFor(null)).toBeCloseTo(1.5, 6);
  });
});
