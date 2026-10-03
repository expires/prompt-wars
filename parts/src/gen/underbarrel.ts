/** UNDERBARREL / ACCESSORY parts: attach to 'under' (hang -Y) or 'side' (+X). */
import type { PartDef } from '../types';
import { part, S } from '../lib/define';
import type { Kit, Pt } from '../lib/kit';

interface U {
  id: string;
  classes: string[];
  tags: string[];
  desc: string;
  attach?: string;
  draw: (k: Kit) => void;
}

const LONG = ['rifle', 'smg', 'shotgun', 'lmg', 'sniper'];

function mk(u: U): PartDef {
  return part({
    id: u.id,
    category: 'underbarrel',
    classes: u.classes,
    tags: u.tags,
    desc: u.desc,
    attach: u.attach ?? 'under',
    sockets: {},
    draw: u.draw,
  });
}

function railClamp(k: Kit, len = 0.04) {
  k.box('dark', [0.026, 0.01, len], { p: [0, -0.005, 0] });
}

export function underbarrelParts(): PartDef[] {
  const out: PartDef[] = [];

  // vertical foregrips: length x style
  for (const [li, len] of [0.05, 0.075, 0.1].entries()) {
    out.push(
      mk({
        id: `under-foregrip-vertical-${['stubby', 'std', 'long'][li]}`,
        classes: LONG,
        tags: ['tactical', 'military'],
        desc: `${['stubby', 'standard', 'long'][li]} vertical foregrip`,
        draw: (k) => {
          railClamp(k);
          k.rod('main', [0, -0.008, 0], [0, -0.008 - len, 0.004], 0.014, 0.016, 8);
          k.rod('dark', [0, -0.008 - len, 0.004], [0, -0.014 - len, 0.004], 0.017, 0.014, 8);
          for (let i = 0; i < 3; i++) k.rod('rubber', [0, -0.02 - i * (len / 4), 0.001], [0, -0.026 - i * (len / 4), 0.0012], 0.0165, 0.0165, 8);
        },
      }),
      mk({
        id: `under-foregrip-ergo-${['stubby', 'std', 'long'][li]}`,
        classes: LONG,
        tags: ['tactical', 'ergonomic'],
        desc: `${['stubby', 'standard', 'long'][li]} finger-grooved ergonomic foregrip`,
        draw: (k) => {
          railClamp(k);
          const pts: Pt[] = [
            [-0.014, 0],
            [0.014, 0],
            [0.018, -len],
            [-0.012, -len],
            [-0.016, -len * 0.75],
            [-0.011, -len * 0.5],
            [-0.016, -len * 0.25],
          ];
          k.extrude('main', pts, 0.026, 'zy', { p: [0, -0.008, 0] }, 0.003);
        },
      }),
    );
  }
  // angled foregrips
  for (const [i, len] of [0.06, 0.08, 0.1].entries())
    out.push(
      mk({
        id: `under-foregrip-angled-${i + 1}`,
        classes: LONG,
        tags: ['tactical', 'modern'],
        desc: 'angled wedge foregrip',
        draw: (k) => {
          k.extrude('main', [[-len / 2, 0], [len / 2, 0], [len / 2 - 0.01, -0.012], [-len / 2 + 0.01 - 0.02, -0.035]], 0.026, 'zy', undefined, 0.003);
        },
      }),
    );
  // hand stops
  for (const [i, h] of [0.015, 0.025].entries())
    out.push(
      mk({
        id: `under-handstop-${i + 1}`,
        classes: LONG,
        tags: ['tactical', 'compact'],
        desc: 'small curved hand stop',
        draw: (k) => {
          railClamp(k, 0.03);
          k.extrude('main', [[0.015, 0], [-0.015, 0], [-0.02, -h], [-0.012, -h]], 0.024, 'zy', undefined, 0.002);
        },
      }),
    );

  // bipods folded/deployed
  for (const [li, len] of [0.12, 0.17, 0.22].entries()) {
    out.push(
      mk({
        id: `under-bipod-folded-${['short', 'std', 'long'][li]}`,
        classes: ['sniper', 'lmg', 'rifle'],
        tags: ['military', 'precision'],
        desc: `${['short', 'standard', 'long'][li]} bipod folded forward`,
        draw: (k) => {
          railClamp(k);
          k.box('dark', [0.04, 0.016, 0.03], { p: [0, -0.016, 0] });
          for (const x of [-0.012, 0.012]) {
            k.rod('main', [x, -0.022, -0.005], [x, -0.03, -len], 0.005, 0.005, 6);
            k.rod('rubber', [x, -0.03, -len], [x, -0.032, -len - 0.012], 0.006, 0.004, 6);
          }
        },
      }),
      mk({
        id: `under-bipod-deployed-${['short', 'std', 'long'][li]}`,
        classes: ['sniper', 'lmg', 'rifle'],
        tags: ['military', 'precision'],
        desc: `${['short', 'standard', 'long'][li]} bipod legs deployed`,
        draw: (k) => {
          railClamp(k);
          k.box('dark', [0.04, 0.016, 0.03], { p: [0, -0.016, 0] });
          for (const x of [-1, 1]) {
            const end: [number, number, number] = [x * len * 0.45, -0.02 - len * 0.88, -0.01];
            k.rod('main', [x * 0.014, -0.022, 0], end, 0.005, 0.005, 6);
            k.ball('rubber', 0.008, end, 0);
          }
        },
      }),
    );
  }
  out.push(
    mk({
      id: 'under-gripod',
      classes: ['rifle', 'lmg', 'smg'],
      tags: ['tactical', 'military'],
      desc: 'foregrip with pop-out bipod legs',
      draw: (k) => {
        railClamp(k);
        k.rod('main', [0, -0.008, 0], [0, -0.1, 0], 0.016, 0.016, 8);
        for (const x of [-1, 1]) k.rod('metal', [0, -0.1, 0], [x * 0.05, -0.15, 0], 0.004, 0.004, 5);
      },
    }),
  );

  // lasers
  for (const [i, [len, box]] of [
    [0.04, true],
    [0.06, true],
    [0.05, false],
    [0.08, false],
  ].entries())
    out.push(
      mk({
        id: `under-laser-${box ? 'box' : 'tube'}-${(i % 2) + 1}`,
        classes: ['pistol', ...LONG, 'crossbow'],
        tags: ['tactical', 'modern'],
        desc: `${box ? 'boxy' : 'tubular'} laser aiming module`,
        draw: (k) => {
          railClamp(k, (len as number) * 0.6);
          const L = len as number;
          if (box) k.box('main', [0.026, 0.02, L], { p: [0, -0.02, 0] });
          else k.zrod('main', -L / 2, L / 2, 0.011, 0.011, 8, 0, -0.02);
          k.zrod('#ff2a2a', -L / 2 - 0.003, -L / 2, 0.004, 0.004, 6, 0, -0.02);
          k.box('accent', [0.006, 0.006, 0.01], { p: [0.014, -0.02, L * 0.2] });
        },
      }),
    );
  // flashlights
  for (const [i, [len, r]] of [
    [0.06, 0.012],
    [0.09, 0.014],
    [0.12, 0.018],
  ].entries())
    out.push(
      mk({
        id: `under-flashlight-${['mini', 'std', 'big'][i]}`,
        classes: ['pistol', ...LONG, 'flamethrower', 'crossbow'],
        tags: ['tactical', 'military'],
        desc: `${['mini', 'standard', 'big'][i]} weapon flashlight`,
        draw: (k) => {
          railClamp(k, 0.03);
          k.zrod('main', -len * 0.6, len / 2, r * 0.8, r * 0.8, 8, 0, -0.012 - r);
          k.zrod('main', -len / 2 - 0.02, -len * 0.6 + 0.001, r * 1.35, r * 0.8, 8, 0, -0.012 - r);
          k.zrod('glow', -len / 2 - 0.022, -len / 2 - 0.019, r * 1.2, r * 1.2, 8, 0, -0.012 - r);
        },
      }),
    );
  out.push(
    mk({
      id: 'under-flashlight-combo',
      classes: LONG,
      tags: ['tactical', 'modern'],
      desc: 'combined laser and light module',
      draw: (k) => {
        railClamp(k);
        k.box('main', [0.034, 0.024, 0.07], { p: [0, -0.022, 0] });
        k.zrod('glow', -0.037, -0.034, 0.01, 0.01, 8, -0.007, -0.022);
        k.zrod('#ff2a2a', -0.037, -0.034, 0.004, 0.004, 6, 0.01, -0.022);
      },
    }),
  );

  // bayonets
  const bay: [string, string, number, (k: Kit) => void][] = [
    ['knife-short', 'short knife bayonet', 0.12, (k) => {
      k.box('dark', [0.016, 0.02, 0.03], { p: [0, -0.01, 0.01] });
      k.blade('metal', [[0, 0], [-0.12, -0.006], [-0.1, 0.012], [0, 0.014]], 0.004, 'zy', { p: [0, -0.02, -0.005] });
    }],
    ['knife-long', 'long knife bayonet with fuller', 0.2, (k) => {
      k.box('dark', [0.016, 0.02, 0.04], { p: [0, -0.01, 0.01] });
      k.blade('metal', [[0, 0], [-0.2, -0.004], [-0.17, 0.014], [0, 0.016]], 0.004, 'zy', { p: [0, -0.022, -0.01] });
    }],
    ['knife-saw', 'saw-back combat bayonet', 0.16, (k) => {
      k.box('dark', [0.016, 0.02, 0.03], { p: [0, -0.01, 0.01] });
      const pts: Pt[] = [[0, 0], [-0.16, 0.0], [-0.13, 0.016]];
      for (let i = 0; i < 6; i++) pts.push([-0.12 + i * 0.02, 0.02], [-0.11 + i * 0.02, 0.016]);
      pts.push([0, 0.016]);
      k.blade('metal', pts, 0.004, 'zy', { p: [0, -0.024, -0.01] });
    }],
    ['spike', 'triangular spike bayonet', 0.18, (k) => {
      k.zrod('metal', 0.0, 0.03, 0.01, 0.01, 6, 0, -0.012);
      k.zrod('metal', -0.18, 0.0, 0, 0.008, 3, 0, -0.012);
    }],
    ['spike-folding', 'folding cruciform spike bayonet', 0.14, (k) => {
      k.box('dark', [0.014, 0.014, 0.02], { p: [0, -0.008, 0] });
      k.zrod('metal', -0.14, 0.0, 0, 0.006, 4, 0, -0.012);
    }],
    ['sword', 'long sword bayonet', 0.32, (k) => {
      k.box('dark', [0.016, 0.022, 0.03], { p: [0, -0.01, 0.01] });
      k.box('metal', [0.012, 0.03, 0.006], { p: [0, -0.018, -0.006] });
      k.blade('metal', [[0, 0], [-0.32, 0.004], [-0.29, 0.016], [0, 0.018]], 0.004, 'zy', { p: [0, -0.028, -0.01] });
    }],
    ['halberd', 'tiny axe-head halberd bayonet', 0.14, (k) => {
      k.zrod('metal', -0.1, 0.02, 0.007, 0.007, 6, 0, -0.015);
      k.blade('metal', [[0, 0], [-0.05, -0.01], [-0.06, -0.05], [-0.01, -0.04]], 0.005, 'zy', { p: [0, -0.015, -0.04] });
      k.zrod('metal', -0.14, -0.1, 0, 0.008, 4, 0, -0.015);
    }],
  ];
  for (const [n, d, , f] of bay)
    out.push(mk({ id: `under-bayonet-${n}`, classes: ['rifle', 'shotgun', 'smg', 'weird', 'blowgun'], tags: ['military', 'brutal'], desc: d, draw: f }));

  // pilot lights
  for (const [i, s] of [0.8, 1, 1.3].entries())
    out.push(
      mk({
        id: `under-pilot-light-${i + 1}`,
        classes: ['flamethrower'],
        tags: ['military', 'industrial'],
        desc: 'pilot light igniter with small flame',
        draw: (k) => {
          railClamp(k, 0.03);
          k.zrod('metal', -0.06 * s, 0.01, 0.007 * s, 0.007 * s, 6, 0, -0.016);
          k.zlathe('metal', [[0.007 * s, -0.06 * s], [0.012 * s, -0.075 * s]], 6, [0, -0.016, 0]);
          k.zlathe('glow', [[0.008 * s, -0.075 * s], [0.006 * s, -0.09 * s], [0.0, -0.1 * s]], 5, [0, -0.016, 0]);
          k.rod('rubber', [0, -0.016, 0.01], [0, -0.03, 0.05], 0.003, 0.003, 4);
        },
      }),
    );

  // underbarrel grenade launchers
  for (const [i, len] of [0.18, 0.24, 0.3].entries())
    out.push(
      mk({
        id: `under-grenade-launcher-${i + 1}`,
        classes: ['rifle', 'lmg', 'grenade_launcher'],
        tags: ['military', 'heavy'],
        desc: 'underslung 40mm grenade launcher',
        draw: (k) => {
          railClamp(k, len * 0.6);
          k.box('main', [0.03, 0.02, len * 0.7], { p: [0, -0.02, 0] });
          k.zrod('main', -len / 2, len * 0.3, 0.022, 0.022, 10, 0, -0.045);
          k.zrod('dark', -len / 2 - 0.002, -len / 2 + 0.002, 0.018, 0.018, 10, 0, -0.045);
          k.box('dark', [0.012, 0.04, 0.03], { p: [0, -0.075, len * 0.25] });
        },
      }),
    );
  for (const [i, len] of [0.18, 0.26].entries())
    out.push(
      mk({
        id: `under-shotgun-masterkey-${i + 1}`,
        classes: ['rifle', 'lmg', 'shotgun'],
        tags: ['military', 'tactical'],
        desc: 'underslung mini shotgun with tube',
        draw: (k) => {
          railClamp(k, len * 0.6);
          k.box('main', [0.026, 0.024, len * 0.5], { p: [0, -0.02, len * 0.15] });
          k.zrod('main', -len / 2, len * 0.3, 0.012, 0.012, 8, 0, -0.03);
          k.zrod('dark', -len / 2, len * 0.2, 0.011, 0.011, 8, 0, -0.052);
          k.zrod('accent', -len * 0.35, -len * 0.1, 0.016, 0.016, 8, 0, -0.045);
        },
      }),
    );

  // pump handles
  for (const [i, [len, style]] of [
    [0.1, 'ribbed'],
    [0.14, 'ribbed'],
    [0.12, 'wood'],
    [0.12, 'tactical'],
  ].entries())
    out.push(
      mk({
        id: `under-pump-${style}-${i + 1}`,
        classes: ['shotgun', 'grenade_launcher'],
        tags: style === 'wood' ? ['wood', 'classic'] : ['military', 'tactical'],
        desc: `${style} shotgun pump forend`,
        draw: (k) => {
          const L = len as number;
          if (style === 'wood') {
            k.zlathe('wood', [[0.02, -L / 2], [0.024, -L * 0.3], [0.024, L * 0.3], [0.02, L / 2]], 8, [0, -0.02, 0]);
          } else {
            k.zrod('main', -L / 2, L / 2, 0.022, 0.022, 8, 0, -0.02);
            const n = Math.round(L / 0.015);
            if (style === 'ribbed')
              for (let j = 0; j < n; j++) k.zrod('main', -L / 2 + j * 0.015, -L / 2 + j * 0.015 + 0.006, 0.025, 0.025, 8, 0, -0.02);
            else {
              k.box('dark', [0.02, 0.008, L * 0.8], { p: [0, -0.044, 0] });
              k.box('dark', [0.008, 0.02, 0.02], { p: [0, -0.05, -L * 0.35] });
            }
          }
        },
      }),
    );

  // toy / weird / scifi underbarrels
  out.push(
    mk({
      id: 'under-suction-cup',
      classes: ['weird', 'bubble_gun'],
      tags: ['toy', 'silly'],
      desc: 'dangling suction cup dart',
      draw: (k) => {
        k.rod('main', [0, 0, 0], [0, -0.04, -0.02], 0.004, 0.004, 5);
        k.lathe('#e63946', [[0.003, 0], [0.018, -0.008], [0.02, -0.012]], 8, { p: [0, -0.04, -0.02] });
      },
    }),
    mk({
      id: 'under-umbrella',
      classes: ['weird'],
      tags: ['silly', 'fancy'],
      desc: 'folded umbrella strapped underneath',
      draw: (k) => {
        k.box('dark', [0.016, 0.012, 0.03], { p: [0, -0.006, 0] });
        k.zrod('main', -0.2, 0.05, 0.004, 0.016, 8, 0, -0.024);
        k.zrod('wood', 0.05, 0.1, 0.005, 0.005, 5, 0, -0.024);
        k.tube('wood', [[0, -0.024, 0.1], [0, -0.024, 0.13], [0, -0.05, 0.14], [0, -0.06, 0.12]], 0.005, 8, 4);
      },
    }),
    mk({
      id: 'under-plasma-emitter',
      classes: ['weird', 'rifle', 'smg'],
      tags: ['scifi', 'energy'],
      desc: 'underslung plasma emitter with glowing core',
      draw: (k) => {
        railClamp(k);
        k.zrod('main', -0.07, 0.04, 0.02, 0.016, 8, 0, -0.03);
        k.ball('glow', 0.018, [0, -0.03, -0.075], 1);
        k.torus('main', 0.022, 0.004, { p: [0, -0.03, -0.075] }, 3, 10);
      },
    }),
    mk({
      id: 'under-plasma-coil',
      classes: ['weird', 'rifle', 'lmg'],
      tags: ['scifi', 'energy', 'heavy'],
      desc: 'underslung coil gun with glowing rings',
      draw: (k) => {
        railClamp(k);
        k.zrod('main', -0.12, 0.04, 0.008, 0.008, 6, 0, -0.03);
        for (let j = 0; j < 5; j++) k.torus('glow', 0.016, 0.004, { p: [0, -0.03, -0.1 + j * 0.03] }, 3, 10);
      },
    }),
    mk({
      id: 'under-shield-emitter',
      classes: ['weird', 'rifle'],
      tags: ['scifi', 'energy'],
      desc: 'shield emitter disc pointing forward',
      draw: (k) => {
        railClamp(k);
        k.rod('main', [0, -0.008, 0], [0, -0.03, 0], 0.01, 0.01, 6);
        k.zrod('main', -0.01, 0.01, 0.035, 0.03, 10, 0, -0.045);
        k.zrod('glow', -0.012, -0.01, 0.028, 0.028, 10, 0, -0.045);
      },
    }),
    mk({
      id: 'under-chainsaw',
      classes: ['weird', 'lmg', 'rifle'],
      tags: ['brutal', 'heavy', 'silly'],
      desc: 'underslung chainsaw blade',
      draw: (k) => {
        k.box('main', [0.03, 0.04, 0.08], { p: [0, -0.025, 0.02] });
        k.extrude('metal', [[0, -0.015], [-0.25, -0.012], [-0.27, 0], [-0.25, 0.012], [0, 0.015]], 0.006, 'zy', { p: [0, -0.03, -0.02] });
        for (let j = 0; j < 10; j++) {
          k.box('dark', [0.008, 0.008, 0.008], { p: [0, -0.012, -0.03 - j * 0.023], r: [Math.PI / 4, 0, 0] });
          k.box('dark', [0.008, 0.008, 0.008], { p: [0, -0.048, -0.03 - j * 0.023], r: [Math.PI / 4, 0, 0] });
        }
      },
    }),
    mk({
      id: 'under-harpoon',
      classes: ['weird', 'crossbow', 'rifle'],
      tags: ['nautical', 'silly'],
      desc: 'underslung harpoon with barbed tip',
      draw: (k) => {
        railClamp(k);
        k.zrod('metal', -0.2, 0.05, 0.005, 0.005, 6, 0, -0.02);
        k.zrod('metal', -0.25, -0.2, 0, 0.012, 4, 0, -0.02);
        k.rod('metal', [0, -0.02, -0.2], [0, -0.035, -0.18], 0.003, 0.002, 3);
        k.tube('#d9c27a', [[0, -0.02, 0.05], [0, -0.04, 0.08], [0, -0.03, 0.12]], 0.003, 6, 3);
      },
    }),
    mk({
      id: 'under-bottle-opener',
      classes: ['weird'],
      tags: ['silly', 'improvised'],
      desc: 'bottle opener bottom tool',
      draw: (k) => {
        railClamp(k);
        k.extrude('metal', [[0.02, 0], [-0.04, 0], [-0.05, -0.02], [-0.03, -0.035], [0.02, -0.02]], 0.006, 'zy', { p: [0, -0.01, 0] }, 0, [
          [[-0.02, -0.01], [-0.038, -0.012], [-0.03, -0.024]],
        ]);
      },
    }),
    mk({
      id: 'under-grapple-hook',
      classes: ['weird', 'crossbow', 'rifle'],
      tags: ['adventure', 'silly'],
      desc: 'grappling hook with rope coil',
      draw: (k) => {
        railClamp(k);
        k.zrod('metal', -0.08, 0.02, 0.005, 0.005, 6, 0, -0.02);
        for (let j = 0; j < 3; j++) {
          const a = (j / 3) * Math.PI * 2;
          k.tube('metal', [[0, -0.02, -0.08], [Math.cos(a) * 0.02, -0.02 + Math.sin(a) * 0.02, -0.075], [Math.cos(a) * 0.022, -0.02 + Math.sin(a) * 0.022, -0.06]], 0.003, 5, 3);
        }
        k.torus('#c8a96e', 0.02, 0.006, { p: [0, -0.03, 0.04], r: [0, Math.PI / 2, 0] }, 3, 10);
      },
    }),
  );

  // side-mounted
  for (const [i, len] of [0.04, 0.07].entries()) {
    out.push(
      mk({
        id: `side-laser-${i + 1}`,
        attach: 'side',
        classes: ['pistol', ...LONG],
        tags: ['tactical', 'modern'],
        desc: 'side-mounted laser pointer',
        draw: (k) => {
          k.box('dark', [0.008, 0.024, len * 0.8], { p: [0.004, 0, 0] });
          k.zrod('main', -len / 2, len / 2, 0.01, 0.01, 8, 0.018, 0);
          k.zrod('#ff2a2a', -len / 2 - 0.002, -len / 2, 0.004, 0.004, 6, 0.018, 0);
        },
      }),
      mk({
        id: `side-flashlight-${i + 1}`,
        attach: 'side',
        classes: ['pistol', ...LONG, 'flamethrower'],
        tags: ['tactical', 'military'],
        desc: 'side-mounted offset flashlight',
        draw: (k) => {
          k.box('dark', [0.01, 0.024, 0.03], { p: [0.005, 0, 0] });
          k.zrod('main', -len, len * 0.6, 0.012, 0.012, 8, 0.024, 0);
          k.zrod('main', -len - 0.015, -len, 0.016, 0.012, 8, 0.024, 0);
          k.zrod('glow', -len - 0.017, -len - 0.014, 0.014, 0.014, 8, 0.024, 0);
        },
      }),
    );
  }
  void S;
  return out;
}
