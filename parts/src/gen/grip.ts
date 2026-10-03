/** GRIP parts: attach to 'grip', hang from origin toward -Y (raked back toward +Z). */
import type { PartDef } from '../types';
import { part } from '../lib/define';
import type { Kit, Pt } from '../lib/kit';

const GUNS = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg'];

function trigger(k: Kit, gw: number, slot: 'dark' | 'main' | 'accent' | 'metal' = 'dark', size = 1) {
  const z0 = -gw / 2;
  const L = 0.05 * size;
  const H = 0.034 * size;
  const outer: Pt[] = [
    [z0 + 0.002, 0.001],
    [z0 - L, 0.001],
    [z0 - L, -H * 0.6],
    [z0 - L * 0.7, -H],
    [z0 + 0.002, -H],
  ];
  const hole: Pt[] = [
    [z0 - 0.004, -0.004],
    [z0 - L + 0.006, -0.004],
    [z0 - L + 0.006, -H * 0.58],
    [z0 - L * 0.68, -H + 0.006],
    [z0 - 0.004, -H + 0.006],
  ];
  k.extrude(slot, outer, 0.012, 'zy', undefined, 0, [hole]);
  k.extrude(
    'metal',
    [
      [z0 - L * 0.35, 0],
      [z0 - L * 0.5, 0],
      [z0 - L * 0.55, -H * 0.5],
      [z0 - L * 0.4, -H * 0.7],
    ],
    0.006,
    'zy',
  );
}

interface G {
  id: string;
  classes?: string[];
  tags: string[];
  desc: string;
  draw: (k: Kit) => void;
  len?: number;
}

function mk(g: G): PartDef {
  return part({
    id: g.id,
    category: 'grip',
    classes: g.classes ?? GUNS,
    tags: g.tags,
    desc: g.desc,
    attach: 'grip',
    sockets: {},
    draw: g.draw,
  });
}

function slab(len: number, gw: number, rake: number, bot = 1.1): Pt[] {
  return [
    [-gw / 2, 0],
    [gw / 2, 0],
    [gw / 2 + rake + gw * (bot - 1) * 0.5, -len],
    [-gw / 2 + rake - gw * (bot - 1) * 0.5, -len],
  ];
}

export function gripParts(): PartDef[] {
  const out: PartDef[] = [];

  // standard polymer: rake angle x thickness
  for (const [ai, rake] of [0.01, 0.025, 0.04].entries())
    for (const [ti, [gw, th]] of [
      [0.038, 0.028],
      [0.048, 0.036],
    ].entries())
      out.push(
        mk({
          id: `grip-polymer-${['upright', 'raked', 'swept'][ai]}-${ti ? 'fat' : 'slim'}`,
          tags: ['military', 'standard'],
          desc: `${ti ? 'fat' : 'slim'} ${['upright', 'raked', 'steeply swept'][ai]} polymer pistol grip`,
          draw: (k) => {
            k.extrude('main', slab(0.09, gw, rake), th, 'zy', undefined, 0.004);
            k.box('dark', [th + 0.004, 0.035, gw * 0.5], { p: [0, -0.05, rake * 0.55 + gw * 0.2], r: [-rake * 4, 0, 0] });
            trigger(k, gw);
          },
        }),
      );

  // finger groove
  for (const [i, len] of [0.08, 0.095, 0.11].entries())
    out.push(
      mk({
        id: `grip-fingergroove-${i + 1}`,
        tags: ['military', 'ergonomic'],
        desc: 'ergonomic finger-groove grip',
        len,
        draw: (k) => {
          const gw = 0.042;
          const pts: Pt[] = [
            [-gw / 2, 0],
            [gw / 2, 0],
            [gw / 2 + 0.03, -len],
            [-gw / 2 + 0.026, -len],
          ];
          for (let j = 2; j >= 0; j--) {
            const y = -len * (0.25 + j * 0.25);
            const z = -gw / 2 + 0.03 * ((0.25 + j * 0.25));
            pts.push([z - 0.006, y - 0.01], [z, y], [z - 0.006, y + 0.01]);
          }
          // reorder: front edge bumps should go between bottom-front and top-front
          const shape: Pt[] = [pts[0], pts[1], pts[2], pts[3], ...pts.slice(4)];
          k.extrude('main', shape, 0.032, 'zy', undefined, 0.003);
          trigger(k, gw);
        },
      }),
    );

  // wooden revolver grips
  for (const [i, len] of [0.08, 0.095, 0.11].entries())
    out.push(
      mk({
        id: `grip-wood-revolver-${i + 1}`,
        classes: ['pistol', 'shotgun', 'weird'],
        tags: ['wood', 'western', 'retro'],
        desc: 'curved wooden revolver grip with medallion',
        len,
        draw: (k) => {
          const pts: Pt[] = [
            [-0.018, 0],
            [0.022, 0],
            [0.032, -len * 0.5],
            [0.03, -len],
            [0.0, -len * 1.05],
            [-0.01, -len * 0.6],
          ];
          k.extrude('wood', pts, 0.032, 'zy', undefined, 0.004);
          k.rod('brass', [0.018, -len * 0.45, 0.008], [-0.018, -len * 0.45, 0.008], 0.007, 0.007, 8);
          trigger(k, 0.036, 'metal');
        },
      }),
    );

  // birdshead
  for (const [i, len] of [0.07, 0.085].entries())
    out.push(
      mk({
        id: `grip-birdshead-${i + 1}`,
        classes: ['pistol', 'weird'],
        tags: ['retro', 'western', 'compact'],
        desc: 'rounded birdshead pocket grip',
        len,
        draw: (k) => {
          const pts: Pt[] = [
            [-0.016, 0],
            [0.02, 0],
            [0.028, -len * 0.6],
            [0.018, -len],
            [-0.004, -len * 0.98],
            [-0.004, -len * 0.5],
          ];
          k.extrude('main', pts, 0.03, 'zy', undefined, 0.006);
          trigger(k, 0.032, 'metal', 0.8);
        },
      }),
    );

  // rubber wrapped
  for (const [i, rake] of [0.012, 0.025, 0.035].entries())
    out.push(
      mk({
        id: `grip-rubber-wrap-${i + 1}`,
        tags: ['tactical', 'military'],
        desc: 'rubber-sleeved grip with stippled bands',
        draw: (k) => {
          k.extrude('main', slab(0.09, 0.042, rake), 0.032, 'zy', undefined, 0.003);
          for (let j = 0; j < 4; j++) {
            const t = 0.2 + j * 0.2;
            k.box('rubber', [0.038, 0.012, 0.046], { p: [0, -0.09 * t, rake * t], r: [-rake * 6, 0, 0] });
          }
          trigger(k, 0.042);
        },
      }),
    );

  // skeleton
  for (const [i, rake] of [0.015, 0.03, 0.045].entries())
    out.push(
      mk({
        id: `grip-skeleton-${i + 1}`,
        tags: ['sleek', 'light', 'modern'],
        desc: 'skeletonized open-frame grip',
        draw: (k) => {
          const hole: Pt[] = [
            [-0.008, -0.015],
            [0.008, -0.015],
            [0.008 + rake * 0.7, -0.075],
            [-0.008 + rake * 0.7, -0.075],
          ];
          k.extrude('main', slab(0.09, 0.04, rake), 0.026, 'zy', undefined, 0.002, [hole]);
          trigger(k, 0.04);
        },
      }),
    );

  // toy
  for (const [i, s] of [0.9, 1.1, 1.3].entries())
    out.push(
      mk({
        id: `grip-toy-${i + 1}`,
        classes: ['bubble_gun', 'weird', 'pistol', 'smg', 'rifle', 'flamethrower'],
        tags: ['toy', 'chunky'],
        desc: 'chunky rounded toy grip with big trigger',
        len: 0.1 * s,
        draw: (k) => {
          k.ball('main', 1, [0, -0.05 * s, 0.004], 1, [0.022 * s, 0.055 * s, 0.028 * s]);
          k.ball('accent', 0.02 * s, [0, -0.1 * s, 0.018], 1);
          trigger(k, 0.05 * s, 'accent', 1.15);
        },
      }),
    );

  // scifi
  for (const [i, rake] of [0.015, 0.03, 0.045].entries())
    out.push(
      mk({
        id: `grip-scifi-${i + 1}`,
        classes: [...GUNS, 'weird'],
        tags: ['scifi', 'sleek'],
        desc: 'angular sci-fi grip with glow seam',
        draw: (k) => {
          const pts: Pt[] = [
            [-0.02, 0],
            [0.024, 0],
            [0.026 + rake, -0.07],
            [0.016 + rake, -0.095],
            [-0.016 + rake, -0.09],
          ];
          k.extrude('main', pts, 0.032, 'zy', undefined, 0.002);
          k.box('glow', [0.034, 0.004, 0.03], { p: [0, -0.05, rake * 0.5], r: [-0.4, 0, 0] });
          trigger(k, 0.044);
        },
      }),
    );

  // steampunk ornate
  for (const [i, len] of [0.085, 0.1, 0.115].entries())
    out.push(
      mk({
        id: `grip-steampunk-${i + 1}`,
        classes: [...GUNS, 'weird', 'flamethrower'],
        tags: ['steampunk', 'ornate', 'wood'],
        desc: 'ornate wood grip with brass caps',
        len,
        draw: (k) => {
          k.extrude('wood', slab(len, 0.04, 0.03, 1.2), 0.03, 'zy', undefined, 0.004);
          k.box('brass', [0.034, 0.012, 0.052], { p: [0, -len - 0.002, 0.03] });
          k.box('brass', [0.034, 0.01, 0.044], { p: [0, -0.004, 0] });
          k.ball('brass', 0.006, [0.017, -len * 0.5, 0.015], 0);
          k.ball('brass', 0.006, [-0.017, -len * 0.5, 0.015], 0);
          trigger(k, 0.04, 'metal');
        },
      }),
    );

  // vertical tube grips (rocket launchers etc.)
  for (const [i, len] of [0.08, 0.1, 0.12].entries())
    out.push(
      mk({
        id: `grip-tube-vertical-${i + 1}`,
        classes: ['rocket_launcher', 'flamethrower', 'grenade_launcher', 'lmg'],
        tags: ['military', 'heavy'],
        desc: 'vertical tube grip with trigger block',
        len,
        draw: (k) => {
          k.rod('main', [0, 0, 0.005], [0, -len, 0.015], 0.016, 0.017, 8);
          k.box('dark', [0.03, 0.03, 0.05], { p: [0, -0.012, -0.012] });
          trigger(k, 0.03, 'dark');
        },
      }),
    );

  // knuckle-duster
  for (const [i, len] of [0.09, 0.105].entries())
    out.push(
      mk({
        id: `grip-knuckleduster-${i + 1}`,
        classes: ['pistol', 'smg', 'weird', 'melee'],
        tags: ['brutal', 'retro'],
        desc: 'grip with knuckle-duster loop guard',
        len,
        draw: (k) => {
          k.extrude('main', slab(len, 0.038, 0.02), 0.03, 'zy', undefined, 0.003);
          const outer: Pt[] = [
            [-0.019, 0],
            [-0.07, -0.005],
            [-0.075, -len + 0.01],
            [-0.019 + 0.02, -len - 0.006],
            [-0.019 + 0.02, -len + 0.006],
            [-0.062, -len + 0.004],
            [-0.06, -0.012],
            [-0.019, -0.01],
          ];
          k.extrude('metal', outer, 0.012, 'zy');
          for (let j = 0; j < 3; j++) k.rod('metal', [0, -0.025 - j * 0.025, -0.072], [0, -0.025 - j * 0.025, -0.085], 0.005, 0, 4);
        },
      }),
    );

  // D-handle
  for (const [i, w] of [0.09, 0.11].entries())
    out.push(
      mk({
        id: `grip-dhandle-${i + 1}`,
        classes: ['lmg', 'flamethrower', 'weird', 'rocket_launcher'],
        tags: ['heavy', 'industrial'],
        desc: 'big D-shaped carry grip like a chainsaw',
        len: 0.1,
        draw: (k) => {
          k.rod('main', [0, 0, -w / 2], [0, -0.09, -w / 2], 0.01, 0.01, 6);
          k.rod('main', [0, 0, w / 2], [0, -0.09, w / 2], 0.01, 0.01, 6);
          k.rod('rubber', [0, -0.09, -w / 2 - 0.005], [0, -0.09, w / 2 + 0.005], 0.014, 0.014, 8);
          k.box('accent', [0.012, 0.012, 0.03], { p: [0, -0.015, -w / 2 + 0.015] });
        },
      }),
    );

  // wooden spade
  for (const [i, len] of [0.07, 0.09].entries())
    out.push(
      mk({
        id: `grip-spade-${i + 1}`,
        classes: ['lmg', 'weird', 'flamethrower'],
        tags: ['wood', 'retro', 'heavy'],
        desc: 'wooden spade grip with thumb trigger',
        len,
        draw: (k) => {
          k.rod('metal', [0, 0, 0], [0, -len * 0.6, 0.0], 0.008, 0.008, 6);
          k.rod('wood', [-0.045, -len, 0], [0.045, -len, 0], 0.013, 0.013, 8);
          k.rod('metal', [-0.04, -len * 0.6, 0], [0.04, -len * 0.6, 0], 0.006, 0.006, 6);
          k.rod('metal', [-0.04, -len * 0.6, 0], [-0.045, -len, 0], 0.005, 0.005, 6);
          k.rod('metal', [0.04, -len * 0.6, 0], [0.045, -len, 0], 0.005, 0.005, 6);
          k.box('accent', [0.02, 0.01, 0.016], { p: [0, -len * 0.45, -0.01] });
        },
      }),
    );

  // bulbous organic
  for (const [i, s] of [1, 1.25].entries())
    out.push(
      mk({
        id: `grip-organic-${i + 1}`,
        classes: ['weird', 'pistol', 'rifle', 'smg'],
        tags: ['organic', 'alien'],
        desc: 'bulbous fleshy alien grip with knuckle bumps',
        len: 0.1 * s,
        draw: (k) => {
          k.ball('main', 1, [0, -0.045 * s, 0.015], 1, [0.02 * s, 0.05 * s, 0.024 * s]);
          for (let j = 0; j < 3; j++) k.ball('accent', 0.008 * s, [0, -0.025 * s - j * 0.022 * s, -0.008], 0);
          k.extrude('accent', [[-0.02, 0], [-0.07, 0], [-0.05, -0.03], [-0.02, -0.03]], 0.008, 'zy', undefined, 0, [
            [[-0.028, -0.006], [-0.056, -0.006], [-0.045, -0.024], [-0.028, -0.024]],
          ]);
        },
      }),
    );

  // palm-swell target grips
  for (const [i, rake] of [0.02, 0.03, 0.04].entries())
    out.push(
      mk({
        id: `grip-target-${i + 1}`,
        classes: ['pistol', 'sniper', 'rifle'],
        tags: ['sport', 'precision', 'wood'],
        desc: 'target grip with palm shelf',
        draw: (k) => {
          k.extrude('wood', slab(0.1, 0.044, rake, 1.3), 0.036, 'zy', undefined, 0.004);
          k.box('wood', [0.05, 0.012, 0.06], { p: [0.006, -0.1, rake + 0.006] });
          trigger(k, 0.044, 'metal');
        },
      }),
    );

  // silly
  out.push(
    mk({
      id: 'grip-bike-handle',
      classes: ['weird', 'bubble_gun'],
      tags: ['silly', 'toy'],
      desc: 'bicycle handlebar grip with tassels',
      len: 0.11,
      draw: (k) => {
        k.rod('main', [0, 0, 0], [0, -0.1, 0.02], 0.016, 0.016, 8);
        for (let j = 0; j < 5; j++) k.rod('accent', [0, -0.1, 0.02], [Math.cos(j) * 0.02, -0.15, 0.02 + Math.sin(j) * 0.02], 0.002, 0.002, 3);
        for (let j = 0; j < 4; j++) k.torus('dark', 0.016, 0.003, { p: [0, -0.02 - j * 0.022, 0.004 * j], r: [Math.PI / 2, 0, 0] }, 3, 8);
        trigger(k, 0.03, 'accent');
      },
    }),
    mk({
      id: 'grip-joystick',
      classes: ['weird', 'bubble_gun', 'smg'],
      tags: ['silly', 'retro', 'toy'],
      desc: 'arcade joystick grip with red ball top button',
      len: 0.1,
      draw: (k) => {
        k.box('dark', [0.04, 0.012, 0.05], { p: [0, -0.006, 0.0] });
        k.rod('main', [0, -0.012, 0], [0, -0.1, 0.01], 0.016, 0.02, 8);
        k.ball('#d62828', 0.012, [0.02, -0.006, -0.02], 1);
        trigger(k, 0.04, 'accent');
      },
    }),
    mk({
      id: 'grip-hand-skeleton',
      classes: ['weird', 'pistol'],
      tags: ['spooky', 'silly'],
      desc: 'grip shaped like a bony hand',
      len: 0.1,
      draw: (k) => {
        k.extrude('white', slab(0.06, 0.04, 0.02), 0.03, 'zy', undefined, 0.003);
        for (let j = 0; j < 4; j++) {
          k.rod('white', [-0.012 + j * 0.008, -0.06, 0.02], [-0.012 + j * 0.008, -0.1, 0.03], 0.004, 0.004, 4);
          k.ball('white', 0.005, [-0.012 + j * 0.008, -0.1, 0.03], 0);
        }
        trigger(k, 0.04, 'dark');
      },
    }),
  );
  return out;
}
