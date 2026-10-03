/** TOY / party objects. See objkit.ts for the canonical frame + roles. */
import * as THREE from 'three';
import type { Kit, Pt, Slot } from '../../lib/kit';
import { heartPts, starPts } from '../../lib/kit';
import type { Vec3 } from '../../types';
import type { Anchors, ObjSpec, P } from './objkit';

const PI = Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const bellR = (r0: number, R: number, flare: number, t: number) => r0 + (R - r0) * Math.pow(t, flare);

/** Flared cone opening toward -Z with a recessed dark inside. Returns the apex z. */
function bell(k: Kit, slot: Slot, y: number, zThroat: number, L: number, r0: number, R: number, flare = 1, seg = 10, inner: Slot = 'dark', n = 3): number {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push([bellR(r0, R, flare, i / n), (i / n) * L]);
  pts.push([R * 0.9, L - 0.004]);
  const d = Math.min(0.03, L * 0.3);
  const xf = { p: [0, y, zThroat] as Vec3, r: [-PI / 2, 0, 0] as Vec3 };
  k.lathe(slot, pts, seg, xf);
  k.lathe(
    inner,
    [
      [R * 0.9, L - 0.004],
      [0.0001, L - d],
    ],
    seg,
    xf,
  );
  return zThroat - L + d;
}
const bellApex = (zThroat: number, L: number) => zThroat - L + Math.min(0.03, L * 0.3);

/** Open tube along Z with a recessed dark mouth at z0 (front) and closed rear at z1. Tip apex at z0 + 0.02. */
function mouthTube(k: Kit, slot: Slot, y: number, z0: number, z1: number, r: number, seg = 10) {
  k.zlathe(
    'dark',
    [
      [0.0001, z0 + 0.02],
      [r * 0.88, z0 + 0.002],
    ],
    seg,
    [0, y, 0],
  );
  k.zlathe(
    slot,
    [
      [r * 0.88, z0 + 0.002],
      [r, z0],
      [r, z1],
      [0.0001, z1],
    ],
    seg,
    [0, y, 0],
  );
}

const UP = new THREE.Vector3(0, 1, 0);
/** Low-poly balloon-animal style sausage from a to b. */
function sausage(k: Kit, slot: Slot, a: Vec3, b: Vec3, r: number) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  dir.normalize();
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  const m = va.add(vb).multiplyScalar(0.5);
  k.sphere(slot, 1, { p: [m.x, m.y, m.z], r: [e.x, e.y, e.z], s: [r, len / 2 + r * 0.5, r] }, 6, 4);
}
function sausageEnd(a: Vec3, b: Vec3, r: number): Vec3 {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [b[0] + (d[0] / l) * r * 0.5, b[1] + (d[1] / l) * r * 0.5, b[2] + (d[2] / l) * r * 0.5];
}

/** Slanted pistol grip below the origin (top at y = yTop). */
function pistolGrip(k: Kit, slot: Slot, yTop: number, th = 0.03) {
  k.extrude(
    slot,
    [
      [-0.02, yTop],
      [0.025, yTop],
      [0.05, -0.09],
      [0.01, -0.095],
    ],
    th,
    'zy',
  );
}

/* ---------------- rubber duck ---------------- */

function duckGeo(p: P) {
  const bs = p.bs;
  const hs = p.hs;
  const hy = 0.0375 * bs + 0.016 * hs;
  const hz = -0.03 * bs;
  const hr = 0.032 * hs;
  const beakA: Vec3 = [0, hy - 0.004 * hs, hz - hr * 0.8];
  const beakB: Vec3 = [0, hy - 0.008 * hs, hz - hr * 1.55];
  return { bs, hs, hy, hz, hr, beakA, beakB };
}

function drawDuck(k: Kit, p: P) {
  const { bs, hs, hy, hz, hr, beakA, beakB } = duckGeo(p);
  k.ball('main', 0.05, [0, 0, 0], 1, [bs, 0.75 * bs, 1.25 * bs]);
  k.ball('main', hr, [0, hy, hz], 1);
  k.rod('accent', beakA, beakB, 0.012 * hs, 0.005 * hs, 6);
  for (const s of [-1, 1]) {
    k.ball('dark', 0.005 * hs, [s * hr * 0.5, hy + hr * 0.25, hz - hr * 0.75], 0);
    k.ball('main', 0.025 * bs, [s * 0.045 * bs, 0.004, 0.008 * bs], 0, [0.4, 0.65, 1.2]);
  }
  k.rod('main', [0, 0.02 * bs, 0.05 * bs], [0, 0.042 * bs, 0.075 * bs], 0.018 * bs, 0.003, 6);
  if (p.sty === 1) {
    const ht = hy + hr * 0.82;
    k.rod('dark', [0, ht, hz], [0, ht + 0.005, hz], hr * 1.15, hr * 1.15, 8);
    k.rod('dark', [0, ht + 0.005, hz], [0, ht + 0.026, hz], hr * 0.72, hr * 0.5, 8);
    k.box('white', [0.008, 0.008, 0.002], { p: [0, ht + 0.014, hz - hr * 0.62] });
    k.box('dark', [0.002, 0.012, 0.012], { p: [hr * 0.62, hy + hr * 0.25, hz - hr * 0.6], r: [0, -0.6, 0] });
  } else if (p.sty === 2) {
    k.rod('brass', [0, hy + hr * 0.8, hz - hr * 0.3], [0, hy + hr * 1.9, hz - hr * 0.75], hr * 0.28, 0.0008, 6);
    k.ball('accent', hr * 0.3, [0, hy + hr * 0.75, hz + hr * 0.5], 0, [0.7, 1, 1.4]);
  }
}

function duckAnchors(p: P): Anchors {
  const { bs, hy, hz, hr, beakB } = duckGeo(p);
  return {
    tip: beakB,
    rear: [0, 0.042 * bs, 0.075 * bs],
    top: [0, hy + hr, hz],
    grip: [0, -0.0375 * bs, 0.01],
    under: [0, -0.035 * bs, -0.025 * bs],
    side: [0.05 * bs, 0, 0],
  };
}

/* ---------------- water gun ---------------- */

const WG_Y = 0.04;
function drawWaterGun(k: Kit, p: P) {
  const yb = WG_Y;
  if (p.sty === 1) {
    k.extrude(
      'main',
      [
        [0.08, 0.07],
        [0.03, 0.085],
        [-0.1, 0.08],
        [-0.12, 0.06],
        [-0.12, 0.03],
        [-0.02, 0.025],
        [0.08, 0.025],
      ],
      0.035,
      'zy',
    );
    k.ball('accent', 0.035, [0, 0.085, 0.035], 1, [0.8, 0.8, 1.1]);
    k.zrod('accent', -0.15, -0.12, 0.006, 0.01, 6, 0, 0.055);
    pistolGrip(k, 'main', 0.03);
    k.box('accent', [0.008, 0.025, 0.012], { p: [0, 0.005, -0.02] });
    return;
  }
  const zf = p.sty === 2 ? -0.42 : -0.3;
  k.zrod('main', zf, 0.13, 0.022, 0.022, 8, 0, yb);
  k.zrod('accent', zf - 0.04, zf, 0.008, 0.013, 6, 0, yb);
  k.zrod('dark', zf + 0.03, zf + 0.13, 0.028, 0.028, 8, 0, yb);
  pistolGrip(k, 'main', yb);
  k.box('accent', [0.008, 0.025, 0.012], { p: [0, 0.005, -0.02] });
  k.box('main', [0.03, 0.06, 0.07], { p: [0, yb - 0.01, 0.155] });
  if (p.sty === 2) {
    k.zlathe(
      'accent',
      [
        [0.0001, 0.05],
        [0.035, 0.06],
        [0.05, 0.1],
        [0.05, 0.25],
        [0.035, 0.29],
        [0.0001, 0.3],
      ],
      8,
      [0, yb + 0.07, 0],
    );
    k.zrod('accent', zf + 0.02, -0.02, 0.008, 0.008, 6, 0, yb + 0.03);
    k.ball('white', 0.014, [0, yb + 0.035, -0.08], 0);
  } else {
    k.zlathe(
      'accent',
      [
        [0.0001, -0.14],
        [0.025, -0.135],
        [0.034, -0.11],
        [0.034, 0.1],
        [0.025, 0.125],
        [0.0001, 0.13],
      ],
      8,
      [0, yb + 0.05, 0],
    );
    k.rod('dark', [0, yb + 0.08, 0.06], [0, yb + 0.095, 0.06], 0.012, 0.012, 6);
  }
}

function waterGunAnchors(p: P): Anchors {
  const yb = WG_Y;
  const grip: Vec3 = [0, -0.0925, 0.03];
  if (p.sty === 1)
    return {
      tip: [0, 0.055, -0.15],
      rear: [0, 0.05, 0.08],
      top: [0, 0.0827, -0.05],
      grip,
      under: [0, 0.027, -0.08],
      side: [0.0175, 0.05, -0.06],
      mag: [0, 0.026, -0.06],
    };
  const zf = p.sty === 2 ? -0.42 : -0.3;
  return {
    tip: [0, yb, zf - 0.04],
    rear: p.sty === 2 ? [0, yb + 0.07, 0.3] : [0, yb - 0.01, 0.19],
    top: p.sty === 2 ? [0, yb + 0.12, 0.17] : [0, yb + 0.084, 0],
    grip,
    under: [0, yb - 0.028, zf + 0.08],
    side: [0.022, yb, -0.08],
    mag: [0, yb - 0.022, -0.08],
  };
}

/* ---------------- foam dart blaster ---------------- */

function drawBlaster(k: Kit, p: P) {
  const th = 0.045;
  if (p.sty === 1) {
    k.extrude(
      'main',
      [
        [0.18, 0.02],
        [0.18, 0.07],
        [0.12, 0.09],
        [-0.28, 0.09],
        [-0.3, 0.07],
        [-0.3, 0.02],
      ],
      th,
      'zy',
    );
    k.extrude(
      'dark',
      [
        [0.18, 0.07],
        [0.33, 0.05],
        [0.35, -0.06],
        [0.3, -0.06],
        [0.18, 0.0],
      ],
      th * 0.8,
      'zy',
    );
    k.box('accent', [0.03, 0.09, 0.045], { p: [0, -0.02, -0.07], r: [-0.2, 0, 0] });
    k.zrod('accent', -0.27, -0.16, 0.02, 0.02, 8, 0, 0.02);
    k.zrod('accent', -0.33, -0.3, 0.014, 0.014, 8, 0, 0.06);
    k.box('dark', [0.02, 0.012, 0.25], { p: [0, 0.096, -0.07] });
  } else {
    const zr = p.sty === 2 ? 0.1 : 0.07;
    const zf = p.sty === 2 ? -0.22 : -0.15;
    k.extrude(
      'main',
      [
        [zr, 0.02],
        [zr, 0.075],
        [zr - 0.03, 0.095],
        [zf + 0.03, 0.095],
        [zf, 0.075],
        [zf, 0.02],
      ],
      th,
      'zy',
    );
    k.zrod('accent', zf - 0.03, zf, 0.014, 0.014, 8, 0, 0.06);
    k.box('accent', [0.05, 0.015, 0.05], { p: [0, 0.1, zr - 0.06] });
    if (p.sty === 2) {
      k.rod('accent', [-0.025, -0.035, -0.1], [0.025, -0.035, -0.1], 0.055, 0.055, 10);
      k.box('dark', [0.016, 0.03, 0.12], { p: [0, 0.115, -0.06] });
    } else {
      k.zrod('accent', -0.1, -0.03, 0.035, 0.035, 6, 0, 0.055);
    }
  }
  pistolGrip(k, 'dark', 0.025, 0.035);
  k.box('accent', [0.008, 0.025, 0.012], { p: [0, 0.0, -0.02] });
}

function blasterAnchors(p: P): Anchors {
  const grip: Vec3 = [0, -0.0925, 0.03];
  if (p.sty === 1)
    return {
      tip: [0, 0.06, -0.33],
      rear: [0, 0, 0.341],
      top: [0, 0.09, -0.2],
      grip,
      under: [0, 0, -0.22],
      side: [0.0225, 0.05, -0.12],
    };
  const zr = p.sty === 2 ? 0.1 : 0.07;
  const zf = p.sty === 2 ? -0.22 : -0.15;
  return {
    tip: [0, 0.06, zf - 0.03],
    rear: [0, 0.05, zr],
    top: [0, 0.095, -0.05],
    grip,
    under: p.sty === 2 ? [0, -0.09, -0.1] : [0, 0.02, -0.12],
    side: [0.0225, 0.05, -0.01],
    mag: p.sty === 2 ? [0, -0.09, -0.1] : [0, 0.02, -0.06],
  };
}

/* ---------------- balloon ---------------- */

const DOG: [Vec3, Vec3, number][] = [
  [[0, 0, 0.065], [0, 0, -0.065], 0.024],
  [[0, 0.01, -0.07], [0, 0.09, -0.095], 0.022],
  [[0, 0.095, -0.1], [0, 0.085, -0.175], 0.02],
  [[0.012, 0.1, -0.09], [0.035, 0.15, -0.07], 0.017],
  [[-0.012, 0.1, -0.09], [-0.035, 0.15, -0.07], 0.017],
  [[0.02, -0.01, -0.065], [0.03, -0.1, -0.07], 0.02],
  [[-0.02, -0.01, -0.065], [-0.03, -0.1, -0.07], 0.02],
  [[0.02, -0.01, 0.065], [0.03, -0.1, 0.07], 0.02],
  [[-0.02, -0.01, 0.065], [-0.03, -0.1, 0.07], 0.02],
  [[0, 0.01, 0.07], [0, 0.08, 0.11], 0.016],
];

function balloonString(k: Kit) {
  k.ball('main', 0.008, [0, 0, -0.022], 0);
  k.tube(
    'white',
    [
      [0, 0, -0.02],
      [0, -0.008, 0.02],
      [0, 0.004, 0.06],
      [0, -0.006, 0.1],
    ],
    0.0015,
    8,
    3,
  );
}

function drawBalloon(k: Kit, p: P) {
  if (p.sty === 2) {
    for (const [a, b, r] of DOG) sausage(k, 'main', a, b, r);
    k.ball('dark', 0.006, [0, 0.088, -0.188], 0);
    return;
  }
  if (p.sty === 1) {
    const s = p.s;
    const off = -0.03 - s;
    k.extrude(
      'main',
      heartPts(s).map(([u, v]) => [off - v, u] as Pt),
      0.07,
      'zy',
      undefined,
      0.012,
    );
    k.ball('white', s * 0.12, [0.047, s * 0.45, off - s * 0.35], 0, [0.4, 1, 1.4]);
    balloonString(k);
    return;
  }
  const R = p.R;
  const H = p.H;
  const zf = -0.03 - H;
  k.zlathe(
    'main',
    [
      [0.0001, zf],
      [R * 0.6, zf + H * 0.08],
      [R * 0.95, zf + H * 0.25],
      [R, zf + H * 0.45],
      [R * 0.8, zf + H * 0.75],
      [R * 0.35, zf + H * 0.95],
      [0.008, zf + H],
    ],
    10,
  );
  k.ball('white', R * 0.16, [R * 0.45, R * 0.72, zf + H * 0.35], 0, [0.5, 1, 1.5]);
  balloonString(k);
}

function balloonAnchors(p: P): Anchors {
  const rear: Vec3 = [0, -0.006, 0.1];
  const grip: Vec3 = [0, -0.004, 0];
  if (p.sty === 2) {
    const [a, b, r] = DOG[2];
    const [ta, tb, tr] = DOG[9];
    return {
      tip: sausageEnd(a, b, r),
      rear: sausageEnd(ta, tb, tr),
      top: [0, 0.024, 0],
      grip: [0, -0.024, 0.02],
      under: [0, -0.024, -0.04],
      side: [0.024, 0, 0],
    };
  }
  if (p.sty === 1) {
    const s = p.s;
    const off = -0.03 - s;
    return {
      tip: [0, 0, off - (5 / 17) * s],
      rear,
      top: [0, (16 / 17) * s, off - (4 / 17) * s],
      grip,
      under: [0, (-16 / 17) * s, off - (4 / 17) * s],
      side: [0.047, 0, off - 0.2 * s],
    };
  }
  const zf = -0.03 - p.H;
  const zm = zf + p.H * 0.45;
  return {
    tip: [0, 0, zf],
    rear,
    top: [0, p.R, zm],
    grip,
    under: [0, -p.R, zm],
    side: [p.R, 0, zm],
  };
}

/* ---------------- confetti cannon / popper ---------------- */

const CONF_SLOTS: Slot[] = ['#ffd23f', '#3bceac', 'accent'];
function confettiBits(k: Kit, y: number, z0: number, r: number) {
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4;
    const rr = r * (0.25 + 0.1 * (i % 4));
    k.box(CONF_SLOTS[i % 3], [r * 0.3, r * 0.3, 0.003], {
      p: [Math.cos(a) * rr, y + Math.sin(a) * rr, z0 - 0.006 - (i % 3) * 0.008],
      r: [a, a * 0.7, 0.4],
    });
  }
}

function drawConfetti(k: Kit, p: P) {
  if (p.sty === 0) {
    const apexZ = bell(k, 'main', 0, 0.03, 0.13, 0.012, 0.032, 1, 10, 'dark', 2);
    for (const z of [-0.02, -0.06]) k.torus('accent', bellR(0.012, 0.032, 1, (0.03 - z) / 0.13) + 0.001, 0.003, { p: [0, 0, z] }, 3, 10);
    confettiBits(k, 0, -0.1, 0.032);
    k.tube(
      'white',
      [
        [0, 0, 0.03],
        [0, -0.006, 0.05],
        [0, -0.012, 0.07],
      ],
      0.0015,
      4,
      3,
    );
    k.torus('accent', 0.01, 0.0025, { p: [0, -0.012, 0.08], r: [0, PI / 2, 0] }, 3, 8);
    void apexZ;
    return;
  }
  const yc = p.sty === 2 ? 0.075 : 0;
  const r = p.r;
  const z0 = -p.L;
  const z1 = p.z1;
  mouthTube(k, 'main', yc, z0, z1, r);
  const n = p.sty === 2 ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const z = lerp(z0 + 0.05, z1 - 0.05, (i + 0.5) / n);
    k.torus('accent', r, 0.005, { p: [0, yc, z], r: [0.3, 0, 0] }, 3, 10);
  }
  confettiBits(k, yc, z0, r);
  if (p.sty === 2) {
    k.box('dark', [0.03, 0.09, 0.04], { p: [0, -0.02, 0] });
    k.box('dark', [0.03, 0.07, 0.035], { p: [0, 0.0, -0.22] });
    k.box('accent', [0.012, 0.03, 0.012], { p: [0, yc + r + 0.012, z0 + 0.05] });
    k.zlathe(
      'accent',
      [
        [r * 1.02, z1 - 0.005],
        [r * 1.25, z1 + 0.03],
        [0.0001, z1 + 0.032],
      ],
      10,
      [0, yc, 0],
    );
  } else {
    k.zlathe(
      'accent',
      [
        [r * 1.02, z1 - 0.005],
        [r * 1.08, z1 + 0.02],
        [r * 0.9, z1 + 0.07],
        [0.0001, z1 + 0.075],
      ],
      10,
      [0, yc, 0],
    );
  }
}

function confettiAnchors(p: P): Anchors {
  if (p.sty === 0) {
    const r = (z: number) => bellR(0.012, 0.032, 1, (0.03 - z) / 0.13);
    return {
      tip: [0, 0, bellApex(0.03, 0.13)],
      rear: [0, -0.012, 0.09],
      top: [0, r(0), 0],
      grip: [0, -r(0.005), 0.005],
      under: [0, -r(-0.061), -0.061],
      side: [r(-0.035), 0, -0.035],
    };
  }
  const yc = p.sty === 2 ? 0.075 : 0;
  const r = p.r;
  const z0 = -p.L;
  return {
    tip: [0, yc, z0 + 0.02],
    rear: [0, yc, p.z1 + (p.sty === 2 ? 0.032 : 0.075)],
    top: [0, yc + r, z0 * 0.15],
    grip: p.sty === 2 ? [0, -0.065, 0] : [0, -r, 0.03],
    under: [0, yc - r, z0 * 0.5],
    side: [r, yc, z0 * 0.25],
    mag: [0, yc - r, z0 * 0.3],
  };
}

/* ---------------- teddy bear ---------------- */

function bearGeo(p: P) {
  const hr = 0.052 * p.hs;
  const hy = 0.072 + hr * 0.85;
  const hz = -0.005;
  return { hr, hy, hz };
}

function drawBear(k: Kit, p: P) {
  const { hr, hy, hz } = bearGeo(p);
  k.ball('main', 0.07, [0, 0, 0], 1, [1, 1.1, 0.9]);
  k.ball('accent', 0.045, [0, -0.005, -0.045], 0, [1, 1.1, 0.4]);
  k.ball('main', hr, [0, hy, hz], 1);
  for (const s of [-1, 1]) {
    k.ball('main', hr * 0.38, [s * hr * 0.75, hy + hr * 0.72, hz], 0, [1, 1, 0.6]);
    k.ball('dark', hr * 0.1, [s * hr * 0.36, hy + hr * 0.22, hz - hr * 0.88], 0);
    k.ball('main', 0.026, [s * 0.068, 0.02, -0.015], 0, [1, 1.9, 1]);
    if (p.sit) k.ball('main', 0.03, [s * 0.04, -0.062, -0.045], 0, [1, 1, 1.7]);
    else k.ball('main', 0.03, [s * 0.035, -0.085, 0], 0, [1, 1.5, 1]);
  }
  k.ball('accent', hr * 0.42, [0, hy - hr * 0.25, hz - hr * 0.82], 0, [1, 0.8, 0.8]);
  k.ball('dark', hr * 0.14, [0, hy - hr * 0.12, hz - hr * 1.13], 0);
  if (p.bow)
    for (const s of [-1, 1]) k.rod('#c0392b', [0, 0.075, -0.035], [s * 0.032, 0.075, -0.03], 0.004, 0.016, 4);
}

function bearAnchors(p: P): Anchors {
  const { hr, hy, hz } = bearGeo(p);
  return {
    tip: [0, hy - hr * 0.12, hz - hr * 1.27],
    rear: [0, 0, 0.063],
    top: [0, hy + hr, hz],
    grip: [0, -0.077, 0],
    under: [0, -0.068, -0.03],
    side: [0.07, 0, 0],
  };
}

/* ---------------- yo-yo ---------------- */

const YOYO: Record<number, Pt[]> = {
  0: [
    [0.0001, -0.02],
    [0.022, -0.02],
    [0.03, -0.013],
    [0.029, -0.005],
    [0.006, -0.003],
    [0.006, 0.003],
    [0.029, 0.005],
    [0.03, 0.013],
    [0.022, 0.02],
    [0.0001, 0.02],
  ],
  1: [
    [0.0001, -0.022],
    [0.034, -0.022],
    [0.033, -0.017],
    [0.012, -0.004],
    [0.005, -0.002],
    [0.005, 0.002],
    [0.012, 0.004],
    [0.033, 0.017],
    [0.034, 0.022],
    [0.0001, 0.022],
  ],
};

function drawYoyo(k: Kit, p: P) {
  const prof = YOYO[p.sty === 1 ? 1 : 0];
  const zc = -p.ls;
  const hw = prof[prof.length - 1][1];
  const Rm = Math.max(...prof.map((q) => q[0]));
  k.lathe('main', prof, 12, { p: [0, 0, zc], r: [0, 0, -PI / 2] });
  for (const s of [-1, 1]) {
    k.rod('accent', [s * (hw - 0.001), 0, zc], [s * (hw + 0.0015), 0, zc], Rm * 0.55, Rm * 0.55, 8);
    if (p.sty === 2) k.torus('glow', Rm * 0.8, 0.003, { p: [s * (hw - 0.004), 0, zc], r: [0, PI / 2, 0] }, 3, 10);
  }
  k.rod('white', [0, 0, zc + 0.006], [0, 0, 0.015], 0.0012, 0.0012, 3);
  k.torus('white', 0.01, 0.002, { p: [0, 0, 0.025], r: [0, PI / 2, 0] }, 3, 8);
}

function yoyoAnchors(p: P): Anchors {
  const prof = YOYO[p.sty === 1 ? 1 : 0];
  const zc = -p.ls;
  const hw = prof[prof.length - 1][1];
  const Rm = Math.max(...prof.map((q) => q[0]));
  return {
    tip: [0, 0, zc - Rm],
    rear: [0, 0, 0.037],
    top: [0, Rm, zc],
    grip: [0, -0.0012, 0],
    under: [0, -Rm, zc],
    side: [hw + 0.0015, 0, zc],
  };
}

/* ---------------- toy robot ---------------- */

function robotTop(p: P) {
  return p.sty === 1 ? 0.115 : 0.103;
}

function drawRobot(k: Kit, p: P) {
  k.box('main', [0.08, 0.1, 0.06], {});
  k.box('accent', [0.05, 0.04, 0.006], { p: [0, 0.01, -0.033] });
  for (const s of [-1, 1]) k.rod('glow', [s * 0.012, 0.012, -0.035], [s * 0.012, 0.012, -0.04], 0.006, 0.006, 6);
  if (p.sty === 1) {
    k.rod('main', [0, 0.05, 0], [0, 0.085, 0], 0.03, 0.03, 10);
    k.sphere('main', 0.03, { p: [0, 0.085, 0] }, 10, 3, PI / 2);
    k.box('glow', [0.044, 0.012, 0.006], { p: [0, 0.07, -0.029] });
  } else {
    k.box('main', [0.06, 0.05, 0.05], { p: [0, 0.078, 0] });
    for (const s of [-1, 1]) k.rod('glow', [s * 0.014, 0.084, -0.024], [s * 0.014, 0.084, -0.03], 0.007, 0.007, 6);
    k.box('dark', [0.03, 0.006, 0.004], { p: [0, 0.064, -0.026] });
  }
  const top = robotTop(p);
  k.rod('metal', [0, top - 0.002, 0], [0, top + 0.03, 0], 0.002, 0.002, 4);
  k.ball('accent', 0.007, [0, top + 0.035, 0], 0);
  for (const s of [-1, 1]) {
    k.rod('metal', [s * 0.045, 0.03, 0], [s * 0.05, 0.03, -0.06], 0.009, 0.008, 6);
    k.box('dark', [0.012, 0.02, 0.012], { p: [s * 0.05, 0.03, -0.066] });
  }
  if (p.sty === 2) {
    for (const s of [-1, 1]) {
      k.box('dark', [0.025, 0.035, 0.09], { p: [s * 0.03, -0.07, 0] });
      for (const z of [-0.03, 0.03]) k.rod('metal', [s * 0.043, -0.07, z], [s * 0.046, -0.07, z], 0.016, 0.016, 8);
    }
  } else {
    for (const s of [-1, 1]) {
      k.box('dark', [0.025, 0.05, 0.03], { p: [s * 0.022, -0.075, 0] });
      k.box('dark', [0.03, 0.012, 0.045], { p: [s * 0.022, -0.1, -0.007] });
    }
  }
  k.zrod('brass', 0.03, 0.045, 0.004, 0.004, 6);
  k.box('brass', [0.03, 0.012, 0.003], { p: [0, 0, 0.048] });
}

/* ---------------- gift box ---------------- */

function drawGift(k: Kit, p: P) {
  const { w, h, d } = p;
  k.box('main', [w, h, d], {});
  k.box('main', [w + 0.008, h * 0.2, d + 0.008], { p: [0, h / 2 - h * 0.1 + 0.002, 0] });
  k.box('accent', [w + 0.012, h + 0.01, 0.018], {});
  k.box('accent', [0.018, h + 0.01, d + 0.012], {});
  const ty = h / 2 + 0.005;
  for (const s of [-1, 1]) {
    k.torus('accent', 0.02, 0.006, { p: [s * 0.017, ty + 0.014, 0], r: [0, 0, s * 0.7] }, 3, 8);
    k.box('accent', [0.012, 0.003, 0.035], { p: [s * 0.012, ty, s * 0.02], r: [0, s * 0.5, 0] });
  }
  k.ball('accent', 0.01, [0, ty + 0.004, 0], 0);
  if (p.tag) k.box('white', [0.003, 0.03, 0.045], { p: [w / 2 + 0.008, h * 0.15, d * 0.25], r: [0.3, 0, 0] });
}

/* ---------------- birthday cake ---------------- */

function cakeTiers(p: P): { R: number; h: number; y: number }[] {
  const out: { R: number; h: number; y: number }[] = [];
  let y = 0.008;
  for (let i = 0; i < p.tiers; i++) {
    const R = p.R * (i === 0 ? 1 : 0.62);
    const h = p.h * (i === 0 ? 1 : 0.9);
    out.push({ R, h, y });
    y += h + 0.01;
  }
  return out;
}

function candle(k: Kit, x: number, y: number, z: number) {
  k.rod('#8fd3f4', [x, y, z], [x, y + 0.05, z], 0.004, 0.004, 5);
  k.rod('#ffb02e', [x, y + 0.051, z], [x, y + 0.07, z], 0.0055, 0.0001, 4);
}

function sliceOutline(): Pt[] {
  const pts: Pt[] = [[0, -0.12]];
  for (let i = 0; i <= 4; i++) {
    const a = 0.35 - i * 0.175;
    pts.push([Math.sin(a) * 0.15, -0.12 + Math.cos(a) * 0.15]);
  }
  return pts;
}

function drawCake(k: Kit, p: P) {
  if (p.slice) {
    const h = p.h;
    const o = sliceOutline();
    k.extrude('main', o, h, 'xz', { p: [0, h / 2, 0] });
    k.extrude('#c0392b', o, 0.008, 'xz', { p: [0, h / 2, 0], s: [1.01, 1, 1.01] });
    k.extrude('accent', o, 0.012, 'xz', { p: [0, h + 0.006, 0] });
    k.ball('#d62839', 0.014, [0, h + 0.022, 0.0], 0);
    candle(k, 0, h + 0.012, -0.045);
    return;
  }
  const tiers = cakeTiers(p);
  k.rod('white', [0, 0, 0], [0, 0.008, 0], p.R + 0.025, p.R + 0.025, 12);
  tiers.forEach(({ R, h, y }, i) => {
    k.rod('main', [0, y, 0], [0, y + h, 0], R, R, 12);
    k.rod('accent', [0, y + h, 0], [0, y + h + 0.01, 0], R + 0.004, R + 0.004, 12);
    if (i === 0)
      for (let j = 0; j < 6; j++) {
        const a = ((j + 0.5) / 6) * 2 * PI;
        k.box('accent', [0.014, 0.02, 0.006], { p: [Math.sin(a) * (R + 0.002), y + h - 0.006, Math.cos(a) * (R + 0.002)], r: [0, a, 0] });
      }
  });
  const top = tiers[tiers.length - 1];
  const ty = top.y + top.h + 0.01;
  for (let i = 0; i < p.nc; i++) {
    const a = (i / p.nc) * 2 * PI + 0.3;
    candle(k, Math.sin(a) * top.R * 0.6, ty, Math.cos(a) * top.R * 0.6);
  }
}

function cakeAnchors(p: P): Anchors {
  if (p.slice) {
    const h = p.h;
    return {
      tip: [0, h / 2, -0.12],
      rear: [0, h / 2, 0.03],
      top: [0, h + 0.012, -0.075],
      grip: [0, 0, 0],
      under: [0, 0, -0.05],
      side: [0.0327, h / 2, -0.03],
    };
  }
  const tiers = cakeTiers(p);
  const b = tiers[0];
  const top = tiers[tiers.length - 1];
  return {
    tip: [0, b.y + b.h / 2, -b.R],
    rear: [0, b.y + b.h / 2, b.R],
    top: [0, top.y + top.h + 0.01, 0],
    grip: [0, 0, 0],
    under: [0, 0, -b.R * 0.6],
    side: [b.R, b.y + b.h / 2, 0],
  };
}

/* ---------------- party horn ---------------- */

function curlyPts(L: number): Vec3[] {
  const out: Vec3[] = [[0, 0, -L + 0.01]];
  const cy = 0.05;
  for (let i = 0; i <= 16; i++) {
    const th = -PI / 2 + i * 0.75;
    const rad = 0.05 * (1 - i / 22);
    out.push([0, cy + rad * Math.sin(th), -L - rad * Math.cos(th)]);
  }
  return out;
}

function drawHorn(k: Kit, p: P) {
  if (p.sty === 1) {
    k.zrod('white', 0, 0.04, 0.005, 0.006, 6);
    bell(k, 'main', 0, 0.0, 0.3, 0.006, 0.04, 1.6, 10, 'dark', 4);
    k.torus('accent', 0.04, 0.006, { p: [0, 0, -0.297] }, 3, 12);
    for (const t of [0.33, 0.66]) k.torus('accent', bellR(0.006, 0.04, 1.6, t) + 0.001, 0.003, { p: [0, 0, -0.3 * t], r: [0.25, 0, 0] }, 3, 10);
    return;
  }
  const L = p.L;
  k.zrod('white', 0, 0.05, 0.006, 0.007, 6);
  k.zrod('accent', -0.012, 0.004, 0.012, 0.009, 6);
  k.extrude(
    'main',
    [
      [0, -0.008],
      [0, 0.008],
      [-L, 0.012],
      [-L, -0.012],
    ],
    0.006,
    'zy',
  );
  for (let i = 1; i <= 3; i++) k.box('accent', [0.0065, 0.022, 0.012], { p: [0, 0, (-L * i) / 4] });
  if (p.sty === 2) k.tube('main', curlyPts(L), 0.007, 24, 4);
  else
    k.tube(
      'main',
      [
        [0, 0, -L + 0.005],
        [0, 0, -L - 0.02],
        [0, 0.02, -L - 0.035],
        [0, 0.04, -L - 0.025],
        [0, 0.045, -L - 0.005],
        [0, 0.032, -L + 0.004],
        [0, 0.022, -L - 0.008],
      ],
      0.007,
      14,
      4,
    );
}

function hornAnchors(p: P): Anchors {
  if (p.sty === 1) {
    const r = (t: number) => bellR(0.006, 0.04, 1.6, t);
    return {
      tip: [0, 0, bellApex(0, 0.3)],
      rear: [0, 0, 0.04],
      top: [0, r(0.4), -0.12],
      grip: [0, -0.0055, 0.02],
      under: [0, -r(0.7), -0.21],
      side: [r(0.5), 0, -0.15],
    };
  }
  const L = p.L;
  const tip: Vec3 = p.sty === 2 ? (([x, y, z]) => [x, y, z - 0.007] as Vec3)(curlyPts(L)[3]) : [0, 0.02, -L - 0.042];
  return {
    tip,
    rear: [0, 0, 0.05],
    top: [0, 0.0096, -0.4 * L],
    grip: [0, -0.006, 0.03],
    under: [0, -0.0104, -0.6 * L],
    side: [0.003, 0, -0.4 * L],
  };
}

/* ---------------- magic wand ---------------- */

function drawWand(k: Kit, p: P) {
  if (p.sty === 0) {
    k.zrod('main', -0.28, 0.08, 0.0075, 0.0075, 8);
    k.zrod('white', -0.32, -0.28, 0.0078, 0.0078, 8);
    k.zrod('white', 0.08, 0.12, 0.0078, 0.0078, 8);
    return;
  }
  if (p.sty === 1) {
    k.zrod('main', -0.27, 0.1, 0.005, 0.006, 6);
    const zc = -0.315;
    k.extrude(
      'glow',
      starPts(0.05, 0.022, 5, PI).map(([u, v]) => [zc + u, v] as Pt),
      0.012,
      'zy',
      undefined,
      0.003,
    );
    for (const s of [-1, 1])
      k.tube(
        '#ff7eb6',
        [
          [0, -0.005, -0.27],
          [s * 0.01, -0.035, -0.23],
          [s * 0.006, -0.055, -0.18],
        ],
        0.003,
        6,
        3,
      );
    return;
  }
  k.zlathe(
    'wood',
    [
      [0.0001, -0.25],
      [0.009, -0.25],
      [0.007, -0.2],
      [0.009, -0.12],
      [0.007, -0.02],
      [0.01, 0.08],
      [0.012, 0.11],
      [0.0001, 0.12],
    ],
    6,
  );
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 2 * PI;
    k.rod('brass', [0, 0, -0.248], [Math.cos(a) * 0.022, Math.sin(a) * 0.022, -0.285], 0.0025, 0.0018, 4);
  }
  k.ball('glow', 0.028, [0, 0, -0.29], 0, [1, 1, 1.6]);
}

function wandAnchors(p: P): Anchors {
  if (p.sty === 0)
    return {
      tip: [0, 0, -0.32],
      rear: [0, 0, 0.12],
      top: [0, 0.0075, -0.1],
      grip: [0, -0.0075, 0.04],
      under: [0, -0.0075, -0.16],
      side: [0.0075, 0, -0.1],
    };
  if (p.sty === 1)
    return {
      tip: [0, 0, -0.365],
      rear: [0, 0, 0.1],
      top: [0, 0.0055, -0.05],
      grip: [0, -0.006, 0.03],
      under: [0, -0.0053, -0.15],
      side: [0.0055, 0, -0.1],
    };
  return {
    tip: [0, 0, -0.33],
    rear: [0, 0, 0.12],
    top: [0, 0.008, -0.08],
    grip: [0, -0.008, 0.03],
    under: [0, -0.008, -0.16],
    side: [0.008, 0, -0.08],
  };
}

/* ---------------- pool noodle ---------------- */

const NOODLE_RO = 0.032;
const NOODLE_RI = 0.011;
const NOODLE_CURVE: Vec3[] = [
  [0, 0, 0.32],
  [0, 0, 0.15],
  [0, 0, 0],
  [0, 0.04, -0.3],
  [0, 0.12, -0.6],
  [0, 0.24, -0.85],
  [0, 0.288, -0.95],
];

function drawNoodle(k: Kit, p: P) {
  const ro = NOODLE_RO;
  const ri = NOODLE_RI;
  if (p.sty === 1) {
    const c = NOODLE_CURVE;
    k.tube('main', c, ro, 12, 8);
    const ends: [Vec3, Vec3][] = [
      [c[c.length - 1], c[c.length - 2]],
      [c[0], c[1]],
    ];
    for (const [e, n] of ends) {
      const d = [n[0] - e[0], n[1] - e[1], n[2] - e[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      k.rod('dark', e, [e[0] + (d[0] / l) * 0.004, e[1] + (d[1] / l) * 0.004, e[2] + (d[2] / l) * 0.004], ro * 0.95, ro * 0.95, 8);
    }
    return;
  }
  const z0 = -p.L * 0.77;
  const z1 = p.L * 0.23;
  if (p.sty === 2) {
    const outer: Pt[] = [];
    const n = 13;
    for (let i = 0; i <= n * 2; i++) outer.push([i % 2 ? ro * 0.84 : ro, lerp(z0, z1, i / (n * 2))]);
    k.zlathe('main', [[ri, z0], ...outer, [ri, z1], [ri, z0]], 6);
    return;
  }
  k.zlathe(
    'main',
    [
      [ri, z0],
      [ro, z0],
      [ro, z1],
      [ri, z1],
      [ri, z0],
    ],
    8,
  );
}

function noodleAnchors(p: P): Anchors {
  const ro = NOODLE_RO;
  if (p.sty === 1) {
    const c = NOODLE_CURVE;
    return {
      tip: c[c.length - 1],
      rear: c[0],
      top: [0, 0.04 + ro, -0.3],
      grip: [0, -ro, 0.05],
      under: [0, 0.12 - ro, -0.6],
      side: [ro, 0.04, -0.3],
    };
  }
  const z0 = -p.L * 0.77;
  const z1 = p.L * 0.23;
  return {
    tip: [0, 0, z0],
    rear: [0, 0, z1],
    top: [0, ro, -0.3],
    grip: [0, -ro, 0.05],
    under: [0, -ro, z0 * 0.5],
    side: [ro, 0, -0.3],
  };
}

/* ---------------- specs ---------------- */

export const TOY: ObjSpec[] = [
  {
    kind: 'rubber-duck',
    group: 'toy',
    noun: 'Rubber Duck',
    syn: ['rubber duck', 'duck', 'ducky', 'bath toy', 'squeaky', 'quack'],
    tags: ['toy', 'rubber', 'cute', 'silly'],
    desc: 'squeaky yellow rubber duck',
    color: '#ffd23f',
    accent: '#ff8c1a',
    variants: [
      { v: 'classic', p: { bs: 1, hs: 1, sty: 0 } },
      { v: 'pirate', p: { bs: 1, hs: 1.05, sty: 1 }, desc: 'pirate rubber duck with hat', noun: 'Pirate Duck' },
      { v: 'unicorn', p: { bs: 1, hs: 1, sty: 2 }, desc: 'rubber duck with golden unicorn horn' },
      { v: 'chubby', p: { bs: 1.3, hs: 0.85, sty: 0 }, desc: 'extra chubby round rubber duck' },
    ],
    draw: drawDuck,
    anchors: duckAnchors,
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'spin', weight: 'light' },
    guns: ['grenade_launcher', 'bubble_gun'],
    fireMode: 'arc',
    ammo: 'rubber ducks',
  },
  {
    kind: 'water-gun',
    group: 'toy',
    noun: 'Water Gun',
    syn: ['water gun', 'super soaker', 'squirt gun', 'water pistol', 'soaker', 'splash'],
    tags: ['toy', 'plastic', 'silly'],
    desc: 'pump action water blaster',
    color: '#2e86de',
    accent: '#ff9f1a',
    variants: [
      { v: 'soaker', p: { sty: 0 }, desc: 'pump soaker with top water tank', noun: 'Super Soaker' },
      { v: 'pistol', p: { sty: 1 }, desc: 'small squirt water pistol', noun: 'Water Pistol' },
      { v: 'tank', p: { sty: 2 }, desc: 'long soaker with big rear tank' },
    ],
    draw: drawWaterGun,
    anchors: waterGunAnchors,
    roles: ['deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['smg', 'rifle', 'bubble_gun', 'flamethrower'],
    selfGrip: true,
    fireMode: 'stream',
    ammo: 'water',
  },
  {
    kind: 'foam-blaster',
    group: 'toy',
    noun: 'Foam Blaster',
    syn: ['nerf', 'foam blaster', 'dart gun', 'toy gun', 'foam dart', 'blaster'],
    tags: ['toy', 'plastic', 'silly'],
    desc: 'chunky foam dart blaster',
    color: '#f5f6f8',
    accent: '#ff7a1a',
    variants: [
      { v: 'pistol', p: { sty: 0 }, desc: 'revolver style foam dart pistol' },
      { v: 'rifle', p: { sty: 1 }, desc: 'pump foam dart rifle with stock' },
      { v: 'drum', p: { sty: 2 }, desc: 'drum fed foam dart blaster' },
    ],
    draw: drawBlaster,
    anchors: blasterAnchors,
    roles: ['deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol', 'smg', 'rifle'],
    selfGrip: true,
    fireMode: 'projectile',
    ammo: 'foam darts',
  },
  {
    kind: 'balloon',
    group: 'toy',
    noun: 'Balloon',
    syn: ['balloon', 'party balloon', 'balloon animal', 'balloon dog', 'heart balloon', 'helium'],
    tags: ['toy', 'party', 'birthday', 'rubber', 'light', 'cute', 'circus'],
    desc: 'shiny party balloon on string',
    color: '#e8304a',
    accent: '#f2efe8',
    variants: [
      { v: 'round', p: { R: 0.12, H: 0.3, sty: 0 } },
      { v: 'long', p: { R: 0.065, H: 0.45, sty: 0 }, desc: 'long skinny party balloon' },
      { v: 'heart', p: { s: 0.14, sty: 1 }, desc: 'heart shaped balloon on string' },
      { v: 'dog', p: { sty: 2 }, desc: 'twisted balloon animal dog', noun: 'Balloon Dog' },
    ],
    draw: drawBalloon,
    anchors: balloonAnchors,
    roles: ['head', 'muzzle', 'deco'],
    melee: { swing: 'spin', weight: 'light' },
  },
  {
    kind: 'confetti-cannon',
    group: 'toy',
    noun: 'Confetti Cannon',
    syn: ['confetti', 'party popper', 'confetti cannon', 'popper', 'celebration', 'streamer'],
    tags: ['toy', 'party', 'birthday', 'holiday', 'silly'],
    desc: 'twist tube confetti cannon',
    color: '#9b59b6',
    accent: '#ff4d6d',
    variants: [
      { v: 'popper', p: { sty: 0 }, desc: 'pull string party popper', noun: 'Party Popper' },
      { v: 'tube', p: { sty: 1, r: 0.035, L: 0.3, z1: 0.1 } },
      { v: 'bazooka', p: { sty: 2, r: 0.06, L: 0.5, z1: 0.2 }, desc: 'shoulder confetti bazooka' },
    ],
    draw: drawConfetti,
    anchors: confettiAnchors,
    roles: ['barrel', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['shotgun', 'rocket_launcher', 'grenade_launcher', 'pistol'],
    fireMode: 'projectile',
    ammo: 'confetti',
  },
  {
    kind: 'teddy-bear',
    group: 'toy',
    noun: 'Teddy Bear',
    syn: ['teddy', 'teddy bear', 'plushie', 'stuffed animal', 'bear', 'plush'],
    tags: ['toy', 'cute', 'light', 'silly'],
    desc: 'soft plush teddy bear',
    color: '#a8743f',
    accent: '#e8c79a',
    variants: [
      { v: 'classic', p: { hs: 1 } },
      { v: 'sitting', p: { hs: 1, sit: 1 }, desc: 'sitting teddy bear plushie' },
      { v: 'chibi', p: { hs: 1.45, bow: 1 }, desc: 'big headed teddy with bow tie' },
    ],
    draw: drawBear,
    anchors: bearAnchors,
    roles: ['head', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },
  {
    kind: 'yo-yo',
    group: 'toy',
    noun: 'Yo-yo',
    syn: ['yoyo', 'yo-yo', 'string toy', 'spinner', 'walk the dog'],
    tags: ['toy', 'plastic', 'retro', 'light'],
    desc: 'yo-yo dangling on its string',
    color: '#e74c3c',
    accent: '#f2efe8',
    variants: [
      { v: 'classic', p: { sty: 0, ls: 0.18 } },
      { v: 'butterfly', p: { sty: 1, ls: 0.22 }, desc: 'wide butterfly trick yo-yo' },
      { v: 'glow', p: { sty: 2, ls: 0.16 }, desc: 'light up glowing yo-yo' },
    ],
    draw: drawYoyo,
    anchors: yoyoAnchors,
    roles: ['head', 'mag', 'deco'],
    melee: { swing: 'spin', weight: 'light' },
  },
  {
    kind: 'toy-robot',
    group: 'toy',
    noun: 'Toy Robot',
    syn: ['robot', 'toy robot', 'tin robot', 'wind up robot', 'droid', 'bot'],
    tags: ['toy', 'metal', 'retro', 'scifi', 'cute'],
    desc: 'wind-up tin toy robot',
    color: '#8fa3b8',
    accent: '#e74c3c',
    variants: [
      { v: 'tin', p: { sty: 0 }, desc: 'boxy wind-up tin robot' },
      { v: 'dome', p: { sty: 1 }, desc: 'dome headed visor robot' },
      { v: 'treads', p: { sty: 2 }, desc: 'robot on tank treads' },
    ],
    draw: drawRobot,
    anchors: (p) => ({
      tip: [0, 0.01, -0.036],
      rear: [0, 0, 0.0495],
      top: [0, robotTop(p), 0],
      grip: [0, -0.05, 0],
      under: [0, -0.05, -0.02],
      side: [0.04, 0, 0],
    }),
    roles: ['head', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },
  {
    kind: 'gift-box',
    group: 'toy',
    noun: 'Gift Box',
    syn: ['gift', 'present', 'gift box', 'birthday present', 'christmas present', 'package'],
    tags: ['toy', 'party', 'birthday', 'holiday'],
    desc: 'wrapped present with ribbon bow',
    color: '#2ecc71',
    accent: '#e8304a',
    variants: [
      { v: 'cube', p: { w: 0.14, h: 0.14, d: 0.14 } },
      { v: 'tall', p: { w: 0.1, h: 0.2, d: 0.1 }, desc: 'tall wrapped present' },
      { v: 'flat', p: { w: 0.22, h: 0.07, d: 0.16, tag: 1 }, desc: 'flat present with gift tag' },
    ],
    draw: drawGift,
    anchors: (p) => ({
      tip: [0, 0, -(p.d / 2 + 0.006)],
      rear: [0, 0, p.d / 2 + 0.006],
      top: [p.w * 0.3, p.h / 2 + 0.002, p.d * 0.3],
      grip: [0, -p.h / 2 - 0.005, 0],
      under: [0, -p.h / 2 - 0.005, -p.d * 0.3],
      side: [p.w / 2 + 0.006, 0, 0],
    }),
    roles: ['muzzle', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },
  {
    kind: 'birthday-cake',
    group: 'toy',
    noun: 'Birthday Cake',
    syn: ['cake', 'birthday cake', 'candles', 'party cake', 'dessert', 'cake slice'],
    tags: ['party', 'birthday', 'silly', 'cute'],
    desc: 'frosted birthday cake with candles',
    color: '#f7e1b5',
    accent: '#f7a8c4',
    variants: [
      { v: 'single', p: { R: 0.11, h: 0.08, tiers: 1, nc: 5 } },
      { v: 'tiered', p: { R: 0.13, h: 0.07, tiers: 2, nc: 3 }, desc: 'two tier birthday cake' },
      { v: 'slice', p: { h: 0.07, slice: 1 }, desc: 'cake slice with strawberry', noun: 'Cake Slice' },
    ],
    draw: drawCake,
    anchors: cakeAnchors,
    roles: ['mag', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },
  {
    kind: 'party-horn',
    group: 'toy',
    noun: 'Party Horn',
    syn: ['party horn', 'blowout', 'noisemaker', 'party blower', 'kazoo', 'toot'],
    tags: ['toy', 'party', 'birthday', 'holiday', 'silly'],
    desc: 'paper party blowout horn',
    color: '#3498db',
    accent: '#ffd23f',
    variants: [
      { v: 'blowout', p: { sty: 0, L: 0.24 } },
      { v: 'cone', p: { sty: 1 }, desc: 'foil fringed cone party horn' },
      { v: 'curly', p: { sty: 2, L: 0.08 }, desc: 'rolled up curly party blower' },
    ],
    draw: drawHorn,
    anchors: hornAnchors,
    roles: ['barrel', 'muzzle', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
    guns: ['blowgun', 'pistol'],
    fireMode: 'hitscan',
    ammo: 'party toots',
  },
  {
    kind: 'magic-wand',
    group: 'toy',
    noun: 'Magic Wand',
    syn: ['wand', 'magic wand', 'star wand', 'fairy wand', 'magician', 'wizard', 'spell'],
    tags: ['toy', 'magic', 'light', 'circus'],
    desc: 'magician wand with white tips',
    color: '#1d1d22',
    accent: '#ffd23f',
    variants: [
      { v: 'magician', p: { sty: 0 }, desc: 'black magician wand with white tips' },
      { v: 'star', p: { sty: 1 }, desc: 'glowing star fairy wand' },
      { v: 'crystal', p: { sty: 2 }, desc: 'wooden wand with glowing crystal' },
    ],
    draw: drawWand,
    anchors: wandAnchors,
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
    guns: ['pistol', 'bubble_gun', 'flamethrower'],
    fireMode: 'projectile',
    ammo: 'sparkles',
  },
  {
    kind: 'pool-noodle',
    group: 'toy',
    noun: 'Pool Noodle',
    syn: ['pool noodle', 'noodle', 'foam noodle', 'swim noodle', 'foam tube'],
    tags: ['toy', 'plastic', 'silly', 'light'],
    desc: 'long hollow foam pool noodle',
    color: '#39d353',
    accent: '#ff4d6d',
    variants: [
      { v: 'classic', p: { sty: 0, L: 1.3 } },
      { v: 'bent', p: { sty: 1 }, desc: 'floppy bent pool noodle' },
      { v: 'ribbed', p: { sty: 2, L: 1.2 }, desc: 'ribbed hexagonal pool noodle' },
    ],
    draw: drawNoodle,
    anchors: noodleAnchors,
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
  },
];
