import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PARTS, getPart, catalogForClass, catalog } from '../src/registry';
import { RECIPES } from '../src/recipes';
import { assembleWeapon } from '../src/assemble';
import { countTris } from '../src/lib/kit';
import { CATEGORIES, SOCKET_NAMES, WEAPON_CLASSES } from '../src/types';

const TRI_LIMIT = 500;

describe('part library', () => {
  it('has >= 1000 parts', () => {
    expect(PARTS.length).toBeGreaterThanOrEqual(1000);
  });

  it('ids are unique kebab-case', () => {
    const seen = new Set<string>();
    for (const p of PARTS) {
      expect(seen.has(p.id), `duplicate id ${p.id}`).toBe(false);
      seen.add(p.id);
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('metadata is well-formed', () => {
    const cls = new Set<string>(WEAPON_CLASSES);
    const cats = new Set<string>(CATEGORIES);
    const socks = new Set<string>(SOCKET_NAMES);
    for (const p of PARTS) {
      expect(cats.has(p.category), `${p.id} category ${p.category}`).toBe(true);
      expect(p.classes.length, `${p.id} has no classes`).toBeGreaterThan(0);
      for (const c of p.classes) expect(cls.has(c), `${p.id} class ${c}`).toBe(true);
      expect(p.tags.length).toBeGreaterThan(0);
      expect(p.desc.split(/\s+/).length, `${p.id} desc too long: ${p.desc}`).toBeLessThanOrEqual(12);
      if (p.category === 'core') expect(p.attach).toBe('');
      else expect(socks.has(p.attach), `${p.id} attach ${p.attach}`).toBe(true);
      for (const s of Object.keys(p.sockets)) expect(socks.has(s), `${p.id} socket ${s}`).toBe(true);
    }
  });

  it('every part builds, is finite, and stays under the triangle budget', () => {
    const over: string[] = [];
    for (const p of PARTS) {
      const obj = p.build({ color: '#ff0000', accent: '#00ff00', scale: 1.2 });
      expect(obj).toBeInstanceOf(THREE.Object3D);
      let meshes = 0;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        const a = m.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error(`${p.id} has NaN vertices`);
      });
      expect(meshes, `${p.id} has no meshes`).toBeGreaterThan(0);
      expect(meshes, `${p.id} uses too many draw calls`).toBeLessThanOrEqual(8);
      const t = countTris(obj);
      if (t > TRI_LIMIT) over.push(`${p.id}:${t}`);
    }
    expect(over, `over ${TRI_LIMIT} tris`).toEqual([]);
  });

  it('every category and class has coverage', () => {
    for (const c of CATEGORIES) expect(PARTS.some((p) => p.category === c), c).toBe(true);
    for (const c of WEAPON_CLASSES) {
      expect(PARTS.some((p) => p.category === 'core' && p.classes.includes(c)), `core for ${c}`).toBe(true);
      expect(catalogForClass(c).length).toBeGreaterThan(20);
    }
  });

  it('catalog entries carry no geometry', () => {
    const c = catalog();
    expect(c.length).toBe(PARTS.length);
    expect(Object.keys(c[0]).sort()).toEqual(['attach', 'category', 'classes', 'desc', 'id', 'tags']);
  });
});

describe('recipes', () => {
  it('has ~40 recipes covering every class', () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(40);
    for (const c of WEAPON_CLASSES) expect(RECIPES.some((r) => r.class === c), c).toBe(true);
  });

  it('recipe names are unique and reference only known parts', () => {
    const names = new Set<string>();
    for (const r of RECIPES) {
      expect(names.has(r.name)).toBe(false);
      names.add(r.name);
      for (const p of r.parts) expect(getPart(p.partId), `${r.name}: unknown ${p.partId}`).toBeDefined();
      expect(getPart(r.parts[0].partId)!.category, `${r.name} must start with a core`).toBe('core');
    }
  });

  it('every recipe assembles with all parts placed', () => {
    for (const r of RECIPES) {
      const g = assembleWeapon(r);
      expect(g.userData.missing, r.name).toEqual([]);
      expect(g.userData.unplaced, r.name).toEqual([]);
      expect(g.children.length, r.name).toBe(r.parts.length);
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3());
      expect(size.length(), `${r.name} implausible size`).toBeLessThan(4);
      expect(size.length()).toBeGreaterThan(0.05);
    }
  });

  it('skips unknown ids gracefully', () => {
    const g = assembleWeapon({ name: 'x', class: 'rifle', parts: [{ partId: 'core-rifle-block' }, { partId: 'nope-nope' }, { partId: 'barrel-round-long-3' }] });
    expect(g.userData.missing).toEqual(['nope-nope']);
    expect(g.children.length).toBe(2);
  });

  it('attaches a barrel at the receiver front and a muzzle at the barrel tip', () => {
    const g = assembleWeapon({
      name: 'y',
      class: 'rifle',
      parts: [{ partId: 'core-rifle-block' }, { partId: 'barrel-round-long-3' }, { partId: 'muzzle-thread-cap' }],
    });
    const core = getPart('core-rifle-block')!;
    const barrel = getPart('barrel-round-long-3')!;
    const [, b, m] = g.children;
    expect(b.position.toArray()).toEqual(core.sockets.barrel.pos);
    expect(m.position.z).toBeCloseTo(core.sockets.barrel.pos[2] + barrel.sockets.muzzle.pos[2], 6);
  });
});
