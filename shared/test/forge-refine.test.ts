import { describe, expect, it } from 'vitest';
import { boxSize, layoutComponents, sanitizeDesign, sanitizeShape, transformBox, type Box3, type ForgeDesign } from '../src/forge';
import { bladeProfile, expandDesignMacros, expandShape } from '../src/forge/macros';
import { classFromPrompt, detectArchetype, lightness, refineDesign, refinePalette } from '../src/forge/refine';
import { FORGE_EXAMPLES, FORGE_MACRO_EXAMPLES, EXAMPLE_KARAMBIT } from '../src/forge/examples';

const design = (raw: unknown) => sanitizeDesign(expandDesignMacros(raw)).design;

function boxes(d: ForgeDesign) {
  const lay = layoutComponents(d.components);
  const out = new Map<string, { world: Box3; inParent: Box3; parentBox?: Box3 }>();
  for (const c of d.components) {
    const e = lay.get(c.id)!;
    out.set(c.id, { world: e.worldBox, inParent: transformBox(e.localBox, e.local), parentBox: c.parent ? lay.get(c.parent)!.localBox : undefined });
  }
  return out;
}

/** A broken karambit like the live model produced: black blob blade floating away, huge grip, ring in front. */
const BROKEN_KARAMBIT = {
  name: 'Curved Fang',
  class: 'melee',
  fireMode: 'melee',
  palette: { primary: '#1a1a2e', secondary: '#141414', accent: '#e8e8e8', glow: '#ff4444' },
  stats: { damage: 30, fireRate: 2.5, melee: { swing: 'slash', weight: 'light' } },
  components: [
    { id: 'handle', label: 'grip pillar', role: 'core', transform: { pos: [0, 0.06, 0] }, shapes: [{ type: 'cylinder', rTop: 0.07, rBottom: 0.07, h: 0.16, seg: 8, rot: [90, 0, 0], material: { color: 'secondary' } }] },
    { id: 'blade', label: 'claw', role: 'blade', parent: 'handle', attach: 'front', transform: { pos: [0.1, 0.05, -0.2] }, shapes: [{ type: 'blade', length: 0.11, width: 0.03, curve: -0.9, tip: 'hook', material: { color: '#111111', metalness: 0.9 } }] },
    { id: 'ring', label: 'finger ring', role: 'pommel', parent: 'blade', attach: 'front', transform: { pos: [0, 0, -0.05] }, shapes: [{ type: 'torus', r: 0.02, tube: 0.005, rot: [0, 90, 0], material: { color: 'primary', metalness: 0.9 } }] },
  ],
};

describe('shape macros', () => {
  it('expand into legal primitives', () => {
    for (const m of [
      { type: 'blade', length: 0.7, width: 0.03, curve: 0.1, material: { color: 'primary' } },
      { type: 'blade', length: 0.11, width: 0.03, curve: -0.9, tip: 'hook', material: { color: 'primary' } },
      { type: 'blade', length: 0.3, width: 0.05, tip: 'spear', material: { color: 'primary' } },
      { type: 'blade', length: 0.2, width: 0.08, tip: 'square', edge: 'none', material: { color: 'primary' } },
      { type: 'blade', length: 0.2, width: 0.04, tip: 'tanto', material: { color: 'primary' } },
      { type: 'blade', length: 0.2, width: 0.04, tip: 'clip', rot: [0, 0, 20], material: { color: 'primary' } },
      { type: 'pistolgrip', h: 0.11, angle: 18, material: { color: 'secondary' } },
      { type: 'bevelbox', size: [0.04, 0.07, 0.2], material: { color: 'primary' } },
      { type: 'wedge', size: [0.02, 0.08, 0.12], front: 2, material: { color: 'primary' } },
      { type: 'wedge', size: [0.02, 0.08, 0.12], front: 0, material: { color: 'primary' } },
    ]) {
      const out = expandShape(m);
      expect(out.length).toBeGreaterThan(0);
      for (const s of out) expect(sanitizeShape(s), `${m.type}`).not.toBeNull();
    }
  });

  it('a negative curve bends the blade down into a claw, a positive one sweeps it up', () => {
    const claw = bladeProfile(0.11, 0.03, -0.9, 'hook', 'single').body;
    const katana = bladeProfile(0.7, 0.032, 0.1, 'point', 'single').body;
    expect(Math.min(...claw.map(p => p[1]))).toBeLessThan(-0.04);
    expect(Math.max(...katana.map(p => p[1]))).toBeGreaterThan(0.03);
  });

  it('blade grows toward -Z from its base; bevelbox keeps its size', () => {
    const d = design({ name: 'k', class: 'melee', components: [{ id: 'b', role: 'blade', shapes: [{ type: 'blade', length: 0.3, width: 0.04, material: { color: 'primary' } }] }] });
    const b = layoutComponents(d.components).get('b')!.worldBox;
    expect(b.max[2]).toBeLessThan(0.01);
    expect(b.min[2]).toBeLessThan(-0.28);
    const bb = design({ name: 'b', class: 'pistol', components: [{ id: 'x', role: 'core', shapes: [{ type: 'bevelbox', size: [0.04, 0.07, 0.2], material: { color: 'primary' } }] }] });
    const s = boxSize(layoutComponents(bb.components).get('x')!.worldBox);
    expect(s[0]).toBeCloseTo(0.04, 3);
    expect(s[1]).toBeCloseTo(0.07, 3);
    expect(s[2]).toBeCloseTo(0.2, 3);
  });
});

describe('archetypes', () => {
  it('detects archetypes and the class a prompt implies', () => {
    expect(detectArchetype('karambit', 'melee')).toBe('karambit');
    expect(detectArchetype('a katana made of ice', 'melee')).toBe('katana');
    expect(detectArchetype('revolver', 'pistol')).toBe('revolver');
    expect(detectArchetype('', 'shotgun')).toBe('shotgun');
    expect(detectArchetype('a banana launcher', 'grenade_launcher')).toBe('grenade_launcher');
    expect(classFromPrompt('revolver')).toBe('pistol');
    expect(classFromPrompt('karambit')).toBe('melee');
    expect(classFromPrompt('throwing a fish')).toBe('throwable');
    expect(classFromPrompt('a mysterious thing')).toBeUndefined();
  });
});

describe('refineDesign', () => {
  const before = design(BROKEN_KARAMBIT);
  const { design: d, archetype } = refineDesign(before, { prompt: 'karambit' });
  const bx = boxes(d);

  it('re-parents and seats parts on their sockets (blade on the front, ring on the back)', () => {
    expect(archetype).toBe('karambit');
    const ring = d.components.find(c => c.id === 'ring')!;
    expect(ring.parent).toBe('handle');
    const blade = bx.get('blade')!;
    const handle = bx.get('handle')!.world;
    // blade starts at the handle front (small overlap), centred on x
    expect(blade.inParent.max[2]).toBeGreaterThan(blade.parentBox!.min[2] - 0.001);
    expect(blade.inParent.max[2]).toBeLessThan(blade.parentBox!.min[2] + 0.025);
    expect(Math.abs((blade.world.min[0] + blade.world.max[0]) / 2 - (handle.min[0] + handle.max[0]) / 2)).toBeLessThan(0.003);
    const r = bx.get('ring')!.world;
    expect(r.max[2]).toBeGreaterThan(handle.max[2]);
    expect(r.min[2]).toBeLessThan(handle.max[2] + 0.002);
  });

  it('shrinks the grip to hand size and puts the hand at the origin', () => {
    const h = boxSize(bx.get('handle')!.world);
    expect(Math.max(h[0], h[1])).toBeLessThanOrEqual(0.0631);
    const w = bx.get('handle')!.world;
    expect(Math.abs((w.min[2] + w.max[2]) / 2)).toBeLessThan(0.035);
    expect(Math.abs((w.min[1] + w.max[1]) / 2)).toBeLessThan(0.035);
  });

  it('fixes muddy materials: no near-black palette, value contrast blade vs handle, metals capped', () => {
    expect(lightness(d.palette.primary)).toBeGreaterThanOrEqual(20);
    expect(Math.abs(lightness(d.palette.primary) - lightness(d.palette.secondary))).toBeGreaterThanOrEqual(17.5);
    const blade = d.components.find(c => c.id === 'blade')!;
    const col = blade.shapes![0].material.color;
    const hex = col.startsWith('#') ? col : d.palette[col as 'primary'];
    expect(lightness(hex)).toBeGreaterThan(50);
    for (const c of d.components) for (const s of c.shapes ?? []) if (s.material.metalness !== undefined) expect(s.material.metalness).toBeLessThanOrEqual(0.96);
  });

  it('keeps balance stats, re-derives reach, and is stable under sanitize + a second refine', () => {
    expect(d.stats.damage).toBe(before.stats.damage);
    expect(d.stats.fireRate).toBe(before.stats.fireRate);
    expect(sanitizeDesign(d).design).toEqual(d);
    const again = refineDesign(d, { prompt: 'karambit' }).design;
    for (const c of d.components) {
      const c2 = again.components.find(x => x.id === c.id)!;
      c.transform.pos.forEach((v, i) => expect(Math.abs(v - c2.transform.pos[i])).toBeLessThan(0.002));
    }
  });

  it('never moves locked components', () => {
    const raw = expandDesignMacros(BROKEN_KARAMBIT) as typeof BROKEN_KARAMBIT;
    const locked = { ...raw, components: raw.components.map(c => (c.id === 'blade' ? { ...c, locked: true } : c)) };
    const s = sanitizeDesign(locked).design;
    const r = refineDesign(s, { prompt: 'karambit' }).design;
    expect(r.components.find(c => c.id === 'blade')).toEqual(s.components.find(c => c.id === 'blade'));
  });

  it('keeps hand-made examples connected and recognisable (small moves only)', () => {
    for (const e of [...FORGE_EXAMPLES, ...FORGE_MACRO_EXAMPLES]) {
      const s = design(e);
      const r = refineDesign(s, { prompt: e.name });
      expect(r.notes.some(n => n.includes('floating')), `${e.name}: ${r.notes.join(' | ')}`).toBe(false);
      expect(r.design.components.length).toBe(s.components.length);
    }
    const k = refineDesign(design(EXAMPLE_KARAMBIT), { prompt: 'karambit' });
    expect(k.notes.filter(n => n.includes('seated') || n.includes('re-attached'))).toEqual([]);
  });

  it('refinePalette separates primary / secondary and is idempotent', () => {
    const p = refinePalette({ primary: '#101010', secondary: '#151515', accent: '#202020', glow: '#66e0ff' });
    expect(lightness(p.primary)).toBeGreaterThanOrEqual(20);
    expect(Math.abs(lightness(p.primary) - lightness(p.secondary))).toBeGreaterThanOrEqual(17.5);
    expect(refinePalette(p)).toEqual(p);
  });
});

describe('orientation + slim bodies', () => {
  it('lays a standing axe down (handle along Z, head toward -Z) and caps its head size', () => {
    const axe = design({
      name: 'Axe', class: 'melee', palette: { primary: '#c8ced6', secondary: '#4a3728', accent: '#8b5a2b', glow: '#d4af37' },
      components: [
        { id: 'handle', role: 'handle', transform: { pos: [0, 0, 0] }, shapes: [{ type: 'cylinder', rTop: 0.015, rBottom: 0.015, h: 0.65, material: { color: 'secondary' } }] },
        { id: 'head', role: 'blade', parent: 'handle', attach: 'top', transform: {}, shapes: [{ type: 'box', size: [0.02, 0.9, 0.2], pos: [0, 0.45, 0], material: { color: 'primary' } }] },
      ],
    });
    const r = refineDesign(axe, { prompt: 'battle axe' }).design;
    const lay = layoutComponents(r.components);
    const h = boxSize(lay.get('handle')!.worldBox);
    expect(h[2]).toBeGreaterThan(h[1]);
    const head = lay.get('head')!.worldBox;
    const hb = lay.get('handle')!.worldBox;
    expect((head.min[2] + head.max[2]) / 2).toBeLessThan((hb.min[2] + hb.max[2]) / 2);
    expect(Math.max(...boxSize(head))).toBeLessThanOrEqual(0.36);
  });

  it('turns a backwards gun around and slims a slab-wide pistol slide', () => {
    const gun = design({
      name: 'Slab', class: 'pistol',
      components: [
        { id: 'slide', role: 'core', transform: { pos: [0, 0.05, 0] }, shapes: [{ type: 'box', size: [0.16, 0.03, 0.22], material: { color: 'primary' } }] },
        { id: 'barrel', role: 'barrel', parent: 'slide', attach: 'back', transform: {}, shapes: [{ type: 'cylinder', rTop: 0.01, rBottom: 0.01, h: 0.1, rot: [90, 0, 0], pos: [0, 0, 0.05], material: { color: 'accent' } }] },
        { id: 'grip', role: 'grip', parent: 'slide', attach: 'bottom', transform: {}, shapes: [{ type: 'pistolgrip', h: 0.1, material: { color: 'secondary' } }] },
      ],
    });
    const r = refineDesign(gun, { prompt: 'laser pistol' }).design;
    const lay = layoutComponents(r.components);
    const core = lay.get('slide')!.worldBox;
    const barrel = lay.get('barrel')!.worldBox;
    expect(barrel.max[2]).toBeLessThanOrEqual(core.min[2] + 0.02);
    expect(boxSize(core)[0]).toBeLessThanOrEqual(0.0736);
  });

  it('adds missing realistic details to guns once (bore, trigger guard, sights, ejection port)', () => {
    const gun = design({
      name: 'Plain', class: 'pistol',
      components: [
        { id: 'slide', role: 'core', transform: { pos: [0, 0.03, -0.05] }, shapes: [{ type: 'bevelbox', size: [0.026, 0.028, 0.19], material: { color: 'primary' } }] },
        { id: 'barrel', role: 'barrel', parent: 'slide', attach: 'front', transform: {}, shapes: [{ type: 'cylinder', rTop: 0.008, rBottom: 0.008, h: 0.02, rot: [90, 0, 0], pos: [0, 0, -0.01], material: { color: 'secondary' } }] },
        { id: 'grip', role: 'grip', parent: 'slide', attach: 'bottom', transform: { pos: [0, 0, 0.06] }, shapes: [{ type: 'pistolgrip', h: 0.1, material: { color: 'secondary' } }] },
      ],
    });
    const r = refineDesign(gun, { prompt: 'glock' });
    expect(r.notes.join(' ')).toMatch(/bore.*trigger guard.*sights.*ejection port/);
    const count = (d: ForgeDesign) => d.components.reduce((n, c) => n + (c.shapes?.length ?? 0), 0);
    const again = refineDesign(r.design, { prompt: 'glock' });
    expect(count(again.design)).toBe(count(r.design));
  });

  it('clamps blade curves per archetype before expansion', async () => {
    const { adjustRawMacros } = await import('../src/forge/refine');
    const raw = { shapes: [{ type: 'blade', length: 0.7, width: 0.03, curve: 0.4 }] };
    expect((adjustRawMacros(raw, 'katana').shapes[0] as { curve: number }).curve).toBe(0.035);
    expect(adjustRawMacros(raw, 'weird')).toBe(raw);
  });
});
