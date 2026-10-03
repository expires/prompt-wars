import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PARTS, getPart } from '../src/registry';
import { RECIPES } from '../src/recipes';
import { assembleWeapon } from '../src/assemble';
import type { PartDef } from '../src/types';
import { WEAPON_CLASSES } from '../src/types';
import {
  allTemplates,
  generateTemplates,
  searchTemplates,
  templatesForClass,
  randomTemplate,
  templateToRecipe,
  encodeTemplates,
  decodeTemplates,
  THEMES,
  CLASS_TARGET,
} from '../src/templates';
import { OBJ_INFO } from '../src/gen/obj';
import { countTris } from '../src/lib/kit';

const T = allTemplates();
const SWINGS = ['slash', 'overhead', 'thrust', 'bash', 'spin'];
const WEIGHTS = ['light', 'medium', 'heavy'];
const FIRE = ['hitscan', 'projectile', 'arc', 'stream', 'melee'];

/** PartDefs whose build() is free: lets us run the real assembleWeapon socket logic on all 20k. */
const stubs = new Map<string, PartDef>();
const stubLookup = (id: string) => {
  let s = stubs.get(id);
  if (!s) {
    const p = getPart(id);
    if (!p) return undefined;
    s = { ...p, build: () => new THREE.Group() };
    stubs.set(id, s);
  }
  return s;
};

describe('templates: volume + integrity', () => {
  it('has >= 20,000 templates', () => {
    expect(T.length).toBeGreaterThanOrEqual(20000);
  });

  it('ids and names are unique', () => {
    expect(new Set(T.map((t) => t.id)).size).toBe(T.length);
    expect(new Set(T.map((t) => t.name)).size).toBe(T.length);
  });

  it('metadata is well-formed', () => {
    const themes = new Set(THEMES.map((t) => t.id));
    for (const t of T) {
      expect(WEAPON_CLASSES as readonly string[]).toContain(t.class);
      expect(FIRE).toContain(t.fireMode);
      expect(themes.has(t.theme), `${t.id} theme ${t.theme}`).toBe(true);
      expect(t.desc.split(/\s+/).length, `${t.id} desc: ${t.desc}`).toBeLessThanOrEqual(15);
      expect(t.keywords.length).toBeGreaterThan(0);
      expect(t.tags.length).toBeGreaterThan(0);
      expect(t.parts.length).toBeGreaterThanOrEqual(1);
      if (t.class === 'melee') expect(t.fireMode).toBe('melee');
      else expect(t.fireMode).not.toBe('melee');
    }
  });

  it('every part id exists and the first part is a core', () => {
    const bad: string[] = [];
    for (const t of T) {
      for (const p of t.parts) if (!getPart(p.partId)) bad.push(`${t.id}:${p.partId}`);
      expect(getPart(t.parts[0].partId)?.category, t.id).toBe('core');
    }
    expect(bad).toEqual([]);
  });

  it('every template assembles with zero missing ids and no unplaced parts (socket logic, all 20k)', () => {
    const broken: string[] = [];
    for (const t of T) {
      const g = assembleWeapon(templateToRecipe(t), stubLookup);
      const ud = g.userData as { missing: string[]; unplaced: string[] };
      if (ud.missing.length || ud.unplaced.length || g.children.length !== t.parts.length) broken.push(`${t.id} ${t.name}: ${[...ud.missing, ...ud.unplaced].join(',')}`);
    }
    expect(broken.slice(0, 20)).toEqual([]);
  });

  it('a seeded sample assembles with real geometry at plausible size and tri counts', () => {
    const step = Math.floor(T.length / 400);
    for (let i = 0; i < T.length; i += step) {
      const t = T[i];
      const g = assembleWeapon(templateToRecipe(t));
      expect(g.userData.missing, t.id).toEqual([]);
      expect(g.userData.unplaced, t.id).toEqual([]);
      const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).length();
      expect(size, `${t.id} ${t.name} size`).toBeLessThan(3.2);
      expect(size).toBeGreaterThan(0.08);
      expect(countTris(g), t.id).toBeLessThan(6000);
    }
  });

  it('melee templates all carry melee metadata (and only they do)', () => {
    for (const t of T) {
      if (t.class === 'melee') {
        expect(t.melee, t.id).toBeDefined();
        expect(SWINGS).toContain(t.melee!.swing);
        expect(WEIGHTS).toContain(t.melee!.weight);
        expect(t.melee!.reach, t.id).toBeGreaterThanOrEqual(0.3);
        expect(t.melee!.reach, t.id).toBeLessThanOrEqual(2.5);
      } else expect(t.melee, t.id).toBeUndefined();
    }
  });

  it('meets per-class, per-theme, melee and everyday minimums', () => {
    const byClass: Record<string, number> = {};
    const byTheme: Record<string, number> = {};
    for (const t of T) {
      byClass[t.class] = (byClass[t.class] ?? 0) + 1;
      byTheme[t.theme] = (byTheme[t.theme] ?? 0) + 1;
    }
    for (const c of WEAPON_CLASSES) expect(byClass[c] ?? 0, c).toBeGreaterThanOrEqual(Math.min(800, CLASS_TARGET[c] * 0.85));
    for (const th of THEMES) expect(byTheme[th.id] ?? 0, th.id).toBeGreaterThanOrEqual(600);
    expect(T.filter((t) => t.melee).length).toBeGreaterThanOrEqual(4000);
    const everyday = T.filter((t) => t.tags.includes('everyday'));
    expect(everyday.length).toBeGreaterThanOrEqual(8000);
    // everyday tag really means an everyday-object part is in there
    for (const t of everyday.slice(0, 2000)) expect(t.parts.some((p) => { const i = OBJ_INFO.get(p.partId); return !!i && i.spec.group !== 'weapon' && i.role !== 'deco'; }), t.id).toBe(true);
    // everyday objects must be melee-able as whole-object cores
    const meleeCores = new Set(T.filter((t) => t.melee).map((t) => OBJ_INFO.get(t.parts[0].partId)?.spec.kind).filter(Boolean));
    for (const kind of ['frying-pan', 'baguette']) expect(meleeCores.has(kind), kind).toBe(true);
  });

  it('includes every curated hand recipe (50), marked curated', () => {
    const cur = T.filter((t) => t.curated);
    expect(cur.length).toBe(RECIPES.length);
    expect(RECIPES.length).toBeGreaterThanOrEqual(50);
    expect(RECIPES.every((r) => r.curated)).toBe(true);
    for (const r of RECIPES) expect(cur.some((t) => t.name === r.name), r.name).toBe(true);
  });

  it('is deterministic and dedupes by part-set signature', () => {
    const again = generateTemplates();
    expect(again.length).toBe(T.length);
    for (let i = 0; i < T.length; i += 97) expect(again[i].id).toBe(T[i].id);
    const sigs = new Set(T.map((t) => t.parts.map((p) => p.partId).sort().join('+')));
    expect(sigs.size).toBe(T.length);
  });

  it('generates within the time budget', () => {
    generateTemplates(); // warm
    const t0 = performance.now();
    generateTemplates();
    const ms = performance.now() - t0;
    console.log(`template generation: ${ms.toFixed(0)} ms for ${T.length}`);
    expect(ms).toBeLessThan(300);
  });

  it('round-trips through the compact JSON codec', () => {
    const enc = encodeTemplates(T);
    const dec = decodeTemplates(JSON.parse(JSON.stringify(enc)));
    expect(dec.length).toBe(T.length);
    for (let i = 0; i < T.length; i += 53) expect(dec[i]).toEqual(T[i]);
  });
});

describe('templates: retrieval API', () => {
  const cases: [string, RegExp, string?][] = [
    ['frying pan', /frying pan|skillet|pan/i],
    ['a frying pan that shoots baguettes', /pan|skillet|baguette/i],
    ['guitar', /guitar/i],
    ['umbrella sword', /umbrella/i],
    ["grandma's umbrella sword", /umbrella/i],
    ['garden hose flamethrower', /hose|garden/i],
    ['katana', /katana/i],
    ['laser sword', /laser|saber/i],
    ['pirate blunderbuss', /blunderbuss|pirate/i],
    ['skillet', /skillet|pan/i],
    ['baguette', /baguette/i],
    ['sniper rifle', /sniper|longshot|marksman|railgun/i],
    ['steampunk shotgun', /steampunk|clockwork|brass|blunderbuss|victorian|cogwork|aether|gaslamp|boiler/i],
    ['bubble gun', /bubble/i],
    ['crossbow', /crossbow|arbalest|bolt/i],
    ['flamthrower', /flame|torch|scorch/i],
  ];
  for (const [q, re] of cases)
    it(`search "${q}"`, () => {
      const r = searchTemplates(q, { limit: 8 });
      expect(r.length).toBeGreaterThan(0);
      const top = r[0];
      expect(`${top.name} ${top.keywords.join(' ')}`, `${q} -> ${top.name}`).toMatch(re);
    });

  it('search respects class filter and limit', () => {
    const r = searchTemplates('pan', { class: 'shotgun', limit: 5 });
    expect(r.length).toBe(5);
    for (const t of r) expect(t.class).toBe('shotgun');
    expect(searchTemplates('zzzzqqq', { class: 'pistol', limit: 3 }).length).toBe(3);
  });

  it('search is fast after the index is built', () => {
    searchTemplates('warmup');
    const t0 = performance.now();
    for (const q of ['frying pan', 'guitar sword', 'rubber duck rocket', 'office stapler smg', 'ninja katana']) searchTemplates(q);
    expect((performance.now() - t0) / 5).toBeLessThan(40);
  });

  it('templatesForClass and randomTemplate', () => {
    const m = templatesForClass('melee', { limit: 10 });
    expect(m.length).toBe(10);
    expect(m.every((t) => t.class === 'melee')).toBe(true);
    expect(templatesForClass('shotgun', { theme: 'pirate' }).every((t) => t.theme === 'pirate')).toBe(true);
    expect(randomTemplate('rifle', 7).class).toBe('rifle');
    expect(randomTemplate('rifle', 7).id).toBe(randomTemplate('rifle', 7).id);
    expect(randomTemplate().id).toBeTruthy();
  });
});

describe('everyday object parts', () => {
  const objParts = PARTS.filter((p) => OBJ_INFO.has(p.id));
  it('adds >= 1500 object parts', () => {
    expect(objParts.length).toBeGreaterThanOrEqual(1500);
  });
  it('object parts stay under 500 tris and sockets sit on the surface', () => {
    const tri = new THREE.Triangle();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const cp = new THREE.Vector3();
    const bad: string[] = [];
    for (const p of objParts) {
      const obj = p.build({});
      const t = countTris(obj);
      if (t > 500) bad.push(`${p.id} tris ${t}`);
      for (const [name, s] of Object.entries(p.sockets)) {
        const pt = new THREE.Vector3(...s.pos);
        let best = Infinity;
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const arr = m.geometry.attributes.position.array as Float32Array;
          for (let i = 0; i < arr.length && best > 0.025; i += 9) {
            tri.set(a.set(arr[i], arr[i + 1], arr[i + 2]), b.set(arr[i + 3], arr[i + 4], arr[i + 5]), c.set(arr[i + 6], arr[i + 7], arr[i + 8]));
            tri.closestPointToPoint(pt, cp);
            best = Math.min(best, cp.distanceTo(pt));
          }
        });
        if (best > 0.025) bad.push(`${p.id}.${name} ${(best * 100).toFixed(1)}cm off`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('every object group is represented', () => {
    const groups = new Set(objParts.map((p) => OBJ_INFO.get(p.id)!.spec.group));
    for (const g of ['kitchen', 'household', 'garden', 'sports', 'music', 'office', 'toy', 'food', 'weapon']) expect(groups.has(g as never), g).toBe(true);
  });
});
