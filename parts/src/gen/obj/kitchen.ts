/** KITCHEN objects. See objkit.ts for the canonical frame + roles. */
import type { Anchors, ObjSpec, P } from './objkit';
import type { Kit, Pt, Slot } from '../../lib/kit';
import { chamferRect, circlePts } from '../../lib/kit';
import type { Vec3 } from '../../types';

const PI = Math.PI;

/** metal ferrule at the origin for head-role drawings (keeps the head's deco socket on the surface). */
function ferrule(k: Kit, z0 = -0.05, r = 0.012): void {
  k.zrod('metal', z0, 0.01, r, r, 6);
}

/** plain cylindrical tool grip running from the origin toward +Z with a hanging ring. */
function toolGrip(k: Kit, hl: number, slot: Slot = 'accent'): void {
  k.zrod(slot, 0, hl, 0.011, 0.012, 6);
  k.torus('metal', 0.008, 0.0025, { p: [0, 0, hl + 0.008], r: [0, PI / 2, 0] }, 3, 8);
}

/** riveted knife handle seen from the side, running from the origin toward +Z. */
function knifeHandle(k: Kit, hl: number, slot: Slot = 'accent'): void {
  k.extrude(
    slot,
    [
      [0.004, 0.011],
      [hl, 0.012],
      [hl + 0.008, 0.004],
      [hl + 0.006, -0.013],
      [0.004, -0.012],
    ],
    0.02,
    'zy',
    undefined,
    0.002,
  );
  for (const f of [0.25, 0.55, 0.85]) k.rod('metal', [-0.0128, 0, 0.004 + hl * f], [0.0128, 0, 0.004 + hl * f], 0.003, 0.003, 6);
}

/* ---------------- pot ---------------- */
function potGeo(p: P) {
  const Rh = p.belly ? p.R * 0.9 : p.R;
  const zc = p.stick > 0 ? -p.R - 0.012 : -(Rh + 0.028);
  return { Rh, zc, hy: p.H * 0.3, y0: -p.H / 2 };
}
function potBody(k: Kit, p: P, zc: number): void {
  const { R, H } = p;
  const y0 = -H / 2;
  const prof: Pt[] = p.belly
    ? [
        [0, y0],
        [R * 0.72, y0],
        [R, y0 + H * 0.42],
        [R * 0.86, H / 2],
        [R * 0.8, H / 2],
        [R * 0.9, y0 + H * 0.42],
        [R * 0.62, y0 + 0.012],
        [0, y0 + 0.012],
      ]
    : [
        [0, y0],
        [R, y0],
        [R, H / 2],
        [R * 0.93, H / 2],
        [R * 0.93, y0 + 0.012],
        [0, y0 + 0.012],
      ];
  k.lathe('main', prof, 12, { p: [0, 0, zc] });
  if (p.lid) {
    const rl = R * 1.03;
    k.lathe(
      'main',
      [
        [0, H / 2],
        [rl, H / 2],
        [rl * 0.97, H / 2 + 0.006],
        [rl * 0.6, H / 2 + 0.022],
        [0, H / 2 + 0.028],
      ],
      12,
      { p: [0, 0, zc] },
    );
    k.rod('dark', [0, H / 2 + 0.024, zc], [0, H / 2 + 0.045, zc], 0.01, 0.016, 8);
  }
  if (p.belly)
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * PI) / 3 + PI / 6;
      k.rod(
        'dark',
        [Math.cos(a) * R * 0.45, y0 + 0.01, zc + Math.sin(a) * R * 0.45],
        [Math.cos(a) * R * 0.52, y0 - 0.03, zc + Math.sin(a) * R * 0.52],
        0.013,
        0.008,
        5,
      );
    }
}

/* ---------------- ladle ---------------- */
function ladleBowl(k: Kit, p: P, z0: number): void {
  const yb = -p.br * 0.6;
  const zb = -p.L - p.br;
  k.lathe(
    'main',
    [
      [0, -p.br],
      [p.br * 0.72, -p.br * 0.68],
      [p.br, 0],
      [p.br * 0.9, 0],
      [p.br * 0.62, -p.br * 0.58],
      [0, -p.br * 0.86],
    ],
    10,
    { p: [0, yb, zb] },
  );
  k.rod('metal', [0, 0, z0], [0, yb + 0.003, zb + p.br * 0.93], 0.0055, 0.0055, 5);
  if (p.spout) k.box('main', [0.02, 0.004, 0.016], { p: [0, yb - 0.001, zb - p.br - 0.004] });
}

/* ---------------- spatula ---------------- */
function spatHead(k: Kit, p: P, z0: number): void {
  const yb = -0.012;
  const zf = -p.L - p.bl;
  const pts: Pt[] = [
    [-p.bw * 0.22, -p.L],
    [p.bw * 0.22, -p.L],
    [p.bw / 2, -p.L - p.bl * 0.35],
    [p.bw / 2, zf + (p.ang ? p.bl * 0.18 : 0)],
    [-p.bw / 2, zf],
    [-p.bw / 2, -p.L - p.bl * 0.35],
  ];
  const n = p.slots;
  const s = (p.bw * 0.6) / Math.max(n, 1);
  const holes: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * s;
    const z1 = -p.L - p.bl * 0.3;
    const z2 = -p.L - p.bl * 0.8;
    holes.push([
      [x - 0.0025, z1],
      [x + 0.0025, z1],
      [x + 0.0025, z2],
      [x - 0.0025, z2],
    ]);
  }
  k.extrude('main', pts, 0.003, 'xz', { p: [0, yb, 0] }, 0, holes);
  k.rod('metal', [0, 0, z0], [0, yb, -p.L + 0.006], 0.005, 0.005, 5);
}

/* ---------------- chef knife ---------------- */
const KS = 0.012; // knife spine height
function knifeTipY(p: P): number {
  return p.style === 1 ? KS - p.h * 0.92 : p.style === 2 ? KS - p.h * 0.4 : KS - p.h * 0.62;
}
function knifeBlade(p: P): Pt[] {
  const { L, h } = p;
  const s = KS;
  if (p.style === 1)
    return [
      [0, s],
      [-L * 0.7, s],
      [-L * 0.93, s - h * 0.45],
      [-L, s - h * 0.92],
      [-L * 0.9, s - h],
      [0, s - h],
    ];
  if (p.style === 2) {
    const pts: Pt[] = [
      [0, s],
      [-L * 0.95, s],
      [-L, s - h * 0.4],
      [-L * 0.97, s - h],
    ];
    const n = 18;
    for (let i = 1; i < n; i++) pts.push([-L * 0.97 + (i * L * 0.97) / n, i % 2 ? s - h + 0.004 : s - h]);
    pts.push([0, s - h]);
    return pts;
  }
  return [
    [0, s],
    [-L * 0.7, s],
    [-L * 0.92, s - h * 0.35],
    [-L, s - h * 0.62],
    [-L * 0.8, s - h * 0.92],
    [-L * 0.4, s - h],
    [0, s - h],
  ];
}

/* ---------------- cleaver ---------------- */
const CS = 0.018;
function cleaverBlade(k: Kit, p: P): void {
  const { L, h, thick } = p;
  k.extrude(
    'metal',
    [
      [0.004, CS],
      [-L, CS],
      [-L, CS - h + 0.012],
      [0.004, CS - h + 0.012],
    ],
    thick,
    'zy',
    undefined,
    0,
    p.hole ? [circlePts(0.009, 8, -L + 0.024, CS - 0.022)] : [],
  );
  k.blade(
    '#d5dae2',
    [
      [0.004, CS - h + 0.014],
      [-L, CS - h + 0.014],
      [-L, CS - h],
      [0.004, CS - h],
    ],
    thick * 0.9,
    'zy',
  );
}

/* ---------------- rolling pin ---------------- */
function pinTopZ(p: P): number {
  if (!p.ridges) return -p.bl / 2;
  const n = p.ridges;
  return -p.bl + (2 * Math.floor(n / 2) * p.bl) / (2 * n);
}

/* ---------------- whisk ---------------- */
function whiskWires(k: Kit, p: P): void {
  const { WL, rho } = p;
  const prof: Pt[] = [
    [0.35, -0.25],
    [0.85, -0.55],
    [1, -0.78],
    [0.6, -0.95],
  ];
  for (let i = 0; i < 3; i++) {
    const phi = PI / 2 + (i * PI) / 3;
    const cx = Math.cos(phi);
    const cy = Math.sin(phi);
    const pts: Vec3[] = [[0, 0, -0.01]];
    for (const [r, z] of prof) pts.push([cx * r * rho, cy * r * rho, z * WL]);
    pts.push([0, 0, -WL]);
    for (const [r, z] of [...prof].reverse()) pts.push([-cx * r * rho, -cy * r * rho, z * WL]);
    k.tube('metal', pts, 0.0016, 18, 3, true);
  }
}

/* ---------------- kettle ---------------- */
function kettleGeo(p: P) {
  const y0 = -(p.H + p.hgap);
  const sR = p.R * p.sh;
  const a: Vec3 = [0, y0 + p.H * 0.3, -p.R * 0.85];
  const b: Vec3 = [0, y0 + p.H * 0.3 + p.spoutL * 0.8, -p.R - p.spoutL * 0.6];
  const d = Math.hypot(b[1] - a[1], b[2] - a[2]);
  const c: Vec3 = [0, b[1] + ((b[1] - a[1]) / d) * 0.016, b[2] + ((b[2] - a[2]) / d) * 0.016];
  const goose: Vec3[] = [
    [0, y0 + p.H * 0.18, -p.R * 0.9],
    [0, y0 + p.H * 0.15, -p.R - 0.03],
    [0, y0 + p.H * 0.6, -p.R - 0.05],
    [0, y0 + p.H * 1.05, -p.R - p.spoutL],
  ];
  const tip: Vec3 = p.goose ? goose[3] : p.whistle ? c : b;
  return { y0, sR, a, b, c, goose, tip };
}

/* ---------------- teapot ---------------- */
function teaGeo(p: P) {
  const zc = -(p.R + p.hw);
  const yb = -p.H / 2;
  const a: Vec3 = [0, yb + p.H * 0.25, zc - p.R * 0.8];
  const b: Vec3 = [0, yb + p.H * 0.25 + p.spoutL * 0.85, zc - p.R - p.spoutL * 0.55];
  const knobTop = yb + p.H * 0.95 + (p.knob ? 0.05 : 0.022);
  return { zc, yb, a, b, knobTop };
}

/* ---------------- toaster ---------------- */
function toastXs(p: P): number[] {
  return p.slots === 4 ? [-0.32 * p.W, -0.12 * p.W, 0.12 * p.W, 0.32 * p.W] : p.slots === 2 ? [-0.18 * p.W, 0.18 * p.W] : [0];
}

/* ---------------- blender ---------------- */
function blendGeo(p: P) {
  const fy = p.seg === 4 ? Math.SQRT1_2 : 1;
  const fx = p.seg === 4 ? Math.SQRT1_2 : p.seg === 6 ? 0.866 : 1;
  const yA = p.Rb * fy;
  const zm = -p.JL / 2;
  const rm = p.Rb + ((p.Rt - p.Rb) * (0.02 - zm)) / (0.02 + p.JL);
  return { fy, fx, yA, zm, rm };
}

/* ---------------- bottle ---------------- */
function bottleGeo(p: P) {
  const zb = 0.06;
  const z0 = zb - p.L;
  const zn = z0 + p.NL;
  const zs = zn + p.sh;
  const zm = (zs + zb) / 2;
  const soda = p.style === 2;
  const zl0 = soda ? zs + 0.012 : zs + 0.25 * (zb - zs);
  const zl1 = soda ? zm - 0.03 : zs + 0.7 * (zb - zs);
  const tipZ = p.style === 0 ? z0 - 0.002 : p.style === 1 ? z0 - 0.022 : p.style === 2 ? z0 - 0.004 : z0 - 0.003;
  return { zb, z0, zn, zs, zm, zl0, zl1, tipZ };
}

/* ---------------- fork ---------------- */
function forkGeo(p: P) {
  const ws = Math.max(1, p.hw / 0.05);
  const th = p.hw * 0.1;
  const zt0 = -p.L - 0.025 * ws;
  return { ws, th, zt0 };
}
function forkHead(k: Kit, p: P): void {
  const { ws, th, zt0 } = forkGeo(p);
  k.box('metal', [0.009 * ws, th, p.L], { p: [0, 0, -p.L / 2 + 0.004] });
  k.extrude(
    'metal',
    [
      [-0.006 * ws, -p.L],
      [0.006 * ws, -p.L],
      [p.hw / 2, zt0],
      [-p.hw / 2, zt0],
    ],
    th,
    'xz',
  );
  const tw = (p.hw / p.n) * 0.55;
  for (let i = 0; i < p.n; i++) {
    const x = (i - (p.n - 1) / 2) * (p.hw / p.n);
    k.extrude(
      'metal',
      [
        [x - tw / 2, zt0 + 0.002],
        [x + tw / 2, zt0 + 0.002],
        [x + tw / 2, zt0 - p.tl * 0.88],
        [x, zt0 - p.tl],
        [x - tw / 2, zt0 - p.tl * 0.88],
      ],
      th,
      'xz',
    );
  }
}

const shaftMid = (end: Vec3, z0: number, r: number): Vec3 => [0, end[1] / 2 - r, (z0 + end[2]) / 2];

export const KITCHEN: ObjSpec[] = [
  {
    kind: 'frying-pan',
    group: 'kitchen',
    noun: 'Frying Pan',
    syn: ['pan', 'skillet', 'frypan', 'cookware', 'wok'],
    tags: ['kitchen', 'metal', 'silly'],
    desc: 'frying pan with long handle',
    color: '#2b2b2e',
    accent: '#5a3a22',
    variants: [
      { v: 'classic', p: { d: 0.26, depth: 0.045, hl: 0.2 }, desc: 'classic black frying pan' },
      { v: 'skillet', p: { d: 0.3, depth: 0.055, hl: 0.17 }, desc: 'heavy cast iron skillet', noun: 'Skillet' },
      { v: 'crepe', p: { d: 0.28, depth: 0.02, hl: 0.22 }, desc: 'flat thin crepe pan', noun: 'Crepe Pan' },
      { v: 'deep', p: { d: 0.24, depth: 0.08, hl: 0.2 }, desc: 'deep saute pan', noun: 'Saute Pan' },
    ],
    draw(k, p) {
      const R = p.d / 2;
      const zc = -R - 0.005;
      const y0 = -p.depth / 2;
      k.lathe(
        'main',
        [
          [0, 0],
          [R * 0.82, 0],
          [R, p.depth],
          [R * 0.95, p.depth],
          [R * 0.78, 0.008],
          [0, 0.008],
        ],
        12,
        { p: [0, y0, zc] },
      );
      const hy = p.depth * 0.3;
      k.rod('main', [0, p.depth * 0.35, -0.012], [0, hy, 0.02], 0.009, 0.008, 6);
      k.box('accent', [0.026, 0.016, p.hl], { p: [0, hy, p.hl / 2 + 0.005] });
      k.torus('metal', 0.008, 0.0025, { p: [0, hy, p.hl - 0.01], r: [Math.PI / 2, 0, 0] }, 3, 8);
    },
    head(k, p) {
      const R = p.d / 2;
      k.lathe(
        'main',
        [
          [0, 0],
          [R * 0.82, 0],
          [R, p.depth],
          [R * 0.95, p.depth],
          [R * 0.78, 0.008],
          [0, 0.008],
        ],
        12,
        { p: [0, -p.depth / 2, -R] },
      );
      k.zrod('metal', -0.02, 0.01, 0.012, 0.012, 6);
    },
    anchors(p) {
      const R = p.d / 2;
      const zc = -R - 0.005;
      const hy = p.depth * 0.3;
      return {
        tip: [0, p.depth / 2, zc - R],
        rear: [0, hy, p.hl + 0.005],
        top: [0, -p.depth / 2 + 0.008, zc],
        grip: [0, hy - 0.008, p.hl * 0.45],
        under: [0, -p.depth / 2, zc],
        side: [R, p.depth / 2, zc],
      };
    },
    roles: ['head', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['shotgun', 'grenade_launcher', 'flamethrower'],
  },

  {
    kind: 'pot',
    group: 'kitchen',
    noun: 'Pot',
    syn: ['pot', 'stockpot', 'cauldron', 'cooking pot', 'saucepan', 'dutch oven', 'casserole', 'cookware'],
    tags: ['kitchen', 'metal', 'heavy', 'silly'],
    desc: 'big metal cooking pot',
    color: '#9aa1ab',
    accent: '#2d2f36',
    variants: [
      { v: 'stock', p: { R: 0.12, H: 0.24, lid: 1, belly: 0, stick: 0 }, desc: 'tall lidded soup stockpot', noun: 'Stockpot' },
      { v: 'dutch', p: { R: 0.14, H: 0.13, lid: 1, belly: 0, stick: 0 }, desc: 'heavy wide dutch oven', noun: 'Dutch Oven' },
      { v: 'cauldron', p: { R: 0.15, H: 0.2, lid: 0, belly: 1, stick: 0 }, desc: 'round bellied witch cauldron', noun: 'Cauldron' },
      { v: 'sauce', p: { R: 0.085, H: 0.1, lid: 0, belly: 0, stick: 0.18 }, desc: 'saucepan with long handle', noun: 'Saucepan' },
    ],
    draw(k, p) {
      const g = potGeo(p);
      potBody(k, p, g.zc);
      if (p.stick > 0) {
        k.rod('main', [0, g.hy, g.zc + p.R - 0.004], [0, g.hy, 0.012], 0.008, 0.008, 6);
        k.box('accent', [0.024, 0.016, p.stick], { p: [0, g.hy, p.stick / 2] });
      } else {
        k.torus('accent', 0.028, 0.006, { p: [0, g.hy, g.zc + g.Rh], r: [PI / 2, 0, 0] }, 4, 6, PI);
        k.torus('accent', 0.028, 0.006, { p: [0, g.hy, g.zc - g.Rh], r: [-PI / 2, 0, 0] }, 4, 6, PI);
      }
    },
    head(k, p) {
      const Rh = p.belly ? p.R * 0.9 : p.R;
      potBody(k, p, -(Rh + 0.03));
      ferrule(k);
    },
    anchors(p) {
      const g = potGeo(p);
      const { R, H } = p;
      const loop = !(p.stick > 0);
      return {
        tip: loop ? [0, g.hy, g.zc - g.Rh - 0.034] : [0, 0, g.zc - R],
        rear: loop ? [0, g.hy, 0.006] : [0, g.hy, p.stick],
        top: p.lid ? [0, H / 2 + 0.045, g.zc] : [0, g.y0 + 0.012, g.zc],
        grip: loop ? [0, g.hy - 0.006, 0] : [0, g.hy - 0.008, p.stick * 0.45],
        under: [0, g.y0, g.zc],
        side: [R, p.belly ? -H * 0.08 : 0, g.zc],
        mag: [0, g.y0, g.zc + R * 0.3],
      };
    },
    roles: ['head', 'muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
    guns: ['grenade_launcher', 'shotgun', 'flamethrower'],
    fireMode: 'arc',
    ammo: 'boiling soup',
  },

  {
    kind: 'ladle',
    group: 'kitchen',
    noun: 'Ladle',
    syn: ['ladle', 'soup ladle', 'scoop', 'dipper', 'serving spoon', 'utensil'],
    tags: ['kitchen', 'metal', 'silly', 'light'],
    desc: 'deep soup ladle',
    color: '#b8bec7',
    accent: '#2d2f36',
    variants: [
      { v: 'soup', p: { L: 0.24, br: 0.045, spout: 0, hl: 0.11 } },
      { v: 'gravy', p: { L: 0.18, br: 0.032, spout: 1, hl: 0.1 }, desc: 'small gravy ladle with spout' },
      { v: 'giant', p: { L: 0.38, br: 0.08, spout: 0, hl: 0.14 }, desc: 'giant cauldron stirring ladle' },
    ],
    draw(k, p) {
      ladleBowl(k, p, 0.01);
      toolGrip(k, p.hl);
    },
    head(k, p) {
      ladleBowl(k, p, -0.02);
      ferrule(k);
    },
    anchors(p) {
      const yb = -p.br * 0.6;
      const zb = -p.L - p.br;
      const end: Vec3 = [0, yb + 0.003, zb + p.br * 0.93];
      return {
        tip: p.spout ? [0, yb - 0.001, zb - p.br - 0.012] : [0, yb, zb - p.br],
        rear: [0, 0, p.hl + 0.0185],
        top: [0, 0.0115, p.hl * 0.5],
        grip: [0, -0.0115, 0.04],
        under: [0, yb - p.br, zb],
        side: [p.br, yb, zb],
        mag: shaftMid(end, 0.01, 0.005),
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['grenade_launcher'],
    fireMode: 'arc',
    ammo: 'hot soup',
  },

  {
    kind: 'spatula',
    group: 'kitchen',
    noun: 'Spatula',
    syn: ['spatula', 'turner', 'flipper', 'fish slice', 'pancake turner', 'utensil'],
    tags: ['kitchen', 'metal', 'silly', 'light'],
    desc: 'slotted kitchen spatula',
    color: '#c3c8cf',
    accent: '#2d2f36',
    variants: [
      { v: 'turner', p: { bw: 0.08, bl: 0.1, L: 0.14, slots: 3, hl: 0.12, ang: 0 } },
      { v: 'fish', p: { bw: 0.065, bl: 0.14, L: 0.13, slots: 5, hl: 0.12, ang: 1 }, desc: 'angled slotted fish slice', noun: 'Fish Slice' },
      { v: 'flipper', p: { bw: 0.13, bl: 0.12, L: 0.16, slots: 0, hl: 0.13, ang: 0 }, desc: 'wide solid pancake flipper' },
      { v: 'grill', p: { bw: 0.1, bl: 0.11, L: 0.3, slots: 2, hl: 0.15, ang: 1 }, desc: 'long barbecue grill spatula' },
    ],
    draw(k, p) {
      spatHead(k, p, 0.01);
      toolGrip(k, p.hl);
    },
    head(k, p) {
      spatHead(k, p, -0.02);
      ferrule(k);
    },
    anchors(p) {
      const yb = -0.012;
      const zf = -p.L - p.bl;
      const s = (p.bw * 0.6) / Math.max(p.slots, 1);
      const tx = p.slots % 2 === 1 ? s / 2 : 0;
      return {
        tip: [0, yb, zf + (p.ang ? p.bl * 0.09 : 0)],
        rear: [0, 0, p.hl + 0.0185],
        top: [tx, yb + 0.0015, -p.L - p.bl * 0.55],
        grip: [0, -0.0115, 0.04],
        under: [tx, yb - 0.0015, -p.L - p.bl * 0.55],
        side: [p.bw / 2, yb, -p.L - p.bl * 0.7],
        mag: shaftMid([0, yb, -p.L + 0.006], 0.01, 0.0045),
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },

  {
    kind: 'chef-knife',
    group: 'kitchen',
    noun: "Chef's Knife",
    syn: ['knife', 'chef knife', 'kitchen knife', 'cooks knife', 'santoku', 'bread knife', 'blade'],
    tags: ['kitchen', 'metal'],
    desc: 'sharp kitchen chef knife',
    color: '#9aa1ab',
    accent: '#2a2420',
    variants: [
      { v: 'chef', p: { L: 0.21, h: 0.047, style: 0, hl: 0.12 } },
      { v: 'santoku', p: { L: 0.17, h: 0.05, style: 1, hl: 0.12 }, desc: 'japanese santoku knife', noun: 'Santoku' },
      { v: 'bread', p: { L: 0.23, h: 0.032, style: 2, hl: 0.12 }, desc: 'long serrated bread knife', noun: 'Bread Knife' },
    ],
    draw(k, p) {
      k.blade('metal', knifeBlade(p), 0.0035, 'zy');
      k.box('metal', [0.009, 0.026, 0.012], { p: [0, -0.001, 0] });
      knifeHandle(k, p.hl);
    },
    anchors(p) {
      return {
        tip: [0, knifeTipY(p), -p.L],
        rear: [0, -0.004, p.hl + 0.008],
        top: [0, KS, -p.L * 0.4],
        grip: [0, -0.0135, p.hl * 0.45],
        under: [0, KS - p.h, -p.L * 0.3],
        side: [0.0018, KS - p.h * 0.5, -p.L * 0.3],
        mag: [0, KS - p.h, -0.03],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
  },

  {
    kind: 'cleaver',
    group: 'kitchen',
    noun: 'Meat Cleaver',
    syn: ['cleaver', 'meat cleaver', 'butcher knife', 'chopper', 'hatchet', 'blade'],
    tags: ['kitchen', 'metal', 'heavy'],
    desc: 'big rectangular meat cleaver',
    color: '#9aa1ab',
    accent: '#3a2618',
    variants: [
      { v: 'butcher', p: { L: 0.19, h: 0.095, hole: 1, thick: 0.006, round: 0, hl: 0.12 }, desc: 'butcher cleaver with hanging hole' },
      { v: 'chinese', p: { L: 0.2, h: 0.1, hole: 0, thick: 0.0035, round: 1, hl: 0.12 }, desc: 'thin chinese vegetable cleaver', noun: 'Chinese Cleaver' },
      { v: 'bone', p: { L: 0.16, h: 0.085, hole: 1, thick: 0.009, round: 1, hl: 0.1 }, desc: 'heavy bone chopping cleaver' },
    ],
    draw(k, p) {
      cleaverBlade(k, p);
      k.zrod('metal', -0.004, 0.012, 0.009, 0.009, 6);
      if (p.round) {
        k.zrod('accent', 0.008, p.hl, 0.012, 0.014, 6);
        k.zrod('metal', p.hl - 0.004, p.hl + 0.002, 0.0145, 0.0145, 6);
      } else knifeHandle(k, p.hl);
    },
    anchors(p) {
      return {
        tip: [0, CS - p.h * 0.5, -p.L],
        rear: p.round ? [0, 0, p.hl + 0.002] : [0, -0.004, p.hl + 0.008],
        top: [0, CS, -p.L * 0.5],
        grip: [0, -0.013, p.hl * 0.45],
        under: [0, CS - p.h, -p.L * 0.5],
        side: [p.thick / 2, CS - p.h * 0.45, -p.L * 0.5],
        mag: [0, CS - p.h, -0.04],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
  },

  {
    kind: 'rolling-pin',
    group: 'kitchen',
    noun: 'Rolling Pin',
    syn: ['rolling pin', 'pin', 'dough roller', 'baking', 'club', 'bat'],
    tags: ['kitchen', 'wood', 'silly'],
    desc: 'wooden rolling pin',
    color: '#c9935a',
    accent: '#8a5a32',
    variants: [
      { v: 'classic', p: { bl: 0.26, r: 0.03, hl: 0.09, ridges: 0 }, desc: 'classic rolling pin with handles' },
      { v: 'french', p: { L: 0.48, r: 0.027, hl: 0, ridges: 0 }, desc: 'tapered french rolling pin' },
      { v: 'embossed', p: { bl: 0.22, r: 0.028, hl: 0.08, ridges: 7 }, desc: 'ridged embossing pastry pin' },
    ],
    draw(k, p) {
      if (p.hl > 0) {
        const { bl, r, hl } = p;
        if (p.ridges) {
          const n = p.ridges;
          const pts: Pt[] = [[0, -bl]];
          for (let i = 0; i <= 2 * n; i++) pts.push([i % 2 ? r * 0.85 : r, -bl + (i * bl) / (2 * n)]);
          pts.push([0, 0]);
          k.zlathe('main', pts, 8);
        } else k.zrod('main', -bl, 0, r, r, 10);
        k.zrod('accent', 0, hl, 0.012, 0.014, 6);
        k.ball('accent', 0.016, [0, 0, hl], 0);
        k.zrod('accent', -bl - hl, -bl, 0.014, 0.012, 6);
        k.ball('accent', 0.016, [0, 0, -bl - hl], 0);
      } else {
        const z0 = -p.L * 0.8;
        const z1 = p.L * 0.2;
        k.zlathe(
          'main',
          [
            [0, z0],
            [p.r * 0.55, z0 + 0.003],
            [p.r, z0 + p.L * 0.5],
            [p.r * 0.55, z1 - 0.003],
            [0, z1],
          ],
          10,
        );
      }
    },
    anchors(p): Anchors {
      if (p.hl > 0) {
        const zt = pinTopZ(p);
        return {
          tip: [0, 0, -p.bl - p.hl - 0.016],
          rear: [0, 0, p.hl + 0.016],
          top: [0, p.r, zt],
          grip: [0, -0.013, p.hl * 0.4],
          under: [0, -p.r, zt],
          side: [p.r, 0, zt],
          mag: [0, -p.r, zt],
        };
      }
      const z0 = -p.L * 0.8;
      return {
        tip: [0, 0, z0],
        rear: [0, 0, p.L * 0.2],
        top: [0, p.r, z0 + p.L * 0.5],
        grip: [0, -p.r * 0.73, 0],
        under: [0, -p.r, z0 + p.L * 0.5],
        side: [p.r, 0, z0 + p.L * 0.5],
        mag: [0, -p.r * 0.865, -p.L * 0.15],
      };
    },
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  {
    kind: 'whisk',
    group: 'kitchen',
    noun: 'Whisk',
    syn: ['whisk', 'balloon whisk', 'egg beater', 'whip', 'baking', 'utensil'],
    tags: ['kitchen', 'metal', 'light', 'silly'],
    desc: 'wire balloon whisk',
    color: '#c3c8cf',
    accent: '#d24b3a',
    variants: [
      { v: 'balloon', p: { WL: 0.2, rho: 0.045, hl: 0.13 } },
      { v: 'french', p: { WL: 0.24, rho: 0.028, hl: 0.13 }, desc: 'narrow french sauce whisk' },
      { v: 'giant', p: { WL: 0.34, rho: 0.075, hl: 0.16 }, desc: 'giant bakery balloon whisk' },
    ],
    draw(k, p) {
      whiskWires(k, p);
      k.zrod('metal', -0.02, 0.012, 0.01, 0.01, 6);
      k.zrod('accent', 0.01, p.hl, 0.012, 0.013, 6);
      k.torus('metal', 0.01, 0.002, { p: [0, 0, p.hl + 0.009], r: [0, PI / 2, 0] }, 3, 8);
    },
    head(k, p) {
      whiskWires(k, p);
      ferrule(k);
    },
    anchors(p) {
      const z = -0.78 * p.WL;
      return {
        tip: [0, 0, -p.WL],
        rear: [0, 0, p.hl + 0.021],
        top: [0, p.rho, z],
        grip: [0, -0.012, 0.05],
        under: [0, -p.rho, z],
        side: [0.866 * p.rho, 0.5 * p.rho, z],
        mag: [0, -0.01, -0.005],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['bubble_gun'],
    fireMode: 'stream',
    ammo: 'whipped cream',
  },

  {
    kind: 'kettle',
    group: 'kitchen',
    noun: 'Kettle',
    syn: ['kettle', 'tea kettle', 'whistling kettle', 'stovetop kettle', 'gooseneck', 'boiler'],
    tags: ['kitchen', 'metal', 'retro', 'silly'],
    desc: 'stovetop kettle with top handle',
    color: '#c94a3a',
    accent: '#2d2f36',
    variants: [
      { v: 'whistle', p: { R: 0.1, H: 0.15, sh: 0.7, spoutL: 0.1, goose: 0, whistle: 1, hgap: 0.06 }, desc: 'whistling stovetop tea kettle' },
      { v: 'enamel', p: { R: 0.12, H: 0.12, sh: 0.8, spoutL: 0.07, goose: 0, whistle: 0, hgap: 0.05 }, desc: 'squat retro enamel kettle' },
      { v: 'gooseneck', p: { R: 0.085, H: 0.15, sh: 0.55, spoutL: 0.13, goose: 1, whistle: 0, hgap: 0.05 }, desc: 'pour-over gooseneck kettle', noun: 'Gooseneck Kettle' },
    ],
    draw(k, p) {
      const g = kettleGeo(p);
      const { R, H } = p;
      k.lathe(
        'main',
        [
          [0, g.y0],
          [R, g.y0],
          [R, g.y0 + H * 0.45],
          [g.sR, g.y0 + H * 0.85],
          [R * 0.3, g.y0 + H],
          [0, g.y0 + H],
        ],
        12,
      );
      k.ball('accent', 0.013, [0, g.y0 + H + 0.006, 0], 0);
      k.tube(
        'accent',
        [
          [0, g.y0 + H * 0.82, g.sR * 0.85],
          [0, -0.022, g.sR * 0.6],
          [0, 0, 0],
          [0, -0.022, -g.sR * 0.6],
          [0, g.y0 + H * 0.82, -g.sR * 0.85],
        ],
        0.009,
        14,
        5,
      );
      if (p.goose) k.tube('main', g.goose, 0.006, 10, 5);
      else {
        k.rod('main', g.a, g.b, 0.02, 0.009, 6);
        if (p.whistle) k.rod('accent', g.b, g.c, 0.012, 0.012, 6);
      }
    },
    anchors(p) {
      const g = kettleGeo(p);
      return {
        tip: g.tip,
        rear: [0, g.y0 + p.H * 0.25, p.R],
        top: [0, 0.009, 0],
        grip: [0, -0.009, 0],
        under: [0, g.y0, -p.R * 0.5],
        side: [p.R, g.y0 + p.H * 0.25, 0],
        mag: [0, g.y0, 0],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['flamethrower', 'shotgun', 'grenade_launcher'],
    fireMode: 'stream',
    ammo: 'boiling water',
    selfGrip: true,
  },

  {
    kind: 'teapot',
    group: 'kitchen',
    noun: 'Teapot',
    syn: ['teapot', 'tea pot', 'tea', 'brown betty', 'moroccan teapot', 'pot'],
    tags: ['kitchen', 'retro', 'silly', 'ornate'],
    desc: 'round ceramic teapot',
    color: '#e8e2d4',
    accent: '#3d7cc9',
    variants: [
      { v: 'round', p: { R: 0.085, H: 0.13, spoutL: 0.09, hw: 0.045, knob: 0 } },
      { v: 'moroccan', p: { R: 0.065, H: 0.16, spoutL: 0.14, hw: 0.04, knob: 1 }, desc: 'tall moroccan teapot with finial' },
      { v: 'squat', p: { R: 0.1, H: 0.095, spoutL: 0.06, hw: 0.045, knob: 0 }, desc: 'squat brown betty teapot' },
    ],
    draw(k, p) {
      const g = teaGeo(p);
      const { R, H } = p;
      const yb = g.yb;
      k.lathe(
        'main',
        [
          [0, yb],
          [R * 0.6, yb],
          [R, yb + H * 0.4],
          [R * 0.88, yb + H * 0.72],
          [R * 0.45, yb + H * 0.92],
          [0, yb + H * 0.95],
        ],
        10,
        { p: [0, 0, g.zc] },
      );
      if (p.knob) {
        k.rod('accent', [0, yb + H * 0.92, g.zc], [0, g.knobTop - 0.012, g.zc], 0.012, 0.004, 6);
        k.ball('accent', 0.012, [0, g.knobTop - 0.012, g.zc], 0);
      } else k.ball('accent', 0.012, [0, yb + H * 0.95 + 0.01, g.zc], 0);
      k.tube(
        'main',
        [
          [0, yb + H * 0.72, g.zc + R * 0.85],
          [0, yb + H * 0.72, -0.012],
          [0, 0, 0],
          [0, yb + H * 0.25, -0.012],
          [0, yb + H * 0.25, g.zc + R * 0.9],
        ],
        0.008,
        12,
        4,
      );
      k.rod('main', g.a, g.b, 0.018, 0.007, 6);
      k.torus('accent', R * 0.97, 0.004, { p: [0, yb + H * 0.4, g.zc], r: [PI / 2, 0, 0] }, 3, 10);
    },
    anchors(p) {
      const g = teaGeo(p);
      return {
        tip: g.b,
        rear: [0, 0, 0.008],
        top: [0, g.knobTop, g.zc],
        grip: [0, g.yb + p.H * 0.25 - 0.008, -0.012],
        under: [0, g.yb, g.zc],
        side: [p.R, g.yb + p.H * 0.4, g.zc],
        mag: [0, g.yb, g.zc + p.R * 0.4],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['flamethrower', 'grenade_launcher'],
    fireMode: 'stream',
    ammo: 'hot tea',
    selfGrip: true,
  },

  {
    kind: 'toaster',
    group: 'kitchen',
    noun: 'Toaster',
    syn: ['toaster', 'toast', 'bread toaster', 'appliance', 'pop-up toaster'],
    tags: ['kitchen', 'metal', 'retro', 'silly', 'heavy'],
    desc: 'pop-up toaster with toast',
    color: '#c9ced6',
    accent: '#d9a25a',
    variants: [
      { v: 'classic', p: { L: 0.26, W: 0.15, H: 0.18, slots: 2, c: 0.02, retro: 0 } },
      { v: 'family', p: { L: 0.28, W: 0.27, H: 0.19, slots: 4, c: 0.02, retro: 0 }, desc: 'wide four-slice family toaster' },
      { v: 'retro', p: { L: 0.24, W: 0.16, H: 0.2, slots: 2, c: 0.05, retro: 1 }, desc: 'rounded chrome fifties diner toaster' },
      { v: 'longslot', p: { L: 0.38, W: 0.12, H: 0.17, slots: 1, c: 0.02, retro: 0 }, desc: 'long-slot artisan bread toaster' },
    ],
    draw(k, p) {
      const { L, W, H } = p;
      const zc = 0.04 - L / 2;
      k.extrude('main', chamferRect(-W / 2, -H / 2, W / 2, H / 2, p.c), L, 'xy', { p: [0, 0, zc] });
      const tw = p.slots === 1 ? L * 0.75 : L * 0.62;
      const th = 0.1;
      const toast: Pt[] = [
        [-tw / 2, 0],
        [tw / 2, 0],
        [tw / 2, th * 0.82],
        [tw * 0.36, th],
        [tw * 0.12, th * 0.93],
        [-tw * 0.12, th * 0.93],
        [-tw * 0.36, th],
        [-tw / 2, th * 0.82],
      ];
      for (const x of toastXs(p)) {
        k.box('dark', [0.016, 0.004, tw + 0.02], { p: [x, H / 2 + 0.0005, zc] });
        k.extrude('accent', toast, 0.011, 'zy', { p: [x, H / 2 + 0.035 - th, zc] });
      }
      k.box('dark', [0.014, 0.012, 0.032], { p: [W / 2 + 0.007, H * 0.1, zc - L * 0.36] });
      k.rod('dark', [W / 2 - 0.002, -H * 0.22, zc - L * 0.36], [W / 2 + 0.01, -H * 0.22, zc - L * 0.36], 0.012, 0.012, 8);
      if (p.retro) {
        k.box('metal', [W + 0.004, 0.01, L + 0.004], { p: [0, -H * 0.32, zc] });
        k.box('metal', [W + 0.004, 0.006, L + 0.004], { p: [0, H * 0.28, zc] });
      }
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) k.box('dark', [0.02, 0.008, 0.02], { p: [sx * (W / 2 - 0.022), -H / 2 - 0.004, zc + sz * (L / 2 - 0.025)] });
    },
    anchors(p) {
      const zc = 0.04 - p.L / 2;
      return {
        tip: [0, 0, zc - p.L / 2],
        rear: [0, 0, zc + p.L / 2],
        top: [0, p.H / 2, zc + p.L * 0.44],
        grip: [0, -p.H / 2, 0],
        under: [0, -p.H / 2, zc - p.L * 0.2],
        side: [p.W / 2, -p.H * 0.12, zc],
        mag: [0, -p.H / 2, zc],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
    guns: ['grenade_launcher', 'shotgun'],
    fireMode: 'projectile',
    ammo: 'toast',
  },

  {
    kind: 'blender',
    group: 'kitchen',
    noun: 'Blender',
    syn: ['blender', 'mixer', 'smoothie maker', 'liquidiser', 'food processor', 'appliance'],
    tags: ['kitchen', 'plastic', 'silly', 'retro'],
    desc: 'countertop blender full of smoothie',
    color: '#e5e7ea',
    accent: '#e0567a',
    variants: [
      { v: 'classic', p: { Rb: 0.045, Rt: 0.065, JL: 0.2, seg: 8, BL: 0.1, Bs: 0.07 } },
      { v: 'pro', p: { Rb: 0.055, Rt: 0.075, JL: 0.25, seg: 4, BL: 0.13, Bs: 0.085 }, desc: 'square pro kitchen blender' },
      { v: 'mini', p: { Rb: 0.035, Rt: 0.04, JL: 0.14, seg: 6, BL: 0.08, Bs: 0.05 }, desc: 'single-serve smoothie blender' },
    ],
    draw(k, p) {
      const g = blendGeo(p);
      const rot: Vec3 = [PI / 2, p.seg === 4 ? PI / 4 : 0, 0];
      k.lathe(
        'accent',
        [
          [0, -p.JL],
          [p.Rt, -p.JL],
          [p.Rb, 0.02],
          [0, 0.02],
        ],
        p.seg,
        { p: [0, g.yA, 0], r: rot },
      );
      k.lathe(
        'dark',
        [
          [0, -p.JL - 0.014],
          [p.Rt * 0.9, -p.JL - 0.014],
          [p.Rt * 1.04, -p.JL + 0.004],
          [0, -p.JL + 0.004],
        ],
        p.seg,
        { p: [0, g.yA, 0], r: rot },
      );
      k.zrod('dark', -p.JL - 0.03, -p.JL - 0.012, 0.016, 0.018, 8, 0, g.yA);
      const zb = 0.02 + p.BL / 2;
      k.extrude('main', chamferRect(-p.Bs, g.yA - p.Bs, p.Bs, g.yA + p.Bs * 1.05, 0.014), p.BL, 'xy', { p: [0, 0, zb] });
      k.rod('white', [p.Bs - 0.002, g.yA, zb], [p.Bs + 0.01, g.yA, zb], 0.016, 0.014, 8);
      k.box('dark', [0.004, 0.012, p.BL * 0.6], { p: [p.Bs, g.yA - p.Bs * 0.6, zb] });
      k.box('dark', [0.026, 0.1, 0.032], { p: [0, -0.045, -0.025], r: [-0.25, 0, 0] });
    },
    anchors(p) {
      const g = blendGeo(p);
      return {
        tip: [0, g.yA, -p.JL - 0.03],
        rear: [0, g.yA, 0.02 + p.BL],
        top: [0, g.yA + g.fy * g.rm, g.zm],
        grip: [0, 0, -0.025],
        under: [0, g.yA - g.fy * g.rm, g.zm],
        side: [g.fx * g.rm, g.yA, g.zm],
        mag: [0, -0.093, -0.013],
      };
    },
    roles: ['deco'],
    selfGrip: true,
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['smg', 'lmg', 'bubble_gun'],
    fireMode: 'stream',
    ammo: 'smoothie',
  },

  {
    kind: 'mug',
    group: 'kitchen',
    noun: 'Mug',
    syn: ['mug', 'cup', 'coffee mug', 'tea cup', 'beer stein', 'tankard', 'espresso'],
    tags: ['kitchen', 'silly', 'light'],
    desc: 'coffee mug full of coffee',
    color: '#f2efe8',
    accent: '#4a2c1a',
    variants: [
      { v: 'coffee', p: { R: 0.042, H: 0.095, t: 0.006, hw: 0.03, hr: 0.007, style: 0 } },
      { v: 'stein', p: { R: 0.052, H: 0.15, t: 0.008, hw: 0.04, hr: 0.011, style: 1 }, desc: 'foamy beer stein with bands', noun: 'Beer Stein' },
      { v: 'espresso', p: { R: 0.028, H: 0.05, t: 0.004, hw: 0.02, hr: 0.005, style: 2 }, desc: 'tiny espresso cup on saucer', noun: 'Espresso Cup' },
    ],
    draw(k, p) {
      const { R, H, t, hw } = p;
      const zc = -(R + hw);
      const y0 = -H / 2;
      k.lathe(
        'main',
        [
          [0, y0],
          [R, y0],
          [R, y0 + H],
          [R - t, y0 + H],
          [R - t, y0 + 0.01],
          [0, y0 + 0.01],
        ],
        12,
        { p: [0, 0, zc] },
      );
      k.rod('accent', [0, y0 + 0.008, zc], [0, H / 2 - 0.012, zc], R - t * 0.5, R - t * 0.5, 12);
      k.tube(
        'main',
        [
          [0, y0 + H * 0.8, zc + R - 0.003],
          [0, y0 + H * 0.78, zc + R + hw * 0.8],
          [0, 0, 0],
          [0, y0 + H * 0.22, zc + R + hw * 0.8],
          [0, y0 + H * 0.2, zc + R - 0.003],
        ],
        p.hr,
        10,
        4,
      );
      if (p.style === 1) {
        k.ball('white', R * 0.95, [0, H / 2, zc], 1, [1, 0.45, 1]);
        for (const y of [-H * 0.32, H * 0.32]) k.torus('metal', R + 0.001, 0.004, { p: [0, y, zc], r: [PI / 2, 0, 0] }, 3, 12);
      } else if (p.style === 2) {
        k.lathe(
          'main',
          [
            [0, y0 - 0.006],
            [R * 2, y0 - 0.003],
            [R * 2.1, y0 + 0.004],
            [R * 1.95, y0 + 0.003],
            [0, y0],
          ],
          12,
          { p: [0, 0, zc] },
        );
      }
    },
    anchors(p): Anchors {
      const { R, H, hw } = p;
      const zc = -(R + hw);
      const y0 = -H / 2;
      const saucer = p.style === 2;
      return {
        tip: saucer ? [0, y0 + 0.004, zc - R * 2.1] : [0, 0, zc - R],
        rear: saucer ? [0, y0 + 0.004, zc + R * 2.1] : [0, 0, p.hr],
        top: p.style === 1 ? [0, H / 2 + R * 0.95 * 0.45, zc] : [0, H / 2 - 0.012, zc],
        grip: [0, y0 + H * 0.22, zc + R + hw * 0.8],
        under: saucer ? [0, y0 - 0.006, zc] : [0, y0, zc],
        side: [R, 0, zc],
        mag: saucer ? [0, y0 - 0.005, zc + R * 0.5] : [0, y0, zc + R * 0.5],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },

  {
    kind: 'bottle',
    group: 'kitchen',
    noun: 'Bottle',
    syn: ['bottle', 'wine bottle', 'champagne', 'soda bottle', 'pop bottle', 'beer bottle', 'glass bottle'],
    tags: ['kitchen', 'glass', 'party', 'silly'],
    desc: 'glass wine bottle',
    color: '#2f5a34',
    accent: '#7a1f2a',
    variants: [
      { v: 'wine', p: { R: 0.037, L: 0.3, NL: 0.085, nr: 0.0135, sh: 0.05, style: 0 }, noun: 'Wine Bottle' },
      { v: 'champagne', p: { R: 0.044, L: 0.31, NL: 0.09, nr: 0.015, sh: 0.07, style: 1 }, desc: 'corked champagne bottle with foil', noun: 'Champagne Bottle' },
      { v: 'soda', p: { R: 0.05, L: 0.33, NL: 0.03, nr: 0.013, sh: 0.06, style: 2 }, desc: 'two litre fizzy soda bottle', noun: 'Soda Bottle' },
      { v: 'beer', p: { R: 0.031, L: 0.23, NL: 0.06, nr: 0.012, sh: 0.045, style: 3 }, desc: 'brown beer bottle with cap', noun: 'Beer Bottle' },
    ],
    draw(k, p) {
      const g = bottleGeo(p);
      const { R, nr } = p;
      const { z0, zn, zs, zb, zm } = g;
      const pts: Pt[] =
        p.style === 2
          ? [
              [0, z0],
              [nr * 1.2, z0],
              [nr * 1.2, z0 + 0.008],
              [nr, z0 + 0.012],
              [nr * 1.6, z0 + 0.016],
              [nr * 1.6, z0 + 0.019],
              [nr, z0 + 0.021],
              [nr, zn],
              [R, zs],
              [R, zm - 0.025],
              [R * 0.86, zm],
              [R, zm + 0.025],
              [R, zb - 0.02],
              [R * 0.82, zb],
              [0, zb],
            ]
          : [
              [0, z0],
              [nr * 1.25, z0],
              [nr * 1.25, z0 + 0.012],
              [nr, z0 + 0.014],
              [nr, zn],
              [R, zs],
              [R, zb - 0.006],
              [R * 0.9, zb],
              [0, zb],
            ];
      k.zlathe('main', pts, p.style === 2 ? 8 : 10);
      const labelSlot: Slot = p.style === 2 ? 'accent' : p.style === 1 ? 'brass' : 'white';
      k.zrod(labelSlot, g.zl0, g.zl1, R * 1.012, R * 1.012, 10);
      if (p.style === 0) k.zrod('accent', z0 - 0.002, z0 + p.NL * 0.5, nr * 1.32, nr * 1.08, 10);
      else if (p.style === 1) {
        k.zrod('brass', z0 + 0.001, zn + 0.012, nr * 1.32, nr * 1.25, 10);
        k.zrod('#d8b27a', z0 - 0.022, z0 + 0.002, nr * 1.25, nr * 0.95, 8);
      } else if (p.style === 2) k.zrod('accent', z0 - 0.004, z0 + 0.012, nr * 1.35, nr * 1.35, 10);
      else k.zrod('metal', z0 - 0.003, z0 + 0.007, nr * 1.35, nr * 1.35, 10);
    },
    anchors(p) {
      const g = bottleGeo(p);
      const zl = (g.zl0 + g.zl1) / 2;
      return {
        tip: [0, 0, g.tipZ],
        rear: [0, 0, g.zb],
        top: [0, p.R * 1.012, zl],
        grip: [0, -p.R, 0],
        under: [0, -p.R, g.zs + 0.015],
        side: [p.R * 1.012, 0, zl],
        mag: [0, -p.R, g.zs / 2],
      };
    },
    roles: ['barrel', 'mag', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['bubble_gun', 'rocket_launcher', 'shotgun'],
    fireMode: 'stream',
    ammo: 'fizzy soda',
  },

  {
    kind: 'giant-fork',
    group: 'kitchen',
    noun: 'Giant Fork',
    syn: ['fork', 'giant fork', 'carving fork', 'barbecue fork', 'trident', 'cutlery', 'utensil'],
    tags: ['kitchen', 'metal', 'silly'],
    desc: 'comically giant dinner fork',
    color: '#2d2f36',
    accent: '#8a5a32',
    variants: [
      { v: 'dinner', p: { L: 0.28, hl: 0.2, hw: 0.09, tl: 0.12, n: 4, carving: 0 } },
      { v: 'carving', p: { L: 0.12, hl: 0.13, hw: 0.035, tl: 0.13, n: 2, carving: 1 }, desc: 'two-pronged carving fork', noun: 'Carving Fork' },
      { v: 'bbq', p: { L: 0.3, hl: 0.15, hw: 0.05, tl: 0.09, n: 3, carving: 0 }, desc: 'long three-pronged barbecue fork', noun: 'BBQ Fork' },
    ],
    draw(k, p) {
      forkHead(k, p);
      const { ws, th } = forkGeo(p);
      if (p.carving) k.zrod('accent', 0, p.hl, 0.012, 0.014, 6);
      else
        k.extrude(
          'main',
          [
            [-0.009 * ws, 0],
            [0.009 * ws, 0],
            [0.015 * ws, p.hl * 0.8],
            [0.011 * ws, p.hl],
            [-0.011 * ws, p.hl],
            [-0.015 * ws, p.hl * 0.8],
          ],
          th * 1.4,
          'xz',
        );
    },
    head(k, p) {
      forkHead(k, p);
      ferrule(k);
    },
    anchors(p) {
      const { th, zt0, ws } = forkGeo(p);
      const hy = p.carving ? 0.012 : th * 0.7;
      return {
        tip: [0, 0, zt0 - p.tl],
        rear: [0, 0, p.hl],
        top: [0, hy, p.hl * 0.5],
        grip: [0, -hy, p.hl * 0.4],
        under: [0, -th / 2, -p.L - 0.012 * ws],
        side: [p.hw / 2, 0, zt0],
        mag: [0, -th / 2, -p.L * 0.5],
      };
    },
    roles: ['head', 'blade', 'deco'],
    melee: { swing: 'thrust', weight: 'medium' },
  },
];
