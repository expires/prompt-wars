/** LAUNCHER parts: rocket tubes, warheads, fins, grenade cylinders, pods. */
import type { PartDef, Socket } from '../types';
import { part, S } from '../lib/define';
import type { Kit } from '../lib/kit';

interface Ln {
  id: string;
  classes?: string[];
  tags: string[];
  desc: string;
  attach: string;
  sockets?: Record<string, Socket>;
  draw: (k: Kit) => void;
}

const RL = ['rocket_launcher'];
const GL = ['grenade_launcher'];

function mk(l: Ln): PartDef {
  return part({
    id: l.id,
    category: 'launcher',
    classes: l.classes ?? RL,
    tags: l.tags,
    desc: l.desc,
    attach: l.attach,
    sockets: l.sockets ?? {},
    draw: l.draw,
  });
}

function fin(k: Kit, slot: 'main' | 'accent' | 'dark', z: number, r: number, len: number, h: number, a: number, x0 = 0, y0 = 0) {
  k.extrude(
    slot,
    [
      [0, 0],
      [len, 0],
      [len, h],
      [len * 0.3, h * 0.5],
    ],
    0.004,
    'zy',
    { p: [x0 + Math.cos(a) * r, y0 + Math.sin(a) * r, z], r: [0, 0, a - Math.PI / 2] },
  );
}

export function launcherParts(): PartDef[] {
  const out: PartDef[] = [];

  // rocket tube extensions (attach to barrel)
  for (const [li, L] of [0.3, 0.5, 0.7].entries())
    for (const [ri, r] of [0.045, 0.065].entries())
      out.push(
        mk({
          id: `launcher-tube-${['short', 'mid', 'long'][li]}-${ri ? 'fat' : 'slim'}`,
          classes: [...RL, 'weird'],
          attach: 'barrel',
          tags: ['military', 'heavy'],
          desc: `${['short', 'medium', 'long'][li]} ${ri ? 'fat' : 'slim'} rocket tube extension`,
          sockets: { muzzle: S([0, 0, -L]), under: S([0, -r, -L * 0.5]) },
          draw: (k) => {
            k.zrod('main', -L, 0, r, r, 10);
            k.zrod('dark', -L - 0.003, -L + 0.004, r * 0.85, r * 0.85, 10);
            k.zrod('accent', -L + 0.02, -L + 0.05, r * 1.08, r * 1.08, 10);
          },
        }),
      );
  for (const [i, L] of [0.4, 0.6].entries())
    out.push(
      mk({
        id: `launcher-tube-flared-${i + 1}`,
        classes: [...RL, 'weird'],
        attach: 'barrel',
        tags: ['retro', 'military'],
        desc: 'rocket tube with flared bell mouth',
        sockets: { muzzle: S([0, 0, -L]), under: S([0, -0.05, -L * 0.5]) },
        draw: (k) => {
          k.zlathe('main', [[0.05, 0], [0.05, -L * 0.8], [0.075, -L], [0.07, -L - 0.004], [0.04, -L * 0.8]], 10);
        },
      }),
    );

  // warheads (attach to muzzle)
  const wh: [string, string, string[], (k: Kit) => void][] = [];
  for (const [i, s] of [0.8, 1, 1.3].entries())
    wh.push([
      `warhead-pointed-${['small', 'std', 'big'][i]}`,
      `${['small', 'standard', 'big'][i]} pointed rocket warhead`,
      ['military'],
      (k) => {
        k.zrod('main', -0.04 * s, 0.0, 0.04 * s, 0.04 * s, 10);
        k.zlathe('accent', [[0.04 * s, -0.04 * s], [0.035 * s, -0.09 * s], [0.018 * s, -0.13 * s], [0.0, -0.15 * s]], 10);
        k.zrod('dark', -0.045 * s, -0.04 * s, 0.041 * s, 0.041 * s, 10);
      },
    ]);
  for (const [i, s] of [1, 1.3].entries())
    wh.push([
      `warhead-heat-${i + 1}`,
      'blunt HEAT warhead with standoff probe',
      ['military', 'modern'],
      (k) => {
        k.zlathe('main', [[0, 0], [0.035 * s, 0], [0.05 * s, -0.04 * s], [0.05 * s, -0.08 * s], [0.03 * s, -0.11 * s], [0.0, -0.11 * s]], 10);
        k.zrod('metal', -0.17 * s, -0.11 * s, 0.008, 0.008, 6);
        k.zrod('accent', -0.175 * s, -0.165 * s, 0.012, 0.012, 6);
      },
    ]);
  for (const [i, s] of [0.9, 1.1, 1.35].entries())
    wh.push([
      `warhead-rpg-${i + 1}`,
      'bulbous RPG-style double-cone warhead',
      ['military', 'retro'],
      (k) => {
        k.zlathe(
          'main',
          [
            [0, 0],
            [0.025 * s, 0.0],
            [0.05 * s, -0.05 * s],
            [0.055 * s, -0.08 * s],
            [0.04 * s, -0.12 * s],
            [0.012 * s, -0.17 * s],
            [0.0, -0.18 * s],
          ],
          10,
        );
        k.zrod('accent', -0.085 * s, -0.075 * s, 0.056 * s, 0.056 * s, 10);
      },
    ]);
  wh.push(
    ['warhead-cartoon-bomb', 'round black cartoon bomb with lit fuse', ['silly', 'toy'], (k) => {
      k.ball('#222222', 0.06, [0, 0, -0.06], 1);
      k.zrod('#222222', -0.01, 0, 0.02, 0.02, 8);
      k.tube('#c8a96e', [[0, 0.055, -0.06], [0, 0.075, -0.07], [0.01, 0.09, -0.06]], 0.004, 6, 4);
      k.ball('glow', 0.008, [0.01, 0.092, -0.06], 0);
    }],
    ['warhead-missile-nose', 'finned guided missile nose with seeker', ['military', 'modern'], (k) => {
      k.zrod('main', -0.08, 0, 0.04, 0.04, 10);
      k.sphere('glow', 0.04, { p: [0, 0, -0.08], r: [-Math.PI / 2, 0, 0] }, 10, 4, Math.PI / 2);
      for (let j = 0; j < 4; j++) fin(k, 'dark', -0.07, 0.04, 0.04, 0.02, (j / 4) * Math.PI * 2 + Math.PI / 4);
    }],
    ['warhead-missile-nose-long', 'long dart missile nose with canards', ['military', 'sleek'], (k) => {
      k.zlathe('main', [[0.04, 0], [0.04, -0.06], [0.025, -0.14], [0.0, -0.2]], 10);
      for (let j = 0; j < 4; j++) fin(k, 'accent', -0.1, 0.03, 0.03, 0.02, (j / 4) * Math.PI * 2);
    }],
    ['warhead-mininuke', 'stubby mini-nuke with radiation stripes', ['silly', 'heavy'], (k) => {
      k.ball('main', 1, [0, 0, -0.07], 1, [0.06, 0.06, 0.08]);
      k.zrod('#ffd23f', -0.08, -0.06, 0.061, 0.061, 10);
      k.zrod('#ffd23f', -0.11, -0.095, 0.05, 0.05, 10);
      k.zrod('dark', -0.01, 0, 0.03, 0.03, 8);
    }],
    ['warhead-firework', 'striped firework rocket with cone', ['silly', 'festive'], (k) => {
      k.zrod('main', -0.12, 0, 0.03, 0.03, 8);
      for (let j = 0; j < 3; j++) k.zrod('white', -0.025 - j * 0.035, -0.012 - j * 0.035, 0.031, 0.031, 8);
      k.zrod('accent', -0.18, -0.12, 0, 0.034, 8);
    }],
    ['warhead-firework-cluster', 'bundle of three firework rockets', ['silly', 'festive'], (k) => {
      for (let j = 0; j < 3; j++) {
        const a = (j / 3) * Math.PI * 2;
        const x = Math.cos(a) * 0.022;
        const y = Math.sin(a) * 0.022;
        k.zrod('main', -0.1, 0, 0.018, 0.018, 6, x, y);
        k.zrod('accent', -0.14, -0.1, 0, 0.02, 6, x, y);
      }
    }],
    ['warhead-carrot', 'giant carrot warhead with leafy tail', ['silly', 'organic'], (k) => {
      k.zrod('#ff8c1a', -0.18, 0, 0.0, 0.04, 8);
      for (let j = 0; j < 4; j++) k.zrod('#2fa84f', -0.004, 0.02, 0.008, 0, 4, 0, (j - 1.5) * 0.012);
    }],
    ['warhead-pineapple', 'pineapple grenade warhead on a stick', ['silly', 'military'], (k) => {
      k.zrod('wood', -0.06, 0, 0.012, 0.012, 6);
      k.ball('#4a6b2a', 1, [0, 0, -0.1], 1, [0.035, 0.035, 0.045]);
      k.zrod('metal', -0.15, -0.14, 0.012, 0.012, 6);
      k.torus('metal', 0.01, 0.002, { p: [0.015, 0, -0.15], r: [0, Math.PI / 2, 0] }, 3, 8);
    }],
    ['warhead-plunger', 'suction plunger warhead', ['silly', 'toy'], (k) => {
      k.zrod('wood', -0.1, 0, 0.01, 0.01, 6);
      k.zlathe('#b0201f', [[0.01, -0.1], [0.035, -0.115], [0.05, -0.14], [0.045, -0.142]], 10);
    }],
    ['warhead-fish', 'flopping fish warhead', ['silly', 'organic'], (k) => {
      k.ball('#7fb3d5', 1, [0, 0, -0.08], 1, [0.025, 0.04, 0.08]);
      k.extrude('#7fb3d5', [[0, 0], [0.04, 0.03], [0.04, -0.03]], 0.006, 'zy', { p: [0, 0, -0.01] });
      k.ball('white', 0.008, [0.018, 0.012, -0.13], 0);
    }],
  );
  for (const [id, d, tags, f] of wh)
    out.push(mk({ id: `launcher-${id}`, classes: [...RL, 'weird'], attach: 'muzzle', tags, desc: d, draw: f }));

  // tail fins (attach to stock)
  for (const [ni, n] of [3, 4].entries())
    for (const [si, s] of [0.8, 1, 1.3].entries())
      out.push(
        mk({
          id: `launcher-tailfins-${n}-${['small', 'std', 'big'][si]}`,
          classes: [...RL, 'weird'],
          attach: 'stock',
          tags: ['military', 'retro'],
          desc: `${['small', 'standard', 'big'][si]} ${n}-fin rocket tail assembly`,
          draw: (k) => {
            const r = 0.03 * s;
            k.zrod('main', 0, 0.08 * s, r, r * 0.8, 8);
            for (let j = 0; j < n; j++) fin(k, 'accent', 0.08 * s, r * 0.8, -0.07 * s, 0.05 * s, (j / n) * Math.PI * 2 + (ni ? Math.PI / 4 : Math.PI / 2));
            k.zrod('dark', 0.08 * s, 0.09 * s, r * 0.6, r * 0.5, 8);
          },
        }),
      );

  // grenade cylinders (attach to mag; top chamber sits on the bore line at origin)
  out.push(
    ...([
      [4, 0.05, 0.12],
      [6, 0.06, 0.14],
      [6, 0.075, 0.18],
      [8, 0.08, 0.14],
      [12, 0.095, 0.1],
      [5, 0.055, 0.2],
    ] as const).map(([n, R, L], i) =>
      mk({
        id: `launcher-cylinder-${n}shot-${i + 1}`,
        classes: [...GL, 'weird', 'shotgun'],
        attach: 'mag',
        tags: ['military', 'heavy', 'revolver'],
        desc: `${n}-shot revolving grenade cylinder`,
        draw: (k) => {
          // top chamber is centred on the origin (bore line); cylinder axis is below
          const ring = R * 0.62;
          const cy = -ring;
          k.zrod('main', -L / 2, L / 2, R, R, 12, 0, cy);
          const rr = Math.min(R * 0.28, Math.sin(Math.PI / n) * ring * 0.8);
          for (let j = 0; j < n; j++) {
            const a = (j / n) * Math.PI * 2 + Math.PI / 2;
            const x = Math.cos(a) * ring;
            const y = cy + Math.sin(a) * ring;
            k.zrod('dark', -L / 2 - 0.002, -L / 2 + 0.003, rr, rr, n > 6 ? 5 : 7, x, y);
          }
          for (let j = 0; j < n; j++) {
            const a = (j / n) * Math.PI * 2 + Math.PI / 2 + Math.PI / n;
            k.zrod('accent', -L * 0.35, L * 0.35, R * 0.07, R * 0.07, 3, Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98);
          }
          k.zrod('metal', -L / 2 - 0.012, L / 2 + 0.012, R * 0.14, R * 0.14, 6, 0, cy);
        },
      }),
    ),
  );

  // multi-tube pods (top / side)
  const pods: [string, string, string, [number, number][]][] = [
    ['pod-2x2', 'four-tube rocket pod on top', 'top', [[-1, 0], [1, 0], [-1, 2], [1, 2]]],
    ['pod-3x1', 'three-tube rocket rack on top', 'top', [[-2, 0], [0, 0], [2, 0]]],
    ['pod-honeycomb', 'seven-tube honeycomb rocket pod', 'side', [[0, 0], [2, 0], [-2, 0], [1, 1.7], [-1, 1.7], [1, -1.7], [-1, -1.7]]],
    ['pod-twin-side', 'twin rocket tubes on the side', 'side', [[0, 1], [0, -1]]],
  ];
  for (const [n, d, att, cells] of pods)
    out.push(
      mk({
        id: `launcher-${n}`,
        classes: [...RL, 'weird', 'lmg'],
        attach: att,
        tags: ['military', 'heavy'],
        desc: d,
        draw: (k) => {
          const r = 0.022;
          const L = 0.28;
          const base = att === 'top' ? [0, r * 1.2 + 0.01] : [r * 3.4, 0];
          for (const [cx, cy] of cells) {
            const x = base[0] + cx * r * 1.05;
            const y = base[1] + cy * r * 1.05;
            k.zrod('main', -L / 2, L / 2, r, r, 8, x, y);
            k.zrod('accent', -L / 2 - 0.004, -L / 2 + 0.002, r * 0.7, r * 0.7, 8, x, y);
          }
          if (att === 'top') k.box('dark', [0.02, 0.012, 0.06], { p: [0, 0.006, 0] });
          else k.box('dark', [0.012 + r * 1.2, 0.02, 0.06], { p: [(0.012 + r * 1.2) / 2, 0, 0] });
        },
      }),
    );

  // blast shields
  for (const [i, s] of [1, 1.3].entries())
    out.push(
      mk({
        id: `launcher-blast-shield-${i + 1}`,
        classes: [...RL, 'grenade_launcher'],
        attach: 'side',
        tags: ['military', 'heavy'],
        desc: 'rectangular blast shield with viewing slot',
        draw: (k) => {
          k.box('dark', [0.03, 0.012, 0.012], { p: [0.015, 0, 0] });
          k.extrude('main', [[-0.06 * s, -0.05 * s], [0.06 * s, -0.05 * s], [0.06 * s, 0.07 * s], [-0.06 * s, 0.07 * s]], 0.006, 'xy', { p: [0.06 * s + 0.03, 0, -0.02] }, 0, [
            [[-0.04 * s, 0.03 * s], [0.0, 0.03 * s], [0.0, 0.04 * s], [-0.04 * s, 0.04 * s]],
          ]);
        },
      }),
    );

  // rear venturi cones (stock)
  for (const [i, s] of [0.8, 1, 1.3].entries())
    out.push(
      mk({
        id: `launcher-venturi-${i + 1}`,
        classes: RL,
        attach: 'stock',
        tags: ['military'],
        desc: 'rear exhaust venturi cone',
        draw: (k) => {
          k.zlathe('main', [[0.045 * s, 0], [0.035 * s, 0.03 * s], [0.06 * s, 0.09 * s], [0.055 * s, 0.092 * s], [0.03 * s, 0.035 * s]], 10);
          k.zrod('dark', 0.025 * s, 0.035 * s, 0.032 * s, 0.032 * s, 10);
        },
      }),
    );

  // grenade bandoliers on top
  for (const [i, n] of [3, 5].entries())
    out.push(
      mk({
        id: `launcher-grenade-bandolier-${n}`,
        classes: [...GL, 'weird'],
        attach: 'side',
        tags: ['military', 'heavy'],
        desc: `side bandolier of ${n} spare grenades`,
        draw: (k) => {
          const w = n * 0.042;
          k.box('#5a5236', [0.008, 0.05, w], { p: [0.004, 0, 0] });
          for (let j = 0; j < n; j++) {
            const z = -w / 2 + 0.021 + j * 0.042;
            k.rod('main', [0.026, -0.03, z], [0.026, 0.02, z], 0.018, 0.018, 8);
            k.lathe('accent', [[0.018, 0], [0.012, 0.012], [0, 0.016]], 8, { p: [0.026, 0.02, z] });
          }
          void i;
        },
      }),
    );

  // target designators / launch rails
  for (const [i, s] of [1, 1.25].entries())
    out.push(
      mk({
        id: `launcher-designator-${i + 1}`,
        classes: [...RL, 'sniper'],
        attach: 'top',
        tags: ['military', 'modern'],
        desc: 'target designator box with antenna',
        draw: (k) => {
          k.box('main', [0.05 * s, 0.04 * s, 0.08 * s], { p: [0, 0.025 * s, 0] });
          k.zrod('#ff2a2a', -0.042 * s, -0.04 * s, 0.01, 0.01, 8, 0.012, 0.025 * s);
          k.zrod('glow', -0.042 * s, -0.04 * s, 0.01, 0.01, 8, -0.012, 0.025 * s);
          k.rod('dark', [0.02, 0.045 * s, 0.03], [0.02, 0.12 * s, 0.035], 0.002, 0.001, 3);
        },
      }),
      mk({
        id: `launcher-rail-${i + 1}`,
        classes: [...RL, 'weird'],
        attach: 'top',
        tags: ['military', 'heavy'],
        desc: 'open launch rail with mini missile',
        draw: (k) => {
          k.box('dark', [0.02 * s, 0.01, 0.3 * s], { p: [0, 0.015, 0] });
          k.box('dark', [0.01, 0.015, 0.02], { p: [0, 0.007, 0] });
          k.zrod('main', -0.12 * s, 0.12 * s, 0.014 * s, 0.014 * s, 8, 0, 0.034 * s);
          k.zrod('accent', -0.16 * s, -0.12 * s, 0, 0.014 * s, 8, 0, 0.034 * s);
          for (let j = 0; j < 4; j++) fin(k, 'main', 0.12 * s, 0.014 * s, -0.04 * s, 0.015 * s, (j / 4) * Math.PI * 2 + Math.PI / 4, 0, 0.034 * s);
        },
      }),
    );
  return out;
}
