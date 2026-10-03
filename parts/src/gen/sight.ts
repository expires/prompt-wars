/** SIGHTS / SCOPES: attach to 'top', sit above origin (+Y), optical axis along Z. */
import type { PartDef } from '../types';
import { part, S } from '../lib/define';
import type { Kit } from '../lib/kit';

interface Sg {
  id: string;
  classes: string[];
  tags: string[];
  desc: string;
  h?: number;
  draw: (k: Kit) => void;
}

const GUNS = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg'];
const RIFLES = ['smg', 'rifle', 'shotgun', 'lmg', 'grenade_launcher', 'crossbow'];

function mk(s: Sg): PartDef {
  return part({
    id: s.id,
    category: 'sight',
    classes: s.classes,
    tags: s.tags,
    desc: s.desc,
    attach: 'top',
    sockets: { deco: S([0, (s.h ?? 0.05) + 0.005, 0.0]) },
    draw: s.draw,
  });
}

function mount(k: Kit, len: number, h: number) {
  k.box('dark', [0.028, 0.008, len], { p: [0, 0.004, 0] });
  k.box('dark', [0.014, h, 0.014], { p: [0, h / 2, -len * 0.3] });
  k.box('dark', [0.014, h, 0.014], { p: [0, h / 2, len * 0.3] });
}

/** Scope tube with bells. y = optical axis height. */
function scope(k: Kit, len: number, rObj: number, rEye: number, y: number, tube = 0.013) {
  k.zrod('main', -len * 0.3, len * 0.25, tube, tube, 10, 0, y);
  k.zrod('main', -len / 2, -len * 0.3, rObj, tube, 10, 0, y);
  k.zrod('main', len * 0.25, len / 2, tube, rEye, 10, 0, y);
  k.zrod('glow', -len / 2 - 0.002, -len / 2 + 0.001, rObj * 0.85, rObj * 0.85, 10, 0, y);
  k.zrod('dark', len / 2 - 0.001, len / 2 + 0.002, rEye * 0.8, rEye * 0.8, 10, 0, y);
}

export function sightParts(): PartDef[] {
  const out: PartDef[] = [];

  // iron sights
  const irons: [string, string, (k: Kit) => void][] = [
    ['notch', 'flip-up rear notch iron sight', (k) => {
      k.box('dark', [0.026, 0.008, 0.03], { p: [0, 0.004, 0] });
      k.box('main', [0.022, 0.018, 0.006], { p: [0, 0.016, 0] });
      k.box('dark', [0.006, 0.008, 0.008], { p: [0, 0.022, 0] });
    }],
    ['aperture', 'aperture peep rear sight', (k) => {
      k.box('dark', [0.026, 0.008, 0.03], { p: [0, 0.004, 0] });
      k.box('main', [0.012, 0.016, 0.01], { p: [0, 0.014, 0] });
      k.torus('main', 0.007, 0.003, { p: [0, 0.028, 0] }, 4, 8);
    }],
    ['ghostring', 'protected ghost-ring sight with ears', (k) => {
      k.box('dark', [0.03, 0.008, 0.03], { p: [0, 0.004, 0] });
      k.torus('main', 0.009, 0.0035, { p: [0, 0.024, 0] }, 4, 10);
      k.box('main', [0.005, 0.026, 0.016], { p: [0.016, 0.017, 0] });
      k.box('main', [0.005, 0.026, 0.016], { p: [-0.016, 0.017, 0] });
    }],
    ['post-hooded', 'hooded front post sight', (k) => {
      k.box('dark', [0.026, 0.008, 0.03], { p: [0, 0.004, 0] });
      k.box('main', [0.004, 0.02, 0.004], { p: [0, 0.016, 0] });
      k.torus('main', 0.013, 0.003, { p: [0, 0.018, 0] }, 3, 10, Math.PI);
    }],
  ];
  for (const [n, d, f] of irons)
    out.push(mk({ id: `sight-iron-${n}`, classes: [...GUNS, 'crossbow', 'grenade_launcher'], tags: ['military', 'standard'], desc: d, h: 0.025, draw: f }));

  // carry handles
  for (const [i, len] of [0.12, 0.16].entries())
    out.push(
      mk({
        id: `sight-carryhandle-${i + 1}`,
        classes: ['rifle', 'lmg', 'smg'],
        tags: ['military', 'retro'],
        desc: 'carry handle with built-in rear sight',
        h: 0.05,
        draw: (k) => {
          k.box('main', [0.016, 0.04, 0.02], { p: [0, 0.02, -len / 2 + 0.01] });
          k.box('main', [0.016, 0.04, 0.03], { p: [0, 0.02, len / 2 - 0.015] });
          k.box('main', [0.02, 0.012, len], { p: [0, 0.044, 0] });
          k.box('dark', [0.012, 0.012, 0.01], { p: [0, 0.056, len / 2 - 0.02] });
        },
      }),
    );

  // red dot tubes
  for (const [li, len] of [0.06, 0.09].entries())
    for (const [ri, r] of [0.014, 0.019].entries())
      out.push(
        mk({
          id: `sight-reddot-tube-${li ? 'long' : 'short'}-${ri ? 'wide' : 'slim'}`,
          classes: [...GUNS, 'crossbow'],
          tags: ['military', 'modern'],
          desc: `${li ? 'long' : 'short'} ${ri ? 'wide' : 'slim'} tube red dot sight`,
          h: 0.03 + r * 2,
          draw: (k) => {
            const y = 0.022 + r;
            k.box('dark', [0.026, 0.008, len * 0.7], { p: [0, 0.004, 0] });
            k.box('main', [0.016, y - r * 0.5, len * 0.4], { p: [0, (y - r * 0.5) / 2, 0] });
            k.zrod('main', -len / 2, len / 2, r, r, 10, 0, y);
            k.zrod('glow', -len / 2 - 0.001, -len / 2 + 0.002, r * 0.8, r * 0.8, 10, 0, y);
            k.rod('main', [0, y + r, 0], [0, y + r + 0.008, 0], 0.006, 0.006, 6);
            k.rod('main', [r, y, 0.005], [r + 0.008, y, 0.005], 0.006, 0.006, 6);
          },
        }),
      );

  // open reflex
  for (const [i, s] of [0.8, 1, 1.25].entries())
    out.push(
      mk({
        id: `sight-reflex-open-${['mini', 'std', 'large'][i]}`,
        classes: [...GUNS, 'crossbow', 'blowgun'],
        tags: ['modern', 'compact'],
        desc: `${['mini', 'standard', 'large'][i]} open reflex sight with window`,
        h: 0.035 * s,
        draw: (k) => {
          k.box('main', [0.028 * s, 0.012, 0.045 * s], { p: [0, 0.006, 0] });
          k.extrude('main', [[-0.016 * s, 0], [0.016 * s, 0], [0.012 * s, 0.03 * s], [-0.012 * s, 0.03 * s]], 0.008, 'xy', { p: [0, 0.01, -0.016 * s] }, 0, [
            [[-0.011 * s, 0.004], [0.011 * s, 0.004], [0.008 * s, 0.025 * s], [-0.008 * s, 0.025 * s]],
          ]);
          k.box('glow', [0.002, 0.002, 0.002], { p: [0, 0.02 * s, 0.01] });
        },
      }),
    );

  // holo boxes
  for (const [i, s] of [0.9, 1.1, 1.3].entries())
    out.push(
      mk({
        id: `sight-holo-${i + 1}`,
        classes: [...RIFLES, 'pistol'],
        tags: ['military', 'tactical'],
        desc: 'boxy holographic sight with hood',
        h: 0.05 * s,
        draw: (k) => {
          k.box('main', [0.034 * s, 0.018 * s, 0.07 * s], { p: [0, 0.009 * s, 0] });
          const hood = [
            [-0.019 * s, 0],
            [0.019 * s, 0],
            [0.019 * s, 0.032 * s],
            [-0.019 * s, 0.032 * s],
          ] as [number, number][];
          const win = [
            [-0.014 * s, 0.003],
            [0.014 * s, 0.003],
            [0.014 * s, 0.027 * s],
            [-0.014 * s, 0.027 * s],
          ] as [number, number][];
          k.extrude('main', hood, 0.04 * s, 'xy', { p: [0, 0.016 * s, -0.012 * s] }, 0, [win]);
          k.box('glow', [0.024 * s, 0.022 * s, 0.002], { p: [0, 0.03 * s, -0.03 * s] });
          k.box('dark', [0.01, 0.008, 0.012], { p: [0.02 * s, 0.01, 0.02] });
        },
      }),
    );

  // scopes: length x objective
  const LENS = [0.15, 0.22, 0.3, 0.4];
  LENS.forEach((len, li) =>
    [0.018, 0.026].forEach((rObj, oi) =>
      out.push(
        mk({
          id: `sight-scope-${['compact', 'mid', 'long', 'xlong'][li]}-${oi ? 'bigobj' : 'std'}`,
          classes: li >= 2 ? ['sniper', 'rifle'] : ['rifle', 'sniper', 'smg', 'crossbow', 'shotgun'],
          tags: ['precision', 'military'],
          desc: `${['compact', 'mid-length', 'long', 'extra-long'][li]} rifle scope${oi ? ', large objective' : ''}`,
          h: 0.045 + rObj,
          draw: (k) => {
            const y = 0.03 + rObj * 0.6;
            mount(k, len * 0.5, y - 0.01);
            scope(k, len, rObj, 0.017, y);
            k.rod('main', [0, y, -len * 0.05], [0, y + 0.022, -len * 0.05], 0.008, 0.008, 8);
            k.rod('main', [0, y, -len * 0.05], [0.022, y, -len * 0.05], 0.008, 0.008, 8);
          },
        }),
      ),
    ),
  );
  // big sniper scopes with turrets
  for (const [i, len] of [0.3, 0.36, 0.42, 0.5].entries())
    out.push(
      mk({
        id: `sight-scope-tactical-${i + 1}`,
        classes: ['sniper'],
        tags: ['precision', 'military', 'heavy'],
        desc: 'tactical sniper scope with big turrets and parallax knob',
        h: 0.08,
        draw: (k) => {
          const y = 0.045;
          mount(k, len * 0.45, y - 0.012);
          scope(k, len, 0.03, 0.02, y, 0.016);
          k.rod('accent', [0, y, -len * 0.05], [0, y + 0.032, -len * 0.05], 0.013, 0.013, 10);
          k.rod('accent', [0, y, -len * 0.05], [0.032, y, -len * 0.05], 0.013, 0.013, 10);
          k.rod('main', [0, y, -len * 0.05], [-0.03, y, -len * 0.05], 0.015, 0.015, 10);
          k.zrod('dark', len * 0.15, len * 0.22, 0.019, 0.019, 10, 0, y);
        },
      }),
    );
  // variable scopes with sunshade
  for (const [i, len] of [0.28, 0.36, 0.44].entries())
    out.push(
      mk({
        id: `sight-scope-sunshade-${i + 1}`,
        classes: ['sniper', 'rifle'],
        tags: ['precision', 'sport'],
        desc: 'variable scope with extended sunshade',
        h: 0.07,
        draw: (k) => {
          const y = 0.04;
          mount(k, len * 0.4, y - 0.01);
          scope(k, len, 0.024, 0.017, y);
          k.zrod('main', -len / 2 - 0.07, -len / 2, 0.026, 0.026, 10, 0, y);
          k.zrod('dark', -len / 2 - 0.071, -len / 2 - 0.068, 0.022, 0.022, 10, 0, y);
        },
      }),
    );
  // prism
  for (const [i, s] of [0.9, 1.1, 1.3].entries())
    out.push(
      mk({
        id: `sight-prism-${i + 1}`,
        classes: RIFLES,
        tags: ['military', 'tactical'],
        desc: 'squat prism combat scope with top fiber',
        h: 0.06 * s,
        draw: (k) => {
          const y = 0.03 * s;
          k.box('dark', [0.026, 0.01, 0.05 * s], { p: [0, 0.005, 0] });
          k.box('main', [0.03 * s, 0.03 * s, 0.06 * s], { p: [0, y, 0.005] });
          k.zrod('main', -0.07 * s, -0.025 * s, 0.02 * s, 0.016 * s, 8, 0, y);
          k.zrod('glow', -0.071 * s, -0.068 * s, 0.017 * s, 0.017 * s, 8, 0, y);
          k.zrod('main', 0.03 * s, 0.05 * s, 0.014 * s, 0.016 * s, 8, 0, y);
          k.zrod('accent', -0.02, 0.03, 0.003, 0.003, 4, 0, y + 0.017 * s);
        },
      }),
    );
  // tube sights (WWII)
  for (const [i, len] of [0.2, 0.3, 0.45].entries())
    out.push(
      mk({
        id: `sight-tube-classic-${i + 1}`,
        classes: ['sniper', 'rifle', 'weird'],
        tags: ['retro', 'military'],
        desc: 'thin classic tube scope on ring mounts',
        h: 0.05,
        draw: (k) => {
          const y = 0.034;
          for (const z of [-len * 0.25, len * 0.25]) {
            k.box('metal', [0.01, y, 0.012], { p: [0, y / 2, z] });
            k.zrod('metal', z - 0.006, z + 0.006, 0.014, 0.014, 8, 0, y);
          }
          k.zrod('main', -len / 2, len / 2, 0.011, 0.011, 8, 0, y);
          k.zrod('main', -len / 2 - 0.02, -len / 2, 0.014, 0.011, 8, 0, y);
          k.zrod('glow', -len / 2 - 0.021, -len / 2 - 0.019, 0.012, 0.012, 8, 0, y);
        },
      }),
    );
  // steampunk lenses
  const steam: [string, string, (k: Kit) => void][] = [
    ['brass-scope', 'brass telescope sight with rings', (k) => {
      k.box('brass', [0.01, 0.03, 0.012], { p: [0, 0.015, -0.05] });
      k.box('brass', [0.01, 0.03, 0.012], { p: [0, 0.015, 0.05] });
      k.zlathe('brass', [[0.018, -0.12], [0.016, -0.08], [0.013, -0.04], [0.013, 0.06], [0.016, 0.1], [0.011, 0.11]], 10, [0, 0.036, 0]);
      for (const z of [-0.08, -0.02, 0.05]) k.zrod('main', z - 0.004, z + 0.004, 0.017, 0.017, 10, 0, 0.036);
      k.zrod('glow', -0.122, -0.118, 0.015, 0.015, 10, 0, 0.036);
    }],
    ['swing-lenses', 'swing-out multi-lens brass magnifier', (k) => {
      k.box('brass', [0.012, 0.035, 0.012], { p: [0, 0.018, 0] });
      for (let i = 0; i < 3; i++) {
        const a = -0.6 + i * 0.6;
        const x = Math.sin(a) * 0.03;
        const y = 0.035 + Math.cos(a) * 0.01;
        k.rod('brass', [0, 0.035, 0], [x, y, -0.02 - i * 0.01], 0.002, 0.002, 4);
        k.torus('brass', 0.011, 0.002, { p: [x, y, -0.02 - i * 0.01] }, 3, 10);
        k.zrod('glow', -0.021 - i * 0.01, -0.019 - i * 0.01, 0.01, 0.01, 8, x, y);
      }
    }],
    ['goggle', 'double goggle-lens sight on brass arm', (k) => {
      k.box('brass', [0.01, 0.04, 0.012], { p: [0, 0.02, 0] });
      for (const x of [-0.018, 0.018]) {
        k.zrod('brass', -0.02, 0.01, 0.015, 0.015, 10, x, 0.045);
        k.zrod('glow', -0.021, -0.018, 0.012, 0.012, 10, x, 0.045);
      }
      k.box('brass', [0.02, 0.006, 0.01], { p: [0, 0.045, 0] });
    }],
    ['clockwork', 'clockwork scope with gear and dial', (k) => {
      k.box('brass', [0.02, 0.02, 0.06], { p: [0, 0.01, 0] });
      k.zrod('main', -0.09, 0.07, 0.014, 0.014, 10, 0, 0.034);
      k.torus('brass', 0.016, 0.004, { p: [0.022, 0.034, 0], r: [0, Math.PI / 2, 0] }, 3, 10);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        k.box('brass', [0.006, 0.006, 0.006], { p: [0.022, 0.034 + Math.sin(a) * 0.021, Math.cos(a) * 0.021] });
      }
      k.zrod('glow', -0.091, -0.088, 0.012, 0.012, 10, 0, 0.034);
    }],
    ['monocular', 'stubby brass monocular with leather wrap', (k) => {
      k.box('brass', [0.01, 0.025, 0.012], { p: [0, 0.012, 0] });
      k.zlathe('brass', [[0.022, -0.06], [0.016, -0.04], [0.016, 0.03], [0.012, 0.04]], 10, [0, 0.04, 0]);
      k.zrod('wood', -0.03, 0.02, 0.018, 0.018, 10, 0, 0.04);
      k.zrod('glow', -0.061, -0.058, 0.019, 0.019, 10, 0, 0.04);
    }],
  ];
  for (const [n, d, f] of steam)
    out.push(mk({ id: `sight-steampunk-${n}`, classes: ['rifle', 'sniper', 'weird', 'crossbow', 'blowgun'], tags: ['steampunk', 'ornate', 'brass'], desc: d, h: 0.06, draw: f }));

  // thermal / laser rangefinder / NV
  for (const [i, s] of [1, 1.3].entries()) {
    out.push(
      mk({
        id: `sight-thermal-${i + 1}`,
        classes: ['sniper', 'rifle', 'lmg'],
        tags: ['military', 'modern', 'heavy'],
        desc: 'boxy thermal imaging scope with eyecup',
        h: 0.07 * s,
        draw: (k) => {
          k.box('dark', [0.026, 0.01, 0.05], { p: [0, 0.005, 0] });
          k.box('main', [0.045 * s, 0.05 * s, 0.11 * s], { p: [0, 0.035 * s, 0] });
          k.zrod('glow', -0.06 * s, -0.055 * s, 0.018 * s, 0.018 * s, 10, 0, 0.035 * s);
          k.zrod('rubber', 0.055 * s, 0.08 * s, 0.014, 0.018, 8, 0, 0.035 * s);
        },
      }),
      mk({
        id: `sight-rangefinder-${i + 1}`,
        classes: ['sniper', 'rocket_launcher', 'rifle'],
        tags: ['military', 'modern'],
        desc: 'laser rangefinder module with twin lenses',
        h: 0.05 * s,
        draw: (k) => {
          k.box('main', [0.05 * s, 0.035 * s, 0.06 * s], { p: [0, 0.02 * s, 0] });
          for (const x of [-0.012, 0.012]) k.zrod('glow', -0.031 * s, -0.029 * s, 0.009 * s, 0.009 * s, 8, x * s, 0.022 * s);
          k.box('accent', [0.012, 0.006, 0.012], { p: [0, 0.04 * s, 0.01] });
        },
      }),
      mk({
        id: `sight-nightvision-${i + 1}`,
        classes: ['rifle', 'sniper', 'smg'],
        tags: ['military', 'stealth'],
        desc: 'bulbous night vision scope with green lens',
        h: 0.07 * s,
        draw: (k) => {
          const y = 0.04 * s;
          mount(k, 0.08, y - 0.01);
          k.zlathe('main', [[0.03 * s, -0.08 * s], [0.03 * s, -0.04 * s], [0.02 * s, 0], [0.02 * s, 0.05 * s], [0.016 * s, 0.06 * s]], 10, [0, y, 0]);
          k.zrod('#5aff5a', -0.081 * s, -0.078 * s, 0.026 * s, 0.026 * s, 10, 0, y);
        },
      }),
    );
  }

  // scifi holo projectors
  for (const [i, s] of [0.8, 1, 1.2, 1.5].entries())
    out.push(
      mk({
        id: `sight-holo-projector-${i + 1}`,
        classes: [...GUNS, 'weird'],
        tags: ['scifi', 'energy'],
        desc: 'emitter projecting a floating glowing reticle',
        h: 0.05 * s,
        draw: (k) => {
          k.box('main', [0.022 * s, 0.014, 0.04 * s], { p: [0, 0.007, 0.01] });
          k.rod('main', [0, 0.014, 0.0], [0, 0.03 * s, -0.01], 0.004, 0.004, 4);
          k.torus('glow', 0.014 * s, 0.0015, { p: [0, 0.04 * s, -0.02 * s] }, 3, 12);
          k.ball('glow', 0.002, [0, 0.04 * s, -0.02 * s], 0);
        },
      }),
    );

  // toy sights
  out.push(
    mk({
      id: 'sight-toy-star',
      classes: ['bubble_gun', 'weird', 'smg', 'pistol'],
      tags: ['toy', 'silly'],
      desc: 'big plastic star-shaped toy sight',
      h: 0.06,
      draw: (k) => {
        k.box('main', [0.02, 0.02, 0.02], { p: [0, 0.01, 0] });
        const pts: [number, number][] = [];
        for (let i = 0; i < 10; i++) {
          const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
          const r = i % 2 ? 0.012 : 0.028;
          pts.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        k.extrude('accent', pts, 0.01, 'xy', { p: [0, 0.045, 0] }, 0.002);
      },
    }),
    mk({
      id: 'sight-toy-ring',
      classes: ['bubble_gun', 'weird', 'rifle'],
      tags: ['toy', 'chunky'],
      desc: 'chunky toy ring sight on fat post',
      h: 0.06,
      draw: (k) => {
        k.rod('main', [0, 0, 0], [0, 0.03, 0], 0.01, 0.01, 6);
        k.torus('accent', 0.02, 0.006, { p: [0, 0.048, 0] }, 4, 12);
      },
    }),
    mk({
      id: 'sight-toy-periscope',
      classes: ['bubble_gun', 'weird'],
      tags: ['toy', 'silly'],
      desc: 'toy periscope sticking up from the gun',
      h: 0.14,
      draw: (k) => {
        k.rod('main', [0, 0, 0], [0, 0.12, 0], 0.014, 0.014, 6);
        k.box('main', [0.03, 0.03, 0.04], { p: [0, 0.13, -0.01] });
        k.zrod('glow', -0.031, -0.029, 0.01, 0.01, 6, 0, 0.13);
      },
    }),
  );

  // rocket launcher flip frame
  for (const [i, s] of [1, 1.3, 1.6].entries())
    out.push(
      mk({
        id: `sight-launcher-frame-${i + 1}`,
        classes: ['rocket_launcher', 'grenade_launcher'],
        tags: ['military', 'retro'],
        desc: 'flip-up ladder frame sight for launchers',
        h: 0.06 * s,
        draw: (k) => {
          k.box('dark', [0.03, 0.008, 0.03], { p: [0, 0.004, 0] });
          const w = 0.04 * s;
          const h = 0.05 * s;
          k.extrude('main', [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]], 0.004, 'xy', { p: [0, 0.008, 0] }, 0, [
            [[-w / 2 + 0.004, 0.004], [w / 2 - 0.004, 0.004], [w / 2 - 0.004, h - 0.004], [-w / 2 + 0.004, h - 0.004]],
          ]);
          for (let j = 1; j < 4; j++) k.box('main', [w * 0.8, 0.002, 0.003], { p: [0, 0.008 + (j * h) / 4, 0] });
        },
      }),
    );

  // crossbow pin sights
  for (const [i, pins] of [1, 3, 5].entries())
    out.push(
      mk({
        id: `sight-pin-${pins}`,
        classes: ['crossbow', 'blowgun'],
        tags: ['sport', 'precision'],
        desc: `round bow sight housing with ${pins} glowing pins`,
        h: 0.06,
        draw: (k) => {
          k.box('dark', [0.01, 0.03, 0.01], { p: [0, 0.015, 0] });
          k.torus('main', 0.022, 0.005, { p: [0, 0.05, 0] }, 4, 12);
          for (let j = 0; j < pins; j++) {
            const y = 0.05 - 0.012 + (j * 0.024) / Math.max(1, pins - 1) * (pins > 1 ? 1 : 0) + (pins === 1 ? 0.012 : 0);
            k.rod('main', [0.02, y, 0], [0.002, y, 0], 0.0012, 0.0012, 3);
            k.ball('glow', 0.002, [0.002, y, 0], 0);
          }
          void i;
        },
      }),
    );

  // pistol slide sights / fiber
  out.push(
    mk({
      id: 'sight-pistol-lowprofile',
      classes: ['pistol', 'smg'],
      tags: ['compact', 'modern'],
      desc: 'low-profile three-dot pistol sight',
      h: 0.012,
      draw: (k) => {
        k.box('dark', [0.02, 0.008, 0.012], { p: [0, 0.004, 0] });
        k.box('white', [0.003, 0.003, 0.002], { p: [0.006, 0.006, 0.007] });
        k.box('white', [0.003, 0.003, 0.002], { p: [-0.006, 0.006, 0.007] });
      },
    }),
    mk({
      id: 'sight-pistol-fiber',
      classes: ['pistol', 'shotgun'],
      tags: ['sport', 'compact'],
      desc: 'fiber optic sight with glowing rods',
      h: 0.014,
      draw: (k) => {
        k.box('dark', [0.02, 0.01, 0.014], { p: [0, 0.005, 0] });
        k.zrod('glow', -0.007, 0.007, 0.0025, 0.0025, 4, 0.005, 0.011);
        k.zrod('glow', -0.007, 0.007, 0.0025, 0.0025, 4, -0.005, 0.011);
      },
    }),
    mk({
      id: 'sight-rib-bead',
      classes: ['shotgun'],
      tags: ['sport', 'classic'],
      desc: 'simple brass bead sight',
      h: 0.01,
      draw: (k) => {
        k.box('dark', [0.008, 0.004, 0.012], { p: [0, 0.002, 0] });
        k.ball('brass', 0.004, [0, 0.007, 0], 0);
      },
    }),
  );
  // magnifiers
  for (const [i, s] of [1, 1.2].entries())
    out.push(
      mk({
        id: `sight-magnifier-flip-${i + 1}`,
        classes: RIFLES,
        tags: ['tactical', 'military'],
        desc: 'flip-to-side magnifier tube',
        h: 0.06,
        draw: (k) => {
          k.box('dark', [0.026, 0.01, 0.03], { p: [0, 0.005, 0] });
          k.box('dark', [0.012, 0.02, 0.02], { p: [0.01, 0.02, 0] });
          k.zrod('main', -0.035 * s, 0.035 * s, 0.015 * s, 0.015 * s, 8, 0.03, 0.04);
          k.zrod('glow', -0.036 * s, -0.034 * s, 0.012 * s, 0.012 * s, 8, 0.03, 0.04);
        },
      }),
    );

  // silly
  out.push(
    mk({
      id: 'sight-monocle',
      classes: ['weird', 'pistol', 'sniper'],
      tags: ['silly', 'fancy'],
      desc: 'dapper monocle on a chain',
      h: 0.05,
      draw: (k) => {
        k.rod('brass', [0, 0, 0], [0, 0.03, 0], 0.002, 0.002, 4);
        k.torus('brass', 0.016, 0.002, { p: [0, 0.046, 0] }, 3, 12);
        k.zrod('glow', -0.0008, 0.0008, 0.015, 0.015, 10, 0, 0.046);
        k.tube('brass', [[0.016, 0.046, 0], [0.025, 0.02, 0.01], [0.02, -0.01, 0.02]], 0.001, 8, 3);
      },
    }),
    mk({
      id: 'sight-binoculars',
      classes: ['weird', 'sniper'],
      tags: ['silly', 'retro'],
      desc: 'pair of binoculars strapped on top',
      h: 0.06,
      draw: (k) => {
        k.box('dark', [0.02, 0.02, 0.02], { p: [0, 0.01, 0] });
        for (const x of [-0.02, 0.02]) {
          k.zrod('main', -0.04, 0.04, 0.017, 0.014, 8, x, 0.04);
          k.zrod('glow', -0.041, -0.039, 0.014, 0.014, 8, x, 0.04);
        }
        k.box('main', [0.02, 0.01, 0.03], { p: [0, 0.04, 0.01] });
      },
    }),
    mk({
      id: 'sight-eyeball',
      classes: ['weird'],
      tags: ['silly', 'organic', 'spooky'],
      desc: 'giant staring eyeball sight on a stalk',
      h: 0.08,
      draw: (k) => {
        k.tube('#c46a6a', [[0, 0, 0], [0.005, 0.02, 0.005], [0, 0.045, 0]], 0.005, 8, 4);
        k.ball('white', 0.022, [0, 0.06, 0], 1);
        k.zrod('#3a7bd5', -0.024, -0.018, 0.01, 0.01, 8, 0, 0.06);
        k.zrod('#111111', -0.025, -0.023, 0.005, 0.005, 8, 0, 0.06);
      },
    }),
    mk({
      id: 'sight-kaleidoscope',
      classes: ['weird', 'bubble_gun'],
      tags: ['silly', 'toy'],
      desc: 'striped kaleidoscope tube as a scope',
      h: 0.05,
      draw: (k) => {
        mount(k, 0.06, 0.025);
        k.zrod('main', -0.08, 0.08, 0.016, 0.016, 6, 0, 0.035);
        for (let j = 0; j < 4; j++) k.zrod('accent', -0.07 + j * 0.04, -0.06 + j * 0.04, 0.017, 0.017, 6, 0, 0.035);
        k.zrod('glow', -0.081, -0.079, 0.014, 0.014, 6, 0, 0.035);
      },
    }),
  );
  return out;
}
