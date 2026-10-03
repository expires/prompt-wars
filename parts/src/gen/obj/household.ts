/** HOUSEHOLD objects. See objkit.ts for the canonical frame + roles. */
import type { Vec3 } from '../../types';
import type { Kit, Pt } from '../../lib/kit';
import { chamferRect, rectPts } from '../../lib/kit';
import type { ObjSpec, P } from './objkit';

const PI = Math.PI;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ---------------- umbrella ---------------- */
function umbHook(hl: number): Vec3[] {
  return [
    [0, 0, hl - 0.01],
    [0, -0.004, hl + 0.03],
    [0, -0.035, hl + 0.058],
    [0, -0.07, hl + 0.042],
    [0, -0.08, hl + 0.01],
  ];
}

/* ---------------- broom ---------------- */
function broomHL(p: P) {
  return p.t === 2 ? 0.06 : p.bl;
}
function broomHead(k: Kit, p: P, zb: number) {
  const hl = broomHL(p);
  const zt = zb - hl;
  if (p.t === 2) {
    const zc = zt + 0.03;
    k.box('wood', [p.w, 0.05, 0.06], { p: [0, 0, zc] });
    k.box('main', [p.w - 0.01, p.bl, 0.045], { p: [0, -0.025 - p.bl / 2, zc] });
    k.zrod('metal', zc + 0.03, zc + 0.09, 0.017, 0.016, 6);
    k.rod('metal', [0.13, 0.02, zc + 0.02], [0, 0.01, zc + 0.15], 0.005, 0.005, 4);
    k.rod('metal', [-0.13, 0.02, zc + 0.02], [0, 0.01, zc + 0.15], 0.005, 0.005, 4);
    return;
  }
  const top = 0.045;
  const T = 0.035;
  k.zrod('accent', zb - 0.015, zb + 0.04, 0.019, 0.015, 6);
  k.extrude(
    'main',
    [
      [-top, zb],
      [-p.w / 2, zt],
      [p.w / 2, zt + p.c],
      [top, zb],
    ],
    T,
    'xz',
  );
  for (const f of [0.18, 0.32]) {
    const z = zb - hl * f;
    const wz = lerp(top * 2, p.w, f) + 0.006;
    k.box('accent', [wz, T + 0.006, 0.012], { p: [0, 0, z] });
  }
}

/* ---------------- mop ---------------- */
function mopHead(k: Kit, p: P, zb: number) {
  const zt = zb - p.hl;
  if (p.t === 0) {
    k.zrod('accent', zb - 0.05, zb, 0.03, 0.018, 8);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 2 * PI + 0.3;
      const s = 0.07 + 0.015 * Math.sin(i * 2.3);
      k.rod('main', [Math.cos(a) * 0.02, Math.sin(a) * 0.02, zb - 0.04], [Math.cos(a) * s, Math.sin(a) * s, zt + 0.025 * Math.abs(Math.sin(i * 1.7))], 0.013, 0.01, 4);
    }
    k.rod('main', [0, 0, zb - 0.04], [0, 0, zt], 0.014, 0.011, 4);
  } else if (p.t === 1) {
    k.zrod('metal', zb - 0.03, zb, 0.016, 0.014, 6);
    k.box('metal', [p.w + 0.02, 0.02, 0.03], { p: [0, 0, zb - 0.045] });
    k.box('main', [p.w, 0.05, 0.06], { p: [0, 0, zt + 0.03] });
    k.rod('accent', [p.w / 2, 0.03, zb - 0.04], [0.02, 0.03, zb + 0.25], 0.006, 0.006, 4);
    k.rod('accent', [-p.w / 2, 0.03, zb - 0.04], [-0.02, 0.03, zb + 0.25], 0.006, 0.006, 4);
    k.box('accent', [0.05, 0.015, 0.03], { p: [0, 0.03, zb + 0.25] });
  } else {
    k.rod('metal', [0, 0, zb], [0, -0.02, zt + 0.065], 0.012, 0.012, 6);
    k.ball('metal', 0.018, [0, -0.02, zt + 0.065], 0);
    k.box('accent', [p.w, 0.02, 0.11], { p: [0, -0.03, zt + 0.065] });
    k.box('main', [p.w + 0.01, 0.025, 0.13], { p: [0, -0.05, zt + 0.065] });
  }
}

/* ---------------- plunger ---------------- */
function plungerProf(p: P, zr: number): Pt[] {
  const R = p.R;
  const d = p.d;
  if (p.t === 1)
    return [
      [0.0001, zr + 0.012],
      [R * 0.33, zr],
      [R * 0.4, zr + 0.03],
      [R * 0.9, zr + 0.034],
      [R, zr + 0.045],
      [R * 1.05, zr + d * 0.5],
      [R * 0.6, zr + d * 0.95],
      [0.016, zr + d],
      [0.0001, zr + d],
    ];
  if (p.t === 2) {
    const pts: Pt[] = [
      [0.0001, zr + 0.02],
      [R * 0.85, zr],
      [R * 0.95, zr + 0.006],
    ];
    for (let i = 1; i <= 5; i++) pts.push([i % 2 ? R * 0.72 : R, zr + 0.006 + ((d - 0.006) * i) / 5]);
    pts.push([0.016, zr + d + 0.008], [0.0001, zr + d + 0.008]);
    return pts;
  }
  return [
    [0.0001, zr + 0.02],
    [R * 0.9, zr],
    [R, zr + 0.006],
    [R * 0.94, zr + d * 0.5],
    [R * 0.55, zr + d * 0.92],
    [0.016, zr + d],
    [0.0001, zr + d],
  ];
}
function plungerTip(p: P, zr: number): number {
  return p.t === 1 ? zr + 0.012 : zr + 0.02;
}
function plungerBulge(p: P, zr: number): [number, number] {
  if (p.t === 1) return [p.R * 1.05, zr + p.d * 0.5];
  if (p.t === 2) return [p.R, zr + 0.006 + (p.d - 0.006) * 0.4];
  return [p.R * 0.94, zr + p.d * 0.5];
}

/* ---------------- toilet brush ---------------- */
function tbLen(p: P) {
  return p.t === 0 ? p.R * 2.2 + 0.02 : p.t === 1 ? 0.11 : p.R * 2 + 0.06;
}
/** draws the brush head with its most -Z point at zt; returns z where the handle starts */
function tbHead(k: Kit, p: P, zt: number): number {
  const R = p.R;
  if (p.t === 0) {
    k.ball('white', 1, [0, 0, zt + R * 1.1], 1, [R, R, R * 1.1]);
    k.zrod('accent', zt + R * 2.1, zt + R * 2.2 + 0.02, 0.018, 0.012, 8);
    return zt + R * 2.2 + 0.02;
  }
  if (p.t === 1) {
    k.zrod('white', zt + 0.015, zt + 0.11, R, R, 10);
    k.zrod('white', zt, zt + 0.015, R * 0.55, R, 10);
    k.zrod('accent', zt + 0.105, zt + 0.125, 0.016, 0.012, 8);
    return zt + 0.11;
  }
  const zh = zt + R * 2 + 0.06;
  k.ball('white', 1, [0, -0.05, zt + R], 1, [R, R * 0.8, R]);
  k.rod('white', [0, -0.05 - R * 0.5, zt + R * 0.8], [0, -0.05 - R * 1.2, zt + R * 0.3], R * 0.45, R * 0.25, 6);
  k.tube('main', [[0, 0, zh], [0, -0.012, zh - 0.03], [0, -0.04, zh - 0.05], [0, -0.05, zt + R + 0.01]], 0.01, 6, 5);
  return zh;
}

/* ---------------- desk lamp ---------------- */
function lampShade(k: Kit, ys: number, zo: number, Rs: number, len: number) {
  const prof: Pt[] = [
    [Rs, zo],
    [Rs * 0.8, zo + len * 0.5],
    [Rs * 0.35, zo + len * 0.9],
    [0.015, zo + len],
  ];
  k.zlathe('main', prof, 12, [0, ys, 0]);
  k.zlathe(
    'main',
    prof.map(([r, z]) => [r * 0.95, z + 0.003] as Pt).reverse(),
    12,
    [0, ys, 0],
  );
  k.ball('glow', Rs * 0.42, [0, ys, zo + Rs * 0.42 + 0.004], 1);
}

/* ---------------- telephone handset ---------------- */
function handset(k: Kit) {
  k.zrod('main', -0.07, 0.07, 0.015, 0.015, 6);
  for (const s of [-1, 1]) {
    k.rod('main', [0, 0, s * 0.07], [0, -0.025, s * 0.095], 0.015, 0.017, 6);
    k.rod('main', [0, -0.02, s * 0.1], [0, -0.05, s * 0.1], 0.022, 0.03, 8);
    k.rod('dark', [0, -0.05, s * 0.1], [0, -0.052, s * 0.1], 0.024, 0.024, 8);
  }
}

/* ---------------- keyboard ---------------- */
function kbTop(p: P, x: number): number {
  // retro: wedge (thicker at -X); others flat
  if (p.t === 1) return lerp(p.th / 2, p.th * 0.1, (x + p.d / 2) / p.d) - 0.0;
  return p.th / 2;
}
function kbBlocks(p: P): [number, number][] {
  const zs = -0.012;
  const ze = -p.L + 0.03;
  if (p.t === 0) {
    const zsplit = -p.L * 0.74;
    return [
      [zs, zsplit],
      [zsplit - 0.014, ze],
    ];
  }
  return [[zs, ze]];
}

export const HOUSEHOLD: ObjSpec[] = [
  /* ================= UMBRELLA ================= */
  {
    kind: 'umbrella',
    group: 'household',
    noun: 'Umbrella',
    syn: ['umbrella', 'brolly', 'parasol', 'rain', 'canopy', 'bumbershoot'],
    tags: ['household', 'light', 'silly', 'plastic'],
    desc: 'furled umbrella with hooked handle',
    color: '#2b3a67',
    accent: '#4a2e1a',
    variants: [
      { v: 'classic', p: { L: 0.9, r: 0.034, hook: 1, open: 0, hl: 0.07, R: 0 } },
      { v: 'compact', p: { L: 0.55, r: 0.03, hook: 0, open: 0, hl: 0.1, R: 0 }, desc: 'short folding compact umbrella' },
      { v: 'golf', p: { L: 1.05, r: 0.047, hook: 0, open: 0, hl: 0.17, R: 0 }, desc: 'long golf umbrella with straight grip', noun: 'Golf Umbrella' },
      { v: 'open', p: { L: 0.85, r: 0.034, hook: 1, open: 1, hl: 0.07, R: 0.5 }, desc: 'open umbrella dome shield', noun: 'Open Umbrella' },
    ],
    draw(k, p) {
      const tz = -p.L;
      k.zrod('accent', -0.03, p.hl, 0.015, 0.017, 8);
      if (p.hook) k.tube('accent', umbHook(p.hl), 0.014, 8, 6);
      else k.zrod('accent', p.hl, p.hl + 0.015, 0.017, 0.011, 8);
      k.zrod('metal', tz + 0.03, -0.03, 0.006, 0.006, 6);
      k.zrod('metal', tz, tz + 0.04, 0.003, 0.008, 6);
      if (!p.open) {
        const z0 = tz + 0.05;
        const z1 = -0.18;
        const len = z1 - z0;
        k.zlathe(
          'main',
          [
            [0.008, z0],
            [p.r * 0.55, z0 + len * 0.25],
            [p.r, z0 + len * 0.7],
            [p.r * 0.8, z0 + len * 0.88],
            [0.012, z1],
          ],
          8,
        );
        k.zrod('accent', z0 + len * 0.5, z0 + len * 0.56, p.r * 0.82 + 0.003, p.r * 0.87 + 0.003, 8);
        k.ball('accent', 0.006, [0, p.r * 0.85 + 0.004, z0 + len * 0.53], 0);
      } else {
        const zA = tz + 0.06;
        const h = p.R * 0.42;
        const prof: Pt[] = [
          [0.012, zA],
          [p.R * 0.45, zA + h * 0.2],
          [p.R * 0.8, zA + h * 0.6],
          [p.R, zA + h],
        ];
        k.zlathe('main', prof, 8);
        k.zlathe('main', prof.map(([r, z]) => [r * 0.985, z + 0.006] as Pt).reverse(), 8);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 2 * PI;
          const sx = Math.sin(a);
          const sy = -Math.cos(a);
          k.rod('metal', [sx * p.R * 0.62, sy * p.R * 0.62, zA + h * 0.42], [0, 0, zA + h + 0.14], 0.003, 0.003, 3);
        }
        k.zrod('metal', zA + h + 0.12, zA + h + 0.16, 0.012, 0.01, 6);
      }
    },
    anchors(p) {
      const tz = -p.L;
      const rear: Vec3 = p.hook ? [0, -0.035, p.hl + 0.07] : [0, 0, p.hl + 0.015];
      const grip: Vec3 = [0, -0.0155, 0.02];
      if (p.open) {
        const zA = tz + 0.06;
        const h = p.R * 0.42;
        return { tip: [0, 0, tz], rear, top: [0, p.R, zA + h], grip, under: [0, -0.006, -0.25], side: [p.R, 0, zA + h] };
      }
      const z0 = tz + 0.05;
      const z7 = z0 + (-0.18 - z0) * 0.7;
      return { tip: [0, 0, tz], rear, top: [0, p.r, z7], grip, under: [0, -p.r, z7], side: [p.r, 0, z7] };
    },
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
    guns: ['shotgun', 'rifle', 'sniper'],
  },

  /* ================= BROOM ================= */
  {
    kind: 'broom',
    group: 'household',
    noun: 'Broom',
    syn: ['broom', 'besom', 'sweeper', 'brush', 'witch'],
    tags: ['household', 'cleaning', 'wood', 'silly'],
    desc: 'straw broom on wooden stick',
    color: '#d9b25a',
    accent: '#b3262e',
    variants: [
      { v: 'corn', p: { L: 1.3, bl: 0.36, w: 0.32, c: 0, t: 0 } },
      { v: 'angled', p: { L: 1.25, bl: 0.26, w: 0.28, c: 0.08, t: 1 }, desc: 'angled plastic kitchen broom' },
      { v: 'push', p: { L: 1.35, bl: 0.08, w: 0.46, c: 0, t: 2 }, desc: 'wide push broom', noun: 'Push Broom' },
      { v: 'whisk', p: { L: 0.42, bl: 0.2, w: 0.16, c: 0, t: 0 }, desc: 'short whisk hand broom', noun: 'Whisk Broom' },
    ],
    draw(k, p) {
      const zb = -p.L + broomHL(p);
      k.zrod('wood', zb, 0.12, 0.014, 0.014, 6);
      k.zrod('accent', 0.1, 0.125, 0.016, 0.014, 6);
      broomHead(k, p, zb);
    },
    head(k, p) {
      k.zrod('wood', -0.13, 0, 0.014, 0.014, 6);
      broomHead(k, p, -0.12);
    },
    anchors(p) {
      const hl = broomHL(p);
      const zt = -p.L;
      const zb = zt + hl;
      const rear: Vec3 = [0, 0, 0.125];
      const grip: Vec3 = [0, -0.014, 0.04];
      const mag: Vec3 = [0, -0.014, -0.3];
      if (p.t === 2)
        return { mag, tip: [0, 0, zt], rear, top: [0, 0.025, zt + 0.03], grip, under: [0, -0.025 - p.bl, zt + 0.03], side: [p.w / 2, 0, zt + 0.03] };
      return {
        mag,
        tip: [0, 0, zt + p.c / 2],
        rear,
        top: [0, 0.0175, zt + hl * 0.5],
        grip,
        under: [0, -0.0175, zt + hl * 0.5],
        side: [(p.w / 2 + 0.045) / 2, 0, (zt + p.c + zb) / 2],
      };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'thrust', weight: 'medium' },
  },

  /* ================= MOP ================= */
  {
    kind: 'mop',
    group: 'household',
    noun: 'Mop',
    syn: ['mop', 'swab', 'cleaning', 'janitor'],
    tags: ['household', 'cleaning', 'silly', 'junk'],
    desc: 'floor mop on long handle',
    color: '#e8e4d6',
    accent: '#3a7bd5',
    variants: [
      { v: 'string', p: { L: 1.3, hl: 0.3, w: 0, t: 0 }, desc: 'shaggy string mop' },
      { v: 'sponge', p: { L: 1.25, hl: 0.1, w: 0.26, t: 1 }, desc: 'squeeze sponge mop with wringer', noun: 'Sponge Mop' },
      { v: 'flat', p: { L: 1.3, hl: 0.17, w: 0.42, t: 2 }, desc: 'flat microfiber swivel mop', noun: 'Flat Mop' },
    ],
    draw(k, p) {
      const zb = -p.L + p.hl;
      k.zrod('metal', zb, 0.1, 0.012, 0.012, 6);
      k.zrod('accent', 0.0, 0.11, 0.015, 0.015, 6);
      mopHead(k, p, zb);
    },
    head(k, p) {
      k.zrod('metal', -0.13, 0, 0.013, 0.013, 6);
      mopHead(k, p, -0.12);
    },
    anchors(p) {
      const zt = -p.L;
      const zb = zt + p.hl;
      const rear: Vec3 = [0, 0, 0.11];
      const grip: Vec3 = [0, -0.015, 0.04];
      const mag: Vec3 = [0, -0.012, -0.3];
      if (p.t === 0)
        return { mag, tip: [0, 0, zt], rear, top: [0, 0.025, zb - 0.025], grip, under: [0, -0.025, zb - 0.025], side: [0.025, 0, zb - 0.025] };
      if (p.t === 1)
        return { mag, tip: [0, 0, zt], rear, top: [0, 0.025, zt + 0.03], grip, under: [0, -0.025, zt + 0.03], side: [p.w / 2, 0, zt + 0.03] };
      return { mag, tip: [0, -0.05, zt], rear, top: [0, -0.02, zt + 0.065], grip, under: [0, -0.0625, zt + 0.065], side: [(p.w + 0.01) / 2, -0.05, zt + 0.065] };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'spin', weight: 'medium' },
  },

  /* ================= PLUNGER ================= */
  {
    kind: 'plunger',
    group: 'household',
    noun: 'Plunger',
    syn: ['plunger', 'plumber', 'toilet', 'suction', 'cup'],
    tags: ['household', 'bathroom', 'silly', 'junk'],
    desc: 'rubber cup plunger on wood handle',
    color: '#b3202a',
    accent: '#8a5a32',
    variants: [
      { v: 'sink', p: { L: 0.5, R: 0.065, d: 0.05, t: 0 }, desc: 'shallow sink plunger' },
      { v: 'flange', p: { L: 0.56, R: 0.07, d: 0.09, t: 1 }, desc: 'bulbous toilet flange plunger' },
      { v: 'bellows', p: { L: 0.56, R: 0.06, d: 0.12, t: 2 }, desc: 'accordion bellows plunger' },
    ],
    draw(k, p) {
      const zr = -p.L;
      k.zlathe('main', plungerProf(p, zr), 10);
      k.zrod('wood', zr + p.d, 0.1, 0.013, 0.013, 6);
      k.zrod('dark', 0.1, 0.11, 0.013, 0.009, 6);
    },
    head(k, p) {
      const zr = -(0.12 + p.d);
      k.zlathe('main', plungerProf(p, zr), 10);
      k.zrod('wood', zr + p.d, 0, 0.013, 0.013, 6);
    },
    anchors(p) {
      const zr = -p.L;
      const [rb, zbz] = plungerBulge(p, zr);
      return {
        mag: [0, -0.013, -0.15],
        tip: [0, 0, plungerTip(p, zr)],
        rear: [0, 0, 0.11],
        top: [0, rb, zbz],
        grip: [0, -0.013, 0.04],
        under: [0, -rb, zbz],
        side: [rb * 0.95, 0, zbz],
      };
    },
    roles: ['head', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['crossbow', 'grenade_launcher', 'blowgun'],
    fireMode: 'projectile',
    ammo: 'plungers',
  },

  /* ================= TOILET BRUSH ================= */
  {
    kind: 'toilet-brush',
    group: 'household',
    noun: 'Toilet Brush',
    syn: ['toilet brush', 'loo brush', 'bog brush', 'scrubber', 'bathroom'],
    tags: ['household', 'bathroom', 'cleaning', 'silly', 'plastic'],
    desc: 'plastic toilet brush with bristle head',
    color: '#e9eef2',
    accent: '#5fb0c9',
    variants: [
      { v: 'round', p: { L: 0.38, R: 0.045, t: 0 } },
      { v: 'bottle', p: { L: 0.4, R: 0.034, t: 1 }, desc: 'cylindrical bottle brush toilet brush' },
      { v: 'rim', p: { L: 0.4, R: 0.04, t: 2 }, desc: 'bent rim toilet brush' },
    ],
    draw(k, p) {
      const zh = tbHead(k, p, -p.L);
      k.zrod('accent', zh, 0.12, 0.01, 0.011, 6);
      k.ball('accent', 0.016, [0, 0, 0.12], 0);
    },
    head(k, p) {
      const zh = tbHead(k, p, -(tbLen(p) + 0.08));
      k.zrod('accent', zh, 0, 0.011, 0.011, 6);
    },
    anchors(p) {
      const zt = -p.L;
      const R = p.R;
      const rear: Vec3 = [0, 0, 0.134];
      const grip: Vec3 = [0, -0.01, 0.04];
      const mag: Vec3 = [0, -0.01, -0.1];
      if (p.t === 0) return { mag, tip: [0, 0, zt], rear, top: [0, R, zt + R * 1.1], grip, under: [0, -R, zt + R * 1.1], side: [R, 0, zt + R * 1.1] };
      if (p.t === 1) return { mag, tip: [0, 0, zt], rear, top: [0, R, zt + 0.06], grip, under: [0, -R, zt + 0.06], side: [R, 0, zt + 0.06] };
      return { mag, tip: [0, -0.05, zt], rear, top: [0, -0.05 + R * 0.8, zt + R], grip, under: [0, -0.05 - R * 0.8, zt + R], side: [R, -0.05, zt + R] };
    },
    roles: ['head', 'deco'],
    melee: { swing: 'thrust', weight: 'light' },
  },

  /* ================= DESK LAMP ================= */
  {
    kind: 'desk-lamp',
    group: 'household',
    noun: 'Desk Lamp',
    syn: ['lamp', 'desk lamp', 'anglepoise', 'light', 'reading lamp'],
    tags: ['household', 'office', 'metal', 'retro'],
    desc: 'adjustable desk lamp with glowing bulb',
    color: '#2f6f8f',
    accent: '#ffd36b',
    variants: [
      { v: 'anglepoise', p: { t: 0, Rb: 0.08, Rs: 0.075, ys: 0.06, zo: -0.5, len: 0.13 } },
      { v: 'gooseneck', p: { t: 1, Rb: 0.07, Rs: 0.045, ys: 0.11, zo: -0.4, len: 0.1 }, desc: 'flexible gooseneck desk lamp' },
      { v: 'banker', p: { t: 2, Rb: 0.075, Rs: 0.055, ys: 0.08, zo: -0.3, len: 0 }, desc: 'brass banker lamp with green shade', noun: 'Banker Lamp' },
    ],
    draw(k, p) {
      k.zrod(p.t === 2 ? 'brass' : 'main', 0, 0.025, p.Rb, p.Rb, 10);
      if (p.t === 0) {
        for (const x of [-0.012, 0.012]) {
          k.rod('metal', [x, 0, -0.005], [x, 0.12, -0.2], 0.006, 0.006, 5);
          k.rod('metal', [x, 0.12, -0.2], [x, p.ys, -0.38], 0.006, 0.006, 5);
        }
        k.rod('accent', [0, 0.01, -0.02], [0, 0.1, -0.17], 0.005, 0.005, 4);
        k.ball('main', 0.016, [0, 0.12, -0.2], 0);
        k.ball('main', 0.016, [0, 0.0, -0.005], 0);
        k.zrod('main', -0.385, -0.36, 0.02, 0.02, 6, 0, p.ys);
        lampShade(k, p.ys, p.zo, p.Rs, p.len);
      } else if (p.t === 1) {
        k.tube('metal', [[0, 0, -0.005], [0, 0.08, -0.1], [0, 0.11, -0.22], [0, p.ys, p.zo + p.len + 0.02]], 0.008, 10, 5);
        lampShade(k, p.ys, p.zo, p.Rs, p.len);
      } else {
        k.zrod('brass', -0.25, 0, 0.012, 0.014, 8);
        k.rod('brass', [0, 0, -0.25], [0, p.ys, -0.3], 0.008, 0.008, 6);
        k.rod('#2f7a4a', [-0.13, p.ys, -0.3], [0.13, p.ys, -0.3], p.Rs, p.Rs, 8);
        k.rod('brass', [-0.133, p.ys, -0.3], [0.133, p.ys, -0.3], 0.012, 0.012, 6);
        k.box('glow', [0.18, 0.012, 0.03], { p: [0, p.ys - p.Rs, -0.3] });
        k.rod('brass', [0.04, p.ys - p.Rs, -0.31], [0.04, p.ys - p.Rs - 0.05, -0.31], 0.002, 0.002, 3);
        k.ball('brass', 0.006, [0.04, p.ys - p.Rs - 0.05, -0.31], 0);
      }
    },
    anchors(p) {
      const rear: Vec3 = [0, 0, 0.025];
      const grip: Vec3 = [0, -p.Rb, 0.012];
      if (p.t === 2)
        return { mag: grip, tip: [0, p.ys, -0.3 - p.Rs], rear, top: [0, p.ys + p.Rs, -0.3], grip, under: [0, p.ys - p.Rs, -0.3], side: [0.13, p.ys, -0.3] };
      const zm = p.zo + p.len * 0.5;
      const rm = p.Rs * 0.8;
      return { mag: grip, tip: [0, p.ys, p.zo + 0.004], rear, top: [0, p.ys + rm, zm], grip, under: [0, p.ys - rm, zm], side: [rm, p.ys, zm] };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  /* ================= CHAIR ================= */
  {
    kind: 'chair',
    group: 'household',
    noun: 'Chair',
    syn: ['chair', 'seat', 'furniture', 'wrestling chair'],
    tags: ['household', 'furniture', 'heavy', 'wood', 'silly'],
    desc: 'chair swung by its backrest',
    color: '#9a6a3c',
    accent: '#7a2e2e',
    variants: [
      { v: 'wooden', p: { t: 0, H: 0.88, sh: 0.45, sd: 0.4, w: 0.42 }, desc: 'wooden kitchen chair with slatted back' },
      { v: 'folding', p: { t: 1, H: 0.8, sh: 0.44, sd: 0.38, w: 0.4 }, desc: 'metal folding chair', noun: 'Folding Chair' },
      { v: 'office', p: { t: 2, H: 1.0, sh: 0.48, sd: 0.45, w: 0.48 }, desc: 'swivel office chair on casters', noun: 'Office Chair' },
    ],
    draw(k, p) {
      const { H, sh, sd, w } = p;
      const N = (x: number, h: number, d: number): Vec3 => [x, -d, h - H];
      const nb = (slot: Parameters<Kit['box']>[0], s: Vec3, c: Vec3) => k.box(slot, [s[0], s[2], s[1]], { p: N(c[0], c[1], c[2]) });
      const lx = w / 2 - 0.02;
      if (p.t === 0) {
        for (const sx of [-1, 1]) {
          nb('main', [0.035, H, 0.035], [sx * lx, H / 2, 0.0175]);
          nb('main', [0.035, sh, 0.035], [sx * lx, sh / 2, sd - 0.0175]);
          nb('main', [0.02, 0.02, sd - 0.035], [sx * lx, 0.12, sd / 2]);
        }
        nb('main', [w - 0.05, 0.02, 0.02], [0, 0.12, sd - 0.0175]);
        nb('accent', [w, 0.03, sd], [0, sh + 0.015, sd / 2]);
        nb('main', [w - 0.02, 0.08, 0.025], [0, H - 0.04, 0.0125]);
        const sl = H - 0.08 - sh - 0.03;
        for (const x of [-0.08, 0, 0.08]) nb('main', [0.035, sl, 0.015], [x, sh + 0.03 + sl / 2, 0.0125]);
      } else if (p.t === 1) {
        for (const sx of [-1, 1]) {
          k.rod('metal', N(sx * lx, 0, -0.03), N(sx * lx, H, 0.01), 0.011, 0.011, 6);
          k.rod('metal', N(sx * lx, 0, sd), N(sx * lx, sh, sd - 0.03), 0.011, 0.011, 6);
          k.rod('metal', N(sx * lx, 0.18, -0.016), N(sx * lx, 0.18, sd - 0.01), 0.007, 0.007, 4);
          k.ball('rubber', 0.016, N(sx * lx, 0.0, -0.03), 0);
          k.ball('rubber', 0.016, N(sx * lx, 0.0, sd), 0);
        }
        nb('main', [w - 0.02, 0.015, sd], [0, sh, sd / 2]);
        nb('main', [w - 0.02, 0.14, 0.015], [0, H - 0.09, 0.005]);
      } else {
        nb('main', [w, 0.07, sd], [0, sh, sd / 2]);
        const bh = H - sh - 0.12;
        nb('main', [w - 0.04, bh, 0.07], [0, sh + 0.12 + bh / 2, 0.035]);
        nb('dark', [0.05, 0.16, 0.02], [0, sh + 0.08, 0.03]);
        for (const sx of [-1, 1]) {
          nb('dark', [0.03, 0.02, 0.22], [sx * (w / 2 + 0.015), sh + 0.21, sd / 2]);
          nb('dark', [0.025, 0.18, 0.03], [sx * (w / 2 + 0.015), sh + 0.11, sd / 2]);
        }
        k.rod('metal', N(0, sh - 0.035, sd / 2), N(0, 0.1, sd / 2), 0.022, 0.022, 8);
        k.rod('dark', N(0, 0.07, sd / 2), N(0, 0.11, sd / 2), 0.035, 0.035, 8);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * 2 * PI;
          const e = N(Math.cos(a) * 0.3, 0.06, sd / 2 + Math.sin(a) * 0.3);
          k.rod('dark', N(0, 0.09, sd / 2), e, 0.015, 0.012, 4);
          k.ball('rubber', 0.025, N(Math.cos(a) * 0.3, 0.03, sd / 2 + Math.sin(a) * 0.3), 0);
        }
      }
    },
    anchors(p) {
      const { H, sh, sd, w } = p;
      const lx = w / 2 - 0.02;
      if (p.t === 0)
        return {
          tip: [lx, -(sd - 0.0175), -H],
          rear: [0, -0.0125, 0],
          top: [0, 0, -0.04],
          grip: [0, -0.025, -0.04],
          mag: [0, -0.025, -0.04],
          under: [0, -sd, sh + 0.015 - H],
          side: [lx + 0.0175, -0.0175, -H / 2],
        };
      if (p.t === 1)
        return {
          tip: [lx, -sd, -H],
          rear: [0, -0.005, -0.02],
          top: [0, 0.0025, -0.09],
          grip: [0, -0.0125, -0.09],
          mag: [0, -0.0125, -0.09],
          under: [0, -sd, sh - H],
          side: [w / 2 - 0.01, -sd / 2, sh - H],
        };
      const bmid = sh + 0.12 + (H - sh - 0.12) / 2;
      return {
        tip: [0, -sd / 2, 0.07 - H],
        rear: [0, -0.035, 0],
        top: [0, 0, bmid - H],
        grip: [0, -0.07, -0.06],
        mag: [0, -0.07, -0.06],
        under: [0, -sd, sh - H],
        side: [w / 2, -sd / 2, sh - H],
      };
    },
    roles: ['deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
    decoSize: 0.08,
  },

  /* ================= STOOL ================= */
  {
    kind: 'stool',
    group: 'household',
    noun: 'Stool',
    syn: ['stool', 'bar stool', 'seat', 'furniture'],
    tags: ['household', 'furniture', 'heavy', 'wood'],
    desc: 'stool swung by its legs',
    color: '#8a5a32',
    accent: '#b3262e',
    variants: [
      { v: 'bar', p: { t: 0, sh: 0.72, R: 0.17 }, desc: 'tall bar stool with footrest ring', noun: 'Bar Stool' },
      { v: 'milking', p: { t: 1, sh: 0.28, R: 0.14 }, desc: 'three legged milking stool' },
      { v: 'kitchen', p: { t: 2, sh: 0.48, R: 0.165 }, desc: 'square wooden kitchen stool' },
    ],
    draw(k, p) {
      const { sh, R } = p;
      if (p.t === 2) {
        k.box('main', [R * 2, R * 2, 0.03], { p: [0, 0, -sh - 0.015] });
        for (const x of [-1, 1])
          for (const y of [-1, 1]) {
            k.box('main', [0.032, 0.032, sh], { p: [x * 0.14, y * 0.14, -sh / 2] });
          }
        for (const s of [-1, 1]) {
          k.box('main', [0.28, 0.02, 0.02], { p: [0, s * 0.14, -0.15] });
          k.box('main', [0.02, 0.28, 0.02], { p: [s * 0.14, 0, -0.2] });
        }
        return;
      }
      const n = p.t === 0 ? 4 : 3;
      const rf = p.t === 0 ? R * 1.15 : R * 1.3;
      const legSlot = p.t === 0 ? 'metal' : 'main';
      for (let i = 0; i < n; i++) {
        const a = PI / 4 + (i / n) * 2 * PI;
        k.rod(legSlot, [Math.cos(a) * rf, Math.sin(a) * rf, 0], [Math.cos(a) * R * 0.65, Math.sin(a) * R * 0.65, -sh], 0.013, 0.015, 6);
      }
      if (p.t === 0) {
        k.zrod('main', -(sh + 0.04), -sh, R, R, 12);
        k.zrod('accent', -(sh + 0.065), -(sh + 0.04), R * 0.95, R * 0.97, 12);
        const rr = lerp(rf, R * 0.65, 0.35);
        k.torus('metal', rr, 0.008, { p: [0, 0, -sh * 0.35] }, 4, 12);
      } else {
        k.zrod('main', -(sh + 0.04), -sh, R, R, 12);
      }
    },
    anchors(p) {
      const { sh, R } = p;
      if (p.t === 2)
        return {
          tip: [0, 0, -(sh + 0.03)],
          rear: [0.14, 0.14, 0],
          top: [0, R, -(sh + 0.015)],
          grip: [0.14, 0.14, -0.05],
          mag: [0.14, 0.14, -0.05],
          under: [0, -R, -(sh + 0.015)],
          side: [R, 0, -(sh + 0.015)],
        };
      const rf = p.t === 0 ? R * 1.15 : R * 1.3;
      const a = PI / 4;
      const foot: Vec3 = [Math.cos(a) * rf, Math.sin(a) * rf, 0];
      const top: Vec3 = [Math.cos(a) * R * 0.65, Math.sin(a) * R * 0.65, -sh];
      const st = p.t === 0 ? sh + 0.065 : sh + 0.04;
      return {
        tip: [0, 0, -st],
        rear: foot,
        top: [0, R, -(sh + 0.02)],
        grip: lerp3(foot, top, 0.08),
        mag: lerp3(foot, top, 0.08),
        under: [0, -R, -(sh + 0.02)],
        side: [R, 0, -(sh + 0.02)],
      };
    },
    roles: ['deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
  },

  /* ================= BOOK ================= */
  {
    kind: 'book',
    group: 'household',
    noun: 'Book',
    syn: ['book', 'tome', 'novel', 'hardback', 'paperback', 'spellbook', 'grimoire'],
    tags: ['household', 'school', 'office', 'retro'],
    desc: 'closed hardcover book',
    color: '#6b2a2a',
    accent: '#d9b44a',
    variants: [
      { v: 'hardcover', p: { t: 0, Hb: 0.24, W: 0.165, T: 0.032, ct: 0.003 } },
      { v: 'tome', p: { t: 1, Hb: 0.3, W: 0.21, T: 0.085, ct: 0.008 }, desc: 'thick ancient tome with brass clasp', noun: 'Tome' },
      { v: 'paperback', p: { t: 2, Hb: 0.18, W: 0.11, T: 0.02, ct: 0.0012 }, desc: 'thin paperback novel', noun: 'Paperback' },
    ],
    draw(k, p) {
      const { Hb, W, T, ct } = p;
      for (const s of [-1, 1]) k.box('main', [Hb, ct, W], { p: [0, s * (T / 2 - ct / 2), -W / 2] });
      const inset = p.t === 2 ? 0.0015 : 0.006;
      k.box('white', [Hb - (p.t === 2 ? 0.002 : 0.008), T - 2 * ct, W - inset], { p: [0, 0, -(W - inset) / 2] });
      if (p.t === 2) {
        k.box('main', [Hb, T, ct * 1.5], { p: [0, 0, ct * 0.75] });
        k.box('accent', [Hb * 0.7, 0.001, W * 0.35], { p: [0, T / 2 + 0.0005, -W * 0.3] });
        k.box('accent', [Hb * 0.4, 0.001, W * 0.15], { p: [0, T / 2 + 0.0005, -W * 0.7] });
        return;
      }
      k.rod('main', [-Hb / 2, 0, 0], [Hb / 2, 0, 0], T / 2, T / 2, 8);
      if (p.t === 0) {
        k.box('accent', [Hb * 0.6, 0.001, W * 0.4], { p: [0, T / 2 + 0.0005, -W * 0.45] });
        for (const x of [-Hb * 0.3, Hb * 0.3]) k.rod('accent', [x - 0.004, 0, 0], [x + 0.004, 0, 0], T / 2 + 0.001, T / 2 + 0.001, 8);
      } else {
        for (const x of [-Hb * 0.3, 0, Hb * 0.3]) k.rod('accent', [x - 0.007, 0, 0], [x + 0.007, 0, 0], T / 2 + 0.003, T / 2 + 0.003, 8);
        for (const x of [-1, 1]) k.box('brass', [0.035, T + 0.004, 0.035], { p: [x * (Hb / 2 - 0.0155), 0, -W + 0.0155] });
        k.box('brass', [0.03, T + 0.006, 0.05], { p: [0, 0, -W + 0.02] });
        k.ball('brass', 0.022, [0, T / 2, -W * 0.5], 0, [1, 0.25, 1]);
      }
    },
    anchors(p) {
      const { Hb, W, T, ct } = p;
      return {
        tip: [0, 0, -W],
        rear: [0, 0, p.t === 2 ? ct * 1.5 : T / 2],
        top: [0, T / 2, -W / 2],
        grip: [0, -T / 2, -0.03],
        under: [0, -T / 2, -W * 0.7],
        side: [Hb / 2, 0, -W / 2],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
  },

  /* ================= PILLOW ================= */
  {
    kind: 'pillow',
    group: 'household',
    noun: 'Pillow',
    syn: ['pillow', 'cushion', 'pillow fight', 'bed'],
    tags: ['household', 'silly', 'light', 'furniture'],
    desc: 'fluffy bed pillow',
    color: '#eae6f2',
    accent: '#c94f7c',
    variants: [
      { v: 'bed', p: { t: 0, W: 0.5, L: 0.34, T: 0.12 } },
      { v: 'cushion', p: { t: 1, W: 0.4, L: 0.4, T: 0.12 }, desc: 'square throw cushion with tassels', noun: 'Cushion' },
      { v: 'travel', p: { t: 2, R: 0.1, r: 0.045 }, desc: 'u shaped travel neck pillow', noun: 'Neck Pillow' },
    ],
    draw(k, p) {
      if (p.t === 2) {
        const zc = Math.SQRT1_2 * p.R;
        k.torus('main', p.R, p.r, { p: [0, 0, -zc], r: [PI / 2, 0, 0.75 * PI] }, 6, 12, 1.5 * PI);
        for (const s of [-1, 1]) k.ball('main', p.r * 0.98, [s * zc, 0, 0], 1);
        k.box('accent', [0.04, 0.01, 0.02], { p: [0, p.r * 0.95, -zc - p.R] });
        return;
      }
      const { W, L, T } = p;
      const b = T * 0.4;
      const hw = W / 2 - 0.8 * b;
      k.extrude('main', rectPts(-hw, -L + 0.8 * b, hw, -0.8 * b), T * 0.2, 'xz', undefined, b);
      const cz = -L / 2;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const cx = sx * (W / 2 - 0.02);
          const czz = cz + sz * (L / 2 - 0.02);
          if (p.t === 0) k.rod('main', [cx * 0.85, 0, cz + sz * (L / 2 - 0.05)], [sx * (W / 2 + 0.012), 0, cz + sz * (L / 2 + 0.012)], T * 0.22, 0.006, 5);
          else k.rod('accent', [cx, 0, czz], [sx * (W / 2 + 0.03), 0, cz + sz * (L / 2 + 0.03)], 0.004, 0.012, 5);
        }
      if (p.t === 1) {
        for (const s of [-1, 1]) k.ball('accent', 0.014, [0, s * T * 0.42, cz], 0);
      }
    },
    anchors(p) {
      if (p.t === 2) {
        const zc = Math.SQRT1_2 * p.R;
        const ex = zc;
        return {
          tip: [0, 0, -(zc + p.R + p.r)],
          rear: [ex, 0, p.r * 0.9],
          top: [0, p.r, -(zc + p.R)],
          grip: [ex, -p.r * 0.9, 0],
          mag: [ex, -p.r * 0.9, 0],
          under: [0, -p.r, -(zc + p.R)],
          side: [p.R + p.r, 0, -zc],
        };
      }
      const { W, L, T } = p;
      return { tip: [0, 0, -L], rear: [0, 0, 0], top: [0, T / 2, -L / 2], grip: [0, -T / 2, -0.06], under: [0, -T / 2, -L * 0.7], side: [W / 2, 0, -L / 2] };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },

  /* ================= ALARM CLOCK ================= */
  {
    kind: 'alarm-clock',
    group: 'household',
    noun: 'Alarm Clock',
    syn: ['clock', 'alarm', 'alarm clock', 'timer', 'wall clock', 'tick tock'],
    tags: ['household', 'retro', 'silly', 'metal'],
    desc: 'twin bell alarm clock',
    color: '#c43b3b',
    accent: '#f2c94c',
    variants: [
      { v: 'twinbell', p: { t: 0, R: 0.06, D: 0.045 } },
      { v: 'digital', p: { t: 1, w: 0.15, h: 0.08, D: 0.07 }, desc: 'digital alarm clock with glowing display' },
      { v: 'wall', p: { t: 2, R: 0.15, D: 0.04 }, desc: 'round wall clock', noun: 'Wall Clock' },
    ],
    draw(k, p) {
      if (p.t === 1) {
        const { w, h, D } = p;
        k.box('main', [w, h, D], { p: [0, 0, -D / 2] });
        k.box('dark', [w * 0.86, h * 0.72, 0.004], { p: [0, 0, -D - 0.001] });
        for (let i = 0; i < 4; i++) k.box('glow', [w * 0.13, h * 0.42, 0.002], { p: [-w * 0.3 + i * w * 0.2 + (i > 1 ? 0.006 : 0), 0, -D - 0.004] });
        k.box('glow', [0.004, 0.004, 0.002], { p: [0.003, h * 0.1, -D - 0.004] });
        k.box('glow', [0.004, 0.004, 0.002], { p: [0.003, -h * 0.1, -D - 0.004] });
        k.box('accent', [w * 0.45, 0.012, D * 0.4], { p: [0, h / 2 + 0.006, -D * 0.5] });
        for (const s of [-1, 1]) k.box('dark', [0.02, 0.01, D * 0.8], { p: [s * w * 0.35, -h / 2 - 0.005, -D / 2] });
        return;
      }
      const { R, D } = p;
      k.zrod('main', -D, 0, R, R, 12);
      k.zrod('white', -D - 0.003, -D, R * 0.86, R * 0.86, 12);
      k.torus('metal', R * 0.93, Math.max(R * 0.08, 0.005), { p: [0, 0, -D - 0.002] }, 3, 12);
      k.box('dark', [R * 0.06, R * 0.6, 0.003], { p: [0, R * 0.28, -D - 0.005] });
      k.box('dark', [R * 0.08, R * 0.42, 0.003], { p: [R * 0.15, -R * 0.12, -D - 0.006], r: [0, 0, 2.2] });
      k.ball('accent', R * 0.08, [0, 0, -D - 0.006], 0);
      if (p.t === 2) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * 2 * PI;
          const big = i % 3 === 0;
          k.box('dark', [R * 0.04, R * (big ? 0.14 : 0.08), 0.002], { p: [Math.sin(a) * R * 0.74, Math.cos(a) * R * 0.74, -D - 0.004], r: [0, 0, -a] });
        }
        k.zrod('dark', 0, 0.008, 0.012, 0.012, 6, 0, R * 0.75);
        return;
      }
      for (const s of [-1, 1]) {
        k.sphere('metal', R * 0.45, { p: [s * R * 0.55, R * 0.82, -D / 2], r: [0, 0, -s * 0.55] }, 8, 3, PI / 2);
        k.rod('metal', [s * R * 0.6, -R * 0.75, -D / 2], [s * R * 0.8, -R * 1.18, -D / 2], 0.005, 0.008, 5);
      }
      k.rod('metal', [0, R * 0.95, -D / 2], [0, R * 1.3, -D / 2], 0.004, 0.004, 4);
      k.box('metal', [R * 0.5, 0.008, 0.008], { p: [0, R * 1.3, -D / 2] });
      k.zrod('metal', 0, 0.012, 0.004, 0.004, 4);
      k.box('metal', [0.025, 0.012, 0.003], { p: [0, 0, 0.013] });
    },
    anchors(p) {
      if (p.t === 1) {
        const { w, h, D } = p;
        return { tip: [0, 0, -D - 0.004], rear: [0, 0, 0], top: [0, h / 2, -D * 0.2], grip: [0, -h / 2, -D / 2], under: [0, -h / 2, -D * 0.85], side: [w / 2, 0, -D / 2] };
      }
      const { R, D } = p;
      return { tip: [0, 0, -D - 0.003], rear: [0, 0, 0], top: [0, R, -D * 0.2], grip: [0, -R, -D / 2], under: [0, -R, -D * 0.85], side: [R, 0, -D / 2] };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['grenade_launcher'],
    ammo: 'ringing alarms',
  },

  /* ================= VACUUM ================= */
  {
    kind: 'vacuum',
    group: 'household',
    noun: 'Vacuum Cleaner',
    syn: ['vacuum', 'hoover', 'vacuum cleaner', 'dustbuster', 'suction', 'cleaner'],
    tags: ['household', 'cleaning', 'heavy', 'tech', 'plastic'],
    desc: 'upright vacuum cleaner',
    color: '#8e3fb5',
    accent: '#ffcc33',
    variants: [
      { v: 'upright', p: { t: 0 } },
      { v: 'stick', p: { t: 1 }, desc: 'cordless stick vacuum with cyclone bin' },
      { v: 'handheld', p: { t: 2 }, desc: 'handheld dustbuster vacuum', noun: 'Dustbuster' },
    ],
    draw(k, p) {
      if (p.t === 0) {
        k.box('accent', [0.03, 0.03, 0.1], { p: [0, 0, 0.03] });
        k.zrod('metal', -0.47, -0.02, 0.016, 0.016, 6);
        k.extrude('main', chamferRect(-0.13, -0.09, 0.13, 0.09, 0.035), 0.48, 'xy', { p: [0, 0, -0.7] });
        k.box('accent', [0.2, 0.006, 0.34], { p: [0, 0.09, -0.7] });
        k.box('dark', [0.36, 0.1, 0.12], { p: [0, -0.03, -1.0] });
        k.box('accent', [0.37, 0.03, 0.012], { p: [0, -0.05, -1.062] });
        for (const s of [-1, 1]) k.rod('rubber', [s * 0.17, -0.05, -0.97], [s * 0.2, -0.05, -0.97], 0.035, 0.035, 8);
        k.box('dark', [0.04, 0.02, 0.03], { p: [0, -0.095, -0.55] });
        return;
      }
      if (p.t === 1) {
        k.box('dark', [0.03, 0.1, 0.035], { p: [0, -0.045, 0], r: [0.25, 0, 0] });
        k.zrod('main', -0.02, 0.1, 0.04, 0.035, 10, 0, 0.04);
        k.zrod('#8fb8d8', -0.21, -0.02, 0.045, 0.045, 10, 0, 0.04);
        k.zrod('main', -0.22, -0.2, 0.03, 0.045, 10, 0, 0.04);
        k.box('dark', [0.05, 0.05, 0.07], { p: [0, -0.02, -0.06] });
        k.zrod('metal', -0.95, -0.21, 0.014, 0.014, 6, 0, 0.04);
        k.box('main', [0.25, 0.05, 0.09], { p: [0, 0.02, -1.0] });
        k.box('glow', [0.22, 0.008, 0.004], { p: [0, 0.02, -1.046] });
        return;
      }
      k.zlathe(
        'main',
        [
          [0.0001, -0.22],
          [0.05, -0.22],
          [0.06, -0.08],
          [0.065, 0.02],
          [0.05, 0.06],
          [0.0001, 0.07],
        ],
        12,
        [0, -0.06, 0],
      );
      k.zlathe(
        'main',
        [
          [0.0001, -0.37],
          [0.025, -0.37],
          [0.035, -0.33],
          [0.05, -0.22],
          [0.0001, -0.22],
        ],
        12,
        [0, -0.06, 0],
      );
      k.zrod('#8fb8d8', -0.21, -0.12, 0.054, 0.059, 12, 0, -0.06);
      k.box('dark', [0.07, 0.02, 0.05], { p: [0, -0.06, -0.37] });
      k.tube('accent', [[0, -0.035, 0.05], [0, 0, 0.02], [0, 0.004, -0.05], [0, -0.025, -0.1]], 0.014, 8, 5);
      k.box('glow', [0.012, 0.006, 0.02], { p: [0, 0.019, -0.01] });
    },
    anchors(p) {
      if (p.t === 0)
        return { mag: [0, -0.016, -0.25], tip: [0, -0.03, -1.06], rear: [0, 0, 0.08], top: [0, 0.09, -0.6], grip: [0, -0.015, 0.03], under: [0, -0.09, -0.7], side: [0.13, 0, -0.7] };
      if (p.t === 1)
        return { tip: [0, 0.02, -1.045], rear: [0, 0.04, 0.1], top: [0, 0.085, -0.1], grip: [0, -0.09, 0.012], under: [0, -0.005, -0.15], side: [0.045, 0.04, -0.1] };
      return { tip: [0, -0.06, -0.395], rear: [0, -0.06, 0.07], top: [0, 0.018, -0.02], grip: [0, -0.12, -0.08], under: [0, -0.115, -0.2], side: [0.06, -0.06, -0.08] };
    },
    roles: ['barrel', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
    guns: ['lmg', 'flamethrower', 'bubble_gun'],
    fireMode: 'stream',
    ammo: 'dust',
  },

  /* ================= HAIR DRYER ================= */
  {
    kind: 'hair-dryer',
    group: 'household',
    noun: 'Hair Dryer',
    syn: ['hair dryer', 'hairdryer', 'blow dryer', 'blower', 'salon'],
    tags: ['household', 'bathroom', 'plastic', 'silly', 'tech'],
    desc: 'pistol grip hair dryer',
    color: '#e86fa3',
    accent: '#3b3b44',
    variants: [
      { v: 'classic', p: { t: 0, R: 0.04, zf: -0.1, zr: 0.07, hl: 0.12 } },
      { v: 'salon', p: { t: 1, R: 0.047, zf: -0.13, zr: 0.1, hl: 0.14 }, desc: 'big salon dryer with long nozzle' },
      { v: 'diffuser', p: { t: 2, R: 0.04, zf: -0.1, zr: 0.07, hl: 0.12 }, desc: 'hair dryer with prong diffuser bowl' },
    ],
    draw(k, p) {
      const { R, zf, zr, hl } = p;
      const y = R;
      k.zrod('main', zf, zr, R * 0.95, R, 12, 0, y);
      k.zrod('dark', zr, zr + 0.006, R * 0.85, R * 0.85, 12, 0, y);
      k.torus('accent', R * 0.5, 0.004, { p: [0, y, zr + 0.007] }, 3, 10);
      k.extrude(
        'main',
        [
          [0.022, 0.012],
          [-0.022, 0.012],
          [-0.012, -hl],
          [0.03, -hl],
        ],
        0.032,
        'zy',
      );
      k.box('accent', [0.012, 0.028, 0.01], { p: [0, -0.035, -0.019] });
      k.rod('rubber', [0, -hl, 0.012], [0, -hl - 0.04, 0.035], 0.006, 0.004, 5);
      if (p.t === 0) {
        k.zrod('accent', zf - 0.05, zf, R * 0.6, R * 0.8, 12, 0, y);
        k.box('accent', [R * 1.2, R * 0.35, 0.025], { p: [0, y, zf - 0.06] });
      } else if (p.t === 1) {
        k.zrod('accent', zf - 0.07, zf, R * 0.55, R * 0.85, 12, 0, y);
        k.box('accent', [R * 1.4, R * 0.3, 0.03], { p: [0, y, zf - 0.085] });
        for (const z of [zr - 0.03, zr - 0.05]) k.zrod('accent', z, z + 0.008, R * 1.04, R * 1.04, 12, 0, y);
        k.torus('accent', 0.012, 0.003, { p: [0, -hl - 0.012, 0.03], r: [0, PI / 2, 0] }, 3, 8);
      } else {
        const zb = zf - 0.09;
        k.zrod('accent', zf - 0.03, zf, R * 0.75, R * 0.85, 12, 0, y);
        k.zlathe(
          'accent',
          [
            [0.0001, zb],
            [0.07, zb],
            [0.064, zb + 0.035],
            [R * 0.75, zb + 0.06],
          ],
          12,
          [0, y, 0],
        );
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * 2 * PI;
          k.rod('accent', [Math.cos(a) * 0.048, y + Math.sin(a) * 0.048, zb + 0.002], [Math.cos(a) * 0.05, y + Math.sin(a) * 0.05, zb - 0.022], 0.006, 0.003, 4);
        }
      }
    },
    anchors(p) {
      const { R, zf, zr, hl } = p;
      const y = R;
      const tip = p.t === 0 ? zf - 0.0725 : p.t === 1 ? zf - 0.1 : zf - 0.09;
      const mid = (zf + zr) / 2;
      return {
        tip: [0, y, tip],
        rear: [0, y, zr + 0.006],
        top: [0, y + R * 0.97, mid],
        grip: [0, -hl, 0.009],
        under: [0, y - R * 0.95, zf + 0.01],
        side: [R * 0.97, y, mid],
        mag: [0, -hl / 2, -0.017],
      };
    },
    roles: ['barrel', 'muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol', 'flamethrower', 'bubble_gun'],
    selfGrip: true,
    fireMode: 'stream',
    ammo: 'hot air',
  },

  /* ================= CLOTHES IRON ================= */
  {
    kind: 'clothes-iron',
    group: 'household',
    noun: 'Clothes Iron',
    syn: ['iron', 'clothes iron', 'steam iron', 'flat iron', 'sad iron', 'laundry'],
    tags: ['household', 'heavy', 'metal', 'retro'],
    desc: 'steam iron with pointed soleplate',
    color: '#4aa3c9',
    accent: '#e8eef2',
    variants: [
      { v: 'steam', p: { t: 0, s: 1 } },
      { v: 'cast', p: { t: 1, s: 1 }, desc: 'cast iron sad iron with wood handle', noun: 'Sad Iron' },
      { v: 'travel', p: { t: 2, s: 0.75 }, desc: 'compact travel iron with open handle' },
    ],
    draw(k, p) {
      const s = p.s;
      const sole: Pt[] = (
        [
          [0, -0.18],
          [0.045, -0.12],
          [0.062, -0.02],
          [0.062, 0.06],
          [-0.062, 0.06],
          [-0.062, -0.02],
          [-0.045, -0.12],
        ] as Pt[]
      ).map(([x, z]) => [x * s, z * s] as Pt);
      const ys = -0.11 * s;
      if (p.t === 1) {
        k.extrude('main', sole, 0.05, 'xz', { p: [0, ys + 0.02, 0] }, 0.004);
        k.rod('wood', [0, 0, -0.065], [0, 0, 0.065], 0.014, 0.014, 8);
        for (const z of [-0.06, 0.06]) k.rod('main', [0, 0, z], [0, ys + 0.045, z * 0.8], 0.008, 0.01, 6);
        return;
      }
      const inner = sole.map(([x, z]) => [x * 0.9, z * 0.92 + 0.006 * s] as Pt);
      k.extrude('metal', sole, 0.01 * s, 'xz', { p: [0, ys, 0] });
      k.extrude('main', inner, 0.03 * s, 'xz', { p: [0, ys + 0.024 * s, 0] }, 0.006 * s);
      k.extrude('#9cc9e8', inner.map(([x, z]) => [x * 0.7, z * 0.6 - 0.02 * s] as Pt), 0.02 * s, 'xz', { p: [0, ys + 0.05 * s, 0] });
      k.box('main', [0.028 * s, 0.024 * s, 0.13 * s], { p: [0, 0, 0] });
      k.rod('main', [0, 0, 0.055 * s], [0, ys + 0.04 * s, 0.05 * s], 0.014 * s, 0.02 * s, 6);
      k.rod('accent', [0, ys + 0.045 * s, 0.03 * s], [0, ys + 0.056 * s, 0.03 * s], 0.018 * s, 0.018 * s, 10);
      k.rod('rubber', [0, ys + 0.03 * s, 0.06 * s], [0, ys + 0.02 * s, 0.11 * s], 0.005, 0.005, 4);
      if (p.t === 0) {
        k.rod('main', [0, 0, -0.06 * s], [0, ys + 0.03 * s, -0.12 * s], 0.012 * s, 0.016 * s, 6);
        k.box('accent', [0.016, 0.008, 0.02], { p: [0, 0.014, -0.04] });
      } else {
        k.zrod('accent', -0.075 * s, -0.065 * s, 0.014 * s, 0.014 * s, 8);
        k.box('accent', [0.02 * s, 0.03 * s, 0.012 * s], { p: [0, ys + 0.06 * s, 0.055 * s] });
      }
    },
    anchors(p) {
      const s = p.s;
      const ys = -0.11 * s;
      if (p.t === 1)
        return {
          tip: [0, ys + 0.02, -0.18],
          rear: [0, ys + 0.02, 0.06],
          top: [0, 0.014, 0],
          grip: [0, -0.014, 0],
          under: [0, ys - 0.009, -0.06],
          side: [0.065, ys + 0.02, 0.02],
        };
      return {
        tip: [0, ys, -0.18 * s],
        rear: [0, ys + 0.01 * s, 0.06 * s],
        top: [0, 0.012 * s, 0],
        grip: [0, -0.012 * s, 0],
        under: [0, ys - 0.005 * s, -0.06 * s],
        side: [0.062 * s, ys, 0.02 * s],
      };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'medium' },
    guns: ['flamethrower'],
    fireMode: 'stream',
    ammo: 'steam',
  },

  /* ================= TV REMOTE ================= */
  {
    kind: 'tv-remote',
    group: 'household',
    noun: 'TV Remote',
    syn: ['remote', 'remote control', 'clicker', 'controller', 'tv'],
    tags: ['household', 'tech', 'plastic', 'silly'],
    desc: 'tv remote control with buttons',
    color: '#26272c',
    accent: '#8c8f99',
    variants: [
      { v: 'classic', p: { t: 0, L: 0.2, w: 0.05, th: 0.022 } },
      { v: 'slim', p: { t: 1, L: 0.14, w: 0.036, th: 0.009 }, desc: 'slim aluminium remote with touchpad' },
      { v: 'retro', p: { t: 2, L: 0.21, w: 0.065, th: 0.035 }, desc: 'chunky retro remote with big buttons' },
    ],
    draw(k, p) {
      const { L, w, th } = p;
      const zr = 0.03;
      const zt = zr - L;
      k.extrude('main', chamferRect(-w / 2, -th / 2, w / 2, th / 2, th * 0.3), L, 'xy', { p: [0, 0, (zt + zr) / 2] });
      k.box('#3a0f0f', [w * 0.6, th * 0.5, 0.004], { p: [0, 0, zt - 0.001] });
      const yt = th / 2;
      if (p.t === 0) {
        k.box('#d23b2b', [0.01, 0.004, 0.009], { p: [w * 0.28, yt, zt + 0.014] });
        for (let r = 0; r < 4; r++)
          for (let c = 0; c < 3; c++) k.box('accent', [0.009, 0.004, 0.007], { p: [(c - 1) * 0.013, yt, zt + 0.03 + r * 0.012] });
        const dz = zt + 0.1;
        k.box('accent', [0.01, 0.004, 0.01], { p: [0, yt + 0.0005, dz] });
        for (const [x, z] of [[0.012, 0], [-0.012, 0], [0, 0.012], [0, -0.012]] as Pt[]) k.box('accent', [0.008, 0.004, 0.008], { p: [x, yt, dz + z] });
        for (const s of [-1, 1]) k.box('accent', [0.009, 0.004, 0.026], { p: [s * 0.013, yt, zt + 0.14] });
      } else if (p.t === 1) {
        k.box('dark', [w * 0.9, 0.001, L * 0.45], { p: [0, yt, zt + L * 0.27] });
        k.rod('dark', [0, yt, zt + L * 0.25], [0, yt + 0.0015, zt + L * 0.25], 0.013, 0.013, 12);
        for (let i = 0; i < 4; i++) k.rod('dark', [(i % 2 ? 1 : -1) * 0.009, yt, zt + L * 0.55 + Math.floor(i / 2) * 0.016], [(i % 2 ? 1 : -1) * 0.009, yt + 0.0015, zt + L * 0.55 + Math.floor(i / 2) * 0.016], 0.005, 0.005, 8);
      } else {
        k.box('#d23b2b', [0.02, 0.006, 0.014], { p: [-w * 0.25, yt, zt + 0.02] });
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < 3; c++) k.box('accent', [0.015, 0.007, 0.012], { p: [(c - 1) * 0.019, yt, zt + 0.055 + r * 0.02] });
        for (const s of [-1, 1]) k.box('accent', [0.016, 0.008, 0.04], { p: [s * 0.016, yt, zt + 0.15] });
        k.box('dark', [w * 0.7, 0.002, 0.03], { p: [0, yt, zt + 0.19] });
      }
    },
    anchors(p) {
      const { L, w, th } = p;
      const zr = 0.03;
      const zt = zr - L;
      return { tip: [0, 0, zt - 0.003], rear: [0, 0, zr], top: [0, th / 2, (zt + zr) / 2], grip: [0, -th / 2, 0], under: [0, -th / 2, zt + 0.04], side: [w / 2, 0, (zt + zr) / 2] };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol'],
    fireMode: 'hitscan',
    ammo: 'infrared beams',
  },

  /* ================= SMARTPHONE ================= */
  {
    kind: 'phone',
    group: 'household',
    noun: 'Phone',
    syn: ['phone', 'smartphone', 'mobile', 'cellphone', 'flip phone', 'brick phone'],
    tags: ['household', 'tech', 'modern', 'silly'],
    desc: 'smartphone with glowing screen',
    color: '#2a2d35',
    accent: '#5ad1ff',
    variants: [
      { v: 'smart', p: { t: 0 }, noun: 'Smartphone' },
      { v: 'flip', p: { t: 1 }, desc: 'open flip phone', noun: 'Flip Phone' },
      { v: 'brick', p: { t: 2 }, desc: 'nineties brick phone with antenna', noun: 'Brick Phone' },
    ],
    draw(k, p) {
      if (p.t === 0) {
        const w = 0.072;
        const th = 0.008;
        k.extrude('main', chamferRect(-w / 2, -th / 2, w / 2, th / 2, 0.003), 0.15, 'xy', { p: [0, 0, -0.045] });
        k.box('#14243c', [w - 0.006, 0.001, 0.14], { p: [0, th / 2 + 0.0004, -0.045] });
        for (let i = 0; i < 8; i++) k.box('glow', [0.011, 0.001, 0.011], { p: [-0.021 + (i % 4) * 0.014, th / 2 + 0.0008, -0.09 + Math.floor(i / 4) * 0.016] });
        k.box('dark', [0.026, 0.002, 0.026], { p: [-0.016, -th / 2 - 0.001, -0.1] });
        k.rod('rubber', [-0.022, -th / 2 - 0.002, -0.106], [-0.022, -th / 2 - 0.004, -0.106], 0.005, 0.005, 8);
        k.rod('rubber', [-0.01, -th / 2 - 0.002, -0.094], [-0.01, -th / 2 - 0.004, -0.094], 0.005, 0.005, 8);
        return;
      }
      if (p.t === 1) {
        const a = 0.35;
        k.box('main', [0.05, 0.014, 0.09], { p: [0, 0, -0.015] });
        for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) k.box('accent', [0.011, 0.002, 0.008], { p: [(c - 1) * 0.014, 0.0075, -0.005 - r * 0.012] });
        k.rod('dark', [-0.026, 0.01, -0.06], [0.026, 0.01, -0.06], 0.008, 0.008, 8);
        const c: Vec3 = [0, 0.01 + Math.sin(a) * 0.045, -0.06 - Math.cos(a) * 0.045];
        k.box('main', [0.05, 0.012, 0.09], { p: c, r: [a, 0, 0] });
        k.box('glow', [0.04, 0.001, 0.055], { p: [0, c[1] + Math.cos(a) * 0.0062, c[2] + Math.sin(a) * 0.0062], r: [a, 0, 0] });
        return;
      }
      k.box('main', [0.055, 0.035, 0.2], { p: [0, 0, -0.07] });
      k.box('#a4c08a', [0.04, 0.002, 0.04], { p: [0, 0.018, -0.13] });
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) k.box('accent', [0.012, 0.004, 0.01], { p: [(c - 1) * 0.016, 0.018, -0.08 + r * 0.016] });
      k.rod('rubber', [0.012, 0.008, -0.17], [0.012, 0.008, -0.24], 0.007, 0.004, 6);
      k.ball('rubber', 0.006, [0.012, 0.008, -0.24], 0);
    },
    anchors(p) {
      if (p.t === 0) return { tip: [0, 0, -0.12], rear: [0, 0, 0.03], top: [0, 0.0045, -0.045], grip: [0, -0.004, 0], under: [0, -0.004, -0.08], side: [0.036, 0, -0.045] };
      if (p.t === 1) {
        const a = 0.35;
        return {
          tip: [0, 0.01 + Math.sin(a) * 0.09, -0.06 - Math.cos(a) * 0.09],
          rear: [0, 0, 0.03],
          top: [0, 0.007, -0.015],
          grip: [0, -0.007, 0],
          under: [0, -0.007, -0.05],
          side: [0.025, 0, -0.015],
        };
      }
      return { tip: [0.012, 0.008, -0.246], rear: [0, 0, 0.03], top: [0, 0.0175, -0.06], grip: [0, -0.0175, 0], under: [0, -0.0175, -0.12], side: [0.0275, 0, -0.07] };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol'],
    fireMode: 'hitscan',
    ammo: 'notifications',
  },

  /* ================= TELEPHONE ================= */
  {
    kind: 'telephone',
    group: 'household',
    noun: 'Telephone',
    syn: ['telephone', 'landline', 'rotary phone', 'handset', 'receiver', 'candlestick phone'],
    tags: ['household', 'retro', 'silly'],
    desc: 'landline telephone handset with coiled cord',
    color: '#1f1f22',
    accent: '#c9c9c9',
    variants: [
      { v: 'handset', p: { t: 0 }, noun: 'Phone Handset' },
      { v: 'rotary', p: { t: 1 }, desc: 'rotary dial desk telephone', noun: 'Rotary Phone' },
      { v: 'candlestick', p: { t: 2 }, desc: 'vintage candlestick telephone', noun: 'Candlestick Phone' },
    ],
    draw(k, p) {
      if (p.t === 0) {
        handset(k);
        const pts: Vec3[] = [];
        for (let i = 0; i <= 16; i++) pts.push([0.012 * Math.cos(i * 1.4), -0.056 - i * 0.006, -0.1 + 0.012 * Math.sin(i * 1.4)]);
        k.tube('main', pts, 0.0035, 28, 3);
        return;
      }
      if (p.t === 1) {
        k.extrude(
          'main',
          [
            [0, -0.05],
            [-0.22, -0.05],
            [-0.21, 0.0],
            [-0.12, 0.04],
            [0, 0.04],
          ],
          0.2,
          'zy',
        );
        const n: [number, number] = [-0.406, 0.914];
        const c: Vec3 = [0, 0.02 + n[1] * 0.004, -0.165 + n[0] * 0.004];
        const tilt = Math.atan2(0.04, 0.09);
        k.rod('accent', [0, 0.02, -0.165], [0, 0.02 + n[1] * 0.006, -0.165 + n[0] * 0.006], 0.05, 0.05, 12);
        k.torus('dark', 0.034, 0.009, { p: [0, c[1] + n[1] * 0.003, c[2] + n[0] * 0.003], r: [-PI / 2 + tilt, 0, 0] }, 3, 10);
        k.box('white', [0.04, 0.004, 0.03], { p: [0, 0.02 + n[1] * 0.007, -0.165 + n[0] * 0.007], r: [tilt, 0, 0] });
        for (const s of [-1, 1]) k.box('main', [0.03, 0.025, 0.04], { p: [s * 0.08, 0.05, -0.05] });
        k.rod('main', [-0.07, 0.078, -0.05], [0.07, 0.078, -0.05], 0.015, 0.015, 6);
        for (const s of [-1, 1]) {
          k.rod('main', [s * 0.07, 0.078, -0.05], [s * 0.095, 0.058, -0.05], 0.015, 0.017, 6);
          k.rod('main', [s * 0.1, 0.062, -0.05], [s * 0.1, 0.035, -0.05], 0.022, 0.03, 8);
        }
        k.tube('accent', [[0.1, 0.0, 0.0], [0.13, -0.01, 0.03], [0.1, -0.04, 0.06]], 0.004, 6, 3);
        return;
      }
      k.zrod('main', -0.12, 0.12, 0.012, 0.012, 8);
      k.zlathe(
        'main',
        [
          [0.012, 0.12],
          [0.05, 0.15],
          [0.06, 0.16],
          [0.0001, 0.16],
        ],
        12,
      );
      k.zrod('main', -0.15, -0.12, 0.025, 0.02, 10);
      k.lathe(
        'main',
        [
          [0.009, 0],
          [0.03, 0.04],
          [0.033, 0.046],
        ],
        10,
        { p: [0, 0.015, -0.135] },
      );
      k.rod('dark', [0, 0.05, -0.135], [0, 0.052, -0.135], 0.026, 0.026, 10);
      k.rod('brass', [0.012, 0, -0.08], [0.045, 0, -0.08], 0.003, 0.003, 4);
      k.zrod('accent', -0.075, 0.02, 0.011, 0.015, 8, 0.055, 0);
      k.zrod('accent', -0.095, -0.075, 0.022, 0.016, 8, 0.055, 0);
      k.tube('dark', [[0.055, 0, 0.02], [0.06, -0.02, 0.07], [0.04, -0.01, 0.13], [0.03, 0, 0.15]], 0.003, 6, 3);
    },
    anchors(p) {
      if (p.t === 0) return { tip: [0, -0.04, -0.128], rear: [0, -0.04, 0.128], top: [0, 0.015, 0], grip: [0, -0.015, 0], under: [0, -0.052, -0.1], side: [0.015, 0, 0] };
      if (p.t === 1) return { tip: [0, -0.03, -0.216], rear: [0, 0, 0], top: [0, 0.04, -0.03], grip: [0, -0.05, -0.03], under: [0, -0.05, -0.15], side: [0.1, 0, -0.1] };
      return { tip: [0, 0, -0.15], rear: [0, 0, 0.16], top: [0, 0.012, 0.0], grip: [0, -0.012, 0.02], under: [0, -0.012, -0.08], side: [0.012, 0, -0.1] };
    },
    roles: ['mag', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
  },

  /* ================= COMPUTER KEYBOARD ================= */
  {
    kind: 'keyboard',
    group: 'household',
    noun: 'Keyboard',
    syn: ['keyboard', 'computer keyboard', 'keys', 'typing', 'qwerty', 'gamer'],
    tags: ['household', 'office', 'tech', 'plastic'],
    desc: 'computer keyboard held by one end',
    color: '#d9dadf',
    accent: '#3a3c44',
    variants: [
      { v: 'office', p: { t: 0, L: 0.45, d: 0.14, th: 0.018, kh: 0.008 }, desc: 'full office keyboard with numpad' },
      { v: 'retro', p: { t: 1, L: 0.47, d: 0.18, th: 0.036, kh: 0.014 }, desc: 'chunky beige retro wedge keyboard' },
      { v: 'gaming', p: { t: 2, L: 0.37, d: 0.13, th: 0.022, kh: 0.01 }, desc: 'compact gaming keyboard with underglow' },
    ],
    draw(k, p) {
      const { L, d, th, kh } = p;
      const zr = 0.015;
      const zt = zr - L;
      if (p.t === 1)
        k.extrude(
          'main',
          [
            [-d / 2, -th / 2],
            [d / 2, -th / 2],
            [d / 2, th * 0.1],
            [-d / 2, th / 2],
          ],
          L,
          'xy',
          { p: [0, 0, (zr + zt) / 2] },
        );
      else k.box('main', [d, th, L], { p: [0, 0, (zr + zt) / 2] });
      const m = 0.008;
      const rp = (d - 2 * m) / 5;
      const pitch = p.t === 1 ? 0.024 : 0.019;
      for (const [z0, z1] of kbBlocks(p)) {
        const len = z0 - z1;
        for (let i = 0; i < 5; i++) {
          const x = -d / 2 + m + (i + 0.5) * rp;
          const yt = kbTop(p, x);
          k.box('accent', [rp * 0.86, kh, len], { p: [x, yt + kh / 2, (z0 + z1) / 2] });
        }
        const n = Math.floor(len / pitch);
        const x0 = -d / 2 + m + rp;
        const x1 = d / 2 - m;
        const ang = Math.atan2(kbTop(p, x1) - kbTop(p, x0), x1 - x0);
        const ym = kbTop(p, (x0 + x1) / 2);
        for (let j = 1; j < n; j++) {
          const z = z0 - (j * len) / n;
          k.box('dark', [(x1 - x0) / Math.cos(ang), kh * 2 + 0.002, 0.0025], { p: [(x0 + x1) / 2, ym + 0.001, z], r: [0, 0, ang] });
        }
        // space-bar row gets its own few separators
        const xs = -d / 2 + m + 0.5 * rp;
        const ys = kbTop(p, xs);
        for (const f of [0.18, 0.3, 0.72, 0.84]) k.box('dark', [rp * 0.9, kh * 2 + 0.002, 0.0025], { p: [xs, ys + 0.001, z0 - len * f] });
      }
      if (p.t === 2) {
        k.box('glow', [0.004, 0.005, L - 0.01], { p: [d / 2 + 0.001, -th / 2 + 0.003, (zr + zt) / 2] });
        k.box('glow', [0.004, 0.005, L - 0.01], { p: [-d / 2 - 0.001, -th / 2 + 0.003, (zr + zt) / 2] });
        k.box('rubber', [0.05, th * 0.7, L * 0.8], { p: [-d / 2 - 0.026, -th * 0.15, (zr + zt) / 2] });
      }
    },
    anchors(p) {
      const { L, d, th, kh } = p;
      const zr = 0.015;
      const zt = zr - L;
      const zm = -0.012 - (p.t === 0 ? L * 0.3 : L * 0.45);
      return {
        tip: [0, 0, zt],
        rear: [0, 0, zr],
        top: [0, kbTop(p, 0) + kh, zm],
        grip: [0, -th / 2, -0.03],
        under: [0, -th / 2, zt + L * 0.3],
        side: [d / 2, p.t === 1 ? -th * 0.2 : 0, (zr + zt) / 2],
      };
    },
    roles: ['blade', 'barrel', 'deco'],
    melee: { swing: 'slash', weight: 'medium' },
    guns: ['lmg', 'smg'],
    ammo: 'keystrokes',
  },

  /* ================= MONITOR ================= */
  {
    kind: 'monitor',
    group: 'household',
    noun: 'Monitor',
    syn: ['monitor', 'screen', 'display', 'computer', 'crt', 'tv', 'television'],
    tags: ['household', 'office', 'tech', 'heavy'],
    desc: 'computer monitor held by its stand',
    color: '#2b2d33',
    accent: '#66e0ff',
    variants: [
      { v: 'flat', p: { t: 0, W: 0.55, Hs: 0.33, hn: 0.12 }, desc: 'flat screen monitor on stand' },
      { v: 'crt', p: { t: 1, W: 0.4, Hs: 0.36, hn: 0 }, desc: 'bulky retro crt monitor', noun: 'CRT Monitor' },
      { v: 'wide', p: { t: 2, W: 0.8, Hs: 0.3, hn: 0.1 }, desc: 'curved ultrawide monitor on v stand' },
    ],
    draw(k, p) {
      const { W, Hs, hn } = p;
      if (p.t === 1) {
        k.box('main', [0.24, 0.22, 0.03], { p: [0, -0.08, -0.015] });
        k.box('main', [0.12, 0.12, 0.03], { p: [0, -0.08, -0.04] });
        k.box('main', [W, 0.06, Hs], { p: [0, 0, -(0.05 + Hs / 2)] });
        const s2 = Math.SQRT2;
        k.lathe(
          'main',
          [
            [0.0001, -0.32],
            [0.09 * s2, -0.32],
            [0.18 * s2, -0.03],
          ],
          4,
          { p: [0, 0, -(0.05 + Hs / 2)], r: [0, PI / 4, 0] },
        );
        k.box('#2e4a3c', [W * 0.8, 0.004, Hs * 0.72], { p: [0, 0.031, -(0.05 + Hs / 2) - 0.012] });
        k.box('glow', [0.01, 0.003, 0.006], { p: [W * 0.4, 0.031, -0.065] });
        for (let i = 0; i < 3; i++) k.box('dark', [0.014, 0.004, 0.008], { p: [-W * 0.3 + i * 0.022, 0.031, -0.065] });
        return;
      }
      const hs0 = 0.015 + hn * 0.5;
      const zc = -(hs0 + Hs / 2);
      if (p.t === 0) {
        k.box('dark', [0.22, 0.17, 0.015], { p: [0, 0.02, -0.0075] });
        k.box('dark', [0.05, 0.02, hn], { p: [0, -0.03, -0.015 - hn / 2] });
        k.box('main', [W, 0.025, Hs], { p: [0, 0, zc] });
        k.box('main', [W * 0.5, 0.03, Hs * 0.5], { p: [0, -0.025, zc] });
        k.box('#2f5f9a', [W - 0.02, 0.002, Hs - 0.025], { p: [0, 0.0128, zc - 0.004] });
        k.box('glow', [0.006, 0.003, 0.004], { p: [W * 0.4, 0.0135, -hs0 - 0.004] });
        return;
      }
      for (const s of [-1, 1]) k.box('metal', [0.025, 0.2, 0.012], { p: [s * 0.06, 0.04, -0.006], r: [0, 0, -s * 0.5] });
      k.box('metal', [0.04, 0.015, hn + 0.01], { p: [0, -0.02, -0.01 - hn / 2] });
      const th = 0.16;
      const pw = W / 3;
      k.box('main', [pw, 0.018, Hs], { p: [0, 0, zc] });
      k.box('#2f5f9a', [pw, 0.002, Hs - 0.02], { p: [0, 0.0095, zc - 0.003] });
      k.box('main', [W * 0.3, 0.025, Hs * 0.4], { p: [0, -0.015, zc] });
      for (const s of [-1, 1]) {
        const cx = s * (pw / 2 + (pw / 2) * Math.cos(th));
        const cy = (pw / 2) * Math.sin(th);
        k.box('main', [pw, 0.018, Hs], { p: [cx, cy, zc], r: [0, 0, s * th] });
        k.box('#2f5f9a', [pw - 0.01, 0.002, Hs - 0.02], { p: [cx - s * Math.sin(th) * 0.0095, cy + Math.cos(th) * 0.0095, zc - 0.003], r: [0, 0, s * th] });
      }
    },
    anchors(p) {
      const { W, Hs, hn } = p;
      if (p.t === 1) {
        const zc = -(0.05 + Hs / 2);
        return { tip: [0, 0, -(0.05 + Hs)], rear: [0, -0.08, 0], top: [0, 0.033, zc], grip: [0, -0.19, -0.015], under: [0, -0.32, zc], side: [W / 2, 0, zc] };
      }
      const hs0 = 0.015 + hn * 0.5;
      const zc = -(hs0 + Hs / 2);
      if (p.t === 0) return { tip: [0, 0, -(hs0 + Hs)], rear: [0, 0.02, 0], top: [0, 0.0139, zc], grip: [0, -0.065, -0.0075], under: [0, -0.04, zc], side: [W / 2, 0, zc] };
      const th = 0.16;
      const pw = W / 3;
      return {
        tip: [0, 0, -(hs0 + Hs)],
        rear: [0, -0.02, -0.005],
        top: [0, 0.0105, zc],
        grip: [0, -0.02, -0.03],
        under: [0, -0.0275, zc],
        side: [pw / 2 + pw * Math.cos(th), pw * Math.sin(th), zc],
      };
    },
    roles: ['deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
  },

  /* ================= TRAFFIC CONE ================= */
  {
    kind: 'traffic-cone',
    group: 'household',
    noun: 'Traffic Cone',
    syn: ['traffic cone', 'cone', 'pylon', 'road cone', 'witches hat', 'bollard'],
    tags: ['household', 'plastic', 'silly', 'junk', 'light'],
    desc: 'striped orange traffic cone',
    color: '#ff6a13',
    accent: '#2b2b2e',
    variants: [
      { v: 'tall', p: { t: 0, H: 0.7, Rb: 0.15, rt: 0.025, st: 2 } },
      { v: 'squat', p: { t: 0, H: 0.42, Rb: 0.15, rt: 0.035, st: 1 }, desc: 'short squat traffic cone' },
      { v: 'post', p: { t: 1, H: 0.95, Rb: 0.15, rt: 0.04, st: 3 }, desc: 'tall delineator post with ring top', noun: 'Delineator Post' },
    ],
    draw(k, p) {
      const { H, Rb, rt } = p;
      if (p.t === 1) {
        k.box('accent', [0.3, 0.3, 0.05], { p: [0, 0, -0.025] });
        k.zlathe(
          'main',
          [
            [0.0001, -H],
            [0.035, -H],
            [0.04, -H + 0.03],
            [0.045, -0.05],
            [0.06, -0.05],
            [0.0001, -0.05],
          ],
          12,
        );
        k.torus('main', 0.035, 0.01, { p: [0, 0, -H - 0.04], r: [0, PI / 2, 0] }, 4, 10);
        for (let j = 0; j < p.st; j++) {
          const z0 = -H + 0.08 + j * 0.12;
          k.zrod('white', z0, z0 + 0.06, 0.043, 0.043, 12);
        }
        return;
      }
      const zb = -0.035;
      const rz = (z: number) => rt + ((Rb - rt) * (z + H)) / (zb + H);
      k.zlathe(
        'main',
        [
          [0.0001, -H],
          [rt, -H],
          [Rb, zb],
          [0.0001, zb],
        ],
        12,
      );
      k.box('accent', [2 * Rb + 0.09, 2 * Rb + 0.09, 0.035], { p: [0, 0, -0.0175] });
      for (let j = 0; j < p.st; j++) {
        const z0 = -H + (H + zb) * (0.2 + 0.24 * j);
        const z1 = z0 + H * 0.12;
        k.zlathe(
          'white',
          [
            [rz(z0) + 0.002, z0],
            [rz(z1) + 0.002, z1],
          ],
          12,
        );
      }
    },
    anchors(p) {
      const { H, Rb, rt } = p;
      if (p.t === 1) return { mag: [0, -0.045, -0.15], tip: [0, 0, -H - 0.085], rear: [0, 0, 0], top: [0, 0.0425, -H * 0.5], grip: [0, -0.15, -0.025], under: [0, -0.0425, -H * 0.5], side: [0.0425, 0, -H * 0.5] };
      const zb = -0.035;
      const zm = -H * 0.45;
      const rm = rt + ((Rb - rt) * (zm + H)) / (zb + H);
      return { tip: [0, 0, -H], rear: [0, 0, 0], top: [0, rm, zm], grip: [0, -(Rb + 0.045), -0.0175], under: [0, -rm, zm], side: [rm, 0, zm] };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['rocket_launcher', 'shotgun'],
  },

  /* ================= MAILBOX ================= */
  {
    kind: 'mailbox',
    group: 'household',
    noun: 'Mailbox',
    syn: ['mailbox', 'letterbox', 'postbox', 'post box', 'pillar box', 'mail'],
    tags: ['household', 'metal', 'heavy', 'junk', 'silly'],
    desc: 'rural mailbox on a wooden post',
    color: '#4b5a68',
    accent: '#d62828',
    variants: [
      { v: 'rural', p: { t: 0, Hp: 0.9 } },
      { v: 'pillar', p: { t: 1, Hp: 0 }, desc: 'red pillar post box with domed cap', noun: 'Pillar Box' },
      { v: 'modern', p: { t: 2, Hp: 0.8 }, desc: 'square modern mailbox on steel post' },
    ],
    draw(k, p) {
      const Hp = p.Hp;
      if (p.t === 0) {
        k.box('wood', [0.08, 0.08, Hp], { p: [0, 0, -Hp / 2] });
        k.box('wood', [0.12, 0.3, 0.02], { p: [0, 0.04, -Hp - 0.01] });
        k.box('main', [0.2, 0.46, 0.11], { p: [0, 0.04, -(Hp + 0.075)] });
        k.rod('main', [0, -0.19, -(Hp + 0.13)], [0, 0.27, -(Hp + 0.13)], 0.1, 0.1, 10);
        k.box('dark', [0.04, 0.012, 0.015], { p: [0, 0.275, -(Hp + 0.16)] });
        k.box('accent', [0.006, 0.012, 0.16], { p: [0.104, -0.05, -(Hp + 0.1)] });
        k.box('accent', [0.006, 0.06, 0.045], { p: [0.104, -0.02, -(Hp + 0.165)] });
        return;
      }
      if (p.t === 1) {
        k.zrod('dark', -0.08, 0, 0.17, 0.17, 12);
        k.zrod('accent', -0.85, -0.08, 0.15, 0.15, 12);
        k.zlathe(
          'accent',
          [
            [0.0001, -1.0],
            [0.08, -0.98],
            [0.15, -0.91],
            [0.17, -0.87],
            [0.17, -0.85],
            [0.0001, -0.85],
          ],
          12,
        );
        k.box('dark', [0.12, 0.012, 0.022], { p: [0, 0.148, -0.72] });
        k.box('white', [0.08, 0.008, 0.06], { p: [0, 0.149, -0.58] });
        k.box('brass', [0.05, 0.008, 0.04], { p: [0, 0.149, -0.8] });
        return;
      }
      k.zrod('metal', -Hp, 0, 0.03, 0.03, 8);
      k.box('main', [0.3, 0.25, 0.35], { p: [0, 0, -(Hp + 0.175)] });
      k.box('accent', [0.32, 0.27, 0.02], { p: [0, 0, -(Hp + 0.36)] });
      k.box('dark', [0.2, 0.008, 0.025], { p: [0, 0.125, -(Hp + 0.29)] });
      k.box('brass', [0.08, 0.006, 0.04], { p: [0, 0.126, -(Hp + 0.12)] });
      k.box('metal', [0.12, 0.12, 0.02], { p: [0, 0, -(Hp - 0.01)] });
    },
    anchors(p) {
      const Hp = p.Hp;
      if (p.t === 0)
        return { mag: [0, -0.04, -0.45], tip: [0, 0, -(Hp + 0.23)], rear: [0, 0, 0], top: [0, 0.27, -(Hp + 0.1)], grip: [0, -0.04, -0.12], under: [0, -0.19, -(Hp + 0.08)], side: [0.1, 0, -(Hp + 0.08)] };
      if (p.t === 1) return { tip: [0, 0, -1.0], rear: [0, 0, 0], top: [0, 0.15, -0.5], grip: [0, -0.17, -0.04], under: [0, -0.15, -0.5], side: [0.15, 0, -0.5] };
      return { mag: [0, -0.03, -0.4], tip: [0, 0, -(Hp + 0.37)], rear: [0, 0, 0], top: [0, 0.125, -(Hp + 0.175)], grip: [0, -0.03, -0.1], under: [0, -0.125, -(Hp + 0.175)], side: [0.15, 0, -(Hp + 0.175)] };
    },
    roles: ['muzzle', 'deco'],
    melee: { swing: 'overhead', weight: 'heavy' },
    guns: ['rocket_launcher', 'grenade_launcher'],
    ammo: 'junk mail',
  },

  /* ================= FIRE EXTINGUISHER ================= */
  {
    kind: 'fire-extinguisher',
    group: 'household',
    noun: 'Fire Extinguisher',
    syn: ['fire extinguisher', 'extinguisher', 'foam', 'co2', 'safety'],
    tags: ['household', 'office', 'metal', 'heavy'],
    desc: 'red fire extinguisher with hose',
    color: '#c8102e',
    accent: '#f2f2f2',
    variants: [
      { v: 'classic', p: { t: 0, R: 0.065, Lc: 0.42 } },
      { v: 'co2', p: { t: 1, R: 0.07, Lc: 0.5 }, desc: 'co2 extinguisher with black horn' },
      { v: 'mini', p: { t: 2, R: 0.04, Lc: 0.28 }, desc: 'small car fire extinguisher' },
    ],
    draw(k, p) {
      const { R, Lc } = p;
      const yc = -(R + 0.025);
      const zf = 0.03;
      const zb = zf + Lc;
      k.zlathe(
        'main',
        [
          [0.0001, zf],
          [0.018, zf],
          [R * 0.7, zf + R * 0.3],
          [R * 0.95, zf + R * 0.7],
          [R, zf + R],
          [R, zb - 0.01],
          [R * 0.95, zb],
          [0.0001, zb],
        ],
        12,
        [0, yc, 0],
      );
      k.zrod('accent', zf + Lc * 0.4, zf + Lc * 0.65, R + 0.002, R + 0.002, 12, 0, yc);
      k.zrod('metal', zf - 0.02, zf + 0.01, 0.018, 0.018, 8, 0, yc);
      k.box('metal', [0.03, Math.abs(yc) + 0.01, 0.04], { p: [0, yc / 2 + 0.003, zf - 0.035] });
      k.box('dark', [0.022, 0.008, 0.12], { p: [0, 0.014, 0.045], r: [-0.15, 0, 0] });
      k.box('dark', [0.022, 0.008, 0.1], { p: [0, -0.012, 0.035] });
      k.rod('white', [0.015, yc * 0.4, zf - 0.035], [0.025, yc * 0.4, zf - 0.035], 0.011, 0.011, 8);
      k.torus('metal', 0.011, 0.002, { p: [-0.024, yc * 0.3, zf - 0.03], r: [0, PI / 2, 0] }, 3, 8);
      if (p.t === 0) {
        k.tube('rubber', [[0, yc + 0.0, zf - 0.05], [0, yc - 0.005, zf - 0.08], [0, yc - 0.02, zf - 0.1], [0, yc - 0.025, zf - 0.13]], 0.009, 8, 5);
        k.zrod('rubber', zf - 0.17, zf - 0.13, 0.008, 0.012, 8, 0, yc - 0.025);
      } else if (p.t === 1) {
        k.zrod('dark', zf - 0.12, zf - 0.05, 0.01, 0.01, 6, 0, yc);
        k.zlathe(
          'dark',
          [
            [0.06, zf - 0.3],
            [0.03, zf - 0.2],
            [0.012, zf - 0.12],
          ],
          10,
          [0, yc, 0],
        );
        k.zrod('rubber', zf - 0.29, zf - 0.284, 0.052, 0.052, 10, 0, yc);
      } else {
        k.zrod('dark', zf - 0.1, zf - 0.05, 0.007, 0.01, 8, 0, yc + 0.012);
        k.zrod('dark', zf + Lc * 0.75, zf + Lc * 0.8, R + 0.003, R + 0.003, 12, 0, yc);
      }
    },
    anchors(p) {
      const { R, Lc } = p;
      const yc = -(R + 0.025);
      const zf = 0.03;
      const tip: Vec3 = p.t === 0 ? [0, yc - 0.025, zf - 0.17] : p.t === 1 ? [0, yc, zf - 0.29] : [0, yc + 0.012, zf - 0.1];
      return {
        tip,
        rear: [0, yc, zf + Lc],
        top: [0, 0.02, 0.05],
        grip: [0, yc - R, 0.12],
        under: [0, yc - R, zf + Lc * 0.75],
        side: [R, yc, zf + Lc * 0.5],
      };
    },
    roles: ['barrel', 'mag', 'deco'],
    melee: { swing: 'bash', weight: 'heavy' },
    guns: ['flamethrower', 'bubble_gun', 'rocket_launcher'],
    fireMode: 'stream',
    ammo: 'foam',
  },

  /* ================= COAT HANGER ================= */
  {
    kind: 'coat-hanger',
    group: 'household',
    noun: 'Coat Hanger',
    syn: ['hanger', 'coat hanger', 'clothes hanger', 'wardrobe', 'closet'],
    tags: ['household', 'light', 'junk', 'silly'],
    desc: 'wire coat hanger with hook',
    color: '#c9ccd2',
    accent: '#9aa1ab',
    variants: [
      { v: 'wire', p: { t: 0, Lh: 0.42, hh: 0.15 } },
      { v: 'wooden', p: { t: 1, Lh: 0.44, hh: 0.1 }, desc: 'curved wooden coat hanger' },
      { v: 'plastic', p: { t: 2, Lh: 0.4, hh: 0.13 }, desc: 'chunky plastic tubular hanger' },
    ],
    draw(k, p) {
      const { Lh, hh } = p;
      const hk = (y0: number, r: number, slot: Parameters<Kit['box']>[0]) => {
        k.rod(slot, [0, y0, -Lh / 2], [0, hh + 0.04, -Lh / 2], r, r, 5);
        k.tube(
          slot,
          [
            [0, hh + 0.035, -Lh / 2],
            [0, hh + 0.075, -Lh / 2 - 0.008],
            [0, hh + 0.1, -Lh / 2 + 0.015],
            [0, hh + 0.085, -Lh / 2 + 0.045],
            [0, hh + 0.055, -Lh / 2 + 0.048],
          ],
          r,
          10,
          4,
        );
      };
      if (p.t === 1) {
        k.extrude(
          'wood',
          [
            [0, 0],
            [-Lh * 0.25, hh * 0.6],
            [-Lh / 2, hh],
            [-Lh * 0.75, hh * 0.6],
            [-Lh, 0],
            [-Lh, -0.03],
            [-Lh * 0.75, hh * 0.6 - 0.04],
            [-Lh / 2, hh - 0.035],
            [-Lh * 0.25, hh * 0.6 - 0.04],
            [0, -0.03],
          ],
          0.014,
          'zy',
        );
        k.rod('metal', [0, -0.025, -0.01], [0, -0.025, -Lh + 0.01], 0.006, 0.006, 6);
        hk(hh - 0.01, 0.003, 'metal');
        return;
      }
      const r = p.t === 0 ? 0.003 : 0.006;
      const slot = p.t === 0 ? 'metal' : 'main';
      const seg = p.t === 0 ? 5 : 6;
      k.rod(slot, [0, 0, 0], [0, 0, -Lh], r, r, seg);
      k.rod(slot, [0, 0, 0], [0, hh, -Lh / 2], r, r, seg);
      k.rod(slot, [0, 0, -Lh], [0, hh, -Lh / 2], r, r, seg);
      if (p.t === 2) {
        for (const z of [0, -Lh]) k.ball('main', 0.012, [0, 0, z], 0);
        for (const z of [-0.04, -Lh + 0.04]) k.box('main', [0.012, 0.016, 0.006], { p: [0, (hh * Math.abs(z - (z > -Lh / 2 ? 0 : -Lh))) / (Lh / 2) + 0.008, z] });
        k.ball('main', 0.012, [0, hh, -Lh / 2], 0);
        hk(hh, 0.0045, 'metal');
      } else hk(hh, r, 'metal');
    },
    anchors(p) {
      const { Lh, hh } = p;
      const top: Vec3 = [0, hh + 0.1, -Lh / 2 + 0.015];
      if (p.t === 1) return { tip: [0, -0.015, -Lh], rear: [0, -0.015, 0], top, grip: [0, -0.031, -0.03], under: [0, -0.031, -Lh / 2], side: [0.006, -0.025, -Lh / 2] };
      const r = p.t === 0 ? 0.003 : 0.006;
      const e = p.t === 2 ? 0.012 : r;
      return { tip: [0, 0, -Lh - e], rear: [0, 0, e], top, grip: [0, -r, -0.03], under: [0, -r, -Lh * 0.7], side: [r, 0, -Lh / 2] };
    },
    roles: ['blade', 'deco'],
    melee: { swing: 'slash', weight: 'light' },
  },

  /* ================= FLASHLIGHT ================= */
  {
    kind: 'flashlight',
    group: 'household',
    noun: 'Flashlight',
    syn: ['flashlight', 'torch', 'maglite', 'penlight', 'lantern', 'light'],
    tags: ['household', 'metal', 'tech'],
    desc: 'metal flashlight with glowing lens',
    color: '#2d2f36',
    accent: '#fff2a8',
    variants: [
      { v: 'mag', p: { t: 0, L: 0.3, r: 0.017, rh: 0.027, hl: 0.07 } },
      { v: 'pen', p: { t: 1, L: 0.14, r: 0.0075, rh: 0.0085, hl: 0.03 }, desc: 'slim penlight with pocket clip', noun: 'Penlight' },
      { v: 'lantern', p: { t: 2, L: 0.15, r: 0, rh: 0.065, hl: 0 }, desc: 'boxy battery lantern with carry handle', noun: 'Lantern' },
    ],
    draw(k, p) {
      if (p.t === 2) {
        k.tube('rubber', [[0, -0.04, 0.05], [0, 0, 0.04], [0, 0.008, 0], [0, 0, -0.04], [0, -0.04, -0.05]], 0.01, 10, 5);
        k.box('main', [0.1, 0.11, 0.12], { p: [0, -0.1, 0] });
        k.zrod('main', -0.1, -0.055, 0.065, 0.058, 12, 0, -0.1);
        k.zrod('glow', -0.104, -0.1, 0.055, 0.055, 12, 0, -0.1);
        k.box('#f2c94c', [0.104, 0.02, 0.124], { p: [0, -0.14, 0] });
        k.box('rubber', [0.02, 0.012, 0.03], { p: [0, -0.04, 0.035] });
        return;
      }
      const { L, r, rh, hl } = p;
      const zr = L * 0.35;
      const zt = -L * 0.65;
      k.zrod('main', zt + hl - 0.002, zr - 0.02, r, r, 12);
      k.zlathe(
        'main',
        [
          [0.0001, zt],
          [rh, zt],
          [rh, zt + hl * 0.2],
          [rh * 0.92, zt + hl * 0.45],
          [r, zt + hl],
        ],
        12,
      );
      k.zrod('glow', zt - 0.002, zt, rh * 0.85, rh * 0.85, 12);
      k.zrod('dark', zr - 0.02, zr, r * 1.06, r, 12);
      if (p.t === 0) {
        for (let i = 0; i < 3; i++) {
          const z = zt + hl + 0.05 + i * 0.025;
          k.zrod('accent', z, z + 0.008, r * 1.06, r * 1.06, 12);
        }
        k.box('rubber', [0.01, 0.006, 0.016], { p: [0, r, zt + hl + 0.02] });
      } else {
        k.box('metal', [0.003, 0.004, 0.05], { p: [0, r + 0.002, zr - 0.035] });
        k.box('metal', [0.004, 0.004, 0.006], { p: [0, r + 0.001, zr - 0.011] });
      }
    },
    anchors(p) {
      if (p.t === 2) return { tip: [0, -0.1, -0.104], rear: [0, -0.1, 0.06], top: [0, 0.018, 0], grip: [0, -0.155, 0], under: [0, -0.155, -0.04], side: [0.05, -0.1, 0] };
      const { L, r, hl } = p;
      const zr = L * 0.35;
      const zt = -L * 0.65;
      const zm = (zt + hl + zr) / 2;
      return { tip: [0, 0, zt - 0.002], rear: [0, 0, zr], top: [0, r, zm], grip: [0, -r, 0], under: [0, -r, zt + hl + 0.01], side: [r, 0, zm] };
    },
    roles: ['barrel', 'deco'],
    melee: { swing: 'bash', weight: 'light' },
    guns: ['pistol', 'rifle'],
    fireMode: 'hitscan',
    ammo: 'light beams',
  },
];
