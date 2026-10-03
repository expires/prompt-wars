import * as THREE from 'three';
import { registerParts, type PartDef, type PartBuildOpts, type Socket } from './partRegistry';

/**
 * Built-in fallback PART KIT (~20 low-poly parts from Three primitives).
 * Weapon local space: barrel points -Z, +Y up, receiver centered at origin.
 * Each part's origin is where it plugs into its parent's socket.
 */

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function partMaterial(color: string, opts: { metal?: number; rough?: number; emissive?: string } = {}) {
  const key = `${color}|${opts.metal ?? 0.3}|${opts.rough ?? 0.6}|${opts.emissive ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: opts.metal ?? 0.3,
      roughness: opts.rough ?? 0.6,
      flatShading: true,
    });
    if (opts.emissive) {
      m.emissive.set(opts.emissive);
      m.emissiveIntensity = 1.5;
    }
    matCache.set(key, m);
  }
  return m;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/** Cylinder along Z, from z0 toward z0 - len (i.e. extends forward). */
function tubeZ(g: THREE.Object3D, rFront: number, rBack: number, len: number, mat: THREE.Material, x = 0, y = 0, z0 = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rFront, rBack, len, seg), mat);
  m.rotation.x = -Math.PI / 2; // +Y axis -> -Z
  m.position.set(x, y, z0 - len / 2);
  g.add(m);
  return m;
}

function cylY(g: THREE.Object3D, r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function group(opts: PartBuildOpts) {
  const g = new THREE.Group();
  if (opts.scale && opts.scale !== 1) g.scale.setScalar(opts.scale);
  return g;
}

const C = (o: PartBuildOpts, fallback: string) => o.color ?? fallback;
const A = (o: PartBuildOpts, fallback: string) => o.accent ?? fallback;
const S = (x: number, y: number, z: number): Socket => ({ pos: [x, y, z] });

const ALL_GUNS = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg', 'weird'];

export const BUILTIN_PARTS: PartDef[] = [
  // ---------------- cores ----------------
  {
    id: 'receiver_rifle',
    category: 'core',
    classes: ['rifle', 'smg', 'sniper', 'shotgun', 'weird'],
    tags: ['receiver', 'rifle'],
    desc: 'Standard rifle receiver body',
    attach: 'root',
    sockets: {
      barrel: S(0, 0.02, -0.16),
      stock: S(0, 0, 0.16),
      grip: S(0, -0.055, 0.08),
      mag: S(0, -0.055, -0.06),
      top: S(0, 0.055, -0.02),
      under: S(0, -0.04, -0.15),
      deco: S(0, 0.055, 0.12),
    },
    build(o) {
      const g = group(o);
      const m = partMaterial(C(o, '#3a3d42'));
      box(g, 0.07, 0.11, 0.32, m);
      box(g, 0.075, 0.03, 0.12, partMaterial(A(o, '#c0a050'), { metal: 0.7 }), 0, 0.02, -0.02); // ejection port
      return g;
    },
  },
  {
    id: 'receiver_pistol',
    category: 'core',
    classes: ['pistol', 'blowgun', 'bubble_gun', 'weird'],
    tags: ['receiver', 'pistol', 'slide'],
    desc: 'Compact pistol slide/frame',
    attach: 'root',
    sockets: {
      barrel: S(0, 0.025, -0.09),
      grip: S(0, -0.035, 0.05),
      top: S(0, 0.05, 0),
      under: S(0, -0.02, -0.07),
      deco: S(0, 0.05, 0.07),
    },
    build(o) {
      const g = group(o);
      box(g, 0.04, 0.05, 0.18, partMaterial(C(o, '#2b2b2e')), 0, 0.02, 0);
      box(g, 0.038, 0.03, 0.15, partMaterial(A(o, '#55585e')), 0, -0.015, 0.005);
      return g;
    },
  },
  {
    id: 'receiver_bulky',
    category: 'core',
    classes: ['lmg', 'rocket_launcher', 'grenade_launcher', 'flamethrower', 'weird'],
    tags: ['receiver', 'heavy'],
    desc: 'Big chunky heavy-weapon body',
    attach: 'root',
    sockets: {
      barrel: S(0, 0.03, -0.2),
      stock: S(0, 0, 0.2),
      grip: S(0, -0.08, 0.1),
      mag: S(0.0, -0.08, -0.08),
      top: S(0, 0.08, 0),
      under: S(0, -0.06, -0.2),
      tank: S(0, -0.08, -0.08),
      deco: S(0, 0.08, 0.15),
    },
    build(o) {
      const g = group(o);
      box(g, 0.12, 0.16, 0.4, partMaterial(C(o, '#4a5040')));
      box(g, 0.125, 0.04, 0.3, partMaterial(A(o, '#222')), 0, 0.05, 0);
      return g;
    },
  },
  {
    id: 'handle_melee',
    category: 'core',
    classes: ['melee'],
    tags: ['handle', 'melee'],
    desc: 'Wrapped melee handle with pommel',
    attach: 'root',
    sockets: { blade: S(0, 0, -0.1), deco: S(0, 0.02, 0.1) },
    build(o) {
      const g = group(o);
      tubeZ(g, 0.018, 0.018, 0.2, partMaterial(C(o, '#5a3a22'), { metal: 0 }), 0, 0, 0.1);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 4), partMaterial(A(o, '#c0a050'), { metal: 0.8 }));
      p.position.z = 0.11;
      g.add(p);
      return g;
    },
  },
  // ---------------- barrels ----------------
  {
    id: 'barrel_short',
    category: 'barrel',
    classes: ['pistol', 'smg', 'shotgun', 'weird'],
    tags: ['barrel', 'short'],
    desc: 'Short barrel',
    attach: 'barrel',
    sockets: { muzzle: S(0, 0, -0.2), under: S(0, -0.02, -0.08), bayonet: S(0, -0.02, -0.17) },
    build(o) {
      const g = group(o);
      tubeZ(g, 0.015, 0.017, 0.2, partMaterial(C(o, '#202022'), { metal: 0.8 }));
      return g;
    },
  },
  {
    id: 'barrel_long',
    category: 'barrel',
    classes: ['rifle', 'sniper', 'lmg'],
    tags: ['barrel', 'long'],
    desc: 'Long precision barrel with handguard',
    attach: 'barrel',
    sockets: { muzzle: S(0, 0, -0.5), under: S(0, -0.03, -0.12), bayonet: S(0, -0.02, -0.45) },
    build(o) {
      const g = group(o);
      tubeZ(g, 0.013, 0.016, 0.5, partMaterial(C(o, '#1c1c1e'), { metal: 0.8 }));
      box(g, 0.05, 0.05, 0.22, partMaterial(A(o, '#3a3d42')), 0, -0.005, -0.11); // handguard
      return g;
    },
  },
  {
    id: 'barrel_thick',
    category: 'barrel',
    classes: ['lmg', 'shotgun', 'weird'],
    tags: ['barrel', 'thick', 'heavy'],
    desc: 'Thick finned heavy barrel',
    attach: 'barrel',
    sockets: { muzzle: S(0, 0, -0.35), under: S(0, -0.035, -0.1), bayonet: S(0, -0.035, -0.3) },
    build(o) {
      const g = group(o);
      const m = partMaterial(C(o, '#2a2a2a'), { metal: 0.8 });
      tubeZ(g, 0.028, 0.03, 0.35, m);
      for (let i = 0; i < 5; i++) tubeZ(g, 0.04, 0.04, 0.012, partMaterial(A(o, '#555')), 0, 0, -0.04 - i * 0.05);
      return g;
    },
  },
  {
    id: 'barrel_double',
    category: 'barrel',
    classes: ['shotgun'],
    tags: ['barrel', 'shotgun', 'double'],
    desc: 'Side-by-side double shotgun barrel',
    attach: 'barrel',
    sockets: { muzzle: S(0, 0, -0.45), under: S(0, -0.03, -0.12), bayonet: S(0, -0.03, -0.4) },
    build(o) {
      const g = group(o);
      const m = partMaterial(C(o, '#232325'), { metal: 0.85 });
      tubeZ(g, 0.018, 0.018, 0.45, m, -0.019);
      tubeZ(g, 0.018, 0.018, 0.45, m, 0.019);
      box(g, 0.05, 0.03, 0.25, partMaterial(A(o, '#6b4226'), { metal: 0 }), 0, -0.025, -0.1);
      return g;
    },
  },
  {
    id: 'rocket_tube',
    category: 'barrel',
    classes: ['rocket_launcher', 'grenade_launcher'],
    tags: ['tube', 'rocket'],
    desc: 'Big shoulder rocket tube',
    attach: 'barrel',
    sockets: { muzzle: S(0, 0.03, -0.6), under: S(0, -0.04, -0.3), top: S(0, 0.1, -0.2) },
    build(o) {
      const g = group(o);
      tubeZ(g, 0.065, 0.065, 0.95, partMaterial(C(o, '#4a5a3a')), 0, 0.03, 0.35, 10);
      tubeZ(g, 0.075, 0.07, 0.06, partMaterial(A(o, '#c8a040')), 0, 0.03, -0.54, 10);
      return g;
    },
  },
  // ---------------- muzzle / under ----------------
  {
    id: 'suppressor',
    category: 'muzzle',
    classes: ALL_GUNS,
    tags: ['muzzle', 'silencer'],
    desc: 'Cylindrical suppressor',
    attach: 'muzzle',
    sockets: { muzzle: S(0, 0, -0.16) },
    build(o) {
      const g = group(o);
      tubeZ(g, 0.024, 0.024, 0.16, partMaterial(C(o, '#151515'), { metal: 0.5 }));
      return g;
    },
  },
  {
    id: 'bayonet',
    category: 'blade',
    classes: ['rifle', 'shotgun', 'weird'],
    tags: ['blade', 'bayonet'],
    desc: 'Bayonet blade under the muzzle',
    attach: 'bayonet',
    sockets: {},
    build(o) {
      const g = group(o);
      box(g, 0.006, 0.025, 0.2, partMaterial(C(o, '#d8dde2'), { metal: 0.9, rough: 0.2 }), 0, -0.012, -0.1);
      return g;
    },
  },
  {
    id: 'grip_vertical',
    category: 'grip',
    classes: ['smg', 'rifle', 'lmg', 'shotgun'],
    tags: ['foregrip'],
    desc: 'Vertical foregrip',
    attach: 'under',
    sockets: {},
    build(o) {
      const g = group(o);
      cylY(g, 0.016, 0.1, partMaterial(C(o, '#2a2a2a'), { metal: 0.1 }), 0, -0.05, 0, 6);
      return g;
    },
  },
  // ---------------- stocks ----------------
  {
    id: 'stock_rifle',
    category: 'stock',
    classes: ['rifle', 'sniper', 'shotgun', 'lmg'],
    tags: ['stock', 'solid'],
    desc: 'Solid rifle stock',
    attach: 'stock',
    sockets: {},
    build(o) {
      const g = group(o);
      const m = partMaterial(C(o, '#6b4226'), { metal: 0 });
      box(g, 0.05, 0.07, 0.18, m, 0, -0.01, 0.09);
      box(g, 0.05, 0.13, 0.08, m, 0, -0.03, 0.2);
      box(g, 0.055, 0.135, 0.015, partMaterial(A(o, '#111')), 0, -0.03, 0.245);
      return g;
    },
  },
  {
    id: 'stock_skeleton',
    category: 'stock',
    classes: ['smg', 'rifle', 'weird'],
    tags: ['stock', 'skeleton', 'light'],
    desc: 'Minimal wire skeleton stock',
    attach: 'stock',
    sockets: {},
    build(o) {
      const g = group(o);
      const m = partMaterial(C(o, '#333'), { metal: 0.8 });
      tubeZ(g, 0.007, 0.007, 0.22, m, 0, 0.02, 0.22);
      tubeZ(g, 0.007, 0.007, 0.22, m, 0, -0.04, 0.22);
      box(g, 0.04, 0.1, 0.015, m, 0, -0.01, 0.22);
      return g;
    },
  },
  // ---------------- grips ----------------
  {
    id: 'grip_pistol',
    category: 'grip',
    classes: ALL_GUNS.concat(['flamethrower', 'bubble_gun', 'blowgun', 'crossbow', 'rocket_launcher', 'grenade_launcher']),
    tags: ['grip', 'pistol'],
    desc: 'Angled pistol grip',
    attach: 'grip',
    sockets: { mag: S(0, -0.1, 0.02) },
    build(o) {
      const g = group(o);
      const m = box(g, 0.035, 0.11, 0.045, partMaterial(C(o, '#1e1e1e'), { metal: 0.1 }), 0, -0.05, 0.01);
      m.rotation.x = -0.25;
      return g;
    },
  },
  // ---------------- mags ----------------
  {
    id: 'mag_straight',
    category: 'mag',
    classes: ALL_GUNS,
    tags: ['mag', 'box'],
    desc: 'Straight box magazine',
    attach: 'mag',
    sockets: {},
    build(o) {
      const g = group(o);
      box(g, 0.03, 0.14, 0.06, partMaterial(C(o, '#2c2c2c')), 0, -0.07, 0);
      return g;
    },
  },
  {
    id: 'mag_drum',
    category: 'mag',
    classes: ['smg', 'lmg', 'shotgun', 'weird'],
    tags: ['mag', 'drum'],
    desc: 'Round drum magazine',
    attach: 'mag',
    sockets: {},
    build(o) {
      const g = group(o);
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), partMaterial(C(o, '#3a3a3a'), { metal: 0.6 }));
      d.rotation.z = Math.PI / 2;
      d.position.set(0, -0.08, 0);
      g.add(d);
      box(g, 0.025, 0.03, 0.04, partMaterial(A(o, '#222')), 0, -0.01, 0);
      return g;
    },
  },
  {
    id: 'mag_banana',
    category: 'mag',
    classes: ['rifle', 'smg', 'weird'],
    tags: ['mag', 'curved', 'silly'],
    desc: 'Curved banana magazine (literally yellow)',
    attach: 'mag',
    sockets: {},
    build(o) {
      const g = group(o);
      const m = partMaterial(C(o, '#f2d23c'), { metal: 0 });
      for (let i = 0; i < 4; i++) {
        const seg = box(g, 0.03, 0.05, 0.055, m, 0, -0.025 - i * 0.045, -i * i * 0.008);
        seg.rotation.x = i * 0.18;
      }
      return g;
    },
  },
  // ---------------- optics ----------------
  {
    id: 'scope_small',
    category: 'scope',
    classes: ALL_GUNS,
    tags: ['optic', 'red-dot'],
    desc: 'Compact red-dot sight',
    attach: 'top',
    sockets: { top: S(0, 0.05, 0) },
    build(o) {
      const g = group(o);
      box(g, 0.035, 0.04, 0.06, partMaterial(C(o, '#202020')), 0, 0.02, 0);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), partMaterial('#ff3030', { emissive: '#ff2020' }));
      lens.position.set(0, 0.025, 0.031);
      g.add(lens);
      return g;
    },
  },
  {
    id: 'scope_long',
    category: 'scope',
    classes: ['rifle', 'sniper', 'weird'],
    tags: ['optic', 'sniper'],
    desc: 'Long magnified sniper scope',
    attach: 'top',
    sockets: { top: S(0, 0.07, 0) },
    build(o) {
      const g = group(o);
      const m = partMaterial(C(o, '#151515'), { metal: 0.6 });
      tubeZ(g, 0.02, 0.02, 0.28, m, 0, 0.045, 0.14);
      tubeZ(g, 0.028, 0.022, 0.05, m, 0, 0.045, -0.09);
      box(g, 0.015, 0.03, 0.015, m, 0, 0.015, -0.06);
      box(g, 0.015, 0.03, 0.015, m, 0, 0.015, 0.06);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 10), partMaterial(A(o, '#40a0ff'), { emissive: '#1050a0', metal: 1, rough: 0.1 }));
      lens.position.set(0, 0.045, -0.141);
      lens.rotation.y = Math.PI;
      g.add(lens);
      return g;
    },
  },
  // ---------------- misc / heavy ----------------
  {
    id: 'fuel_tank',
    category: 'tank',
    classes: ['flamethrower', 'bubble_gun', 'weird'],
    tags: ['tank', 'fuel'],
    desc: 'Pressurized fuel/soap tank',
    attach: 'tank',
    sockets: {},
    build(o) {
      const g = group(o);
      const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 8), partMaterial(C(o, '#b03020'), { metal: 0.5 }));
      t.rotation.x = Math.PI / 2;
      t.position.set(0, -0.06, 0);
      g.add(t);
      return g;
    },
  },
  {
    id: 'blade_sword',
    category: 'blade',
    classes: ['melee'],
    tags: ['blade', 'sword'],
    desc: 'Long sword blade with crossguard',
    attach: 'blade',
    sockets: {},
    build(o) {
      const g = group(o);
      box(g, 0.12, 0.02, 0.025, partMaterial(A(o, '#c0a050'), { metal: 0.8 }), 0, 0, -0.01);
      box(g, 0.01, 0.05, 0.6, partMaterial(C(o, '#d8dde2'), { metal: 0.9, rough: 0.2 }), 0, 0, -0.32);
      return g;
    },
  },
  // ---------------- silly ----------------
  {
    id: 'rubber_duck',
    category: 'deco',
    classes: ['weird', 'pistol', 'rifle', 'smg', 'shotgun', 'melee'],
    tags: ['silly', 'duck'],
    desc: 'Rubber duck mascot riding on top',
    attach: 'deco',
    sockets: {},
    build(o) {
      const g = group(o);
      const yellow = partMaterial(C(o, '#ffd21f'), { metal: 0, rough: 0.4 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), yellow);
      body.scale.set(1, 0.8, 1.25);
      body.position.y = 0.028;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), yellow);
      head.position.set(0, 0.065, -0.02);
      g.add(head);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.025, 6), partMaterial(A(o, '#ff7a00'), { metal: 0 }));
      beak.rotation.x = -Math.PI / 2;
      beak.position.set(0, 0.062, -0.045);
      g.add(beak);
      return g;
    },
  },
  {
    id: 'candle',
    category: 'deco',
    classes: ['weird', 'melee', 'pistol'],
    tags: ['silly', 'candle', 'flame'],
    desc: 'Lit wax candle stuck on top',
    attach: 'top',
    sockets: {},
    build(o) {
      const g = group(o);
      cylY(g, 0.012, 0.08, partMaterial(C(o, '#f4ecd8'), { metal: 0, rough: 0.9 }), 0, 0.04, 0);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.025, 6), partMaterial('#ffb020', { emissive: '#ff9000' }));
      flame.position.y = 0.095;
      g.add(flame);
      return g;
    },
  },
];

registerParts(BUILTIN_PARTS);

/** Built-in catalog ids — feed these to the LLM prompt (big library adds more). */
export const PART_IDS: string[] = BUILTIN_PARTS.map((p) => p.id);

/** Compact catalog for LLM prompts: id, category, attach, classes, desc. */
export function partCatalogForPrompt(defs: PartDef[] = BUILTIN_PARTS) {
  return defs.map((p) => ({ id: p.id, category: p.category, attach: p.attach, classes: p.classes, desc: p.desc }));
}
