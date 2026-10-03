/** weapon objects. See objkit.ts for the canonical frame + roles. */
import type { Anchors, ObjSpec, P } from './objkit';
import type { Kit, Pt, Slot } from '../../lib/kit';
import { chamferRect, circlePts, starPts } from '../../lib/kit';
import type { Vec3 } from '../../types';

const PI = Math.PI;

/* ---------------- shared helpers ---------------- */

/** Closed blade outline from top/bottom edge functions of t in [0,1]; u = -t*L (pinched tip). */
function outline(L: number, top: (t: number) => number, bot: (t: number) => number, n = 8): Pt[] {
  const up: Pt[] = [];
  const dn: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    up.push([-t * L, top(t)]);
    dn.push([-t * L, bot(t)]);
  }
  return [...dn, [-L, (top(1) + bot(1)) / 2], ...up.reverse()];
}

/** Grip wrap rings along Z. */
function wraps(k: Kit, z0: number, z1: number, r: number, n: number, slot: Slot = 'accent', y = 0) {
  const step = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + (i + 0.5) * step;
    k.zrod(slot, z - step * 0.28, z + step * 0.28, r * 1.12, r * 1.12, 6, 0, y);
  }
}

/** Points between a and b (exclusive of neither) with a downward parabolic sag. */
function chainLine(a: Vec3, b: Vec3, n: number, sag = 0): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** Interlocking chain links at the given centres (links tilt in the YZ plane to follow the chain). */
function chain(k: Kit, pts: Vec3[], slot: Slot = 'metal', R = 0.011) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const al = Math.atan2(-(b[1] - a[1]), b[2] - a[2]);
    if (i % 2 === 0) k.torus(slot, R, R * 0.28, { p: pts[i], r: [PI / 2 + al, 0, 0], s: [1, 1.5, 1] }, 3, 5);
    else k.torus(slot, R, R * 0.28, { p: pts[i], r: [al, PI / 2, 0], s: [1.5, 1, 1] }, 3, 5);
  }
}

const PHI = 1.618;
const ICO: Vec3[] = (
  [
    [0, 1, PHI],
    [0, -1, PHI],
    [0, 1, -PHI],
    [0, -1, -PHI],
    [1, PHI, 0],
    [-1, PHI, 0],
    [1, -PHI, 0],
    [-1, -PHI, 0],
    [PHI, 0, 1],
    [-PHI, 0, 1],
    [PHI, 0, -1],
    [-PHI, 0, -1],
  ] as Vec3[]
).map((d) => {
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l] as Vec3;
});
const AX6: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, -1],
  [0.7, 0, 0.7],
];

function spikedBall(k: Kit, c: Vec3, r: number, sp: number, dirs: Vec3[], slot: Slot = 'main', sslot: Slot = 'metal', detail = 0) {
  k.ball(slot, r, c, detail);
  for (const d of dirs) {
    k.rod(sslot, [c[0] + d[0] * r * 0.8, c[1] + d[1] * r * 0.8, c[2] + d[2] * r * 0.8], [c[0] + d[0] * (r + sp), c[1] + d[1] * (r + sp), c[2] + d[2] * (r + sp)], r * 0.32, 0, 3);
  }
}

/** Haft: wooden (or other) pole from -F to Lr with a grip wrap near the hand and a butt cap. */
function haft(k: Kit, F: number, Lr: number, r: number, slot: Slot = 'wood', wrap: Slot | null = 'accent') {
  k.zrod(slot, -F - 0.01, Lr - 0.02, r, r, 6);
  k.zrod('metal', Lr - 0.025, Lr, r * 1.2, r * 1.1, 6);
  if (wrap) k.zrod(wrap, -0.1, Math.min(0.12, Lr - 0.03), r * 1.15, r * 1.15, 6);
}

function haftAnchors(tipY: number, tipZ: number, F: number, Lr: number, r: number): Anchors {
  return {
    tip: [0, tipY, tipZ],
    rear: [0, 0, Lr],
    top: [0, r, -F * 0.5],
    grip: [0, -r * 1.15, Math.min(0.05, Lr * 0.4)],
    under: [0, -r, -F * 0.75],
    side: [r, 0, -F * 0.3],
  };
}

/** Mirror a right-half outline (x >= 0, listed top centre -> bottom centre) into a full closed outline. */
function mirrorHalf(half: Pt[]): Pt[] {
  const left = half
    .slice(1, -1)
    .reverse()
    .map(([x, y]) => [-x, y] as Pt);
  return [...half, ...left];
}

/** Shield back handle (horizontal bar at the origin) with stand-offs to the shield back at zb. */
function shieldHandle(k: Kit, zb: number) {
  k.rod('wood', [-0.055, 0, 0], [0.055, 0, 0], 0.014, 0.014, 6);
  for (const s of [-1, 1]) k.box('metal', [0.012, 0.022, -zb], { p: [s * 0.055, 0, zb / 2] });
}

/** Offset a centreline polyline (x,z) into a strip outline of width w with rounded ends. */
function strip(c: Pt[], w: number): Pt[] {
  const L: Pt[] = [];
  const R: Pt[] = [];
  const n = c.length;
  for (let i = 0; i < n; i++) {
    const a = c[Math.max(0, i - 1)];
    const b = c[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const hw = (w / 2) * (i === 0 || i === n - 1 ? 0.8 : 1);
    L.push([c[i][0] - dz * hw, c[i][1] + dx * hw]);
    R.push([c[i][0] + dz * hw, c[i][1] - dx * hw]);
  }
  const end = (i: number, j: number): Pt => {
    const dx = c[i][0] - c[j][0];
    const dz = c[i][1] - c[j][1];
    const l = Math.hypot(dx, dz) || 1;
    return [c[i][0] + (dx / l) * w * 0.35, c[i][1] + (dz / l) * w * 0.35];
  };
  return [end(0, 1), ...L, end(n - 1, n - 2), ...R.reverse()];
}

/* ---------------- boomerang data ---------------- */

function boomArms(p: P): Pt[][] {
  if (p.st === 2) {
    const c: Pt = [0, -0.15];
    return [90, 210, 330].map((deg) => {
      const a = (deg * PI) / 180;
      const e: Pt = [c[0] + Math.cos(a) * 0.2, c[1] + Math.sin(a) * 0.2];
      const m: Pt = [(c[0] + e[0]) / 2 - Math.sin(a) * 0.015, (c[1] + e[1]) / 2 + Math.cos(a) * 0.015];
      return [c, m, e];
    });
  }
  if (p.st === 1)
    return [
      [
        [0, 0.08],
        [0.006, -0.12],
        [0.03, -0.32],
        [0.075, -0.46],
        [0.13, -0.56],
      ],
    ];
  return [
    [
      [0, 0.07],
      [0.004, -0.08],
      [0.025, -0.19],
      [0.09, -0.245],
      [0.2, -0.2],
      [0.3, -0.12],
    ],
  ];
}

/* ---------------- scythe / glaive blade data ---------------- */

function scytheEdge(p: P) {
  const zc = (t: number) => -0.06 - 0.09 * Math.sin(PI * t) + 0.07 * t;
  const spine = (t: number) => zc(t) - p.W * 0.3 * (1 - t);
  const edge = (t: number) => zc(t) + p.W * Math.pow(1 - t, 0.8);
  return { zc, spine, edge };
}

function scythePts(p: P): Pt[] {
  const { spine, edge } = scytheEdge(p);
  const a: Pt[] = [];
  const b: Pt[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    a.push([spine(t), p.Lb * t]);
    b.push([edge(t), p.Lb * t]);
  }
  const { zc } = scytheEdge(p);
  return [...a, [zc(1), p.Lb], ...b.reverse()];
}

function glaiveFns(p: P) {
  const bot = (t: number) => -p.W * 0.3 + p.c * t * t;
  const top = (t: number) => bot(t) + p.W * (0.85 + 0.3 * Math.sin(PI * t)) * (t > 0.8 ? (1 - t) * 5 : 1);
  return { top, bot };
}

/* ---------------- claws helpers ---------------- */

function clawFns(p: P) {
  const c = p.st === 0 ? 0.6 : 0.05;
  const top = (t: number) => 0.007 - c * p.cl * t * t;
  const bot = (t: number) => top(t) - 0.016 * (1 - t * 0.7);
  return { top, bot };
}

/* ================================================================ */

export const WEAPONWORLD: ObjSpec[] = [
  /* ---------------- SHIELDS ---------------- */
  {
    kind: 'round-shield',
    group: 'weapon',
    noun: 'Round Shield',
    syn: ['shield', 'round shield', 'viking shield', 'buckler', 'targe', 'board'],
    tags: ['medieval', 'viking', 'wood', 'heavy'],
    desc: 'round wooden shield with iron boss',
    color: '#8a5a32',
    accent: '#b3261e',
    variants: [
      { v: 'viking', p: { R: 0.4, dd: 0, rb: 0.07, sp: 0, st: 1 }, desc: 'painted viking round shield' },
      { v: 'buckler', p: { R: 0.16, dd: 0.04, rb: 0.05, sp: 0, st: 0 }, desc: 'small domed steel buckler', noun: 'Buckler' },
      { v: 'targe', p: { R: 0.28, dd: 0.02, rb: 0.05, sp: 0.12, st: 0 }, desc: 'highland targe with long spike', noun: 'Targe' },
    ],
    draw(k, p) {
      const zf = -0.09;
      const zb = zf + 0.01;
      const zc = zf - p.dd;
      k.zlathe(
        'main',
        [
          [0.0001, zc - 0.005],
          [p.R * 0.55, zf - 0.005 - p.dd * 0.7],
          [p.R, zf - 0.005],
          [p.R, zb],
          [0.0001, zb],
        ],
        12,
      );
      k.torus('metal', p.R, 0.012, { p: [0, 0, zf] }, 3, 12);
      k.sphere('metal', p.rb, { p: [0, 0, zc - 0.005 + p.rb * 0.3], r: [-PI / 2, 0, 0] }, 8, 3, PI / 2);
      if (p.sp) k.rod('metal', [0, 0, zc - p.rb * 0.6], [0, 0, zc - 0.005 - p.rb * 0.7 - p.sp], p.rb * 0.35, 0, 6);
      if (p.st) {
        k.box('accent', [0.07, p.R * 1.94, 0.004], { p: [0, 0, zf - 0.007] });
        k.box('accent', [p.R * 1.94, 0.07, 0.004], { p: [0, 0, zf - 0.007] });
      }
      shieldHandle(k, zb);
    },
    anchors(p) {
      const zf = -0.09;
      const zc = zf - p.dd - 0.005;
      return {
        tip: [0, 0, zc - p.rb * 0.7 - p.sp],
        rear: [0, 0, 0.014],
        top: [0, p.R, zf],
        grip: [0, -0.014, 0],
        under: [0, -p.R, zf],
        side: [p.R, 0, zf],
        mag: [0, -p.R * 0.5, zf + 0.01],
      };
    },
    roles: ['deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },
  {
    kind: 'heater-shield',
    group: 'weapon',
    noun: 'Heater Shield',
    syn: ['shield', 'heater shield', 'kite shield', 'tower shield', 'knight shield', 'scutum', 'crest'],
    tags: ['medieval', 'royal', 'heavy', 'fantasy'],
    desc: 'knightly heraldic shield with steel rim',
    color: '#24407a',
    accent: '#e0b23a',
    variants: [
      { v: 'heater', p: { W: 0.5, H: 0.62, sh: 0, dec: 0 }, desc: 'heater shield with heraldic cross' },
      { v: 'kite', p: { W: 0.45, H: 0.9, sh: 1, dec: 1 }, desc: 'tall norman kite shield with chevron', noun: 'Kite Shield' },
      { v: 'tower', p: { W: 0.55, H: 1.0, sh: 2, dec: 2 }, desc: 'huge rectangular tower shield', noun: 'Tower Shield' },
    ],
    draw(k, p) {
      const zf = -0.08;
      const pts = heaterPts(p);
      k.extrude('main', pts, 0.02, 'xy', { p: [0, 0, zf] });
      k.extrude(
        'metal',
        pts.map(([x, y]) => [x * 1.05, y * 1.04] as Pt),
        0.012,
        'xy',
        { p: [0, 0, zf + 0.012] },
      );
      const zd = zf - 0.012;
      if (p.dec === 0) {
        k.box('accent', [0.05, p.H * 0.82, 0.004], { p: [0, -p.H * 0.09, zd] });
        k.box('accent', [p.W * 0.82, 0.05, 0.004], { p: [0, p.H * 0.15, zd] });
      } else if (p.dec === 1) {
        k.extrude(
          'accent',
          [
            [-p.W * 0.42, -p.H * 0.02],
            [0, p.H * 0.2],
            [p.W * 0.42, -p.H * 0.02],
            [p.W * 0.38, -p.H * 0.1],
            [0, p.H * 0.1],
            [-p.W * 0.38, -p.H * 0.1],
          ],
          0.004,
          'xy',
          { p: [0, 0, zd] },
        );
        k.box('accent', [0.04, 0.04, 0.006], { p: [0, 0, zd] });
      } else {
        for (const y of [p.H * 0.32, -p.H * 0.32]) k.box('metal', [p.W * 0.96, 0.035, 0.006], { p: [0, y, zd] });
        k.box('accent', [0.04, p.H * 0.9, 0.004], { p: [0, 0, zd] });
        k.sphere('metal', 0.07, { p: [0, 0, zf - 0.01], r: [-PI / 2, 0, 0] }, 8, 3, PI / 2);
      }
      shieldHandle(k, zf + 0.012);
    },
    anchors(p) {
      const zf = -0.08;
      const top = p.sh === 2 ? p.H / 2 : p.H * 0.4;
      const bot = p.sh === 2 ? -p.H / 2 : -p.H * 0.6;
      const sx = [0.48, 0.45, 0.5][p.sh];
      return {
        tip: [0, 0, p.dec === 2 ? zf - 0.08 : zf - 0.012],
        rear: [0, 0, 0.014],
        top: [0, top, zf],
        grip: [0, -0.014, 0],
        under: [0, bot, zf],
        side: [sx * p.W, 0, zf],
      };
    },
    roles: ['deco'],
    melee: { swing: 'bash', weight: 'heavy' },
  },
  {
    kind: 'riot-shield',
    group: 'weapon',
    noun: 'Riot Shield',
    syn: ['shield', 'riot shield', 'ballistic shield', 'police shield', 'swat shield', 'bunker'],
    tags: ['military', 'heavy', 'scifi'],
    desc: 'police riot shield with viewport',
    color: '#5f7f96',
    accent: '#f2efe8',
    variants: [
      { v: 'riot', p: { W: 0.55, H: 0.95, win: 1, port: 0, feet: 0 }, desc: 'clear riot shield with stripe' },
      { v: 'ballistic', p: { W: 0.5, H: 0.8, win: 0, port: 0, feet: 0 }, desc: 'ballistic shield with narrow viewing slit', noun: 'Ballistic Shield' },
      { v: 'bunker', p: { W: 0.62, H: 1.0, win: 0, port: 1, feet: 1 }, desc: 'bunker shield with gun port', noun: 'Bunker Shield' },
    ],
    draw(k, p) {
      const zf = -0.07;
      const yc = -p.H * 0.15;
      const out = chamferRect(-p.W / 2, yc - p.H / 2, p.W / 2, yc + p.H / 2, 0.05);
      const holes: Pt[][] = [];
      const win =
        p.win === 1
          ? [-p.W * 0.32, yc + p.H * 0.22, p.W * 0.32, yc + p.H * 0.44]
          : [-p.W * 0.2, yc + p.H * 0.3, p.W * 0.2, yc + p.H * 0.38];
      holes.push([
        [win[0], win[1]],
        [win[0], win[3]],
        [win[2], win[3]],
        [win[2], win[1]],
      ]);
      if (p.port)
        holes.push([
          [p.W * 0.24, yc + p.H * 0.12],
          [p.W * 0.24, yc + p.H * 0.2],
          [p.W * 0.36, yc + p.H * 0.2],
          [p.W * 0.36, yc + p.H * 0.12],
        ]);
      k.extrude('main', out, 0.015, 'xy', { p: [0, 0, zf] }, 0, holes);
      k.extrude('dark', chamferRect(-p.W / 2 - 0.012, yc - p.H / 2 - 0.012, p.W / 2 + 0.012, yc + p.H / 2 + 0.012, 0.055), 0.02, 'xy', { p: [0, 0, zf + 0.004] }, 0, [
        chamferRect(-p.W / 2 + 0.03, yc - p.H / 2 + 0.03, p.W / 2 - 0.03, yc + p.H / 2 - 0.03, 0.03),
      ]);
      k.box('#a9d6ea', [win[2] - win[0], win[3] - win[1], 0.006], { p: [(win[0] + win[2]) / 2, (win[1] + win[3]) / 2, zf] });
      if (p.win === 1) k.box('accent', [p.W * 0.9, 0.06, 0.004], { p: [0, yc - p.H * 0.2, zf - 0.009] });
      else k.box('glow', [0.05, 0.03, 0.03], { p: [-p.W * 0.3, yc + p.H * 0.34, zf - 0.02] });
      if (p.feet) for (const s of [-1, 1]) k.box('dark', [0.05, 0.04, 0.16], { p: [s * p.W * 0.33, yc - p.H / 2 + 0.02, zf - 0.07] });
      k.rod('rubber', [0, -0.065, 0], [0, 0.065, 0], 0.014, 0.014, 6);
      for (const y of [-0.06, 0.06]) k.box('dark', [0.02, 0.016, -zf], { p: [0, y, zf / 2] });
    },
    anchors(p) {
      const zf = -0.07;
      const yc = -p.H * 0.15;
      return {
        tip: [0, 0, zf - 0.0075],
        rear: [0, 0, 0.014],
        top: [0, yc + p.H / 2, zf],
        grip: [0, -0.065, 0],
        under: [0, yc - p.H / 2, zf],
        mag: [0, -p.H * 0.3, zf + 0.0075],
        side: [p.W / 2, 0, zf],
      };
    },
    roles: ['deco'],
    melee: { swing: 'bash', weight: 'heavy' },
    guns: ['pistol', 'smg', 'shotgun'],
    ammo: 'bullets',
  },

  /* ---------------- SWORDS ---------------- */
  {
    kind: 'katana-full',
    group: 'weapon',
    noun: 'Katana',
    syn: ['katana', 'samurai sword', 'sword', 'blade', 'nihonto', 'wakizashi', 'nodachi', 'gunblade'],
    tags: ['eastern', 'samurai', 'ninja', 'metal'],
    desc: 'samurai katana with tsuba and wrapped tsuka',
    color: '#c9ced6',
    accent: '#b3261e',
    variants: [
      { v: 'katana', p: { B: 0.7, T: 0.27, c: 0.035, W: 0.032 } },
      { v: 'wakizashi', p: { B: 0.45, T: 0.16, c: 0.02, W: 0.03 }, desc: 'short wakizashi companion sword', noun: 'Wakizashi' },
      { v: 'nodachi', p: { B: 0.95, T: 0.33, c: 0.055, W: 0.036 }, desc: 'huge two-handed nodachi field sword', noun: 'Nodachi' },
    ],
    draw(k, p) {
      const z0 = -0.012;
      const spine = (t: number) => p.W / 2 + p.c * t * t;
      k.blade('main', outline(p.B, spine, (t) => spine(t) - p.W * (t > 0.88 ? 1 - (t - 0.88) * 7.5 : 1), 8), 0.008, 'zy', { p: [0, 0, z0] });
      k.box('brass', [0.012, p.W * 1.15, 0.026], { p: [0, 0, -0.016] });
      k.zrod('dark', -0.004, 0.004, 0.038, 0.038, 8);
      k.zrod('dark', 0.004, p.T, 0.016, 0.015, 6);
      const n = Math.round(p.T / 0.05);
      for (let i = 0; i < n; i++) {
        const z = 0.02 + (i * (p.T - 0.04)) / (n - 1);
        for (const s of [-1, 1]) k.box('accent', [0.013, 0.013, 0.012], { p: [s * 0.012, 0, z], r: [0, 0, PI / 4] });
      }
      k.zrod('brass', p.T - 0.01, p.T + 0.008, 0.017, 0.017, 6);
    },
    anchors(p) {
      const z0 = -0.012;
      const spine = (t: number) => p.W / 2 + p.c * t * t;
      return {
        tip: [0, spine(1) - 0.05 * p.W, z0 - p.B],
        rear: [0, 0, p.T + 0.008],
        top: [0, spine(0.4), z0 - 0.4 * p.B],
        grip: [0, -0.016, 0.08],
        under: [0, spine(0.5) - p.W, z0 - 0.5 * p.B],
        side: [0.016, 0, 0.1],
      };
    },
    roles: ['deco'],
    melee: { swing: 'slash', weight: 'medium' },
    guns: ['rifle', 'sniper'],
    ammo: 'sword beams',
  },
  {
    kind: 'cutlass',
    group: 'weapon',
    noun: 'Cutlass',
    syn: ['cutlass', 'pirate sword', 'sabre', 'saber', 'hanger', 'sword', 'scimitar'],
    tags: ['pirate', 'metal', 'ornate'],
    desc: 'curved pirate cutlass with brass guard',
    color: '#c9ced6',
    accent: '#3a2618',
    variants: [
      { v: 'pirate', p: { B: 0.62, W: 0.045, c: 0.06, T: 0.12, g: 1 }, desc: 'pirate cutlass with brass basket guard' },
      { v: 'hanger', p: { B: 0.48, W: 0.04, c: 0.025, T: 0.11, g: 2 }, desc: 'short hunting hanger with shell guard', noun: 'Hanger' },
      { v: 'sabre', p: { B: 0.78, W: 0.03, c: 0.08, T: 0.13, g: 0 }, desc: 'long cavalry sabre with knuckle bow', noun: 'Sabre' },
    ],
    draw(k, p) {
      const z0 = -0.012;
      const top = (t: number) => p.W / 2 + p.c * t * t;
      const bot = (t: number) => top(t) - p.W * (1 + 0.35 * t) * (t > 0.85 ? 1 - (t - 0.85) * 6 : 1);
      k.blade('main', outline(p.B, top, bot, 8), 0.008, 'zy', { p: [0, 0, z0] });
      k.zrod('accent', 0.004, p.T, 0.014, 0.016, 6);
      k.ball('brass', 0.016, [0, 0, p.T + 0.01], 0);
      k.box('brass', [0.014, 0.08, 0.012], { p: [0, -0.012, 0] });
      k.tube(
        'brass',
        [
          [0, -0.05, 0],
          [0, -0.07, 0.03],
          [0, -0.065, p.T * 0.75],
          [0, -0.02, p.T + 0.004],
        ],
        0.005,
        8,
        4,
      );
      if (p.g === 1)
        k.zlathe(
          'brass',
          [
            [0.016, 0.0],
            [0.05, 0.012],
            [0.062, 0.045],
            [0.056, 0.05],
            [0.045, 0.02],
            [0.016, 0.008],
          ],
          8,
          [0, -0.012, 0],
        );
      if (p.g === 2) k.extrude('brass', circlePts(0.035, 8, 0, -0.012), 0.005, 'xy', { p: [0, 0, 0.006] });
    },
    anchors(p) {
      const z0 = -0.012;
      const top = (t: number) => p.W / 2 + p.c * t * t;
      return {
        tip: [0, top(1) - 0.5 * p.W * 1.35 * 0.1, z0 - p.B],
        rear: [0, 0, p.T + 0.026],
        top: [0, top(0.4), z0 - 0.4 * p.B],
        grip: [0, -0.015, 0.06],
        under: [0, top(0.5) - p.W * 1.175, z0 - 0.5 * p.B],
        side: [0.015, 0, 0.07],
      };
    },
    roles: ['deco'],
    melee: { swing: 'slash', weight: 'medium' },
  },
  {
    kind: 'rapier',
    group: 'weapon',
    noun: 'Rapier',
    syn: ['rapier', 'fencing sword', 'epee', 'smallsword', 'musketeer sword', 'foil', 'sword'],
    tags: ['royal', 'ornate', 'metal', 'light'],
    desc: 'slender rapier with swept hilt',
    color: '#d3d8de',
    accent: '#c99a2e',
    variants: [
      { v: 'swept', p: { B: 0.95, T: 0.14, g: 0, cg: 0.12 }, desc: 'swept-hilt rapier with side rings' },
      { v: 'cup', p: { B: 1.0, T: 0.15, g: 1, cg: 0.14 }, desc: 'spanish cup-hilt rapier' },
      { v: 'small', p: { B: 0.7, T: 0.11, g: 2, cg: 0.06 }, desc: 'court smallsword with shell guard', noun: 'Smallsword' },
    ],
    draw(k, p) {
      const z0 = -0.012;
      k.blade(
        'main',
        [
          [0, -0.011],
          [-p.B * 0.15, -0.008],
          [-p.B, 0],
          [-p.B * 0.15, 0.008],
          [0, 0.011],
        ],
        0.006,
        'zy',
        { p: [0, 0, z0] },
      );
      k.rod('accent', [0, -p.cg, 0], [0, p.cg, 0], 0.005, 0.005, 6);
      for (const s of [-1, 1]) k.ball('accent', 0.009, [0, s * p.cg, 0], 0);
      k.zrod('dark', 0.004, p.T, 0.013, 0.015, 6);
      wraps(k, 0.01, p.T - 0.01, 0.013, 3, 'accent');
      k.ball('accent', 0.02, [0, 0, p.T + 0.018], 0);
      if (p.g !== 1)
        k.tube(
          'accent',
          [
            [0, -0.035, -0.002],
            [0, -0.06, 0.03],
            [0, -0.055, p.T * 0.75],
            [0, -0.015, p.T + 0.006],
          ],
          0.0045,
          8,
          4,
        );
      if (p.g === 0) {
        k.torus('accent', 0.03, 0.004, { p: [0, 0, -0.035], r: [PI / 2, 0, 0] }, 3, 10);
        k.torus('accent', 0.028, 0.004, { p: [0, -0.025, -0.01], r: [0, PI / 2, 0] }, 3, 10);
      } else if (p.g === 1) {
        k.zlathe(
          'accent',
          [
            [0.01, -0.075],
            [0.045, -0.062],
            [0.066, -0.032],
            [0.07, 0.0],
            [0.064, 0.0],
            [0.058, -0.026],
            [0.04, -0.054],
            [0.01, -0.067],
          ],
          10,
        );
      } else {
        k.ball('accent', 0.042, [0, 0, -0.004], 0, [1, 1, 0.22]);
      }
    },
    anchors(p) {
      const z0 = -0.012;
      return {
        tip: [0, 0, z0 - p.B],
        rear: [0, 0, p.T + 0.038],
        top: [0, 0.005, z0 - 0.5 * p.B],
        grip: [0, -0.014, 0.06],
        under: [0, -0.005, z0 - 0.5 * p.B],
        side: [0.014, 0, 0.07],
      };
    },
    roles: ['deco'],
    melee: { swing: 'thrust', weight: 'light' },
  },
  {
    kind: 'broadsword',
    group: 'weapon',
    noun: 'Broadsword',
    syn: ['broadsword', 'sword', 'longsword', 'claymore', 'gladius', 'arming sword', 'knight sword'],
    tags: ['medieval', 'royal', 'metal', 'fantasy'],
    desc: 'double-edged sword with crossguard',
    color: '#c9ced6',
    accent: '#5a3a22',
    variants: [
      { v: 'arming', p: { B: 0.75, W: 0.05, T: 0.13, cg: 0.1, st: 0 }, desc: 'knightly arming sword with wheel pommel', noun: 'Arming Sword' },
      { v: 'longsword', p: { B: 0.92, W: 0.048, T: 0.25, cg: 0.12, st: 1 }, desc: 'hand-and-a-half longsword', noun: 'Longsword' },
      { v: 'claymore', p: { B: 1.0, W: 0.055, T: 0.32, cg: 0.17, st: 2 }, desc: 'giant claymore with angled quillons', noun: 'Claymore' },
      { v: 'gladius', p: { B: 0.5, W: 0.06, T: 0.1, cg: 0.05, st: 3 }, desc: 'roman gladius with leaf blade', noun: 'Gladius' },
    ],
    draw(k, p) {
      const z0 = -0.012;
      const W = p.W;
      const pts: Pt[] =
        p.st === 3
          ? [
              [0, -W * 0.4],
              [-p.B * 0.6, -W * 0.5],
              [-p.B * 0.88, -W * 0.38],
              [-p.B, 0],
              [-p.B * 0.88, W * 0.38],
              [-p.B * 0.6, W * 0.5],
              [0, W * 0.4],
            ]
          : [
              [0, -W / 2],
              [-p.B * 0.85, -W * 0.42],
              [-p.B, 0],
              [-p.B * 0.85, W * 0.42],
              [0, W / 2],
            ];
      k.blade('main', pts, 0.009, 'zy', { p: [0, 0, z0] });
      if (p.st !== 3) k.box('dark', [0.0098, W * 0.18, p.B * 0.6], { p: [0, 0, z0 - p.B * 0.35] });
      if (p.st === 2) {
        for (const s of [-1, 1]) {
          k.rod('metal', [0, 0, 0], [0, s * p.cg, -0.07], 0.008, 0.007, 6);
          k.torus('metal', 0.018, 0.004, { p: [0, s * p.cg, -0.07], r: [0, PI / 2, 0] }, 3, 8);
        }
        k.box('metal', [0.02, 0.05, 0.02], { p: [0, 0, 0] });
      } else if (p.st === 3) {
        k.ball('brass', 0.045, [0, 0, 0.004], 0, [0.7, 1, 0.35]);
      } else {
        k.box('metal', [0.016, p.cg * 2, 0.016], { p: [0, 0, 0] });
      }
      k.zrod(p.st === 3 ? 'wood' : 'accent', 0.008, p.T, 0.015, 0.016, 6);
      if (p.st !== 3) wraps(k, 0.015, p.T - 0.01, 0.0145, Math.max(2, Math.round(p.T / 0.05)), 'dark');
      if (p.st <= 1) k.rod('metal', [-0.009, 0, p.T + 0.02], [0.009, 0, p.T + 0.02], 0.025, 0.025, 8);
      else k.ball(p.st === 3 ? 'brass' : 'metal', 0.03, [0, 0, p.T + 0.024], 0);
    },
    anchors(p) {
      const z0 = -0.012;
      return {
        tip: [0, 0, z0 - p.B],
        rear: [0, 0, p.T + (p.st <= 1 ? 0.045 : 0.054)],
        top: [0, 0.45 * p.W, z0 - 0.4 * p.B],
        grip: [0, -0.016, 0.06],
        under: [0, -0.45 * p.W, z0 - 0.45 * p.B],
        side: [0.016, 0, p.T * 0.5],
      };
    },
    roles: ['deco'],
    melee: { swing: 'slash', weight: 'medium' },
  },

  /* ---------------- HAFTED / POLEARMS ---------------- */
  {
    kind: 'warhammer',
    group: 'weapon',
    noun: 'War Hammer',
    syn: ['warhammer', 'war hammer', 'lucerne hammer', 'war pick', 'hammer', 'bec de corbin'],
    tags: ['medieval', 'brutal', 'heavy', 'metal'],
    desc: 'spiked knightly war hammer',
    color: '#8d949e',
    accent: '#5a3a22',
    variants: [
      { v: 'footman', p: { F: 0.5, Lr: 0.12, fl: 0.05, sl: 0.1, ts: 0.07, pr: 0, mt: 0 }, desc: "footman's war hammer with back spike" },
      { v: 'lucerne', p: { F: 1.3, Lr: 0.4, fl: 0.04, sl: 0.14, ts: 0.22, pr: 1, mt: 0 }, desc: 'lucerne pole hammer with prongs', noun: 'Lucerne Hammer' },
      { v: 'pick', p: { F: 0.55, Lr: 0.12, fl: 0.025, sl: 0.2, ts: 0.04, pr: 0, mt: 1 }, desc: 'steel war pick with long spike', noun: 'War Pick' },
    ],
    draw(k, p) {
      warhammerHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      haft(k, p.F, p.Lr, 0.016, p.mt ? 'metal' : 'wood');
    },
    head: (k, p) => warhammerHead(k, p),
    anchors: (p) => haftAnchors(0, -p.F - 0.075 - p.ts, p.F, p.Lr, 0.016),
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
  },
  {
    kind: 'maul',
    group: 'weapon',
    noun: 'Maul',
    syn: ['maul', 'sledgehammer', 'great hammer', 'sledge', 'hammer', 'mallet'],
    tags: ['medieval', 'brutal', 'heavy', 'metal'],
    desc: 'massive two-handed maul',
    color: '#5c6169',
    accent: '#5a3a22',
    variants: [
      { v: 'sledge', p: { F: 0.7, Lr: 0.15, bl: 0.2, bs: 0.07, sp: 0 }, desc: 'iron sledge maul' },
      { v: 'great', p: { F: 0.85, Lr: 0.2, bl: 0.28, bs: 0.11, sp: 0 }, desc: 'enormous banded great maul' },
      { v: 'spiked', p: { F: 0.75, Lr: 0.15, bl: 0.22, bs: 0.085, sp: 1 }, desc: 'spiked brutal maul' },
    ],
    draw(k, p) {
      maulHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      haft(k, p.F, p.Lr, 0.019);
    },
    head: (k, p) => maulHead(k, p),
    anchors: (p) => haftAnchors(0, -p.F - 0.012 - p.bs * 1.1, p.F, p.Lr, 0.019),
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
  },
  {
    kind: 'halberd',
    group: 'weapon',
    noun: 'Halberd',
    syn: ['halberd', 'polearm', 'bardiche', 'poleaxe', 'pole axe', 'pike', 'gun-halberd'],
    tags: ['medieval', 'royal', 'heavy', 'metal'],
    desc: 'tall halberd with axe and spike',
    color: '#aab1ba',
    accent: '#5a3a22',
    variants: [
      { v: 'swiss', p: { F: 1.3, Lr: 0.35, a: 1, hook: 1, sp: 0.25, cres: 0 }, desc: 'swiss halberd with back hook' },
      { v: 'bardiche', p: { F: 1.25, Lr: 0.35, a: 1, hook: 0, sp: 0.28, cres: 1 }, desc: 'crescent-bladed bardiche', noun: 'Bardiche' },
      { v: 'poleaxe', p: { F: 1.0, Lr: 0.3, a: 0.7, hook: 2, sp: 0.18, cres: 0 }, desc: 'knightly poleaxe with hammer back', noun: 'Poleaxe' },
    ],
    draw(k, p) {
      halberdHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      haft(k, p.F, p.Lr, 0.018);
    },
    head: (k, p) => halberdHead(k, p),
    anchors: (p) => haftAnchors(0, -p.F - 0.13 - p.sp, p.F, p.Lr, 0.018),
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
    guns: ['rifle'],
  },
  {
    kind: 'glaive',
    group: 'weapon',
    noun: 'Glaive',
    syn: ['glaive', 'naginata', 'guandao', 'polearm', 'pole blade', 'kwan dao'],
    tags: ['medieval', 'eastern', 'fantasy', 'metal'],
    desc: 'polearm with long curved blade',
    color: '#c9ced6',
    accent: '#b3261e',
    variants: [
      { v: 'glaive', p: { F: 1.15, Lr: 0.4, L: 0.5, W: 0.07, c: 0.06, st: 0 } },
      { v: 'naginata', p: { F: 1.2, Lr: 0.35, L: 0.55, W: 0.04, c: 0.07, st: 1 }, desc: 'samurai naginata with tsuba', noun: 'Naginata' },
      { v: 'guandao', p: { F: 1.15, Lr: 0.4, L: 0.55, W: 0.11, c: 0.09, st: 2 }, desc: 'broad guandao with red tassel', noun: 'Guandao' },
    ],
    draw(k, p) {
      glaiveHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      haft(k, p.F, p.Lr, 0.018, p.st === 1 ? '#24201c' : 'wood');
    },
    head: (k, p) => glaiveHead(k, p),
    anchors(p) {
      const { bot } = glaiveFns(p);
      return haftAnchors(bot(1), -p.F - 0.07 - p.L, p.F, p.Lr, 0.018);
    },
    roles: ['head', 'deco'],
    melee: { swing: 'slash', weight: 'heavy' },
  },
  {
    kind: 'spear',
    group: 'weapon',
    noun: 'Spear',
    syn: ['spear', 'boar spear', 'yari', 'javelin', 'lance', 'polearm', 'pike'],
    tags: ['medieval', 'tribal', 'eastern', 'wood'],
    desc: 'long spear with steel head',
    color: '#aab1ba',
    accent: '#5a3a22',
    variants: [
      { v: 'leaf', p: { F: 1.0, Lr: 0.6, sl: 0.25, sw: 0.065, st: 0 }, desc: 'leaf-bladed infantry spear' },
      { v: 'boar', p: { F: 1.0, Lr: 0.5, sl: 0.3, sw: 0.075, st: 1 }, desc: 'boar spear with crossbar lugs' },
      { v: 'yari', p: { F: 1.1, Lr: 0.55, sl: 0.3, sw: 0.032, st: 2 }, desc: 'straight samurai yari', noun: 'Yari' },
    ],
    draw(k, p) {
      spearHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      haft(k, p.F, p.Lr, 0.017, p.st === 2 ? '#24201c' : 'wood');
    },
    head: (k, p) => spearHead(k, p),
    anchors: (p) => haftAnchors(0, -p.F - 0.11 - p.sl, p.F, p.Lr, 0.017),
    roles: ['head', 'deco'],
    melee: { swing: 'thrust', weight: 'medium' },
  },
  {
    kind: 'lance',
    group: 'weapon',
    noun: 'Lance',
    syn: ['lance', 'jousting lance', 'knight lance', 'cavalry lance', 'joust', 'tilt'],
    tags: ['medieval', 'royal', 'heavy', 'wood'],
    desc: 'knightly lance with steel vamplate',
    color: '#e8e2d2',
    accent: '#24407a',
    variants: [
      { v: 'joust', p: { L: 2.0, vr: 0.16, sr: 0.055, st: 0 }, desc: 'fat jousting lance with coronel tip' },
      { v: 'cavalry', p: { L: 1.85, vr: 0.1, sr: 0.04, st: 1 }, desc: 'cavalry lance with swallowtail pennant' },
      { v: 'war', p: { L: 1.7, vr: 0.12, sr: 0.045, st: 2 }, desc: 'war lance with steel point' },
    ],
    draw(k, p) {
      const s = p.sr;
      const end = p.st === 1 ? -p.L : -p.L + (p.st === 0 ? 0.05 : 0.18);
      k.zlathe(
        'main',
        [
          [s * 0.8, -0.06],
          [s, -0.3],
          [s * 0.6, -p.L * 0.65],
          [p.st === 1 ? 0.0001 : s * 0.3, end],
        ],
        8,
      );
      for (const f of [0.25, 0.42, 0.6]) k.zrod('accent', -p.L * f - 0.02, -p.L * f + 0.02, s * (1 - f * 0.55) + 0.003, s * (1 - f * 0.6) + 0.003, 8);
      k.zlathe(
        'metal',
        [
          [0.0001, -0.26],
          [s * 0.9, -0.26],
          [p.vr, -0.06],
          [0.0001, -0.06],
        ],
        10,
      );
      k.zrod('dark', -0.06, 0.25, 0.022, 0.022, 6);
      k.zlathe(
        'accent',
        [
          [0.022, 0.24],
          [0.032, 0.3],
          [0.0001, 0.32],
        ],
        8,
      );
      if (p.st === 0) {
        k.zrod('metal', end + 0.01, end - 0.04, s * 0.32, s * 0.5, 6);
        for (let i = 0; i < 3; i++) {
          const a = (i * 2 * PI) / 3;
          k.rod('metal', [Math.cos(a) * 0.018, Math.sin(a) * 0.018, end - 0.035], [Math.cos(a) * 0.02, Math.sin(a) * 0.02, -p.L], 0.008, 0, 4);
        }
      } else if (p.st === 2) {
        k.zrod('metal', end + 0.03, end - 0.03, s * 0.32, s * 0.25, 6);
        k.blade(
          'metal',
          [
            [0, -0.012],
            [-0.06, -0.028],
            [-0.18, 0],
            [-0.06, 0.028],
            [0, 0.012],
          ],
          0.01,
          'zy',
          { p: [0, 0, end] },
        );
      } else {
        k.extrude(
          'accent',
          [
            [-0.62, 0.02],
            [-0.45, 0.02],
            [-0.24, 0.07],
            [-0.36, 0.12],
            [-0.24, 0.18],
            [-0.62, 0.17],
          ],
          0.004,
          'zy',
        );
      }
    },
    anchors(p) {
      return {
        tip: [0, 0, p.st === 0 ? -p.L + 0.04 : -p.L],
        rear: [0, 0, 0.32],
        top: [0, p.vr, -0.06],
        grip: [0, -0.022, 0.08],
        under: [0, -p.sr, -0.3],
        side: [p.sr, 0, -0.3],
      };
    },
    roles: ['deco'],
    melee: { swing: 'thrust', weight: 'heavy' },
    guns: ['rocket_launcher'],
    ammo: 'lance rockets',
  },
  {
    kind: 'trident',
    group: 'weapon',
    noun: 'Trident',
    syn: ['trident', 'bident', 'fork', 'poseidon', 'neptune', 'fishing spear', 'sea spear'],
    tags: ['fantasy', 'royal', 'metal'],
    desc: 'barbed sea-god trident',
    color: '#9fb4bf',
    accent: '#c99a2e',
    variants: [
      { v: 'sea', p: { F: 1.1, Lr: 0.4, n: 3, pl: 0.22, sw: 0.06, bb: 1 }, desc: 'barbed three-pronged sea trident' },
      { v: 'bident', p: { F: 1.1, Lr: 0.4, n: 2, pl: 0.25, sw: 0.035, bb: 0 }, desc: 'two-pronged hell bident', noun: 'Bident' },
      { v: 'royal', p: { F: 1.2, Lr: 0.4, n: 5, pl: 0.2, sw: 0.09, bb: 0 }, desc: 'five-pronged royal trident with orb' },
    ],
    draw(k, p) {
      tridentHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      haft(k, p.F, p.Lr, 0.017, 'main', 'accent');
    },
    head: (k, p) => tridentHead(k, p),
    anchors(p) {
      const t = tridentTip(p);
      return haftAnchors(t[1], -p.F + t[2], p.F, p.Lr, 0.017);
    },
    roles: ['head', 'deco'],
    melee: { swing: 'thrust', weight: 'medium' },
    guns: ['shotgun'],
    ammo: 'tri-bolts',
  },
  {
    kind: 'flail',
    group: 'weapon',
    noun: 'Flail',
    syn: ['flail', 'ball and chain', 'morning star', 'chain mace', 'spiked ball', 'military flail'],
    tags: ['medieval', 'brutal', 'metal', 'spooky'],
    desc: 'spiked ball on a chain',
    color: '#4a4e55',
    accent: '#5a3a22',
    variants: [
      { v: 'classic', p: { H: 0.36, n: 5, br: 0.055, nb: 1, sp: 0.035 } },
      { v: 'double', p: { H: 0.38, n: 3, br: 0.04, nb: 2, sp: 0.03 }, desc: 'twin chained spiked balls' },
      { v: 'heavy', p: { H: 0.42, n: 6, br: 0.08, nb: 1, sp: 0.05 }, desc: 'heavy flail with huge ball' },
    ],
    draw(k, p) {
      flailHead(k, p);
      k.transformAll({ p: [0, 0, -0.06] });
      k.zrod('wood', -0.06, p.H - 0.06, 0.017, 0.019, 6);
      if (p.nb === 1) wraps(k, 0.0, p.H - 0.12, 0.018, 2);
      k.ball('metal', 0.022, [0, 0, p.H - 0.05], 0);
    },
    head: (k, p) => flailHead(k, p),
    anchors(p) {
      const b = flailBall(p);
      return {
        tip: [b[0], b[1], b[2] - 0.06 - p.br],
        rear: [0, 0, p.H - 0.03],
        top: [0, 0.018, 0.1],
        grip: [0, -0.018, 0.08],
        under: [b[0], b[1] - p.br, b[2] - 0.06],
        side: [0.018, 0, 0.12],
        mag: [0, -0.018, -0.03],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'spin', weight: 'heavy' },
  },
  {
    kind: 'morning-star',
    group: 'weapon',
    noun: 'Morning Star',
    syn: ['morning star', 'morningstar', 'spiked mace', 'holy water sprinkler', 'spiked club', 'mace'],
    tags: ['medieval', 'brutal', 'heavy', 'metal'],
    desc: 'haft topped with a spiked ball',
    color: '#4a4e55',
    accent: '#5a3a22',
    variants: [
      { v: 'classic', p: { F: 0.55, Lr: 0.12, hr: 0.065, st: 0, sp: 0.05 } },
      { v: 'sprinkler', p: { F: 0.9, Lr: 0.3, hr: 0.045, st: 1, sp: 0.035 }, desc: 'holy water sprinkler with studded head' },
      { v: 'giant', p: { F: 0.7, Lr: 0.2, hr: 0.095, st: 2, sp: 0.07 }, desc: 'giant iron-hafted morning star' },
    ],
    draw(k, p) {
      morningHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      haft(k, p.F, p.Lr, 0.018, p.st === 2 ? 'metal' : 'wood');
    },
    head: (k, p) => morningHead(k, p),
    anchors: (p) => haftAnchors(0, -p.F + morningTipZ(p), p.F, p.Lr, 0.018),
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
  },
  {
    kind: 'mace',
    group: 'weapon',
    noun: 'Mace',
    syn: ['mace', 'flanged mace', 'pernach', 'club', 'cudgel', 'bludgeon'],
    tags: ['medieval', 'royal', 'heavy', 'metal'],
    desc: 'steel flanged mace',
    color: '#9aa1ab',
    accent: '#3a2618',
    variants: [
      { v: 'flanged', p: { F: 0.45, Lr: 0.1, st: 0, hl: 0.12, hr: 0.045 } },
      { v: 'pernach', p: { F: 0.5, Lr: 0.12, st: 1, hl: 0.16, hr: 0.04 }, desc: 'eight-finned cossack pernach', noun: 'Pernach' },
      { v: 'knobbed', p: { F: 0.45, Lr: 0.1, st: 2, hl: 0.11, hr: 0.055 }, desc: 'knobbed ball mace' },
    ],
    draw(k, p) {
      maceHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      haft(k, p.F, p.Lr, 0.015, 'metal');
    },
    head: (k, p) => maceHead(k, p),
    anchors: (p) => haftAnchors(0, -p.F - 0.02 - p.hl - 0.03, p.F, p.Lr, 0.015),
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },
  {
    kind: 'tomahawk',
    group: 'weapon',
    noun: 'Tomahawk',
    syn: ['tomahawk', 'throwing axe', 'hatchet', 'francisca', 'pipe tomahawk', 'axe'],
    tags: ['western', 'tribal', 'wood', 'viking'],
    desc: 'short-hafted throwing tomahawk',
    color: '#9aa1ab',
    accent: '#b3261e',
    variants: [
      { v: 'spike', p: { F: 0.33, Lr: 0.08, bw: 0.08, st: 0 }, desc: 'tomahawk with back spike' },
      { v: 'pipe', p: { F: 0.38, Lr: 0.1, bw: 0.075, st: 1 }, desc: 'frontier pipe tomahawk', noun: 'Pipe Tomahawk' },
      { v: 'francisca', p: { F: 0.32, Lr: 0.06, bw: 0.09, st: 2 }, desc: 'curved francisca throwing axe', noun: 'Francisca' },
    ],
    draw(k, p) {
      tomahawkHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      k.zrod('wood', -p.F - 0.015, p.Lr, 0.014, 0.016, 6);
      if (p.st === 1) k.zrod('brass', p.Lr - 0.03, p.Lr, 0.017, 0.012, 6);
      else wraps(k, -0.06, p.Lr - 0.01, 0.015, 3);
    },
    head: (k, p) => tomahawkHead(k, p),
    anchors(p) {
      return {
        tip: [0, 0, -p.F - 0.05],
        rear: [0, 0, p.Lr],
        top: [0, 0.015, -p.F * 0.5],
        grip: [0, -0.016, 0.03],
        under: [0, -0.015, -p.F * 0.6],
        side: [0.015, 0, -p.F * 0.4],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'light' },
  },
  {
    kind: 'club',
    group: 'weapon',
    noun: 'Club',
    syn: ['club', 'caveman club', 'kanabo', 'cudgel', 'bone club', 'nail bat', 'bludgeon'],
    tags: ['tribal', 'brutal', 'wood', 'heavy'],
    desc: 'knobbly caveman club',
    color: '#8a5a32',
    accent: '#3a2618',
    variants: [
      { v: 'caveman', p: { L: 0.55, r1: 0.07, st: 0 } },
      { v: 'nail', p: { L: 0.6, r1: 0.05, st: 1 }, desc: 'wooden club studded with nails' },
      { v: 'kanabo', p: { L: 0.8, r1: 0.055, st: 2 }, desc: 'iron-studded oni kanabo', noun: 'Kanabo' },
      { v: 'bone', p: { L: 0.45, r1: 0.04, st: 3 }, desc: 'giant femur bone club', noun: 'Bone Club' },
    ],
    draw(k, p) {
      clubBody(k, p, false);
    },
    head: (k, p) => clubBody(k, p, true),
    anchors(p) {
      if (p.st === 3)
        return {
          tip: [0, 0, -p.L - 0.015],
          rear: [0, 0, 0.19],
          top: [0, 0.024, -p.L * 0.4],
          grip: [0, -0.022, 0.05],
          under: [0, -0.024, -p.L * 0.5],
          side: [0.024, 0, -p.L * 0.4],
        };
      return {
        tip: [0, 0, -p.L],
        rear: [0, 0, 0.19],
        top: [0, p.r1, -p.L * 0.8],
        grip: [0, -0.02, 0.05],
        under: [0, -p.r1, -p.L * 0.8],
        side: [p.r1, 0, -p.L * 0.8],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'medium' },
  },
  {
    kind: 'scythe',
    group: 'weapon',
    noun: 'Scythe',
    syn: ['scythe', 'reaper scythe', 'grim reaper', 'war scythe', 'death scythe', 'sickle'],
    tags: ['spooky', 'medieval', 'fantasy', 'brutal'],
    desc: 'grim reaper scythe',
    color: '#3a3d44',
    accent: '#2b2420',
    variants: [
      { v: 'reaper', p: { F: 1.25, Lr: 0.3, Lb: 0.62, W: 0.1, st: 0 }, desc: 'grim reaper scythe with crooked snath' },
      { v: 'farm', p: { F: 1.2, Lr: 0.25, Lb: 0.55, W: 0.08, st: 1 }, desc: 'farm scythe with wooden snath' },
      { v: 'war', p: { F: 1.2, Lr: 0.4, Lb: 0.5, W: 0.06, st: 2 }, desc: 'war scythe with in-line blade', noun: 'War Scythe' },
    ],
    draw(k, p) {
      scytheHead(k, p);
      k.transformAll({ p: [0, 0, -p.F] });
      const r = 0.017;
      if (p.st === 0) {
        k.tube(
          'accent',
          [
            [0, 0, -p.F - 0.01],
            [0, 0.04, -p.F * 0.55],
            [0, 0, -p.F * 0.1],
            [0, 0, p.Lr],
          ],
          r,
          10,
          5,
        );
        k.zrod('metal', p.Lr - 0.02, p.Lr, r * 1.2, r * 1.1, 6);
      } else haft(k, p.F, p.Lr, r, 'wood', null);
      if (p.st !== 2) k.rod('wood', [0, 0, -p.F * 0.45], [0, -0.12, -p.F * 0.45 - 0.02], 0.012, 0.012, 6);
      if (p.st === 1) k.rod('wood', [0, 0, -0.02], [0, -0.1, -0.03], 0.012, 0.012, 6);
    },
    head: (k, p) => scytheHead(k, p),
    anchors(p) {
      const r = 0.017;
      if (p.st === 2) {
        const { bot } = glaiveFns({ W: p.W, c: 0.03 });
        return haftAnchors(bot(1), -p.F - 0.06 - p.Lb, p.F, p.Lr, r);
      }
      const { zc } = scytheEdge(p);
      return {
        tip: [0, 0, -p.F - 0.08],
        rear: [0, 0, p.Lr],
        top: [0, p.Lb, -p.F + zc(1)],
        grip: [0, -r, 0.06],
        under: [0, -r, -p.F * 0.1],
        side: [r, 0, -p.F * 0.1],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'slash', weight: 'heavy' },
  },
  {
    kind: 'bo-staff',
    group: 'weapon',
    noun: 'Bo Staff',
    syn: ['staff', 'bo staff', 'quarterstaff', 'jo', 'monk staff', 'pole', 'stick'],
    tags: ['eastern', 'wood', 'light', 'ninja'],
    desc: 'long wooden fighting staff',
    color: '#9a6a3a',
    accent: '#b3261e',
    variants: [
      { v: 'bo', p: { F: 1.2, Lr: 0.6, r: 0.016, st: 0 }, desc: 'tapered bo staff with grip wraps' },
      { v: 'jo', p: { F: 0.85, Lr: 0.42, r: 0.013, st: 1 }, desc: 'short slim jo staff', noun: 'Jo Staff' },
      { v: 'monk', p: { F: 1.1, Lr: 0.6, r: 0.018, st: 2 }, desc: 'iron-capped monk staff', noun: 'Monk Staff' },
    ],
    draw(k, p) {
      const c = (p.Lr - p.F) / 2;
      const seg = p.st === 1 ? 8 : 7;
      k.zrod('main', -p.F, c, p.r * 0.8, p.r, seg);
      k.zrod('main', c, p.Lr, p.r, p.r * 0.8, seg);
      if (p.st === 0) for (const z of [0.0, -0.75]) k.zrod('accent', z - 0.08, z + 0.08, p.r * 1.08, p.r * 1.08, 7);
      if (p.st === 2) {
        for (const [z0, z1] of [
          [-p.F, -p.F + 0.1],
          [p.Lr - 0.1, p.Lr],
        ])
          k.zrod('metal', z0, z1, p.r * 1.05, p.r * 1.05, 7);
        for (const z of [-p.F + 0.12, p.Lr - 0.12, 0.08, -0.25]) k.zrod('brass', z - 0.01, z + 0.01, p.r * 1.2, p.r * 1.2, 7);
      }
    },
    anchors(p) {
      return {
        tip: [0, 0, -p.F],
        rear: [0, 0, p.Lr],
        top: [0, p.r * 0.92, -p.F * 0.3],
        grip: [0, -p.r, 0.05],
        under: [0, -p.r * 0.9, -p.F * 0.6],
        side: [p.r * 0.92, 0, -p.F * 0.3],
      };
    },
    roles: ['deco'],
    melee: { swing: 'spin', weight: 'medium' },
  },

  /* ---------------- MARTIAL / EXOTIC ---------------- */
  {
    kind: 'nunchaku',
    group: 'weapon',
    noun: 'Nunchaku',
    syn: ['nunchaku', 'nunchucks', 'chucks', 'sansetsukon', 'three section staff', 'flail sticks'],
    tags: ['eastern', 'ninja', 'wood', 'light'],
    desc: 'two sticks joined by a chain',
    color: '#7a4a26',
    accent: '#1f1f22',
    variants: [
      { v: 'wood', p: { L: 0.3, r: 0.015, n: 2, cl: 3, tw: 1 }, desc: 'octagonal wooden nunchaku' },
      { v: 'steel', p: { L: 0.28, r: 0.013, n: 2, cl: 5, tw: 0 }, desc: 'steel nunchaku with long chain' },
      { v: 'triple', p: { L: 0.5, r: 0.016, n: 3, cl: 2, tw: 1 }, desc: 'three-section staff', noun: 'Sansetsukon' },
    ],
    draw(k, p) {
      const secs = nunSections(p);
      secs.forEach(([a, b], i) => {
        k.rod('main', a, b, i === 0 ? p.r : p.r * 0.92, i === 0 ? p.r * 0.92 : p.r, 8);
        if (p.tw && i === 0) wraps(k, 0.06, p.L - 0.04, p.r, 3);
        if (i < secs.length - 1) {
          const nb = secs[i + 1][0];
          const from: Vec3 = i === 0 ? a : b;
          k.rod('metal', from, [from[0], from[1], from[2] - 0.008], p.r * 1.05, p.r * 1.05, 6);
          k.rod('metal', nb, [nb[0], nb[1], nb[2] + 0.008], p.r * 1.05, p.r * 1.05, 6);
          chain(k, chainLine([from[0], from[1], from[2] - 0.018], [nb[0], nb[1], nb[2] + 0.018], p.cl, 0.006), 'metal', 0.009);
        }
      });
    },
    anchors(p) {
      const secs = nunSections(p);
      const last = secs[secs.length - 1];
      const [a, b] = secs[1];
      return {
        tip: last[1],
        rear: [0, 0, p.L - 0.01],
        top: [0, p.r, p.L * 0.3],
        grip: [0, -p.r, 0.05],
        under: [0, (a[1] + b[1]) / 2 - p.r, (a[2] + b[2]) / 2],
        side: [p.r, 0, p.L * 0.3],
      };
    },
    roles: ['deco'],
    melee: { swing: 'spin', weight: 'light' },
  },
  {
    kind: 'tonfa',
    group: 'weapon',
    noun: 'Tonfa',
    syn: ['tonfa', 'side handle baton', 'police baton', 'nightstick', 'baton', 'tuifa'],
    tags: ['eastern', 'military', 'wood', 'light'],
    desc: 'side-handled tonfa baton',
    color: '#8a5a32',
    accent: '#3a2618',
    variants: [
      { v: 'classic', p: { L: 0.5, fz: 0.13, hl: 0.11, r: 0.017, st: 0 }, desc: 'okinawan wooden tonfa' },
      { v: 'police', p: { L: 0.6, fz: 0.15, hl: 0.12, r: 0.016, st: 1 }, desc: 'black police side-handle baton', noun: 'Side Baton' },
      { v: 'square', p: { L: 0.38, fz: 0.1, hl: 0.1, r: 0.02, st: 2 }, desc: 'short square-section tonfa' },
    ],
    draw(k, p) {
      const seg = p.st === 2 ? 4 : 8;
      k.zrod(p.st === 1 ? 'rubber' : 'main', -(p.L - p.fz), p.fz, p.r, p.r, seg, 0, p.r);
      k.rod(p.st === 1 ? 'rubber' : 'main', [0, p.r, 0], [0, -p.hl, 0], 0.013, 0.014, 6);
      k.ball(p.st === 1 ? 'dark' : 'accent', 0.017, [0, -p.hl, 0], 0);
      if (p.st === 1) for (let i = 0; i < 4; i++) k.rod('accent', [0, -0.02 - i * 0.022, 0], [0, -0.03 - i * 0.022, 0], 0.0155, 0.0155, 6);
      if (p.st === 0) k.zrod('accent', -(p.L - p.fz) - 0.004, -(p.L - p.fz) + 0.02, p.r * 1.06, p.r * 1.06, 8, 0, p.r);
    },
    anchors(p) {
      return {
        tip: [0, p.r, -(p.L - p.fz)],
        rear: [0, p.r, p.fz],
        top: [0, p.r * 2, -0.15],
        grip: [0, -p.hl - 0.017, 0],
        under: [0, 0, -(p.L - p.fz) * 0.6],
        side: [p.r, p.r, -0.1],
        mag: [0, -0.05, 0.013],
      };
    },
    roles: ['deco'],
    melee: { swing: 'bash', weight: 'light' },
  },
  {
    kind: 'sai',
    group: 'weapon',
    noun: 'Sai',
    syn: ['sai', 'jutte', 'jitte', 'manji sai', 'trident dagger', 'parrying dagger'],
    tags: ['eastern', 'ninja', 'metal', 'light'],
    desc: 'pronged okinawan sai',
    color: '#aab1ba',
    accent: '#24201c',
    variants: [
      { v: 'classic', p: { B: 0.38, T: 0.13, st: 0, yw: 0.05, yl: 0.1 } },
      { v: 'manji', p: { B: 0.36, T: 0.13, st: 1, yw: 0.05, yl: 0.09 }, desc: 'manji sai with reversed prong' },
      { v: 'jutte', p: { B: 0.34, T: 0.14, st: 2, yw: 0.025, yl: 0.08 }, desc: 'edo police jutte with hook', noun: 'Jutte' },
    ],
    draw(k, p) {
      k.zrod('main', -0.01, -p.B, 0.0085, 0.0015, 8);
      k.ball('main', 0.014, [0, 0, -0.005], 0);
      const sides = p.st === 2 ? [1] : [1, -1];
      for (const s of sides) {
        const rev = p.st === 1 && s === -1 ? -1 : 1;
        k.rod('main', [0, 0, -0.005], [0, s * p.yw, 0.008 * rev], 0.0055, 0.0055, 6);
        k.rod('main', [0, s * p.yw, 0.008 * rev], [0, s * p.yw * 0.85, -p.yl * rev], 0.0055, 0.002, 6);
      }
      k.zrod('accent', 0.005, p.T, 0.012, 0.012, 6);
      wraps(k, 0.012, p.T - 0.008, 0.0115, 4, 'dark');
      if (p.st === 2) k.torus('main', 0.014, 0.004, { p: [0, 0, p.T + 0.016], r: [0, PI / 2, 0] }, 3, 8);
      else k.ball('main', 0.014, [0, 0, p.T + 0.008], 0);
    },
    anchors(p) {
      return {
        tip: [0, 0, -p.B],
        rear: [0, 0, p.st === 2 ? p.T + 0.034 : p.T + 0.022],
        top: [0, 0.006, -p.B * 0.4],
        grip: [0, -0.012, 0.06],
        under: [0, -0.006, -p.B * 0.4],
        side: [0.012, 0, 0.06],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
  },
  {
    kind: 'kunai',
    group: 'weapon',
    noun: 'Kunai',
    syn: ['kunai', 'throwing knife', 'ninja knife', 'dagger', 'knife', 'shinobi blade'],
    tags: ['ninja', 'eastern', 'metal', 'light'],
    desc: 'ninja kunai with ring pommel',
    color: '#5c6169',
    accent: '#b3261e',
    variants: [
      { v: 'classic', p: { bl: 0.13, bw: 0.045, hl: 0.1, rr: 0.016 } },
      { v: 'long', p: { bl: 0.2, bw: 0.032, hl: 0.12, rr: 0.014 }, desc: 'long slim stabbing kunai' },
      { v: 'heavy', p: { bl: 0.22, bw: 0.07, hl: 0.13, rr: 0.022 }, desc: 'big broad-bladed heavy kunai' },
    ],
    draw(k, p) {
      k.blade(
        'main',
        [
          [0, -p.bw * 0.3],
          [-p.bl * 0.35, -p.bw / 2],
          [-p.bl, 0],
          [-p.bl * 0.35, p.bw / 2],
          [0, p.bw * 0.3],
        ],
        0.008,
        'zy',
        { p: [0, 0, -0.005] },
      );
      k.zrod('dark', -0.008, p.hl, 0.009, 0.009, 6);
      const n = Math.round(p.hl / 0.025);
      for (let i = 0; i < n; i++) {
        const z = 0.008 + (i * (p.hl - 0.016)) / (n - 1);
        k.box('accent', [0.0125, 0.0125, 0.008], { p: [0, 0, z], r: [0, 0, PI / 4 + (i % 2) * 0.3] });
      }
      k.torus('metal', p.rr, 0.004, { p: [0, 0, p.hl + p.rr], r: [0, PI / 2, 0] }, 3, 10);
    },
    anchors(p) {
      return {
        tip: [0, 0, -0.005 - p.bl],
        rear: [0, 0, p.hl + 2 * p.rr + 0.004],
        top: [0, p.bw / 2, -0.005 - p.bl * 0.35],
        grip: [0, -0.009, 0.04],
        under: [0, -p.bw / 2, -0.005 - p.bl * 0.35],
        side: [0.009, 0, 0.05],
      };
    },
    roles: ['blade', 'mag', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
    guns: ['crossbow'],
    fireMode: 'projectile',
    ammo: 'kunai',
  },
  {
    kind: 'shuriken',
    group: 'weapon',
    noun: 'Shuriken',
    syn: ['shuriken', 'throwing star', 'ninja star', 'star', 'hira shuriken', 'shaken'],
    tags: ['ninja', 'eastern', 'metal', 'light'],
    desc: 'giant ninja throwing star',
    color: '#8d949e',
    accent: '#2d2f36',
    variants: [
      { v: 'four', p: { n: 4, ro: 0.15, ri: 0.035, th: 0.007, hole: 0 }, desc: 'four-pointed ninja star' },
      { v: 'eight', p: { n: 8, ro: 0.13, ri: 0.065, th: 0.006, hole: 0 }, desc: 'eight-pointed spiked star' },
      { v: 'hira', p: { n: 6, ro: 0.14, ri: 0.06, th: 0.008, hole: 1 }, desc: 'six-pointed hira shuriken with hole' },
    ],
    draw(k, p) {
      const star = starPts(p.ro, p.ri, p.n);
      if (p.hole) {
        k.extrude('main', star, p.th, 'xz', { p: [0, 0, -p.ro] }, 0, [circlePts(p.ri * 0.45, 8)]);
        k.torus('accent', p.ri * 0.45, 0.003, { p: [0, 0, -p.ro], r: [PI / 2, 0, 0] }, 3, 8);
      } else {
        k.blade('main', star, p.th, 'xz', { p: [0, 0, -p.ro] });
        k.rod('accent', [0, -p.th * 0.9, -p.ro], [0, p.th * 0.9, -p.ro], p.ri * 0.45, p.ri * 0.45, 8);
      }
    },
    anchors(p) {
      return {
        tip: [0, 0, -2 * p.ro],
        rear: [0, 0, 0],
        top: [0, p.th / 2, -p.ro + p.ri * 0.7],
        grip: [0, -p.th / 2, -p.ro * 0.4],
        under: [0, -p.th / 2, -p.ro * 1.5],
        side: [(p.n / 2) % 2 === 0 ? p.ro : p.ri, 0, -p.ro],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'spin', weight: 'light' },
    guns: ['crossbow', 'smg'],
    fireMode: 'projectile',
    ammo: 'throwing stars',
  },
  {
    kind: 'chakram',
    group: 'weapon',
    noun: 'Chakram',
    syn: ['chakram', 'war quoit', 'throwing ring', 'ring blade', 'wind and fire wheel', 'disc'],
    tags: ['eastern', 'fantasy', 'metal', 'light'],
    desc: 'bladed throwing ring with grip wrap',
    color: '#c9ced6',
    accent: '#b3261e',
    variants: [
      { v: 'classic', p: { Ro: 0.15, Ri: 0.125, ns: 0, half: 0, sp: 0 } },
      { v: 'spiked', p: { Ro: 0.14, Ri: 0.115, ns: 10, half: 0, sp: 0.035 }, desc: 'spiked chakram ring' },
      { v: 'wheel', p: { Ro: 0.16, Ri: 0.12, ns: 5, half: 1, sp: 0.06 }, desc: 'flame-bladed wind and fire wheel' },
    ],
    draw(k, p) {
      const Rg = p.Ri + 0.006;
      const zc = -Rg;
      k.lathe(
        'main',
        [
          [p.Ri, -0.005],
          [p.Ro, 0],
          [p.Ri, 0.005],
          [p.Ri, -0.005],
        ],
        16,
        { p: [0, 0, zc] },
      );
      const a = 1.0;
      k.torus('accent', Rg, 0.008, { p: [0, 0, zc], r: [PI / 2, 0, PI / 2 - a / 2] }, 3, 6, a);
      for (const th of chakramAngles(p)) {
        const c = Math.cos(th);
        const s = Math.sin(th);
        const w = p.half ? 0.03 : 0.014;
        const r0 = p.Ro - 0.012;
        const r1 = p.Ro + p.sp;
        const pts: Pt[] = p.half
          ? [
              [c * r0 - s * w, s * r0 + c * w],
              [c * r0 + s * w, s * r0 - c * w],
              [c * (r0 + p.sp * 0.5) + s * w * 0.2, s * (r0 + p.sp * 0.5) - c * w * 0.2],
              [c * r1 - s * w * 0.8, s * r1 + c * w * 0.8],
            ]
          : [
              [c * r0 - s * w, s * r0 + c * w],
              [c * r0 + s * w, s * r0 - c * w],
              [c * r1, s * r1],
            ];
        k.extrude('main', pts, 0.006, 'xz', { p: [0, 0, zc] });
      }
    },
    anchors(p) {
      const Rg = p.Ri + 0.006;
      const zc = -Rg;
      return {
        tip: [0, 0, zc - p.Ro - (p.ns && !p.half ? p.sp : 0)],
        rear: [0, 0, 0.008],
        top: [0, 0.006, 0],
        grip: [0, -0.006, 0],
        under: [0, -0.003, zc - (p.Ri + p.Ro) / 2],
        side: [p.Ro, 0, zc],
        mag: [(p.Ri + p.Ro) / 2, -0.003, zc],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'spin', weight: 'light' },
    guns: ['crossbow'],
    fireMode: 'projectile',
    ammo: 'chakrams',
  },
  {
    kind: 'boomerang',
    group: 'weapon',
    noun: 'Boomerang',
    syn: ['boomerang', 'kylie', 'throwing stick', 'rang', 'aussie', 'returning stick'],
    tags: ['aussie', 'tribal', 'wood', 'light'],
    desc: 'dot-painted wooden boomerang',
    color: '#a8693a',
    accent: '#f2efe8',
    variants: [
      { v: 'classic', p: { st: 0, w: 0.06 } },
      { v: 'kylie', p: { st: 1, w: 0.055 }, desc: 'long hunting kylie throwing stick', noun: 'Kylie' },
      { v: 'tri', p: { st: 2, w: 0.05 }, desc: 'three-bladed trick boomerang' },
    ],
    draw(k, p) {
      const th = 0.01;
      for (const arm of boomArms(p)) {
        k.extrude('main', strip(arm, p.w), th, 'xz', undefined, 0.003);
        for (let i = 1; i < arm.length; i++) {
          const [x, z] = arm[i];
          const [px, pz] = arm[i - 1];
          k.box('accent', [0.012, 0.004, 0.012], { p: [(x + px) / 2, th / 2 + 0.003, (z + pz) / 2], r: [0, PI / 4, 0] });
          k.box('accent', [0.008, 0.004, 0.008], { p: [x, th / 2 + 0.003, z] });
        }
      }
    },
    anchors(p) {
      const arms = boomArms(p);
      let tip: Pt = [0, 0];
      let rear: Pt = [0, -1];
      for (const arm of arms)
        for (const q of strip(arm, p.w)) {
          if (q[1] < tip[1]) tip = q;
          if (q[1] > rear[1]) rear = q;
        }
      const a0 = arms[0];
      const t = 0.008;
      const g: Pt = p.st === 2 ? [0, 0] : [a0[0][0] + (a0[1][0] - a0[0][0]) * 0.4, a0[0][1] + (a0[1][1] - a0[0][1]) * 0.4];
      const m = a0[Math.min(2, a0.length - 1)];
      return {
        tip: [tip[0], 0, tip[1]],
        rear: [rear[0], 0, rear[1]],
        top: [a0[1][0], t, a0[1][1]],
        grip: [g[0], -t, g[1]],
        under: [m[0], -t, m[1]],
        side: [p.w * 0.42, 0, -0.02],
      };
    },
    roles: ['blade', 'mag', 'deco'],
    melee: { swing: 'spin', weight: 'light' },
    guns: ['crossbow'],
    fireMode: 'projectile',
    ammo: 'boomerangs',
  },
  {
    kind: 'slingshot',
    group: 'weapon',
    noun: 'Slingshot',
    syn: ['slingshot', 'catapult', 'wrist rocket', 'sling', 'y-shot', 'shanghai'],
    tags: ['wood', 'light', 'western'],
    desc: 'forked slingshot with rubber bands',
    color: '#8a5a32',
    accent: '#c23b2e',
    variants: [
      { v: 'wood', p: { st: 0, hh: 0.11, fw: 0.045, fh: 0.1, pb: 0.12 }, desc: 'forked branch wooden slingshot' },
      { v: 'wrist', p: { st: 1, hh: 0.1, fw: 0.04, fh: 0.09, pb: 0.11 }, desc: 'steel wrist rocket with arm brace', noun: 'Wrist Rocket' },
      { v: 'hunter', p: { st: 2, hh: 0.13, fw: 0.065, fh: 0.13, pb: 0.15 }, desc: 'big double-banded hunting slingshot' },
    ],
    draw(k, p) {
      const fr: Slot = p.st === 1 ? 'metal' : 'main';
      const r = p.st === 1 ? 0.007 : p.st === 2 ? 0.013 : 0.011;
      k.rod(fr, [0, -p.hh, 0.003], [0, 0.005, 0], r + 0.003, r + 0.001, 7);
      for (const s of [-1, 1]) {
        if (p.st === 1) {
          k.rod(fr, [0, 0, 0], [s * p.fw, p.fh * 0.55, 0], r, r, 6);
          k.rod(fr, [s * p.fw, p.fh * 0.55, 0], [s * p.fw, p.fh, 0], r, r, 6);
        } else
          k.tube(
            fr,
            [
              [0, 0, 0],
              [s * p.fw * 0.65, p.fh * 0.45, 0],
              [s * p.fw, p.fh, 0],
            ],
            r,
            4,
            6,
          );
        const bands = p.st === 2 ? [-0.005, 0.005] : [0];
        for (const d of bands) k.rod('accent', [s * p.fw, p.fh - 0.008 + d, 0], [s * 0.014, p.fh - 0.012 + d, p.pb], 0.0035, 0.0035, 4);
      }
      k.box('#5a3a22', [0.032, 0.018, 0.02], { p: [0, p.fh - 0.012, p.pb] });
      if (p.st === 1) {
        k.rod('accent', [0, -p.hh, 0.003], [0, -0.012, 0.002], 0.014, 0.014, 7);
        k.rod('metal', [0, -p.hh, 0.003], [0, -p.hh * 0.55, 0.17], 0.006, 0.006, 6);
        k.box('rubber', [0.05, 0.012, 0.03], { p: [0, -p.hh * 0.55, 0.17] });
      }
      if (p.st === 2) for (let i = 0; i < 3; i++) k.rod('accent', [0, -0.02 - i * 0.035, 0.002], [0, -0.035 - i * 0.035, 0.003], r + 0.0045, r + 0.0045, 7);
    },
    anchors(p) {
      const r = p.st === 1 ? 0.007 : p.st === 2 ? 0.013 : 0.011;
      return {
        tip: [0, 0, -(r + 0.002)],
        rear: [0, p.fh - 0.012, p.pb + 0.01],
        top: [0, p.fh - 0.003, p.pb],
        grip: [0, -p.hh, 0.003],
        under: [0, -p.hh * 0.5, -(r + 0.003)],
        side: [p.fw + r, p.fh, 0],
      };
    },
    roles: ['deco'],
    selfGrip: true,
    guns: ['crossbow', 'grenade_launcher'],
    fireMode: 'projectile',
    ammo: 'pebbles',
  },
  {
    kind: 'kusarigama',
    group: 'weapon',
    noun: 'Kusarigama',
    syn: ['kusarigama', 'kama', 'sickle', 'chain sickle', 'sickle and chain', 'ninja sickle'],
    tags: ['ninja', 'eastern', 'brutal', 'metal'],
    desc: 'ninja sickle with weighted chain',
    color: '#aab1ba',
    accent: '#24201c',
    variants: [
      { v: 'classic', p: { hl: 0.4, bl: 0.17, nl: 6, wr: 0.03, st: 0 } },
      { v: 'longchain', p: { hl: 0.36, bl: 0.15, nl: 9, wr: 0.035, st: 1 }, desc: 'kusarigama with long weighted chain' },
      { v: 'kama', p: { hl: 0.38, bl: 0.2, nl: 0, wr: 0, st: 2 }, desc: 'wrapped kama farming sickle', noun: 'Kama' },
    ],
    draw(k, p) {
      kamaHead(k, p);
      k.transformAll({ p: [0, 0, -p.hl] });
      k.zrod('wood', -p.hl - 0.01, 0.06, 0.014, 0.015, 6);
      if (p.st === 2) wraps(k, -0.08, 0.05, 0.0145, 4);
      k.torus('metal', 0.012, 0.0035, { p: [0, 0, 0.072], r: [0, PI / 2, 0] }, 3, 8);
      if (p.nl) {
        const pts = kusariChain(p);
        chain(k, pts, 'metal', 0.01);
        const e = kusariWeight(p);
        k.ball('metal', p.wr, e, 0);
      }
    },
    head: (k, p) => kamaHead(k, p),
    anchors(p) {
      const w = kusariWeight(p);
      return {
        tip: [0, 0, -p.hl - 0.05],
        rear: p.nl ? [0, w[1], w[2] + p.wr] : [0, 0, 0.0855],
        top: [0, 0.014, -p.hl * 0.5],
        grip: [0, -0.015, 0.03],
        under: [0, -0.014, -p.hl * 0.7],
        side: [0.014, 0, -p.hl * 0.3],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'spin', weight: 'medium' },
  },
  {
    kind: 'war-fan',
    group: 'weapon',
    noun: 'War Fan',
    syn: ['war fan', 'tessen', 'iron fan', 'fan', 'gunsen', 'bladed fan'],
    tags: ['eastern', 'samurai', 'ninja', 'ornate'],
    desc: 'open iron-ribbed war fan',
    color: '#e9e0c9',
    accent: '#b3261e',
    variants: [
      { v: 'tessen', p: { R: 0.3, a: 1.45, nr: 11, st: 0 }, desc: 'half-circle iron tessen war fan' },
      { v: 'paper', p: { R: 0.34, a: 0.9, nr: 9, st: 1 }, desc: 'narrow paper gunsen fan' },
      { v: 'bladed', p: { R: 0.3, a: 1.1, nr: 9, st: 2 }, desc: 'war fan with steel blade tips' },
    ],
    draw(k, p) {
      const pz = -0.03;
      const n = 8;
      const outer: Pt[] = [];
      const inner: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const f = -p.a + (i * 2 * p.a) / n;
        outer.push([pz - p.R * Math.cos(f), p.R * Math.sin(f)]);
        inner.push([pz - p.R * 0.3 * Math.cos(f), p.R * 0.3 * Math.sin(f)]);
      }
      k.extrude('main', [...outer, ...inner.reverse()], 0.004, 'zy');
      const rs: Slot = p.st === 0 ? 'metal' : 'dark';
      for (let i = 0; i < p.nr; i++) {
        const f = -p.a + (i * 2 * p.a) / (p.nr - 1);
        const edge = i === 0 || i === p.nr - 1;
        const tip: Vec3 = [0, p.R * 0.98 * Math.sin(f), pz - p.R * 0.98 * Math.cos(f)];
        k.rod(edge ? 'metal' : rs, [0, 0, pz], tip, edge ? 0.006 : 0.0035, edge ? 0.005 : 0.003, 4);
        if (p.st === 2) {
          const c = Math.cos(f);
          const s = Math.sin(f);
          const r0 = p.R * 0.95;
          const r1 = p.R + 0.05;
          k.extrude(
            'metal',
            [
              [pz - r0 * c - s * 0.018, r0 * s - c * 0.018],
              [pz - r0 * c + s * 0.018, r0 * s + c * 0.018],
              [pz - r1 * c, r1 * s],
            ],
            0.003,
            'zy',
          );
        }
      }
      k.rod('brass', [-0.008, 0, pz], [0.008, 0, pz], 0.009, 0.009, 8);
      k.box('dark', [0.012, 0.022, 0.1], { p: [0, 0, pz + 0.05] });
      for (const x of [0.003, -0.003]) k.decal('accent', circlePts(p.R * 0.16, 10, pz - p.R * 0.64, 0), { p: [x, 0, 0] });
    },
    anchors(p) {
      const pz = -0.03;
      return {
        tip: [0, 0, pz - p.R],
        rear: [0, 0, pz + 0.1],
        top: [0, p.R * Math.sin(p.a), pz - p.R * Math.cos(p.a)],
        grip: [0, -0.011, 0.03],
        under: [0, -p.R * Math.sin(p.a), pz - p.R * Math.cos(p.a)],
        side: [0.002, p.R * 0.08, pz - p.R * 0.45],
      };
    },
    roles: ['deco'],
    melee: { swing: 'slash', weight: 'light' },
  },
  {
    kind: 'whip',
    group: 'weapon',
    noun: 'Whip',
    syn: ['whip', 'bullwhip', 'stockwhip', 'lash', 'cat o nine tails', 'scourge'],
    tags: ['western', 'cowboy', 'aussie', 'spooky'],
    desc: 'braided leather whip',
    color: '#6b4426',
    accent: '#2b1d14',
    variants: [
      { v: 'bull', p: { L: 1.4, hl: 0.25, st: 0 }, desc: 'long cracking leather bullwhip' },
      { v: 'stock', p: { L: 1.1, hl: 0.45, st: 1 }, desc: 'aussie stockwhip with long handle', noun: 'Stockwhip' },
      { v: 'cat', p: { L: 0.5, hl: 0.22, st: 2 }, desc: 'knotted cat o nine tails', noun: "Cat o' Nine Tails" },
    ],
    draw(k, p) {
      k.zrod(p.st === 1 ? 'wood' : 'accent', -0.01, p.hl, 0.014, 0.017, 6);
      k.ball('accent', 0.019, [0, 0, p.hl + 0.008], 0);
      if (p.st === 1) k.torus('accent', 0.012, 0.004, { p: [0, 0, -0.022], r: [0, PI / 2, 0] }, 3, 8);
      if (p.st === 2) {
        for (const [x, y] of whipCatEnds(p)) {
          k.tube('main', [[0, 0, -0.01], [x * 0.4, y * 0.3 - 0.02, -p.L * 0.45], [x, y, -p.L]], 0.004, 4, 3);
          k.ball('accent', 0.009, [x, y, -p.L], 0);
        }
      } else {
        const c = whipCurve(p);
        k.tube('main', c.slice(0, 3), 0.011, 6, 4);
        k.tube('main', c.slice(2, 5), 0.0075, 6, 4);
        k.tube('main', c.slice(4, 7), 0.0045, 6, 4);
        const e = c[6];
        k.rod('#d8cfb8', e, [e[0], e[1] - 0.01, e[2] - 0.05], 0.004, 0.001, 4);
      }
    },
    anchors(p) {
      let tip: Vec3;
      let mid: Vec3;
      let r: number;
      if (p.st === 2) {
        tip = [0, whipCatEnds(p)[2][1], -p.L];
        mid = [0, whipCatEnds(p)[2][1] - 0.009, -p.L];
        r = 0;
      } else {
        const c = whipCurve(p);
        tip = c[6];
        mid = c[3];
        r = 0.0075;
      }
      return {
        tip,
        rear: [0, 0, p.hl + 0.027],
        top: [0, 0.016, p.hl * 0.5],
        grip: [0, -0.015, 0.04],
        under: [mid[0], mid[1] - r, mid[2]],
        side: [0.016, 0, p.hl * 0.5],
      };
    },
    roles: ['deco'],
    melee: { swing: 'slash', weight: 'light' },
  },
  {
    kind: 'brass-knuckles',
    group: 'weapon',
    noun: 'Brass Knuckles',
    syn: ['brass knuckles', 'knuckle duster', 'knuckles', 'knucks', 'knuckle dusters', 'fist'],
    tags: ['metal', 'brutal', 'light'],
    desc: 'four-ring brass knuckle duster',
    color: '#c99a2e',
    accent: '#9aa1ab',
    variants: [
      { v: 'classic', p: { hr: 0.0095, st: 0 } },
      { v: 'spiked', p: { hr: 0.0095, st: 1 }, desc: 'knuckle duster with steel spikes' },
      { v: 'crown', p: { hr: 0.009, st: 2 }, desc: 'pointed crown knuckle duster' },
    ],
    draw(k, p) {
      const xs = [-0.033, -0.011, 0.011, 0.033];
      k.extrude(
        'main',
        knucklePts(p),
        0.012,
        'xz',
        undefined,
        0,
        xs.map((x) => circlePts(p.hr, 8, x, -0.04)),
      );
      if (p.st === 1) for (const x of xs) k.rod('accent', [x, 0, -0.052], [x, 0, -0.078], 0.006, 0, 4);
      k.box('accent', [0.07, 0.014, 0.012], { p: [0, 0, 0.012] });
    },
    anchors() {
      return {
        tip: [0, 0, -0.045],
        rear: [0, 0, 0.03],
        top: [0, 0.007, -0.01],
        grip: [0, -0.007, 0.012],
        under: [0, -0.006, -0.02],
        side: [0.052, 0, -0.02],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },
  {
    kind: 'claws',
    group: 'weapon',
    noun: 'Claws',
    syn: ['claws', 'bagh nakh', 'tiger claws', 'katar', 'punch dagger', 'claw blades', 'wolverine'],
    tags: ['ninja', 'eastern', 'brutal', 'metal'],
    desc: 'clawed knuckle weapon',
    color: '#c9ced6',
    accent: '#5a3a22',
    variants: [
      { v: 'bagh', p: { st: 0, n: 4, cl: 0.09 }, desc: 'curved bagh nakh tiger claws', noun: 'Bagh Nakh' },
      { v: 'blades', p: { st: 1, n: 3, cl: 0.3 }, desc: 'three long gauntlet claw blades', noun: 'Claw Blades' },
      { v: 'katar', p: { st: 2, n: 1, cl: 0.3 }, desc: 'indian katar punch dagger', noun: 'Katar' },
    ],
    draw(k, p) {
      if (p.st === 2) {
        k.blade(
          'main',
          [
            [-0.035, 0],
            [-0.03, -0.12],
            [0, -p.cl],
            [0.03, -0.12],
            [0.035, 0],
          ],
          0.008,
          'xz',
          { p: [0, 0, -0.012] },
        );
        for (const s of [-1, 1]) k.box('accent', [0.008, 0.02, 0.19], { p: [s * 0.04, 0, 0.075] });
        k.box('accent', [0.088, 0.02, 0.016], { p: [0, 0, -0.008] });
        for (const z of [0.0, 0.03]) k.rod('accent', [-0.04, 0, z], [0.04, 0, z], 0.008, 0.008, 6);
        return;
      }
      const { top, bot } = clawFns(p);
      const sp = p.st === 0 ? 0.022 : 0.024;
      for (let i = 0; i < p.n; i++) {
        const x = (i - (p.n - 1) / 2) * sp;
        k.blade('main', outline(p.cl, top, bot, 6), 0.006, 'zy', { p: [x, 0, -0.012] });
      }
      if (p.st === 0) {
        k.box('accent', [0.09, 0.022, 0.03], { p: [0, 0, 0] });
        for (const s of [-1, 1]) k.torus('main', 0.013, 0.003, { p: [s * 0.058, 0, 0] }, 3, 6);
      } else {
        k.box('accent', [0.08, 0.025, 0.03], { p: [0, 0, 0] });
        k.box('dark', [0.07, 0.03, 0.12], { p: [0, 0.02, 0.06] });
      }
    },
    anchors(p) {
      if (p.st === 2)
        return {
          tip: [0, 0, -0.012 - p.cl],
          rear: [0, 0, 0.038],
          top: [0, 0.004, -0.1],
          grip: [0, -0.008, 0],
          under: [0, -0.004, -0.12],
          side: [0.044, 0, 0.07],
        };
      const { top, bot } = clawFns(p);
      const x0 = p.n % 2 === 0 ? 0.011 : 0;
      return {
        tip: [x0, (top(1) + bot(1)) / 2, -0.012 - p.cl],
        rear: p.st === 0 ? [0, 0, 0.015] : [0, 0.02, 0.12],
        top: p.st === 0 ? [0, 0.011, 0] : [0, 0.035, 0.06],
        grip: p.st === 0 ? [0, -0.011, 0] : [0, -0.0125, 0],
        under: [x0, bot(0.5), -0.012 - p.cl * 0.5],
        side: p.st === 0 ? [0.045, 0, 0] : [0.04, 0, 0],
      };
    },
    roles: ['deco'],
    melee: { swing: 'slash', weight: 'light' },
  },
];

/* ---------------- per-kind drawing functions ---------------- */

function heaterPts(p: P): Pt[] {
  const { W, H } = p;
  if (p.sh === 2) return chamferRect(-W / 2, -H / 2, W / 2, H / 2, 0.04);
  if (p.sh === 1)
    return mirrorHalf([
      [0, H * 0.4],
      [W * 0.3, H * 0.37],
      [W / 2, H * 0.25],
      [W / 2, H * 0.1],
      [W * 0.38, -H * 0.15],
      [W * 0.2, -H * 0.38],
      [0, -H * 0.6],
    ]);
  return mirrorHalf([
    [0, H * 0.4],
    [W / 2, H * 0.4],
    [W / 2, H * 0.05],
    [W * 0.42, -H * 0.2],
    [W * 0.25, -H * 0.42],
    [0, -H * 0.6],
  ]);
}

function warhammerHead(k: Kit, p: P) {
  const hz = -0.05;
  k.zrod('metal', 0.01, -0.1, 0.017, 0.017, 6);
  k.box('main', [0.04, 0.05, 0.05], { p: [0, 0, hz] });
  k.rod('main', [0, 0.02, hz], [0, 0.02 + p.fl, hz], 0.022, 0.026, 8);
  if (p.pr) {
    for (const [x, z] of [
      [0, -0.012],
      [0.012, 0.008],
      [-0.012, 0.008],
    ])
      k.rod('main', [x, 0.02 + p.fl, hz + z], [x, 0.045 + p.fl, hz + z], 0.009, 0, 4);
  } else k.rod('metal', [0, 0.02 + p.fl, hz], [0, 0.03 + p.fl, hz], 0.028, 0.026, 8);
  k.rod('main', [0, -0.02, hz], [0, -0.02 - p.sl, hz + p.sl * 0.25], 0.018, 0.002, 4);
  k.zrod('main', hz - 0.025, hz - 0.025 - p.ts, 0.014, 0.001, 4);
}

function maulHead(k: Kit, p: P) {
  const zc = -0.012 - p.bs * 0.55;
  k.zrod('metal', 0.01, -0.04, 0.02, 0.02, 6);
  k.box('main', [p.bs, p.bl, p.bs * 1.1], { p: [0, 0, zc] });
  for (const s of [-1, 1]) {
    k.box('metal', [p.bs * 1.08, 0.022, p.bs * 1.18], { p: [0, s * (p.bl / 2 - 0.02), zc] });
    k.box('main', [p.bs * 0.8, 0.012, p.bs * 0.9], { p: [0, s * (p.bl / 2 + 0.006), zc] });
  }
  if (p.sp) {
    for (const s of [-1, 1])
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        k.rod('metal', [dx * p.bs * 0.22, s * (p.bl / 2 + 0.01), zc + dz * p.bs * 0.25], [dx * p.bs * 0.22, s * (p.bl / 2 + 0.045), zc + dz * p.bs * 0.25], 0.01, 0, 4);
  }
}

function halberdHead(k: Kit, p: P) {
  const a = p.a;
  k.zrod('metal', 0.01, -0.14, 0.016, 0.016, 6);
  k.blade(
    'main',
    [
      [0, -0.012],
      [-p.sp, 0],
      [0, 0.012],
    ],
    0.008,
    'zy',
    { p: [0, 0, -0.13] },
  );
  if (p.cres) {
    k.blade(
      'main',
      [
        [-0.06, 0.012],
        [-0.27, 0.012],
        [-0.38, 0.1],
        [-0.31, 0.17],
        [-0.12, 0.16],
        [-0.01, 0.1],
        [-0.03, 0.05],
      ],
      0.009,
      'zy',
    );
  } else {
    k.blade(
      'main',
      (
        [
          [-0.02, 0.012],
          [-0.12, 0.012],
          [-0.17, 0.16],
          [-0.085, 0.175],
          [0.0, 0.16],
          [-0.01, 0.06],
        ] as Pt[]
      ).map(([u, v]) => [u * a - 0.01, v * a] as Pt),
      0.009,
      'zy',
    );
  }
  if (p.hook === 1)
    k.blade(
      'main',
      [
        [-0.065, -0.01],
        [-0.115, -0.01],
        [-0.05, -0.13],
        [-0.065, -0.06],
      ],
      0.009,
      'zy',
    );
  if (p.hook === 2) {
    k.box('main', [0.03, 0.04, 0.035], { p: [0, -0.03, -0.08] });
    k.rod('main', [0, -0.045, -0.08], [0, -0.07, -0.08], 0.02, 0.022, 6);
  }
}

function glaiveHead(k: Kit, p: P) {
  const { top, bot } = glaiveFns(p);
  k.zrod('metal', 0.01, -0.08, 0.018, 0.018, 6);
  if (p.st === 1) {
    k.zrod('dark', -0.065, -0.072, 0.035, 0.035, 8);
    k.zrod('brass', 0.0, -0.02, 0.02, 0.02, 6);
  }
  k.blade('main', outline(p.L, top, bot, 8), 0.009, 'zy', { p: [0, 0, -0.07] });
  if (p.st === 2) {
    k.blade(
      'main',
      [
        [-0.12, bot(0.2) + 0.005],
        [-0.2, bot(0.35) + 0.005],
        [-0.13, bot(0.25) - 0.045],
      ],
      0.008,
      'zy',
    );
    k.rod('accent', [0, -0.018, -0.03], [0, -0.05, -0.02], 0.004, 0.004, 4);
    k.ball('accent', 0.024, [0, -0.07, -0.015], 0, [1, 1.4, 1]);
  }
}

function spearHead(k: Kit, p: P) {
  k.zrod('metal', 0.01, -0.12, 0.019, 0.012, 6);
  const pts: Pt[] =
    p.st === 2
      ? [
          [0, -p.sw / 2],
          [-p.sl, 0],
          [0, p.sw / 2],
        ]
      : [
          [0, -0.006],
          [-p.sl * 0.35, -p.sw / 2],
          [-p.sl, 0],
          [-p.sl * 0.35, p.sw / 2],
          [0, 0.006],
        ];
  k.blade('main', pts, 0.009, 'zy', { p: [0, 0, -0.11] });
  if (p.st === 1) k.rod('metal', [0, -0.065, -0.1], [0, 0.065, -0.1], 0.008, 0.008, 6);
  if (p.st === 2) k.zrod('brass', -0.06, -0.09, 0.02, 0.02, 6);
}

function tridentProngs(p: P): { y: number; len: number }[] {
  const out: { y: number; len: number }[] = [];
  for (let i = 0; i < p.n; i++) {
    const y = p.n === 1 ? 0 : -p.sw + (i * 2 * p.sw) / (p.n - 1);
    const center = Math.abs(y) < 1e-6;
    out.push({ y, len: p.pl * (center ? 1.15 : 1 - Math.abs(y) * 1.2) });
  }
  return out;
}

function tridentTip(p: P): Vec3 {
  let best: Vec3 = [0, 0, 0];
  for (const pr of tridentProngs(p)) {
    const z = -0.08 - pr.len - 0.05;
    if (z < best[2]) best = [0, pr.y, z];
  }
  return best;
}

function tridentHead(k: Kit, p: P) {
  k.zrod('metal', 0.01, -0.08, 0.017, 0.017, 6);
  k.box('main', [0.016, p.sw * 2 + 0.02, 0.022], { p: [0, 0, -0.08] });
  if (p.n === 5) k.ball('accent', 0.03, [0, 0, -0.055], 0);
  for (const pr of tridentProngs(p)) {
    const z1 = -0.08 - pr.len;
    k.zrod('main', -0.08, z1, 0.0075, 0.0075, 6, 0, pr.y);
    k.zrod('main', z1, z1 - 0.05, 0.012, 0, 4, 0, pr.y);
    if (p.bb) {
      const s = pr.y > 0 ? 1 : pr.y < 0 ? -1 : 1;
      k.extrude(
        'main',
        [
          [z1, pr.y],
          [z1 + 0.04, pr.y + s * 0.004],
          [z1 + 0.012, pr.y + s * 0.022],
        ],
        0.006,
        'zy',
      );
      if (pr.y === 0)
        k.extrude(
          'main',
          [
            [z1, 0],
            [z1 + 0.04, -0.004],
            [z1 + 0.012, -0.022],
          ],
          0.006,
          'zy',
        );
    }
  }
}

function flailBall(p: P): Vec3 {
  const lk = 0.024;
  const zb = -0.04 - p.n * lk - p.br * 0.8;
  return [p.nb === 2 ? 0.06 : 0, -0.04 - p.br * 0.3, zb];
}

function flailHead(k: Kit, p: P) {
  k.zrod('metal', 0.01, -0.035, 0.02, 0.018, 6);
  const b = flailBall(p);
  const balls: Vec3[] = p.nb === 2 ? [b, [-b[0], b[1], b[2]]] : [b];
  for (const c of balls) {
    const pts = chainLine([c[0] * 0.2, -0.003, -0.045], [c[0] * 0.9, c[1] + 0.005, c[2] + p.br * 0.95], p.n, 0.008);
    chain(k, pts, 'metal', 0.011);
    spikedBall(k, c, p.br, p.sp, p.nb === 2 ? AX6 : ICO, 'main', 'metal', 0);
  }
}

function morningTipZ(p: P): number {
  if (p.st === 1) return -0.04 - 0.16 - 0.08;
  const zc = -0.05 - p.hr;
  return zc - p.hr - p.sp * 1.3;
}

function morningHead(k: Kit, p: P) {
  k.zrod('metal', 0.01, -0.06, 0.02, 0.02, 6);
  if (p.st === 1) {
    k.zrod('main', -0.04, -0.2, 0.045, 0.045, 8);
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 2 * PI + (row % 2) * (PI / 6);
        const z = -0.07 - row * 0.05;
        k.rod('metal', [Math.cos(a) * 0.04, Math.sin(a) * 0.04, z], [Math.cos(a) * (0.045 + p.sp), Math.sin(a) * (0.045 + p.sp), z], 0.012, 0, 4);
      }
    k.zrod('metal', -0.2, -0.28, 0.016, 0, 4);
    return;
  }
  const zc = -0.05 - p.hr;
  spikedBall(k, [0, 0, zc], p.hr, p.sp, ICO, 'main', 'metal', 1);
  k.zrod('metal', zc - p.hr * 0.8, zc - p.hr - p.sp * 1.3, p.hr * 0.3, 0, 4);
  if (p.st === 2) k.torus('metal', p.hr * 0.55, 0.006, { p: [0, 0, zc + p.hr * 0.75] }, 3, 8);
}

function maceHead(k: Kit, p: P) {
  k.zrod('metal', 0.01, -0.02, 0.019, 0.019, 6);
  k.zrod('main', -0.02, -0.02 - p.hl, 0.022, 0.022, 6);
  if (p.st === 2) {
    const zc = -0.02 - p.hr;
    k.ball('main', p.hr, [0, 0, zc], 1);
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 2 * PI + row * 0.6;
        const el = row === 0 ? 0.35 : -0.35;
        const d: Vec3 = [Math.cos(a) * Math.cos(el), Math.sin(a) * Math.cos(el), Math.sin(el)];
        k.ball('metal', 0.016, [d[0] * p.hr, d[1] * p.hr, zc + d[2] * p.hr], 0);
      }
  } else {
    const nf = p.st === 0 ? 6 : 8;
    const pts: Pt[] =
      p.st === 0
        ? [
            [0, 0],
            [-p.hl * 0.15, p.hr],
            [-p.hl * 0.85, p.hr],
            [-p.hl, 0],
          ]
        : [
            [0, 0],
            [-p.hl * 0.45, p.hr],
            [-p.hl * 0.7, p.hr * 0.85],
            [-p.hl, 0],
          ];
    for (let i = 0; i < nf; i++) k.extrude('main', pts, p.st === 0 ? 0.01 : 0.007, 'zy', { p: [0, 0, -0.02], r: [0, 0, (i * 2 * PI) / nf] });
  }
  k.zrod('metal', -0.02 - p.hl, -0.05 - p.hl, 0.016, 0, 6);
}

function tomahawkHead(k: Kit, p: P) {
  k.box('metal', [0.026, 0.034, 0.05], { p: [0, 0, -0.025] });
  const bw = p.bw;
  const pts: Pt[] =
    p.st === 2
      ? [
          [-0.012, 0.012],
          [-0.045, 0.012],
          [-0.1, bw * 0.95],
          [-0.07, bw * 1.12],
          [-0.005, bw * 0.75],
        ]
      : [
          [-0.012, 0.012],
          [-0.042, 0.012],
          [-0.07, bw],
          [-0.032, bw * 1.08],
          [0.0, bw],
        ];
  k.blade('main', pts, 0.008, 'zy');
  if (p.st === 0) k.rod('metal', [0, -0.012, -0.025], [0, -0.08, -0.018], 0.012, 0.001, 4);
  if (p.st === 1) {
    k.rod('brass', [0, -0.012, -0.025], [0, -0.05, -0.025], 0.011, 0.016, 6);
    k.rod('dark', [0, -0.05, -0.025], [0, -0.052, -0.025], 0.012, 0.012, 6);
  }
}

function clubBody(k: Kit, p: P, headOnly: boolean) {
  const L = p.L;
  const r1 = p.r1;
  if (p.st === 3) {
    k.zrod('main', headOnly ? 0.01 : 0.15, -L + 0.03, 0.022, 0.026, 6);
    for (const s of [-1, 1]) {
      k.ball('main', 0.032, [s * 0.022, 0, -L + 0.01], 0);
      if (!headOnly) k.ball('main', 0.028, [s * 0.02, 0, 0.17], 0);
    }
    if (!headOnly) wraps(k, -0.02, 0.12, 0.022, 3);
    return;
  }
  const seg = p.st === 2 ? 8 : 7;
  const prof: [number, number][] =
    p.st === 2
      ? [
          [0.0001, 0.19],
          [0.022, 0.18],
          [0.022, -0.02],
          [r1 * 0.75, -L * 0.25],
          [r1, -L * 0.9],
          [r1 * 0.7, -L * 0.99],
          [0.0001, -L],
        ]
      : [
          [0.0001, 0.19],
          [0.02, 0.18],
          [0.02, 0.0],
          [r1 * 0.7, -L * 0.45],
          [r1, -L * 0.8],
          [r1 * 0.8, -L * 0.95],
          [0.0001, -L],
        ];
  const pr: [number, number][] = headOnly
    ? [
        [0.0001, 0.01],
        [0.021, 0.01],
        ...prof.filter(([, z]) => z < 0.005),
      ]
    : prof;
  k.zlathe('main', pr, seg);
  const rAt = (z: number) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [ra, za] = prof[i];
      const [rb, zb] = prof[i + 1];
      if (z <= za && z >= zb) return ra + ((rb - ra) * (za - z)) / (za - zb);
    }
    return 0.02;
  };
  if (p.st === 0) {
    const spots: [number, number][] = [
      [0.3, -0.55],
      [2.2, -0.62],
      [4.1, -0.7],
      [1.2, -0.78],
      [3.3, -0.85],
      [5.3, -0.8],
    ];
    for (const [a, f] of spots) {
      const r = rAt(L * f);
      k.ball('accent', 0.018, [Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, L * f], 0);
    }
  } else if (p.st === 1) {
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4;
      const z = -L * (0.5 + (i % 5) * 0.09);
      const r = rAt(z);
      k.rod('metal', [Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, z], [Math.cos(a) * (r + 0.035), Math.sin(a) * (r + 0.035), z - 0.004], 0.003, 0.002, 3);
    }
  } else {
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 2 * PI + row * 0.5;
        const z = -L * (0.55 + row * 0.13);
        const r = rAt(z);
        k.rod('metal', [Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, z], [Math.cos(a) * (r + 0.018), Math.sin(a) * (r + 0.018), z], 0.008, 0, 3);
      }
    if (!headOnly) {
      wraps(k, 0.0, 0.15, 0.021, 3);
      k.torus('metal', 0.014, 0.004, { p: [0, 0, 0.2], r: [0, PI / 2, 0] }, 3, 8);
    }
  }
}

function scytheHead(k: Kit, p: P) {
  if (p.st === 2) {
    const { top, bot } = glaiveFns({ W: p.W, c: 0.03 });
    k.zrod('metal', 0.01, -0.08, 0.02, 0.02, 6);
    k.blade('main', outline(p.Lb, top, bot, 8), 0.008, 'zy', { p: [0, 0, -0.06] });
    return;
  }
  k.zrod('metal', 0.01, -0.08, 0.02, 0.02, 6);
  k.box('metal', [0.03, 0.03, 0.05], { p: [0, 0.01, -0.06] });
  k.blade('main', scythePts(p), 0.008, 'zy');
  const { zc } = scytheEdge(p);
  if (p.st === 0) k.blade('#c9ced6', [[zc(0.1) + p.W * 0.5, p.Lb * 0.1], [zc(0.5) + p.W * 0.35, p.Lb * 0.5], [zc(0.85) + 0.02, p.Lb * 0.85], [zc(0.5) + p.W * 0.5, p.Lb * 0.5]], 0.009, 'zy');
}

function nunSections(p: P): [Vec3, Vec3][] {
  const lk = 0.022;
  const out: [Vec3, Vec3][] = [[[0, 0, -0.01], [0, 0, p.L - 0.01]]];
  let z = -0.01;
  let y = 0;
  for (let i = 1; i < p.n; i++) {
    const zs = z - 0.026 - p.cl * lk - 0.01;
    const y1 = y - 0.04;
    out.push([
      [0, y, zs],
      [0, y1, zs - p.L],
    ]);
    z = zs - p.L;
    y = y1;
  }
  return out;
}

function kamaHead(k: Kit, p: P) {
  k.zrod('metal', 0.01, -0.05, 0.017, 0.017, 6);
  const b = p.bl;
  k.blade(
    'main',
    [
      [-0.01, -0.005],
      [-0.045, -0.005],
      [-0.05, b * 0.45],
      [-0.035, b * 0.85],
      [0.0, b * 1.08],
      [-0.018, b * 0.8],
      [-0.022, b * 0.4],
    ],
    0.008,
    'zy',
  );
}

function kusariChain(p: P): Vec3[] {
  const n = p.nl;
  return chainLine([0, -0.006, 0.09], [0, -0.012 * n, 0.09 + 0.02 * n], n, -0.01);
}

function kusariWeight(p: P): Vec3 {
  if (!p.nl) return [0, 0, 0.08];
  const pts = kusariChain(p);
  const e = pts[pts.length - 1];
  return [0, e[1] - p.wr * 0.6, e[2] + p.wr * 0.75];
}

function chakramAngles(p: P): number[] {
  const out: number[] = [];
  if (!p.ns) return out;
  if (p.half) {
    for (let i = 0; i < p.ns; i++) out.push(((270 + (i - (p.ns - 1) / 2) * (150 / (p.ns - 1))) * PI) / 180);
    return out;
  }
  for (let i = 0; i < p.ns; i++) {
    const d = (270 + (i * 360) / p.ns) % 360;
    if (Math.abs(d - 90) < 30) continue;
    out.push((d * PI) / 180);
  }
  return out;
}

function whipCurve(p: P): Vec3[] {
  const out: Vec3[] = [];
  const L = p.L;
  const amp = p.st === 1 ? 0.09 : 0.12;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    out.push([0, -amp * Math.sin(PI * t * 1.6) * (0.4 + t) - (p.st === 1 ? 0.15 * t * t : 0), -0.01 - L * t * (p.st === 1 ? 0.9 : 0.85)]);
  }
  out[0] = [0, 0, -0.01];
  return out;
}

function whipCatEnds(p: P): [number, number][] {
  const s = p.L * 0.18;
  return [
    [-s, -0.03],
    [-s * 0.5, -0.06],
    [0, -0.07],
    [s * 0.5, -0.06],
    [s, -0.03],
  ];
}

function knucklePts(p: P): Pt[] {
  const xs = [-0.033, -0.011, 0.011, 0.033];
  const R = p.hr + 0.0055;
  const pts: Pt[] = [[-0.052, -0.035]];
  for (const x of xs) {
    for (const deg of [200, 270, 340]) {
      const a = (deg * PI) / 180;
      const rr = p.st === 2 && deg === 270 ? R + 0.013 : R;
      pts.push([x + Math.cos(a) * rr, -0.04 + Math.sin(a) * rr]);
    }
  }
  pts.push([0.052, -0.035], [0.05, 0.0], [0.035, 0.024], [0, 0.03], [-0.035, 0.024], [-0.05, 0.0]);
  return pts;
}
