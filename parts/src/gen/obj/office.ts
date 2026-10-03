/** OFFICE / SCHOOL objects. See objkit.ts for the canonical frame + roles. */
import type { Vec3 } from '../../types';
import type { Kit, Pt } from '../../lib/kit';
import { chamferRect, circlePts } from '../../lib/kit';
import type { ObjSpec, P } from './objkit';

const PI = Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
type Slot = Parameters<Kit['box']>[0];

/* ---------------- scissors helpers ---------------- */
const SC_ZP = -0.045;
/** rotate a local (x, zl) blade-frame point around the pivot by angle a (tip toward +x for a > 0) */
function scRot(x: number, zl: number, a: number): Pt {
  return [x * Math.cos(a) - zl * Math.sin(a), SC_ZP + x * Math.sin(a) + zl * Math.cos(a)];
}
function scRing(p: P, side: 1 | -1) {
  const a = (p.open / 2) * side;
  const big = side < 0 ? 1.2 : 1;
  const rg = p.ring * big;
  const [cx, cz] = scRot(-side * (rg * 0.9 + 0.004), 0.03 + rg, a);
  return { cx, cz, rg, elong: p.t === 1 && side < 0 ? 1.5 : 1 };
}

/* ---------------- globe helpers ---------------- */
const LAND: Vec3[] = [
  [0.5, 0.6, -0.62],
  [-0.7, 0.3, -0.4],
  [0.2, -0.8, 0.3],
  [-0.4, -0.4, 0.8],
  [0.9, 0.1, 0.4],
];
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

export const OFFICE: ObjSpec[] = [
  /* ================= STAPLER ================= */
  {
    kind: 'stapler',
    group: 'office',
    noun: 'Stapler',
    syn: ['stapler', 'staple gun', 'staples', 'desk stapler'],
    tags: ['office', 'school', 'metal', 'plastic'],
    desc: 'desk stapler',
    color: '#c42b2b',
    accent: '#2d2f36',
    variants: [
      { v: 'desk', p: { t: 0, L: 0.17, h: 0.055, w: 0.04 } },
      { v: 'heavy', p: { t: 1, L: 0.3, h: 0.1, w: 0.06 }, desc: 'heavy duty long reach stapler' },
      { v: 'mini', p: { t: 2, L: 0.1, h: 0.035, w: 0.03 }, desc: 'tiny pocket mini stapler' },
    ],
    draw(k, p) {
      const { L, h, w } = p;
      const zr = L * 0.35;
      const zt = -L * 0.65;
      k.box('accent', [w * 1.05, h * 0.18, L], { p: [0, -h + h * 0.09, (zt + zr) / 2] });
      k.box('metal', [w * 0.6, h * 0.05, L * 0.15], { p: [0, -h + h * 0.205, zt + L * 0.1] });
      k.box('accent', [w, h * 0.55, L * 0.12], { p: [0, -h * 0.6, zr - L * 0.06] });
      k.rod('metal', [-w * 0.55, -h * 0.4, zr - L * 0.07], [w * 0.55, -h * 0.4, zr - L * 0.07], h * 0.12, h * 0.12, 8);
      k.box('metal', [w * 0.8, h * 0.22, L * 0.82], { p: [0, -h * 0.42, zt + L * 0.45] });
      k.extrude(
        'main',
        [
          [zr, -h * 0.3],
          [zr, 0],
          [zt + L * 0.25, 0],
          [zt, -h * 0.15],
          [zt, -h * 0.38],
          [zr - L * 0.1, -h * 0.38],
        ],
        w,
        'zy',
      );
      if (p.t === 1) {
        k.box('rubber', [w * 0.9, h * 0.06, L * 0.4], { p: [0, h * 0.03, -L * 0.05] });
        k.box('metal', [w * 0.3, h * 0.25, L * 0.04], { p: [0, -h * 0.85, zt + L * 0.25] });
      } else if (p.t === 2) {
        k.zrod('main', zt - 0.004, zt + 0.01, h * 0.12, h * 0.15, 6, 0, -h * 0.27);
      } else {
        k.box('dark', [w * 1.07, h * 0.05, L * 0.95], { p: [0, -h - 0.001, (zt + zr) / 2] });
      }
    },
    anchors(p) {
      const { L, h, w } = p;
      const zr = L * 0.35;
      const zt = -L * 0.65;
      return {
        tip: [0, -h * 0.27, zt],
        rear: [0, -h * 0.15, zr],
        top: [0, 0, -L * 0.1],
        grip: [0, -h, 0],
        under: [0, -h, zt + L * 0.2],
        side: [w / 2, -h * 0.15, -L * 0.1],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['smg', 'pistol'],
    fireMode: 'projectile',
    ammo: 'staples',
  },

  /* ================= RULER ================= */
  {
    kind: 'ruler',
    group: 'office',
    noun: 'Ruler',
    syn: ['ruler', 'rule', 'yardstick', 'meter stick', 'measuring stick', 'straightedge'],
    tags: ['office', 'school', 'wood', 'light'],
    desc: 'wooden school ruler with tick marks',
    color: '#d8b06a',
    accent: '#c43b3b',
    variants: [
      { v: 'school', p: { t: 0, L: 0.3, w: 0.035, th: 0.004, ticks: 30 } },
      { v: 'steel', p: { t: 1, L: 0.5, w: 0.03, th: 0.0015, ticks: 20 }, desc: 'thin steel rule with hanging hole' },
      { v: 'meter', p: { t: 2, L: 1.0, w: 0.04, th: 0.006, ticks: 20 }, desc: 'long striped meter stick', noun: 'Meter Stick' },
    ],
    draw(k, p) {
      const { L, w, th, ticks } = p;
      const zr = 0.02;
      k.box('main', [w, th, L], { p: [0, 0, zr - L / 2] });
      for (let i = 0; i <= ticks; i++) {
        const z = zr - 0.01 - (i * (L - 0.02)) / ticks;
        const long = p.t === 2 ? i % 2 === 0 : i % 5 === 0;
        const len = long ? w * 0.42 : w * 0.22;
        k.box('dark', [len, 0.0008, p.t === 2 ? 0.003 : 0.0012], { p: [w / 2 - len / 2, th / 2 + 0.0002, z] });
      }
      if (p.t === 1) k.torus('dark', 0.004, 0.0012, { p: [-w * 0.15, th / 2, zr - 0.012], r: [PI / 2, 0, 0] }, 3, 8);
      if (p.t === 2) for (let i = 0; i < 5; i++) k.box('accent', [w + 0.0006, th + 0.0006, 0.1], { p: [0, 0, zr - 0.15 - i * 0.2] });
    },
    anchors(p) {
      const { L, w, th } = p;
      const zr = 0.02;
      return { tip: [0, 0, zr - L], rear: [0, 0, zr], top: [0, th / 2, zr - L / 2], grip: [0, -th / 2, 0], under: [0, -th / 2, zr - L * 0.6], side: [w / 2, 0, zr - L / 2] };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
  },

  /* ================= PENCIL ================= */
  {
    kind: 'pencil',
    group: 'office',
    noun: 'Pencil',
    syn: ['pencil', 'graphite', 'lead', 'number two', 'hb'],
    tags: ['office', 'school', 'wood', 'light'],
    desc: 'sharpened yellow pencil with eraser',
    color: '#f2c12e',
    accent: '#e98aa0',
    variants: [
      { v: 'classic', p: { t: 0, L: 0.19, r: 0.0045, e: 1, band: 0 } },
      { v: 'golf', p: { t: 0, L: 0.09, r: 0.0042, e: 0, band: 0 }, desc: 'stubby golf pencil without eraser' },
      { v: 'jumbo', p: { t: 0, L: 0.45, r: 0.022, e: 1, band: 1 }, desc: 'giant novelty jumbo pencil' },
      { v: 'carpenter', p: { t: 1, L: 0.18, r: 0.005, e: 0, band: 0 }, desc: 'flat carpenter pencil with chisel tip' },
    ],
    draw(k, p) {
      const { L, r } = p;
      const zr = L * 0.3;
      const zt = -L * 0.7;
      if (p.t === 1) {
        const w = r * 2.6;
        const hh = r * 1.3;
        k.box('main', [w, hh, zr - (zt + 0.03)], { p: [0, 0, (zr + zt + 0.03) / 2] });
        k.extrude(
          '#e7c08a',
          [
            [zt + 0.03, -hh / 2],
            [zt + 0.03, hh / 2],
            [zt + 0.002, 0.0008],
            [zt + 0.002, -0.0008],
          ],
          w,
          'zy',
        );
        k.box('dark', [w * 0.4, 0.0016, 0.004], { p: [0, 0, zt + 0.002] });
        k.box('dark', [w * 0.4, hh + 0.0004, 0.002], { p: [0, 0, zr - 0.0005] });
        return;
      }
      const tl = r * 4.5;
      const fe = r * 2.2;
      const er = r * 2;
      const zEnd = p.e ? zr - fe - er : zr;
      k.zrod('main', zt + tl, zEnd, r, r, 6);
      k.zrod('#e7c08a', zt + tl * 0.3, zt + tl, r * 0.3, r, 6);
      k.zrod('dark', zt, zt + tl * 0.3, 0.0002, r * 0.3, 6);
      if (p.e) {
        k.zrod('metal', zr - fe - er, zr - er, r * 1.08, r * 1.08, 8);
        k.zrod('accent', zr - er, zr, r, r * 0.95, 8);
        if (p.band) for (const f of [0.25, 0.75]) k.zrod('brass', zr - er - fe * f - r * 0.15, zr - er - fe * f + r * 0.15, r * 1.12, r * 1.12, 8);
      } else {
        k.zrod('#e7c08a', zr, zr + 0.0005, r * 0.95, r * 0.95, 6);
      }
      if (p.band) k.box('dark', [r * 0.6, 0.001, L * 0.25], { p: [0, r * 0.99, (zt + zr) / 2] });
    },
    anchors(p) {
      const { L, r } = p;
      const zr = L * 0.3;
      const zt = -L * 0.7;
      if (p.t === 1) {
        const zm = (zr + zt) / 2;
        return { tip: [0, 0, zt + 0.002], rear: [0, 0, zr], top: [0, r * 0.65, zm], grip: [0, -r * 0.65, zr - L * 0.25], under: [0, -r * 0.65, zt + 0.04], side: [r * 1.3, 0, zm] };
      }
      const tl = r * 4.5;
      const zEnd = p.e ? zr - r * 4.2 : zr;
      const zm = (zt + tl + zEnd) / 2;
      return {
        tip: [0, 0, zt],
        rear: [0, 0, zr],
        top: [0, r, zm],
        grip: [0, -r, Math.min(zr - L * 0.25, zEnd - 0.002)],
        under: [0, -r, zt + tl + Math.min(0.01, L * 0.1)],
        side: [r * 0.866, 0, zm],
      };
    },
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
    guns: ['blowgun', 'sniper'],
    ammo: 'pencils',
  },

  /* ================= PEN ================= */
  {
    kind: 'pen',
    group: 'office',
    noun: 'Pen',
    syn: ['pen', 'ballpoint', 'biro', 'fountain pen', 'highlighter', 'marker'],
    tags: ['office', 'school', 'plastic', 'light'],
    desc: 'click ballpoint pen with clip',
    color: '#2456a6',
    accent: '#ffe14d',
    variants: [
      { v: 'click', p: { t: 0, L: 0.14, r: 0.0055 } },
      { v: 'fountain', p: { t: 1, L: 0.15, r: 0.0068 }, desc: 'fountain pen with gold nib', noun: 'Fountain Pen' },
      { v: 'highlighter', p: { t: 2, L: 0.13, r: 0.01 }, desc: 'fat highlighter with chisel tip', noun: 'Highlighter' },
    ],
    draw(k, p) {
      const { L, r } = p;
      const zr = L * 0.35;
      const zt = -L * 0.65;
      if (p.t === 0) {
        k.zrod('main', zt + 0.025, zr - 0.012, r, r, 10);
        k.zrod('rubber', zt + 0.012, zt + 0.042, r * 1.08, r * 1.08, 10);
        k.zrod('metal', zt + 0.002, zt + 0.012, r * 0.25, r * 0.9, 8);
        k.zrod('metal', zt, zt + 0.003, 0.0006, r * 0.25, 6);
        k.zrod('metal', zr - 0.012, zr, r * 0.5, r * 0.5, 8);
        k.box('metal', [0.003, 0.003, 0.045], { p: [0, r + 0.0015, zr - 0.04] });
        k.box('metal', [0.004, 0.004, 0.006], { p: [0, r + 0.0005, zr - 0.016] });
        return;
      }
      if (p.t === 1) {
        k.zrod('main', zt + 0.03, zr - 0.04, r, r * 1.05, 10);
        k.zrod('dark', zt + 0.012, zt + 0.03, r * 0.75, r * 0.95, 10);
        k.extrude(
          'brass',
          [
            [0, zt],
            [0.004, zt + 0.008],
            [0.0048, zt + 0.016],
            [-0.0048, zt + 0.016],
            [-0.004, zt + 0.008],
          ],
          0.0012,
          'xz',
        );
        k.zrod('main', zr - 0.055, zr - 0.004, r * 1.15, r * 1.15, 10);
        k.zrod('main', zr - 0.004, zr, r * 1.15, r * 0.7, 10);
        k.zrod('brass', zr - 0.058, zr - 0.052, r * 1.22, r * 1.22, 10);
        k.zrod('brass', zt + 0.028, zt + 0.032, r * 1.08, r * 1.08, 10);
        k.box('brass', [0.003, 0.003, 0.04], { p: [0, r * 1.15 + 0.0015, zr - 0.025] });
        return;
      }
      k.extrude('main', chamferRect(-r * 1.2, -r, r * 1.2, r, r * 0.4), zr - 0.04 - (zt + 0.03), 'xy', { p: [0, 0, (zr - 0.04 + zt + 0.03) / 2] });
      k.extrude('accent', chamferRect(-r * 1.3, -r * 1.1, r * 1.3, r * 1.1, r * 0.4), 0.048, 'xy', { p: [0, 0, zr - 0.024] });
      k.box('accent', [0.004, 0.003, 0.035], { p: [0, r * 1.1 + 0.0015, zr - 0.024] });
      k.zrod('accent', zt + 0.012, zt + 0.03, r * 0.55, r * 0.8, 8);
      k.extrude(
        'accent',
        [
          [zt + 0.013, -0.003],
          [zt + 0.013, 0.003],
          [zt, 0.003],
          [zt + 0.004, -0.003],
        ],
        0.005,
        'zy',
      );
    },
    anchors(p) {
      const { L, r } = p;
      const zr = L * 0.35;
      const zt = -L * 0.65;
      const zm = (zt + zr) / 2;
      const rr = p.t === 2 ? r : r;
      return {
        tip: [0, 0, p.t === 2 ? zt + 0.002 : zt],
        rear: [0, 0, zr],
        top: [0, rr, zm],
        grip: [0, -rr, zr - L * 0.4],
        under: [0, -rr, zt + 0.045],
        side: [p.t === 2 ? r * 1.2 : r, 0, zm],
      };
    },
    roles: ['barrel', 'blade', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
    guns: ['blowgun', 'pistol'],
    ammo: 'ink',
  },

  /* ================= SCISSORS ================= */
  {
    kind: 'scissors',
    group: 'office',
    noun: 'Scissors',
    syn: ['scissors', 'shears', 'snips', 'cutter', 'clippers'],
    tags: ['office', 'school', 'metal', 'light'],
    desc: 'office scissors with plastic finger loops',
    color: '#d94a3a',
    accent: '#d94a3a',
    variants: [
      { v: 'office', p: { t: 0, Lb: 0.11, open: 0.13, ring: 0.02 } },
      { v: 'shears', p: { t: 1, Lb: 0.17, open: 0.08, ring: 0.022 }, desc: 'long tailor shears', noun: 'Shears' },
      { v: 'safety', p: { t: 2, Lb: 0.065, open: 0.22, ring: 0.018 }, desc: 'round tip kids safety scissors' },
    ],
    draw(k, p) {
      const { Lb } = p;
      const a = p.open / 2;
      const local: Pt[] =
        p.t === 2
          ? [
              [-0.002, 0.012],
              [0.009, 0.006],
              [0.0085, -Lb * 0.8],
              [0.006, -Lb],
              [-0.0015, -Lb],
            ]
          : [
              [-0.002, 0.012],
              [0.009, 0.006],
              [0.0085, -Lb * 0.4],
              [0.001, -Lb],
              [-0.002, -Lb * 0.96],
            ];
      for (const side of [1, -1] as const) {
        const pts = local.map(([x, z]) => scRot(side * x, z, a * side));
        if (side < 0) pts.reverse();
        k.blade('metal', pts, 0.003, 'xz', { p: [0, side * 0.0018, 0] });
        const ring = scRing(p, side);
        const hs: Slot = p.t === 1 ? 'main' : 'accent';
        const [sx, sz] = scRot(-side * 0.002, 0.012, a * side);
        const [ex, ez] = [ring.cx + side * ring.rg * 0.5, ring.cz - ring.rg * ring.elong * 0.8];
        k.rod(hs, [sx, side * 0.0018, sz], [ex, side * 0.0018, ez], 0.005, 0.006, 5);
        k.torus(hs, ring.rg, ring.rg * 0.28, { p: [ring.cx, side * 0.0018, ring.cz], r: [PI / 2, 0, 0], s: [1, ring.elong, 1] }, 4, 10);
      }
      k.rod('metal', [0, -0.005, SC_ZP], [0, 0.005, SC_ZP], 0.004, 0.004, 8);
    },
    anchors(p) {
      const { Lb } = p;
      const a = p.open / 2;
      const r2 = scRing(p, -1);
      const [ux, uz] = scRot(-0.004, -Lb * 0.4, -a);
      const [sx, sz] = scRot(0.0095, -Lb * 0.4, a);
      return {
        tip: [0, 0, SC_ZP - Lb * Math.cos(a) * 0.88],
        rear: [r2.cx, 0, r2.cz + r2.rg * r2.elong + r2.rg * 0.25],
        top: [0, 0.005, SC_ZP],
        grip: [0, -0.005, SC_ZP],
        under: [ux, -0.0035, uz],
        side: [sx, 0.002, sz],
      };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
  },

  /* ================= CALCULATOR ================= */
  {
    kind: 'calculator',
    group: 'office',
    noun: 'Calculator',
    syn: ['calculator', 'calc', 'adding machine', 'scientific calculator', 'maths'],
    tags: ['office', 'school', 'tech', 'plastic', 'retro'],
    desc: 'desk calculator with lcd display',
    color: '#3b3d45',
    accent: '#f08a24',
    variants: [
      { v: 'desk', p: { t: 0, L: 0.17, w: 0.12, th: 0.025, rows: 5, cols: 4 } },
      { v: 'pocket', p: { t: 1, L: 0.11, w: 0.065, th: 0.008, rows: 5, cols: 4 }, desc: 'thin pocket calculator' },
      { v: 'scientific', p: { t: 2, L: 0.17, w: 0.08, th: 0.016, rows: 7, cols: 5 }, desc: 'scientific graphing calculator' },
    ],
    draw(k, p) {
      const { L, w, th, rows, cols } = p;
      const zr = 0.02;
      const zt = zr - L;
      k.extrude('main', chamferRect(-w / 2, -th / 2, w / 2, th / 2, Math.min(th * 0.3, 0.004)), L, 'xy', { p: [0, 0, (zt + zr) / 2] });
      const yt = th / 2;
      const dl = p.t === 2 ? L * 0.26 : L * 0.17;
      const dz = zt + 0.008 + dl / 2;
      k.box('#9fb08a', [w * 0.8, 0.002, dl], { p: [0, yt + 0.001, dz] });
      k.box('dark', [w * 0.5, 0.001, dl * 0.3], { p: [w * 0.1, yt + 0.0022, dz] });
      if (p.t === 0) k.box('#3a2a2a', [w * 0.35, 0.002, L * 0.05], { p: [w * 0.2, yt + 0.001, zt + 0.008 + dl + 0.012] });
      const a0 = zt + 0.016 + dl + (p.t === 0 ? 0.02 : 0.006);
      const a1 = zr - 0.01;
      const cw = (w * 0.86) / cols;
      const rz = (a1 - a0) / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const slot: Slot = c === cols - 1 ? 'accent' : p.t === 2 && r < 2 ? 'metal' : 'white';
          k.box(slot, [cw * 0.72, Math.max(th * 0.12, 0.002), rz * 0.66], { p: [-w * 0.43 + (c + 0.5) * cw, yt, a0 + (r + 0.5) * rz] });
        }
    },
    anchors(p) {
      const { L, w, th } = p;
      const zr = 0.02;
      const zt = zr - L;
      return { tip: [0, 0, zt], rear: [0, 0, zr], top: [0, th / 2, (zt + zr) / 2], grip: [0, -th / 2, 0], under: [0, -th / 2, zt + L * 0.3], side: [w / 2, 0, (zt + zr) / 2] };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol'],
    ammo: 'numbers',
  },

  /* ================= GLOBE ================= */
  {
    kind: 'globe',
    group: 'office',
    noun: 'Globe',
    syn: ['globe', 'world', 'earth', 'planet', 'geography', 'map'],
    tags: ['office', 'school', 'retro', 'ornate'],
    desc: 'desk globe on brass meridian stand',
    color: '#3b78c2',
    accent: '#5fae4b',
    variants: [
      { v: 'classic', p: { t: 0, Rg: 0.12, hc: 0.12 } },
      { v: 'antique', p: { t: 1, Rg: 0.15, hc: 0.36 }, desc: 'antique floor globe on wooden tripod' },
      { v: 'mini', p: { t: 2, Rg: 0.06, hc: 0.05 }, desc: 'small souvenir globe on a post' },
    ],
    draw(k, p) {
      const { Rg, hc } = p;
      const Ra = Rg + 0.012;
      const zc = p.t === 0 ? -(hc + Ra) : p.t === 1 ? -hc : -(hc + Rg);
      k.sphere('main', Rg, { p: [0, 0, zc], r: [PI / 2, 0, 0] }, p.t === 1 ? 8 : 10, p.t === 1 ? 6 : 7);
      const nl = p.t === 1 ? 4 : 5;
      for (let i = 0; i < nl; i++) {
        const d = norm(LAND[i]);
        k.ball('accent', Rg * 0.33, [d[0] * Rg * 0.72, d[1] * Rg * 0.72, zc + d[2] * Rg * 0.72], 0);
      }
      if (p.t === 0) {
        k.zrod('wood', -0.02, 0, 0.09, 0.1, 10);
        k.zrod('brass', -hc, -0.02, 0.012, 0.016, 8);
        k.torus('brass', Ra, 0.005, { p: [0, 0, zc], r: [PI / 2, 0, -PI / 2] }, 3, 10, PI);
        k.zrod('brass', zc - Ra, zc - Rg + 0.004, 0.004, 0.004, 4);
      } else if (p.t === 1) {
        const hr = Rg + 0.03;
        k.torus('wood', hr, 0.012, { p: [0, 0, zc] }, 3, 12);
        k.torus('brass', Ra, 0.005, { p: [0, 0, zc], r: [PI / 2, 0, 0] }, 3, 12);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * 2 * PI;
          k.rod('wood', [Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0], [Math.cos(a) * hr, Math.sin(a) * hr, zc], 0.012, 0.014, 5);
        }
      } else {
        k.box('wood', [0.08, 0.08, 0.02], { p: [0, 0, -0.01] });
        k.zrod('brass', zc + Rg - 0.005, -0.02, 0.006, 0.008, 6);
        k.zrod('brass', zc - Rg - 0.008, zc - Rg + 0.004, 0.004, 0.004, 4);
      }
    },
    anchors(p) {
      const { Rg, hc } = p;
      const Ra = Rg + 0.012;
      if (p.t === 0) {
        const zc = -(hc + Ra);
        return { mag: [0, -0.095, -0.01], tip: [0, 0, zc - Ra], rear: [0, 0, 0], top: [0, Rg, zc], grip: [0, -0.095, -0.01], under: [0, -Rg, zc], side: [Rg, 0, zc] };
      }
      if (p.t === 1) {
        const zc = -hc;
        const hr = Rg + 0.03;
        return {
          tip: [0, 0, zc - Ra],
          rear: [0.2, 0, 0],
          top: [0, Rg, zc],
          grip: [lerp(0.2, hr, 0.12), 0, zc * 0.12],
          mag: [lerp(0.2, hr, 0.12), 0, zc * 0.12],
          under: [0, -Rg, zc],
          side: [Rg, 0, zc],
        };
      }
      const zc = -(hc + Rg);
      return { tip: [0, 0, zc - Rg - 0.008], rear: [0, 0, 0], top: [0, Rg, zc], grip: [0, -0.04, -0.01], under: [0, -Rg, zc], side: [Rg, 0, zc] };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'overhead', weight: 'medium' },
    guns: ['grenade_launcher'],
  },

  /* ================= TAPE DISPENSER ================= */
  {
    kind: 'tape-dispenser',
    group: 'office',
    noun: 'Tape Dispenser',
    syn: ['tape', 'tape dispenser', 'sellotape', 'scotch tape', 'tape gun', 'packing tape'],
    tags: ['office', 'school', 'plastic', 'heavy'],
    desc: 'weighted desk tape dispenser',
    color: '#2d2f36',
    accent: '#e8d6a0',
    variants: [
      { v: 'desk', p: { t: 0 } },
      { v: 'mini', p: { t: 1 }, desc: 'clear handheld mini tape dispenser' },
      { v: 'packing', p: { t: 2 }, desc: 'packing tape gun with pistol handle', noun: 'Tape Gun' },
    ],
    draw(k, p) {
      const tape = '#d8cfa8';
      if (p.t === 0) {
        k.extrude(
          'main',
          [
            [0.08, -0.07],
            [-0.12, -0.07],
            [-0.13, -0.045],
            [-0.118, -0.022],
            [-0.07, -0.035],
            [0.08, -0.035],
          ],
          0.065,
          'zy',
        );
        for (const s of [-1, 1]) k.extrude('main', circlePts(0.048, 10, 0.02, -0.005), 0.006, 'zy', { p: [s * 0.031, 0, 0] });
        k.rod(tape, [-0.024, -0.005, 0.02], [0.024, -0.005, 0.02], 0.04, 0.04, 12);
        k.rod('accent', [-0.026, -0.005, 0.02], [0.026, -0.005, 0.02], 0.022, 0.022, 10);
        const ang = Math.asin(-0.013 / 0.096);
        k.box(tape, [0.045, 0.001, 0.096], { p: [0, -0.0115, -0.0675], r: [ang, 0, 0] });
        k.box('metal', [0.05, 0.012, 0.004], { p: [0, -0.018, -0.12] });
        return;
      }
      if (p.t === 1) {
        const clear = '#bfe3f0';
        k.rod(tape, [-0.009, 0, 0], [0.009, 0, 0], 0.03, 0.03, 10);
        k.rod('accent', [-0.01, 0, 0], [0.01, 0, 0], 0.016, 0.016, 8);
        for (const s of [-1, 1]) k.torus(clear, 0.034, 0.005, { p: [s * 0.012, 0, 0], r: [0, PI / 2, 0] }, 3, 12, 1.6 * PI);
        k.box(clear, [0.03, 0.012, 0.03], { p: [0, -0.03, -0.035] });
        k.box('metal', [0.03, 0.004, 0.012], { p: [0, -0.022, -0.045] });
        k.box(clear, [0.024, 0.012, 0.045], { p: [0, -0.03, 0.035] });
        return;
      }
      const frame: Pt[] = [
        [0.04, 0.0],
        [0.04, 0.06],
        [0.0, 0.12],
        [-0.05, 0.08],
        [-0.11, 0.03],
        [-0.11, -0.01],
        [-0.02, -0.01],
      ];
      for (const s of [-1, 1]) k.extrude('main', frame, 0.006, 'zy', { p: [s * 0.034, 0, 0] });
      k.rod(tape, [-0.03, 0.065, 0], [0.03, 0.065, 0], 0.055, 0.055, 12);
      k.rod('accent', [-0.032, 0.065, 0], [0.032, 0.065, 0], 0.03, 0.03, 10);
      k.rod('metal', [-0.037, 0.065, 0], [0.037, 0.065, 0], 0.008, 0.008, 6);
      k.box('main', [0.03, 0.11, 0.035], { p: [0, -0.055, 0.012], r: [0.18, 0, 0] });
      k.rod('rubber', [-0.03, 0.0, -0.1], [0.03, 0.0, -0.1], 0.012, 0.012, 8);
      k.box('metal', [0.07, 0.004, 0.012], { p: [0, 0.03, -0.106] });
      const tdy = 0.012 - 0.065;
      const tdz = -0.1 + 0.055;
      k.box(tape, [0.058, 0.001, Math.hypot(tdy, tdz)], { p: [0, (0.065 + 0.012) / 2, (-0.055 - 0.1) / 2], r: [Math.atan2(tdy, -tdz), 0, 0] });
    },
    anchors(p) {
      if (p.t === 0) return { tip: [0, -0.018, -0.122], rear: [0, -0.05, 0.08], top: [0, 0.035, 0.02], grip: [0, -0.07, 0.02], under: [0, -0.07, -0.08], side: [0.0325, -0.05, 0.0] };
      if (p.t === 1) return { tip: [0, -0.022, -0.051], rear: [0, -0.03, 0.0575], top: [0, 0.039, 0], grip: [0, -0.036, 0.04], under: [0, -0.036, -0.035], side: [0.017, 0.034, 0] };
      return { mag: [0, -0.055, 0.012], tip: [0, 0, -0.112], rear: [0, 0.065, 0.055], top: [0, 0.12, 0], grip: [0, -0.105, 0.025], under: [0, -0.012, -0.1], side: [0.037, 0.04, 0] };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['smg', 'pistol'],
    fireMode: 'projectile',
    ammo: 'sticky tape',
  },

  /* ================= LAPTOP ================= */
  {
    kind: 'laptop',
    group: 'office',
    noun: 'Laptop',
    syn: ['laptop', 'notebook', 'computer', 'thinkpad', 'macbook', 'pc'],
    tags: ['office', 'tech', 'modern'],
    desc: 'open laptop with glowing screen',
    color: '#b9bcc4',
    accent: '#5ad1ff',
    variants: [
      { v: 'open', p: { t: 0, W: 0.33, D: 0.23, tb: 0.016, ts: 0.007, beta: 0.3 } },
      { v: 'closed', p: { t: 1, W: 0.31, D: 0.21, tb: 0.011, ts: 0.006, beta: 0 }, desc: 'closed thin laptop slab' },
      { v: 'retro', p: { t: 2, W: 0.3, D: 0.24, tb: 0.034, ts: 0.014, beta: 0.15 }, desc: 'chunky retro laptop with trackpoint' },
    ],
    draw(k, p) {
      const { W, D, tb, ts, beta } = p;
      k.box('main', [W, tb, D], { p: [0, tb / 2, -D / 2] });
      if (p.t === 1) {
        k.box('main', [W, ts, D], { p: [0, tb + ts / 2, -D / 2] });
        k.box('dark', [W + 0.001, 0.003, D + 0.001], { p: [0, tb, -D / 2] });
        k.box('glow', [0.03, 0.001, 0.03], { p: [0, tb + ts + 0.0005, -D / 2] });
        k.box('dark', [0.04, 0.004, 0.004], { p: [0, tb, 0.0] });
        return;
      }
      k.box('dark', [W * 0.86, 0.002, D * 0.44], { p: [0, tb + 0.001, -D * 0.64] });
      for (let i = 1; i < 5; i++) k.box('#5a5d66', [W * 0.86, 0.0024, 0.0015], { p: [0, tb + 0.001, -D * 0.42 - i * D * 0.088] });
      if (p.t === 2) {
        k.ball('#d62828', 0.004, [0, tb + 0.003, -D * 0.5], 0);
        for (let i = 0; i < 3; i++) k.box('#4a4d55', [0.028, 0.003, 0.012], { p: [(i - 1) * 0.032, tb + 0.0015, -D * 0.38] });
        k.box('#4a4d55', [W * 0.22, 0.0015, D * 0.18], { p: [0, tb + 0.00075, -D * 0.18] });
      } else {
        k.box('#4a4d55', [W * 0.32, 0.0015, D * 0.26], { p: [0, tb + 0.00075, -D * 0.19] });
      }
      const dir: Vec3 = [0, Math.cos(beta), -Math.sin(beta)];
      const n: Vec3 = [0, Math.sin(beta), Math.cos(beta)];
      const hz = -D + ts / 2;
      const c: Vec3 = [0, tb + dir[1] * (D / 2), hz + dir[2] * (D / 2)];
      k.box('main', [W, D, ts], { p: c, r: [-beta, 0, 0] });
      const off = ts / 2 + 0.0006;
      k.box('#3d6fb0', [W * 0.88, D * 0.84, 0.001], { p: [0, c[1] + n[1] * off + dir[1] * 0.005, c[2] + n[2] * off + dir[2] * 0.005], r: [-beta, 0, 0] });
      k.box('glow', [0.03, 0.03, 0.001], { p: [0, c[1] - n[1] * off, c[2] - n[2] * off], r: [-beta, 0, 0] });
      k.rod('dark', [-W * 0.4, tb, hz], [W * 0.4, tb, hz], ts * 0.7, ts * 0.7, 6);
    },
    anchors(p) {
      const { W, D, tb, ts, beta } = p;
      const side: Vec3 = [W / 2, tb / 2, -D / 2];
      if (p.t === 1) return { tip: [0, (tb + ts) / 2, -D], rear: [0, tb / 2, 0], top: [0, tb + ts, -D / 2], grip: [0, 0, -0.04], under: [0, 0, -D * 0.8], side };
      return {
        tip: [0, tb + D * Math.cos(beta), -D + ts / 2 - D * Math.sin(beta)],
        rear: [0, tb / 2, 0],
        top: [0, tb, -D * 0.3],
        grip: [0, 0, -0.04],
        under: [0, 0, -D * 0.8],
        side,
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['smg'],
    ammo: 'pop-up ads',
  },

  /* ================= BRIEFCASE ================= */
  {
    kind: 'briefcase',
    group: 'office',
    noun: 'Briefcase',
    syn: ['briefcase', 'attache case', 'case', 'doctor bag', 'luggage', 'suitcase'],
    tags: ['office', 'heavy', 'retro'],
    desc: 'leather briefcase held by handle',
    color: '#6b3f22',
    accent: '#3a2414',
    variants: [
      { v: 'leather', p: { t: 0, Wc: 0.44, Hc: 0.32, T: 0.1 } },
      { v: 'attache', p: { t: 1, Wc: 0.46, Hc: 0.34, T: 0.11 }, desc: 'ribbed aluminium attache case', noun: 'Attache Case' },
      { v: 'doctor', p: { t: 2, Wc: 0.4, Hc: 0.26, T: 0.18 }, desc: 'fat doctor bag with brass frame', noun: 'Doctor Bag' },
    ],
    draw(k, p) {
      const { Wc, Hc, T } = p;
      const yc = -0.035 - Hc / 2;
      const yt = -0.035;
      k.zrod('accent', -0.055, 0.055, 0.012, 0.012, 8);
      for (const s of [-1, 1]) {
        k.rod('accent', [0, 0, s * 0.055], [0, yt, s * 0.07], 0.01, 0.008, 6);
        k.box('brass', [0.02, 0.008, 0.02], { p: [0, yt + 0.002, s * 0.07] });
      }
      if (p.t === 2) {
        k.extrude(
          'main',
          [
            [Wc / 2, yt - Hc],
            [-Wc / 2, yt - Hc],
            [-Wc / 2 + 0.04, yt],
            [Wc / 2 - 0.04, yt],
          ],
          T,
          'zy',
          undefined,
          0.01,
        );
        k.box('brass', [0.016, 0.014, Wc - 0.06], { p: [0, yt + 0.008, 0] });
        k.box('brass', [0.03, 0.03, 0.03], { p: [0, yt + 0.01, 0] });
        for (const s of [-1, 1]) k.box('accent', [T + 0.024, 0.02, 0.03], { p: [0, yc + 0.02, s * Wc * 0.3] });
        return;
      }
      k.box(p.t === 1 ? 'metal' : 'main', [T, Hc, Wc], { p: [0, yc, 0] });
      for (const s of [-1, 1]) k.box('brass', [0.008, 0.03, 0.035], { p: [T / 2 + 0.002, yt - 0.03, s * 0.13] });
      for (const s of [-1, 1]) for (const x of [-1, 1]) k.ball('brass', 0.01, [x * T * 0.3, yt - Hc, s * (Wc / 2 - 0.03)], 0);
      if (p.t === 0) {
        k.box('dark', [T + 0.003, 0.004, Wc + 0.003], { p: [0, yt - 0.06, 0] });
        k.box('accent', [T + 0.002, Hc * 0.4, 0.004], { p: [0, yc - Hc * 0.1, -Wc / 2] });
      } else {
        k.box('dark', [0.004, Hc + 0.002, Wc + 0.002], { p: [0, yc, 0] });
        for (const s of [-1, 1]) for (const f of [-0.25, 0.25]) k.box('metal', [0.008, 0.012, Wc - 0.03], { p: [s * (T / 2 + 0.003), yc + f * Hc, 0] });
        for (const s of [-1, 1]) for (const y of [yt - 0.015, yt - Hc + 0.015]) k.box('metal', [T + 0.008, 0.032, 0.032], { p: [0, y, s * (Wc / 2 - 0.013)] });
        k.box('accent', [0.006, 0.014, 0.04], { p: [T / 2 + 0.003, yt - 0.03, 0] });
      }
    },
    anchors(p) {
      const { Wc, Hc, T } = p;
      const yc = -0.035 - Hc / 2;
      const yb = -0.035 - Hc;
      if (p.t === 2)
        return { tip: [0, yc, -(Wc / 2 - 0.02)], rear: [0, yc, Wc / 2 - 0.02], top: [0, 0.012, 0], grip: [0, yb - 0.01, 0], under: [0, yb - 0.01, -Wc * 0.25], side: [T / 2 + 0.01, yc, 0] };
      return { tip: [0, yc, -Wc / 2], rear: [0, yc, Wc / 2], top: [0, 0.012, 0], grip: [0, yb, 0], under: [0, yb, -Wc * 0.25], side: [T / 2, yc, 0] };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
    guns: ['smg', 'lmg'],
  },

  /* ================= DESK FAN ================= */
  {
    kind: 'desk-fan',
    group: 'office',
    noun: 'Desk Fan',
    syn: ['fan', 'desk fan', 'electric fan', 'box fan', 'blower', 'cooling'],
    tags: ['office', 'household', 'metal', 'retro'],
    desc: 'oscillating desk fan with wire cage',
    color: '#e8e6df',
    accent: '#5aa9e6',
    variants: [
      { v: 'desk', p: { t: 0, R: 0.12, yh: 0.07 } },
      { v: 'box', p: { t: 1, R: 0.18, yh: -0.2 }, desc: 'square box fan with carry handle', noun: 'Box Fan' },
      { v: 'retro', p: { t: 2, R: 0.13, yh: 0.075 }, desc: 'art deco brass blade fan' },
    ],
    draw(k, p) {
      const { R, yh } = p;
      const blade = (slot: Slot, n: number, s: number, z: number) => {
        const pts: Pt[] = (
          [
            [0.015, -0.012],
            [0.06, -0.035],
            [0.1, -0.03],
            [0.11, 0],
            [0.09, 0.03],
            [0.04, 0.025],
            [0.015, 0.01],
          ] as Pt[]
        ).map(([x, y]) => [x * s, y * s] as Pt);
        for (let i = 0; i < n; i++) k.extrude(slot, pts, 0.004, 'xy', { p: [0, yh, z], r: [0, 0, (i / n) * 2 * PI] });
      };
      if (p.t === 1) {
        const S = R * 2;
        for (const s of [-1, 1]) {
          k.box('main', [S, 0.025, 0.08], { p: [0, yh + s * (S / 2), 0] });
          k.box('main', [0.025, S, 0.08], { p: [s * (S / 2), yh, 0] });
        }
        for (let j = -2; j <= 2; j++) k.box('metal', [S - 0.02, 0.004, 0.004], { p: [0, yh + (j * S) / 6, -0.035] });
        k.box('metal', [0.004, S - 0.02, 0.004], { p: [0, yh, -0.035] });
        blade('accent', 4, 1.45, -0.01);
        k.zrod('dark', -0.02, 0.035, 0.04, 0.04, 8, 0, yh);
        k.box('dark', [0.1, 0.015, 0.03], { p: [0, 0, 0] });
        k.box('dark', [0.03, 0.012, 0.02], { p: [S * 0.35, yh + S / 2 + 0.016, 0.02] });
        return;
      }
      const cage: Slot = p.t === 2 ? 'brass' : 'metal';
      const zf = -0.085;
      const zrr = -0.035;
      k.zrod('main', -0.03, 0.06, 0.045, 0.035, 8, 0, yh);
      k.torus(cage, R, 0.004, { p: [0, yh, zrr] }, 3, 10);
      k.torus(cage, R * 0.96, 0.004, { p: [0, yh, zf] }, 3, 10);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * 2 * PI + PI / 4;
        k.rod(cage, [Math.cos(a) * R, yh + Math.sin(a) * R, zrr], [Math.cos(a) * R * 0.96, yh + Math.sin(a) * R * 0.96, zf], 0.0025, 0.0025, 3);
      }
      const ns = p.t === 2 ? 5 : 3;
      for (let i = 0; i < ns; i++) {
        const a = (i / ns) * (p.t === 2 ? 2 * PI : PI);
        if (p.t === 2) k.rod(cage, [0, yh, zf], [Math.cos(a) * R * 0.96, yh + Math.sin(a) * R * 0.96, zf], 0.002, 0.002, 3);
        else k.rod(cage, [Math.cos(a) * R * 0.96, yh + Math.sin(a) * R * 0.96, zf], [-Math.cos(a) * R * 0.96, yh - Math.sin(a) * R * 0.96, zf], 0.002, 0.002, 3);
      }
      k.zrod('accent', zf - 0.006, zf, 0.022, 0.022, 8, 0, yh);
      k.zrod('accent', -0.07, -0.03, 0.015, 0.015, 8, 0, yh);
      if (p.t === 2) blade('brass', 4, 1.0, -0.06);
      else blade('accent', 3, 0.95, -0.06);
      k.rod('main', [0, yh - 0.03, 0.0], [0, -0.16, 0.0], 0.012, 0.014, 8);
      k.rod(p.t === 2 ? 'main' : 'accent', [0, -0.18, 0.0], [0, -0.16, 0.0], 0.09, 0.1, 8);
      k.box('dark', [0.02, 0.008, 0.012], { p: [0.03, -0.157, -0.06] });
    },
    anchors(p) {
      const { R, yh } = p;
      if (p.t === 1) {
        const S = R * 2;
        return { tip: [0, yh, -0.037], rear: [0, yh, 0.04], top: [0, 0.0075, 0], grip: [0, yh - S / 2 - 0.0125, 0], under: [0, yh - S / 2 - 0.0125, -0.03], side: [S / 2 + 0.0125, yh, 0] };
      }
      return { tip: [0, yh, -0.091], rear: [0, yh, 0.06], top: [0, yh + R, -0.035], grip: [0, -0.18, 0.0], under: [0, yh - R, -0.035], side: [R, yh, -0.035] };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['bubble_gun', 'smg'],
    fireMode: 'stream',
    ammo: 'wind',
  },
];
