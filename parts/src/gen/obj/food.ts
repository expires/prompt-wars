/** FOOD objects. See objkit.ts for the canonical frame + roles. */
import * as THREE from 'three';
import type { Anchors, ObjSpec, P } from './objkit';
import type { Kit, Pt, Slot } from '../../lib/kit';
import type { Vec3 } from '../../types';

const PI = Math.PI;

/**
 * Tapered swept tube through centreline points `c` with per-ring radius `r` (organic food shapes).
 * Ring vertex 0 sits at +Y (for horizontal curves), so `c[i] + [0, r[i]*sy, 0]` is exactly on the surface.
 * `sy` squashes/stretches the ring vertically (fish bodies). Ends are capped when their radius > 0.
 */
function sweep(k: Kit, slot: Slot, c: Vec3[], r: number[], radial = 8, sy: number | number[] = 1): void {
  const n = c.length;
  const rings: THREE.Vector3[][] = [];
  const ref = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = new THREE.Vector3(...c[Math.max(i - 1, 0)]);
    const b = new THREE.Vector3(...c[Math.min(i + 1, n - 1)]);
    const t = b.sub(a).normalize();
    ref.set(0, 1, 0);
    if (Math.abs(t.y) > 0.9) ref.set(1, 0, 0);
    const nr = new THREE.Vector3().crossVectors(ref, t).normalize();
    const bn = new THREE.Vector3().crossVectors(t, nr);
    const s = typeof sy === 'number' ? sy : sy[i];
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < radial; j++) {
      const ang = PI / 2 + (j * 2 * PI) / radial;
      ring.push(
        new THREE.Vector3(...c[i]).addScaledVector(nr, Math.cos(ang) * r[i]).addScaledVector(bn, Math.sin(ang) * r[i] * s),
      );
    }
    rings.push(ring);
  }
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      tri(rings[i][j], rings[i][j1], rings[i + 1][j]);
      tri(rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
    }
  const c0 = new THREE.Vector3(...c[0]);
  const c1 = new THREE.Vector3(...c[n - 1]);
  for (let j = 0; j < radial; j++) {
    const j1 = (j + 1) % radial;
    if (r[0] > 1e-5) tri(c0, rings[0][j1], rings[0][j]);
    if (r[n - 1] > 1e-5) tri(c1, rings[n - 1][j], rings[n - 1][j1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  k.add(slot, g);
}

const rotZ = (q: Vec3, a: number): Vec3 => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a), q[2]];

/* ---------------- banana ---------------- */
const BAN_R = [0.12, 0.55, 0.85, 1, 1, 1, 0.9, 0.6, 0.35];
function banGeo(p: P) {
  const c: Vec3[] = [];
  const r: number[] = [];
  for (let i = 0; i < 9; i++) {
    const u = i / 8;
    c.push([0, p.bow * ((2 * u - 1) ** 2 - 1), -p.L * 0.85 * (1 - u)]);
    r.push(p.R * BAN_R[i]);
  }
  return { c, r };
}

/* ---------------- carrot ---------------- */
const CAR_R = [0.08, 0.35, 0.55, 0.72, 0.86, 0.96, 1];
function carGeo(p: P) {
  const c: Vec3[] = [];
  const r: number[] = [];
  for (let i = 0; i < 7; i++) {
    const u = i / 6;
    c.push([0, p.bend * (1 - u) ** 2, -p.L * (1 - u)]);
    r.push(p.R * CAR_R[i]);
  }
  const sc = p.R / 0.026;
  return { c, r, sc, lz: 0.09 * sc };
}

/* ---------------- corn ---------------- */
function cornGeo(p: P) {
  const zs = p.stick ? -0.07 : 0;
  const z0 = zs - p.L;
  const step = (p.L - 0.045) / 10;
  return { zs, z0, step, zk: (i: number) => z0 + 0.03 + i * step };
}

/* ---------------- pineapple ---------------- */
function pineGeo(p: P) {
  return { zc: -0.02 - p.R * p.ez };
}

/* ---------------- watermelon ---------------- */
function melonProf(p: P): Pt[] {
  const Rz = p.R * p.ez;
  const pts: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const th = (PI * i) / 6;
    pts.push([p.R * Math.sin(th), -Rz * Math.cos(th)]);
  }
  return pts;
}

/* ---------------- sausage ---------------- */
function sauGeo(p: P) {
  const N = 6 * p.links + 1;
  const c: Vec3[] = [];
  const r: number[] = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const v = (u * p.links) % 1;
    c.push([0, p.bend * (Math.sin(PI * u) - Math.sin(PI * 0.85)), -p.L * 0.85 + u * p.L]);
    r.push(p.R * (0.3 + 0.7 * Math.sqrt(Math.max(Math.sin(PI * v), 0))));
  }
  const mid = (N - 1) / 2;
  const gi = Math.round(0.85 * (N - 1));
  return { c, r, N, mid, gi };
}

/* ---------------- fish ---------------- */
const FISH_R = [0.18, 0.62, 0.88, 1, 0.95, 0.75, 0.45, 0.22];
function fishGeo(p: P) {
  const c: Vec3[] = [];
  const r: number[] = [];
  for (let i = 0; i < 8; i++) {
    const u = i / 7;
    c.push([0, 0, -p.L * 0.85 * (1 - u)]);
    r.push((p.W / 2) * FISH_R[i]);
  }
  const tipZ = p.style === 2 ? -p.L * 1.2 : -p.L * 0.85;
  return { c, r, sy: p.H / p.W, tipZ };
}

/* ---------------- donut ---------------- */
function donutTop(p: P): number {
  return p.style === 0 ? p.r * 1.25 : p.style === 1 ? p.r * 1.12 : p.r;
}

/* ---------------- ice cream ---------------- */
function iceGeo(p: P) {
  const zm = -p.cl * 0.4 - 0.006;
  const zs = (i: number) => zm - p.sr * 0.6 - i * p.sr * 1.3;
  const ringR = (i: number) => p.cr * (1.25 - i * 0.3);
  const ringZ = (i: number) => zm - 0.012 - i * p.cr * 0.75;
  const tip = p.soft ? ringZ(2) - p.cr * 0.9 : zs(p.n - 1) - p.sr - 0.02;
  return { zm, zs, ringR, ringZ, tip };
}

/* ---------------- drumstick ---------------- */
function drumGeo(p: P) {
  const br = p.R * 0.22;
  const zt = -0.01 - p.L;
  const zmid = p.style === 2 ? zt + p.L * 0.5 : zt + p.L * 0.3;
  const zFrontBone = zt - p.bone * 0.6;
  return { br, zt, zmid, zFrontBone, knobOff: br * 1.07 };
}
function drumKnobs(k: Kit, z: number, br: number): void {
  k.ball('white', br * 1.4, [br * 0.9, 0, z], 0);
  k.ball('white', br * 1.4, [-br * 0.9, 0, z], 0);
}

/* ---------------- pizza ---------------- */
const PIZ = [
  [0.3, 0.2],
  [0.62, 1.1],
  [0.55, 2.3],
  [0.7, 3.4],
  [0.36, 4.2],
  [0.68, 5.2],
  [0.18, 3.0],
  [0.45, 0.75],
  [0.42, 5.8],
];

export const FOOD: ObjSpec[] = [
  {
    kind: 'baguette',
    group: 'food',
    noun: 'Baguette',
    syn: ['bread', 'loaf', 'french', 'baguette', 'bakery'],
    tags: ['food', 'silly', 'french'],
    desc: 'crusty french baguette loaf',
    color: '#d99b4a',
    accent: '#f3d79a',
    variants: [
      { v: 'classic', p: { L: 0.65, r: 0.03, n: 5 } },
      { v: 'ficelle', p: { L: 0.75, r: 0.022, n: 7 }, desc: 'thin long ficelle baguette' },
      { v: 'batard', p: { L: 0.45, r: 0.042, n: 3 }, desc: 'short fat batard loaf', noun: 'Batard' },
    ],
    draw(k, p) {
      const z0 = -p.L * 0.8;
      const z1 = p.L * 0.2;
      const r = p.r;
      k.zlathe(
        'main',
        [
          [0, z0],
          [r * 0.55, z0 + r * 0.6],
          [r * 0.9, z0 + r * 2],
          [r, z0 + p.L * 0.3],
          [r, z1 - p.L * 0.25],
          [r * 0.85, z1 - r * 1.5],
          [r * 0.5, z1 - r * 0.4],
          [0, z1],
        ],
        8,
      );
      for (let i = 0; i < p.n; i++) {
        const z = z0 + r * 3 + (i + 0.5) * ((p.L - r * 6) / p.n);
        k.box('accent', [r * 0.5, r * 0.25, (p.L / p.n) * 0.6], { p: [0, r * 0.93, z], r: [0, 0.5, 0] });
      }
    },
    anchors(p) {
      const z0 = -p.L * 0.8;
      const z1 = p.L * 0.2;
      return {
        tip: [0, 0, z0],
        rear: [0, 0, z1],
        top: [0, p.r, -p.L * 0.3],
        grip: [0, -p.r, 0],
        under: [0, -p.r, -p.L * 0.45],
        side: [p.r, 0, -p.L * 0.3],
      };
    },
    roles: ['blade', 'barrel', 'mag', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
    guns: ['rifle', 'sniper', 'rocket_launcher'],
  },

  {
    kind: 'banana',
    group: 'food',
    noun: 'Banana',
    syn: ['banana', 'bananas', 'plantain', 'fruit', 'banana bunch', 'monkey'],
    tags: ['food', 'fruit', 'organic', 'silly', 'light'],
    desc: 'ripe curved yellow banana',
    color: '#f2d43a',
    accent: '#6b5a2a',
    variants: [
      { v: 'ripe', p: { L: 0.2, R: 0.02, bow: 0.03, bunch: 1 } },
      { v: 'bunch', p: { L: 0.2, R: 0.019, bow: 0.03, bunch: 3 }, desc: 'bunch of three bananas', noun: 'Banana Bunch' },
      { v: 'plantain', p: { L: 0.3, R: 0.028, bow: 0.018, bunch: 1 }, desc: 'big straight cooking plantain', noun: 'Plantain' },
    ],
    draw(k, p) {
      const g = banGeo(p);
      // bunch: side bananas fan out (yaw about the stem) and roll slightly
      const fans = p.bunch === 3 ? [0, 1, -1] : [0];
      for (const f of fans) {
        const yaw = f * 0.3;
        const c = g.c.map((q) =>
          rotZ([q[0] * Math.cos(yaw) - q[2] * Math.sin(yaw), q[1], q[2] * Math.cos(yaw) + q[0] * Math.sin(yaw)], f * 0.35),
        );
        sweep(k, 'main', c, g.r, 5);
        k.ball('dark', p.R * 0.2, c[0], 0);
      }
      k.rod('accent', [0, 0, -0.005], [0, 0.01, 0.035], p.R * (p.bunch === 3 ? 0.45 : 0.32), p.R * 0.25, 5);
    },
    anchors(p) {
      const { c, r } = banGeo(p);
      return {
        tip: c[0],
        rear: [0, 0.01, 0.035],
        top: [0, c[4][1] + r[4], c[4][2]],
        grip: [0, -r[8], 0],
        under: [0, c[4][1] - r[4], c[4][2]],
        side: [r[4], c[4][1], c[4][2]],
        mag: [0, c[4][1] - r[4], c[4][2]],
      };
    },
    roles: ['blade', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol', 'smg'],
    fireMode: 'projectile',
    ammo: 'banana peels',
  },

  {
    kind: 'carrot',
    group: 'food',
    noun: 'Carrot',
    syn: ['carrot', 'carrots', 'veg', 'vegetable', 'root', 'rabbit food'],
    tags: ['food', 'vegetable', 'organic', 'silly', 'light'],
    desc: 'orange carrot with leafy top',
    color: '#ec7a22',
    accent: '#4c9a3a',
    variants: [
      { v: 'classic', p: { L: 0.22, R: 0.026, bend: 0.01, leaves: 3 } },
      { v: 'giant', p: { L: 0.45, R: 0.055, bend: 0.03, leaves: 5 }, desc: 'prize giant bushy carrot' },
      { v: 'crooked', p: { L: 0.26, R: 0.03, bend: 0.06, leaves: 3 }, desc: 'crooked bent garden carrot' },
    ],
    draw(k, p) {
      const g = carGeo(p);
      sweep(k, 'main', g.c, g.r, 7);
      const n = p.leaves;
      for (let i = 0; i < n; i++) {
        const a = (i - (n - 1) / 2) * 0.45;
        const end: Vec3 = [Math.sin(a) * 0.04 * g.sc, 0.02 * g.sc, g.lz * (1 - 0.18 * Math.abs(a))];
        k.rod('accent', [0, 0, -0.005], end, p.R * 0.22, 0.0015, 4);
        k.ball('accent', 0.012 * g.sc, end, 0);
      }
    },
    anchors(p) {
      const { c, r, sc, lz } = carGeo(p);
      return {
        tip: c[0],
        rear: [0, 0.02 * sc, lz + 0.012 * sc],
        top: [0, c[3][1] + r[3], c[3][2]],
        grip: [0, -p.R, 0],
        under: [0, c[3][1] - r[3], c[3][2]],
        side: [r[3], c[3][1], c[3][2]],
        mag: [0, c[4][1] - r[4], c[4][2]],
      };
    },
    roles: ['blade', 'muzzle', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
  },

  {
    kind: 'corn',
    group: 'food',
    noun: 'Corn Cob',
    syn: ['corn', 'corn cob', 'maize', 'sweetcorn', 'corn on the cob', 'popcorn', 'vegetable'],
    tags: ['food', 'vegetable', 'organic', 'silly'],
    desc: 'corn on the cob',
    color: '#f2c94c',
    accent: '#6ea845',
    variants: [
      { v: 'fresh', p: { L: 0.2, R: 0.025, husk: 1, stick: 0 }, desc: 'fresh corn cob with peeled husk' },
      { v: 'grilled', p: { L: 0.17, R: 0.024, husk: 0, stick: 1 }, desc: 'charred grilled corn on stick', noun: 'Grilled Corn' },
      { v: 'husk', p: { L: 0.22, R: 0.027, husk: 2, stick: 0 }, desc: 'corn ear wrapped in husk' },
    ],
    draw(k, p) {
      const g = cornGeo(p);
      const { R } = p;
      const pts: Pt[] = [
        [0, g.z0],
        [R * 0.6, g.z0 + 0.006],
        [R * 0.9, g.z0 + 0.02],
      ];
      for (let i = 0; i <= 10; i++) pts.push([i % 2 ? R * 0.92 : R, g.zk(i)]);
      pts.push([R * 0.75, g.zs], [0, g.zs]);
      k.zlathe('main', pts, 8);
      if (p.stick) {
        k.zrod('wood', g.zs - 0.03, 0.07, 0.005, 0.005, 6);
        for (let i = 0; i < 7; i++) {
          const a = i * 2.3;
          const z = g.zk(1 + ((i * 3) % 9));
          k.box('dark', [0.01, 0.004, 0.014], { p: [R * Math.cos(a), R * Math.sin(a), z], r: [0, 0, a - PI / 2] });
        }
      } else {
        k.zrod('#8f8a4a', g.zs - 0.005, 0.03, R * 0.35, R * 0.3, 6);
        if (p.husk === 1)
          for (const a of [0, 2.1, -2.1])
            k.blade(
              'accent',
              [
                [0, R * 0.5],
                [0.05, R * 1.6],
                [0.12, R * 1.9],
                [0.09, R * 0.9],
                [0.03, R * 0.2],
              ],
              0.004,
              'zy',
              { r: [0, 0, a] },
            );
        else {
          const prof = [
            [R * 0.5, g.zs - p.L * 0.82],
            [R * 1.06, g.zs - p.L * 0.62],
            [R * 1.13, g.zs - p.L * 0.3],
            [R * 1.08, g.zs],
          ].map(([x, y]) => new THREE.Vector2(x, y));
          for (let i = 0; i < 3; i++)
            k.add('accent', new THREE.LatheGeometry(prof, 3, (i * 2 * PI) / 3 + 0.4, 1.85), { r: [PI / 2, 0, 0] });
        }
      }
    },
    anchors(p) {
      const g = cornGeo(p);
      const z = g.zk(4);
      return {
        tip: [0, 0, g.z0],
        rear: p.stick ? [0, 0, 0.07] : [0, 0, 0.03],
        top: [0, p.R, z],
        grip: p.stick ? [0, -0.005, 0.03] : [0, -p.R * 0.32, 0.015],
        under: [0, -p.R, z],
        side: [p.R, 0, z],
        mag: [0, -p.R, g.zk(2)],
      };
    },
    roles: ['mag', 'barrel', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['smg', 'lmg'],
    fireMode: 'projectile',
    ammo: 'popcorn',
  },

  {
    kind: 'pineapple',
    group: 'food',
    noun: 'Pineapple',
    syn: ['pineapple', 'ananas', 'tropical fruit', 'fruit', 'grenade'],
    tags: ['food', 'fruit', 'organic', 'silly', 'party'],
    desc: 'spiky crowned tropical pineapple',
    color: '#d9a434',
    accent: '#3f8f3a',
    variants: [
      { v: 'classic', p: { R: 0.07, ez: 1.35, crown: 0.12, nl: 8 } },
      { v: 'sugarloaf', p: { R: 0.055, ez: 1.8, crown: 0.08, nl: 6 }, desc: 'tall slender sugarloaf pineapple' },
      { v: 'royal', p: { R: 0.075, ez: 1.25, crown: 0.2, nl: 12 }, desc: 'pineapple with huge spiky crown' },
    ],
    draw(k, p) {
      const { zc } = pineGeo(p);
      const { R, ez } = p;
      k.ball('main', R, [0, 0, zc], 1, [1, 1, ez]);
      for (const f of [-0.55, 0, 0.55])
        for (let i = 0; i < 4; i++) {
          const a = (i * PI) / 2 + f * 0.8 + PI / 4;
          const rr = R * Math.sqrt(1 - f * f) * 0.97;
          k.box('#7a5a1e', [0.012, 0.012, 0.012], { p: [rr * Math.cos(a), rr * Math.sin(a), zc + f * R * ez], r: [0.6, 0.6, a] });
        }
      for (let i = 0; i < p.nl; i++) {
        const a = (i * 2 * PI) / p.nl;
        const spread = 0.03 + p.crown * 0.3;
        k.rod(
          'accent',
          [Math.cos(a) * 0.012, Math.sin(a) * 0.012, -0.04],
          [Math.cos(a) * spread, Math.sin(a) * spread, p.crown * (i % 2 ? 0.7 : 0.95)],
          0.012,
          0.001,
          4,
        );
      }
      k.rod('accent', [0, 0, -0.04], [0, 0, p.crown * 1.05], 0.012, 0.001, 4);
    },
    anchors(p) {
      const { zc } = pineGeo(p);
      const { R, ez } = p;
      return {
        tip: [0, 0, zc - R * ez],
        rear: [0, 0, p.crown * 1.05],
        top: [0, R, zc],
        grip: [0, -0.011, -0.02],
        under: [0, -R, zc],
        side: [R, 0, zc],
        mag: [0, -R * 0.8, zc + R * ez * 0.6],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['grenade_launcher'],
    fireMode: 'arc',
    ammo: 'pineapple grenades',
  },

  {
    kind: 'watermelon',
    group: 'food',
    noun: 'Watermelon',
    syn: ['watermelon', 'melon', 'fruit', 'summer fruit', 'big fruit'],
    tags: ['food', 'fruit', 'organic', 'heavy', 'silly'],
    desc: 'big striped green watermelon',
    color: '#4f9a3c',
    accent: '#24572a',
    variants: [
      { v: 'classic', p: { R: 0.14, ez: 1.35, stripes: 8, stem: 1 } },
      { v: 'sugar', p: { R: 0.13, ez: 1.0, stripes: 12, stem: 1 }, desc: 'round sugar baby watermelon' },
      { v: 'giant', p: { R: 0.2, ez: 1.6, stripes: 6, stem: 0 }, desc: 'enormous prize-winning watermelon' },
    ],
    draw(k, p) {
      const Rz = p.R * p.ez;
      const prof = melonProf(p);
      k.zlathe('main', prof, 12, [0, 0, -Rz]);
      const v = prof.map(([x, y]) => new THREE.Vector2(Math.max(x * 1.012, 0.0001), y * 1.004));
      const w = (PI / p.stripes) * 0.65;
      for (let i = 0; i < p.stripes; i++)
        k.add('accent', new THREE.LatheGeometry(v, 1, (i * 2 * PI) / p.stripes, w), { p: [0, 0, -Rz], r: [PI / 2, 0, 0] });
      if (p.stem) k.rod('#6b5a2a', [0, 0, -0.005], [0, 0.01, 0.02], 0.007, 0.004, 5);
    },
    anchors(p) {
      const Rz = p.R * p.ez;
      return {
        tip: [0, 0, -2 * Rz],
        rear: p.stem ? [0, 0.01, 0.02] : [0, 0, 0],
        top: [0, p.R, -Rz],
        grip: [0, -p.R * 0.5, -Rz * (1 - Math.cos(PI / 6))],
        under: [0, -p.R, -Rz],
        side: [p.R, 0, -Rz],
        mag: [0, -p.R * Math.sin(PI / 3), -Rz * 0.5],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
    guns: ['grenade_launcher', 'smg'],
    fireMode: 'projectile',
    ammo: 'watermelon seeds',
  },

  {
    kind: 'sausage',
    group: 'food',
    noun: 'Giant Sausage',
    syn: ['sausage', 'frankfurter', 'wurst', 'salami', 'banger', 'hot dog', 'meat'],
    tags: ['food', 'organic', 'silly'],
    desc: 'giant curved frankfurter sausage',
    color: '#b5532f',
    accent: '#e8d9b0',
    variants: [
      { v: 'frank', p: { L: 0.4, R: 0.03, bend: 0.05, links: 1, salami: 0 } },
      { v: 'links', p: { L: 0.5, R: 0.028, bend: 0.04, links: 3, salami: 0 }, desc: 'chain of three linked sausages' },
      { v: 'salami', p: { L: 0.42, R: 0.045, bend: 0, links: 1, salami: 1 }, desc: 'tied dry-cured salami log', noun: 'Salami' },
    ],
    draw(k, p) {
      const g = sauGeo(p);
      sweep(k, 'main', g.c, g.r, 8);
      k.ball('accent', p.R * 0.3, g.c[0], 0);
      k.ball('accent', p.R * 0.3, g.c[g.N - 1], 0);
      if (p.salami) {
        for (const f of [0.22, 0.5, 0.78]) {
          const i = Math.round(f * (g.N - 1));
          k.torus('white', g.r[i] + 0.001, 0.0025, { p: g.c[i] }, 3, 10);
        }
        for (let i = 0; i < 8; i++) {
          const a = i * 2.4;
          const z = -p.L * 0.7 + (i / 7) * p.L * 0.8;
          k.box('white', [0.008, 0.004, 0.008], { p: [p.R * 0.98 * Math.cos(a), p.R * 0.98 * Math.sin(a), z], r: [0, 0, a - PI / 2] });
        }
      }
    },
    anchors(p) {
      const { c, r, N, mid, gi } = sauGeo(p);
      const m = c[mid];
      return {
        tip: c[0],
        rear: c[N - 1],
        top: [0, m[1] + r[mid], m[2]],
        grip: [0, c[gi][1] - r[gi], c[gi][2]],
        under: [0, m[1] - r[mid], m[2]],
        side: [r[mid], m[1], m[2]],
        mag: [0, m[1] - r[mid], m[2]],
      };
    },
    roles: ['blade', 'barrel', 'mag', 'deco'],
    melee: { swing: 'thrust', weight: 'medium' },
  },

  {
    kind: 'fish',
    group: 'food',
    noun: 'Fish',
    syn: ['fish', 'salmon', 'trout', 'swordfish', 'mackerel', 'seafood', 'wet fish'],
    tags: ['food', 'organic', 'silly'],
    desc: 'big wet salmon',
    color: '#8a9aa8',
    accent: '#e98a6a',
    variants: [
      { v: 'salmon', p: { L: 0.55, H: 0.12, W: 0.06, style: 0 }, noun: 'Salmon' },
      { v: 'trout', p: { L: 0.38, H: 0.08, W: 0.045, style: 1 }, desc: 'speckled river trout', noun: 'Trout' },
      { v: 'swordfish', p: { L: 0.6, H: 0.13, W: 0.07, style: 2 }, desc: 'swordfish with long pointed bill', noun: 'Swordfish' },
    ],
    draw(k, p) {
      const g = fishGeo(p);
      const { L, H, W } = p;
      sweep(k, 'main', g.c, g.r, 8, g.sy);
      k.extrude(
        'accent',
        [
          [-0.015, H * 0.1],
          [0.11 * L, H * 0.55],
          [0.08 * L, 0],
          [0.11 * L, -H * 0.55],
          [-0.015, -H * 0.1],
        ],
        0.006,
        'zy',
      );
      const sail = p.style === 2;
      k.extrude(
        'accent',
        sail
          ? [
              [-0.62 * L, H * 0.4],
              [-0.25 * L, H * 0.4],
              [-0.52 * L, H * 1.15],
            ]
          : [
              [-0.55 * L, H * 0.42],
              [-0.3 * L, H * 0.42],
              [-0.4 * L, H * 0.78],
            ],
        0.005,
        'zy',
      );
      k.extrude(
        'accent',
        [
          [-0.25 * L, -H * 0.35],
          [-0.1 * L, -H * 0.3],
          [-0.12 * L, -H * 0.6],
        ],
        0.004,
        'zy',
      );
      const ez = -0.76 * L;
      for (const sx of [-1, 1]) {
        k.ball('white', H * 0.09, [sx * W * 0.24, H * 0.1, ez], 0);
        k.ball('dark', H * 0.05, [sx * (W * 0.24 + H * 0.06), H * 0.1, ez], 0);
      }
      if (sail) k.rod('main', [0, 0, -0.85 * L + 0.01], [0, 0, g.tipZ], W * 0.14, 0.001, 5);
      if (p.style === 1)
        for (let i = 0; i < 8; i++) {
          const sx = i % 2 ? 1 : -1;
          const z = -0.6 * L + (Math.floor(i / 2) / 3) * 0.45 * L;
          k.box('dark', [0.004, 0.008, 0.008], { p: [sx * W * 0.47, H * (0.15 + 0.1 * (i % 3)), z] });
        }
    },
    anchors(p) {
      const g = fishGeo(p);
      const z3 = g.c[3][2];
      return {
        tip: [0, 0, g.tipZ],
        rear: [0, 0, 0.08 * p.L],
        top: [0, p.H / 2, z3],
        grip: [0, -(p.H / 2) * 0.22, 0],
        under: [0, -p.H / 2, z3],
        side: [p.W / 2, 0, z3],
        mag: [0, -(p.H / 2) * 0.95, g.c[4][2]],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'slash', weight: 'medium' },
  },

  {
    kind: 'cheese-wedge',
    group: 'food',
    noun: 'Cheese Wedge',
    syn: ['cheese', 'cheese wedge', 'swiss cheese', 'cheddar', 'brie', 'emmental', 'dairy'],
    tags: ['food', 'silly', 'french'],
    desc: 'holey wedge of swiss cheese',
    color: '#f5cf4b',
    accent: '#c98a2a',
    variants: [
      { v: 'swiss', p: { W: 0.07, D: 0.16, Hh: 0.07, holes: 1, style: 0 } },
      { v: 'cheddar', p: { W: 0.06, D: 0.14, Hh: 0.06, holes: 0, style: 1 }, desc: 'cheddar wedge with waxed rind' },
      { v: 'brie', p: { W: 0.08, D: 0.17, Hh: 0.03, holes: 0, style: 2 }, desc: 'flat creamy brie wedge', noun: 'Brie' },
    ],
    draw(k, p) {
      const { W, D, Hh } = p;
      const tri: Pt[] = [
        [0, -D + 0.02],
        [W, 0.02],
        [-W, 0.02],
      ];
      k.extrude('main', tri, Hh, 'xz');
      const rind: Slot = p.style === 2 ? 'white' : 'accent';
      k.box(rind, [2 * W, Hh, 0.008], { p: [0, 0, 0.024] });
      if (p.style === 2) for (const y of [-Hh / 2, Hh / 2]) k.extrude('white', tri, 0.003, 'xz', { p: [0, y, 0] });
      if (p.holes) {
        const hole = '#c99a1e';
        for (const [fx, fz, hr] of [
          [0.3, -0.22, 0.011],
          [-0.3, -0.3, 0.009],
          [0.08, -0.52, 0.008],
          [-0.12, -0.12, 0.007],
          [0.0, -0.75, 0.005],
        ]) {
          const z = 0.02 + fz * D;
          const x = fx * W * (1 + fz);
          k.rod(hole, [x, Hh / 2 - 0.002, z], [x, Hh / 2 + 0.0012, z], hr, hr, 8);
        }
        const len = Math.hypot(W, D);
        const nx = D / len;
        const nz = -W / len;
        for (const [f, fy, hr] of [
          [0.35, 0.1, 0.01],
          [0.62, -0.2, 0.007],
        ]) {
          const px = W * (1 - f);
          const pz = 0.02 - D * f;
          const y = fy * Hh;
          k.rod(hole, [px - nx * 0.002, y, pz - nz * 0.002], [px + nx * 0.0012, y, pz + nz * 0.0012], hr, hr, 8);
        }
      }
    },
    anchors(p) {
      const { W, D, Hh } = p;
      return {
        tip: [0, 0, -D + 0.02],
        rear: [0, 0, 0.028],
        top: [0, Hh / 2, 0.02 - D * 0.35],
        grip: [0, -Hh / 2, 0],
        under: [0, -Hh / 2, 0.02 - D * 0.4],
        side: [W * 0.7, 0, 0.02 - D * 0.3],
        mag: [0, -Hh / 2, 0.02 - D * 0.2],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  {
    kind: 'cheese-wheel',
    group: 'food',
    noun: 'Cheese Wheel',
    syn: ['cheese wheel', 'cheese', 'gouda', 'parmesan', 'emmental', 'wheel', 'dairy'],
    tags: ['food', 'heavy', 'silly', 'italian'],
    desc: 'whole round wheel of cheese',
    color: '#d9452e',
    accent: '#f3d36b',
    variants: [
      { v: 'gouda', p: { R: 0.14, T: 0.09, style: 0 }, desc: 'red wax gouda wheel' },
      { v: 'parmesan', p: { R: 0.16, T: 0.2, style: 1 }, desc: 'giant stamped parmesan drum' },
      { v: 'emmental', p: { R: 0.17, T: 0.07, style: 2 }, desc: 'flat emmental wheel with holes' },
    ],
    draw(k, p) {
      const { R, T } = p;
      const prof: Pt[] =
        p.style === 0
          ? [
              [0, -T],
              [R * 0.88, -T],
              [R, -T * 0.5],
              [R * 0.88, 0],
              [0, 0],
            ]
          : [
              [0, -T],
              [R * 0.97, -T],
              [R, -T + 0.008],
              [R, -0.008],
              [R * 0.97, 0],
              [0, 0],
            ];
      k.zlathe('main', prof, 12);
      if (p.style === 0) k.zrod('accent', -T - 0.002, -T + 0.001, R * 0.35, R * 0.35, 10);
      else if (p.style === 1) {
        for (let i = 0; i < 12; i++) {
          const a = (i * 2 * PI) / 12;
          for (const z of [-T * 0.35, -T * 0.65])
            k.box('dark', [0.006, 0.003, 0.006], { p: [R * Math.cos(a + (z < -T / 2 ? 0.26 : 0)), R * Math.sin(a + (z < -T / 2 ? 0.26 : 0)), z], r: [0, 0, a - PI / 2] });
        }
      } else {
        const hole = '#c99a1e';
        for (const [fr, a, hr] of [
          [0.5, 0.4, 0.016],
          [0.3, 2.4, 0.012],
          [0.7, 3.6, 0.014],
          [0.62, 5.3, 0.01],
          [0.15, 4.5, 0.009],
        ])
          k.zrod(hole, -T - 0.0012, -T + 0.002, hr, hr, 8, fr * R * Math.cos(a), fr * R * Math.sin(a));
        for (const [a, fz, hr] of [
          [0.9, 0.4, 0.012],
          [2.6, 0.6, 0.01],
          [4.2, 0.35, 0.013],
          [5.6, 0.55, 0.009],
        ])
          k.rod(hole, [(R - 0.002) * Math.cos(a), (R - 0.002) * Math.sin(a), -T * fz], [(R + 0.0012) * Math.cos(a), (R + 0.0012) * Math.sin(a), -T * fz], hr, hr, 8);
      }
    },
    anchors(p) {
      const { R, T } = p;
      return {
        tip: [0, 0, p.style === 0 ? -T - 0.002 : -T],
        rear: [0, 0, 0],
        top: [0, R, -T / 2],
        grip: [0, -R * 0.5, 0],
        under: [0, -R, -T / 2],
        side: [R, 0, -T / 2],
        mag: [0, -R, -T / 2],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
  },

  {
    kind: 'pizza',
    group: 'food',
    noun: 'Pizza',
    syn: ['pizza', 'whole pizza', 'pie', 'pepperoni pizza', 'margherita', 'frisbee', 'disc'],
    tags: ['food', 'italian', 'silly', 'party'],
    desc: 'whole pepperoni pizza',
    color: '#d9a054',
    accent: '#f2c24e',
    variants: [
      { v: 'pepperoni', p: { R: 0.17, style: 0 } },
      { v: 'margherita', p: { R: 0.15, style: 1 }, desc: 'margherita pizza with basil and mozzarella' },
      { v: 'hawaiian', p: { R: 0.18, style: 2 }, desc: 'hawaiian pizza with ham and pineapple' },
    ],
    draw(k, p) {
      const { R } = p;
      const zc = -R - 0.004;
      k.lathe(
        'main',
        [
          [0, -0.006],
          [R, -0.006],
          [R + 0.004, 0.002],
          [R - 0.004, 0.009],
          [R - 0.014, 0.004],
          [0, 0.003],
        ],
        12,
        { p: [0, 0, zc] },
      );
      k.rod('accent', [0, 0.002, zc], [0, 0.0048, zc], R - 0.012, R - 0.012, 12);
      const spots = PIZ.map(([f, a]) => [f * (R - 0.03) * Math.cos(a), zc + f * (R - 0.03) * Math.sin(a), a]);
      if (p.style === 0) for (const [x, z] of spots) k.rod('#b3342b', [x, 0.0044, z], [x, 0.0074, z], R * 0.11, R * 0.11, 7);
      else if (p.style === 1) {
        spots.slice(0, 6).forEach(([x, z]) => k.ball('white', R * 0.1, [x, 0.005, z], 0, [1, 0.35, 1]));
        spots.slice(5).forEach(([x, z, a]) =>
          k.extrude(
            '#3f8f3a',
            [
              [0, -0.014],
              [0.007, -0.004],
              [0.005, 0.008],
              [0, 0.014],
              [-0.005, 0.008],
              [-0.007, -0.004],
            ],
            0.002,
            'xz',
            { p: [x + 0.012, 0.0068, z + 0.01], r: [0, a, 0] },
          ),
        );
      } else
        spots.forEach(([x, z, a], i) => {
          if (i % 2) k.box('#e8938f', [R * 0.13, 0.003, R * 0.13], { p: [x, 0.0062, z], r: [0, a, 0] });
          else k.box('#f4d03f', [R * 0.07, 0.007, R * 0.07], { p: [x, 0.0075, z], r: [0, a, 0] });
        });
    },
    anchors(p) {
      const zc = -p.R - 0.004;
      return {
        tip: [0, 0.002, 2 * zc],
        rear: [0, 0.002, 0],
        top: [0, 0.0048, zc],
        grip: [0, -0.006, -0.03],
        under: [0, -0.006, zc],
        side: [p.R + 0.004, 0.002, zc],
        mag: [0, -0.006, zc * 0.5],
      };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'spin', weight: 'medium' },
  },

  {
    kind: 'pizza-slice',
    group: 'food',
    noun: 'Pizza Slice',
    syn: ['pizza slice', 'slice', 'pizza', 'pepperoni', 'deep dish', 'cheesy'],
    tags: ['food', 'italian', 'silly', 'party', 'light'],
    desc: 'triangular pepperoni pizza slice',
    color: '#d9a054',
    accent: '#f2c24e',
    variants: [
      { v: 'pepperoni', p: { L: 0.2, W: 0.08, T: 0.008, style: 0 } },
      { v: 'cheesy', p: { L: 0.22, W: 0.085, T: 0.008, style: 1 }, desc: 'slice with dripping cheese strands' },
      { v: 'deepdish', p: { L: 0.16, W: 0.07, T: 0.03, style: 2 }, desc: 'thick chicago deep dish slice' },
    ],
    draw(k, p) {
      const { L, W, T } = p;
      k.extrude(
        'main',
        [
          [0, -L],
          [W, 0],
          [-W, 0],
        ],
        T,
        'xz',
      );
      k.extrude(
        'accent',
        [
          [0, -L + 0.01],
          [W - 0.008, -0.008],
          [-W + 0.008, -0.008],
        ],
        0.003,
        'xz',
        { p: [0, T / 2 + 0.0015, 0] },
      );
      const rc = T * 0.5 + 0.007;
      k.rod('main', [-W * 1.02, T * 0.2, 0.004], [W * 1.02, T * 0.2, 0.004], rc, rc, 6);
      const yt = T / 2 + 0.003;
      if (p.style === 0 || p.style === 1)
        for (const [x, z] of [
          [0, -0.38 * L],
          [0.32 * W, -0.15 * L],
          [-0.35 * W, -0.18 * L],
          [0, -0.65 * L],
        ])
          k.rod('#b3342b', [x, yt - 0.001, z], [x, yt + 0.0025, z], W * 0.17, W * 0.17, 7);
      if (p.style === 1)
        for (const [x, z, dl] of [
          [0, -L + 0.02, 0.05],
          [0.2 * W, -0.7 * L, 0.035],
          [-0.3 * W, -0.55 * L, 0.03],
          [0.45 * W, -0.42 * L, 0.025],
        ])
          k.rod('accent', [x, 0, z], [x * 1.1, -dl, z - 0.004], 0.004, 0.0015, 5);
      if (p.style === 2)
        for (const [x, z] of [
          [0, -0.4 * L],
          [0.3 * W, -0.15 * L],
          [-0.3 * W, -0.2 * L],
          [0, -0.65 * L],
        ])
          k.ball('#b3342b', W * 0.16, [x, yt, z], 0, [1, 0.45, 1]);
    },
    anchors(p) {
      const { L, W, T } = p;
      const rc = T * 0.5 + 0.007;
      return {
        tip: [0, 0, -L],
        rear: [0, T * 0.2, 0.004 + rc],
        top: [0, T / 2 + 0.003, -0.48 * L],
        grip: [0, -T / 2, -0.02],
        under: [0, -T / 2, -0.4 * L],
        side: [0.6 * W, 0, -0.4 * L],
        mag: [0, -T / 2, -0.3 * L],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },

  {
    kind: 'ice-cream',
    group: 'food',
    noun: 'Ice Cream Cone',
    syn: ['ice cream', 'ice-cream cone', 'cone', 'gelato', 'soft serve', 'scoop', 'dessert'],
    tags: ['food', 'sweet', 'dessert', 'silly', 'party', 'toy'],
    desc: 'waffle cone with ice cream scoop',
    color: '#d9a35a',
    accent: '#f4a6c0',
    variants: [
      { v: 'single', p: { cr: 0.028, cl: 0.12, n: 1, sr: 0.035, soft: 0 } },
      { v: 'triple', p: { cr: 0.03, cl: 0.13, n: 3, sr: 0.033, soft: 0 }, desc: 'towering triple scoop cone' },
      { v: 'softserve', p: { cr: 0.028, cl: 0.12, n: 1, sr: 0.03, soft: 1 }, desc: 'swirly soft serve cone' },
    ],
    draw(k, p) {
      const g = iceGeo(p);
      k.rod('main', [0, 0, -p.cl * 0.4], [0, 0, p.cl * 0.6], p.cr, 0, 8);
      k.zrod('main', g.zm, -p.cl * 0.4, p.cr * 1.08, p.cr * 1.08, 8);
      if (p.soft) {
        for (let i = 0; i < 3; i++) k.torus('accent', g.ringR(i), p.cr * (0.42 - i * 0.07), { p: [0, 0, g.ringZ(i)] }, 5, 10);
        k.rod('accent', [0, 0, g.ringZ(2) + 0.004], [0, 0, g.tip], p.cr * 0.55, 0, 7);
      } else {
        for (let i = 0; i < p.n; i++) {
          k.ball('accent', p.sr, [0, 0, g.zs(i)], 1);
          k.ball('accent', p.sr * 0.28, [p.sr * 0.5, -p.sr * 0.75, g.zs(i) + p.sr * 0.35], 0, [1, 1.6, 1]);
        }
        k.ball('#c8102e', 0.012, [0, 0, g.zs(p.n - 1) - p.sr - 0.008], 0);
      }
    },
    anchors(p): Anchors {
      const g = iceGeo(p);
      const z = p.soft ? g.ringZ(0) : g.zs(0);
      const rr = p.soft ? g.ringR(0) + p.cr * 0.42 : p.sr;
      return {
        tip: [0, 0, g.tip],
        rear: [0, 0, p.cl * 0.6],
        top: [0, rr, z],
        grip: [0, -p.cr * 0.6, 0],
        under: [0, -rr, z],
        side: [rr, 0, z],
        mag: [0, -p.cr * 0.8, -p.cl * 0.2],
      };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
  },

  {
    kind: 'drumstick',
    group: 'food',
    noun: 'Chicken Drumstick',
    syn: ['drumstick', 'chicken leg', 'turkey leg', 'meat', 'meat on bone', 'roast', 'caveman'],
    tags: ['food', 'organic', 'silly', 'holiday'],
    desc: 'roast chicken drumstick',
    color: '#b8652a',
    accent: '#f2efe8',
    variants: [
      { v: 'chicken', p: { L: 0.09, R: 0.035, bone: 0.06, style: 0 } },
      { v: 'turkey', p: { L: 0.15, R: 0.055, bone: 0.09, style: 1 }, desc: 'roast turkey leg with paper frill', noun: 'Turkey Leg' },
      { v: 'caveman', p: { L: 0.2, R: 0.08, bone: 0.12, style: 2 }, desc: 'cartoon caveman meat on bone', noun: 'Meat on the Bone' },
    ],
    draw(k, p) {
      const g = drumGeo(p);
      const { L, R, bone } = p;
      const zt = g.zt;
      const prof: Pt[] =
        p.style === 2
          ? [
              [g.br * 1.3, zt],
              [R * 0.6, zt + L * 0.06],
              [R * 0.95, zt + L * 0.3],
              [R, zt + L * 0.5],
              [R * 0.9, zt + L * 0.75],
              [R * 0.55, zt + L * 0.95],
              [g.br * 1.3, -0.01],
            ]
          : [
              [0, zt],
              [R * 0.7, zt + L * 0.08],
              [R, zt + L * 0.3],
              [R * 0.9, zt + L * 0.6],
              [R * 0.45, zt + L * 0.88],
              [g.br * 1.4, -0.004],
              [0, -0.004],
            ];
      k.zlathe('main', prof, 8);
      k.zrod('white', -0.02, bone, g.br, g.br, 6);
      drumKnobs(k, bone, g.br);
      if (p.style === 1) k.zrod('accent', bone * 0.5, bone * 0.82, g.br * 1.9, g.br * 1.5, 8);
      if (p.style === 2) {
        k.zrod('white', g.zFrontBone, zt + 0.02, g.br, g.br, 6);
        drumKnobs(k, g.zFrontBone, g.br);
      }
    },
    anchors(p) {
      const g = drumGeo(p);
      const zmag = p.style === 2 ? g.zt + p.L * 0.75 : g.zt + p.L * 0.6;
      return {
        tip: p.style === 2 ? [0, 0, g.zFrontBone - g.knobOff] : [0, 0, g.zt],
        rear: [0, 0, p.bone + g.knobOff],
        top: [0, p.R, g.zmid],
        grip: [0, -g.br, p.bone * 0.35],
        under: [0, -p.R, g.zmid],
        side: [p.R, 0, g.zmid],
        mag: [0, -p.R * 0.9, zmag],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  {
    kind: 'donut',
    group: 'food',
    noun: 'Donut',
    syn: ['donut', 'doughnut', 'bagel', 'ring', 'glazed', 'sprinkles', 'pastry'],
    tags: ['food', 'sweet', 'dessert', 'silly', 'party'],
    desc: 'frosted donut with sprinkles',
    color: '#d9a05a',
    accent: '#f28ab2',
    variants: [
      { v: 'sprinkles', p: { R: 0.038, r: 0.02, style: 0 } },
      { v: 'glazed', p: { R: 0.036, r: 0.018, style: 1 }, desc: 'shiny glazed donut with drips' },
      { v: 'bagel', p: { R: 0.036, r: 0.022, style: 2 }, desc: 'sesame seed bagel', noun: 'Bagel' },
    ],
    draw(k, p) {
      const { R, r } = p;
      k.torus('main', R, r, { p: [0, 0, -R], r: [PI / 2, 0, 0] }, 6, 12);
      if (p.style === 0 || p.style === 1) {
        const off = p.style === 0 ? 0.22 : 0.1;
        k.torus('accent', R, r * (p.style === 0 ? 1.03 : 1.02), { p: [0, r * off, -R], r: [PI / 2, 0, 0] }, 6, 12);
      }
      if (p.style === 0)
        for (let i = 0; i < 12; i++) {
          const a = (i * 2 * PI) / 12 + 0.2 * (i % 3);
          const ro = R + r * 0.45 * (i % 2 ? 1 : -1);
          k.box('#5ec8e8', [r * 0.35, r * 0.15, r * 0.12], { p: [ro * Math.cos(a), r * 1.15, -R + ro * Math.sin(a)], r: [0, a * 3, 0] });
        }
      else if (p.style === 1)
        for (let i = 0; i < 6; i++) {
          const a = (i * 2 * PI) / 6 + 0.3;
          const ro = R + r * 0.9;
          k.ball('accent', r * 0.22, [ro * Math.cos(a), -r * 0.15, -R + ro * Math.sin(a)], 0, [1, 1.8, 1]);
        }
      else
        for (let i = 0; i < 14; i++) {
          const a = (i * 2 * PI) / 14 + 0.15 * (i % 3);
          const ro = R + r * 0.4 * ((i % 3) - 1);
          k.box('white', [r * 0.2, r * 0.1, r * 0.12], { p: [ro * Math.cos(a), r * 0.97, -R + ro * Math.sin(a)], r: [0, a * 2, 0] });
        }
    },
    anchors(p) {
      const { R, r } = p;
      return {
        tip: [0, 0, -2 * R - r],
        rear: [0, 0, r],
        top: [0, donutTop(p), -2 * R],
        grip: [0, -r, 0],
        under: [0, -r, -2 * R],
        side: [R + r, 0, -R],
        mag: [0, -r, -2 * R],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'spin', weight: 'light' },
  },

  {
    kind: 'leek',
    group: 'food',
    noun: 'Leek',
    syn: ['leek', 'spring onion', 'scallion', 'celery', 'green onion', 'negi', 'vegetable'],
    tags: ['food', 'vegetable', 'organic', 'silly', 'light'],
    desc: 'long green leek',
    color: '#3f8f3a',
    accent: '#b7d98a',
    variants: [
      { v: 'leek', p: { L: 0.55, R: 0.02, style: 0 } },
      { v: 'scallion', p: { L: 0.4, R: 0.008, style: 1 }, desc: 'thin spring onion with bulb', noun: 'Spring Onion' },
      { v: 'celery', p: { L: 0.45, R: 0.012, style: 2 }, desc: 'leafy celery stalk bunch', noun: 'Celery' },
    ],
    draw(k, p) {
      const { L, R } = p;
      const root: Slot = '#d9cfa8';
      if (p.style === 0) {
        k.zrod('white', -L * 0.42, 0.04, R, R * 1.05, 8);
        k.zrod('accent', -L * 0.58, -L * 0.42, R * 0.95, R, 8);
        for (const a of [0, 1.05, -1.05])
          k.blade(
            'main',
            [
              [-L * 0.5, -R * 0.9],
              [-L * 0.5, R * 0.9],
              [-L * 0.8, R * 1.6],
              [-L, R * 0.3],
              [-L * 0.97, -R * 0.5],
              [-L * 0.75, -R * 1.2],
            ],
            0.004,
            'zy',
            { r: [0, 0, a] },
          );
        for (const [dx, dy] of [
          [0, 0],
          [0.012, 0.008],
          [-0.012, 0.006],
          [0.006, -0.012],
          [-0.008, -0.01],
        ])
          k.rod(root, [0, 0, 0.04], [dx, dy, dx === 0 ? 0.075 : 0.068], 0.004, 0.001, 4);
      } else if (p.style === 1) {
        k.zrod('white', -L * 0.35, 0.03, R, R * 1.3, 6);
        k.ball('white', R * 1.6, [0, 0, 0.032], 0);
        k.rod('main', [0, 0, -L * 0.33], [0, 0, -L], R * 0.7, R * 0.5, 5);
        for (const [dx, dy] of [
          [0.012, 0.01],
          [-0.012, 0.008],
          [0.004, -0.014],
        ])
          k.rod('main', [0, 0, -L * 0.33], [dx * 3, dy * 3, -L * 0.85], R * 0.6, R * 0.3, 5);
        for (const [dx, dy] of [
          [0, 0],
          [0.008, 0.005],
          [-0.007, 0.004],
          [0.002, -0.008],
        ])
          k.rod(root, [0, 0, 0.032 + R], [dx, dy, 0.032 + R * 1.6 + 0.02], 0.002, 0.0006, 4);
      } else {
        for (const x of [-0.018, 0, 0.018]) k.rod('accent', [x * 0.5, 0, 0.03], [x * 1.4, Math.abs(x) * 0.5, -L * 0.75], R * 1.1, R, 6);
        for (const [x, y, z, s] of [
          [0, 0, -L + 0.02, 0.02],
          [0.025, 0.012, -L * 0.88, 0.018],
          [-0.025, 0.01, -L * 0.86, 0.018],
          [0.008, 0.02, -L * 0.8, 0.016],
        ])
          k.ball('main', s, [x, y, z], 0);
      }
    },
    anchors(p) {
      const { L, R } = p;
      if (p.style === 2)
        return {
          tip: [0, 0, -L],
          rear: [0, 0, 0.03],
          top: [0, R * 1.05, -L * 0.3],
          grip: [0, -R * 1.08, 0],
          under: [0, -R * 1.05, -L * 0.3],
          side: [R * 1.05, 0, -L * 0.3],
          mag: [0, -R * 1.07, -L * 0.15],
        };
      if (p.style === 1)
        return {
          tip: [0, 0, -L],
          rear: [0, 0, 0.032 + R * 1.6 + 0.02],
          top: [0, R * 1.05, -L * 0.2],
          grip: [0, -R * 1.25, 0],
          under: [0, -R * 1.05, -L * 0.2],
          side: [R * 1.05, 0, -L * 0.2],
          mag: [0, -R * 1.15, -L * 0.1],
        };
      return {
        tip: [0, 0, -L],
        rear: [0, 0, 0.075],
        top: [0, R, -L * 0.25],
        grip: [0, -R, 0],
        under: [0, -R, -L * 0.3],
        side: [R, 0, -L * 0.3],
        mag: [0, -R, -L * 0.15],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
  },
];
