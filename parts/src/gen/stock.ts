/** STOCK parts: attach to 'stock', extend from origin toward +Z. */
import type { PartDef } from '../types';
import { part, S } from '../lib/define';
import { type Kit, type Pt, chamferRect } from '../lib/kit';

interface St {
  id: string;
  classes: string[];
  tags: string[];
  desc: string;
  len: number;
  draw: (k: Kit) => void;
}

const LONG = ['rifle', 'sniper', 'shotgun', 'lmg'];

function mk(s: St): PartDef {
  return part({
    id: s.id,
    category: 'stock',
    classes: s.classes,
    tags: s.tags,
    desc: s.desc,
    attach: 'stock',
    sockets: { deco: S([0.02, -0.01, s.len * 0.5], [1, 0, 0]) },
    draw: s.draw,
  });
}

/** Classic side-profile: from receiver (z=0) back to butt (z=len). */
function profile(len: number, h0: number, butt: number, drop: number, comb = 0): Pt[] {
  return [
    [0, h0 / 2],
    [len * 0.35, h0 / 2 - drop * 0.3 + comb],
    [len, h0 / 2 - drop],
    [len, h0 / 2 - drop - butt],
    [len * 0.45, -h0 / 2 - drop * 0.4 - (butt - h0) * 0.25],
    [0, -h0 / 2],
  ];
}

export function stockParts(): PartDef[] {
  const out: PartDef[] = [];

  // fixed solid polymer stocks: len x drop
  for (const [li, len] of [0.2, 0.26, 0.32].entries())
    for (const [di, drop] of [0.0, 0.03].entries())
      out.push(
        mk({
          id: `stock-fixed-${['short', 'std', 'long'][li]}${di ? '-dropped' : ''}`,
          classes: LONG,
          tags: ['military', 'standard'],
          desc: `${['short', 'standard', 'long'][li]} fixed polymer stock${di ? ', dropped comb' : ''}`,
          len,
          draw: (k) => {
            k.extrude('main', profile(len, 0.045, 0.12, drop), 0.04, 'zy', undefined, 0.004);
            k.box('rubber', [0.046, 0.125, 0.014], { p: [0, 0.0225 - drop - 0.06, len + 0.006] });
            k.box('dark', [0.005, 0.01, 0.03], { p: [0.023, -0.03 - drop * 0.5, len * 0.6] });
          },
        }),
      );

  // wooden classic stocks (curved wrist)
  for (const [i, [len, butt]] of [
    [0.28, 0.11],
    [0.32, 0.12],
    [0.36, 0.13],
    [0.24, 0.1],
  ].entries())
    out.push(
      mk({
        id: `stock-wood-classic-${i + 1}`,
        classes: ['rifle', 'sniper', 'shotgun'],
        tags: ['wood', 'retro', 'western'],
        desc: 'classic curved wooden rifle stock',
        len,
        draw: (k) => {
          const pts: Pt[] = [
            [0, 0.02],
            [len * 0.3, 0.012],
            [len, 0.005 - 0.02],
            [len + 0.005, -0.02 - butt * 0.5],
            [len, -0.02 - butt],
            [len * 0.6, -0.02 - butt * 0.75],
            [len * 0.3, -0.045],
            [0, -0.025],
          ];
          k.extrude('wood', pts, 0.036, 'zy', undefined, 0.005);
          k.box('dark', [0.04, butt * 0.95, 0.008], { p: [0, -0.02 - butt * 0.5, len + 0.006] });
          k.ball('metal', 0.006, [0.02, -0.03, len * 0.75], 0);
        },
      }),
    );

  // skeleton stocks
  for (const [i, len] of [0.18, 0.22, 0.27, 0.32].entries())
    out.push(
      mk({
        id: `stock-skeleton-${i + 1}`,
        classes: i < 2 ? ['smg', 'rifle', 'pistol'] : LONG,
        tags: ['sleek', 'light', 'modern'],
        desc: 'skeletonized triangular frame stock',
        len,
        draw: (k) => {
          const outer = profile(len, 0.04, 0.11, 0.015);
          const hole: Pt[] = [
            [len * 0.15, 0.008],
            [len * 0.85, -0.01],
            [len * 0.85, -0.075],
            [len * 0.45, -0.04],
          ];
          k.extrude('main', outer, 0.022, 'zy', undefined, 0, [hole.reverse() as Pt[]]);
          k.box('rubber', [0.03, 0.11, 0.014], { p: [0, 0.02 - 0.015 - 0.055, len + 0.006] });
        },
      }),
    );

  // buffer-tube adjustable stocks
  for (const [i, len] of [0.18, 0.22, 0.26, 0.3].entries())
    out.push(
      mk({
        id: `stock-adjustable-${i + 1}`,
        classes: ['rifle', 'smg', 'shotgun'],
        tags: ['military', 'tactical', 'modern'],
        desc: 'collapsible adjustable stock on buffer tube',
        len,
        draw: (k) => {
          k.zrod('dark', 0, len * 0.6, 0.014, 0.014, 8);
          k.extrude(
            'main',
            [
              [len * 0.4, 0.016],
              [len, 0.012],
              [len, -0.1],
              [len - 0.02, -0.1],
              [len * 0.55, -0.03],
              [len * 0.4, -0.02],
            ],
            0.04,
            'zy',
            undefined,
            0.004,
          );
          k.box('rubber', [0.042, 0.115, 0.012], { p: [0, -0.044, len + 0.004] });
          k.box('dark', [0.01, 0.012, 0.02], { p: [0, -0.024, len * 0.48] });
        },
      }),
    );

  // wire / folding stocks
  for (const [i, len] of [0.18, 0.24, 0.3].entries())
    out.push(
      mk({
        id: `stock-wire-${i + 1}`,
        classes: ['smg', 'rifle', 'pistol'],
        tags: ['military', 'retro', 'light'],
        desc: 'bent wire frame folding stock',
        len,
        draw: (k) => {
          for (const x of [-0.016, 0.016]) {
            k.rod('metal', [x, 0.01, 0], [x, 0.0, len], 0.004, 0.004, 5);
            k.rod('metal', [x, -0.03, 0], [x, -0.07, len], 0.004, 0.004, 5);
          }
          k.box('metal', [0.04, 0.09, 0.008], { p: [0, -0.035, len] });
          k.rod('metal', [-0.018, -0.03, 0.005], [0.018, -0.03, 0.005], 0.005, 0.005, 6);
        },
      }),
    );
  out.push(
    mk({
      id: 'stock-folding-side',
      classes: ['smg', 'rifle'],
      tags: ['military', 'tactical'],
      desc: 'side-folding polymer stock, folded flat',
      len: 0.04,
      draw: (k) => {
        k.box('dark', [0.02, 0.03, 0.03], { p: [0, 0, 0.015] });
        k.extrude('main', profile(0.22, 0.03, 0.09, 0.0), 0.018, 'zy', { p: [0.03, 0, 0.03], r: [0, Math.PI, 0] }, 0.003);
      },
    }),
  );

  // thumbhole stocks
  for (const [i, len] of [0.26, 0.3, 0.34].entries())
    out.push(
      mk({
        id: `stock-thumbhole-${i + 1}`,
        classes: ['sniper', 'rifle'],
        tags: ['sport', 'precision', 'sleek'],
        desc: 'sporting thumbhole stock',
        len,
        draw: (k) => {
          const outer: Pt[] = [
            [0, 0.025],
            [len, 0.005],
            [len, -0.12],
            [len * 0.55, -0.08],
            [len * 0.25, -0.13],
            [0, -0.12],
          ];
          const hole: Pt[] = [
            [len * 0.08, -0.015],
            [len * 0.3, -0.015],
            [len * 0.3, -0.07],
            [len * 0.08, -0.09],
          ];
          k.extrude('main', outer, 0.04, 'zy', undefined, 0.004, [hole.reverse() as Pt[]]);
          k.box('rubber', [0.044, 0.13, 0.014], { p: [0, -0.057, len + 0.006] });
        },
      }),
    );

  // sniper adjustable (cheek riser)
  for (const [i, len] of [0.26, 0.3, 0.34, 0.38].entries())
    out.push(
      mk({
        id: `stock-precision-${i + 1}`,
        classes: ['sniper'],
        tags: ['precision', 'military', 'heavy'],
        desc: 'precision stock with cheek riser and adjustable butt',
        len,
        draw: (k) => {
          k.extrude('main', chamferRect(0, -0.11, len - 0.03, 0.015, 0.01), 0.04, 'zy', undefined, 0, [
            chamferRect(len * 0.2, -0.085, len * 0.7, -0.03, 0.008).reverse() as Pt[],
          ]);
          k.box('accent', [0.036, 0.016, len * 0.45], { p: [0, 0.035, len * 0.55] });
          k.rod('metal', [0, 0.015, len * 0.45], [0, 0.03, len * 0.45], 0.004, 0.004, 5);
          k.rod('metal', [0, 0.015, len * 0.7], [0, 0.03, len * 0.7], 0.004, 0.004, 5);
          k.box('rubber', [0.044, 0.13, 0.03], { p: [0, -0.048, len - 0.012] });
          k.rod('dark', [0, -0.11, len * 0.75], [0, -0.16, len * 0.75], 0.008, 0.006, 6);
        },
      }),
    );

  // pistol braces / bullpup pads
  for (const [i, len] of [0.1, 0.14].entries())
    out.push(
      mk({
        id: `stock-brace-${i + 1}`,
        classes: ['pistol', 'smg'],
        tags: ['tactical', 'compact'],
        desc: 'arm brace with strap',
        len,
        draw: (k) => {
          k.zrod('dark', 0, len, 0.014, 0.014, 8);
          k.extrude('main', [[len * 0.2, 0.02], [len, 0.025], [len, -0.04], [len * 0.2, -0.02]], 0.04, 'zy', undefined, 0.004);
          k.box('accent', [0.05, 0.01, 0.02], { p: [0, -0.04, len * 0.6] });
        },
      }),
    );
  for (const [i, h] of [0.1, 0.13].entries())
    out.push(
      mk({
        id: `stock-buttpad-${i + 1}`,
        classes: ['rifle', 'smg', 'sniper', 'lmg'],
        tags: ['military', 'compact'],
        desc: 'short rubber butt pad for bullpups',
        len: 0.03,
        draw: (k) => {
          k.box('main', [0.05, h, 0.018], { p: [0, -h * 0.3, 0.009] });
          k.box('rubber', [0.054, h + 0.006, 0.014], { p: [0, -h * 0.3, 0.025] });
        },
      }),
    );

  // toy stocks
  for (const [i, len] of [0.16, 0.22, 0.28].entries())
    out.push(
      mk({
        id: `stock-toy-${i + 1}`,
        classes: ['bubble_gun', 'weird', 'rifle', 'smg'],
        tags: ['toy', 'chunky'],
        desc: 'chunky rounded toy stock with stripe',
        len,
        draw: (k) => {
          k.ball('main', 1, [0, -0.03, len * 0.5], 1, [0.03, 0.055, len * 0.55]);
          k.box('accent', [0.064, 0.016, len * 0.6], { p: [0, -0.03, len * 0.5] });
          k.ball('white', 0.02, [0, -0.03, len * 1.02], 1);
        },
      }),
    );

  // scifi stocks
  for (const [i, len] of [0.18, 0.24, 0.3, 0.36].entries())
    out.push(
      mk({
        id: `stock-scifi-${i + 1}`,
        classes: ['rifle', 'smg', 'sniper', 'weird'],
        tags: ['scifi', 'sleek'],
        desc: 'angular sci-fi stock with glow line',
        len,
        draw: (k) => {
          const pts: Pt[] = [
            [0, 0.02],
            [len * 0.7, 0.025],
            [len, -0.01],
            [len * 0.95, -0.11],
            [len * 0.6, -0.06],
            [0, -0.03],
          ];
          k.extrude('main', pts, 0.038, 'zy', undefined, 0.003);
          k.box('glow', [0.042, 0.006, len * 0.6], { p: [0, 0.0, len * 0.4] });
          k.box('dark', [0.03, 0.03, 0.03], { p: [0, -0.03, len * 0.85] });
        },
      }),
    );

  // steampunk stocks
  for (const [i, len] of [0.22, 0.28, 0.34].entries())
    out.push(
      mk({
        id: `stock-steampunk-${i + 1}`,
        classes: ['rifle', 'shotgun', 'weird', 'sniper'],
        tags: ['steampunk', 'ornate', 'wood'],
        desc: 'wooden steampunk stock with brass pipes and plate',
        len,
        draw: (k) => {
          k.extrude('wood', profile(len, 0.04, 0.11, 0.02), 0.034, 'zy', undefined, 0.004);
          k.rod('brass', [0.022, 0.015, 0], [0.022, 0.0, len * 0.9], 0.006, 0.006, 6);
          k.rod('brass', [0.022, -0.03, 0], [0.022, -0.07, len * 0.9], 0.006, 0.006, 6);
          k.box('brass', [0.04, 0.115, 0.01], { p: [0, -0.035, len + 0.004] });
          k.torus('brass', 0.015, 0.004, { p: [-0.019, -0.04, len * 0.6], r: [0, Math.PI / 2, 0] }, 3, 10);
        },
      }),
    );

  // crossbow stocks (long wooden)
  for (const [i, len] of [0.25, 0.32, 0.4].entries())
    out.push(
      mk({
        id: `stock-crossbow-${i + 1}`,
        classes: ['crossbow'],
        tags: ['medieval', 'wood'],
        desc: 'long wooden crossbow butt stock',
        len,
        draw: (k) => {
          const pts: Pt[] = [
            [0, 0.02],
            [len, -0.01],
            [len, -0.09],
            [len * 0.5, -0.05],
            [0, -0.025],
          ];
          k.extrude('wood', pts, 0.035, 'zy', undefined, 0.004);
          k.box('metal', [0.038, 0.012, 0.03], { p: [0, -0.005, len * 0.2] });
        },
      }),
    );

  // rocket launcher shoulder rests
  for (const [i, w] of [0.08, 0.11, 0.14].entries())
    out.push(
      mk({
        id: `stock-shoulder-rest-${i + 1}`,
        classes: ['rocket_launcher', 'grenade_launcher'],
        tags: ['military', 'heavy'],
        desc: 'curved shoulder rest pad for launchers',
        len: 0.06,
        draw: (k) => {
          k.zrod('dark', 0, 0.04, 0.012, 0.012, 6, 0, -0.03 - i * 0.01);
          k.extrude('main', [[0, 0], [w, 0], [w * 0.9, 0.03], [w * 0.1, 0.03]], 0.04, 'xy', { p: [-w / 2, -0.05 - i * 0.012, 0.05], r: [0, 0, 0] }, 0.004);
          k.box('rubber', [w, 0.006, 0.04], { p: [0, -0.052 - i * 0.012, 0.05] });
        },
      }),
    );

  // blowgun mouthpieces
  for (const [i, style] of ['cone', 'flared', 'bulb', 'brass'].entries())
    out.push(
      mk({
        id: `stock-mouthpiece-${style}`,
        classes: ['blowgun'],
        tags: style === 'brass' ? ['steampunk', 'ornate'] : ['tribal', 'organic'],
        desc: `${style} blowgun mouthpiece`,
        len: 0.05,
        draw: (k) => {
          if (style === 'cone') k.zrod('wood', 0, 0.05, 0.016, 0.028, 8);
          else if (style === 'flared')
            k.zlathe('wood', [[0.016, 0], [0.018, 0.03], [0.03, 0.045], [0.034, 0.05], [0.012, 0.052]], 8);
          else if (style === 'bulb') k.zlathe('accent', [[0.016, 0], [0.03, 0.02], [0.028, 0.04], [0.014, 0.055], [0.008, 0.056]], 8);
          else {
            k.zlathe('brass', [[0.016, 0], [0.02, 0.02], [0.035, 0.05], [0.03, 0.052], [0.01, 0.03]], 10);
            k.zrod('main', 0.01, 0.018, 0.022, 0.022, 10);
          }
          void i;
        },
      }),
    );

  // bone/organic
  for (const [i, len] of [0.2, 0.28].entries())
    out.push(
      mk({
        id: `stock-bone-${i + 1}`,
        classes: ['rifle', 'weird', 'shotgun', 'crossbow'],
        tags: ['organic', 'spooky', 'tribal'],
        desc: 'big femur bone stock',
        len,
        draw: (k) => {
          k.zrod('white', 0.01, len - 0.01, 0.016, 0.02, 6, 0, -0.03);
          k.ball('white', 0.028, [0.016, -0.03, len], 1);
          k.ball('white', 0.028, [-0.016, -0.04, len], 1);
          k.ball('white', 0.022, [0, -0.03, 0.01], 1);
        },
      }),
    );

  // lmg butt with monopod
  for (const [i, len] of [0.24, 0.3].entries())
    out.push(
      mk({
        id: `stock-lmg-monopod-${i + 1}`,
        classes: ['lmg', 'sniper'],
        tags: ['military', 'heavy'],
        desc: 'heavy lmg butt with folding monopod',
        len,
        draw: (k) => {
          k.extrude('main', profile(len, 0.05, 0.12, 0.01), 0.045, 'zy', undefined, 0.004);
          k.rod('metal', [0, -0.07, len * 0.7], [0, -0.17, len * 0.7], 0.007, 0.007, 6);
          k.box('rubber', [0.03, 0.01, 0.03], { p: [0, -0.175, len * 0.7] });
          k.box('rubber', [0.05, 0.13, 0.012], { p: [0, -0.04, len + 0.004] });
        },
      }),
    );

  // sawed-off grip butts
  for (const [i, len] of [0.08, 0.11].entries())
    out.push(
      mk({
        id: `stock-sawnoff-${i + 1}`,
        classes: ['shotgun', 'pistol'],
        tags: ['wood', 'western', 'compact'],
        desc: 'sawn-off pistol-grip wooden butt',
        len,
        draw: (k) => {
          k.extrude('wood', [[0, 0.02], [len * 0.5, 0.0], [len, -0.08], [len * 0.65, -0.1], [0.0, -0.025]], 0.034, 'zy', undefined, 0.005);
          k.box('dark', [0.036, 0.012, 0.02], { p: [0, -0.095, len * 0.8], r: [0.6, 0, 0] });
        },
      }),
    );
  return out;
}
