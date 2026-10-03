/** SPORTS objects. See objkit.ts for the canonical frame + roles. */
import type { Kit, Pt } from '../../lib/kit';
import { circlePts } from '../../lib/kit';
import type { Vec3 } from '../../types';
import type { Anchors, ObjSpec, P } from './objkit';

const PI = Math.PI;
const CORK = '#c8a26b';
const RED = '#c8202a';

/** Radius of a [r, z] profile (z ascending) at z, by linear interpolation. */
function rAt(pts: Pt[], z: number): number {
  for (let i = 1; i < pts.length; i++) {
    const [r0, z0] = pts[i - 1];
    const [r1, z1] = pts[i];
    if (z >= z0 && z <= z1) return z1 === z0 ? Math.max(r0, r1) : r0 + ((z - z0) / (z1 - z0)) * (r1 - r0);
  }
  return 0;
}

/* ---------------- baseball bat ---------------- */
function batProfile(p: P): Pt[] {
  const zk = 0.08;
  const z0 = zk - p.L;
  const { rb, rh, L } = p;
  const body: Pt[] = p.al
    ? [
        [rb, z0 + 0.02],
        [rb, z0 + L * 0.42],
        [rh * 1.25, z0 + L * 0.66],
      ]
    : [
        [rb, z0 + 0.03],
        [rb * 0.96, z0 + L * 0.28],
        [rh * 1.7, z0 + L * 0.56],
        [rh * 1.1, z0 + L * 0.74],
      ];
  return [[0, z0], [rb * 0.86, z0 + 0.004], ...body, [rh, zk - 0.03], [rh * 2.1, zk - 0.014], [rh * 2.0, zk - 0.004], [0, zk]];
}

/* ---------------- racket ---------------- */
function racketPinch(p: P, s: number): number {
  return p.th === 2 ? 1 - 0.45 * Math.max(0, s) ** 2 : 1;
}
function racketHead(k: Kit, p: P): void {
  const zc = -p.st - p.b;
  const ring: Vec3[] = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * PI * 2;
    ring.push([p.a * Math.cos(t) * racketPinch(p, Math.sin(t)), 0, zc + p.b * Math.sin(t)]);
  }
  k.tube('main', ring, p.rt, 16, 4, true);
  for (let i = -3; i <= 3; i++) {
    const x = (i / 3.6) * p.a;
    const hl = p.b * Math.sqrt(1 - (x / p.a) ** 2) * (p.th === 2 ? 0.86 : 0.94);
    k.box('white', [0.0016, 0.0016, hl * 2], { p: [x, 0, zc - (p.th === 2 ? p.b * 0.06 : 0)] });
  }
  for (let j = -3; j <= 3; j++) {
    const z = zc + (j / 3.7) * p.b;
    const s = (z - zc) / p.b;
    const hw = p.a * Math.sqrt(1 - s * s) * racketPinch(p, s) * 0.95;
    k.box('white', [hw * 2, 0.0016, 0.0016], { p: [0, 0, z] });
  }
  if (p.th === 1) {
    k.zrod('metal', zc + p.b - 0.005, -0.02, 0.0035, 0.0045, 6);
    k.zrod('main', zc + p.b - 0.012, zc + p.b + 0.012, 0.007, 0.006, 6);
  } else {
    const spread = p.th === 2 ? 0.25 : 0.45;
    for (const s of [-1, 1]) k.rod('main', [s * 0.01, 0, -0.03], [s * p.a * spread, 0, zc + p.b * (p.th === 2 ? 0.97 : 0.92)], p.rt * 0.9, p.rt, 6);
    if (p.th === 0) k.rod('main', [-p.a * 0.45, 0, zc + p.b * 0.9], [p.a * 0.45, 0, zc + p.b * 0.9], p.rt * 0.8, p.rt * 0.8, 6);
  }
  k.zrod('main', -0.035, 0.002, p.hr * 0.75, p.hr, 8);
}

/* ---------------- hockey stick ---------------- */
function hockeyBlade(p: P, zh: number): Pt[] {
  const c = Math.cos(p.th);
  const s = Math.sin(p.th);
  const d: Pt = [-c, -s];
  const n: Pt = [-s, c];
  const H: Pt = [zh, -0.012];
  const B: Pt = [H[0] + d[0] * p.bl, H[1] + d[1] * p.bl];
  const T: Pt = [B[0] + n[0] * p.bh, B[1] + n[1] * p.bh];
  const U: Pt = [H[0] + n[0] * p.bh * 0.7, H[1] + n[1] * p.bh * 0.7];
  return [[zh + 0.03, 0.014], [zh + 0.03, -0.014], H, B, [B[0] + n[0] * p.bh * 0.55 - d[0] * 0.0, B[1] + n[1] * p.bh * 0.55], T, U];
}
function hockeyTip(p: P, zh: number): Vec3 {
  const pts = hockeyBlade(p, zh);
  let best = pts[0];
  for (const q of pts) if (q[0] < best[0]) best = q;
  return [0, best[1], best[0]];
}
const FIELD_RO = 0.055;
const FIELD_RI = 0.024;
function fieldHook(zh: number): Pt[] {
  const C: Pt = [zh - 0.035, 0.014 - FIELD_RO];
  const out: Pt[] = [[zh + 0.03, 0.014], [zh + 0.03, -0.014]];
  const angs = [90, 135, 180, 225, 270, 305];
  const inner: Pt[] = [];
  for (const a of angs) {
    const r = (a * PI) / 180;
    out.push([C[0] + FIELD_RO * Math.cos(r), C[1] + FIELD_RO * Math.sin(r)]);
    inner.push([C[0] + FIELD_RI * Math.cos(r), C[1] + FIELD_RI * Math.sin(r)]);
  }
  // re-order: shaft -> top of outer arc ... -> bottom -> inner arc back -> joint
  return [[zh + 0.03, 0.014], ...out.slice(2), ...inner.reverse(), [zh + 0.03, -0.014]];
}
function hockeyZh(p: P): number {
  const zR = 0.12;
  if (p.t === 1) return zR - p.L + 0.035 + FIELD_RO;
  const tip = hockeyTip(p, 0);
  return zR - p.L - tip[2];
}
function hockeyHeadGeom(k: Kit, p: P, zh: number): void {
  if (p.t === 1) {
    k.extrude('main', fieldHook(zh), 0.034, 'zy');
    k.zrod('accent', zh + 0.02, zh + 0.08, 0.0155, 0.0155, 8);
  } else {
    k.extrude('main', hockeyBlade(p, zh), p.t === 2 ? 0.016 : 0.013, 'zy');
    k.box('accent', [0.015, 0.03, 0.08], { p: [0, 0, zh + 0.05] });
    if (p.t === 2) k.box('main', [0.016, 0.085, 0.42], { p: [0, -0.0, zh + 0.25] });
  }
}

/* ---------------- golf club ---------------- */
const GOLF_D: Pt = [-0.6, -0.8];
const GOLF_N: Pt = [-0.8, 0.6];
function golfGeom(p: P) {
  const zR = 0.08;
  const zt = zR - p.L;
  let zs: number;
  let tipY: number;
  if (p.t === 0) {
    zs = zt + 0.1;
    tipY = -0.045;
  } else if (p.t === 1) {
    // iron: tip vertex = H + d*l + n*h with H = (zs - 0.03, -0.02)
    zs = zt + 0.03 + 0.6 * 0.075 + 0.8 * 0.045;
    tipY = -0.02 - 0.8 * 0.075 + 0.6 * 0.045;
  } else {
    zs = zt + 0.025;
    tipY = -0.045;
  }
  return { zR, zt, zs, tipY };
}
function golfHead(k: Kit, p: P, zs: number): void {
  if (p.t === 0) {
    const zt = zs - 0.1;
    k.rod('dark', [0, 0, zs], [0, -0.012, zt + 0.08], 0.0065, 0.008, 6);
    k.sphere('main', 1, { p: [0, -0.045, zt + 0.06], s: [0.05, 0.042, 0.06] }, 8, 6);
    k.box('metal', [0.06, 0.004, 0.08], { p: [0, -0.086, zt + 0.06] });
  } else if (p.t === 1) {
    const H: Pt = [zs - 0.03, -0.02];
    k.rod('metal', [0, 0, zs], [0, H[1] + 0.006, H[0] + 0.004], 0.006, 0.0075, 6);
    const l = 0.075;
    const h = 0.045;
    const B: Pt = [H[0] + GOLF_D[0] * l, H[1] + GOLF_D[1] * l];
    k.extrude(
      'metal',
      [H, B, [B[0] + GOLF_N[0] * h, B[1] + GOLF_N[1] * h], [H[0] + GOLF_N[0] * h * 0.8, H[1] + GOLF_N[1] * h * 0.8]],
      0.02,
      'zy',
    );
    k.box('main', [0.022, 0.012, 0.03], { p: [0, H[1] - 0.025, H[0] - 0.02], r: [-0.93, 0, 0] });
  } else {
    k.rod('metal', [0, 0, zs], [0, 0, zs - 0.01], 0.0055, 0.0055, 6);
    k.box('main', [0.034, 0.1, 0.025], { p: [0, -0.045, zs - 0.0125] });
    k.box('white', [0.004, 0.06, 0.002], { p: [0.017, -0.045, zs - 0.0125] });
  }
}

/* ---------------- oar ---------------- */
function oarGeom(p: P) {
  if (p.t === 1) return { z0: -1.4, zR: 0.7 };
  const zR = 0.12;
  return { z0: zR - p.L, zR };
}
function oarBladePts(p: P, z0: number): Pt[] {
  const { bl, bw } = p;
  const zb = z0 + bl;
  if (p.t === 0)
    return [
      [-0.014, zb],
      [0.014, zb],
      [bw * 0.55, z0 + bl * 0.35],
      [bw * 0.5, z0],
      [-bw * 0.4, z0 + 0.02],
      [-bw * 0.45, z0 + bl * 0.3],
    ];
  if (p.t === 1)
    return [
      [-0.012, zb],
      [0.012, zb],
      [bw / 2, z0 + bl * 0.4],
      [bw * 0.42, z0 + 0.02],
      [0, z0],
      [-bw * 0.42, z0 + 0.02],
      [-bw / 2, z0 + bl * 0.4],
    ];
  return [
    [-0.015, zb],
    [0.015, zb],
    [bw / 2, z0 + bl * 0.6],
    [bw / 2, z0 + bl * 0.18],
    [bw * 0.28, z0 + 0.012],
    [0, z0],
    [-bw * 0.28, z0 + 0.012],
    [-bw / 2, z0 + bl * 0.18],
    [-bw / 2, z0 + bl * 0.6],
  ];
}
function oarTipZ(p: P, z0: number): number {
  return p.t === 0 ? z0 + 0.02 * (0.5 / 0.9) : z0;
}

/* ---------------- skateboard ---------------- */
function boardGeom(p: P) {
  const zR = 0.16;
  return { zR, z0: zR - p.L };
}

/* ---------------- bowling pin ---------------- */
function pinProfile(p: P): Pt[] {
  const { H, B, N, D } = p;
  const z0 = -H * 0.68;
  return [
    [0, z0],
    [B * 0.45, z0],
    [B * 0.78, z0 + H * 0.08],
    [B, z0 + H * 0.27],
    [B * 0.93, z0 + H * 0.4],
    [N * 1.6, z0 + H * 0.55],
    [N, 0],
    [N * 1.08, H * 0.06],
    [D, H * 0.16],
    [D * 0.96, H * 0.22],
    [D * 0.68, H * 0.29],
    [0, H * 0.32],
  ];
}

/* ---------------- balls ---------------- */
function ballR(p: P): { r: number; a: number } {
  return p.t === 2 ? { r: 0.085, a: 0.14 } : { r: p.r, a: p.r };
}

/* ---------------- dumbbell ---------------- */
function bellLen(p: P): number {
  return p.t === 2 ? 0.05 : p.t === 1 ? 0.07 : 0.055;
}

/* ---------------- kettlebell ---------------- */
function kbZc(p: P): number {
  return 0.05 + p.R * 0.85;
}

export const SPORTS: ObjSpec[] = [
  /* ================= BASEBALL BAT ================= */
  {
    kind: 'baseball-bat',
    group: 'sports',
    noun: 'Baseball Bat',
    syn: ['bat', 'baseball bat', 'slugger', 'softball', 'club', 'louisville'],
    tags: ['sports', 'wood', 'metal'],
    desc: 'baseball bat',
    color: '#c8955a',
    accent: '#1f1f22',
    variants: [
      { v: 'wood', p: { L: 0.84, rb: 0.033, rh: 0.012, al: 0, nails: 0 }, desc: 'classic wooden baseball bat' },
      { v: 'aluminum', p: { L: 0.8, rb: 0.031, rh: 0.0125, al: 1, nails: 0 }, desc: 'aluminum bat with grip tape' },
      { v: 'softball', p: { L: 0.86, rb: 0.027, rh: 0.011, al: 1, nails: 0 }, desc: 'long thin softball bat', noun: 'Softball Bat' },
      { v: 'nailbat', p: { L: 0.84, rb: 0.035, rh: 0.013, al: 0, nails: 1 }, desc: 'wooden bat studded with nails' },
    ],
    draw(k, p) {
      const pts = batProfile(p);
      k.zlathe(p.al ? 'metal' : 'main', pts, 9);
      const z0 = 0.08 - p.L;
      if (p.al) {
        k.zrod('main', z0 + p.L * 0.08, z0 + p.L * 0.3, p.rb * 1.01, p.rb * 1.01, 9);
        k.zrod('accent', z0 + p.L * 0.72, 0.066, p.rh * 1.12, p.rh * 1.12, 8);
        k.zrod('dark', z0 - 0.002, z0 + 0.008, p.rb * 0.9, p.rb * 0.9, 9);
      } else k.zrod('accent', -0.06, 0.04, p.rh * 1.1, p.rh * 1.1, 8);
      if (p.nails) {
        for (let i = 0; i < 9; i++) {
          const z = z0 + 0.04 + i * 0.03;
          const a = i * 2.2;
          const r = rAt(pts, z);
          const d: Vec3 = [Math.cos(a), Math.sin(a), 0];
          k.rod('metal', [d[0] * r * 0.8, d[1] * r * 0.8, z], [d[0] * (r + 0.035), d[1] * (r + 0.035), z], 0.0018, 0.0012, 3);
        }
      }
    },
    anchors(p) {
      const pts = batProfile(p);
      const z0 = 0.08 - p.L;
      const zt = z0 + p.L * 0.2;
      const zu = z0 + p.L * 0.36;
      const rt = rAt(pts, zt);
      return {
        tip: [0, 0, z0],
        rear: [0, 0, 0.08],
        top: [0, rt, zt],
        grip: [0, -p.rh * 1.1, 0.0],
        under: [0, -rAt(pts, zu), zu],
        side: [rt, 0, zt],
      };
    },
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  /* ================= RACKET ================= */
  {
    kind: 'racket',
    group: 'sports',
    noun: 'Racket',
    syn: ['racket', 'racquet', 'tennis racket', 'badminton', 'squash', 'strings'],
    tags: ['sports', 'light', 'modern'],
    desc: 'strung sports racket',
    color: '#2f6fd0',
    accent: '#f2efe8',
    variants: [
      { v: 'tennis', p: { a: 0.13, b: 0.16, st: 0.17, hl: 0.19, hr: 0.015, rt: 0.008, th: 0 }, desc: 'tennis racket', noun: 'Tennis Racket' },
      { v: 'badminton', p: { a: 0.1, b: 0.12, st: 0.25, hl: 0.2, hr: 0.012, rt: 0.0055, th: 1 }, desc: 'light badminton racket long shaft', noun: 'Badminton Racket' },
      { v: 'squash', p: { a: 0.105, b: 0.15, st: 0.12, hl: 0.19, hr: 0.014, rt: 0.007, th: 2 }, desc: 'teardrop squash racket', noun: 'Squash Racket' },
    ],
    draw(k, p) {
      racketHead(k, p);
      k.zrod('accent', 0.0, p.hl, p.hr, p.hr, 8);
      k.zrod('main', p.hl, p.hl + 0.008, p.hr * 1.15, p.hr * 1.1, 8);
    },
    head: racketHead,
    anchors(p) {
      const zc = -p.st - p.b;
      return {
        tip: [0, 0, zc - p.b - p.rt],
        rear: [0, 0, p.hl + 0.008],
        top: [0, 0.0008, zc],
        grip: [0, -p.hr, p.hl * 0.4],
        under: [0, -0.0008, zc],
        side: [p.a + p.rt, 0, zc],
        mag: [0, -p.hr, p.hl * 0.2],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
    guns: ['shotgun', 'grenade_launcher'],
    fireMode: 'projectile',
    ammo: 'tennis balls',
  },

  /* ================= PING PONG PADDLE ================= */
  {
    kind: 'ping-pong-paddle',
    group: 'sports',
    noun: 'Ping Pong Paddle',
    syn: ['ping pong', 'table tennis', 'paddle', 'bat', 'paddleball'],
    tags: ['sports', 'wood', 'rubber', 'light', 'silly'],
    desc: 'table tennis paddle',
    color: '#c8202a',
    accent: '#1f1f22',
    variants: [
      { v: 'shakehand', p: { R: 0.078, hl: 0.1, t: 0 }, desc: 'red and black ping pong paddle' },
      { v: 'penhold', p: { R: 0.082, hl: 0.065, t: 1 }, desc: 'short handled penhold paddle' },
      { v: 'paddleball', p: { R: 0.1, hl: 0.11, t: 2 }, desc: 'wooden paddleball with ball on string', noun: 'Paddleball' },
    ],
    draw(k, p) {
      const zc = -p.R - 0.005;
      const circ = circlePts(p.R, 16, 0, zc);
      if (p.t === 2) {
        k.extrude('wood', circ, 0.008, 'xz');
        k.rod('white', [0, 0.004, zc], [0, 0.22, zc - 0.06], 0.0012, 0.0012, 3);
        k.ball('main', 0.02, [0, 0.235, zc - 0.064], 1);
        k.box('wood', [0.03, 0.02, p.hl + 0.02], { p: [0, 0, p.hl / 2 - 0.01] });
        return;
      }
      k.extrude('wood', circ, 0.006, 'xz');
      k.extrude('main', circlePts(p.R * 0.985, 16, 0, zc), 0.002, 'xz', { p: [0, 0.004, 0] });
      k.extrude('accent', circlePts(p.R * 0.985, 16, 0, zc), 0.002, 'xz', { p: [0, -0.004, 0] });
      if (p.t === 0) {
        k.box('wood', [0.026, 0.022, p.hl + 0.02], { p: [0, 0, p.hl / 2 - 0.01] });
        k.box('wood', [0.032, 0.026, 0.03], { p: [0, 0, p.hl - 0.025] });
      } else {
        k.box('wood', [0.024, 0.016, p.hl + 0.02], { p: [0, 0, p.hl / 2 - 0.01] });
        k.box(CORK, [0.03, 0.01, 0.025], { p: [0, 0.01, 0.0] });
      }
    },
    anchors(p) {
      const zc = -p.R - 0.005;
      const ty = p.t === 2 ? 0.004 : 0.005;
      const hy = p.t === 1 ? 0.008 : p.t === 2 ? 0.01 : 0.011;
      return {
        tip: [0, 0, zc - p.R],
        rear: [0, 0, p.hl],
        top: [0, ty, zc],
        grip: [0, -hy, p.hl * 0.4],
        under: [0, -ty, zc],
        side: [p.R, 0, zc],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },

  /* ================= HOCKEY STICK ================= */
  {
    kind: 'hockey-stick',
    group: 'sports',
    noun: 'Hockey Stick',
    syn: ['hockey stick', 'hockey', 'stick', 'field hockey', 'goalie stick', 'puck'],
    tags: ['sports', 'wood', 'light'],
    desc: 'hockey stick with angled blade',
    color: '#d8352a',
    accent: '#1f1f22',
    variants: [
      { v: 'ice', p: { t: 0, L: 1.5, bl: 0.3, bh: 0.075, th: 0.78 }, desc: 'ice hockey stick taped blade' },
      { v: 'goalie', p: { t: 2, L: 1.55, bl: 0.36, bh: 0.09, th: 0.8 }, desc: 'wide paddled goalie hockey stick', noun: 'Goalie Stick' },
      { v: 'field', p: { t: 1, L: 0.92 }, desc: 'field hockey stick with J hook', noun: 'Field Hockey Stick' },
    ],
    draw(k, p) {
      const zR = 0.12;
      const zh = hockeyZh(p);
      if (p.t === 1) k.zrod('wood', zh + 0.02, zR - 0.22, 0.0145, 0.0145, 8);
      else k.box('wood', [0.018, 0.028, zR - 0.22 - zh], { p: [0, 0, (zR - 0.22 + zh) / 2] });
      if (p.t === 1) k.zrod('accent', zR - 0.22, zR, 0.017, 0.017, 8);
      else k.box('accent', [0.021, 0.031, 0.22], { p: [0, 0, zR - 0.11] });
      hockeyHeadGeom(k, p, zh);
    },
    head(k, p) {
      const zh = -0.12;
      hockeyHeadGeom(k, p, zh);
      if (p.t === 1) k.zrod('wood', zh + 0.02, 0, 0.0145, 0.0145, 8);
      else k.box('wood', [0.018, 0.028, -zh], { p: [0, 0, zh / 2] });
    },
    anchors(p) {
      const zR = 0.12;
      const zh = hockeyZh(p);
      const zm = (zh + zR - 0.22) / 2 + (p.t === 2 ? 0.1 : 0);
      const tip: Vec3 = p.t === 1 ? [0, 0.014 - FIELD_RO, zh - 0.035 - FIELD_RO] : hockeyTip(p, zh);
      const ry = p.t === 1 ? 0.0145 : 0.014;
      return {
        tip,
        rear: [0, 0, zR],
        top: [0, ry, zm],
        grip: [0, -(p.t === 1 ? 0.017 : 0.0155), -0.02],
        under: [0, p.t === 2 ? -0.0425 : -ry, zh + 0.12],
        side: [p.t === 1 ? 0.0145 : 0.009, 0, zm],
      };
    },
    roles: ['head', 'blade', 'deco'],
    melee: { swing: 'slash', weight: 'medium' },
  },

  /* ================= GOLF CLUB ================= */
  {
    kind: 'golf-club',
    group: 'sports',
    noun: 'Golf Club',
    syn: ['golf club', 'golf', 'driver', 'iron', 'putter', 'wedge'],
    tags: ['sports', 'metal', 'light'],
    desc: 'golf club',
    color: '#2b2b2e',
    accent: '#1f1f22',
    variants: [
      { v: 'driver', p: { t: 0, L: 1.15 }, desc: 'big headed golf driver', noun: 'Golf Driver' },
      { v: 'iron', p: { t: 1, L: 0.96 }, desc: 'steel golf iron', noun: 'Golf Iron' },
      { v: 'putter', p: { t: 2, L: 0.88 }, desc: 'blade golf putter', noun: 'Putter' },
    ],
    draw(k, p) {
      const g = golfGeom(p);
      k.zrod('accent', g.zR - 0.26, g.zR, 0.0105, 0.0135, 8);
      k.zrod('metal', g.zs, g.zR - 0.26, 0.0045, 0.0075, 6);
      golfHead(k, p, g.zs);
    },
    head(k, p) {
      golfHead(k, p, -0.06);
      k.zrod('metal', -0.06, 0, 0.0048, 0.0055, 6);
      k.zrod('dark', -0.065, -0.022, 0.009, 0.008, 8);
    },
    anchors(p) {
      const g = golfGeom(p);
      const rg = (z: number) => 0.0105 + ((z - (g.zR - 0.26)) / 0.26) * 0.003;
      const zu = (g.zs + g.zR - 0.26) / 2;
      const ru = 0.0045 + ((zu - g.zs) / (g.zR - 0.26 - g.zs)) * 0.003;
      const tip: Vec3 = p.t === 0 ? [0, g.tipY, g.zt] : p.t === 1 ? [0, g.tipY, g.zt] : [0, g.tipY, g.zt];
      return {
        tip,
        rear: [0, 0, g.zR],
        top: [0, rg(-0.05), -0.05],
        grip: [0, -rg(0), 0],
        under: [0, -ru, zu],
        side: [rg(-0.05), 0, -0.05],
      };
    },
    roles: ['head', 'blade', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
    guns: ['sniper'],
  },

  /* ================= CRICKET BAT ================= */
  {
    kind: 'cricket-bat',
    group: 'sports',
    noun: 'Cricket Bat',
    syn: ['cricket bat', 'cricket', 'bat', 'willow', 'mongoose', 'paddle'],
    tags: ['sports', 'wood', 'retro'],
    desc: 'willow cricket bat',
    color: '#e3c58c',
    accent: '#1f1f22',
    variants: [
      { v: 'classic', p: { w: 0.108, t: 0.042, bl: 0.56, hl: 0.29, sp: 1 }, desc: 'classic willow cricket bat' },
      { v: 'backyard', p: { w: 0.1, t: 0.024, bl: 0.5, hl: 0.26, sp: 0 }, desc: 'flat backyard tape ball bat' },
      { v: 'mongoose', p: { w: 0.11, t: 0.048, bl: 0.42, hl: 0.42, sp: 1 }, desc: 'mongoose bat long handle short blade' },
    ],
    draw(k, p) {
      const { w, t, bl, hl } = p;
      const sec: Pt[] = p.sp
        ? [
            [-w / 2, t / 2],
            [-w / 2, -t * 0.1],
            [-0.025, -t / 2],
            [0.025, -t / 2],
            [w / 2, -t * 0.1],
            [w / 2, t / 2],
          ]
        : [
            [-w / 2, t / 2],
            [-w / 2, -t / 2],
            [w / 2, -t / 2],
            [w / 2, t / 2],
          ];
      k.extrude('main', sec, bl, 'xy', { p: [0, 0, -bl / 2] });
      k.box('accent', [w * 0.7, 0.002, 0.07], { p: [0, t / 2, -0.06] });
      k.box('main', [w * 0.6, t * 0.6, 0.04], { p: [0, 0, 0.0] });
      k.zrod('wood', -0.03, hl, 0.0145, 0.0145, 8);
      k.zrod('accent', 0.03, hl, 0.0172, 0.0172, 8);
    },
    anchors(p) {
      const { w, t, bl, hl } = p;
      return {
        tip: [0, 0, -bl],
        rear: [0, 0, hl],
        top: [0, t / 2, -bl * 0.5],
        grip: [0, -0.0172, 0.06],
        under: [0, -t / 2, -bl * 0.6],
        side: [w / 2, 0, -bl * 0.5],
      };
    },
    head(k, p) {
      const { w, t, bl } = p;
      const sec: Pt[] = p.sp
        ? [
            [-w / 2, t / 2],
            [-w / 2, -t * 0.1],
            [-0.025, -t / 2],
            [0.025, -t / 2],
            [w / 2, -t * 0.1],
            [w / 2, t / 2],
          ]
        : [
            [-w / 2, t / 2],
            [-w / 2, -t / 2],
            [w / 2, -t / 2],
            [w / 2, t / 2],
          ];
      k.extrude('main', sec, bl, 'xy', { p: [0, 0, -bl / 2 - 0.03] });
      k.box('accent', [w * 0.7, 0.002, 0.07], { p: [0, t / 2, -0.09] });
      k.zrod('wood', -0.04, 0.01, 0.0145, 0.0145, 8);
    },
    roles: ['head', 'blade', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  /* ================= OAR / PADDLE ================= */
  {
    kind: 'oar',
    group: 'sports',
    noun: 'Oar',
    syn: ['oar', 'paddle', 'kayak paddle', 'canoe paddle', 'rowing', 'boat'],
    tags: ['sports', 'wood', 'light'],
    desc: 'long rowing oar',
    color: '#d8352a',
    accent: '#f0c419',
    variants: [
      { v: 'rowing', p: { t: 0, L: 2.0, bl: 0.48, bw: 0.22, r: 0.019 }, desc: 'long rowing oar cleaver blade' },
      { v: 'kayak', p: { t: 1, L: 2.1, bl: 0.45, bw: 0.17, r: 0.016 }, desc: 'double bladed kayak paddle', noun: 'Kayak Paddle' },
      { v: 'canoe', p: { t: 2, L: 1.45, bl: 0.55, bw: 0.2, r: 0.016 }, desc: 'wooden canoe paddle T grip', noun: 'Canoe Paddle' },
    ],
    draw(k, p) {
      const g = oarGeom(p);
      const zb = g.z0 + p.bl;
      const shaftSlot = p.t === 2 ? 'wood' : 'dark';
      const bladeSlot = p.t === 2 ? 'wood' : 'main';
      k.extrude(bladeSlot, oarBladePts(p, g.z0), 0.009, 'xz');
      k.zrod(bladeSlot, zb - 0.1, zb + 0.04, p.r * 0.8, p.r, 8);
      if (p.t === 1) {
        const zb2 = g.zR - p.bl;
        k.zrod(shaftSlot, zb, zb2, p.r, p.r, 8);
        const loc = oarBladePts(p, 0).map(([x, z]) => [x, -z] as Pt);
        k.extrude(bladeSlot, loc, 0.009, 'xz', { p: [0, 0, g.zR], r: [0, 0, 1.0] });
        k.zrod(bladeSlot, zb2 - 0.04, zb2 + 0.1, p.r, p.r * 0.8, 8);
        for (const z of [zb + 0.12, zb2 - 0.12]) k.zrod('accent', z - 0.006, z + 0.006, 0.045, 0.045, 10);
      } else if (p.t === 0) {
        k.zrod(shaftSlot, zb, g.zR - 0.15, p.r, p.r, 8);
        k.box('white', [0.05, 0.05, 0.16], { p: [0, 0, g.zR - 0.38] });
        k.zrod('accent', g.zR - 0.32, g.zR - 0.29, 0.035, 0.035, 8);
        k.zrod('wood', g.zR - 0.15, g.zR, p.r * 1.25, p.r * 1.25, 8);
      } else {
        k.zrod(shaftSlot, zb, g.zR - 0.01, p.r, p.r, 8);
        k.rod('wood', [-0.055, 0, g.zR - 0.012], [0.055, 0, g.zR - 0.012], 0.014, 0.014, 6);
        k.zrod('accent', zb + 0.02, zb + 0.06, p.r * 1.1, p.r * 1.1, 8);
      }
    },
    head(k, p) {
      const z0 = -p.bl - 0.06;
      const bladeSlot = p.t === 2 ? 'wood' : 'main';
      k.extrude(bladeSlot, oarBladePts(p, z0), 0.009, 'xz');
      k.zrod(bladeSlot, z0 + p.bl - 0.1, 0, p.r * 0.8, p.r, 8);
    },
    anchors(p) {
      const g = oarGeom(p);
      const zb = g.z0 + p.bl;
      const zs = p.t === 1 ? g.zR - p.bl : p.t === 0 ? g.zR - 0.15 : g.zR - 0.03;
      const zm = (zb + zs) / 2;
      const r = p.r;
      return {
        tip: [0, 0, oarTipZ(p, g.z0)],
        rear: [0, 0, p.t === 2 ? g.zR - 0.012 + 0.014 : g.zR],
        top: [0, r, zm],
        grip: [0, -r, -0.04],
        under: [0, -r, zb + 0.08],
        side: [r, 0, zm],
      };
    },
    roles: ['head', 'blade', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  /* ================= FISHING ROD ================= */
  {
    kind: 'fishing-rod',
    group: 'sports',
    noun: 'Fishing Rod',
    syn: ['fishing rod', 'fishing pole', 'rod', 'reel', 'angler', 'fly rod'],
    tags: ['sports', 'light', 'modern', 'silly'],
    desc: 'fishing rod with reel',
    color: '#1d4f8a',
    accent: '#c8202a',
    variants: [
      { v: 'spinning', p: { t: 0, L: 1.8, zr: 0.3 }, desc: 'spinning rod with reel and bobber' },
      { v: 'fly', p: { t: 1, L: 2.0, zr: 0.22 }, desc: 'long fly rod with round reel', noun: 'Fly Rod' },
      { v: 'surf', p: { t: 2, L: 2.3, zr: 0.45 }, desc: 'heavy surf casting rod big reel', noun: 'Surf Rod' },
    ],
    draw(k, p) {
      const zR = p.zr;
      const z0 = zR - p.L;
      k.zrod('main', z0, -0.12, 0.0018, 0.0068, 6);
      k.zrod(CORK, -0.12, -0.04, 0.012, 0.012, 6);
      k.zrod('dark', -0.04, 0.04, 0.0105, 0.0105, 6);
      k.zrod(CORK, 0.04, zR - 0.02, 0.014, 0.014, 6);
      k.zrod('rubber', zR - 0.02, zR, 0.015, 0.012, 6);
      const nG = 4;
      for (let i = 0; i < nG; i++) {
        const z = -0.4 + ((z0 + 0.06 + 0.4) * (i / (nG - 1)) ** 1.1);
        const R = 0.009 - i * 0.0012;
        k.rod('metal', [0, -0.003, z], [0, -0.008 - R, z], 0.0012, 0.0012, 3);
        k.torus('metal', R, 0.0013, { p: [0, -0.008 - R * 2, z] }, 3, 4);
      }
      if (p.t === 1) {
        k.rod('dark', [0, -0.012, 0.15], [0, -0.03, 0.15], 0.004, 0.004, 4);
        k.rod('brass', [-0.012, -0.065, 0.15], [0.012, -0.065, 0.15], 0.042, 0.042, 12);
        k.rod('dark', [0.012, -0.08, 0.17], [0.025, -0.08, 0.17], 0.005, 0.005, 6);
      } else {
        const s = p.t === 2 ? 1.35 : 1;
        k.rod('dark', [0, -0.01, 0], [0, -0.045 * s, -0.004], 0.004 * s, 0.004 * s, 3);
        k.box('dark', [0.03 * s, 0.035 * s, 0.04 * s], { p: [0, -0.06 * s, 0.005] });
        k.zrod('metal', -0.055 * s, -0.012 * s, 0.022 * s, 0.024 * s, 8, 0, -0.06 * s);
        k.torus('accent', 0.024 * s, 0.002, { p: [0, -0.06 * s, -0.058 * s] }, 3, 8);
        k.rod('dark', [0.015 * s, -0.06 * s, 0.01], [0.045 * s, -0.075 * s, 0.01], 0.004, 0.004, 4);
      }
      if (p.t === 0) {
        k.rod('white', [0, 0, z0], [0, -0.16, z0], 0.0008, 0.0008, 3);
        k.sphere('accent', 0.018, { p: [0, -0.17, z0] }, 6, 3, PI / 2);
        k.sphere('white', 0.018, { p: [0, -0.17, z0], r: [PI, 0, 0] }, 6, 3, PI / 2);
      }
    },
    anchors(p) {
      const zR = p.zr;
      const z0 = zR - p.L;
      const zu = z0 * 0.4;
      const ru = 0.0018 + ((zu - z0) / (-0.12 - z0)) * 0.005;
      return {
        tip: [0, 0, z0],
        rear: [0, 0, zR],
        top: [0, 0.012, -0.08],
        grip: [0, -0.012, -0.08],
        under: [0, -ru, zu],
        side: [0.012, 0, -0.08],
      };
    },
    roles: ['barrel', 'blade', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
    guns: ['crossbow', 'sniper', 'rifle'],
    fireMode: 'projectile',
    ammo: 'fish hooks',
  },

  /* ================= SKATEBOARD ================= */
  {
    kind: 'skateboard',
    group: 'sports',
    noun: 'Skateboard',
    syn: ['skateboard', 'skate', 'board', 'longboard', 'cruiser', 'deck'],
    tags: ['sports', 'wood', 'modern', 'silly'],
    desc: 'skateboard with trucks and wheels',
    color: '#d8352a',
    accent: '#f0c419',
    variants: [
      { v: 'popsicle', p: { t: 0, L: 0.8, w: 0.2, wr: 0.026 }, desc: 'street skateboard with kicktails' },
      { v: 'longboard', p: { t: 1, L: 1.0, w: 0.24, wr: 0.034 }, desc: 'long pintail longboard', noun: 'Longboard' },
      { v: 'cruiser', p: { t: 2, L: 0.7, w: 0.19, wr: 0.032 }, desc: 'fishtail cruiser board fat wheels', noun: 'Cruiser Board' },
    ],
    draw(k, p) {
      const { z0, zR } = boardGeom(p);
      const w = p.w;
      const ky = 0.04;
      if (p.t === 0) {
        k.extrude(
          'main',
          [
            [z0, ky + 0.006],
            [z0 + 0.12, 0.006],
            [zR - 0.12, 0.006],
            [zR, ky + 0.006],
            [zR, ky - 0.006],
            [zR - 0.12, -0.006],
            [z0 + 0.12, -0.006],
            [z0, ky - 0.006],
          ],
          w,
          'zy',
        );
        k.box('dark', [w - 0.01, 0.002, p.L - 0.24], { p: [0, 0.007, (z0 + zR) / 2] });
      } else {
        const h = w / 2;
        const half: Pt[] =
          p.t === 1
            ? [
                [0, z0],
                [h * 0.6, z0 + 0.04],
                [h, z0 + 0.2],
                [h, z0 + 0.55],
                [h * 0.5, zR - 0.08],
              ]
            : [
                [0, z0],
                [h * 0.7, z0 + 0.03],
                [h, z0 + 0.12],
                [h, zR - 0.15],
                [h * 0.8, zR - 0.04],
                [h * 0.5, zR],
              ];
        const tail: Pt[] = p.t === 1 ? [[0, zR]] : [[0, zR - 0.035]];
        const pts: Pt[] = [...half, ...tail, ...half.slice(1).reverse().map(([x, z]) => [-x, z] as Pt)];
        k.extrude('main', pts, 0.014, 'xz');
        k.box('dark', [w * 0.7, 0.002, p.L * 0.6], { p: [0, 0.008, (z0 + zR) / 2] });
      }
      const dy = p.t === 0 ? -0.006 : -0.007;
      for (const zt of [z0 + 0.17, zR - 0.17]) {
        k.box('metal', [0.05, 0.01, 0.07], { p: [0, dy - 0.005, zt] });
        k.box('metal', [w * 0.72, 0.016, 0.022], { p: [0, dy - 0.022, zt] });
        for (const s of [-1, 1]) k.rod('accent', [s * w * 0.32, dy - 0.024, zt], [s * w * 0.48, dy - 0.024, zt], p.wr, p.wr, 8);
      }
    },
    anchors(p) {
      const { z0, zR } = boardGeom(p);
      const zm = (z0 + zR) / 2;
      if (p.t === 0)
        return {
          tip: [0, 0.04, z0],
          rear: [0, 0.04, zR],
          top: [0, 0.008, zm],
          grip: [0, -0.006, 0.02],
          under: [0, -0.006, z0 + 0.3],
          side: [p.w / 2, 0, zm],
        };
      return {
        tip: [0, 0, z0],
        rear: p.t === 1 ? [0, 0, zR] : [p.w * 0.25, 0, zR],
        top: [0, 0.009, zm],
        grip: [0, -0.007, 0.02],
        under: [0, -0.007, z0 + 0.3],
        side: [p.w / 2, 0, zm],
      };
    },
    roles: ['deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['lmg', 'rocket_launcher'],
  },

  /* ================= BOWLING PIN ================= */
  {
    kind: 'bowling-pin',
    group: 'sports',
    noun: 'Bowling Pin',
    syn: ['bowling pin', 'pin', 'skittle', 'duckpin', 'candlepin', 'bowling'],
    tags: ['sports', 'wood', 'retro', 'silly'],
    desc: 'white bowling pin with red stripes',
    color: '#f2efe8',
    accent: '#c8202a',
    variants: [
      { v: 'tenpin', p: { H: 0.38, B: 0.06, N: 0.022, D: 0.032 }, desc: 'classic tenpin bowling pin' },
      { v: 'duckpin', p: { H: 0.24, B: 0.062, N: 0.024, D: 0.032 }, desc: 'short fat duckpin', noun: 'Duckpin' },
      { v: 'candlepin', p: { H: 0.4, B: 0.037, N: 0.026, D: 0.03 }, desc: 'slim tall candlepin', noun: 'Candlepin' },
    ],
    draw(k, p) {
      const pts = pinProfile(p);
      k.zlathe('main', pts, 10);
      for (const z of [-p.H * 0.06, -p.H * 0.12]) {
        const r = rAt(pts, z) + 0.0015;
        k.zrod('accent', z - 0.006, z + 0.006, r, r, 10);
      }
    },
    anchors(p) {
      const pts = pinProfile(p);
      const z0 = -p.H * 0.68;
      return {
        tip: [0, 0, z0],
        rear: [0, 0, p.H * 0.32],
        top: [0, p.B, z0 + p.H * 0.27],
        grip: [0, -p.N, 0],
        under: [0, -rAt(pts, z0 + p.H * 0.4), z0 + p.H * 0.4],
        side: [p.B, 0, z0 + p.H * 0.27],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'overhead', weight: 'medium' },
  },

  /* ================= BALL ================= */
  {
    kind: 'ball',
    group: 'sports',
    noun: 'Ball',
    syn: ['ball', 'basketball', 'soccer ball', 'football', 'baseball', 'bowling ball'],
    tags: ['sports', 'rubber', 'toy', 'silly'],
    desc: 'sports ball',
    color: '#e0702a',
    accent: '#1f1f22',
    variants: [
      { v: 'basketball', p: { t: 0, r: 0.12 }, desc: 'orange basketball with seams', noun: 'Basketball' },
      { v: 'soccer', p: { t: 1, r: 0.11 }, desc: 'black and white soccer ball', noun: 'Soccer Ball' },
      { v: 'football', p: { t: 2, r: 0.085 }, desc: 'american football with laces', noun: 'Football' },
      { v: 'baseball', p: { t: 3, r: 0.037 }, desc: 'white baseball red stitching', noun: 'Baseball' },
      { v: 'bowling', p: { t: 4, r: 0.108 }, desc: 'heavy bowling ball finger holes', noun: 'Bowling Ball' },
    ],
    draw(k, p) {
      const { r, a } = ballR(p);
      const c: Vec3 = [0, 0, -a];
      if (p.t === 0) {
        k.sphere('main', r, { p: c }, 12, 8);
        k.torus('accent', r * 1.003, 0.0025, { p: c, r: [PI / 2, 0, 0] }, 3, 16);
        k.torus('accent', r * 1.003, 0.0025, { p: c }, 3, 16);
        k.torus('accent', r * 1.003, 0.0025, { p: c, r: [0, PI / 2, 0] }, 3, 16);
      } else if (p.t === 1) {
        k.ball('white', r * 0.965, c, 1);
        k.ball('dark', r, c, 0);
      } else if (p.t === 2) {
        k.zlathe(
          '#7a3f1d',
          [
            [0, -a],
            [r * 0.42, -a * 0.75],
            [r * 0.82, -a * 0.4],
            [r, 0],
            [r * 0.82, a * 0.4],
            [r * 0.42, a * 0.75],
            [0, a],
          ],
          8,
          c,
        );
        for (const s of [-1, 1]) {
          const z = c[2] + s * a * 0.55;
          const rr = r * (0.82 - ((0.55 - 0.4) / 0.35) * 0.4) + 0.002;
          k.zrod('white', z - 0.006, z + 0.006, rr, rr, 8);
        }
        k.box('white', [0.006, 0.006, a * 0.6], { p: [0, r * 0.99, c[2]] });
        for (let i = 0; i < 5; i++) k.box('white', [0.022, 0.006, 0.005], { p: [0, r * 0.99, c[2] - a * 0.22 + i * a * 0.11] });
      } else if (p.t === 3) {
        k.sphere('white', r, { p: c }, 12, 8);
        const pts: Vec3[] = [];
        for (let i = 0; i < 16; i++) {
          const t = (i / 16) * PI * 2;
          const v: Vec3 = [0.65 * Math.cos(t) + 0.3 * Math.cos(3 * t), 0.65 * Math.sin(t) - 0.3 * Math.sin(3 * t), 0.9 * Math.sin(2 * t)];
          const l = Math.hypot(v[0], v[1], v[2]);
          pts.push([(v[0] / l) * r * 1.01, (v[1] / l) * r * 1.01 + c[1], (v[2] / l) * r * 1.01 + c[2]]);
        }
        k.tube(RED, pts, 0.0025, 24, 3, true);
      } else {
        k.sphere('main', r, { p: c }, 12, 8);
        const holes: Vec3[] = [
          [-0.022, 0.86, -0.5],
          [0.022, 0.86, -0.5],
          [0, 0.98, -0.05],
        ];
        for (const h of holes) {
          const l = Math.hypot(h[0], h[1], h[2]);
          const d: Vec3 = [h[0] / l, h[1] / l, h[2] / l];
          k.rod('dark', [c[0] + d[0] * r * 0.97, c[1] + d[1] * r * 0.97, c[2] + d[2] * r * 0.97], [c[0] + d[0] * r * 1.004, c[1] + d[1] * r * 1.004, c[2] + d[2] * r * 1.004], 0.011, 0.011, 8);
        }
      }
    },
    anchors(p) {
      const { r, a } = ballR(p);
      return {
        tip: [0, 0, -2 * a],
        rear: [0, 0, 0],
        top: [0, r, -a],
        grip: [0, -r, -a],
        under: [0, -r, -a],
        side: [r, 0, -a],
      };
    },
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },

  /* ================= BOXING GLOVE ================= */
  {
    kind: 'boxing-glove',
    group: 'sports',
    noun: 'Boxing Glove',
    syn: ['boxing glove', 'glove', 'punch', 'fist', 'mma', 'boxing'],
    tags: ['sports', 'rubber', 'silly', 'toy'],
    desc: 'padded red boxing glove',
    color: '#c8202a',
    accent: '#f2efe8',
    variants: [
      { v: 'boxing', p: { t: 0, s: 1 }, desc: 'lace up red boxing glove' },
      { v: 'mma', p: { t: 1, s: 0.75 }, desc: 'small fingerless MMA glove', noun: 'MMA Glove' },
      { v: 'spring', p: { t: 2, s: 1 }, desc: 'punching glove on a coiled spring', noun: 'Spring Glove' },
    ],
    draw(k, p) {
      const s = p.s;
      k.sphere('main', 1, { p: [0, 0.005, -0.1 * s], s: [0.062 * s, 0.058 * s, 0.085 * s] }, 8, 6);
      k.sphere('main', 1, { p: [0.048 * s, 0.012 * s, -0.06 * s], s: [0.026 * s, 0.028 * s, 0.05 * s] }, 6, 4);
      const cr = 0.046 * (p.t === 1 ? 0.85 : 1);
      const cl = p.t === 1 ? 0.06 : 0.1;
      k.zrod('main', -0.04 * s, cl, cr, cr * 0.95, 10);
      k.zrod('rubber', cl - 0.002, cl + 0.001, cr * 0.8, cr * 0.8, 10);
      if (p.t === 1) {
        k.zrod('rubber', 0.0, 0.04, cr * 1.04, cr * 1.04, 10);
        for (let i = 0; i < 4; i++) k.rod('#e0b08a', [-0.024 + i * 0.016, -0.03, -0.07], [-0.024 + i * 0.016, -0.05, -0.1], 0.0065, 0.006, 5);
      } else {
        k.zrod('accent', 0.03, 0.06, cr * 1.04, cr * 1.04, 10);
        for (let i = 0; i < 4; i++) k.box('accent', [0.03, 0.004, 0.004], { p: [0, cr * 0.98, -0.03 + i * 0.016] });
      }
      if (p.t === 2) {
        const pts: Vec3[] = [];
        for (let i = 0; i <= 30; i++) {
          const t = (i / 30) * PI * 2 * 5;
          pts.push([Math.cos(t) * 0.028, Math.sin(t) * 0.028, cl + 0.005 + (i / 30) * 0.24]);
        }
        k.tube('metal', pts, 0.004, 28, 3);
        k.zrod('dark', cl + 0.24, cl + 0.252, 0.036, 0.036, 8);
      }
    },
    anchors(p) {
      const s = p.s;
      const cr = 0.046 * (p.t === 1 ? 0.85 : 1);
      const cl = p.t === 1 ? 0.06 : 0.1;
      return {
        tip: [0, 0.005, -0.185 * s],
        rear: [0, 0, p.t === 2 ? cl + 0.252 : cl + 0.001],
        top: [0, 0.005 + 0.058 * s, -0.1 * s],
        grip: [0, -cr * 0.98, p.t === 1 ? 0.05 : 0.015],
        under: [0, 0.005 - 0.058 * s, -0.1 * s],
        side: [0.062 * s, 0.005, -0.1 * s],
      };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },

  /* ================= DUMBBELL ================= */
  {
    kind: 'dumbbell',
    group: 'sports',
    noun: 'Dumbbell',
    syn: ['dumbbell', 'weight', 'barbell', 'gym', 'free weight', 'iron'],
    tags: ['sports', 'metal', 'heavy', 'rubber'],
    desc: 'heavy gym dumbbell',
    color: '#2d2f36',
    accent: '#9aa1ab',
    variants: [
      { v: 'hex', p: { t: 0, hl: 0.13, R: 0.052 }, desc: 'rubber hex dumbbell' },
      { v: 'chrome', p: { t: 1, hl: 0.1, R: 0.04 }, desc: 'shiny chrome round dumbbell' },
      { v: 'plates', p: { t: 2, hl: 0.15, R: 0.075 }, desc: 'adjustable dumbbell stacked weight plates' },
    ],
    draw(k, p) {
      const h = p.hl / 2;
      const L = bellLen(p);
      k.zrod('metal', -h - 0.005, h + 0.005, 0.016, 0.016, 8);
      for (let i = 0; i < 5; i++) k.zrod('dark', -0.04 + i * 0.02 - 0.002, -0.04 + i * 0.02 + 0.002, 0.0168, 0.0168, 8);
      for (const s of [-1, 1]) {
        const a = s * h;
        const b = s * (h + L);
        if (p.t === 0) {
          k.zrod('main', Math.min(a, b), Math.max(a, b), p.R, p.R, 6);
          k.zrod('accent', Math.min(a, b) + L * 0.4, Math.max(a, b) - L * 0.4, p.R * 1.01, p.R * 1.01, 6);
        } else if (p.t === 1) {
          const z0 = Math.min(a, b);
          const pts: Pt[] =
            s < 0
              ? [
                  [0, z0],
                  [p.R * 0.6, z0],
                  [p.R, z0 + L * 0.35],
                  [p.R * 0.85, z0 + L * 0.85],
                  [p.R * 0.5, z0 + L],
                  [0, z0 + L],
                ]
              : [
                  [0, z0],
                  [p.R * 0.5, z0],
                  [p.R * 0.85, z0 + L * 0.15],
                  [p.R, z0 + L * 0.65],
                  [p.R * 0.6, z0 + L],
                  [0, z0 + L],
                ];
          k.zlathe('accent', pts, 10);
        } else {
          const radii = [p.R * 0.7, p.R * 0.85, p.R];
          for (let j = 0; j < 3; j++) {
            const z1 = s * (h + j * 0.014);
            const z2 = z1 + s * 0.014;
            k.zrod(j === 2 ? 'main' : 'dark', Math.min(z1, z2), Math.max(z1, z2), radii[2 - j] * (j === 2 ? 1 : 1), radii[2 - j], 10);
          }
          const zc1 = s * (h + 0.042);
          const zc2 = s * (h + L);
          k.zrod('accent', Math.min(zc1, zc2), Math.max(zc1, zc2), 0.026, 0.026, 8);
        }
      }
    },
    anchors(p) {
      const h = p.hl / 2;
      const L = bellLen(p);
      const tipR = p.t === 2 ? 0 : 0;
      const zh = -(h + L * 0.5);
      const ru = p.t === 1 ? p.R * 0.95 : p.t === 2 ? p.R * 0.7 : p.R;
      return {
        tip: [tipR, 0, -(h + L)],
        rear: [0, 0, h + L],
        top: [0, 0.016, 0],
        grip: [0, -0.016, 0.02],
        under: [0, -ru, p.t === 2 ? -(h + 0.007) : zh],
        side: [0.016, 0, -0.03],
        mag: [0, -0.016, 0],
      };
    },
    roles: ['mag', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
  },

  /* ================= KETTLEBELL ================= */
  {
    kind: 'kettlebell',
    group: 'sports',
    noun: 'Kettlebell',
    syn: ['kettlebell', 'kettle bell', 'weight', 'gym', 'cast iron', 'gorilla'],
    tags: ['sports', 'metal', 'heavy'],
    desc: 'cast iron kettlebell',
    color: '#2d2f36',
    accent: '#c8202a',
    variants: [
      { v: 'classic', p: { t: 0, R: 0.1 }, desc: 'round cast iron kettlebell' },
      { v: 'competition', p: { t: 1, R: 0.105 }, desc: 'steel competition kettlebell straight sides' },
      { v: 'gorilla', p: { t: 2, R: 0.11 }, desc: 'gorilla face novelty kettlebell', noun: 'Gorilla Kettlebell' },
    ],
    draw(k, p) {
      const R = p.R;
      const zc = kbZc(p);
      if (p.t === 1) {
        k.zlathe(
          'accent',
          [
            [0, -zc - R],
            [R * 0.62, -zc - R],
            [R, -zc - R * 0.5],
            [R, -zc + R * 0.3],
            [R * 0.6, -zc + R * 0.85],
            [0, -zc + R],
          ],
          10,
        );
      } else k.sphere('main', R, { p: [0, 0, -zc] }, 10, 8);
      const hs = p.t === 1 ? 'metal' : 'main';
      k.rod(hs, [-0.06, 0, 0], [0.06, 0, 0], 0.014, 0.014, 6);
      for (const s of [-1, 1])
        k.tube(
          hs,
          [
            [s * 0.06, 0, 0],
            [s * 0.072, 0, -0.03],
            [s * 0.062, 0, -0.065],
            [s * 0.04, 0, -zc + R * 0.72],
          ],
          0.014,
          6,
          5,
        );
      if (p.t === 2) {
        k.box('dark', [R * 1.1, R * 0.18, R * 0.25], { p: [0, R * 0.88, -zc + R * 0.05] });
        k.sphere('#6b6460', 1, { p: [0, R * 0.78, -zc - R * 0.4], s: [R * 0.5, R * 0.3, R * 0.35] }, 8, 4);
        for (const s of [-1, 1]) {
          k.ball('main', R * 0.28, [s * R * 0.95, 0, -zc + R * 0.1], 0);
          k.ball('white', R * 0.08, [s * R * 0.28, R * 0.91, -zc - R * 0.13], 0);
        }
      }
    },
    anchors(p) {
      const R = p.R;
      const zc = kbZc(p);
      return {
        tip: [0, 0, -zc - R],
        rear: [0, 0, 0.014],
        top: [0, R, -zc - (p.t === 2 ? R * 0.2 : 0)],
        grip: [0, -0.014, 0],
        under: [0, -R, -zc],
        side: [R, 0, -zc - R * 0.2],
      };
    },
    roles: ['mag', 'muzzle', 'deco'],
    melee: { swing: 'spin', weight: 'heavy' },
  },
];
