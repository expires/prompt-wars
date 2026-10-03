import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FORGE_LIMITS,
  PROJECTILE_ID,
  PROJECTILE_SHAPES,
  applyEdit,
  boxSize,
  emptyBox,
  isEmptyBox,
  mergeReprompt,
  presetProjectile,
  projectileRejectKey,
  projectileRejected,
  sanitizeDesign,
  sanitizeProjectile,
  shapeBox,
  shapeTris,
  unionBox,
  designToWeapon,
  type ProjectileDesign,
} from '../src';
import { EXAMPLE_BANANA_LAUNCHER, EXAMPLE_CROC_LAUNCHER, EXAMPLE_REVOLVER, EXAMPLE_THROWN_FISH } from '../src/forge/examples';
import { buildProjectileGroup, createProjectileMesh, disposeProjectileGroup, projectileModel } from '../src/forge/projectile3d';

const box = (p: ProjectileDesign) => p.shapes.reduce((b, s) => unionBox(b, shapeBox(s)), emptyBox());
const longest = (p: ProjectileDesign) => Math.max(...boxSize(box(p)));
const tris = (p: ProjectileDesign) => p.shapes.reduce((n, s) => n + shapeTris(s), 0);
const PALETTE = { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff', glow: '#ffffff' };

function checkProjectile(p: ProjectileDesign) {
  expect(p.shapes.length).toBeGreaterThan(0);
  expect(p.shapes.length).toBeLessThanOrEqual(FORGE_LIMITS.maxProjectileShapes);
  expect(tris(p)).toBeLessThanOrEqual(FORGE_LIMITS.projectileMaxTris);
  const L = longest(p);
  expect(L).toBeLessThanOrEqual(FORGE_LIMITS.projectileMaxSize + 1e-3);
  expect(L).toBeGreaterThanOrEqual(FORGE_LIMITS.projectileMinSize - 1e-3);
  const b = box(p);
  for (let i = 0; i < 3; i++) expect(Math.abs((b.min[i] + b.max[i]) / 2)).toBeLessThan(0.006);
  if (p.spin) expect(Math.abs(p.spin.rate)).toBeLessThanOrEqual(FORGE_LIMITS.maxProjectileSpin);
  if (p.wobble !== undefined) expect(p.wobble).toBeGreaterThan(0);
  expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  // idempotent
  expect(sanitizeProjectile(p)).toEqual(p);
}

describe('sanitizeProjectile', () => {
  it('keeps the hand-written example projectiles without warnings', () => {
    for (const ex of [EXAMPLE_CROC_LAUNCHER, EXAMPLE_BANANA_LAUNCHER, EXAMPLE_THROWN_FISH]) {
      const warnings: string[] = [];
      const p = sanitizeProjectile(ex.projectile, warnings)!;
      expect(warnings).toEqual([]);
      expect(p.shapes.length).toBe(ex.projectile.shapes.length);
      checkProjectile(p);
    }
  });

  it('clamps size, shape count, spin, wobble; drops unknowns; recentres', () => {
    const warnings: string[] = [];
    const p = sanitizeProjectile(
      {
        label: '  giant\u0007 rock  ',
        evil: 'x',
        shapes: [
          ...Array.from({ length: 12 }, (_, i) => ({ type: 'box', size: [2, 2, 2], pos: [1, 0, i * 0.01], material: { color: 'nope', emissive: 'glow' } })),
        ],
        spin: { axis: 'w', rate: 99 },
        wobble: 7,
        trail: 'lava',
        trailColor: 'abc',
        impact: 'SPLASH',
      },
      warnings,
    )!;
    expect(p.label).toBe('giant rock');
    expect(p.shapes.length).toBe(FORGE_LIMITS.maxProjectileShapes);
    expect(p.spin).toEqual({ axis: 'z', rate: FORGE_LIMITS.maxProjectileSpin });
    expect(p.wobble).toBe(1);
    expect(p.trail).toBeUndefined();
    expect(p.trailColor).toBe('#aabbcc');
    expect(p.impact).toBe('splash');
    expect((p as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(p.shapes[0].material.color).toBe('primary');
    checkProjectile(p);
    expect(warnings.some(w => w.includes('scaled down'))).toBe(true);
  });

  it('scales tiny projectiles up and simplifies heavy ones', () => {
    const tiny = sanitizeProjectile({ shapes: [{ type: 'sphere', r: 0.004 }] })!;
    checkProjectile(tiny);
    const heavy = sanitizeProjectile({ shapes: Array.from({ length: 8 }, () => ({ type: 'sphere', r: 0.05, wseg: 24, hseg: 16 })) })!;
    checkProjectile(heavy);
  });

  it('returns undefined for garbage', () => {
    for (const g of [null, 3, 'x', [], {}, { shapes: [] }, { shapes: [{ type: 'teapot' }] }]) expect(sanitizeProjectile(g)).toBeUndefined();
  });

  it('fuzz: anything in, legal projectile (or nothing) out', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const types = ['box', 'cylinder', 'cone', 'sphere', 'torus', 'capsule', 'lathe', 'extrude', 'tube', 'blah'];
    const n = () => (r() - 0.5) * 10 ** Math.floor(r() * 4);
    for (let i = 0; i < 300; i++) {
      const shapes = Array.from({ length: Math.floor(r() * 12) }, () => ({
        type: types[Math.floor(r() * types.length)],
        size: [n(), n(), n()], r: n(), h: n(), rTop: n(), rBottom: n(), tube: n(), seg: n(),
        points: [[n(), n()], [n(), n()], [n(), n()]], outline: [[0, 0], [n(), n()], [n(), n()], [n(), 0]], path: [[n(), n(), n()], [n(), n(), n()]],
        depth: n(), pos: [n(), n(), n()], rot: [n(), n(), n()], scale: [n(), n(), n()],
      }));
      const p = sanitizeProjectile({ label: 'x', shapes, spin: { axis: 'x', rate: n() }, wobble: n() });
      if (p) checkProjectile(p);
    }
  });
});

describe('design.projectile', () => {
  it('rides along in sanitizeDesign for projectile / arc weapons, never changes stats', () => {
    const { design, warnings } = sanitizeDesign(EXAMPLE_CROC_LAUNCHER);
    expect(warnings).toEqual([]);
    expect(design.projectile?.label).toBe('toothy croc rocket');
    const { projectile: _p, ...noProj } = EXAMPLE_CROC_LAUNCHER;
    expect(designToWeapon(design)).toEqual(designToWeapon(sanitizeDesign(noProj).design));
    expect(sanitizeDesign(design).design).toEqual(design);
  });

  it('is dropped for hitscan / melee weapons and when invalid', () => {
    const hit = sanitizeDesign({ ...EXAMPLE_REVOLVER, projectile: EXAMPLE_CROC_LAUNCHER.projectile });
    expect(hit.design.projectile).toBeUndefined();
    expect(hit.warnings.some(w => w.includes('projectile dropped'))).toBe(true);
    const bad = sanitizeDesign({ ...EXAMPLE_CROC_LAUNCHER, projectile: { shapes: [{ type: 'nope' }] } });
    expect(bad.design.projectile).toBeUndefined();
  });

  it('throwables keep their projectile (the thrown object)', () => {
    const { design } = sanitizeDesign(EXAMPLE_THROWN_FISH);
    expect(design.class).toBe('throwable');
    expect(design.projectile?.spin).toEqual({ axis: 'x', rate: 2 });
  });

  it('lock / unlock / reject via PROJECTILE_ID; reprompt respects marks', () => {
    const base = sanitizeDesign(EXAMPLE_CROC_LAUNCHER).design;
    const locked = applyEdit(base, { lock: [PROJECTILE_ID] }).design;
    expect(locked.projectile?.locked).toBe(true);
    expect(applyEdit(locked, { unlock: [PROJECTILE_ID] }).design.projectile?.locked).toBeUndefined();

    // locked projectile survives a reprompt verbatim
    const next = { ...sanitizeDesign(EXAMPLE_BANANA_LAUNCHER).design, class: 'rocket_launcher', fireMode: 'projectile' };
    const merged = mergeReprompt(locked, next);
    expect(merged.design.projectile).toEqual(locked.projectile);
    // unlocked: next one wins
    expect(mergeReprompt(base, next).design.projectile?.label).toBe('ripe banana');

    // reject removes it and reports it; the key blocks the same projectile next time
    const rej = applyEdit(base, { reject: [PROJECTILE_ID] });
    expect(rej.design.projectile).toBeUndefined();
    expect(rej.removedProjectile?.label).toBe('toothy croc rocket');
    const key = projectileRejectKey('ripe banana');
    expect(projectileRejected({ label: 'Ripe Banana' }, [key])).toBe(true);
    expect(projectileRejected({ label: 'ripe banana' }, ['ripe banana'])).toBe(false); // component entries don't count
    expect(mergeReprompt(base, next, [key]).design.projectile).toBeUndefined();

    // set op can add / remove
    expect(applyEdit(base, { op: 'set', projectile: null }).design.projectile).toBeUndefined();
  });

  it('presets cover every projectileShape', () => {
    for (const s of PROJECTILE_SHAPES) checkProjectile(presetProjectile(s, '#ff8800'));
  });
});

describe('projectile3d', () => {
  it('builds a merged, cached mesh with the estimated triangle count', () => {
    const p = sanitizeProjectile(EXAMPLE_CROC_LAUNCHER.projectile)!;
    const a = createProjectileMesh(p, PALETTE);
    const b = createProjectileMesh(p, PALETTE);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect(a.geometry.attributes.position.count / 3).toBe(tris(p));
    // one draw group per distinct material
    expect(a.geometry.groups.length).toBe((a.material as THREE.Material[]).length);
    expect(projectileModel(p, { ...PALETTE, primary: '#123456' }).geometry).not.toBe(a.geometry);
    const real = new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3());
    expect(Math.max(real.x, real.y, real.z)).toBeLessThanOrEqual(longest(p) * 1.03);
  });

  it('builds the preview group', () => {
    const p = presetProjectile('rocket', '#ff0000');
    const g = buildProjectileGroup(p, PALETTE);
    expect(g.children.length).toBe(p.shapes.length);
    const bb = new THREE.Box3().setFromObject(g);
    expect(isEmptyBox({ min: bb.min.toArray(), max: bb.max.toArray() })).toBe(false);
    disposeProjectileGroup(g);
  });
});
