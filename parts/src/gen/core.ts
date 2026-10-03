/**
 * CORE parts: receivers / bodies. Each sits at the origin and exposes sockets.
 * Gun frame convention: forward = -Z, up = +Y. Body spans roughly z in [-L/2, L/2].
 */
import type { PartDef, Socket, Vec3 } from '../types';
import { part, S } from '../lib/define';
import { Kit, chamferRect, rectPts, type Pt } from '../lib/kit';

type GunClass = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'lmg';
type Style =
  | 'block'
  | 'round'
  | 'bevel'
  | 'skeleton'
  | 'bullpup'
  | 'toy'
  | 'scifi'
  | 'steampunk'
  | 'tactical'
  | 'organic';

const DIMS: Record<GunClass, [number, number, number]> = {
  pistol: [0.19, 0.06, 0.032],
  smg: [0.28, 0.085, 0.048],
  rifle: [0.4, 0.095, 0.055],
  shotgun: [0.38, 0.09, 0.06],
  sniper: [0.46, 0.09, 0.055],
  lmg: [0.48, 0.12, 0.08],
};

const STYLE_TAGS: Record<Style, string[]> = {
  block: ['military', 'boxy'],
  round: ['military', 'retro'],
  bevel: ['sleek', 'modern'],
  skeleton: ['sleek', 'light', 'modern'],
  bullpup: ['military', 'compact', 'modern'],
  toy: ['toy', 'chunky'],
  scifi: ['scifi', 'sleek'],
  steampunk: ['steampunk', 'ornate'],
  tactical: ['military', 'tactical', 'heavy'],
  organic: ['organic', 'alien', 'weird'],
};

const STYLE_DESC: Record<Style, string> = {
  block: 'chamfered boxy receiver with top rail',
  round: 'tubular receiver over trigger housing',
  bevel: 'sleek sloped-front receiver',
  skeleton: 'skeletonized cutout receiver',
  bullpup: 'bullpup body, magazine behind grip',
  toy: 'chunky rounded toy receiver with big bolts',
  scifi: 'angular sci-fi receiver with glow strips',
  steampunk: 'brass and wood steampunk receiver with gear',
  tactical: 'stacked upper/lower tactical receiver with rails',
  organic: 'blobby alien organic receiver',
};

function rail(k: Kit, len: number, w: number, y: number, z = 0, slots = 7) {
  k.box('dark', [w, 0.008, len], { p: [0, y + 0.004, z] });
  for (let i = 0; i < slots; i++) {
    const zz = z - len / 2 + ((i + 0.5) / slots) * len;
    k.box('dark', [w * 1.15, 0.006, len / slots / 2.2], { p: [0, y + 0.011, zz] });
  }
}

function gunCore(cls: GunClass, style: Style): PartDef {
  let [L, H, W] = DIMS[cls];
  const yb = H * 0.18;
  const bull = style === 'bullpup';
  if (bull) L *= 1.3;
  const sockets: Record<string, Socket> = {
    barrel: S([0, yb, -L / 2]),
    stock: S([0, yb * 0.6, L / 2]),
    grip: S([0, -H / 2, bull ? -L * 0.12 : L * 0.22]),
    mag: S([0, -H / 2, bull ? L * 0.22 : -L * 0.12]),
    top: S([0, H / 2 + (style === 'block' || style === 'tactical' ? 0.012 : 0), bull ? -L * 0.1 : L * 0.02]),
    under: S([0, -H / 2, -L * 0.42]),
    side: S([W / 2, 0, -L * 0.2], [1, 0, 0]),
    deco: S([-W / 2, H * 0.05, L * 0.05], [-1, 0, 0]),
  };
  if (cls === 'pistol') {
    sockets.grip = S([0, -H / 2, L * 0.28]);
    sockets.mag = S([0, -H / 2 - 0.01, L * 0.32]);
    sockets.under = S([0, -H / 2, -L * 0.3]);
  }
  if (cls === 'shotgun' || cls === 'lmg') {
    sockets.tank = S([0, -H / 2, -L * 0.1]);
  }

  const draw = (k: Kit) => {
    switch (style) {
      case 'block': {
        k.extrude('main', chamferRect(-L / 2, -H / 2, L / 2, H / 2, H * 0.18), W, 'zy', undefined, 0.003);
        rail(k, L * 0.85, W * 0.55, H / 2, 0, 8);
        k.box('dark', [0.004, H * 0.32, L * 0.24], { p: [W / 2 + 0.002, H * 0.12, -L * 0.05] });
        k.box('accent', [0.01, 0.012, 0.03], { p: [W / 2 + 0.006, H * 0.12, L * 0.12] });
        break;
      }
      case 'round': {
        k.zrod('main', -L / 2, L / 2, H * 0.36, H * 0.36, 10, 0, yb * 0.6);
        k.zrod('metal', -L / 2 - 0.006, -L / 2 + 0.01, H * 0.39, H * 0.39, 10, 0, yb * 0.6);
        k.zrod('metal', L / 2 - 0.01, L / 2 + 0.006, H * 0.39, H * 0.39, 10, 0, yb * 0.6);
        k.box('dark', [W * 0.75, H * 0.42, L * 0.55], { p: [0, -H * 0.27, L * 0.05] });
        k.rod('accent', [W * 0.3, yb, L * 0.1], [W * 0.75, yb, L * 0.1], 0.006, 0.006, 6);
        k.ball('accent', 0.011, [W * 0.78, yb, L * 0.1], 0);
        break;
      }
      case 'bevel': {
        const pts: Pt[] = [
          [-L / 2, -H / 2],
          [L / 2, -H / 2],
          [L / 2, H * 0.3],
          [L * 0.35, H / 2],
          [-L / 2 + H * 0.7, H / 2],
          [-L / 2, H * 0.05],
        ];
        k.extrude('main', pts, W, 'zy', undefined, 0.004);
        k.box('accent', [W + 0.01, 0.008, L * 0.6], { p: [0, -H * 0.1, 0] });
        k.box('dark', [0.004, H * 0.22, L * 0.18], { p: [W / 2 + 0.004, H * 0.18, -L * 0.02] });
        break;
      }
      case 'skeleton': {
        const outer = chamferRect(-L / 2, -H / 2, L / 2, H / 2, H * 0.12);
        const holes: Pt[][] = [];
        const n = cls === 'pistol' ? 2 : 3;
        for (let i = 0; i < n; i++) {
          const z0 = -L / 2 + 0.02 + (i * (L - 0.04)) / n;
          const z1 = z0 + (L - 0.04) / n - 0.018;
          holes.push(rectPts(z0, -H * 0.3, z1, H * 0.25).reverse() as Pt[]);
        }
        k.extrude('main', outer, W, 'zy', undefined, 0, holes);
        k.zrod('dark', -L / 2, L / 2, H * 0.16, H * 0.16, 6, 0, 0);
        rail(k, L * 0.7, W * 0.5, H / 2, -L * 0.05, 6);
        break;
      }
      case 'bullpup': {
        const pts: Pt[] = [
          [-L / 2, -H * 0.1],
          [-L / 2 + 0.05, -H / 2],
          [L / 2 - 0.02, -H / 2 - H * 0.35],
          [L / 2, -H / 2 - H * 0.35],
          [L / 2, H / 2],
          [-L / 2 + 0.03, H / 2],
        ];
        k.extrude('main', pts, W, 'zy', undefined, 0.004);
        k.box('rubber', [W * 1.05, H * 1.3, 0.02], { p: [0, -H * 0.15, L / 2 + 0.008] });
        k.box('dark', [W * 0.5, H * 0.35, L * 0.28], { p: [0, H * 0.62, -L * 0.15] });
        k.box('accent', [0.004, H * 0.2, L * 0.15], { p: [W / 2 + 0.002, H * 0.05, L * 0.2] });
        break;
      }
      case 'toy': {
        k.zlathe(
          'main',
          [
            [0, -L / 2],
            [H * 0.4, -L / 2 + 0.005],
            [H * 0.55, -L / 2 + 0.04],
            [H * 0.58, 0],
            [H * 0.55, L / 2 - 0.04],
            [H * 0.4, L / 2 - 0.005],
            [0, L / 2],
          ],
          8,
          [0, 0, 0],
        );
        k.torus('accent', H * 0.58, H * 0.07, { p: [0, 0, -L * 0.18] }, 3, 10);
        k.torus('accent', H * 0.58, H * 0.07, { p: [0, 0, L * 0.18] }, 3, 10);
        k.ball('accent', H * 0.18, [W * 0.55 + H * 0.12, 0, 0], 0);
        k.ball('accent', H * 0.18, [-W * 0.55 - H * 0.12, 0, 0], 0);
        k.box('white', [H * 0.25, 0.012, L * 0.4], { p: [0, H * 0.56, 0] });
        break;
      }
      case 'scifi': {
        const pts: Pt[] = [
          [-L / 2, -H * 0.15],
          [-L / 2 + H * 0.3, -H / 2],
          [L / 2 - H * 0.25, -H / 2],
          [L / 2, -H * 0.2],
          [L / 2, H * 0.35],
          [L * 0.2, H / 2],
          [-L / 2 + H * 0.2, H * 0.35],
        ];
        k.extrude('main', pts, W, 'zy', undefined, 0.003);
        k.box('glow', [0.004, 0.008, L * 0.7], { p: [W / 2 + 0.004, 0, 0] });
        k.box('glow', [0.004, 0.008, L * 0.7], { p: [-W / 2 - 0.004, 0, 0] });
        k.extrude(
          'dark',
          [
            [-0.03, 0],
            [0.04, 0],
            [0.02, H * 0.3],
          ],
          0.008,
          'zy',
          { p: [0, H * 0.42, L * 0.15] },
        );
        k.box('dark', [W * 0.7, H * 0.2, L * 0.3], { p: [0, -H * 0.45, -L * 0.05] });
        break;
      }
      case 'steampunk': {
        k.box('wood', [W * 0.9, H * 0.55, L], { p: [0, -H * 0.2, 0] });
        k.zrod('brass', -L / 2, L / 2, H * 0.3, H * 0.3, 10, 0, yb);
        for (const z of [-L * 0.4, 0, L * 0.4]) k.rod('main', [0, yb, z - 0.008], [0, yb, z + 0.008], H * 0.34, H * 0.34, 10, true);
        for (let i = 0; i < 4; i++) k.ball('brass', 0.005, [W * 0.47, -H * 0.3, -L * 0.35 + i * L * 0.23], 0);
        // gear on side
        k.torus('brass', H * 0.18, H * 0.04, { p: [W * 0.5, -H * 0.1, L * 0.15], r: [0, Math.PI / 2, 0] }, 3, 8);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          k.box('brass', [0.01, 0.012, 0.012], {
            p: [W * 0.5, -H * 0.1 + Math.sin(a) * H * 0.24, L * 0.15 + Math.cos(a) * H * 0.24],
            r: [a, 0, 0],
          });
        }
        k.rod('metal', [-W * 0.2, yb + H * 0.25, L * 0.2], [-W * 0.2, yb + H * 0.5, L * 0.3], 0.006, 0.006, 6);
        k.ball('accent', 0.012, [-W * 0.2, yb + H * 0.5, L * 0.3], 0);
        break;
      }
      case 'tactical': {
        k.box('main', [W, H * 0.5, L], { p: [0, H * 0.25, 0] });
        k.box('dark', [W * 0.85, H * 0.5, L * 0.7], { p: [0, -H * 0.25, L * 0.1] });
        rail(k, L, W * 0.55, H / 2, 0, 10);
        k.box('dark', [0.006, H * 0.18, L * 0.5], { p: [W / 2 + 0.003, H * 0.25, -L * 0.15] });
        for (let i = 0; i < 4; i++)
          k.box('dark', [0.01, 0.005, 0.01], { p: [W / 2 + 0.006, H * 0.25 + 0.008, -L * 0.35 + i * 0.04] });
        k.box('accent', [W * 0.6, 0.014, 0.035], { p: [0, H * 0.45, L * 0.45] });
        break;
      }
      case 'organic': {
        k.ball('main', 1, [0, 0, 0], 1, [W * 0.75, H * 0.6, L * 0.55]);
        k.ball('main', 1, [0, H * 0.1, -L * 0.3], 1, [W * 0.55, H * 0.45, L * 0.3]);
        k.ball('main', 1, [0, -H * 0.05, L * 0.3], 1, [W * 0.6, H * 0.5, L * 0.28]);
        for (let i = 0; i < 4; i++)
          k.ball('accent', H * 0.12, [(i % 2 ? 1 : -1) * W * 0.6, H * 0.2, -L * 0.25 + i * L * 0.16], 0);
        k.ball('glow', H * 0.14, [0, H * 0.5, L * 0.1], 0);
        break;
      }
    }
    // class-specific details
    if (cls === 'pistol' && style !== 'organic' && style !== 'toy') {
      for (let i = 0; i < 5; i++)
        k.box('dark', [W + 0.004, H * 0.35, 0.004], { p: [0, H * 0.18, L * 0.32 + i * 0.008] });
      k.box('dark', [0.004, 0.012, 0.02], { p: [0, H / 2 + 0.004, -L * 0.45] });
    }
    if (cls === 'sniper') {
      k.rod('metal', [W * 0.4, yb, L * 0.3], [W * 1.4, yb - 0.02, L * 0.32], 0.005, 0.005, 6);
      k.ball('dark', 0.012, [W * 1.45, yb - 0.022, L * 0.32], 0);
    }
    if (cls === 'lmg' && style !== 'organic') {
      k.box('dark', [W * 0.95, H * 0.22, L * 0.4], { p: [0, H * 0.58, -L * 0.05] });
      k.zrod('metal', -L * 0.25, L * 0.15, 0.006, 0.006, 6, W * 0.45, H * 0.7);
      k.rod('dark', [0, H * 0.7, -L * 0.25], [0, H * 0.95, -L * 0.18], 0.008, 0.008, 6);
      k.rod('dark', [0, H * 0.95, -L * 0.18], [0, H * 0.95, -L * 0.02], 0.008, 0.008, 6);
      k.rod('dark', [0, H * 0.95, -L * 0.02], [0, H * 0.7, L * 0.05], 0.008, 0.008, 6);
      k.box('dark', [0.012, H * 0.25, L * 0.12], { p: [-W / 2 - 0.006, 0, -L * 0.12] });
    }
    if (cls === 'shotgun' && style !== 'organic') {
      k.box('dark', [W * 0.5, 0.005, L * 0.25], { p: [0, -H / 2 - 0.002, L * 0.05] });
    }
    if (cls === 'smg' && style !== 'organic' && style !== 'toy') {
      k.zrod('dark', -L * 0.48, -L * 0.25, 0.006, 0.006, 6, W * 0.35, H * 0.38);
    }
    if (cls === 'rifle' && style !== 'organic' && style !== 'toy') {
      k.ball('dark', 0.011, [W / 2 + 0.004, H * 0.2, L * 0.25], 0);
    }
  };

  const classes = [cls as string];
  if (bull && cls === 'rifle') classes.push('smg');
  if (style === 'toy' || style === 'organic' || style === 'steampunk' || style === 'scifi') classes.push('weird');
  if (style === 'toy') classes.push('bubble_gun');
  if ((cls === 'rifle' || cls === 'shotgun') && (style === 'round' || style === 'tactical')) classes.push('flamethrower');
  if (cls === 'shotgun' && (style === 'block' || style === 'round')) classes.push('grenade_launcher');
  const name = cls === 'pistol' ? 'pistol frame/slide' : `${cls} receiver`;
  return part({
    id: `core-${cls}-${style}`,
    category: 'core',
    classes,
    tags: [...STYLE_TAGS[style], cls === 'lmg' ? 'heavy' : cls === 'pistol' ? 'compact' : 'standard'],
    desc: `${STYLE_DESC[style]} (${name})`.slice(0, 80),
    attach: '',
    sockets,
    draw,
  });
}

/* ------------------------------------------------------------------ */
/* Rocket launcher bodies                                              */
/* ------------------------------------------------------------------ */

type RLStyle = 'bazooka' | 'rpg' | 'modern' | 'quad' | 'twin' | 'cartoon' | 'steampunk' | 'scifi';

function rocketCore(style: RLStyle, L: number, r: number, suffix: string, desc: string, tags: string[]): PartDef {
  const zf = -L * 0.6;
  const zb = L * 0.4;
  const multi = style === 'quad' || style === 'twin';
  const top = multi ? r * 2.2 : r;
  const bot = multi ? r * 1.2 : r;
  const sockets: Record<string, Socket> = {
    muzzle: S([0, 0, zf]),
    stock: S([0, 0, zb]),
    grip: S([0, -bot, -L * 0.02]),
    under: S([0, -bot, -L * 0.3]),
    top: S([multi ? -r * 1.2 : 0, top, -L * 0.15]),
    side: S([multi ? r * 2.3 : r, 0, -L * 0.1], [1, 0, 0]),
    deco: S([multi ? -r * 2.3 : -r, 0, L * 0.1], [-1, 0, 0]),
    mag: S([0, -bot, L * 0.18]),
  };
  const draw = (k: Kit) => {
    switch (style) {
      case 'bazooka':
        k.zrod('main', zf, zb, r, r, 10);
        k.zlathe('main', [[r * 0.95, zb - 0.01], [r * 1.35, zb + 0.06], [r * 1.25, zb + 0.065]], 10);
        k.zrod('dark', zf - 0.015, zf + 0.02, r * 1.12, r * 1.12, 10);
        for (const z of [-L * 0.3, L * 0.1]) k.zrod('metal', z - 0.01, z + 0.01, r * 1.08, r * 1.08, 10);
        k.box('dark', [0.012, r * 1.3, 0.06], { p: [-r * 0.9, r * 0.6, -L * 0.25] });
        break;
      case 'rpg':
        k.zrod('main', zf, zb, r * 0.7, r * 0.7, 8);
        k.zrod('wood', -L * 0.25, L * 0.08, r * 0.95, r * 0.95, 8);
        k.zlathe('main', [[r * 0.65, zb - 0.02], [r * 1.25, zb + 0.08], [r * 1.15, zb + 0.085]], 8);
        k.zrod('dark', zf, zf + 0.04, r * 0.85, r * 0.85, 8);
        k.zrod('dark', L * 0.12, L * 0.2, r * 0.82, r * 0.82, 8);
        break;
      case 'modern':
        k.zrod('main', zf, zb, r, r, 8);
        k.zrod('accent', zf - 0.01, zf + 0.05, r * 1.15, r * 1.15, 8);
        k.zrod('accent', zb - 0.05, zb + 0.01, r * 1.15, r * 1.15, 8);
        k.box('dark', [r * 1.2, r * 0.25, L * 0.4], { p: [0, r * 1.05, -L * 0.1] });
        k.box('dark', [r * 0.9, r * 0.6, 0.06], { p: [-r * 1.3, 0, -L * 0.05] });
        break;
      case 'quad':
      case 'twin': {
        const pos: [number, number][] =
          style === 'quad'
            ? [
                [-r * 1.05, r * 1.05],
                [r * 1.05, r * 1.05],
                [-r * 1.05, -r * 0.05],
                [r * 1.05, -r * 0.05],
              ]
            : [
                [-r * 1.05, r * 0.5],
                [r * 1.05, r * 0.5],
              ];
        // muzzle points at the first tube's center
        sockets.muzzle = S([pos[0][0], pos[0][1], zf]);
        for (const [x, y] of pos) {
          k.zrod('main', zf, zb, r, r, 8, x, y);
          k.zrod('dark', zf - 0.005, zf + 0.004, r * 0.75, r * 0.75, 8, x, y);
        }
        const cy = style === 'quad' ? r * 0.5 : r * 0.5;
        const hh = style === 'quad' ? r * 2.4 : r * 1.4;
        k.box('accent', [r * 4.4, hh, 0.03], { p: [0, cy, zf + 0.06] });
        k.box('accent', [r * 4.4, hh, 0.03], { p: [0, cy, zb - 0.06] });
        break;
      }
      case 'cartoon':
        k.zlathe(
          'main',
          [
            [r * 1.25, zf],
            [r * 1.3, zf + 0.02],
            [r, zf + 0.05],
            [r, zb - 0.05],
            [r * 1.4, zb],
          ],
          8,
        );
        for (let i = 0; i < 4; i++) {
          const z = zf + 0.1 + i * ((zb - zf - 0.2) / 3);
          k.zrod('white', z - 0.015, z + 0.015, r * 1.03, r * 1.03, 8);
        }
        k.ball('accent', r * 0.35, [0, r * 1.1, L * 0.1], 1);
        break;
      case 'steampunk':
        k.zlathe('brass', [[r * 1.3, zf], [r * 1.1, zf + 0.04], [r * 0.9, zf + 0.1], [r, zb - 0.1], [r * 1.2, zb]], 10);
        k.box('wood', [r * 1.2, r * 0.7, L * 0.7], { p: [0, -r * 1.0, -L * 0.05] });
        for (const z of [-L * 0.35, -L * 0.05, L * 0.25]) k.torus('main', r * 1.0, r * 0.12, { p: [0, 0, z] }, 4, 10);
        k.zrod('metal', -L * 0.2, L * 0.2, r * 0.18, r * 0.18, 6, r * 1.1, r * 0.6);
        k.lathe('brass', [[0, 0], [r * 0.4, 0.002], [r * 0.4, 0.015], [0, 0.016]], 8, {
          p: [-r * 0.9, r * 0.6, 0],
          r: [0, 0, Math.PI / 2],
        });
        break;
      case 'scifi':
        k.extrude('main', chamferRect(zf, -r, zb, r, r * 0.5), r * 1.8, 'zy', undefined, 0.004);
        k.zrod('dark', zf - 0.01, zf + 0.02, r * 0.7, r * 0.7, 8);
        k.box('glow', [r * 1.85, 0.01, L * 0.6], { p: [0, r * 0.35, 0] });
        k.box('glow', [r * 1.85, 0.01, L * 0.6], { p: [0, -r * 0.35, 0] });
        break;
    }
  };
  return part({
    id: `core-rocket-${style}${suffix}`,
    category: 'core',
    classes: style === 'cartoon' || style === 'steampunk' || style === 'scifi' ? ['rocket_launcher', 'weird'] : ['rocket_launcher'],
    tags,
    desc,
    attach: '',
    sockets,
    draw,
  });
}

/* ------------------------------------------------------------------ */
/* Grenade launcher bodies                                             */
/* ------------------------------------------------------------------ */

function grenadeCore(style: string, desc: string, tags: string[], classes = ['grenade_launcher']): PartDef {
  const L = 0.34;
  const H = 0.1;
  const W = 0.07;
  const yb = 0.03;
  const sockets: Record<string, Socket> = {
    barrel: S([0, yb, -L / 2]),
    stock: S([0, yb * 0.5, L / 2]),
    grip: S([0, -H / 2, L * 0.25]),
    mag: S([0, yb, 0]),
    top: S([0, H / 2 + 0.02, -L * 0.1]),
    under: S([0, -H / 2, -L * 0.35]),
    side: S([W / 2, 0, -L * 0.1], [1, 0, 0]),
    deco: S([-W / 2, 0, L * 0.1], [-1, 0, 0]),
  };
  const draw = (k: Kit) => {
    switch (style) {
      case 'revolver':
        // open frame around a cylinder (cylinder attaches at mag)
        k.box('main', [W * 0.6, 0.02, L], { p: [0, H / 2 + 0.01, 0] });
        k.box('main', [W * 0.9, H * 1.3, 0.03], { p: [0, -0.01, -L * 0.25] });
        k.box('main', [W * 0.9, H * 1.3, 0.05], { p: [0, -0.01, L * 0.28] });
        k.box('dark', [W * 0.5, 0.025, L * 0.6], { p: [0, -H * 0.7, 0.01] });
        k.zrod('metal', -L * 0.25, L * 0.28, 0.008, 0.008, 6, 0, yb - 0.075);
        break;
      case 'break':
        k.extrude('wood', chamferRect(-L / 2, -H / 2, L / 2, H * 0.3, 0.02), W * 0.8, 'zy', undefined, 0.003);
        k.box('main', [W * 0.85, H * 0.5, L * 0.35], { p: [0, yb * 0.5, -L * 0.15] });
        k.rod('metal', [-W * 0.45, -0.01, -L * 0.32], [W * 0.45, -0.01, -L * 0.32], 0.01, 0.01, 8);
        k.box('dark', [0.01, 0.03, 0.02], { p: [0, H * 0.45, -L * 0.1] });
        break;
      case 'pump':
        k.box('main', [W * 0.8, H * 0.7, L], { p: [0, 0, 0] });
        k.zrod('dark', -L / 2, L / 2, H * 0.28, H * 0.28, 8, 0, -H * 0.5);
        k.box('accent', [W * 0.85, 0.01, L * 0.8], { p: [0, H * 0.36, 0] });
        break;
      case 'drum':
        k.extrude('main', chamferRect(-L / 2, -H / 2, L / 2, H / 2, 0.025), W, 'zy', undefined, 0.004);
        rail(k, L * 0.8, W * 0.5, H / 2, 0, 8);
        k.zrod('dark', -L * 0.1, L * 0.1, H * 0.6, H * 0.6, 10, 0, -H * 0.6);
        sockets.mag = S([0, -H / 2, -L * 0.15]);
        break;
      case 'compact':
        k.box('main', [W * 0.85, H * 0.8, L * 0.6], { p: [0, 0, 0.02] });
        k.box('dark', [0.01, H * 0.5, L * 0.3], { p: [W * 0.43, 0, 0] });
        k.ball('accent', 0.012, [W * 0.45, H * 0.25, L * 0.18], 0);
        sockets.barrel = S([0, yb, -L * 0.28]);
        sockets.stock = S([0, yb * 0.5, L * 0.32]);
        break;
      case 'toy':
        k.ball('main', 1, [0, 0, 0], 1, [W * 0.75, H * 0.7, L * 0.55]);
        k.torus('accent', H * 0.7, 0.012, { p: [0, 0, -L * 0.2] }, 4, 10);
        k.ball('accent', 0.025, [0, H * 0.7, 0.05], 1);
        break;
      case 'steampunk':
        k.zlathe('brass', [[H * 0.5, -L / 2], [H * 0.62, -L * 0.2], [H * 0.62, L * 0.2], [H * 0.45, L / 2]], 10, [0, yb, 0]);
        for (const z of [-L * 0.25, L * 0.1]) k.torus('main', H * 0.63, 0.008, { p: [0, yb, z] }, 4, 10);
        k.ball('brass', 0.016, [W * 0.55, yb + 0.03, 0], 1);
        k.box('wood', [W * 0.6, H * 0.4, L * 0.5], { p: [0, -H * 0.4, L * 0.15] });
        break;
      case 'scifi':
        k.extrude(
          'main',
          [
            [-L / 2, 0],
            [-L * 0.3, -H / 2],
            [L / 2, -H / 2],
            [L / 2, H / 2],
            [-L * 0.3, H / 2],
          ],
          W,
          'zy',
          undefined,
          0.004,
        );
        k.box('glow', [W + 0.006, 0.008, L * 0.6], { p: [0, 0, 0.03] });
        k.zrod('glow', -L / 2 - 0.004, -L / 2 + 0.004, H * 0.25, H * 0.25, 8, 0, yb);
        break;
    }
  };
  return part({ id: `core-grenade-${style}`, category: 'core', classes, tags, desc, attach: '', sockets, draw });
}

/* ------------------------------------------------------------------ */
/* Flamethrower bodies                                                 */
/* ------------------------------------------------------------------ */

function flameCore(style: string, desc: string, tags: string[]): PartDef {
  const L = style === 'compact' ? 0.24 : 0.42;
  const H = 0.09;
  const W = 0.06;
  const sockets: Record<string, Socket> = {
    barrel: S([0, 0.02, -L / 2]),
    stock: S([0, 0.01, L / 2]),
    grip: S([0, -H / 2, L * 0.22]),
    tank: S([0, -H / 2, -L * 0.12]),
    top: S([0, H / 2, 0]),
    under: S([0, -H / 2, -L * 0.42]),
    side: S([W / 2, 0, -L * 0.15], [1, 0, 0]),
    deco: S([-W / 2, 0, L * 0.1], [-1, 0, 0]),
  };
  const draw = (k: Kit) => {
    switch (style) {
      case 'wand':
        k.zrod('main', -L / 2, L / 2, H * 0.28, H * 0.28, 8, 0, 0.02);
        for (const z of [-L * 0.35, -L * 0.05, L * 0.3]) k.zrod('metal', z - 0.012, z + 0.012, H * 0.36, H * 0.36, 8, 0, 0.02);
        k.zrod('dark', -L * 0.3, L * 0.35, 0.008, 0.008, 6, 0, -0.012);
        k.box('accent', [0.012, 0.03, 0.03], { p: [0, -0.02, -L * 0.15] });
        break;
      case 'rifle':
        k.extrude('main', chamferRect(-L / 2, -H / 2, L / 2, H / 2, 0.02), W, 'zy', undefined, 0.003);
        k.box('accent', [W + 0.008, 0.012, L * 0.5], { p: [0, H * 0.15, 0] });
        k.zrod('metal', -L / 2, L * 0.2, 0.01, 0.01, 6, W * 0.55, -H * 0.2);
        break;
      case 'backpack':
        k.zrod('main', -L / 2, L / 2, H * 0.32, H * 0.32, 8, 0, 0.01);
        k.tube('rubber', [[0, -0.02, L * 0.35], [0, -0.09, L * 0.42], [0.02, -0.16, L * 0.36], [0.06, -0.2, L * 0.25]], 0.014, 10, 5);
        k.ball('metal', 0.02, [0, -0.02, L * 0.35], 0);
        k.box('dark', [W * 0.7, 0.02, 0.06], { p: [0, H * 0.4, 0] });
        break;
      case 'steampunk':
        k.zlathe('brass', [[H * 0.3, -L / 2], [H * 0.5, -L * 0.35], [H * 0.55, 0], [H * 0.5, L * 0.35], [H * 0.3, L / 2]], 10);
        for (let i = 0; i < 3; i++)
          k.torus('main', H * 0.52, 0.006, { p: [0, 0, -L * 0.25 + i * L * 0.25] }, 4, 10);
        k.lathe('white', [[0, 0], [0.022, 0], [0.022, 0.012], [0, 0.013]], 10, { p: [0, H * 0.5, -0.02] });
        k.lathe('brass', [[0.024, -0.003], [0.024, 0.008]], 10, { p: [0, H * 0.5, -0.02] });
        k.rod('dark', [0, H * 0.55, -0.02], [0.012, H * 0.55, -0.025], 0.002, 0.002, 4);
        break;
      case 'scifi':
        k.extrude(
          'main',
          [
            [-L / 2, -H * 0.1],
            [-L * 0.3, -H / 2],
            [L / 2, -H / 2],
            [L / 2, H * 0.3],
            [L * 0.3, H / 2],
            [-L * 0.35, H * 0.4],
          ],
          W,
          'zy',
          undefined,
          0.004,
        );
        for (let i = 0; i < 4; i++)
          k.box('glow', [W + 0.008, 0.006, 0.012], { p: [0, H * 0.05, -L * 0.3 + i * 0.03] });
        k.box('dark', [W * 0.4, 0.05, L * 0.25], { p: [0, H * 0.55, 0.05] });
        break;
      case 'toy':
        k.zlathe('main', [[0, -L / 2], [H * 0.4, -L / 2 + 0.02], [H * 0.55, -L * 0.2], [H * 0.6, L * 0.2], [H * 0.4, L / 2], [0, L / 2]], 8);
        k.ball('accent', H * 0.3, [0, H * 0.55, L * 0.15], 1);
        k.torus('white', H * 0.58, 0.01, { p: [0, 0, 0] }, 4, 10);
        break;
      case 'dragon':
        k.ball('main', 1, [0, 0, 0], 1, [W * 0.7, H * 0.6, L * 0.5]);
        for (let i = 0; i < 5; i++) {
          const z = -L * 0.35 + i * L * 0.17;
          k.rod('accent', [0, H * 0.45, z], [0, H * 0.75, z + 0.03], 0.016, 0, 4);
        }
        k.ball('glow', 0.012, [W * 0.45, H * 0.1, -L * 0.3], 0);
        k.ball('glow', 0.012, [-W * 0.45, H * 0.1, -L * 0.3], 0);
        break;
      case 'compact':
        k.box('main', [W * 0.8, H * 0.8, L], {});
        k.zrod('accent', -L / 2, L / 2, 0.012, 0.012, 6, W * 0.4, H * 0.3);
        k.box('dark', [W * 0.5, 0.01, L * 0.6], { p: [0, H * 0.42, 0] });
        break;
    }
  };
  return part({
    id: `core-flame-${style}`,
    category: 'core',
    classes: style === 'toy' || style === 'dragon' ? ['flamethrower', 'weird'] : ['flamethrower'],
    tags,
    desc,
    attach: '',
    sockets,
    draw,
  });
}

/* ------------------------------------------------------------------ */
/* Bubble gun bodies                                                   */
/* ------------------------------------------------------------------ */

function bubbleCore(style: string, desc: string, tags: string[]): PartDef {
  const L = 0.3;
  const H = 0.1;
  const W = 0.07;
  const sockets: Record<string, Socket> = {
    barrel: S([0, 0.01, -L / 2]),
    muzzle: S([0, 0.01, -L / 2 - 0.01]),
    stock: S([0, 0, L / 2]),
    grip: S([0, -H / 2, L * 0.2]),
    tank: S([0, H / 2, -0.02], [0, 1, 0]),
    mag: S([0, -H / 2, -L * 0.15]),
    top: S([0, H / 2, L * 0.25]),
    under: S([0, -H / 2, -L * 0.38]),
    side: S([W / 2, 0, 0], [1, 0, 0]),
    deco: S([-W / 2, 0, 0], [-1, 0, 0]),
  };
  const draw = (k: Kit) => {
    switch (style) {
      case 'raygun':
        k.zlathe('main', [[0, L / 2], [H * 0.35, L * 0.45], [H * 0.5, L * 0.2], [H * 0.42, -L * 0.2], [H * 0.25, -L / 2], [0, -L / 2]], 10);
        for (let i = 0; i < 3; i++) k.torus('accent', H * 0.38 - i * 0.004, 0.008, { p: [0, 0.01, -L * 0.25 - i * 0.03] }, 4, 10);
        for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3])
          k.extrude('accent', [[0, 0], [0.07, 0], [0.07, 0.05]], 0.006, 'zy', { p: [0, 0, L * 0.25], r: [0, 0, a] });
        break;
      case 'blaster':
        k.extrude('main', chamferRect(-L / 2, -H / 2, L / 2, H / 2, 0.025), W, 'zy', undefined, 0.006);
        k.box('accent', [W + 0.01, 0.02, L * 0.7], { p: [0, 0, 0] });
        k.ball('white', 0.016, [W / 2 + 0.01, H * 0.25, -L * 0.2], 1);
        k.ball('white', 0.016, [-W / 2 - 0.01, H * 0.25, -L * 0.2], 1);
        break;
      case 'fan':
        k.zrod('main', -L * 0.15, L / 2, H * 0.45, H * 0.45, 10);
        k.zrod('main', -L / 2, -L * 0.15, H * 0.7, H * 0.55, 12);
        for (let i = 0; i < 4; i++) k.torus('dark', H * 0.2 + i * 0.012, 0.003, { p: [0, 0, -L / 2 - 0.002] }, 3, 12);
        k.box('dark', [H * 1.3, 0.004, 0.004], { p: [0, 0, -L / 2 - 0.003] });
        k.box('dark', [0.004, H * 1.3, 0.004], { p: [0, 0, -L / 2 - 0.003] });
        sockets.barrel = S([0, 0, -L / 2]);
        sockets.muzzle = S([0, 0, -L / 2]);
        break;
      case 'duck':
        k.ball('main', 1, [0, 0, 0.03], 1, [W * 0.8, H * 0.6, L * 0.5]);
        k.ball('main', H * 0.42, [0, H * 0.55, -L * 0.25], 1);
        k.extrude('accent', [[0, 0], [-0.07, 0.01], [-0.075, 0.025], [0, 0.04]], 0.04, 'zy', { p: [0, H * 0.45, -L * 0.33] });
        k.ball('#111111', 0.009, [H * 0.3, H * 0.65, -L * 0.33], 0);
        k.ball('#111111', 0.009, [-H * 0.3, H * 0.65, -L * 0.33], 0);
        k.extrude('main', [[0, 0], [0.08, 0.02], [0.06, 0.06]], 0.02, 'zy', { p: [0, H * 0.1, L * 0.3] });
        sockets.top = S([0, H * 0.95, -L * 0.25]);
        sockets.tank = S([0, H * 0.55, L * 0.05], [0, 1, 0]);
        break;
      case 'fish':
        k.ball('main', 1, [0, 0, 0], 1, [W * 0.6, H * 0.7, L * 0.5]);
        k.extrude('accent', [[0, 0], [0.09, 0.07], [0.09, -0.07]], 0.01, 'zy', { p: [0, 0, L * 0.45] });
        k.extrude('accent', [[0, 0], [0.08, 0], [0.03, 0.05]], 0.008, 'zy', { p: [0, H * 0.6, -0.02] });
        k.ball('white', 0.016, [W * 0.4, H * 0.2, -L * 0.3], 0);
        k.ball('#111111', 0.008, [W * 0.48, H * 0.2, -L * 0.31], 0);
        k.ball('white', 0.016, [-W * 0.4, H * 0.2, -L * 0.3], 0);
        k.ball('#111111', 0.008, [-W * 0.48, H * 0.2, -L * 0.31], 0);
        break;
      case 'retro':
        k.zlathe('main', [[0, L * 0.45], [H * 0.45, L * 0.3], [H * 0.45, -L * 0.05], [H * 0.2, -L * 0.2], [H * 0.2, -L / 2], [0, -L / 2]], 10);
        for (let i = 0; i < 5; i++) k.zrod('accent', -L * 0.48 + i * 0.03, -L * 0.48 + i * 0.03 + 0.012, H * 0.32, H * 0.32, 10);
        k.ball('glow', 0.02, [0, H * 0.45, L * 0.15], 1);
        break;
      case 'minigun':
        k.zrod('main', -L / 2, L / 2, H * 0.6, H * 0.6, 12);
        k.zrod('accent', -L / 2 - 0.01, -L / 2 + 0.02, H * 0.65, H * 0.65, 12);
        k.box('dark', [W * 1.6, H * 0.4, L * 0.4], { p: [0, H * 0.75, 0.04] });
        k.rod('main', [0, H * 0.95, -0.03], [0, H * 1.25, 0.03], 0.012, 0.012, 6);
        sockets.top = S([0, H * 1.0, 0.1]);
        sockets.tank = S([0, -H * 0.6, 0.0], [0, -1, 0]);
        sockets.mag = S([W * 0.7, -H * 0.3, 0.05]);
        break;
      case 'clamshell':
        k.extrude(
          'main',
          [
            [-L / 2, 0],
            [-L * 0.3, -H / 2],
            [L * 0.4, -H / 2],
            [L / 2, 0],
            [L * 0.4, H / 2],
            [-L * 0.3, H / 2],
          ],
          W * 0.5,
          'zy',
          { p: [W * 0.25, 0, 0] },
          0.004,
        );
        k.extrude(
          'accent',
          [
            [-L / 2, 0],
            [-L * 0.3, -H / 2],
            [L * 0.4, -H / 2],
            [L / 2, 0],
            [L * 0.4, H / 2],
            [-L * 0.3, H / 2],
          ],
          W * 0.5,
          'zy',
          { p: [-W * 0.25, 0, 0] },
          0.004,
        );
        break;
    }
  };
  return part({
    id: `core-bubble-${style}`,
    category: 'core',
    classes: ['bubble_gun', 'weird'],
    tags,
    desc,
    attach: '',
    sockets,
    draw,
  });
}

/* ------------------------------------------------------------------ */
/* Blowgun tubes (tube itself is the core)                             */
/* ------------------------------------------------------------------ */

function blowCore(style: string, L: number, r: number, desc: string, tags: string[]): PartDef {
  const zf = -L * 0.7;
  const zb = L * 0.3;
  const sockets: Record<string, Socket> = {
    muzzle: S([0, 0, zf]),
    barrel: S([0, 0, zf]),
    stock: S([0, 0, zb]),
    top: S([0, r, -L * 0.15]),
    under: S([0, -r, -L * 0.4]),
    grip: S([0, -r, 0.02]),
    side: S([r, 0, -L * 0.05], [1, 0, 0]),
    mag: S([0, -r, -L * 0.2]),
    deco: S([0, r, L * 0.15]),
  };
  const draw = (k: Kit) => {
    switch (style) {
      case 'bamboo': {
        const segs = Math.round(L / 0.22);
        for (let i = 0; i < segs; i++) {
          const a = zf + (i * (zb - zf)) / segs;
          const b = zf + ((i + 1) * (zb - zf)) / segs;
          k.zrod('main', a, b, r * 0.95, r, 7);
          k.zrod('accent', b - 0.008, b + 0.008, r * 1.15, r * 1.15, 7);
        }
        break;
      }
      case 'carved':
        k.zrod('wood', zf, zb, r, r, 8);
        for (let i = 0; i < 6; i++) {
          const z = zf + 0.05 + i * ((zb - zf - 0.1) / 5);
          k.torus('accent', r, r * 0.25, { p: [0, 0, z] }, 4, 8);
        }
        k.zlathe('accent', [[r * 1.4, zf], [r * 1.0, zf + 0.04]], 8);
        break;
      case 'tactical':
        k.zrod('main', zf, zb, r, r, 6);
        k.box('dark', [r * 1.1, 0.008, L * 0.4], { p: [0, r + 0.004, -L * 0.15] });
        for (let i = 0; i < 6; i++) k.box('dark', [r * 1.3, 0.006, 0.01], { p: [0, r + 0.01, -L * 0.33 + i * 0.07] });
        k.zrod('rubber', -0.05, 0.1, r * 1.3, r * 1.3, 6);
        break;
      case 'steampunk':
        k.zrod('brass', zf, zb, r, r, 10);
        for (const f of [0.15, 0.45, 0.75]) {
          const z = zf + f * (zb - zf);
          k.zrod('main', z - 0.015, z + 0.015, r * 1.4, r * 1.4, 10);
        }
        k.rod('metal', [0, r, -0.05], [0, r * 2.4, -0.05], r * 0.3, r * 0.3, 6);
        k.torus('accent', r * 1.0, r * 0.2, { p: [0, r * 2.4, -0.05], r: [Math.PI / 2, 0, 0] }, 4, 8);
        k.lathe('white', [[0, 0], [r * 1.1, 0], [r * 1.1, r * 0.4], [0, r * 0.45]], 10, { p: [r * 1.2, 0, 0.08], r: [0, 0, -Math.PI / 2] });
        break;
      case 'straw':
        k.zrod('white', zf, zb, r, r, 8);
        for (let i = 0; i < 10; i++) {
          const a = zf + (i * (zb - zf)) / 10;
          k.zrod('main', a, a + (zb - zf) / 20, r * 1.03, r * 1.03, 8);
        }
        break;
      case 'bone':
        k.zrod('white', zf, zb, r, r * 1.1, 6);
        k.ball('white', r * 1.8, [0, 0, zb], 1, [1, 0.8, 1]);
        for (let i = 0; i < 4; i++) k.zrod('accent', zf + 0.1 + i * 0.15, zf + 0.115 + i * 0.15, r * 1.2, r * 1.2, 6);
        break;
      case 'vine':
        k.zrod('wood', zf, zb, r, r, 7);
        {
          const pts: Vec3[] = [];
          for (let i = 0; i <= 24; i++) {
            const t = i / 24;
            const a = t * Math.PI * 10;
            pts.push([Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1, zf + 0.04 + t * (zb - zf - 0.08)]);
          }
          k.tube('accent', pts, r * 0.22, 48, 4);
        }
        break;
    }
  };
  return part({
    id: `core-blowgun-${style}-${Math.round(L * 100)}`,
    category: 'core',
    classes: ['blowgun'],
    tags,
    desc,
    attach: '',
    sockets,
    draw,
  });
}

/* ------------------------------------------------------------------ */
/* Crossbow bodies                                                     */
/* ------------------------------------------------------------------ */

function crossbowCore(style: string, L: number, desc: string, tags: string[]): PartDef {
  const H = 0.06;
  const W = 0.045;
  const zf = -L * 0.55;
  const zb = L * 0.45;
  const sockets: Record<string, Socket> = {
    barrel: S([0, H * 0.3, zf]),
    stock: S([0, 0, zb]),
    grip: S([0, -H / 2, L * 0.12]),
    top: S([0, H / 2, L * 0.15]),
    mag: S([0, -H / 2, -L * 0.15]),
    under: S([0, -H / 2, -L * 0.35]),
    side: S([W / 2, 0, L * 0.05], [1, 0, 0]),
    deco: S([-W / 2, 0, L * 0.1], [-1, 0, 0]),
  };
  const draw = (k: Kit) => {
    switch (style) {
      case 'medieval': {
        const pts: Pt[] = [
          [zf, -H * 0.3],
          [zf, H / 2],
          [zb, H * 0.2],
          [zb, -H * 1.6],
          [zb - 0.06, -H * 1.6],
          [L * 0.1, -H / 2],
        ];
        k.extrude('wood', pts, W, 'zy', undefined, 0.003);
        k.box('dark', [0.012, 0.004, L * 0.75], { p: [0, H / 2 + 0.002, -L * 0.15] });
        k.rod('metal', [0, -H * 0.4, L * 0.12], [0, -H * 1.4, L * 0.22], 0.005, 0.005, 6);
        sockets.grip = S([0, -H / 2, L * 0.02]);
        break;
      }
      case 'tactical':
        k.extrude('main', chamferRect(zf, -H / 2, zb, H / 2, 0.012), W * 0.6, 'zy', undefined, 0, [
          rectPts(-L * 0.35, -H * 0.25, -L * 0.1, H * 0.2).reverse() as Pt[],
          rectPts(-L * 0.05, -H * 0.25, L * 0.2, H * 0.2).reverse() as Pt[],
        ]);
        rail(k, L * 0.4, W * 0.5, H / 2, L * 0.15, 6);
        k.box('dark', [W * 0.8, 0.006, L * 0.5], { p: [0, H / 2 + 0.003, -L * 0.25] });
        break;
      case 'pistol':
        k.box('main', [W * 0.8, H, L], {});
        k.box('dark', [0.01, 0.004, L], { p: [0, H / 2 + 0.002, 0] });
        k.ball('accent', 0.008, [W * 0.42, 0, L * 0.25], 0);
        sockets.grip = S([0, -H / 2, L * 0.3]);
        break;
      case 'repeating':
        k.box('wood', [W * 0.9, H, L], {});
        k.box('wood', [W * 0.85, H * 1.4, L * 0.55], { p: [0, H * 1.15, -L * 0.15] });
        k.rod('wood', [0, H * 0.3, L * 0.05], [0, H * 1.8, L * 0.6], 0.01, 0.01, 6);
        for (let i = 0; i < 3; i++) k.ball('metal', 0.006, [W * 0.47, H * 1.15, -L * 0.3 + i * 0.07], 0);
        sockets.top = S([0, H * 1.85, -L * 0.15]);
        break;
      case 'toy':
        k.zlathe('main', [[0, zf], [H * 0.55, zf + 0.03], [H * 0.6, 0], [H * 0.5, zb - 0.02], [0, zb]], 8);
        k.box('accent', [0.02, 0.01, L * 0.7], { p: [0, H * 0.6, -L * 0.1] });
        break;
      case 'steampunk':
        k.box('wood', [W, H, L], {});
        k.zrod('brass', zf, zb * 0.6, 0.012, 0.012, 8, W * 0.55, 0);
        k.torus('brass', 0.03, 0.006, { p: [W * 0.6, 0, L * 0.25], r: [0, Math.PI / 2, 0] }, 4, 10);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          k.box('brass', [0.008, 0.01, 0.01], { p: [W * 0.6, Math.sin(a) * 0.036, L * 0.25 + Math.cos(a) * 0.036], r: [a, 0, 0] });
        }
        break;
      case 'scifi':
        k.extrude('main', [[zf, 0], [zf + 0.05, -H / 2], [zb, -H / 2], [zb, H / 2], [zf + 0.05, H / 2]], W, 'zy', undefined, 0.004);
        k.box('glow', [W + 0.006, 0.006, L * 0.8], { p: [0, 0, 0] });
        break;
      case 'arbalest':
        k.box('wood', [W * 1.3, H * 1.3, L], {});
        k.box('metal', [W * 1.35, H * 0.4, 0.06], { p: [0, 0, zf + 0.03] });
        k.box('metal', [W * 1.35, H * 0.4, 0.04], { p: [0, 0, 0] });
        k.box('dark', [0.014, 0.004, L * 0.8], { p: [0, H * 0.65 + 0.002, -L * 0.1] });
        break;
    }
  };
  return part({
    id: `core-crossbow-${style}`,
    category: 'core',
    classes: style === 'toy' ? ['crossbow', 'weird'] : ['crossbow'],
    tags,
    desc,
    attach: '',
    sockets,
    draw,
  });
}

/* ------------------------------------------------------------------ */
/* Melee handles                                                       */
/* ------------------------------------------------------------------ */

function handleCore(
  id: string,
  L: number,
  r: number,
  desc: string,
  tags: string[],
  style: string,
  extraClasses: string[] = [],
): PartDef {
  const sockets: Record<string, Socket> = {
    guard: S([0, 0, 0]),
    blade: S([0, 0, 0]),
    head: S([0, 0, 0]),
    pommel: S([0, 0, L]),
    deco: S([0, r, L * 0.5]),
    side: S([r, 0, L * 0.5], [1, 0, 0]),
  };
  const draw = (k: Kit) => {
    switch (style) {
      case 'wrapped': {
        k.zrod('main', 0, L, r, r * 0.95, 7);
        const n = Math.max(3, Math.round(L / 0.03));
        for (let i = 0; i < n; i++) {
          const z = 0.012 + (i * (L - 0.024)) / (n - 1);
          k.torus('accent', r, r * 0.22, { p: [0, 0, z], r: [0.25, 0, 0] }, 3, 7);
        }
        break;
      }
      case 'tsuka': {
        k.zrod('main', 0, L, r * 1.05, r * 0.95, 6);
        const n = Math.round(L / 0.03);
        for (let i = 0; i < n; i++) {
          const z = 0.015 + i * ((L - 0.03) / (n - 1));
          k.box('accent', [r * 0.9, r * 0.9, 0.012], { p: [r * 0.75, 0, z], r: [0, 0, Math.PI / 4] });
          k.box('accent', [r * 0.9, r * 0.9, 0.012], { p: [-r * 0.75, 0, z], r: [0, 0, Math.PI / 4] });
        }
        k.zrod('brass', 0, 0.012, r * 1.15, r * 1.15, 6);
        k.zrod('brass', L - 0.012, L, r * 1.1, r * 1.1, 6);
        break;
      }
      case 'knife':
        k.extrude('main', [[0, -r], [L * 0.6, -r * 1.2], [L, -r * 0.8], [L, r * 0.8], [L * 0.5, r], [0, r]], r * 1.3, 'zy', undefined, 0.002);
        for (const z of [L * 0.25, L * 0.7]) k.rod('metal', [-r * 0.75, 0, z], [r * 0.75, 0, z], r * 0.22, r * 0.22, 6);
        break;
      case 'haft': {
        const pts: Vec3[] = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          pts.push([0, Math.sin(t * Math.PI) * L * 0.04 - t * L * 0.02, t * L]);
        }
        k.tube('wood', pts, r, 12, 6);
        k.zrod('accent', L * 0.72, L * 0.97, r * 1.2, r * 1.2, 6, 0, -L * 0.015);
        break;
      }
      case 'shaft':
        k.zrod('wood', -0.05, L, r, r, 6);
        for (const f of [0.0, 0.35, 0.65, 0.98]) k.zrod('metal', f * L - 0.015, f * L + 0.015, r * 1.2, r * 1.2, 6);
        break;
      case 'bat':
        k.zrod('main', 0, L, r * 1.3, r, 8);
        k.zrod('rubber', L * 0.5, L * 0.95, r * 1.08, r * 1.08, 8);
        k.zlathe('main', [[r, L], [r * 1.9, L + 0.01], [r * 1.8, L + 0.025], [0, L + 0.027]], 8);
        break;
      case 'mace':
        k.zrod('metal', -0.04, L, r * 0.85, r * 0.85, 6);
        k.zrod('rubber', L * 0.4, L * 0.95, r * 1.1, r * 1.1, 8);
        for (let i = 0; i < 4; i++) k.zrod('metal', L * 0.15 + i * 0.03, L * 0.15 + i * 0.03 + 0.01, r * 1.2, r * 1.2, 6);
        break;
      case 'snath': {
        const pts: Vec3[] = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          pts.push([0, Math.sin(t * Math.PI * 1.2) * 0.08, t * L]);
        }
        k.tube('wood', pts, r, 16, 6);
        k.rod('wood', [0, 0.07, L * 0.4], [0, 0.17, L * 0.38], r * 0.9, r * 0.9, 6);
        break;
      }
      case 'pan':
        k.extrude('main', [[-r * 0.6, 0], [-r * 1.1, L], [r * 1.1, L], [r * 0.6, 0]], r * 0.8, 'xz', undefined, 0.003, [
          [[-r * 0.4, L * 0.8], [r * 0.4, L * 0.8], [r * 0.4, L * 0.9], [-r * 0.4, L * 0.9]],
        ]);
        break;
      case 'bone':
        k.zrod('white', 0, L, r, r * 0.9, 6);
        k.ball('white', r * 1.6, [r * 0.7, 0, L], 0);
        k.ball('white', r * 1.6, [-r * 0.7, 0, L], 0);
        sockets.pommel = S([0, 0, L + r * 1.4]);
        break;
      case 'foam':
        k.zrod('main', 0, L, r * 1.4, r * 1.4, 8);
        for (let i = 0; i < 3; i++) k.zrod('accent', L * (0.2 + i * 0.3), L * (0.2 + i * 0.3) + 0.02, r * 1.5, r * 1.5, 8);
        break;
      case 'hilt':
        k.zrod('metal', 0, L, r * 1.2, r * 1.2, 10);
        for (let i = 0; i < 6; i++) k.zrod('dark', L * 0.35 + i * 0.016, L * 0.35 + i * 0.016 + 0.008, r * 1.3, r * 1.3, 10);
        k.box('dark', [r * 0.6, r * 0.8, 0.05], { p: [r * 1.2, 0, L * 0.15] });
        k.ball('glow', r * 0.3, [r * 1.25, 0.004, L * 0.1], 0);
        k.zrod('metal', -0.004, 0.015, r * 1.45, r * 1.3, 10);
        break;
    }
  };
  return part({
    id,
    category: 'core',
    classes: ['melee', ...extraClasses],
    tags,
    desc,
    attach: '',
    sockets,
    draw,
  });
}

/* ------------------------------------------------------------------ */

export function coreParts(): PartDef[] {
  const out: PartDef[] = [];
  const classes: GunClass[] = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg'];
  const styles: Style[] = ['block', 'round', 'bevel', 'skeleton', 'bullpup', 'toy', 'scifi', 'steampunk', 'tactical', 'organic'];
  for (const c of classes) for (const s of styles) out.push(gunCore(c, s));

  out.push(
    rocketCore('bazooka', 0.9, 0.055, '-90', 'classic open bazooka tube with flared rear', ['military', 'retro']),
    rocketCore('bazooka', 1.2, 0.065, '-120', 'long heavy bazooka tube with flared rear', ['military', 'retro', 'heavy']),
    rocketCore('rpg', 0.85, 0.05, '-85', 'slim RPG tube with wooden heat guard', ['military', 'wood']),
    rocketCore('rpg', 1.05, 0.06, '-105', 'long RPG tube with wooden heat guard', ['military', 'wood']),
    rocketCore('modern', 0.9, 0.06, '-90', 'modern disposable launcher tube with end caps', ['military', 'modern']),
    rocketCore('modern', 1.1, 0.08, '-110', 'fat modern guided launcher tube', ['military', 'modern', 'heavy']),
    rocketCore('quad', 0.8, 0.04, '-80', 'four-tube rocket pod launcher', ['military', 'heavy']),
    rocketCore('twin', 0.85, 0.045, '-85', 'twin side-by-side rocket tubes', ['military', 'heavy']),
    rocketCore('cartoon', 0.8, 0.07, '-80', 'fat striped cartoon rocket tube', ['toy', 'silly']),
    rocketCore('cartoon', 1.0, 0.085, '-100', 'huge striped cartoon rocket tube', ['toy', 'silly', 'heavy']),
    rocketCore('steampunk', 0.9, 0.06, '-90', 'brass cannon tube on wooden cradle', ['steampunk', 'ornate']),
    rocketCore('scifi', 0.9, 0.055, '-90', 'angular sci-fi rail launcher body', ['scifi', 'sleek']),
    rocketCore('scifi', 1.1, 0.07, '-110', 'large angular sci-fi launcher body', ['scifi', 'heavy']),
  );

  out.push(
    grenadeCore('revolver', 'open revolver frame for rotating grenade cylinder', ['military', 'heavy']),
    grenadeCore('break', 'wooden break-action grenade launcher body', ['military', 'retro', 'wood']),
    grenadeCore('pump', 'pump-action body with tube magazine', ['military']),
    grenadeCore('drum', 'automatic drum-fed grenade launcher body', ['military', 'heavy']),
    grenadeCore('compact', 'compact standalone grenade launcher body', ['military', 'compact'], ['grenade_launcher', 'pistol']),
    grenadeCore('toy', 'round toy ball-lobber body', ['toy', 'silly'], ['grenade_launcher', 'weird']),
    grenadeCore('steampunk', 'brass mortar body with wooden grip block', ['steampunk', 'ornate'], ['grenade_launcher', 'weird']),
    grenadeCore('scifi', 'angular sci-fi plasma lobber body', ['scifi'], ['grenade_launcher', 'weird']),
  );

  out.push(
    flameCore('wand', 'tubular flame wand with metal bands', ['military', 'retro']),
    flameCore('rifle', 'boxy rifle-style flamethrower body', ['military']),
    flameCore('backpack', 'pipe body with hose to backpack tank', ['military', 'heavy']),
    flameCore('steampunk', 'brass boiler body with pressure gauge', ['steampunk', 'ornate']),
    flameCore('scifi', 'angular plasma projector body with glow vents', ['scifi']),
    flameCore('toy', 'chunky water-blaster style body', ['toy', 'silly']),
    flameCore('dragon', 'scaly dragon body with glowing eyes', ['organic', 'fantasy', 'silly']),
    flameCore('compact', 'compact pistol flamer body', ['military', 'compact']),
  );

  out.push(
    bubbleCore('raygun', 'retro ray gun body with rings and fins', ['toy', 'retro', 'scifi']),
    bubbleCore('blaster', 'chunky toy blaster body', ['toy', 'chunky']),
    bubbleCore('fan', 'bubble fan housing with grille', ['toy']),
    bubbleCore('duck', 'rubber duck shaped bubble gun body', ['toy', 'silly']),
    bubbleCore('fish', 'goofy fish shaped bubble gun body', ['toy', 'silly', 'organic']),
    bubbleCore('retro', 'retro space pistol body with glow dome', ['toy', 'retro', 'scifi']),
    bubbleCore('minigun', 'round bubble minigun housing with handle', ['toy', 'heavy']),
    bubbleCore('clamshell', 'two-tone clamshell toy body', ['toy']),
  );

  out.push(
    blowCore('bamboo', 0.6, 0.016, 'short segmented bamboo blowgun tube', ['organic', 'tribal', 'wood']),
    blowCore('bamboo', 1.1, 0.018, 'long segmented bamboo blowgun tube', ['organic', 'tribal', 'wood']),
    blowCore('carved', 0.9, 0.018, 'carved wooden blowgun with ring bands', ['tribal', 'wood', 'ornate']),
    blowCore('tactical', 0.8, 0.016, 'hex metal tactical blowgun with rail', ['military', 'modern']),
    blowCore('steampunk', 0.85, 0.017, 'brass steampunk blowgun with valve and gauge', ['steampunk', 'ornate']),
    blowCore('straw', 0.7, 0.014, 'striped drinking-straw blowgun', ['toy', 'silly']),
    blowCore('bone', 0.75, 0.017, 'bone blowgun with knuckle mouthpiece', ['organic', 'tribal', 'spooky']),
    blowCore('vine', 0.95, 0.017, 'wooden blowgun wrapped in spiral vine', ['organic', 'tribal']),
  );

  out.push(
    crossbowCore('medieval', 0.6, 'long wooden medieval crossbow tiller', ['medieval', 'wood']),
    crossbowCore('tactical', 0.55, 'skeletal aluminum tactical crossbow stock', ['military', 'modern']),
    crossbowCore('pistol', 0.3, 'short pistol crossbow body', ['compact']),
    crossbowCore('repeating', 0.55, 'repeating crossbow with lever and bolt box', ['medieval', 'wood', 'ornate']),
    crossbowCore('toy', 0.45, 'rounded toy crossbow body', ['toy', 'silly']),
    crossbowCore('steampunk', 0.55, 'wood and brass steampunk crossbow body with gear', ['steampunk']),
    crossbowCore('scifi', 0.55, 'sleek sci-fi crossbow body with glow strip', ['scifi']),
    crossbowCore('arbalest', 0.75, 'massive banded arbalest tiller', ['medieval', 'heavy']),
  );

  out.push(
    handleCore('core-handle-dagger', 0.1, 0.013, 'short wrapped dagger grip', ['medieval'], 'wrapped'),
    handleCore('core-handle-sword', 0.16, 0.015, 'wrapped one-handed sword grip', ['medieval'], 'wrapped'),
    handleCore('core-handle-bastard', 0.24, 0.016, 'long hand-and-a-half sword grip', ['medieval'], 'wrapped'),
    handleCore('core-handle-greatsword', 0.34, 0.018, 'two-handed greatsword grip', ['medieval', 'heavy'], 'wrapped'),
    handleCore('core-handle-tsuka-short', 0.16, 0.016, 'diamond-wrapped short katana grip', ['eastern', 'sleek'], 'tsuka'),
    handleCore('core-handle-tsuka-long', 0.27, 0.017, 'diamond-wrapped long katana grip', ['eastern', 'sleek'], 'tsuka'),
    handleCore('core-handle-knife', 0.11, 0.014, 'riveted slab knife handle', ['modern', 'compact'], 'knife'),
    handleCore('core-handle-knife-big', 0.14, 0.017, 'chunky riveted combat knife handle', ['military'], 'knife'),
    handleCore('core-handle-haft-short', 0.45, 0.017, 'curved wooden hatchet haft', ['medieval', 'wood'], 'haft'),
    handleCore('core-handle-haft-long', 0.8, 0.02, 'long curved wooden axe haft', ['medieval', 'wood', 'heavy'], 'haft'),
    handleCore('core-handle-shaft', 1.3, 0.018, 'banded wooden spear shaft', ['medieval', 'wood'], 'shaft'),
    handleCore('core-handle-shaft-long', 1.8, 0.02, 'very long polearm shaft with bands', ['medieval', 'wood', 'heavy'], 'shaft'),
    handleCore('core-handle-bat', 0.35, 0.014, 'taped bat handle with knob', ['sport'], 'bat'),
    handleCore('core-handle-mace', 0.38, 0.015, 'metal mace handle with rubber grip', ['medieval', 'heavy'], 'mace'),
    handleCore('core-handle-snath', 1.2, 0.017, 'curved scythe snath with side grip', ['medieval', 'farm'], 'snath'),
    handleCore('core-handle-pan', 0.2, 0.012, 'flat cookware handle with hang hole', ['kitchen', 'silly'], 'pan', ['weird']),
    handleCore('core-handle-bone', 0.18, 0.016, 'bone handle with knuckle end', ['organic', 'spooky'], 'bone'),
    handleCore('core-handle-foam', 0.2, 0.016, 'striped foam toy handle', ['toy', 'silly'], 'foam', ['weird']),
    handleCore('core-handle-hilt', 0.24, 0.016, 'metal laser sword hilt with button', ['scifi'], 'hilt'),
    handleCore('core-handle-hilt-short', 0.16, 0.015, 'short metal laser dagger hilt', ['scifi', 'compact'], 'hilt'),
  );
  return out;
}
