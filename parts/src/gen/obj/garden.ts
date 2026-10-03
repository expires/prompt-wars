/** GARDEN + TOOLS objects. See objkit.ts for the canonical frame + roles. */
import type { Kit, Pt, Slot } from '../../lib/kit';
import type { Vec3 } from '../../types';
import type { Anchors, ObjSpec, P } from './objkit';

const PI = Math.PI;
const HOSE = '#3f8f3a';

/* ---------------- shared helpers ---------------- */

/** Long wooden shaft from zA (head end) to zR (rear) with a D-grip (dg=1) or a capped grip sleeve. */
function shaft(k: Kit, zA: number, zR: number, rs: number, dg: number, sl: Slot = 'wood', gl: Slot = 'accent'): void {
  if (dg) {
    const zs = zR - 0.13;
    k.zrod(sl, zA - 0.01, zs, rs, rs, 8);
    k.rod(gl, [0, 0, zs - 0.02], [0.05, 0, zR - 0.016], 0.011, 0.011, 6);
    k.rod(gl, [0, 0, zs - 0.02], [-0.05, 0, zR - 0.016], 0.011, 0.011, 6);
    k.rod(gl, [-0.062, 0, zR - 0.016], [0.062, 0, zR - 0.016], 0.016, 0.016, 6);
  } else {
    k.zrod(sl, zA - 0.01, zR - 0.1, rs, rs, 8);
    k.zrod(gl, zR - 0.1, zR, rs * 1.18, rs * 1.18, 8);
  }
}

function shaftAnchors(tip: Vec3, zA: number, zR: number, rs: number, dg: number): Anchors {
  const zs = zR - (dg ? 0.13 : 0.1);
  const zm = (zA + zs) / 2;
  return {
    tip,
    rear: [0, 0, zR],
    top: [0, rs, zm],
    grip: [0, -rs, Math.min(-0.02, zs - 0.03)],
    under: [0, -rs, zA + 0.08],
    side: [rs, 0, zm],
  };
}

/** Linear radius of a tapered rod at z. */
const lerpR = (z: number, z0: number, z1: number, r0: number, r1: number) => r0 + ((z - z0) / (z1 - z0)) * (r1 - r0);

/* ---------------- shovel ---------------- */
function shovelHead(k: Kit, p: P, dz: number): void {
  const z0 = dz - p.bl - 0.12;
  const zt = z0 + p.bl;
  const h = p.bw / 2;
  const pts: Pt[] =
    p.pt < 0.01
      ? [
          [-h, zt],
          [h, zt],
          [h, z0],
          [-h, z0],
        ]
      : [
          [-h, zt],
          [h, zt],
          [h, z0 + p.pt],
          [h * 0.55, z0 + p.pt * 0.3],
          [0, z0],
          [-h * 0.55, z0 + p.pt * 0.3],
          [-h, z0 + p.pt],
        ];
  k.extrude('main', pts, 0.004, 'xz');
  k.box('main', [p.bw, 0.01, 0.014], { p: [0, 0.003, zt - 0.007] });
  if (p.sc > 0) {
    const len = p.bl - p.pt;
    for (const s of [-1, 1]) k.box('main', [0.004, p.sc, len], { p: [s * (h - 0.002), p.sc / 2, z0 + p.pt + len / 2] });
  }
  k.zrod('main', zt - 0.03, dz, 0.024, 0.019, 8);
}

/* ---------------- rake ---------------- */
function rakeHL(p: P): number {
  return p.t ? p.tl + 0.015 + 0.06 : 0.16;
}
function rakeHead(k: Kit, p: P, dz: number): void {
  const hl = rakeHL(p);
  if (!p.t) {
    const zb = dz - hl + 0.0125;
    k.box('metal', [p.w, 0.02, 0.025], { p: [0, 0, zb] });
    for (let i = 0; i < p.n; i++) {
      const x = -p.w / 2 + 0.01 + ((p.w - 0.02) * i) / (p.n - 1);
      k.box('metal', [0.006, p.tl, 0.006], { p: [x, -0.01 - p.tl / 2, zb] });
    }
    for (const s of [-1, 1])
      k.tube(
        'metal',
        [
          [s * p.w * 0.42, 0, zb],
          [s * p.w * 0.3, 0.05, zb + 0.06],
          [s * 0.02, 0.012, dz - 0.04],
        ],
        0.006,
        6,
        4,
      );
    k.zrod('accent', dz - 0.05, dz, 0.02, 0.02, 8);
  } else {
    const zc = dz - 0.06;
    const spread = Math.asin(Math.min(p.w / 2 / p.tl, 0.95));
    for (let i = 0; i < p.n; i++) {
      const a = -spread + (2 * spread * i) / (p.n - 1);
      const e: Vec3 = [Math.sin(a) * p.tl, 0, zc - Math.cos(a) * p.tl];
      k.rod('main', [0, 0, zc], e, 0.0035, 0.0035, 3);
      k.rod('main', e, [e[0], -0.03, e[2] - 0.015], 0.0035, 0.0035, 3);
    }
    const br: Vec3[] = [-1, -0.5, 0, 0.5, 1].map((f) => {
      const a = f * spread;
      return [Math.sin(a) * p.tl * 0.5, 0.004, zc - Math.cos(a) * p.tl * 0.5] as Vec3;
    });
    k.tube('accent', br, 0.005, 8, 4);
    k.zrod('accent', zc - 0.02, dz, 0.012, 0.02, 8);
  }
}

/* ---------------- garden fork ---------------- */
function forkTineX(p: P, i: number): number {
  return -p.w / 2 + (p.w * i) / (p.n - 1);
}
function forkHead(k: Kit, p: P, dz: number): void {
  const hl = p.tl + 0.08;
  k.box('metal', [p.w + 0.02, 0.018, 0.03], { p: [0, 0, dz - 0.065] });
  k.zrod('metal', dz - 0.06, dz, 0.012, 0.021, 8);
  k.box('metal', [0.01, 0.012, 0.08], { p: [0, 0.012, dz - 0.02] });
  for (let i = 0; i < p.n; i++) {
    const x = forkTineX(p, i);
    k.tube(
      'metal',
      [
        [x * 0.85, 0, dz - 0.07],
        [x * 0.95, p.cv * 0.3, dz - 0.08 - p.tl * 0.5],
        [x, p.cv, dz - hl],
      ],
      p.tr,
      6,
      4,
    );
  }
}

/* ---------------- hammers (claw/peen/mallet/sledge/maul) ---------------- */
/** Head centred at z = dz - hr; striking face toward +Y. */
function hammerHead(k: Kit, p: P, dz: number): void {
  const c = dz - p.hr;
  const hr = p.hr;
  if (p.t === 0 || p.t === 1) {
    k.box('metal', [0.026, 0.044, hr * 2], { p: [0, 0, c] });
    k.rod('metal', [0, 0.02, c], [0, 0.062, c], hr, hr, 8);
    k.rod('metal', [0, 0.056, c], [0, 0.068, c], hr * 1.12, hr * 1.05, 8);
    if (p.t === 0) {
      const cl: Pt[] = [
        [c - hr * 0.9, -0.018],
        [c + hr * 0.9, -0.018],
        [c + 0.03, -0.05],
        [c + 0.05, -0.08],
        [c + 0.04, -0.086],
        [c + 0.012, -0.056],
        [c - hr * 0.6, -0.034],
      ];
      for (const s of [-1, 1]) k.extrude('metal', cl, 0.0085, 'zy', { p: [s * 0.0058, 0, 0] });
    } else {
      k.rod('metal', [0, -0.02, c], [0, -0.04, c], hr * 0.75, hr * 0.75, 8);
      k.sphere('metal', hr * 1.15, { p: [0, -0.05, c] }, 8, 5);
    }
  } else if (p.t === 2) {
    k.rod('rubber', [0, -p.hw, c], [0, p.hw, c], hr, hr, 10);
    k.rod('white', [0, -p.hw - 0.004, c], [0, -p.hw, c], hr * 0.92, hr * 0.92, 10);
  } else if (p.t === 3) {
    k.rod('dark', [0, -p.hw + 0.012, c], [0, p.hw - 0.012, c], hr, hr, 8);
    for (const s of [-1, 1]) k.rod('dark', [0, s * (p.hw - 0.012), c], [0, s * p.hw, c], hr, hr * 0.82, 8);
  } else {
    k.rod('dark', [0, -0.02, c], [0, p.hw * 0.55, c], hr, hr, 8);
    k.rod('dark', [0, p.hw * 0.55, c], [0, p.hw * 0.62, c], hr, hr * 0.85, 8);
    k.extrude(
      'dark',
      [
        [-hr * 0.95, 0],
        [hr * 0.95, 0],
        [0, -p.hw],
      ],
      hr * 2,
      'xy',
      { p: [0, -0.015, c] },
    );
  }
}
function hammerDraw(k: Kit, p: P): void {
  const zR = p.zr;
  const dz = zR - p.L + p.hr * 2;
  const hs: Slot = p.t === 2 ? 'wood' : 'main';
  k.zrod(hs, dz - p.hr, zR - p.gl, p.rh * 0.85, p.rh, 8);
  k.zrod('accent', zR - p.gl, zR, p.rh * 1.18, p.rh * 1.25, 8);
  hammerHead(k, p, dz);
}
function hammerAnchors(p: P): Anchors {
  const zR = p.zr;
  const dz = zR - p.L + p.hr * 2;
  const zm = (dz + zR - p.gl) / 2;
  const rm = lerpR(zm, dz - p.hr, zR - p.gl, p.rh * 0.85, p.rh);
  const rg = lerpR(-0.02, dz - p.hr, zR - p.gl, p.rh * 0.85, p.rh);
  return {
    tip: [0, 0, dz - p.hr * 2],
    rear: [0, 0, zR],
    top: [0, rm, zm],
    grip: [0, -(zR - p.gl > 0 ? rg : p.rh * 1.2), 0],
    under: [0, -p.rh * 0.86, dz + 0.02],
    side: [rm, 0, zm],
  };
}
function hammerHeadRole(k: Kit, p: P): void {
  hammerHead(k, p, 0);
  k.zrod(p.t === 2 ? 'wood' : 'main', -p.hr, 0.02, p.rh * 0.85, p.rh * 0.85, 8);
}

/* ---------------- wrench ---------------- */
function jawPts(R: number, s: number, zc: number, asym: boolean): Pt[] {
  return [
    [-R * 0.45, zc + R * 1.1],
    [R * 0.45, zc + R * 1.1],
    [R, zc + R * 0.3],
    [R, zc - R * 1.25],
    [s / 2, zc - R * 1.25],
    [s / 2, zc - R * 0.15],
    [-s / 2, zc - R * 0.15],
    [-s / 2, zc - R * (asym ? 1.0 : 1.25)],
    [-R, zc - R * (asym ? 1.0 : 1.25)],
    [-R, zc + R * 0.2],
  ];
}
function wrenchHead(k: Kit, p: P, dz: number): void {
  // dz = where the handle meets the head (local z of head start)
  if (p.t === 0) {
    const R = p.R;
    const zc = dz - R * 1.1;
    k.extrude('metal', jawPts(R, R * 0.75, zc, true), 0.012, 'xz');
    k.zrod('accent', zc + R * 0.25, zc - R * 0.55, 0.0065, 0.0065, 8, -R * 0.55, 0);
  } else if (p.t === 1) {
    k.box('metal', [0.022, 0.025, 0.075], { p: [0, 0, dz - 0.0375] });
    k.box('metal', [0.018, 0.095, 0.02], { p: [0, 0.045, dz - 0.01] });
    k.box('metal', [0.022, 0.02, 0.07], { p: [0, 0.082, dz - 0.04] });
    k.rod('accent', [0, 0.03, dz - 0.01], [0, 0.052, dz - 0.01], 0.019, 0.019, 8);
    for (let i = 0; i < 4; i++) k.box('dark', [0.023, 0.004, 0.006], { p: [0, 0.0135, dz - 0.012 - i * 0.017] });
  } else {
    const R = p.R;
    const zc = dz - R * 1.1;
    k.extrude('metal', jawPts(R, R * 0.8, zc, false), 0.007, 'xz');
  }
}
function wrenchGeom(p: P) {
  const zR = p.zr;
  const zh = zR - p.L + (p.t === 1 ? 0.075 : p.R * 2.35);
  return { zR, zh, mid: (zR + zh) / 2 };
}
function wrenchHandle(k: Kit, p: P, zh: number, zR: number): void {
  if (p.t === 0)
    k.extrude(
      'main',
      [
        [-0.0115, zR],
        [0.0115, zR],
        [0.009, zh - 0.004],
        [-0.009, zh - 0.004],
      ],
      0.008,
      'xz',
    );
  else if (p.t === 1) k.box('main', [0.026, 0.017, zR - zh], { p: [0, 0, (zR + zh) / 2] });
  else {
    const zr = zR - 0.017;
    k.box('metal', [0.014, 0.006, zr - zh], { p: [0, 0, (zr + zh) / 2] });
    k.torus('metal', 0.013, 0.0045, { p: [0, 0, zr], r: [PI / 2, 0, 0] }, 4, 10);
  }
}

/* ---------------- power drill ---------------- */
const DBY = 0.045;
const DBR = 0.034;
function drillGeom(p: P) {
  const zf = -p.bz * 0.7;
  const zb = p.bz * 0.3;
  const zc = zf - (p.hex ? 0.03 : 0.05);
  return { zf, zb, zc, zt: zc - p.bl };
}

/* ---------------- chainsaw ---------------- */
function sawGeom(p: P) {
  const s = p.s;
  const zb1 = -0.08;
  const zb0 = zb1 - 0.23 * s;
  const y0 = -0.045 * s;
  const y1 = 0.1 * s;
  const bar0 = zb0 + 0.03;
  const barEnd = bar0 - p.bl;
  return { s, zb0, zb1, y0, y1, bar0, barEnd };
}

/* ---------------- leaf blower ---------------- */
function blowR(p: P, z: number): number {
  return p.t === 2 ? lerpR(z, 0.14, -p.tl, 0.034, 0.027) : lerpR(z, -0.08, -0.08 - p.tl, 0.04, 0.028);
}

/* ---------------- watering can ---------------- */
function canGeom(p: P) {
  const S: Vec3 = [0, -0.28, -0.03];
  const E: Vec3 = [0, -0.28 + p.sl * 0.55, -0.03 - p.sl * 0.83];
  const L = Math.hypot(E[1] - S[1], E[2] - S[2]);
  const d: Vec3 = [0, (E[1] - S[1]) / L, (E[2] - S[2]) / L];
  const T: Vec3 = p.rose ? [0, E[1] + d[1] * 0.035, E[2] + d[2] * 0.035] : E;
  return { S, E, d, T };
}
const sc3 = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

/* ---------------- hand saw ---------------- */
function prunY(p: P, z: number): number {
  const t = -z / p.bl;
  return -0.1 * t * t;
}

export const GARDEN: ObjSpec[] = [
  /* ================= SHOVEL ================= */
  {
    kind: 'shovel',
    group: 'garden',
    noun: 'Shovel',
    syn: ['shovel', 'spade', 'scoop', 'dig', 'digging', 'trench'],
    tags: ['garden', 'tools', 'metal', 'wood', 'farm', 'heavy'],
    desc: 'long handled garden shovel',
    color: '#5a6a72',
    accent: '#2d2f36',
    variants: [
      { v: 'spade', p: { L: 1.05, bw: 0.19, bl: 0.28, pt: 0, dg: 1, sc: 0 }, desc: 'square garden spade with D grip', noun: 'Spade' },
      { v: 'roundpoint', p: { L: 1.4, bw: 0.23, bl: 0.3, pt: 0.12, dg: 0, sc: 0.025 }, desc: 'round point digging shovel' },
      { v: 'scoop', p: { L: 1.2, bw: 0.29, bl: 0.36, pt: 0.03, dg: 1, sc: 0.05 }, desc: 'wide flat snow scoop shovel', noun: 'Scoop Shovel' },
      { v: 'trenching', p: { L: 1.15, bw: 0.11, bl: 0.34, pt: 0.08, dg: 1, sc: 0.015 }, desc: 'narrow pointed trenching shovel' },
    ],
    draw(k, p) {
      const zR = p.dg ? 0.15 : 0.12;
      const zA = zR - p.L + p.bl + 0.12;
      shaft(k, zA, zR, 0.017, p.dg);
      shovelHead(k, p, zA);
    },
    head(k, p) {
      shovelHead(k, p, 0);
    },
    anchors(p) {
      const zR = p.dg ? 0.15 : 0.12;
      const zA = zR - p.L + p.bl + 0.12;
      return shaftAnchors([0, 0, zR - p.L], zA, zR, 0.017, p.dg);
    },
    roles: ['head', 'blade', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
    guns: ['rocket_launcher', 'grenade_launcher'],
  },

  /* ================= RAKE ================= */
  {
    kind: 'rake',
    group: 'garden',
    noun: 'Rake',
    syn: ['rake', 'leaf rake', 'garden rake', 'tines'],
    tags: ['garden', 'tools', 'metal', 'wood', 'farm'],
    desc: 'long handled garden rake',
    color: '#3c8d3a',
    accent: '#c43b2e',
    variants: [
      { v: 'bow', p: { L: 1.5, w: 0.36, n: 14, tl: 0.07, t: 0 }, desc: 'steel bow rake with short tines' },
      { v: 'leaf', p: { L: 1.55, w: 0.52, n: 13, tl: 0.42, t: 1 }, desc: 'fan shaped spring tine leaf rake', noun: 'Leaf Rake' },
      { v: 'shrub', p: { L: 1.2, w: 0.22, n: 9, tl: 0.24, t: 1 }, desc: 'narrow shrub rake small fan' },
      { v: 'landscape', p: { L: 1.7, w: 0.66, n: 22, tl: 0.05, t: 0 }, desc: 'extra wide landscape rake' },
    ],
    draw(k, p) {
      const zR = 0.12;
      const zA = zR - p.L + rakeHL(p);
      shaft(k, zA, zR, 0.015, 0);
      rakeHead(k, p, zA);
    },
    head(k, p) {
      rakeHead(k, p, 0);
    },
    anchors(p) {
      const zR = 0.12;
      const zA = zR - p.L + rakeHL(p);
      return shaftAnchors([0, p.t ? -0.03 : 0, zR - p.L], zA, zR, 0.015, 0);
    },
    roles: ['head', 'deco'],
    melee: { swing: 'slash', weight: 'medium' },
  },

  /* ================= GARDEN FORK ================= */
  {
    kind: 'garden-fork',
    group: 'garden',
    noun: 'Garden Fork',
    syn: ['fork', 'pitchfork', 'hayfork', 'digging fork', 'tines', 'farm'],
    tags: ['garden', 'tools', 'farm', 'metal', 'wood'],
    desc: 'garden fork with steel tines',
    color: '#8a5a32',
    accent: '#2d2f36',
    variants: [
      { v: 'digging', p: { L: 1.0, n: 4, tl: 0.28, w: 0.17, dg: 1, cv: 0.012, tr: 0.0055 }, desc: 'four tine digging fork D grip' },
      { v: 'pitchfork', p: { L: 1.5, n: 3, tl: 0.34, w: 0.2, dg: 0, cv: 0.06, tr: 0.0045 }, desc: 'three prong farm pitchfork', noun: 'Pitchfork' },
      { v: 'hay', p: { L: 1.6, n: 5, tl: 0.4, w: 0.3, dg: 0, cv: 0.08, tr: 0.0042 }, desc: 'wide five tine hay fork', noun: 'Hay Fork' },
    ],
    draw(k, p) {
      const zR = p.dg ? 0.15 : 0.12;
      const zA = zR - p.L + p.tl + 0.08;
      shaft(k, zA, zR, 0.017, p.dg, 'main', 'accent');
      forkHead(k, p, zA);
    },
    head(k, p) {
      forkHead(k, p, 0);
    },
    anchors(p) {
      const zR = p.dg ? 0.15 : 0.12;
      const zA = zR - p.L + p.tl + 0.08;
      const xi = p.n % 2 ? 0 : forkTineX(p, p.n / 2);
      return shaftAnchors([xi, p.cv, zR - p.L], zA, zR, 0.017, p.dg);
    },
    roles: ['head', 'blade', 'deco'],
    melee: { swing: 'thrust', weight: 'medium' },
  },

  /* ================= HAMMER ================= */
  {
    kind: 'hammer',
    group: 'garden',
    noun: 'Hammer',
    syn: ['hammer', 'claw hammer', 'mallet', 'ball peen', 'tool', 'carpenter'],
    tags: ['tools', 'metal', 'wood'],
    desc: 'carpenter hammer',
    color: '#b5763a',
    accent: '#1f1f22',
    variants: [
      { v: 'claw', p: { t: 0, L: 0.33, hr: 0.014, rh: 0.013, gl: 0.11, zr: 0.07 }, desc: 'steel claw hammer rubber grip' },
      { v: 'peen', p: { t: 1, L: 0.36, hr: 0.013, rh: 0.012, gl: 0.0, zr: 0.06 }, desc: 'wooden ball peen hammer', noun: 'Ball Peen Hammer' },
      { v: 'mallet', p: { t: 2, L: 0.34, hr: 0.036, hw: 0.065, rh: 0.013, gl: 0.0, zr: 0.06 }, desc: 'fat rubber mallet', noun: 'Rubber Mallet' },
    ],
    draw: hammerDraw,
    head: hammerHeadRole,
    anchors: hammerAnchors,
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'medium' },
  },

  /* ================= SLEDGEHAMMER ================= */
  {
    kind: 'sledgehammer',
    group: 'garden',
    noun: 'Sledgehammer',
    syn: ['sledgehammer', 'sledge', 'maul', 'splitting maul', 'mallet', 'demolition'],
    tags: ['tools', 'metal', 'heavy', 'industrial'],
    desc: 'heavy two handed sledgehammer',
    color: '#e0a21c',
    accent: '#1f1f22',
    variants: [
      { v: 'sledge', p: { t: 3, L: 0.9, hr: 0.045, hw: 0.11, rh: 0.017, gl: 0.16, zr: 0.08 }, desc: 'big double faced sledgehammer' },
      { v: 'maul', p: { t: 4, L: 0.88, hr: 0.04, hw: 0.13, rh: 0.017, gl: 0.16, zr: 0.08 }, desc: 'wood splitting maul with wedge', noun: 'Splitting Maul' },
      { v: 'club', p: { t: 3, L: 0.3, hr: 0.032, hw: 0.075, rh: 0.016, gl: 0.11, zr: 0.07 }, desc: 'short stubby club hammer', noun: 'Club Hammer' },
    ],
    draw: hammerDraw,
    head: hammerHeadRole,
    anchors: hammerAnchors,
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
  },

  /* ================= WRENCH ================= */
  {
    kind: 'wrench',
    group: 'garden',
    noun: 'Wrench',
    syn: ['wrench', 'spanner', 'pipe wrench', 'monkey wrench', 'adjustable', 'plumber'],
    tags: ['tools', 'metal', 'industrial'],
    desc: 'steel wrench',
    color: '#9aa1ab',
    accent: '#5a5f68',
    variants: [
      { v: 'adjustable', p: { t: 0, L: 0.25, R: 0.027, zr: 0.06 }, desc: 'adjustable crescent wrench', noun: 'Adjustable Wrench' },
      { v: 'pipe', p: { t: 1, L: 0.36, R: 0.03, zr: 0.08 }, desc: 'heavy red pipe wrench', noun: 'Pipe Wrench' },
      { v: 'spanner', p: { t: 2, L: 0.22, R: 0.019, zr: 0.08 }, desc: 'combination spanner open and ring', noun: 'Spanner' },
    ],
    draw(k, p) {
      const g = wrenchGeom(p);
      wrenchHandle(k, p, g.zh, g.zR);
      wrenchHead(k, p, g.zh);
    },
    head(k, p) {
      const g = wrenchGeom(p);
      wrenchHead(k, p, 0);
      wrenchHandle(k, p, 0, Math.min(0.04, g.zR - g.zh));
      k.transformAll({ p: [0, 0, -0.04] });
    },
    anchors(p) {
      const g = wrenchGeom(p);
      if (p.t === 1)
        return {
          tip: [0, 0, g.zh - 0.075],
          rear: [0, 0, g.zR],
          top: [0, 0.0085, g.mid],
          grip: [0, -0.0085, 0],
          under: [0, -0.0125, g.zh - 0.04],
          side: [0.013, 0, g.mid],
        };
      const R = p.R;
      const zc = g.zh - R * 1.1;
      const th = p.t === 0 ? 0.004 : 0.003;
      return {
        tip: [(R + R * 0.4) / 2, 0, zc - R * 1.25],
        rear: [0, 0, g.zR],
        top: [0, th, g.mid],
        grip: [0, -th, p.t === 0 ? 0 : 0.03],
        under: [0, -th, g.zh + 0.01],
        side: [p.t === 0 ? 0.0103 : 0.007, 0, g.mid],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  /* ================= SCREWDRIVER ================= */
  {
    kind: 'screwdriver',
    group: 'garden',
    noun: 'Screwdriver',
    syn: ['screwdriver', 'phillips', 'flathead', 'driver', 'tool', 'shiv'],
    tags: ['tools', 'metal', 'plastic'],
    desc: 'screwdriver with chunky handle',
    color: '#d8352a',
    accent: '#f0c419',
    variants: [
      { v: 'flat', p: { sl: 0.15, hl: 0.11, hr: 0.016, ph: 0, cap: 0 }, desc: 'flathead screwdriver' },
      { v: 'phillips', p: { sl: 0.12, hl: 0.1, hr: 0.017, ph: 1, cap: 0 }, desc: 'phillips cross tip screwdriver' },
      { v: 'demolition', p: { sl: 0.3, hl: 0.13, hr: 0.02, ph: 0, cap: 1 }, desc: 'long demolition screwdriver with strike cap' },
      { v: 'stubby', p: { sl: 0.035, hl: 0.06, hr: 0.021, ph: 1, cap: 0 }, desc: 'tiny fat stubby screwdriver' },
    ],
    draw(k, p) {
      const hr = p.hr;
      const hl = p.hl;
      k.zlathe(
        'main',
        [
          [0, 0],
          [hr * 0.75, 0],
          [hr, 0.015],
          [hr, hl - 0.02],
          [hr * 0.85, hl - 0.006],
          [hr * 0.45, hl],
          [0, hl],
        ],
        6,
      );
      k.zrod('accent', hl * 0.35, hl * 0.6, hr * 1.03, hr * 1.03, 6);
      k.zrod('metal', -0.008, 0.004, 0.006, 0.0075, 8);
      k.zrod('metal', -p.sl + 0.004, -0.006, 0.0036, 0.0036, 6);
      if (p.ph) {
        k.zrod('metal', -p.sl + 0.004, -p.sl - 0.012, 0.0036, 0.0006, 6);
        k.box('metal', [0.0065, 0.0013, 0.011], { p: [0, 0, -p.sl - 0.004] });
        k.box('metal', [0.0013, 0.0065, 0.011], { p: [0, 0, -p.sl - 0.004] });
      } else {
        k.zrod('metal', -p.sl + 0.01, -p.sl - 0.004, 0.0036, 0.0025, 6);
        k.box('metal', [0.0085, 0.0016, 0.012], { p: [0, 0, -p.sl - 0.006] });
      }
      if (p.cap) k.zrod('metal', hl - 0.004, hl + 0.012, hr * 0.62, hr * 0.62, 8);
    },
    anchors(p) {
      const s = p.sl;
      return {
        tip: [0, 0, -s - 0.012],
        rear: [0, 0, p.hl + (p.cap ? 0.012 : 0)],
        top: [0, p.hr * 0.95, p.hl * 0.45],
        grip: [0, -p.hr * 0.95, p.hl * 0.4],
        under: [0, -0.0036, -s * 0.5],
        side: [0.0036, 0, -s * 0.5],
      };
    },
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
  },

  /* ================= POWER DRILL ================= */
  {
    kind: 'power-drill',
    group: 'garden',
    noun: 'Power Drill',
    syn: ['drill', 'power drill', 'cordless drill', 'impact driver', 'hammer drill', 'driver'],
    tags: ['tools', 'power-tool', 'plastic', 'modern', 'industrial'],
    desc: 'cordless power drill',
    color: '#e8b31a',
    accent: '#2b2b2e',
    variants: [
      { v: 'cordless', p: { bz: 0.17, bl: 0.07, bat: 1, hex: 0, side: 0 }, desc: 'cordless drill with twist bit' },
      { v: 'impact', p: { bz: 0.13, bl: 0.04, bat: 1, hex: 1, side: 0 }, desc: 'stubby impact driver hex bit', noun: 'Impact Driver' },
      { v: 'hammer', p: { bz: 0.24, bl: 0.15, bat: 0, hex: 0, side: 1 }, desc: 'corded hammer drill with side handle', noun: 'Hammer Drill' },
    ],
    draw(k, p) {
      const g = drillGeom(p);
      k.zrod('main', g.zf, g.zb, DBR * 0.92, DBR, 8, 0, DBY);
      k.zrod('accent', g.zb, g.zb + 0.015, DBR * 0.95, DBR * 0.75, 8, 0, DBY);
      k.box('accent', [0.012, 0.02, g.zb - g.zf - 0.04], { p: [0, DBY + DBR - 0.004, (g.zf + g.zb) / 2] });
      k.zrod('accent', g.zf - 0.012, g.zf, DBR * 0.7, DBR * 0.88, 8, 0, DBY);
      if (p.hex) k.zrod('dark', g.zc, g.zf - 0.012, 0.012, 0.014, 6, 0, DBY);
      else k.zrod('dark', g.zc, g.zf - 0.012, 0.014, 0.021, 8, 0, DBY);
      k.zrod('metal', g.zt, g.zc, p.hex ? 0.0045 : 0.0038, p.hex ? 0.0045 : 0.0042, 6, 0, DBY);
      k.box('main', [0.034, 0.13, 0.042], { p: [0, -0.05, 0.012], r: [-0.2, 0, 0] });
      k.box('accent', [0.036, 0.07, 0.018], { p: [0, -0.06, 0.03], r: [-0.2, 0, 0] });
      k.box('dark', [0.012, 0.024, 0.012], { p: [0, -0.002, -0.02] });
      if (p.bat) {
        k.box('dark', [0.072, 0.04, 0.1], { p: [0, -0.135, 0.028] });
        k.box('main', [0.074, 0.012, 0.102], { p: [0, -0.11, 0.028] });
      } else {
        k.box('main', [0.05, 0.03, 0.07], { p: [0, -0.125, 0.026] });
        k.tube(
          'dark',
          [
            [0, -0.13, 0.06],
            [0, -0.15, 0.1],
            [0, -0.2, 0.12],
          ],
          0.006,
          5,
          4,
        );
      }
      if (p.side) {
        k.rod('dark', [0, DBY, g.zf + 0.02], [0, DBY - 0.03, g.zf + 0.02], DBR * 1.02, DBR * 1.02, 8);
        k.rod('dark', [0, DBY - 0.03, g.zf + 0.02], [0, DBY - 0.15, g.zf - 0.01], 0.015, 0.017, 8);
      }
    },
    anchors(p) {
      const g = drillGeom(p);
      return {
        tip: [0, DBY, g.zt],
        rear: [0, DBY, g.zb + 0.015],
        top: [0, DBY + DBR + 0.006, -0.03],
        grip: [0, DBY - DBR * 0.95, -0.055],
        under: [0, DBY - DBR * 0.93, g.zf + 0.012],
        side: [DBR * 0.97, DBY, -0.03],
      };
    },
    roles: ['deco', 'mag'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol', 'smg'],
    selfGrip: true,
    ammo: 'drill bits',
  },

  /* ================= CHAINSAW ================= */
  {
    kind: 'chainsaw',
    group: 'garden',
    noun: 'Chainsaw',
    syn: ['chainsaw', 'chain saw', 'saw', 'lumberjack', 'logging', 'pruner'],
    tags: ['tools', 'power-tool', 'heavy', 'industrial', 'metal', 'garden'],
    desc: 'gas chainsaw with long bar',
    color: '#e5641f',
    accent: '#3a3c40',
    variants: [
      { v: 'gas', p: { s: 1, bl: 0.4 }, desc: 'orange gas chainsaw' },
      { v: 'logger', p: { s: 1.15, bl: 0.62 }, desc: 'big logger chainsaw extra long bar' },
      { v: 'pruner', p: { s: 0.72, bl: 0.22 }, desc: 'small cordless pruning chainsaw' },
    ],
    draw(k, p) {
      const g = sawGeom(p);
      const s = g.s;
      const hw = 0.055 * s;
      k.box('main', [hw * 2, g.y1 - g.y0, g.zb1 - g.zb0], { p: [0, (g.y0 + g.y1) / 2, (g.zb0 + g.zb1) / 2] });
      k.box('accent', [hw * 2 + 0.004, 0.035 * s, (g.zb1 - g.zb0) * 0.7], { p: [0, g.y1 - 0.012 * s, (g.zb0 + g.zb1) / 2 + 0.02] });
      k.box('dark', [0.012, 0.03 * s, 0.02], { p: [-hw - 0.006, 0.03 * s, g.zb0 + 0.06 * s] });
      k.box('accent', [hw * 2 + 0.006, 0.08 * s, 0.03], { p: [0, 0.02 * s, g.zb0 + 0.015] });
      // rear handle + post
      k.zrod('dark', -0.09, 0.075, 0.016, 0.016, 6);
      k.rod('dark', [0, 0, 0.07], [0, 0.07 * s, 0.07], 0.014, 0.014, 6);
      k.rod('dark', [0, 0.07 * s, 0.07], [0, g.y1 - 0.01, g.zb1 + 0.01], 0.014, 0.014, 6);
      k.box('accent', [0.01, 0.025, 0.012], { p: [0, -0.02, -0.02] });
      // wrap handle
      const R = hw + 0.03;
      k.torus('dark', R, 0.012, { p: [0, (g.y0 + g.y1) / 2, g.zb0 + 0.06 * s] }, 4, 9, PI);
      // bar + chain
      const z0 = g.bar0;
      const z1 = g.barEnd;
      const bh = 0.028 * Math.max(s, 0.85);
      const outline = (h: number, e: number): Pt[] => [
        [z0, -h],
        [z1 + 0.03, -h],
        [z1 - e, -h * 0.45],
        [z1 - e, h * 0.45],
        [z1 + 0.03, h],
        [z0, h],
      ];
      k.extrude('dark', outline(bh + 0.007, 0.007), 0.008, 'zy');
      k.extrude('metal', outline(bh, 0), 0.0105, 'zy');
      const n = Math.min(10, Math.floor((z0 - z1) / 0.045));
      for (let i = 0; i < n; i++) k.box('dark', [0.009, 0.008, 0.012], { p: [0, bh + 0.009, z0 - 0.03 - i * 0.045] });
    },
    anchors(p) {
      const g = sawGeom(p);
      return {
        tip: [0, 0, g.barEnd - 0.007],
        rear: [0, 0, 0.075],
        top: [0, g.y1, (g.zb0 + g.zb1) / 2 - 0.03],
        grip: [0, -0.016, 0.02],
        under: [0, g.y0, (g.zb0 + g.zb1) / 2],
        side: [0.055 * g.s, (g.y0 + g.y1) / 2, (g.zb0 + g.zb1) / 2 + 0.03],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'slash', weight: 'heavy' },
    guns: ['lmg', 'flamethrower'],
    ammo: 'sawdust',
  },

  /* ================= LEAF BLOWER ================= */
  {
    kind: 'leaf-blower',
    group: 'garden',
    noun: 'Leaf Blower',
    syn: ['leaf blower', 'blower', 'air', 'wind', 'garden', 'backpack blower'],
    tags: ['garden', 'power-tool', 'plastic', 'silly'],
    desc: 'handheld leaf blower with long tube',
    color: '#e5641f',
    accent: '#3a3c40',
    variants: [
      { v: 'gas', p: { t: 0, tl: 0.5 }, desc: 'gas leaf blower with fuel tank' },
      { v: 'cordless', p: { t: 1, tl: 0.42 }, desc: 'compact cordless leaf blower' },
      { v: 'backpack', p: { t: 2, tl: 0.7 }, desc: 'backpack blower wand with flex hose' },
    ],
    draw(k, p) {
      if (p.t === 2) {
        const y = 0.04;
        k.zrod('main', -p.tl, 0.14, 0.027, 0.034, 8, 0, y);
        k.zrod('accent', -p.tl - 0.02, -p.tl + 0.03, 0.03, 0.03, 8, 0, y);
        k.box('dark', [0.03, 0.11, 0.038], { p: [0, -0.035, 0.0], r: [-0.18, 0, 0] });
        k.box('accent', [0.012, 0.03, 0.012], { p: [0, 0.0, -0.03] });
        k.tube(
          'dark',
          [
            [0, y, 0.12],
            [0, y - 0.01, 0.2],
            [0, -0.06, 0.27],
            [0, -0.15, 0.3],
          ],
          0.022,
          8,
          6,
        );
        for (const z of [-0.2, -0.45]) k.zrod('accent', z - 0.01, z + 0.01, blowR(p, z) + 0.004, blowR(p, z) + 0.004, 8, 0, y);
        return;
      }
      k.zrod('dark', -0.075, 0.075, 0.016, 0.016, 6);
      k.rod('dark', [0, 0, -0.07], [0, -0.06, -0.085], 0.014, 0.014, 6);
      k.rod('dark', [0, 0, 0.07], [0, -0.06, 0.085], 0.014, 0.014, 6);
      k.box('accent', [0.012, 0.025, 0.012], { p: [0, -0.02, -0.035] });
      k.box('main', [0.12, 0.13, 0.22], { p: [0, -0.11, 0.01] });
      k.zrod('main', -0.08 - p.tl, -0.08, 0.028, 0.04, 8, 0, -0.12);
      k.zrod('accent', -0.08 - p.tl, -0.08 - p.tl + 0.06, 0.031, 0.031, 8, 0, -0.12);
      if (p.t === 0) {
        k.box('#d9d4c4', [0.1, 0.04, 0.12], { p: [0, -0.19, 0.03] });
        k.box('dark', [0.02, 0.03, 0.03], { p: [0.07, -0.09, 0.05] });
        k.rod('dark', [0.06, -0.06, 0.12], [0.06, -0.06, 0.15], 0.012, 0.012, 6);
      } else {
        k.box('dark', [0.07, 0.05, 0.1], { p: [0, -0.06, 0.07] });
        k.box('accent', [0.122, 0.02, 0.18], { p: [0, -0.16, 0.0] });
      }
    },
    anchors(p) {
      if (p.t === 2) {
        const y = 0.04;
        return {
          tip: [0, y, -p.tl - 0.02],
          rear: [0, -0.15, 0.3],
          top: [0, y + blowR(p, -0.1), -0.1],
          grip: [0, y - blowR(p, -0.06), -0.06],
          under: [0, y - blowR(p, -p.tl * 0.6), -p.tl * 0.6],
          side: [blowR(p, -0.1), y, -0.1],
        };
      }
      const zu = -0.08 - p.tl * 0.5;
      return {
        tip: [0, -0.12, -0.08 - p.tl],
        rear: [0, -0.11, 0.12],
        top: [0, 0.016, 0],
        grip: [0, p.t === 0 ? -0.21 : -0.175, 0.0],
        under: [0, -0.12 - blowR(p, zu), zu],
        side: [0.06, -0.11, 0.0],
      };
    },
    roles: ['barrel', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['flamethrower', 'bubble_gun', 'smg'],
    fireMode: 'stream',
    ammo: 'leaves',
  },

  /* ================= HOSE NOZZLE ================= */
  {
    kind: 'hose-nozzle',
    group: 'garden',
    noun: 'Garden Hose',
    syn: ['hose', 'garden hose', 'nozzle', 'sprayer', 'water', 'spray gun'],
    tags: ['garden', 'plastic', 'rubber', 'silly'],
    desc: 'garden hose spray nozzle with coil',
    color: '#d8352a',
    accent: '#f0c419',
    variants: [
      { v: 'pistol', p: { t: 0, wl: 0 }, desc: 'pistol grip hose nozzle dial head' },
      { v: 'wand', p: { t: 1, wl: 0.42 }, desc: 'long watering wand with shower head', noun: 'Watering Wand' },
      { v: 'jet', p: { t: 2, wl: 0 }, desc: 'brass jet nozzle on hose' },
    ],
    draw(k, p) {
      const by = 0.03;
      const zf = -0.08;
      k.zrod('main', zf, 0.08, 0.015, 0.016, 8, 0, by);
      k.zrod('accent', 0.06, 0.08, 0.018, 0.018, 8, 0, by);
      if (p.t === 0) {
        k.zrod('accent', zf - 0.025, zf, 0.032, 0.032, 10, 0, by);
        k.zrod('dark', zf - 0.028, zf - 0.024, 0.024, 0.024, 10, 0, by);
      } else if (p.t === 1) {
        k.zrod('metal', zf - p.wl, zf + 0.01, 0.008, 0.008, 6, 0, by);
        const e: Vec3 = [0, by, zf - p.wl];
        k.rod('metal', e, [0, by + 0.03, e[2] - 0.03], 0.008, 0.008, 6);
        k.rod('accent', [0, by + 0.03, e[2] - 0.03], [0, by + 0.045, e[2] - 0.045], 0.012, 0.034, 10);
      } else {
        k.zrod('brass', zf - 0.09, zf, 0.008, 0.019, 8, 0, by);
        k.zrod('brass', zf - 0.03, zf - 0.015, 0.016, 0.016, 8, 0, by);
      }
      k.box('main', [0.026, 0.11, 0.034], { p: [0, -0.03, 0.045], r: [-0.25, 0, 0] });
      k.box('accent', [0.012, 0.085, 0.012], { p: [0, -0.025, -0.005], r: [-0.15, 0, 0] });
      k.tube(
        HOSE,
        [
          [0, -0.08, 0.06],
          [0, -0.12, 0.06],
          [0.012, -0.14, 0.02],
        ],
        0.011,
        5,
        5,
      );
      for (const x of [-0.012, 0.012]) k.torus(HOSE, 0.06, 0.011, { p: [x, -0.2, 0.0], r: [0, PI / 2, 0] }, 4, 10);
    },
    anchors(p) {
      const by = 0.03;
      const zf = -0.08;
      const tip: Vec3 = p.t === 0 ? [0, by, zf - 0.025] : p.t === 1 ? [0, by + 0.045, zf - p.wl - 0.045] : [0, by, zf - 0.09];
      return {
        tip,
        rear: [0, by, 0.08],
        top: [0, by + 0.0155, -0.02],
        grip: [0, by - 0.0155, -0.05],
        under: [0, by - 0.015, zf + 0.01],
        side: [0.0155, by, -0.02],
      };
    },
    roles: ['barrel', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['flamethrower', 'bubble_gun', 'pistol'],
    selfGrip: true,
    fireMode: 'stream',
    ammo: 'water',
  },

  /* ================= WATERING CAN ================= */
  {
    kind: 'watering-can',
    group: 'garden',
    noun: 'Watering Can',
    syn: ['watering can', 'can', 'sprinkler', 'water', 'garden', 'rose'],
    tags: ['garden', 'metal', 'plastic', 'silly'],
    desc: 'watering can with long spout',
    color: '#8fa3a8',
    accent: '#c99a2e',
    variants: [
      { v: 'galvanized', p: { s: 1, rose: 1, box: 0, sl: 0.36 }, desc: 'galvanized round watering can with rose' },
      { v: 'plastic', p: { s: 1.05, rose: 1, box: 1, sl: 0.3 }, desc: 'boxy plastic garden watering can' },
      { v: 'indoor', p: { s: 0.6, rose: 0, box: 0, sl: 0.55 }, desc: 'small indoor can thin spout' },
    ],
    draw(k, p) {
      const g = canGeom(p);
      if (p.box) {
        k.box('main', [0.12, 0.22, 0.24], { p: [0, -0.21, 0.05] });
        k.box('main', [0.08, 0.03, 0.12], { p: [0, -0.087, 0.0] });
      } else {
        k.rod('main', [0, -0.32, 0.05], [0, -0.1, 0.05], 0.1, 0.1, 10);
        k.rod('main', [0, -0.1, 0.05], [0, -0.075, 0.05], 0.1, 0.06, 10);
        k.rod('accent', [0, -0.322, 0.05], [0, -0.31, 0.05], 0.103, 0.103, 10);
      }
      k.tube(
        p.box ? 'main' : 'accent',
        [
          [0, -0.09, -0.05],
          [0, 0, -0.005],
          [0, 0, 0.0],
          [0, 0, 0.075],
          [0, -0.06, 0.14],
          [0, -0.15, 0.14],
        ],
        0.01,
        12,
        5,
      );
      k.rod('main', g.S, g.E, 0.015, 0.009, 8);
      if (p.rose) k.rod('accent', g.E, g.T, 0.011, 0.03, 10);
      k.transformAll({ s: p.s });
    },
    anchors(p) {
      const g = canGeom(p);
      const s = p.s;
      return {
        tip: sc3(g.T, s),
        rear: sc3([0, -0.2, p.box ? 0.17 : 0.15], s),
        top: sc3([0, 0.01, 0.0], s),
        grip: sc3([0, -0.01, 0.0], s),
        under: sc3([0, p.box ? -0.32 : -0.322, 0.05], s),
        side: sc3([p.box ? 0.06 : 0.1, -0.2, 0.05], s),
        mag: sc3([0, p.box ? -0.32 : -0.322, 0.08], s),
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['flamethrower', 'bubble_gun', 'shotgun'],
    fireMode: 'stream',
    ammo: 'water',
  },

  /* ================= LEAD PIPE ================= */
  {
    kind: 'lead-pipe',
    group: 'garden',
    noun: 'Lead Pipe',
    syn: ['pipe', 'lead pipe', 'plumbing', 'tube', 'elbow', 'fitting', 'clue'],
    tags: ['tools', 'metal', 'junk', 'industrial', 'heavy'],
    desc: 'heavy metal plumbing pipe',
    color: '#6e7076',
    accent: '#a7814a',
    variants: [
      { v: 'straight', p: { L: 0.5, r: 0.016, f: 0 }, desc: 'straight pipe with coupler' },
      { v: 'elbow', p: { L: 0.45, r: 0.019, f: 1 }, desc: 'pipe with elbow fitting end' },
      { v: 'tee', p: { L: 0.55, r: 0.017, f: 2 }, desc: 'pipe with tee junction end' },
      { v: 'flange', p: { L: 0.62, r: 0.021, f: 3 }, desc: 'thick pipe with bolted flange' },
    ],
    draw(k, p) {
      const zR = 0.12;
      const z0 = zR - p.L;
      const r = p.r;
      const R = r * 1.38;
      k.zrod('main', z0 + 0.02, zR, r, r, 8);
      for (let i = 0; i < 3; i++) k.zrod('accent', zR - 0.012 - i * 0.012, zR - 0.006 - i * 0.012, r * 1.06, r * 1.06, 8);
      if (p.f === 0) {
        k.zrod('accent', z0, z0 + 0.055, R, R, 8);
      } else if (p.f === 1) {
        k.zrod('main', z0, z0 + 0.065, R, R, 8);
        k.rod('main', [0, 0, z0 + R], [0, 0.07, z0 + R], R, R, 8);
        k.rod('accent', [0, 0.06, z0 + R], [0, 0.075, z0 + R], R * 1.08, R * 1.08, 8);
      } else if (p.f === 2) {
        k.zrod('main', z0, z0 + 0.07, R, R, 8);
        k.rod('main', [-0.06, 0, z0 + 0.03], [0.06, 0, z0 + 0.03], R, R, 8);
      } else {
        k.zrod('main', z0, z0 + 0.016, r * 3, r * 3, 10);
        for (let i = 0; i < 4; i++) {
          const a = PI / 4 + (i * PI) / 2;
          k.zrod('accent', z0 - 0.006, z0 + 0.024, 0.006, 0.006, 6, Math.cos(a) * r * 2.3, Math.sin(a) * r * 2.3);
        }
        k.zrod('main', z0 + 0.016, z0 + 0.04, r * 1.5, r, 8);
      }
    },
    anchors(p) {
      const zR = 0.12;
      const z0 = zR - p.L;
      const zm = (z0 + zR) / 2;
      return {
        tip: [0, 0, z0],
        rear: [0, 0, zR],
        top: [0, p.r, zm],
        grip: [0, -p.r, -0.02],
        under: [0, -p.r, z0 + 0.1],
        side: [p.r, 0, zm],
      };
    },
    roles: ['barrel', 'blade', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['shotgun', 'rifle', 'blowgun'],
  },

  /* ================= CROWBAR ================= */
  {
    kind: 'crowbar',
    group: 'garden',
    noun: 'Crowbar',
    syn: ['crowbar', 'pry bar', 'wrecking bar', 'jimmy', 'gooseneck', 'lever'],
    tags: ['tools', 'metal', 'heavy', 'industrial'],
    desc: 'steel crowbar with hooked claw',
    color: '#c42e2a',
    accent: '#2d2f36',
    variants: [
      { v: 'gooseneck', p: { L: 0.62, r: 0.011, hk: 0.1, flat: 0 }, desc: 'red gooseneck crowbar' },
      { v: 'wrecking', p: { L: 0.92, r: 0.014, hk: 0.075, flat: 0 }, desc: 'long heavy wrecking bar', noun: 'Wrecking Bar' },
      { v: 'flat', p: { L: 0.4, r: 0.004, hk: 0, flat: 1 }, desc: 'flat pry bar with bent lip', noun: 'Pry Bar' },
    ],
    draw(k, p) {
      const zR = 0.1;
      if (p.flat) {
        const z1 = zR - p.L + 0.06;
        k.box('main', [0.035, 0.008, zR - z1], { p: [0, 0, (zR + z1) / 2] });
        k.box('main', [0.035, 0.008, 0.065], { p: [0, 0, z1 - 0.03], r: [0.35, 0, 0] });
        k.box('dark', [0.012, 0.009, 0.05], { p: [0, 0, zR - 0.04] });
        return;
      }
      const r = p.r;
      const hk = p.hk;
      const zH = zR - p.L + hk * 0.62;
      k.zrod('main', zH, zR - 0.06, r, r, 6);
      k.rod('main', [0, 0, zR - 0.06], [0, 0.015, zR], r, r * 0.7, 6);
      k.box('main', [r * 2.2, r * 0.6, 0.02], { p: [0, 0.017, zR - 0.005], r: [-0.25, 0, 0] });
      k.tube(
        'main',
        [
          [0, 0, zH + 0.01],
          [0, 0, zH],
          [0, hk * 0.15, zH - hk * 0.5],
          [0, hk * 0.6, zH - hk * 0.62],
          [0, hk * 0.95, zH - hk * 0.35],
          [0, hk, zH - hk * 0.05],
        ],
        r,
        12,
        6,
      );
      for (const s of [-1, 1]) k.box('main', [r * 0.8, r * 1.2, 0.03], { p: [s * r * 0.55, hk * 1.02, zH + 0.002], r: [-0.4, 0, 0] });
      k.zrod('accent', zR - 0.26, zR - 0.08, r * 1.15, r * 1.15, 6);
    },
    anchors(p) {
      const zR = 0.1;
      if (p.flat) {
        const z1 = zR - p.L + 0.06;
        const zm = (zR + z1) / 2;
        return {
          tip: [0, 0.0325 * Math.sin(0.35), z1 - 0.03 - 0.0325 * Math.cos(0.35)],
          rear: [0, 0, zR],
          top: [0, 0.004, zm],
          grip: [0, -0.004, 0],
          under: [0, -0.004, z1 + 0.02],
          side: [0.0175, 0, zm],
        };
      }
      const r = p.r;
      const hk = p.hk;
      const zH = zR - p.L + hk * 0.62;
      const zm = (zH + zR - 0.06) / 2;
      return {
        tip: [0, hk * 0.6, zH - hk * 0.62],
        rear: [0, 0.015, zR],
        top: [0, r, zm],
        grip: [0, -r * 1.15, -0.02],
        under: [0, -r, zH + 0.05],
        side: [r, 0, zm],
      };
    },
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['rifle', 'sniper'],
  },

  /* ================= HAND SAW ================= */
  {
    kind: 'hand-saw',
    group: 'garden',
    noun: 'Hand Saw',
    syn: ['saw', 'handsaw', 'hacksaw', 'pruning saw', 'carpenter', 'teeth'],
    tags: ['tools', 'metal', 'wood'],
    desc: 'toothed hand saw',
    color: '#c8742b',
    accent: '#2d2f36',
    variants: [
      { v: 'panel', p: { t: 0, bl: 0.5, hb0: 0.13, hb1: 0.06 }, desc: 'classic carpenter panel saw' },
      { v: 'pruning', p: { t: 1, bl: 0.34 }, desc: 'curved pruning saw rubber handle', noun: 'Pruning Saw' },
      { v: 'hacksaw', p: { t: 2, bl: 0.3 }, desc: 'metal frame hacksaw', noun: 'Hacksaw' },
    ],
    draw(k, p) {
      if (p.t === 0) {
        const yt0 = 0.05;
        const yb = yt0 - p.hb0;
        const yt1 = yb + p.hb1;
        const pts: Pt[] = [
          [-0.03, yt0],
          [-p.bl, yt1],
          [-p.bl, yb],
        ];
        const step = 0.016;
        for (let z = -p.bl + step; z < -0.035; z += step) {
          pts.push([z - step / 2, yb - 0.006]);
          pts.push([z, yb]);
        }
        pts.push([-0.03, yb]);
        k.extrude('metal', pts, 0.0018, 'zy');
        k.extrude(
          'main',
          [
            [-0.05, 0.055],
            [0.02, 0.075],
            [0.07, 0.06],
            [0.085, 0.0],
            [0.065, -0.06],
            [0.0, -0.075],
            [-0.05, -0.07],
          ],
          0.024,
          'zy',
          undefined,
          0,
          [
            [
              [-0.02, 0.035],
              [0.04, 0.042],
              [0.05, -0.035],
              [-0.015, -0.045],
            ],
          ],
        );
        for (const y of [0.02, -0.04]) k.rod('brass', [-0.013, y, -0.035], [0.013, y, -0.035], 0.006, 0.006, 6);
      } else if (p.t === 1) {
        const pts: Pt[] = [];
        const n = 8;
        for (let i = 0; i <= n; i++) {
          const z = -0.02 - ((p.bl - 0.02) * i) / n;
          pts.push([z, prunY(p, z) + 0.018 - (i === n ? 0.01 : 0)]);
        }
        const step = 0.014;
        for (let z = -p.bl; z < -0.02; z += step) {
          pts.push([z, prunY(p, z) - 0.018]);
          pts.push([z + step / 2, prunY(p, z + step / 2) - 0.025]);
        }
        pts.push([-0.02, -0.018]);
        k.extrude('metal', pts, 0.002, 'zy');
        k.zrod('main', -0.035, 0.12, 0.014, 0.017, 8);
        k.zrod('accent', 0.04, 0.1, 0.018, 0.018, 8);
        k.rod('main', [0, 0, 0.12], [0, -0.03, 0.15], 0.017, 0.012, 8);
      } else {
        k.extrude('metal', [[0, 0.0], [-p.bl, 0.0], [-p.bl, 0.012], [0, 0.012]], 0.0012, 'zy');
        k.box('main', [0.012, 0.014, p.bl + 0.03], { p: [0, 0.095, -p.bl / 2 + 0.003] });
        k.box('main', [0.012, 0.1, 0.012], { p: [0, 0.05, -p.bl] });
        k.box('main', [0.012, 0.1, 0.012], { p: [0, 0.05, 0.012] });
        k.box('accent', [0.026, 0.11, 0.036], { p: [0, -0.025, 0.03], r: [-0.3, 0, 0] });
        k.rod('metal', [0, 0.006, -p.bl - 0.006], [0, 0.006, -p.bl - 0.018], 0.005, 0.005, 6);
      }
    },
    anchors(p) {
      if (p.t === 0) {
        const yb = 0.05 - p.hb0;
        const yt1 = yb + p.hb1;
        const zt = -0.25;
        const ytop = 0.05 + ((yt1 - 0.05) * (zt + 0.03)) / (-p.bl + 0.03);
        return {
          tip: [0, (yt1 + yb) / 2, -p.bl],
          rear: [0, 0, 0.085],
          top: [0, ytop, zt],
          grip: [0, -0.075, 0.0],
          under: [0, yb, -0.25],
          side: [0.0009, (ytop + yb) / 2, zt],
        };
      }
      if (p.t === 1) {
        const zt = -p.bl * 0.5;
        return {
          tip: [0, prunY(p, -p.bl), -p.bl],
          rear: [0, -0.03, 0.15],
          top: [0, prunY(p, zt) + 0.018, zt],
          grip: [0, -0.0175, 0.0],
          under: [0, prunY(p, zt) - 0.018, zt],
          side: [0.001, prunY(p, zt), zt],
        };
      }
      return {
        tip: [0, 0.05, -p.bl - 0.006],
        rear: [0, 0.095, 0.018],
        top: [0, 0.102, -p.bl / 2],
        grip: [0, 0.088, -0.05],
        under: [0, 0.0, -p.bl * 0.6],
        side: [0.006, 0.095, -p.bl / 2],
        mag: [0, 0.0, -p.bl * 0.3],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
  },

  /* ================= NAIL GUN ================= */
  {
    kind: 'nail-gun',
    group: 'garden',
    noun: 'Nail Gun',
    syn: ['nail gun', 'nailer', 'framing nailer', 'brad nailer', 'nails', 'pneumatic'],
    tags: ['tools', 'power-tool', 'industrial', 'modern'],
    desc: 'pneumatic nail gun',
    color: '#d8352a',
    accent: '#3a3c40',
    variants: [
      { v: 'framing', p: { m: 0, R: 0.045, bw: 0.045 }, desc: 'framing nailer with angled stick magazine' },
      { v: 'coil', p: { m: 1, R: 0.042, bw: 0.044 }, desc: 'coil nailer with round drum magazine' },
      { v: 'brad', p: { m: 2, R: 0.03, bw: 0.034 }, desc: 'slim brad nailer straight magazine' },
    ],
    draw(k, p) {
      const R = p.R;
      const zc = -0.16;
      k.box('main', [p.bw, 0.05, 0.2], { p: [0, 0.045, -0.06] });
      k.rod('main', [0, -0.04, zc], [0, 0.1, zc], R, R, 10);
      k.rod('accent', [0, 0.1, zc], [0, 0.118, zc], R * 1.03, R * 0.85, 10);
      k.box('dark', [0.02, 0.07, 0.026], { p: [0, -0.07, zc - 0.005] });
      k.box('dark', [0.032, 0.12, 0.042], { p: [0, -0.04, 0.02], r: [-0.2, 0, 0] });
      k.box('accent', [0.01, 0.026, 0.012], { p: [0, -0.003, -0.025] });
      k.rod('brass', [0, -0.1, 0.04], [0, -0.1, 0.08], 0.008, 0.008, 6);
      if (p.m === 0) k.rod('accent', [0, -0.085, zc + 0.01], [0, -0.13, 0.04], 0.018, 0.018, 4);
      else if (p.m === 1) {
        k.rod('accent', [0, -0.12, zc + 0.06], [0, -0.07, zc + 0.06], 0.055, 0.055, 10);
        k.rod('dark', [0, -0.11, 0.0], [0, -0.11, 0.04], 0.01, 0.01, 6);
      } else k.box('accent', [0.022, 0.03, 0.17], { p: [0, -0.095, -0.06] });
    },
    anchors(p) {
      return {
        tip: [0, 0.03, -0.16 - p.R],
        rear: [0, 0.045, 0.04],
        top: [0, 0.07, -0.05],
        grip: [0, 0.02, -0.08],
        under: [0, 0.02, -0.11],
        side: [p.bw / 2, 0.045, -0.06],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['pistol', 'smg', 'rifle'],
    selfGrip: true,
    fireMode: 'projectile',
    ammo: 'nails',
  },

  /* ================= SPRAY BOTTLE ================= */
  {
    kind: 'spray-bottle',
    group: 'garden',
    noun: 'Spray Bottle',
    syn: ['spray bottle', 'sprayer', 'mister', 'cleaner', 'pump sprayer', 'squirt'],
    tags: ['garden', 'plastic', 'silly', 'modern'],
    desc: 'trigger spray bottle',
    color: '#3aa0d8',
    accent: '#f2efe8',
    variants: [
      { v: 'trigger', p: { t: 0 }, desc: 'round trigger spray bottle' },
      { v: 'cleaner', p: { t: 1 }, desc: 'flat cleaning spray bottle' },
      { v: 'pump', p: { t: 2 }, desc: 'garden pump sprayer tank with lance', noun: 'Pump Sprayer' },
    ],
    draw(k, p) {
      if (p.t === 2) {
        k.lathe(
          'main',
          [
            [0, -0.36],
            [0.075, -0.36],
            [0.08, -0.34],
            [0.08, -0.12],
            [0.06, -0.08],
            [0.025, -0.07],
            [0, -0.07],
          ],
          10,
        );
        k.rod('accent', [0, -0.08, 0], [0, 0.0, 0], 0.012, 0.012, 6);
        k.rod('accent', [-0.06, 0, 0], [0.06, 0, 0], 0.014, 0.014, 6);
        k.tube(
          'dark',
          [
            [0, -0.33, -0.075],
            [0, -0.3, -0.13],
            [0, -0.18, -0.15],
            [0, -0.12, -0.16],
          ],
          0.007,
          8,
          4,
        );
        k.zrod('dark', -0.2, -0.12, 0.013, 0.013, 6, 0, -0.12);
        k.zrod('metal', -0.5, -0.2, 0.005, 0.005, 6, 0, -0.12);
        k.zrod('brass', -0.53, -0.5, 0.004, 0.011, 6, 0, -0.12);
        return;
      }
      k.box('accent', [0.03, 0.035, 0.08], { p: [0, 0.03, -0.015] });
      k.zrod('dark', -0.07, -0.05, 0.008, 0.008, 6, 0, 0.035);
      k.box('accent', [0.016, 0.05, 0.01], { p: [0, -0.005, -0.045], r: [0.25, 0, 0] });
      k.rod('accent', [0, -0.03, 0], [0, 0.014, 0], 0.017, 0.017, 8);
      if (p.t === 0) {
        k.lathe(
          'main',
          [
            [0, -0.22],
            [0.04, -0.22],
            [0.045, -0.2],
            [0.042, -0.07],
            [0.022, -0.04],
            [0.014, -0.022],
          ],
          8,
        );
      } else {
        k.box('main', [0.045, 0.17, 0.085], { p: [0, -0.135, 0.008] });
        k.rod('main', [0, -0.05, 0], [0, -0.025, 0], 0.03, 0.016, 8);
        k.box('main', [0.045, 0.02, 0.07], { p: [0, -0.055, 0.0] });
      }
    },
    anchors(p) {
      if (p.t === 2)
        return {
          tip: [0, -0.12, -0.53],
          rear: [0, -0.2, 0.08],
          top: [0, 0.014, 0],
          grip: [0, -0.014, 0.03],
          under: [0, -0.36, 0],
          side: [0.08, -0.2, 0],
          mag: [0, -0.36, 0.03],
        };
      return {
        tip: [0, 0.035, -0.07],
        rear: [0, 0.03, 0.025],
        top: [0, 0.0475, -0.015],
        grip: p.t === 0 ? [0, -0.1, -0.044] : [0, -0.1, -0.0345],
        under: [0, p.t === 0 ? -0.22 : -0.22, 0.0],
        side: [p.t === 0 ? 0.044 : 0.0225, -0.12, 0],
      };
    },
    roles: ['mag', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol', 'bubble_gun'],
    selfGrip: true,
    fireMode: 'stream',
    ammo: 'water',
  },
];
