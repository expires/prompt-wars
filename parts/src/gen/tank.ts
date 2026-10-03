/** TANK parts: attach to 'tank', hang from origin toward -Y. Long axis along Z unless noted. */
import type { PartDef } from '../types';
import { part } from '../lib/define';
import type { Kit } from '../lib/kit';

interface T {
  id: string;
  classes: string[];
  tags: string[];
  desc: string;
  draw: (k: Kit) => void;
}

const FLAME = ['flamethrower'];
const BUB = ['bubble_gun'];

function mk(t: T): PartDef {
  return part({ id: t.id, category: 'tank', classes: t.classes, tags: t.tags, desc: t.desc, attach: 'tank', sockets: {}, draw: t.draw });
}

/** horizontal capsule tank centred at (x, y, 0) */
function capsule(k: Kit, slot: 'main' | 'accent' | 'brass' | 'metal', L: number, r: number, x: number, y: number) {
  k.rod(slot, [x, y, -L / 2 + r * 0.6], [x, y, L / 2 - r * 0.6], r, r, 8, true);
  k.sphere(slot, r, { p: [x, y, -L / 2 + r * 0.6], r: [-Math.PI / 2, 0, 0], s: [1, 0.6, 1] }, 8, 3, Math.PI / 2);
  k.sphere(slot, r, { p: [x, y, L / 2 - r * 0.6], r: [Math.PI / 2, 0, 0], s: [1, 0.6, 1] }, 8, 3, Math.PI / 2);
}

function strap(k: Kit, z: number, r: number, y: number, w: number) {
  k.zrod('dark', z - 0.006, z + 0.006, r * 1.04, r * 1.04, 10, 0, y);
  k.box('dark', [w, Math.abs(y) - r * 0.9, 0.012], { p: [0, y / 2 + (r * 0.45) * Math.sign(-y), z] });
}

export function tankParts(): PartDef[] {
  const out: PartDef[] = [];

  // single horizontal cylinders: len x radius
  for (const [li, L] of [0.16, 0.24, 0.32].entries())
    for (const [ri, r] of [0.03, 0.042].entries())
      out.push(
        mk({
          id: `tank-cyl-${['short', 'mid', 'long'][li]}-${ri ? 'fat' : 'slim'}`,
          classes: [...FLAME, ...BUB, 'weird'],
          tags: ['military', 'industrial'],
          desc: `${['short', 'mid', 'long'][li]} ${ri ? 'fat' : 'slim'} horizontal fuel tank with straps`,
          draw: (k) => {
            const y = -0.012 - r;
            capsule(k, 'main', L, r, 0, y);
            strap(k, -L * 0.25, r, y, 0.012);
            strap(k, L * 0.25, r, y, 0.012);
            k.rod('metal', [0, y + r, L / 2 - r], [0, y + r + 0.008, L / 2 - r], 0.006, 0.006, 6);
          },
        }),
      );

  // vertical tanks
  for (const [i, [h, r]] of [
    [0.12, 0.03],
    [0.16, 0.035],
    [0.2, 0.04],
  ].entries())
    out.push(
      mk({
        id: `tank-vertical-${i + 1}`,
        classes: [...FLAME, ...BUB],
        tags: ['industrial'],
        desc: 'upright cylinder tank with valve cap',
        draw: (k) => {
          k.rod('metal', [0, 0, 0], [0, -0.01, 0], 0.01, 0.01, 6);
          k.lathe('main', [[0.01, 0], [r * 0.8, -0.008], [r, -0.025], [r, -h + 0.02], [r * 0.8, -h], [0, -h]], 10, { p: [0, -0.01, 0] });
          k.rod('dark', [0, -0.01 - h * 0.3, 0], [0, -0.01 - h * 0.34, 0], r * 1.04, r * 1.04, 10);
        },
      }),
    );

  // twin / triple
  for (const [i, L] of [0.18, 0.26, 0.34].entries())
    out.push(
      mk({
        id: `tank-twin-${i + 1}`,
        classes: [...FLAME, 'weird'],
        tags: ['military', 'heavy'],
        desc: 'twin side-by-side pressure tanks with bridge',
        draw: (k) => {
          const r = 0.028;
          for (const x of [-r * 1.05, r * 1.05]) capsule(k, 'main', L, r, x, -0.012 - r);
          k.box('dark', [r * 2.2, 0.012, L * 0.6], { p: [0, -0.008, 0] });
          k.ball('accent', 0.012, [0, -0.014 - r * 2, 0], 0);
        },
      }),
    );
  for (const [i, L] of [0.22, 0.3].entries())
    out.push(
      mk({
        id: `tank-triple-${i + 1}`,
        classes: [...FLAME, 'weird'],
        tags: ['military', 'heavy'],
        desc: 'triple tank cluster',
        draw: (k) => {
          const r = 0.024;
          capsule(k, 'main', L, r, -r * 1.05, -0.012 - r);
          capsule(k, 'main', L, r, r * 1.05, -0.012 - r);
          capsule(k, 'accent', L * 0.9, r, 0, -0.012 - r * 2.8);
        },
      }),
    );

  // spherical pressure tanks
  for (const [i, r] of [0.035, 0.045, 0.06].entries())
    out.push(
      mk({
        id: `tank-sphere-${i + 1}`,
        classes: [...FLAME, ...BUB, 'weird'],
        tags: ['scifi', 'industrial'],
        desc: 'spherical pressure tank with equator band',
        draw: (k) => {
          k.rod('metal', [0, 0, 0], [0, -0.012, 0], 0.01, 0.01, 6);
          k.ball('main', r, [0, -0.012 - r, 0], 1);
          k.torus('dark', r * 1.0, r * 0.08, { p: [0, -0.012 - r, 0], r: [Math.PI / 2, 0, 0] }, 3, 14);
        },
      }),
    );

  // capsule with gauge
  for (const [i, L] of [0.16, 0.22, 0.28].entries())
    out.push(
      mk({
        id: `tank-gauge-${i + 1}`,
        classes: [...FLAME, 'weird'],
        tags: ['industrial', 'retro'],
        desc: 'fuel tank with round pressure gauge',
        draw: (k) => {
          const r = 0.034;
          capsule(k, 'main', L, r, 0, -0.012 - r);
          k.rod('metal', [r, -0.012 - r, 0], [r + 0.012, -0.012 - r, 0], 0.005, 0.005, 6);
          k.rod('white', [r + 0.012, -0.012 - r, 0], [r + 0.02, -0.012 - r, 0], 0.016, 0.016, 10);
          k.rod('dark', [r + 0.02, -0.012 - r, 0], [r + 0.021, -0.012 - r + 0.01, 0.004], 0.0015, 0.0015, 3);
        },
      }),
    );

  // soap tanks
  const soap: [string, string, (k: Kit) => void][] = [
    ['jug', 'translucent soap jug with handle', (k) => {
      k.box('main', [0.06, 0.08, 0.08], { p: [0, -0.05, 0] });
      k.torus('main', 0.02, 0.006, { p: [0, -0.02, 0.02], r: [0, Math.PI / 2, 0] }, 3, 8, Math.PI);
      k.box('glow', [0.062, 0.03, 0.06], { p: [0, -0.07, 0] });
    }],
    ['bubble-dome', 'clear dome full of bubble solution', (k) => {
      k.rod('dark', [0, 0, 0], [0, -0.015, 0], 0.03, 0.035, 10);
      k.sphere('glow', 0.045, { p: [0, -0.015, 0], r: [Math.PI, 0, 0] }, 10, 5, Math.PI / 2);
    }],
    ['bottle-rack', 'rack of three soap bottles', (k) => {
      k.box('dark', [0.09, 0.01, 0.04], { p: [0, -0.005, 0] });
      for (const x of [-0.03, 0, 0.03]) {
        k.rod('main', [x, -0.01, 0], [x, -0.08, 0], 0.013, 0.013, 8);
        k.rod('accent', [x, -0.08, 0], [x, -0.095, 0], 0.006, 0.006, 6);
      }
    }],
    ['duck-tank', 'rubber duck shaped soap reservoir', (k) => {
      k.ball('#ffd23f', 1, [0, -0.04, 0.01], 1, [0.04, 0.03, 0.05]);
      k.ball('#ffd23f', 0.022, [0, -0.065, -0.035], 1);
      k.extrude('#ff8c1a', [[0, 0], [-0.02, 0.004], [0, 0.012]], 0.016, 'zy', { p: [0, -0.07, -0.055] });
    }],
  ];
  for (const [n, d, f] of soap) out.push(mk({ id: `tank-soap-${n}`, classes: [...BUB, 'weird'], tags: ['toy', 'silly', 'clean'], desc: d, draw: f }));

  // jerry cans / propane
  for (const [i, s] of [0.8, 1].entries())
    out.push(
      mk({
        id: `tank-jerrycan-${i + 1}`,
        classes: [...FLAME, 'weird'],
        tags: ['military', 'improvised'],
        desc: 'stamped jerry can with X ribs',
        draw: (k) => {
          k.box('main', [0.05 * s, 0.12 * s, 0.14 * s], { p: [0, -0.06 * s - 0.01, 0] });
          k.box('main', [0.052 * s, 0.01, 0.12 * s], { p: [0, -0.06 * s - 0.01, 0], r: [0.7, 0, 0] });
          k.box('main', [0.052 * s, 0.01, 0.12 * s], { p: [0, -0.06 * s - 0.01, 0], r: [-0.7, 0, 0] });
          k.rod('dark', [0, -0.01, -0.05 * s], [0, 0, -0.06 * s], 0.01, 0.01, 6);
        },
      }),
      mk({
        id: `tank-propane-${i + 1}`,
        classes: [...FLAME, 'weird'],
        tags: ['industrial', 'improvised'],
        desc: 'barbecue propane bottle with collar',
        draw: (k) => {
          const r = 0.04 * s;
          k.lathe('main', [[0.012, 0], [0.02, -0.012], [r, -0.03], [r, -0.12 * s], [r * 0.9, -0.13 * s], [0, -0.13 * s]], 10, {});
          k.rod('metal', [0, 0, 0], [0, -0.02, 0], 0.025, 0.025, 8, true);
        },
      }),
    );

  // fishbowls / glass chambers
  for (const [i, r] of [0.045, 0.06].entries())
    out.push(
      mk({
        id: `tank-fishbowl-${i + 1}`,
        classes: [...BUB, 'weird'],
        tags: ['silly', 'organic'],
        desc: 'fishbowl tank with a little fish inside',
        draw: (k) => {
          k.rod('dark', [0, 0, 0], [0, -0.012, 0], r * 0.5, r * 0.5, 10);
          k.ball('glow', r, [0, -0.012 - r, 0], 1);
          k.ball('#ff8c1a', 1, [0, -0.012 - r, 0], 0, [0.006, 0.01, 0.016]);
        },
      }),
      mk({
        id: `tank-glass-chamber-${i + 1}`,
        classes: [...BUB, ...FLAME, 'weird'],
        tags: ['scifi', 'steampunk'],
        desc: 'glass chamber of glowing liquid in brass cage',
        draw: (k) => {
          const h = r * 2.6;
          k.rod('brass', [0, 0, 0], [0, -0.012, 0], r * 0.9, r * 0.9, 10);
          k.rod('glow', [0, -0.012, 0], [0, -0.012 - h, 0], r * 0.8, r * 0.8, 10);
          k.rod('brass', [0, -0.012 - h, 0], [0, -0.024 - h, 0], r * 0.9, r * 0.9, 10);
          for (let j = 0; j < 4; j++) {
            const a = (j / 4) * Math.PI * 2;
            k.rod('brass', [Math.cos(a) * r * 0.85, -0.012, Math.sin(a) * r * 0.85], [Math.cos(a) * r * 0.85, -0.012 - h, Math.sin(a) * r * 0.85], 0.003, 0.003, 4);
          }
        },
      }),
    );

  // steampunk boilers
  for (const [i, L] of [0.18, 0.24, 0.3].entries())
    out.push(
      mk({
        id: `tank-boiler-${i + 1}`,
        classes: [...FLAME, 'weird', ...BUB],
        tags: ['steampunk', 'ornate'],
        desc: 'riveted brass boiler with chimney',
        draw: (k) => {
          const r = 0.038;
          const y = -0.012 - r;
          capsule(k, 'brass', L, r, 0, y);
          for (const z of [-L * 0.3, 0, L * 0.3]) k.zrod('main', z - 0.005, z + 0.005, r * 1.04, r * 1.04, 10, 0, y);
          k.rod('dark', [r * 0.6, y + r * 0.6, L * 0.3], [r * 0.9, y + r * 1.8, L * 0.3], 0.008, 0.01, 6);
        },
      }),
    );

  // backpack hose loops
  for (const [i, s] of [0.8, 1, 1.3].entries())
    out.push(
      mk({
        id: `tank-hose-loop-${i + 1}`,
        classes: [...FLAME, ...BUB, 'weird'],
        tags: ['military', 'industrial'],
        desc: 'ribbed hose looping back to a backpack',
        draw: (k) => {
          k.rod('metal', [0, 0, 0], [0, -0.015, 0], 0.012, 0.012, 6);
          k.tube(
            'rubber',
            [
              [0, -0.015, 0],
              [0, -0.06 * s, 0.03 * s],
              [0.03 * s, -0.1 * s, 0.12 * s],
              [0.06 * s, -0.08 * s, 0.22 * s],
              [0.08 * s, -0.02 * s, 0.28 * s],
            ],
            0.011,
            20,
            5,
          );
          k.ball('metal', 0.016, [0.08 * s, -0.02 * s, 0.28 * s], 0);
        },
      }),
    );

  // scifi fuel cells
  for (const [i, L] of [0.14, 0.2].entries())
    out.push(
      mk({
        id: `tank-scifi-cell-${i + 1}`,
        classes: [...FLAME, 'weird', 'rifle', 'lmg'],
        tags: ['scifi', 'energy'],
        desc: 'hexagonal glowing fuel cell in frame',
        draw: (k) => {
          const r = 0.03;
          k.zrod('glow', -L / 2, L / 2, r, r, 6, 0, -0.014 - r);
          k.zrod('main', -L / 2 - 0.012, -L / 2, r * 1.2, r * 1.2, 6, 0, -0.014 - r);
          k.zrod('main', L / 2, L / 2 + 0.012, r * 1.2, r * 1.2, 6, 0, -0.014 - r);
          k.box('main', [0.012, 0.014, L], { p: [0, -0.007, 0] });
        },
      }),
    );

  out.push(
    mk({
      id: 'tank-milk-jug',
      classes: ['weird', ...BUB],
      tags: ['silly', 'improvised'],
      desc: 'gallon milk jug sloshing underneath',
      draw: (k) => {
        k.box('white', [0.07, 0.1, 0.07], { p: [0, -0.06, 0] });
        k.rod('accent', [0, -0.005, -0.02], [0, -0.012, -0.02], 0.012, 0.012, 8);
        k.box('#3a7bd5', [0.072, 0.03, 0.05], { p: [0, -0.06, 0] });
      },
    }),
    mk({
      id: 'tank-fire-extinguisher',
      classes: [...FLAME, ...BUB, 'weird'],
      tags: ['silly', 'industrial'],
      desc: 'red fire extinguisher bolted underneath',
      draw: (k) => {
        k.zrod('#d62828', -0.1, 0.08, 0.035, 0.035, 10, 0, -0.047);
        k.sphere('#d62828', 0.035, { p: [0, -0.047, -0.1], r: [-Math.PI / 2, 0, 0] }, 10, 4, Math.PI / 2);
        k.box('dark', [0.02, 0.02, 0.03], { p: [0, -0.01, -0.12] });
      },
    }),
  );
  return out;
}
