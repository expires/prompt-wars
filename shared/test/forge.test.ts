import { describe, expect, it } from 'vitest';
import {
  FORGE_LIMITS,
  applyEdit,
  boxSize,
  clampWeapon,
  computeWeaponStats,
  designBox,
  designToWeapon,
  designTrisEstimate,
  layoutComponents,
  matchesRejected,
  mergeReprompt,
  sanitizeDesign,
  type ForgeDesign,
} from '../src';
import { FORGE_EXAMPLES, EXAMPLE_REVOLVER, EXAMPLE_FRYING_PAN, EXAMPLE_CROC_LAUNCHER } from '../src/forge/examples';

// deterministic garbage generator
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function garbage(r: () => number, depth = 0): unknown {
  const k = Math.floor(r() * 12);
  if (depth > 4) return r() * 1e6 - 5e5;
  switch (k) {
    case 0: return null;
    case 1: return undefined;
    case 2: return r() < 0.5 ? NaN : r() < 0.5 ? Infinity : -Infinity;
    case 3: return (r() - 0.5) * 10 ** Math.floor(r() * 12);
    case 4: return ['box', 'sphere', 'lathe', 'extrude', 'tube', 'front', 'top', '#ff00ff', 'primary', 'zzz', '', '__proto__'][Math.floor(r() * 12)];
    case 5: return Array.from({ length: Math.floor(r() * 40) }, () => garbage(r, depth + 1));
    case 6: return { type: garbage(r, depth + 1), size: garbage(r, depth + 1), pos: garbage(r, depth + 1), r: garbage(r, depth + 1) };
    case 7: return true;
    case 8: return Array.from({ length: 3 }, () => (r() - 0.5) * 100);
    case 9: return Array.from({ length: Math.floor(r() * 60) }, () => [r() * 2 - 1, r() * 2 - 1, r() - 0.5]);
    default: {
      const o: Record<string, unknown> = {};
      const keys = ['id', 'label', 'role', 'parent', 'attach', 'transform', 'catalogPart', 'shapes', 'type', 'material', 'color', 'points', 'outline', 'path', 'depth', 'seg', 'h', 'rTop', 'scale', 'rot', 'locked', 'evil'];
      for (let i = 0; i < 6; i++) o[keys[Math.floor(r() * keys.length)]] = garbage(r, depth + 1);
      return o;
    }
  }
}

function randomDesign(r: () => number): unknown {
  const n = Math.floor(r() * 40);
  const ids = Array.from({ length: n }, (_, i) => (r() < 0.2 ? 'dup' : `c${i}`));
  return {
    name: r() < 0.5 ? garbage(r) : 'x'.repeat(Math.floor(r() * 100)),
    class: garbage(r),
    fireMode: garbage(r),
    stats: { damage: garbage(r), fireRate: (r() - 0.3) * 100, pellets: garbage(r), melee: garbage(r), headshotMultiplier: r() * 10 },
    palette: { primary: garbage(r), accent: '#abc' },
    fx: garbage(r),
    extra: 'strip me',
    components: ids.map(id => ({
      id,
      label: garbage(r),
      role: garbage(r),
      parent: ids[Math.floor(r() * ids.length)],
      attach: garbage(r),
      transform: { pos: [(r() - 0.5) * 50, garbage(r), 0], rot: garbage(r), scale: (r() - 0.2) * 20 },
      ...(r() < 0.3
        ? { catalogPart: { partId: r() < 0.5 ? 'core-pistol-block' : 'nope-not-a-part', color: garbage(r) } }
        : {
            shapes: Array.from({ length: Math.floor(r() * 20) }, () => ({
              type: ['box', 'cylinder', 'cone', 'sphere', 'torus', 'capsule', 'lathe', 'extrude', 'tube', 'blob'][Math.floor(r() * 10)],
              size: [r() * 9, r() * 9, r() * 9],
              r: r() * 5,
              rTop: r(), rBottom: r(), h: r() * 9, tube: r() * 2,
              seg: r() * 500, wseg: r() * 500, hseg: r() * 500,
              points: Array.from({ length: Math.floor(r() * 50) }, () => [r() * 3 - 1, r() * 3 - 1]),
              outline: Array.from({ length: Math.floor(r() * 50) }, () => [r() * 3 - 1, r() * 3 - 1]),
              path: Array.from({ length: Math.floor(r() * 30) }, () => [r() * 3 - 1, r() * 3 - 1, r() * 3 - 1]),
              depth: r() * 4, bevel: r(),
              pos: [r() * 9 - 4, r() * 9 - 4, r() * 9 - 4],
              rot: [r() * 2000, -r() * 2000, 0],
              material: { color: garbage(r), metalness: r() * 3 - 1, opacity: r() * 2 - 0.5, emissive: garbage(r) },
            })),
          }),
    })),
  };
}

const KNOWN = new Set(['core-pistol-block']);

function checkInvariants(d: ForgeDesign) {
  expect(d.components.length).toBeLessThanOrEqual(FORGE_LIMITS.maxComponents);
  const ids = new Set<string>();
  for (const c of d.components) {
    expect(c.id).toMatch(/^[a-z0-9_-]{1,24}$/);
    expect(ids.has(c.id)).toBe(false);
    if (c.parent !== undefined) expect(ids.has(c.parent)).toBe(true); // parents precede children
    ids.add(c.id);
    expect(!!c.catalogPart !== !!c.shapes).toBe(true);
    if (c.catalogPart) expect(KNOWN.has(c.catalogPart.partId)).toBe(true);
    expect((c.shapes ?? []).length).toBeLessThanOrEqual(FORGE_LIMITS.maxShapesPerComponent);
    for (const v of [...c.transform.pos, ...c.transform.rot, ...c.transform.scale]) expect(Number.isFinite(v)).toBe(true);
  }
  expect(designTrisEstimate(d.components)).toBeLessThanOrEqual(FORGE_LIMITS.maxTris);
  const size = Math.max(...boxSize(designBox(layoutComponents(d.components))));
  expect(size).toBeLessThanOrEqual((d.fireMode === 'melee' ? FORGE_LIMITS.maxSizeMelee : FORGE_LIMITS.maxSizeRanged) + 0.02);
  // balance: stats are a clampWeapon fixed point within the budget
  const w = designToWeapon(d);
  const s = computeWeaponStats(w);
  expect(s.effectiveDps).toBeLessThanOrEqual(s.dpsCap + 1e-6);
  expect(w.damage * w.pellets + w.dotDamage).toBeLessThanOrEqual(95 + 1e-6);
  expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  expect(Object.keys(d).sort()).toEqual(['class', 'components', 'fireMode', 'fx', 'name', 'palette', 'stats', 'v']);
}

describe('sanitizeDesign', () => {
  it('survives garbage (fuzz) and always returns a legal, idempotent design', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      const input = seed % 5 === 0 ? garbage(r) : randomDesign(r);
      const { design } = sanitizeDesign(input, { knownPartIds: KNOWN });
      checkInvariants(design);
      const again = sanitizeDesign(design, { knownPartIds: KNOWN }).design;
      expect(again).toEqual(design);
    }
  }, 30_000);

  it('keeps the hand-written examples intact (no warnings, within budget)', () => {
    for (const ex of FORGE_EXAMPLES) {
      const { design, warnings } = sanitizeDesign(ex);
      expect(warnings).toEqual([]);
      expect(design.components.length).toBe(ex.components.length);
      expect(design.name).toBe(ex.name);
      expect(design.class).toBe(ex.class);
      checkInvariants({ ...design, components: design.components.filter(c => !c.catalogPart) });
    }
  });

  it('strips unknown keys, drops unknown catalog parts, fixes cycles and duplicate ids', () => {
    const { design, warnings } = sanitizeDesign(
      {
        name: 'Test',
        class: 'pistol',
        evil: 1,
        components: [
          { id: 'a', label: 'A', role: 'core', parent: 'b', transform: {}, shapes: [{ type: 'box', size: [0.1, 0.1, 0.1], material: { color: '#f00' }, junk: 1 }], junk: 2 },
          { id: 'b', label: 'B', role: 'barrel', parent: 'a', transform: {}, shapes: [{ type: 'sphere', r: 0.05, material: { color: 'accent' } }] },
          { id: 'b', label: 'B2', role: 'nonsense', transform: {}, shapes: [{ type: 'cube', size: [0.1, 0.1, 0.1], material: {} }] },
          { id: 'c', label: 'C', role: 'deco', transform: {}, catalogPart: { partId: 'definitely-not-real' } },
          { id: 'd', label: 'D', role: 'deco', transform: {}, catalogPart: { partId: 'core-pistol-block', color: 'ABCDEF' } },
        ],
      },
      { knownPartIds: KNOWN },
    );
    expect((design as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(design.components.map(c => c.id)).toEqual(['a', 'b', 'b-2', 'd']);
    expect(design.components.find(c => c.id === 'b')!.parent).toBe('a');
    expect(design.components.find(c => c.id === 'a')!.parent).toBeUndefined();
    expect(design.components.find(c => c.id === 'b-2')!.role).toBe('deco');
    expect(design.components.find(c => c.id === 'd')!.catalogPart).toEqual({ partId: 'core-pistol-block', color: '#abcdef' });
    expect(JSON.stringify(design)).not.toContain('junk');
    expect(warnings.some(w => w.includes('definitely-not-real'))).toBe(true);
    expect(warnings.some(w => w.includes('cycle'))).toBe(true);
  });

  it('scales oversized weapons down to the size limit', () => {
    const { design, warnings } = sanitizeDesign({
      class: 'sniper',
      components: [
        { id: 'a', label: 'long', role: 'core', transform: { scale: [1, 1, 3] }, shapes: [{ type: 'box', size: [0.1, 0.1, 2], material: {} }] },
        { id: 'b', label: 'tip', role: 'muzzle', parent: 'a', attach: 'front', transform: {}, shapes: [{ type: 'sphere', r: 0.1, material: {} }] },
      ],
    });
    const size = Math.max(...boxSize(designBox(layoutComponents(design.components))));
    expect(size).toBeCloseTo(FORGE_LIMITS.maxSizeRanged, 1);
    expect(warnings.some(w => w.includes('scaled'))).toBe(true);
  });

  it('snaps floating components back onto their parent (double-counted anchor offsets)', () => {
    const { design, warnings } = sanitizeDesign({
      class: 'melee',
      components: [
        { id: 'shaft', label: 'shaft', role: 'handle', transform: { pos: [0, 0, -0.1] }, shapes: [{ type: 'cylinder', rTop: 0.02, rBottom: 0.02, h: 0.95, rot: [90, 0, 0], material: {} }] },
        { id: 'head', label: 'duck head', role: 'head', parent: 'shaft', attach: 'front', transform: { pos: [0, 0.05, -0.85] }, shapes: [{ type: 'sphere', r: 0.15, material: {} }] },
      ],
    });
    expect(warnings.some(w => w.includes('snapped'))).toBe(true);
    const lay = layoutComponents(design.components);
    const shaft = lay.get('shaft')!.worldBox;
    const head = lay.get('head')!.worldBox;
    expect(head.max[2]).toBeGreaterThanOrEqual(shaft.min[2] - 0.011);
    expect(sanitizeDesign(design).design).toEqual(design);
  });

  it('enforces the triangle budget', () => {
    const shapes = Array.from({ length: 12 }, () => ({ type: 'sphere', r: 0.02, wseg: 24, hseg: 16, material: {} }));
    const { design } = sanitizeDesign({
      class: 'rifle',
      components: Array.from({ length: 24 }, (_, i) => ({ id: `s${i}`, label: 'ball', role: i ? 'deco' : 'core', transform: {}, shapes })),
    });
    expect(designTrisEstimate(design.components)).toBeLessThanOrEqual(FORGE_LIMITS.maxTris);
    expect(design.components.length).toBeGreaterThan(0);
  });

  it('runs clampWeapon on stats (balance budget unchanged) and derives melee reach from geometry', () => {
    const { design } = sanitizeDesign({ ...EXAMPLE_REVOLVER, stats: { damage: 999, fireRate: 99, headshotMultiplier: 9 } });
    const w = designToWeapon(design);
    expect(w).toEqual(clampWeapon(w));
    expect(w.damage).toBeLessThanOrEqual(45);
    expect(w.headshotMultiplier).toBeLessThanOrEqual(2.5);
    const pan = sanitizeDesign(EXAMPLE_FRYING_PAN).design;
    expect(pan.stats.melee?.swing).toBe('overhead');
    // pan rim tip is ~0.47 m in front of the hand
    expect(pan.stats.melee!.reach).toBeGreaterThan(0.35);
    expect(pan.stats.melee!.reach).toBeLessThan(0.6);
    expect(pan.stats.range).toBeCloseTo(Math.max(1.5, pan.stats.melee!.reach + 0.75), 1);
  });
});

describe('applyEdit / mergeReprompt', () => {
  const base = sanitizeDesign(EXAMPLE_CROC_LAUNCHER).design;

  it('locks and unlocks', () => {
    const locked = applyEdit(base, { lock: ['jaw-top', 'nope'] });
    expect(locked.design.components.find(c => c.id === 'jaw-top')!.locked).toBe(true);
    expect(locked.warnings).toContain('no component "nope"');
    const un = applyEdit(locked.design, { op: 'unlock', ids: ['jaw-top'] });
    expect(un.design.components.find(c => c.id === 'jaw-top')!.locked).toBeUndefined();
  });

  it('rejects a component with its unlocked descendants; locked descendants move up', () => {
    const l = applyEdit(base, { lock: ['eyes'] }).design;
    const r = applyEdit(l, { reject: ['jaw-top'] });
    expect(r.removed.map(c => c.id)).toEqual(['jaw-top']);
    const eyes = r.design.components.find(c => c.id === 'eyes')!;
    expect(eyes.parent).toBe('tube');
    const r2 = applyEdit(base, { reject: ['tube'] });
    expect(r2.design.components.map(c => c.id)).toEqual([]);
  });

  it('replaces a component, keeping id, parent and children', () => {
    const r = applyEdit(base, {
      replace: 'jaw-top',
      with: { label: 'shark snout', role: 'muzzle', transform: {}, shapes: [{ type: 'cone', r: 0.06, h: 0.2, rot: [-90, 0, 0], material: { color: '#888888' } }] },
    });
    const c = r.design.components.find(x => x.id === 'jaw-top')!;
    expect(c.label).toBe('shark snout');
    expect(c.parent).toBe('tube');
    expect(r.design.components.find(x => x.id === 'eyes')!.parent).toBe('jaw-top');
  });

  it('reprompt keeps locked components verbatim and drops rejected ones', () => {
    const prev = applyEdit(base, { lock: ['jaw-top', 'tube'] }).design;
    const next = {
      ...sanitizeDesign(EXAMPLE_REVOLVER).design,
      components: [
        ...sanitizeDesign(EXAMPLE_REVOLVER).design.components,
        { id: 'jaw-top', label: 'different jaw', role: 'muzzle', parent: 'frame', transform: {}, shapes: [{ type: 'box', size: [0.1, 0.1, 0.1], material: {} }] },
      ],
    };
    const res = mergeReprompt(prev, next, ['copper steam pipe', 'Spur Hammer']);
    const ids = res.design.components.map(c => c.id);
    expect(ids).toContain('tube');
    expect(ids).not.toContain('pipe');
    expect(ids).not.toContain('hammer');
    for (const id of ['jaw-top', 'tube']) {
      expect(res.design.components.find(c => c.id === id)).toEqual(prev.components.find(c => c.id === id));
    }
    expect(res.design.name).toBe('Brassjaw Regulator');
    // same via applyEdit
    const viaEdit = applyEdit(prev, { reprompt: next, rejected: ['copper steam pipe'] });
    expect(viaEdit.design.components.find(c => c.id === 'tube')).toEqual(prev.components.find(c => c.id === 'tube'));
  });

  it('matchesRejected is case / order insensitive', () => {
    expect(matchesRejected({ id: 'x', label: 'Fluted Barrel' }, ['fluted barrel'])).toBe(true);
    expect(matchesRejected({ id: 'x', label: 'barrel, fluted' }, ['fluted barrel'])).toBe(true);
    expect(matchesRejected({ id: 'x', label: 'long barrel' }, ['fluted barrel'])).toBe(false);
    expect(matchesRejected({ id: 'barrel', label: 'long barrel' }, ['barrel'])).toBe(true);
  });
});
