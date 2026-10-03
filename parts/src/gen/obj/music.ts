/** MUSIC objects. See objkit.ts for the canonical frame + roles. */
import type { Kit, Pt, Slot } from '../../lib/kit';
import { circlePts } from '../../lib/kit';
import type { Vec3 } from '../../types';
import type { Anchors, ObjSpec, P } from './objkit';

const PI = Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------------- shared helpers ---------------- */

/** Radius of a flared bell at t (0 throat .. 1 mouth). */
const bellR = (r0: number, R: number, flare: number, t: number) => r0 + (R - r0) * Math.pow(t, flare);

/**
 * Flared bell on axis (0, y) opening toward -Z: throat at zThroat, mouth at zThroat - L.
 * The inside is a recessed dark cone; returns the z of its apex (a good on-surface 'tip').
 */
function bell(
  k: Kit,
  slot: Slot,
  y: number,
  zThroat: number,
  L: number,
  r0: number,
  R: number,
  flare = 2.2,
  seg = 10,
  inner: Slot = 'dark',
  n = 5,
): number {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([bellR(r0, R, flare, t), t * L]);
  }
  pts.push([R * 0.9, L - 0.004]);
  const d = Math.min(0.03, L * 0.3);
  // lathe height h maps to z = zThroat - h
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

/* ---------------- stringed instruments (guitar, ukulele, banjo, violin) ---------------- */
// Frame: hand on the neck just below the headstock (origin); the body is the business end at -Z.
// Body face points +X (seen in profile), neck runs along Z.
// params: style (0 figure-8, 1 double-cut electric, 2 flying V, 3 banjo drum, 4 violin, 5 oval),
//   bl body length, bw body half-width, th thickness, nl neck length, nw neck width, hl headstock len,
//   ns strings, pin endpin length

const sym = (prof: Pt[]): Pt[] => [
  ...prof,
  ...prof
    .filter(([, w]) => w > 0)
    .map(([t, w]) => [t, -w] as Pt)
    .reverse(),
];

const OUTLINES: Record<number, Pt[]> = {
  0: sym([
    [0, 0.42],
    [0.1, 0.6],
    [0.22, 0.68],
    [0.36, 0.58],
    [0.46, 0.58],
    [0.6, 0.86],
    [0.75, 1],
    [0.88, 0.92],
    [0.96, 0.62],
    [0.99, 0.3],
    [1, 0],
  ]),
  1: [
    [0, 0.3],
    [-0.12, 0.55],
    [-0.1, 0.75],
    [0.05, 0.85],
    [0.25, 0.7],
    [0.4, 0.65],
    [0.6, 0.95],
    [0.8, 1],
    [0.95, 0.75],
    [1, 0],
    [0.95, -0.75],
    [0.8, -1],
    [0.6, -0.95],
    [0.4, -0.7],
    [0.25, -0.75],
    [0.1, -0.9],
    [-0.05, -0.85],
    [-0.02, -0.55],
    [0, -0.3],
  ],
  2: [
    [0, 0.3],
    [0.95, 1],
    [1, 0.85],
    [0.6, 0],
    [1, -0.85],
    [0.95, -1],
    [0, -0.3],
  ],
  4: sym([
    [0, 0.45],
    [0.08, 0.68],
    [0.2, 0.74],
    [0.3, 0.62],
    [0.36, 0.48],
    [0.46, 0.47],
    [0.52, 0.6],
    [0.66, 0.92],
    [0.8, 1],
    [0.92, 0.85],
    [0.98, 0.45],
    [1, 0],
  ]),
  5: sym([
    [0, 0.5],
    [0.12, 0.8],
    [0.3, 0.97],
    [0.5, 1],
    [0.7, 0.95],
    [0.88, 0.75],
    [0.97, 0.4],
    [1, 0],
  ]),
};
const ELEC_GUARD: Pt[] = [
  [0.06, 0.5],
  [0.3, 0.55],
  [0.55, 0.62],
  [0.7, 0.35],
  [0.66, -0.55],
  [0.4, -0.6],
  [0.1, -0.55],
  [0.04, -0.3],
];

function bridgeZ(p: P, zj: number): number {
  if (p.style === 3) return zj - p.bw * 1.3;
  if (p.style === 4) return zj - p.bl * 0.52;
  if (p.style === 0 || p.style === 5) return zj - p.bl * 0.72;
  return zj - p.bl * 0.7;
}

function stringBody(k: Kit, p: P, zj: number) {
  const st = p.style;
  const fx = p.th / 2;
  if (st === 3) {
    const R = p.bw;
    const zc = zj - R * 0.95;
    k.rod('main', [-fx, 0, zc], [fx, 0, zc], R, R, 12);
    k.rod('white', [fx, 0, zc], [fx + 0.003, 0, zc], R * 0.92, R * 0.92, 12);
    k.torus('metal', R * 0.97, 0.007, { p: [fx, 0, zc], r: [0, PI / 2, 0] }, 3, 12);
    k.box('wood', [0.008, 0.05, 0.01], { p: [fx + 0.007, 0, zj - R * 1.3] });
    k.box('metal', [0.006, 0.04, R * 0.5], { p: [fx + 0.005, 0, zc - R * 0.7] });
    return;
  }
  const zt = (t: number) => zj - t * p.bl;
  k.extrude(
    'main',
    OUTLINES[st].map(([t, y]) => [zt(t), y * p.bw] as Pt),
    p.th,
    'zy',
  );
  const face = { p: [fx + 0.0015, 0, 0] as Vec3 };
  if (st === 0 || st === 5) {
    k.decal('dark', circlePts(p.bw * 0.3, 10, zt(st === 0 ? 0.3 : 0.33), 0), face);
    k.box('dark', [0.008, p.bw * 0.55, 0.02], { p: [fx + 0.004, 0, zt(0.72)] });
  } else if (st === 4) {
    for (const s of [-1, 1])
      k.box('dark', [0.004, 0.006, p.bl * 0.16], { p: [fx + 0.001, s * p.bw * 0.36, zt(0.52)], r: [s * 0.15, 0, 0] });
    k.box('wood', [0.016, p.bw * 0.45, 0.006], { p: [fx + 0.008, 0, zt(0.52)] });
    k.box('dark', [0.008, p.bw * 0.3, p.bl * 0.26], { p: [fx + 0.004, 0, zt(0.8)] });
  } else {
    if (st === 1)
      k.decal(
        'accent',
        ELEC_GUARD.map(([t, y]) => [zt(t), y * p.bw] as Pt),
        face,
      );
    for (const t of [0.3, 0.52]) k.box('dark', [0.008, p.bw * 0.5, 0.025], { p: [fx + 0.004, 0, zt(t)] });
    k.box('metal', [0.008, p.bw * 0.45, 0.03], { p: [fx + 0.004, 0, zt(0.7)] });
    const ky = (st === 2 ? -0.72 : -0.55) * p.bw;
    for (const t of [0.78, 0.88]) k.rod('metal', [fx, ky, zt(t)], [fx + 0.012, ky, zt(t)], 0.008, 0.008, 6);
  }
}

function drawStringed(k: Kit, p: P) {
  const st = p.style;
  const zj = -p.nl;
  const fx = p.th / 2;
  const nx = fx - 0.013;
  const z1 = 0.02;
  stringBody(k, p, zj);
  const zn0 = zj - (st === 3 ? 0.02 : 0.03);
  k.box('wood', [0.026, p.nw, z1 - zn0], { p: [nx, 0, (z1 + zn0) / 2] });
  const zfb = st === 4 ? zj - p.bl * 0.3 : zj;
  k.box('dark', [0.006, p.nw * 0.9, z1 - zfb], { p: [fx + 0.003, 0, (z1 + zfb) / 2] });
  const zb = bridgeZ(p, zj);
  for (let i = 0; i < p.ns; i++) {
    const y = (i / (p.ns - 1) - 0.5) * p.nw * 0.6;
    k.box('metal', [0.0015, 0.0015, z1 - zb], { p: [fx + 0.0072, y, (z1 + zb) / 2] });
  }
  if (st === 4) {
    k.box('wood', [0.02, p.nw * 0.85, p.hl], { p: [nx, 0, z1 + p.hl / 2] });
    k.torus('wood', 0.012, 0.007, { p: [nx, 0.004, z1 + p.hl + 0.006], r: [0, PI / 2, 0] }, 3, 8);
    for (let i = 0; i < 4; i++) {
      const s = i % 2 ? 1 : -1;
      const z = z1 + p.hl * (0.2 + 0.18 * i);
      k.rod('dark', [nx, 0, z], [nx + s * 0.03, 0, z], 0.004, 0.004, 5);
    }
  } else {
    k.box('wood', [0.018, p.nw * 1.35, p.hl], { p: [nx - 0.004, 0, z1 + p.hl / 2] });
    const n = Math.ceil(p.ns / 2);
    for (let i = 0; i < n; i++)
      for (const s of [-1, 1])
        k.box('metal', [0.01, 0.014, 0.01], {
          p: [nx - 0.004, s * (p.nw * 0.675 + 0.006), z1 + p.hl * (0.25 + (0.6 * i) / Math.max(n - 1, 1))],
        });
  }
  if (p.pin) k.rod('metal', [0, 0, zj - p.bl + 0.01], [0, 0, zj - p.bl - p.pin], 0.006, 0.0025, 6);
}

function stringHead(k: Kit, p: P) {
  stringBody(k, p, -0.06);
  k.box('wood', [0.026, p.nw, 0.09], { p: [p.th / 2 - 0.013, 0, -0.035] });
}

function stringAnchors(p: P): Anchors {
  const fx = p.th / 2;
  const nx = fx - 0.013;
  const zj = -p.nl;
  let tip: Vec3, under: Vec3, side: Vec3;
  if (p.style === 3) {
    const R = p.bw;
    const zc = zj - R * 0.95;
    tip = [0, 0, zc - R];
    under = [0, -R, zc];
    side = [fx + 0.003, 0, zc];
  } else {
    const o = OUTLINES[p.style];
    tip = [0, 0, zj - (p.style === 2 ? 0.6 : 1) * p.bl - (p.pin ?? 0)];
    let lo = o[0];
    for (const q of o) if (q[1] < lo[1]) lo = q;
    under = [0, lo[1] * p.bw, zj - lo[0] * p.bl];
    side = [fx, 0, zj - 0.42 * p.bl];
  }
  const rear: Vec3 = p.style === 4 ? [nx, 0.004, 0.02 + p.hl + 0.025] : [nx - 0.004, 0, 0.02 + p.hl];
  return {
    tip,
    rear,
    top: [nx, p.nw / 2, -0.12],
    grip: [nx, -p.nw / 2, -0.04],
    under,
    side,
    mag: [nx, -p.nw / 2, -p.nl * 0.6],
  };
}

/* ---------------- brass ---------------- */

function drawTrumpet(k: Kit, p: P) {
  const yb = 0.02;
  const yl = -0.03;
  const zt = -0.06;
  const zm = zt - p.L;
  bell(k, 'main', yb, zt, p.L, 0.007, p.R, p.flare, 10, 'dark', 5);
  k.zrod('main', zt, 0.05, 0.006, 0.006, 6, 0, yb);
  for (const z of [-0.025, 0, 0.025]) {
    k.rod('main', [0, -0.065, z], [0, 0.035, z], 0.011, 0.011, 6);
    k.rod('white', [0, 0.035, z], [0, 0.055, z], 0.007, 0.007, 5);
  }
  const zr = 0.05 + p.lp;
  k.zrod('main', -0.09, zr, 0.005, 0.0055, 6, 0, yl);
  k.tube(
    'main',
    [
      [0, yl, -0.09],
      [0, yl - 0.016, -0.112],
      [0, yl - 0.032, -0.09],
    ],
    0.0055,
    4,
    5,
  );
  k.zrod('main', -0.09, -0.02, 0.0055, 0.0055, 6, 0, yl - 0.032);
  k.zlathe(
    'metal',
    [
      [0.005, zr - 0.005],
      [0.0065, zr + 0.02],
      [0.013, zr + 0.035],
      [0.0001, zr + 0.036],
    ],
    6,
    [0, yl, 0],
  );
  if (p.mute) k.rod('accent', [0, yb, zm + 0.05], [0, yb, zm - 0.025], p.R * 0.3, p.R * 0.7, 8);
}

function drawTrombone(k: Kit, p: P) {
  const yb = 0.025 + p.R;
  const ys = 0;
  const yl = -0.05;
  const zt = -0.04;
  bell(k, 'main', yb, zt, p.bl, 0.008, p.R, 2.4, 8, 'dark', 5);
  k.zrod('main', zt, 0.24, 0.007, 0.007, 6, 0, yb);
  k.tube(
    'main',
    [
      [0, yl, 0.08],
      [0, yl, 0.17],
      [0, 0.01, 0.29],
      [0, yb, 0.24],
    ],
    0.007,
    6,
    5,
  );
  const zs = -0.27 - p.ext;
  const zf = -p.sl - p.ext;
  for (const y of [ys, yl]) {
    k.zrod('main', zs, 0.08, 0.006, 0.006, 6, 0, y);
    k.zrod('main', zf, zs + 0.06, 0.0085, 0.0085, 6, 0, y);
  }
  k.tube(
    'main',
    [
      [0, ys, zf],
      [0, (ys + yl) / 2, zf - 0.025],
      [0, yl, zf],
    ],
    0.0085,
    6,
    5,
  );
  k.box('main', [0.008, ys - yl, 0.012], { p: [0, (ys + yl) / 2, zf + 0.12] });
  k.box('main', [0.008, yb - yl, 0.014], { p: [0, (yb + yl) / 2, 0] });
  k.box('main', [0.008, yb - ys, 0.01], { p: [0, (yb + ys) / 2, -0.14] });
  k.zlathe(
    'metal',
    [
      [0.005, 0.075],
      [0.006, 0.1],
      [0.012, 0.115],
      [0.0001, 0.116],
    ],
    6,
    [0, ys, 0],
  );
  if (p.loop) k.torus('main', 0.05, 0.007, { p: [0, yb - 0.06, 0.14], r: [0, PI / 2, 0] }, 3, 10);
}

function drawSax(k: Kit, p: P) {
  const s = p.s;
  const V = (x: number, y: number, z: number): Vec3 => [x * s, y * s, z * s];
  if (p.straight) {
    k.zlathe(
      'main',
      [
        [0.022, -0.22],
        [0.009, 0.25],
      ],
      8,
    );
    bell(k, 'main', 0, -0.22, 0.1, 0.022, 0.042, 1.8, 10, 'dark', 4);
    k.zrod('dark', 0.25, 0.3, 0.009, 0.006, 6);
    for (let i = 0; i < 5; i++) {
      const z = -0.16 + i * 0.075;
      const r = lerp(0.022, 0.009, (z + 0.22) / 0.47);
      k.rod('white', [r * 0.5, 0, z], [r + 0.006, 0, z], 0.006, 0.006, 6);
    }
    return;
  }
  k.zlathe(
    'main',
    [
      [0.013 * s, -0.18 * s],
      [0.03 * s, 0.17 * s],
    ],
    8,
  );
  k.tube('main', [V(0, 0, 0.17), V(0, -0.02, 0.225), V(0, -0.09, 0.235), V(0, -0.12, 0.17)], 0.033 * s, 8, 6);
  k.zlathe(
    'main',
    [
      [0.045 * s, -0.1 * s],
      [0.036 * s, 0.17 * s],
    ],
    8,
    [0, -0.12 * s, 0],
  );
  bell(k, 'main', -0.12 * s, -0.1 * s, 0.23 * s, 0.045 * s, 0.075 * s, 2, 10, 'dark', 4);
  const ye = p.hump ? 0.045 : 0.04;
  k.tube(
    'main',
    p.hump
      ? [V(0, 0, -0.18), V(0, 0.02, -0.215), V(0, 0.055, -0.25), V(0, ye, -0.3)]
      : [V(0, 0, -0.18), V(0, 0.012, -0.23), V(0, 0.035, -0.27), V(0, ye, -0.3)],
    0.008 * s,
    6,
    5,
  );
  k.zrod('dark', -0.33 * s, -0.3 * s, 0.006 * s, 0.009 * s, 6, 0, ye * s);
  for (let i = 0; i < 4; i++) {
    const z = -0.12 + i * 0.08;
    const r = lerp(0.013, 0.03, (z + 0.18) / 0.35);
    k.rod('white', [r * 0.7 * s, 0, z * s], [(r + 0.006) * s, 0, z * s], 0.007 * s, 0.007 * s, 6);
  }
}

function saxAnchors(p: P): Anchors {
  const s = p.s;
  if (p.straight) {
    const r = (z: number) => lerp(0.022, 0.009, (z + 0.22) / 0.47);
    return {
      tip: [0, 0, bellApex(-0.22, 0.1)],
      rear: [0, 0, 0.3],
      top: [0, r(-0.02), -0.02],
      grip: [0, -r(0.02), 0.02],
      under: [0, -r(-0.15), -0.15],
      side: [r(-0.02), 0, -0.02],
    };
  }
  const r = (z: number) => lerp(0.013, 0.03, (z + 0.18) / 0.35);
  return {
    tip: [0, -0.12 * s, bellApex(-0.1 * s, 0.23 * s)],
    rear: [0, -0.055 * s, 0.265 * s],
    top: [0, r(0) * s, 0],
    grip: [0, -r(0.02) * s, 0.02 * s],
    under: [0, (-0.12 - 0.043) * s, -0.05 * s],
    side: [r(0) * s, 0, 0],
  };
}

function drawTuba(k: Kit, p: P) {
  const zt = -0.03;
  const cy = -0.09;
  const cz = 0.02;
  bell(k, 'main', p.by, zt, p.bl, 0.04, p.R, 2.2, 10, 'dark', 5);
  if (p.sousa) k.torus('main', p.cr, 0.03, { p: [0, cy, cz + p.cr * 0.5], r: [PI / 2, 0, 0] }, 5, 14);
  else k.torus('main', p.cr, 0.035, { p: [0, cy, cz], r: [0, PI / 2, 0] }, 5, 12);
  k.rod('main', [0, p.by, zt], [0, cy + (p.sousa ? 0 : p.cr), cz + 0.05], 0.04, 0.034, 8);
  for (let i = 0; i < 4; i++) {
    const z = -0.04 + i * 0.028;
    k.rod('metal', [0.05, -0.06, z], [0.05, 0.07, z], 0.012, 0.012, 6);
  }
  k.tube(
    'main',
    [
      [0, 0.0, cz + 0.06],
      [0, 0.04, cz + 0.14],
      [0, 0.06, cz + 0.2],
    ],
    0.008,
    5,
    5,
  );
  k.zlathe(
    'metal',
    [
      [0.006, cz + 0.2],
      [0.016, cz + 0.23],
      [0.0001, cz + 0.232],
    ],
    6,
    [0, 0.06, 0],
  );
}

function tubaAnchors(p: P): Anchors {
  const zt = -0.03;
  const cy = -0.09;
  const cz = 0.02;
  const rb = (t: number) => bellR(0.04, p.R, 2.2, t);
  const rear: Vec3 = p.sousa
    ? [0, cy, cz + p.cr * 1.5 + 0.03]
    : cz + p.cr + 0.035 > cz + 0.232
      ? [0, cy, cz + p.cr + 0.035]
      : [0, 0.06, cz + 0.232];
  return {
    tip: [0, p.by, bellApex(zt, p.bl)],
    rear,
    top: [0, p.by + rb(0.2), zt - 0.2 * p.bl],
    grip: p.sousa ? [0, cy - 0.03, cz - p.cr * 0.5] : [0, cy - p.cr - 0.035, cz],
    under: [0, p.by - rb(0.7), zt - 0.7 * p.bl],
    side: [rb(0.5), p.by, zt - 0.5 * p.bl],
    mag: p.sousa ? [0, cy - 0.03, cz - p.cr * 0.5] : [0, cy - p.cr - 0.035, cz],
  };
}

/* ---------------- woodwinds ---------------- */

function drawFlute(k: Kit, p: P) {
  const z0 = -p.L * 0.8;
  const z1 = p.L * 0.2;
  const r = p.r;
  k.zrod('main', z0, z1, r, r, 8);
  k.zrod('metal', z0, z0 + 0.015, r * 1.12, r * 1.12, 8);
  if (p.curve)
    k.tube(
      'main',
      [
        [0, 0, z1],
        [0, 0, z1 + 0.04],
        [0, -0.045, z1 + 0.075],
        [0, -0.075, z1 + 0.035],
      ],
      r,
      6,
      6,
    );
  else k.zrod('main', z1, z1 + 0.012, r * 1.15, r * 1.15, 8);
  k.box('main', [r * 2.2, 0.003, 0.024], { p: [0, r + 0.001, z1 - 0.045] });
  k.box('dark', [r * 0.9, 0.002, 0.009], { p: [0, r + 0.003, z1 - 0.045] });
  for (let i = 0; i < p.nk; i++) {
    const z = lerp(z0 + 0.06, z1 - 0.12, i / (p.nk - 1));
    k.rod('metal', [0, r * 0.6, z], [0, r + 0.004, z], 0.0065, 0.0065, 6);
  }
  k.zrod('metal', z0 + 0.05, z1 - 0.1, 0.0022, 0.0022, 4, r * 0.9, r * 0.5);
}

function fluteAnchors(p: P): Anchors {
  const z0 = -p.L * 0.8;
  const z1 = p.L * 0.2;
  const r = p.r;
  return {
    tip: [0, 0, z0],
    rear: p.curve ? [0, -0.045, z1 + 0.075 + r] : [0, 0, z1 + 0.012],
    top: [0, r, -0.03],
    grip: [0, -r, 0.02],
    under: [0, -r, z0 * 0.5],
    side: [r, 0, z0 * 0.3],
  };
}

function drawClarinet(k: Kit, p: P) {
  const z0 = -p.L * 0.78;
  const z1 = p.L * 0.22;
  const r = p.r;
  const B = p.bellR;
  k.zlathe(
    'dark',
    [
      [0.0001, z0 + 0.02],
      [B * 0.88, z0 + 0.002],
    ],
    8,
  );
  const prof: Pt[] =
    p.sty === 2
      ? [
          [B * 0.88, z0 + 0.002],
          [B, z0],
          [r * 1.1, z0 + 0.05],
          [r, z0 + 0.1],
          [r, z1 - 0.1],
          [r * 1.35, z1 - 0.085],
          [r * 1.35, z1 - 0.02],
          [r * 0.8, z1],
          [0.0001, z1],
        ]
      : [
          [B * 0.88, z0 + 0.002],
          [B, z0],
          [r * 1.05, z0 + p.L * 0.13],
          [r, z0 + p.L * 0.2],
          [r, z1 - 0.07],
          [r * 1.25, z1 - 0.065],
          [r * 1.25, z1 - 0.035],
          [r * 0.8, z1 - 0.02],
          [r * 0.45, z1],
          [0.0001, z1],
        ];
  k.zlathe('main', prof, 8);
  if (p.sty === 2) {
    // recorder: finger holes + window
    for (let i = 0; i < 7; i++) {
      const z = lerp(z0 + 0.09, z1 - 0.13, i / 6);
      k.rod('dark', [0, r * 0.7, z], [0, r + 0.001, z], 0.0035, 0.0035, 5);
    }
    k.box('dark', [r * 1.2, 0.004, 0.012], { p: [0, r * 1.3, z1 - 0.06] });
    return;
  }
  for (const z of [z0 + p.L * 0.13, z1 - 0.07]) k.torus('accent', r * 1.08, 0.0022, { p: [0, 0, z] }, 3, 8);
  const nk = p.sty === 1 ? 7 : 6;
  for (let i = 0; i < nk; i++) {
    const z = lerp(z0 + p.L * 0.22, z1 - 0.1, i / (nk - 1));
    k.rod('accent', [0, r * 0.6, z], [0, r + 0.003, z], 0.0055, 0.0055, 5);
  }
  k.zrod('accent', z0 + p.L * 0.2, z1 - 0.08, 0.0018, 0.0018, 4, r * 0.9, r * 0.4);
  if (p.sty === 1) {
    k.box('wood', [0.007, 0.002, 0.028], { p: [0, 0, z1 + 0.014] });
    k.zrod('brass', z1 - 0.004, z1 + 0.004, 0.003, 0.003, 5);
  } else {
    k.box('wood', [r * 0.9, 0.002, 0.03], { p: [0, -r * 0.55, z1 - 0.014], r: [0.12, 0, 0] });
  }
}

function clarinetAnchors(p: P): Anchors {
  const z0 = -p.L * 0.78;
  const z1 = p.L * 0.22;
  const r = p.r;
  return {
    tip: [0, 0, z0 + 0.02],
    rear: [0, 0, p.sty === 1 ? z1 + 0.028 : z1],
    top: [0, r, -0.08],
    grip: [0, -r, -0.04],
    under: [0, -r, z0 * 0.5],
    side: [r, 0, z0 * 0.3],
  };
}

/* ---------------- percussion ---------------- */

function drum(k: Kit, R: number, h: number, zc: number, taper: number, lugs: number, seg: number) {
  k.rod('main', [0, -h / 2, zc], [0, h / 2, zc], R * taper, R, seg);
  k.rod('white', [0, h / 2, zc], [0, h / 2 + 0.003, zc], R * 0.97, R * 0.97, seg);
  k.torus('metal', R, 0.007, { p: [0, h / 2, zc], r: [PI / 2, 0, 0] }, 3, seg);
  if (taper === 1) k.torus('metal', R, 0.007, { p: [0, -h / 2, zc], r: [PI / 2, 0, 0] }, 3, seg);
  for (let i = 0; i < lugs; i++) {
    const a = ((i + 0.5) / lugs) * 2 * PI;
    k.box('metal', [0.012, h * 0.5, 0.012], { p: [Math.sin(a) * (R + 0.004), 0, zc + Math.cos(a) * (R + 0.004)], r: [0, a, 0] });
  }
}

function drawDrumSet(k: Kit, p: P, zStart: number) {
  const zc = zStart - p.R;
  if (p.sty === 2) {
    drum(k, p.R, p.h, zc, 0.8, 0, 10);
    const zc2 = zc - p.R - p.R * 0.82 - 0.01;
    drum(k, p.R * 0.82, p.h * 0.95, zc2, 0.8, 0, 10);
    k.box('wood', [0.03, p.h * 0.4, 0.05], { p: [0, 0, zc - p.R - 0.005] });
  } else drum(k, p.R, p.h, zc, 1, p.sty === 1 ? 6 : 8, 12);
}

function drumAnchors(p: P): Anchors {
  const zc = -0.04 - p.R;
  const t = p.sty === 2 ? 0.9 : 1;
  const tip: Vec3 =
    p.sty === 2 ? [0, 0, zc - p.R - p.R * 0.82 - 0.01 - p.R * 0.82 * 0.9] : [0, 0, zc - p.R];
  return {
    tip,
    rear: [0, 0, 0.07],
    top: [0, p.h / 2 + 0.003, zc],
    grip: [0, -0.012, 0.03],
    under: [0, -p.h / 2, zc],
    side: [p.R * t, 0, zc],
    mag: [0, -0.012, -0.02],
  };
}

function drawStick(k: Kit, p: P) {
  const z1 = 0.12;
  const z0 = z1 - p.L;
  const r = p.r;
  if (p.sty === 0) {
    k.zlathe(
      'main',
      [
        [0.0001, z0],
        [r * 0.5, z0 + 0.004],
        [r * 0.6, z0 + 0.012],
        [r * 0.35, z0 + 0.022],
        [r * 0.45, z0 + 0.04],
        [r, z0 + p.L * 0.4],
        [r, z1 - 0.004],
        [r * 0.7, z1],
        [0.0001, z1],
      ],
      8,
    );
    k.zrod('accent', 0.02, z1 - 0.012, r * 1.07, r * 1.07, 8);
  } else if (p.sty === 1) {
    k.zrod('main', z0 + 0.03, z1, r, r, 6);
    k.ball('accent', 0.026, [0, 0, z0 + 0.026], 1);
  } else {
    k.zrod('rubber', z0 + p.L * 0.45, z1, r, r, 6);
    k.zrod('metal', z0 + p.L * 0.42, z0 + p.L * 0.5, r * 1.1, r * 1.1, 6);
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.07;
      k.box('metal', [0.0012, 0.0012, p.L * 0.5], {
        p: [0, Math.sin(a) * p.L * 0.25, z0 + p.L * 0.5 - Math.cos(a) * p.L * 0.25],
        r: [a, 0, 0],
      });
    }
  }
}

/* ---------------- keytar ---------------- */

function keytarOutline(p: P): Pt[] {
  const w = p.w;
  const zb0 = -0.06;
  const zb1 = zb0 - p.L;
  if (p.sty === 1) {
    const pts: Pt[] = [
      [-0.5 * w, zb0 - 0.04],
      [-0.3 * w, zb0],
      [0.3 * w, zb0],
      [0.5 * w, zb0 - 0.04],
    ];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * PI;
      pts.push([0.5 * w * Math.cos(a), zb1 + 0.5 * w - 0.5 * w * Math.sin(a)]);
    }
    return pts;
  }
  if (p.sty === 2)
    return [
      [-0.3 * w, zb0],
      [0.3 * w, zb0],
      [0.5 * w, zb0 - 0.06],
      [0.5 * w, zb1],
      [-0.5 * w, zb1 + 0.05],
      [-0.5 * w, zb0 - 0.06],
    ];
  return [
    [-0.35 * w, zb0],
    [0.35 * w, zb0],
    [0.5 * w, zb0 - 0.1],
    [0.5 * w, zb1 + 0.08],
    [0.25 * w, zb1],
    [-0.5 * w, zb1],
    [-0.5 * w, zb0 - 0.08],
  ];
}

const KT_TH = 0.045;
function keytarKeys(p: P) {
  const Lk = p.oct * 0.161 - 0.01;
  const zs = -0.06 - (p.L - Lk) / 2;
  return { Lk, zs };
}

function drawKeytar(k: Kit, p: P) {
  const zb0 = -0.06;
  k.extrude('main', keytarOutline(p), KT_TH, 'xz');
  const { Lk, zs } = keytarKeys(p);
  k.box('white', [0.07, 0.012, Lk], { p: [-0.01, KT_TH / 2 + 0.006, zs - Lk / 2] });
  for (let o = 0; o < p.oct; o++)
    for (const j of [1, 2, 4, 5, 6]) {
      const z = zs - 0.005 - (o * 7 + j) * 0.023;
      if (z < zs - Lk + 0.01) continue;
      k.box('dark', [0.042, 0.012, 0.012], { p: [-0.024, KT_TH / 2 + 0.015, z] });
    }
  const nl = p.nl;
  k.box('dark', [0.035, 0.035, nl], { p: [0, 0, zb0 + 0.02 + nl / 2 - 0.04] });
  k.box('glow', [0.012, 0.004, nl * 0.4], { p: [0, 0.0195, zb0 + nl * 0.55] });
  for (const z of [zb0 + nl * 0.2, zb0 + nl * 0.28]) k.box('accent', [0.01, 0.006, 0.012], { p: [0.008, 0.019, z] });
  k.rod('metal', [0, 0, zb0 + nl - 0.02], [0, 0, zb0 + nl - 0.01], 0.008, 0.008, 6);
}

function keytarAnchors(p: P): Anchors {
  const zb0 = -0.06;
  const zb1 = zb0 - p.L;
  const { Lk, zs } = keytarKeys(p);
  const mid = (zb0 + zb1) / 2;
  return {
    tip: [0, 0, p.sty === 2 ? zb1 + 0.025 : zb1],
    rear: [0, 0, zb0 + p.nl - 0.02],
    top: [-0.01, KT_TH / 2 + 0.012, zs - Lk / 2],
    grip: [0, -0.0175, 0],
    under: [0, -KT_TH / 2, mid],
    side: [p.w / 2, 0, p.sty === 1 ? (zb0 - 0.04 + zb1 + 0.5 * p.w) / 2 : mid],
  };
}

/* ---------------- microphone ---------------- */

function micHandle(k: Kit, r0: number, r1: number, he: number, zo = 0) {
  k.zlathe(
    'main',
    [
      [0.0001, -0.045 + zo],
      [0.021, -0.045 + zo],
      [r0, -0.02 + zo],
      [r1, he + zo],
      [0.0001, he + 0.004 + zo],
    ],
    8,
  );
}
function micGrille(k: Kit, zo = 0) {
  k.ball('metal', 0.03, [0, 0, -0.065 + zo], 1);
  k.torus('accent', 0.021, 0.004, { p: [0, 0, -0.04 + zo] }, 3, 10);
}
const MIC_H: Record<number, [number, number, number]> = {
  0: [0.019, 0.013, 0.1],
  1: [0.02, 0.016, 0.14],
  2: [0.017, 0.012, 0.1],
  3: [0.019, 0.013, 0.1],
};

function drawMic(k: Kit, p: P) {
  const [r0, r1, he] = MIC_H[p.sty];
  if (p.sty === 3) {
    const zo = -0.74;
    micHandle(k, r0, r1, he, zo);
    micGrille(k, zo);
    k.zrod('metal', -0.63, 0.38, 0.009, 0.009, 6);
    k.box('dark', [0.03, 0.03, 0.02], { p: [0, 0, -0.635] });
    k.zrod('dark', 0, 0.04, 0.014, 0.014, 6);
    k.zrod('dark', 0.36, 0.4, 0.13, 0.13, 10);
    return;
  }
  micHandle(k, r0, r1, he);
  if (p.sty === 2) {
    k.ball('metal', 0.045, [0, 0.03, -0.06], 1, [0.8, 1.3, 0.75]);
    for (const j of [-1, 0, 1]) k.box('dark', [0.05, 0.004, 0.005], { p: [0, 0.03 + j * 0.022, -0.092] });
    k.torus('accent', 0.02, 0.004, { p: [0, 0, -0.04] }, 3, 10);
    return;
  }
  micGrille(k);
  if (p.sty === 1) {
    k.zrod('dark', he, he + 0.03, 0.008, 0.006, 6);
    k.zrod('glow', 0.05, 0.056, lerp(r0, r1, 0.07 / (he + 0.02)) + 0.0012, lerp(r0, r1, 0.07 / (he + 0.02)) + 0.0012, 8);
  } else {
    k.tube(
      'dark',
      [
        [0, 0, he],
        [0, -0.01, he + 0.04],
        [0, -0.04, he + 0.06],
      ],
      0.004,
      4,
      4,
    );
  }
}

function micAnchors(p: P): Anchors {
  const [r0, r1, he] = MIC_H[p.sty];
  const rh = (z: number) => lerp(r0, r1, (z + 0.02) / (he + 0.02));
  if (p.sty === 3)
    return {
      tip: [0, 0, -0.835],
      rear: [0, 0, 0.4],
      top: [0, 0.009, -0.3],
      grip: [0, -0.014, 0.02],
      under: [0, -0.009, -0.45],
      side: [0.009, 0, -0.3],
    };
  const base = {
    top: [0, rh(0), 0] as Vec3,
    grip: [0, -rh(0.02), 0.02] as Vec3,
  };
  if (p.sty === 2)
    return {
      ...base,
      tip: [0, 0.03, -0.094],
      rear: [0, 0, he + 0.004],
      under: [0, -0.0285, -0.06],
      side: [0.036, 0.03, -0.06],
    };
  return {
    ...base,
    tip: [0, 0, -0.095],
    rear: p.sty === 1 ? [0, 0, he + 0.03] : [0, -0.04, he + 0.06],
    under: [0, -0.03, -0.065],
    side: [0.03, 0, -0.065],
  };
}

/* ---------------- tambourine ---------------- */

function drawTambourine(k: Kit, p: P) {
  if (p.sty === 2) {
    const R = p.R;
    const zc = -0.55 * R;
    const Ri = 0.62 * R;
    const off = 0.3 * R;
    const pts: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = 0.873 + (i / 10) * (2 * PI - 1.746);
      pts.push([zc + Math.cos(a) * R, Math.sin(a) * R]);
    }
    for (let i = 8; i >= 0; i--) {
      const a = 1.309 + (i / 8) * (2 * PI - 2.618);
      pts.push([zc + off + Math.cos(a) * Ri, Math.sin(a) * Ri]);
    }
    k.extrude('main', pts, 0.025, 'zy');
    k.rod('dark', [0, -0.7 * R, 0], [0, 0.7 * R, 0], 0.011, 0.011, 6);
    for (let i = -2; i <= 2; i++) {
      const a = PI + i * 0.5;
      const y = Math.sin(a) * 0.72 * R;
      const z = zc + Math.cos(a) * 0.72 * R;
      k.rod('metal', [-0.02, y, z], [0.02, y, z], 0.016, 0.016, 6);
    }
    return;
  }
  const zc = -p.R;
  const t = 0.012;
  k.torus('main', p.R, t, { p: [0, 0, zc], r: [0, PI / 2, 0], s: [1, 1, p.w / (2 * t)] }, 4, 14);
  if (p.sty === 0) k.rod('white', [-0.002, 0, zc], [0.002, 0, zc], p.R - 0.004, p.R - 0.004, 14);
  for (let i = 0; i < p.nj; i++) {
    const a = 0.7 + (i / (p.nj - 1)) * (2 * PI - 1.4);
    const y = Math.sin(a) * p.R;
    const z = zc + Math.cos(a) * p.R;
    k.rod('metal', [-p.w * 0.62, y, z], [p.w * 0.62, y, z], 0.017, 0.017, 6);
  }
}

function tambourineAnchors(p: P): Anchors {
  if (p.sty === 2) {
    const R = p.R;
    const zc = -0.55 * R;
    return {
      tip: [0, 0, zc - R],
      rear: [0, 0, 0.011],
      top: [0, R * 0.98, zc],
      grip: [0, -0.011, 0],
      under: [0, -R * 0.98, zc],
      side: [0.0125, 0, zc - 0.8 * R],
    };
  }
  const R = p.R;
  return {
    tip: [0, 0, -2 * R - 0.012],
    rear: [0, 0, 0.012],
    top: [0, R + 0.012, -R],
    grip: [0, -0.02, 0.011],
    under: [0, -R - 0.012, -R],
    side: [p.w / 2, R, -R],
  };
}

/* ---------------- maracas ---------------- */

function drawMaraca(k: Kit, p: P, head = false) {
  if (p.sty === 1 && !head) {
    k.ball('main', p.br, [0, 0, 0], 1, [1, 1, p.el]);
    k.torus('accent', p.br * 0.98, 0.004, { p: [0, 0, 0] }, 3, 12);
    return;
  }
  const zc = head ? -0.02 - p.br * p.el : -0.01 - p.br * p.el * 0.85;
  k.ball('main', p.br, [0, 0, zc], 1, [1, 1, p.el]);
  k.torus('accent', p.br * 0.99, 0.005, { p: [0, 0, zc] }, 3, 12);
  k.torus('white', p.br * 0.86, 0.004, { p: [0, 0, zc - p.br * p.el * 0.5] }, 3, 10);
  if (head) {
    k.zrod('wood', -0.03, 0, 0.011, 0.011, 6);
    return;
  }
  k.zlathe(
    'wood',
    [
      [0.0001, -0.02],
      [0.012, -0.02],
      [0.009, 0.01],
      [0.011, p.hl - 0.015],
      [0.016, p.hl - 0.008],
      [0.0001, p.hl],
    ],
    6,
  );
}

function maracaAnchors(p: P): Anchors {
  if (p.sty === 1) {
    const r = p.br;
    return {
      tip: [0, 0, -r * p.el],
      rear: [0, 0, r * p.el],
      top: [0, r, 0],
      grip: [0, -r, 0.01],
      under: [0, -r * 0.92, -r * p.el * 0.4],
      side: [r, 0, 0],
    };
  }
  const zc = -0.01 - p.br * p.el * 0.85;
  return {
    tip: [0, 0, zc - p.br * p.el],
    rear: [0, 0, p.hl],
    top: [0, p.br, zc],
    grip: [0, -0.0095, p.hl * 0.4],
    under: [0, -p.br, zc],
    side: [p.br, 0, zc],
  };
}

/* ---------------- megaphone ---------------- */

const MEG_Y = 0.075;
const MEG_ZT = 0.08;
const megR = (p: P, z: number) => p.r0 + ((p.R - p.r0) * (MEG_ZT - z)) / p.L;

function drawMegaphone(k: Kit, p: P) {
  bell(k, 'main', MEG_Y, MEG_ZT, p.L, p.r0, p.R, 1, 12, 'dark', 3);
  k.zrod('accent', MEG_ZT - 0.005, MEG_ZT + 0.07, p.r0 * 1.05, p.r0 * 1.05, 10, 0, MEG_Y);
  k.zrod('accent', MEG_ZT + 0.07, MEG_ZT + 0.08, p.r0 * 1.05, p.r0 * 0.6, 10, 0, MEG_Y);
  k.extrude(
    'dark',
    [
      [0.022, 0.045],
      [-0.022, 0.045],
      [-0.035, -0.09],
      [0.005, -0.1],
    ],
    0.028,
    'zy',
  );
  k.box('accent', [0.008, 0.025, 0.012], { p: [0, 0, -0.026] });
  if (p.big) {
    const z = MEG_ZT - p.L * 0.45;
    const y = MEG_Y + megR(p, z) + 0.015;
    k.box('accent', [0.05, 0.035, 0.09], { p: [0, y, z] });
    k.rod('glow', [0, y + 0.017, z - 0.02], [0, y + 0.035, z - 0.02], 0.012, 0.009, 8);
  }
}

function megAnchors(p: P): Anchors {
  const zu = MEG_ZT - p.L * 0.7;
  const zs = MEG_ZT - p.L * 0.5;
  return {
    tip: [0, MEG_Y, bellApex(MEG_ZT, p.L)],
    rear: [0, MEG_Y, MEG_ZT + 0.08],
    top: [0, MEG_Y + megR(p, 0), 0],
    grip: [0, -0.095, -0.015],
    under: [0, MEG_Y - megR(p, zu), zu],
    side: [megR(p, zs), MEG_Y, zs],
    mag: [0, -0.06, -0.032],
  };
}

/* ---------------- boombox ---------------- */

function boomSpeakers(p: P): [number, number, number, number][] {
  const yb = -0.03 - p.H / 2;
  if (p.ns === 1) return [[-p.L * 0.18, yb, Math.min(p.H * 0.38, p.L * 0.25), 10]];
  if (p.ns === 4)
    return [
      [-p.L * 0.3, yb - p.H * 0.12, p.H * 0.3, 10],
      [p.L * 0.3, yb - p.H * 0.12, p.H * 0.3, 10],
      [-p.L * 0.3, yb + p.H * 0.31, p.H * 0.12, 8],
      [p.L * 0.3, yb + p.H * 0.31, p.H * 0.12, 8],
    ];
  const rs = Math.min(p.H * 0.36, p.L * 0.17);
  return [
    [-p.L * 0.3, yb, rs, 10],
    [p.L * 0.3, yb, rs, 10],
  ];
}
const boomDeckZ = (p: P) => (p.ns === 1 ? p.L * 0.25 : 0);

function drawBoombox(k: Kit, p: P) {
  const yt = -0.03;
  const yb = yt - p.H / 2;
  const fx = p.W / 2;
  k.box('main', [p.W, p.H, p.L], { p: [0, yb, 0] });
  k.zrod('dark', -p.L * 0.32, p.L * 0.32, 0.011, 0.011, 6);
  for (const s of [-1, 1]) k.rod('dark', [0, 0, s * p.L * 0.32], [0, yt, s * p.L * 0.32], 0.009, 0.009, 6);
  for (const [z, y, rs, seg] of boomSpeakers(p)) {
    k.rod('metal', [fx, y, z], [fx + 0.006, y, z], rs, rs, seg);
    k.rod('dark', [fx + 0.006, y, z], [fx + 0.016, y, z], rs * 0.82, rs * 0.25, seg);
  }
  const dz = boomDeckZ(p);
  const dl = p.ns === 1 ? p.L * 0.3 : p.L * 0.2;
  k.box('accent', [0.006, p.H * 0.4, dl], { p: [fx + 0.003, yb + p.H * 0.05, dz] });
  k.box('dark', [0.004, p.H * 0.18, dl * 0.6], { p: [fx + 0.007, yb + p.H * 0.05, dz] });
  for (let i = 0; i < 3; i++) k.box('metal', [0.02, 0.008, 0.015], { p: [0.02, yt + 0.004, -0.03 + i * 0.022] });
  k.rod('metal', [-fx * 0.6, yt, p.L * 0.45], [-fx * 0.6, yt + 0.18, p.L * 0.3], 0.003, 0.002, 4);
}

function boomAnchors(p: P): Anchors {
  const yt = -0.03;
  const yb = yt - p.H / 2;
  return {
    tip: [0, yb, -p.L / 2],
    rear: [0, yb, p.L / 2],
    top: [0, yt, -p.L * 0.42],
    grip: [0, yt - p.H, 0.05],
    under: [0, yt - p.H, -p.L * 0.3],
    side: [p.W / 2 + 0.006, yb + p.H * 0.05, boomDeckZ(p)],
  };
}

/* ---------------- specs ---------------- */

export const MUSIC: ObjSpec[] = [
  {
    kind: 'guitar',
    group: 'music',
    noun: 'Guitar',
    syn: ['guitar', 'axe', 'electric guitar', 'acoustic', 'strings', 'rock', 'six string', 'bass guitar', 'flying v'],
    tags: ['music', 'rock', 'wood', 'heavy'],
    desc: 'six string guitar swung body first',
    color: '#c1582b',
    accent: '#f2efe8',
    variants: [
      { v: 'acoustic', p: { style: 0, bl: 0.5, bw: 0.2, th: 0.1, nl: 0.45, nw: 0.05, hl: 0.18, ns: 6 }, desc: 'acoustic guitar with round soundhole' },
      { v: 'electric', p: { style: 1, bl: 0.44, bw: 0.17, th: 0.045, nl: 0.45, nw: 0.045, hl: 0.17, ns: 6 }, desc: 'double cutaway electric guitar', noun: 'Electric Guitar' },
      { v: 'flyingv', p: { style: 2, bl: 0.5, bw: 0.2, th: 0.045, nl: 0.42, nw: 0.045, hl: 0.17, ns: 6 }, desc: 'pointy flying v metal guitar', noun: 'Flying V' },
      { v: 'bass', p: { style: 1, bl: 0.46, bw: 0.17, th: 0.045, nl: 0.62, nw: 0.05, hl: 0.2, ns: 4 }, desc: 'long necked four string bass', noun: 'Bass Guitar' },
    ],
    draw: drawStringed,
    head: stringHead,
    anchors: stringAnchors,
    roles: ['head', 'deco'],
    melee: { swing: 'overhead', weight: 'medium' },
    guns: ['rifle', 'lmg', 'shotgun'],
    fireMode: 'hitscan',
    ammo: 'power chords',
  },
  {
    kind: 'ukulele',
    group: 'music',
    noun: 'Ukulele',
    syn: ['ukulele', 'uke', 'small guitar', 'hawaiian', 'strings'],
    tags: ['music', 'wood', 'cute', 'light'],
    desc: 'little four string hawaiian ukulele',
    color: '#d39a5b',
    accent: '#5a3a22',
    variants: [
      { v: 'soprano', p: { style: 0, bl: 0.24, bw: 0.09, th: 0.06, nl: 0.2, nw: 0.035, hl: 0.08, ns: 4 } },
      { v: 'tenor', p: { style: 0, bl: 0.3, bw: 0.11, th: 0.07, nl: 0.26, nw: 0.038, hl: 0.09, ns: 4 }, desc: 'larger tenor ukulele' },
      { v: 'pineapple', p: { style: 5, bl: 0.26, bw: 0.1, th: 0.065, nl: 0.2, nw: 0.035, hl: 0.08, ns: 4 }, desc: 'oval pineapple body ukulele' },
    ],
    draw: drawStringed,
    head: stringHead,
    anchors: stringAnchors,
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['smg', 'pistol'],
    fireMode: 'hitscan',
    ammo: 'cheerful strums',
  },
  {
    kind: 'banjo',
    group: 'music',
    noun: 'Banjo',
    syn: ['banjo', 'bluegrass', 'country', 'strings', 'twang'],
    tags: ['music', 'wood', 'retro', 'silly'],
    desc: 'round drum bodied bluegrass banjo',
    color: '#a8743f',
    accent: '#f2efe8',
    variants: [
      { v: 'classic', p: { style: 3, bw: 0.17, th: 0.07, nl: 0.55, nw: 0.045, hl: 0.16, ns: 5 } },
      { v: 'tenor', p: { style: 3, bw: 0.14, th: 0.06, nl: 0.42, nw: 0.04, hl: 0.14, ns: 4 }, desc: 'compact four string tenor banjo' },
      { v: 'bluegrass', p: { style: 3, bw: 0.2, th: 0.1, nl: 0.6, nw: 0.048, hl: 0.17, ns: 5 }, desc: 'deep resonator bluegrass banjo' },
    ],
    draw: drawStringed,
    head: stringHead,
    anchors: stringAnchors,
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['shotgun', 'rifle'],
    fireMode: 'hitscan',
    ammo: 'twangy notes',
  },
  {
    kind: 'violin',
    group: 'music',
    noun: 'Violin',
    syn: ['violin', 'fiddle', 'viola', 'cello', 'strings', 'orchestra', 'classical'],
    tags: ['music', 'wood', 'classical'],
    desc: 'carved violin with scroll and f-holes',
    color: '#9b4a1c',
    accent: '#2d2f36',
    variants: [
      { v: 'fiddle', p: { style: 4, bl: 0.36, bw: 0.1, th: 0.05, nl: 0.22, nw: 0.03, hl: 0.1, ns: 4 }, desc: 'classic violin fiddle' },
      { v: 'viola', p: { style: 4, bl: 0.42, bw: 0.12, th: 0.056, nl: 0.25, nw: 0.032, hl: 0.11, ns: 4 }, desc: 'slightly larger viola', noun: 'Viola' },
      { v: 'cello', p: { style: 4, bl: 0.75, bw: 0.22, th: 0.12, nl: 0.4, nw: 0.045, hl: 0.18, ns: 4, pin: 0.15 }, desc: 'big cello with endpin spike', noun: 'Cello' },
    ],
    draw: drawStringed,
    head: stringHead,
    anchors: stringAnchors,
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['smg', 'sniper'],
    fireMode: 'hitscan',
    ammo: 'screeching notes',
  },
  {
    kind: 'trumpet',
    group: 'music',
    noun: 'Trumpet',
    syn: ['trumpet', 'horn', 'brass', 'cornet', 'flugelhorn', 'bugle', 'jazz', 'fanfare'],
    tags: ['music', 'brass', 'metal', 'jazz'],
    desc: 'brass trumpet with three valves',
    color: '#d8a634',
    accent: '#2d2f36',
    variants: [
      { v: 'classic', p: { L: 0.26, R: 0.06, flare: 2.6, lp: 0.1 } },
      { v: 'cornet', p: { L: 0.16, R: 0.05, flare: 2.4, lp: 0.06 }, desc: 'short compact brass cornet', noun: 'Cornet' },
      { v: 'flugel', p: { L: 0.26, R: 0.08, flare: 1.6, lp: 0.09 }, desc: 'wide belled mellow flugelhorn', noun: 'Flugelhorn' },
      { v: 'muted', p: { L: 0.26, R: 0.06, flare: 2.6, lp: 0.1, mute: 1 }, desc: 'jazz trumpet with cone mute' },
    ],
    draw: drawTrumpet,
    anchors(p) {
      const yb = 0.02;
      const zt = -0.06;
      const zm = zt - p.L;
      return {
        tip: p.mute ? [0, yb, zm - 0.025] : [0, yb, bellApex(zt, p.L)],
        rear: [0, -0.03, 0.05 + p.lp + 0.036],
        top: [0, 0.055, 0],
        grip: [0, -0.065, 0],
        under: [0, yb - bellR(0.007, p.R, p.flare, 0.6), zt - 0.6 * p.L],
        side: [0.011, 0, 0],
      };
    },
    roles: ['muzzle', 'barrel', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['shotgun', 'pistol', 'blowgun'],
    fireMode: 'hitscan',
    ammo: 'sound waves',
  },
  {
    kind: 'trombone',
    group: 'music',
    noun: 'Trombone',
    syn: ['trombone', 'slide', 'brass', 'horn', 'jazz', 'sad trombone'],
    tags: ['music', 'brass', 'metal', 'jazz', 'silly'],
    desc: 'brass slide trombone with big bell',
    color: '#d8a634',
    accent: '#2d2f36',
    variants: [
      { v: 'tenor', p: { bl: 0.34, R: 0.1, sl: 0.6, ext: 0 } },
      { v: 'extended', p: { bl: 0.34, R: 0.1, sl: 0.6, ext: 0.3 }, desc: 'trombone with slide fully extended' },
      { v: 'bass', p: { bl: 0.36, R: 0.12, sl: 0.62, ext: 0, loop: 1 }, desc: 'bass trombone with valve loop' },
    ],
    draw: drawTrombone,
    anchors(p) {
      const yb = 0.025 + p.R;
      const zf = -p.sl - p.ext;
      return {
        tip: [0, -0.025, zf - 0.025 - 0.0085],
        rear: [0, 0.01, 0.297],
        top: [0, yb + 0.007, 0.1],
        grip: [0, -0.056, 0.03],
        under: [0, -0.0585, zf + 0.06],
        side: [0.007, yb, 0.1],
      };
    },
    roles: ['barrel', 'muzzle', 'deco'],
    melee: { swing: 'overhead', weight: 'medium' },
    guns: ['shotgun', 'sniper', 'rocket_launcher'],
    fireMode: 'hitscan',
    ammo: 'sad trombone blasts',
  },
  {
    kind: 'saxophone',
    group: 'music',
    noun: 'Saxophone',
    syn: ['saxophone', 'sax', 'alto', 'tenor', 'soprano', 'jazz', 'smooth'],
    tags: ['music', 'brass', 'metal', 'jazz'],
    desc: 'curved brass saxophone, bell forward',
    color: '#d8a634',
    accent: '#2d2f36',
    variants: [
      { v: 'alto', p: { s: 1 } },
      { v: 'tenor', p: { s: 1.22, hump: 1 }, desc: 'big tenor sax with humped neck' },
      { v: 'soprano', p: { s: 1, straight: 1 }, desc: 'straight soprano saxophone' },
    ],
    draw: drawSax,
    anchors: saxAnchors,
    roles: ['muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['shotgun', 'bubble_gun', 'flamethrower'],
    fireMode: 'hitscan',
    ammo: 'smooth jazz',
  },
  {
    kind: 'tuba',
    group: 'music',
    noun: 'Tuba',
    syn: ['tuba', 'sousaphone', 'euphonium', 'brass', 'oompah', 'marching band'],
    tags: ['music', 'brass', 'metal', 'heavy', 'silly'],
    desc: 'huge coiled brass tuba, bell forward',
    color: '#d8a634',
    accent: '#2d2f36',
    variants: [
      { v: 'classic', p: { R: 0.22, bl: 0.45, cr: 0.14, by: 0.1 } },
      { v: 'euphonium', p: { R: 0.14, bl: 0.32, cr: 0.1, by: 0.07 }, desc: 'smaller euphonium', noun: 'Euphonium' },
      { v: 'sousaphone', p: { R: 0.3, bl: 0.5, cr: 0.26, by: 0.14, sousa: 1 }, desc: 'marching sousaphone with giant bell', noun: 'Sousaphone' },
    ],
    draw: drawTuba,
    anchors: tubaAnchors,
    roles: ['muzzle', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
    guns: ['rocket_launcher', 'shotgun'],
    fireMode: 'hitscan',
    ammo: 'oompah blasts',
  },
  {
    kind: 'flute',
    group: 'music',
    noun: 'Flute',
    syn: ['flute', 'piccolo', 'woodwind', 'pipe', 'orchestra', 'classical'],
    tags: ['music', 'metal', 'classical', 'light'],
    desc: 'silver concert flute with keys',
    color: '#c9ced6',
    accent: '#8a9099',
    variants: [
      { v: 'concert', p: { L: 0.67, r: 0.0095, nk: 6 } },
      { v: 'piccolo', p: { L: 0.32, r: 0.0075, nk: 4 }, desc: 'tiny shrill piccolo', noun: 'Piccolo' },
      { v: 'alto', p: { L: 0.85, r: 0.012, nk: 7, curve: 1 }, desc: 'long alto flute with curved head' },
    ],
    draw: drawFlute,
    anchors: fluteAnchors,
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
    guns: ['blowgun', 'sniper'],
    fireMode: 'projectile',
    ammo: 'high notes',
  },
  {
    kind: 'clarinet',
    group: 'music',
    noun: 'Clarinet',
    syn: ['clarinet', 'oboe', 'recorder', 'woodwind', 'reed', 'licorice stick'],
    tags: ['music', 'classical', 'jazz', 'plastic'],
    desc: 'black woodwind with flared bell',
    color: '#26262a',
    accent: '#c8ccd2',
    variants: [
      { v: 'classic', p: { L: 0.66, r: 0.0125, bellR: 0.033, sty: 0 }, desc: 'black clarinet with silver keys' },
      { v: 'oboe', p: { L: 0.62, r: 0.011, bellR: 0.02, sty: 1 }, desc: 'slim oboe with double reed', noun: 'Oboe' },
      { v: 'recorder', p: { L: 0.32, r: 0.011, bellR: 0.015, sty: 2 }, desc: 'school recorder with finger holes', noun: 'Recorder' },
    ],
    draw: drawClarinet,
    anchors: clarinetAnchors,
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
    guns: ['blowgun', 'sniper', 'rifle'],
    fireMode: 'projectile',
    ammo: 'squeaky notes',
  },
  {
    kind: 'snare-drum',
    group: 'music',
    noun: 'Drum',
    syn: ['drum', 'snare', 'tom', 'bongo', 'percussion', 'marching drum', 'beat'],
    tags: ['music', 'rock', 'metal'],
    desc: 'marching snare drum with chrome rims',
    color: '#c0392b',
    accent: '#f2efe8',
    variants: [
      { v: 'snare', p: { R: 0.17, h: 0.13, sty: 0 }, noun: 'Snare Drum' },
      { v: 'tom', p: { R: 0.16, h: 0.3, sty: 1 }, desc: 'tall floor tom drum', noun: 'Floor Tom' },
      { v: 'bongos', p: { R: 0.1, h: 0.16, sty: 2 }, desc: 'pair of wooden bongo drums', noun: 'Bongos' },
    ],
    draw(k, p) {
      drawDrumSet(k, p, -0.04);
      k.rod('dark', [0, 0, -0.045], [0, 0, 0.07], 0.012, 0.012, 6);
    },
    head(k, p) {
      drawDrumSet(k, p, -0.03);
      k.zrod('dark', -0.04, 0, 0.015, 0.015, 6);
    },
    anchors: drumAnchors,
    roles: ['head', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },
  {
    kind: 'drum-stick',
    group: 'music',
    noun: 'Drumstick',
    syn: ['drumstick', 'stick', 'mallet', 'brush', 'drum stick', 'percussion'],
    tags: ['music', 'wood', 'rock', 'light'],
    desc: 'hickory drumstick with bead tip',
    color: '#e3c28f',
    accent: '#d6453d',
    variants: [
      { v: 'rock', p: { L: 0.41, r: 0.0085, sty: 0 }, desc: 'thick rock drumstick' },
      { v: 'jazz', p: { L: 0.39, r: 0.0065, sty: 0 }, desc: 'thin jazz drumstick' },
      { v: 'mallet', p: { L: 0.37, r: 0.005, sty: 1 }, desc: 'felt headed timpani mallet', noun: 'Mallet' },
      { v: 'brush', p: { L: 0.33, r: 0.009, sty: 2 }, desc: 'wire jazz drum brush', noun: 'Drum Brush' },
    ],
    draw: drawStick,
    anchors: (p) => {
      const z1 = 0.12;
      const z0 = z1 - p.L;
      return {
        tip: [0, 0, z0],
        rear: [0, 0, z1],
        top: [0, p.r, z0 * 0.3],
        grip: [0, -p.r, 0.04],
        under: [0, -p.r, z0 * 0.5],
        side: [p.r, 0, z0 * 0.3],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'spin', weight: 'light' },
  },
  {
    kind: 'keytar',
    group: 'music',
    noun: 'Keytar',
    syn: ['keytar', 'synth', 'keyboard', 'synthesizer', 'eighties', 'piano'],
    tags: ['music', 'retro', 'plastic', 'rock', 'scifi'],
    desc: 'shoulder slung synth keytar',
    color: '#e8e4dc',
    accent: '#ff3d7f',
    variants: [
      { v: 'classic', p: { L: 0.62, w: 0.15, sty: 0, oct: 3, nl: 0.3 } },
      { v: 'retro', p: { L: 0.6, w: 0.17, sty: 1, oct: 3, nl: 0.26 }, desc: 'rounded eighties retro keytar' },
      { v: 'mini', p: { L: 0.42, w: 0.12, sty: 2, oct: 2, nl: 0.22 }, desc: 'compact two octave keytar' },
    ],
    draw: drawKeytar,
    anchors: keytarAnchors,
    roles: ['deco'],
    melee: { swing: 'overhead', weight: 'medium' },
    guns: ['lmg', 'rifle', 'smg'],
    fireMode: 'hitscan',
    ammo: 'synth lasers',
  },
  {
    kind: 'microphone',
    group: 'music',
    noun: 'Microphone',
    syn: ['microphone', 'mic', 'karaoke', 'singer', 'mic stand', 'vintage mic'],
    tags: ['music', 'metal', 'rock'],
    desc: 'handheld stage microphone',
    color: '#26262a',
    accent: '#9aa1ab',
    variants: [
      { v: 'handheld', p: { sty: 0 }, desc: 'corded handheld stage microphone' },
      { v: 'wireless', p: { sty: 1 }, desc: 'wireless mic with antenna' },
      { v: 'vintage', p: { sty: 2 }, desc: 'chrome vintage crooner microphone' },
      { v: 'stand', p: { sty: 3 }, desc: 'microphone on long stand pole', noun: 'Mic Stand' },
    ],
    draw: drawMic,
    anchors: micAnchors,
    roles: ['head', 'barrel', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol'],
    fireMode: 'hitscan',
    ammo: 'feedback screeches',
  },
  {
    kind: 'tambourine',
    group: 'music',
    noun: 'Tambourine',
    syn: ['tambourine', 'jingle', 'timbrel', 'percussion', 'half moon'],
    tags: ['music', 'wood', 'metal', 'party'],
    desc: 'jingling wooden tambourine',
    color: '#b5803f',
    accent: '#f2efe8',
    variants: [
      { v: 'classic', p: { R: 0.12, w: 0.05, nj: 5, sty: 0 }, desc: 'skin headed jingling tambourine' },
      { v: 'open', p: { R: 0.1, w: 0.045, nj: 8, sty: 1 }, desc: 'headless ring of jingles' },
      { v: 'moon', p: { R: 0.13, sty: 2 }, desc: 'half moon tambourine with grip' },
    ],
    draw: drawTambourine,
    anchors: tambourineAnchors,
    roles: ['head', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },
  {
    kind: 'maracas',
    group: 'music',
    noun: 'Maraca',
    syn: ['maraca', 'maracas', 'shaker', 'rattle', 'egg shaker', 'latin', 'fiesta'],
    tags: ['music', 'party', 'wood', 'silly'],
    desc: 'painted rattling maraca',
    color: '#e74c3c',
    accent: '#f1c40f',
    variants: [
      { v: 'classic', p: { br: 0.045, el: 1, hl: 0.12, sty: 0 } },
      { v: 'long', p: { br: 0.04, el: 1.5, hl: 0.16, sty: 0 }, desc: 'long oval maraca' },
      { v: 'egg', p: { br: 0.025, el: 1.3, sty: 1 }, desc: 'handheld egg shaker', noun: 'Egg Shaker' },
    ],
    draw: (k, p) => drawMaraca(k, p),
    head: (k, p) => drawMaraca(k, p, true),
    anchors: maracaAnchors,
    roles: ['head', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['grenade_launcher'],
    fireMode: 'arc',
    ammo: 'rattling shakers',
  },
  {
    kind: 'megaphone',
    group: 'music',
    noun: 'Megaphone',
    syn: ['megaphone', 'bullhorn', 'loudspeaker', 'loudhailer', 'cheer', 'siren'],
    tags: ['music', 'plastic', 'silly'],
    desc: 'pistol gripped megaphone cone',
    color: '#f2efe8',
    accent: '#d6453d',
    variants: [
      { v: 'classic', p: { L: 0.32, R: 0.12, r0: 0.04 } },
      { v: 'big', p: { L: 0.42, R: 0.17, r0: 0.05, big: 1 }, desc: 'huge bullhorn with siren light', noun: 'Bullhorn' },
      { v: 'compact', p: { L: 0.2, R: 0.08, r0: 0.035 }, desc: 'small compact megaphone' },
    ],
    draw: drawMegaphone,
    anchors: megAnchors,
    roles: ['muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['shotgun', 'flamethrower'],
    selfGrip: true,
    fireMode: 'hitscan',
    ammo: 'sonic blasts',
  },
  {
    kind: 'boombox',
    group: 'music',
    noun: 'Boombox',
    syn: ['boombox', 'ghetto blaster', 'stereo', 'radio', 'cassette', 'speaker', 'ghettoblaster'],
    tags: ['music', 'retro', 'plastic', 'heavy', 'rock'],
    desc: 'eighties boombox with twin speakers',
    color: '#3b3f47',
    accent: '#c9ced6',
    variants: [
      { v: 'classic', p: { L: 0.5, H: 0.24, W: 0.12, ns: 2 } },
      { v: 'big', p: { L: 0.62, H: 0.34, W: 0.16, ns: 4 }, desc: 'huge four speaker boombox' },
      { v: 'mini', p: { L: 0.3, H: 0.16, W: 0.08, ns: 1 }, desc: 'small single speaker radio', noun: 'Radio' },
    ],
    draw: drawBoombox,
    anchors: boomAnchors,
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
    guns: ['shotgun', 'rocket_launcher', 'lmg'],
    fireMode: 'hitscan',
    ammo: 'sound waves',
  },
];
