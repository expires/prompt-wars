/** MUZZLE devices: attach to 'muzzle', extend from origin toward -Z. */
import type { PartDef } from '../types';
import { part, S } from '../lib/define';
import { type Kit, heartPts, starPts } from '../lib/kit';

interface M {
  id: string;
  classes: string[];
  tags: string[];
  desc: string;
  len: number;
  draw: (k: Kit) => void;
}

const GUNS = ['pistol', 'smg', 'rifle', 'sniper', 'lmg'];

function mk(m: M): PartDef {
  return part({
    id: m.id,
    category: 'muzzle',
    classes: m.classes,
    tags: m.tags,
    desc: m.desc,
    attach: 'muzzle',
    sockets: { deco: S([0, 0.02, -m.len * 0.5]) },
    draw: m.draw,
  });
}

export function muzzleParts(): PartDef[] {
  const out: PartDef[] = [];

  // --- muzzle brakes: slots x size
  for (const slots of [2, 3, 4]) {
    for (const [sz, r] of [
      ['small', 0.014],
      ['large', 0.02],
    ] as const) {
      const len = 0.025 + slots * 0.014;
      out.push(
        mk({
          id: `muzzle-brake-${slots}slot-${sz}`,
          classes: sz === 'large' ? ['rifle', 'sniper', 'lmg'] : ['pistol', 'smg', 'rifle'],
          tags: ['military', 'precision'],
          desc: `${sz} ${slots}-port boxy muzzle brake`,
          len,
          draw: (k) => {
            k.box('main', [r * 2.2, r * 1.7, len], { p: [0, 0, -len / 2] });
            for (let i = 0; i < slots; i++) {
              const z = -0.012 - i * 0.014 - 0.004;
              k.box('dark', [r * 2.3, r * 1.0, 0.007], { p: [0, 0, z] });
            }
            k.zrod('dark', -len - 0.001, -len + 0.002, r * 0.5, r * 0.5, 8);
          },
        }),
      );
    }
  }
  for (const [i, r] of [0.013, 0.017, 0.022].entries()) {
    const len = 0.05 + i * 0.012;
    out.push(
      mk({
        id: `muzzle-brake-round-${i + 1}`,
        classes: ['rifle', 'sniper', 'lmg'],
        tags: ['military', 'heavy'],
        desc: 'round brake with side vent holes',
        len,
        draw: (k) => {
          k.zrod('main', -len, 0, r, r, 10);
          for (let j = 0; j < 3; j++) {
            const z = -0.012 - j * (len / 3.5);
            k.rod('dark', [-r * 1.02, 0, z], [r * 1.02, 0, z], r * 0.32, r * 0.32, 6);
          }
        },
      }),
    );
  }

  // --- suppressors: len x radius
  const SUP_L = [0.1, 0.16, 0.24];
  const SUP_R = [0.016, 0.021, 0.027];
  SUP_L.forEach((len, li) =>
    SUP_R.forEach((r, ri) =>
      out.push(
        mk({
          id: `muzzle-suppressor-${['short', 'mid', 'long'][li]}-${['slim', 'std', 'fat'][ri]}`,
          classes: ri === 2 ? ['rifle', 'sniper', 'smg'] : ['pistol', 'smg', 'rifle', 'sniper'],
          tags: ['military', 'stealth', 'sleek'],
          desc: `${['short', 'mid-length', 'long'][li]} ${['slim', 'standard', 'fat'][ri]} cylinder suppressor`,
          len,
          draw: (k) => {
            k.zrod('main', -len + 0.006, -0.006, r, r, 10);
            k.zrod('dark', -len, -len + 0.006, r * 0.95, r * 0.9, 10);
            k.zrod('dark', -0.006, 0, r * 0.85, r * 0.95, 10);
            k.zrod('dark', -len - 0.001, -len + 0.002, r * 0.3, r * 0.3, 8);
          },
        }),
      ),
    ),
  );
  for (const [i, len] of [0.1, 0.15, 0.2].entries()) {
    out.push(
      mk({
        id: `muzzle-suppressor-oilfilter-${i + 1}`,
        classes: ['smg', 'rifle', 'weird'],
        tags: ['improvised', 'military'],
        desc: 'improvised ribbed oil-filter suppressor',
        len,
        draw: (k) => {
          const r = 0.028;
          k.zrod('main', -len, 0, r, r, 10);
          const n = Math.round(len / 0.012);
          for (let j = 0; j < n; j++) k.rod('accent', [0, 0, -0.01 - j * 0.012], [0, 0, -0.004 - j * 0.012], r * 1.08, r * 1.08, 10, true);
          k.zrod('dark', -len - 0.003, -len, r * 0.7, r * 0.7, 10);
          k.zrod('metal', 0, 0.01, 0.01, 0.01, 6);
        },
      }),
    );
  }
  for (const [i, len] of [0.12, 0.18].entries()) {
    out.push(
      mk({
        id: `muzzle-suppressor-square-${i + 1}`,
        classes: ['smg', 'rifle', 'sniper'],
        tags: ['military', 'modern', 'boxy'],
        desc: 'square-section modern suppressor',
        len,
        draw: (k) => {
          k.box('main', [0.036, 0.036, len], { p: [0, 0, -len / 2] });
          for (let j = 0; j < 3; j++) k.box('dark', [0.038, 0.038, 0.006], { p: [0, 0, -len * (0.25 + j * 0.25)] });
        },
      }),
    );
    out.push(
      mk({
        id: `muzzle-suppressor-taper-${i + 1}`,
        classes: ['pistol', 'smg', 'rifle'],
        tags: ['sleek', 'scifi'],
        desc: 'tapered conical suppressor',
        len,
        draw: (k) => {
          k.zrod('main', -len, 0, 0.014, 0.024, 8);
          k.zrod('accent', -len * 0.6, -len * 0.55, 0.0195, 0.0205, 8);
        },
      }),
    );
  }

  // --- flash hiders (birdcage prongs)
  for (const prongs of [3, 4, 5]) {
    for (const [sz, len] of [
      ['short', 0.035],
      ['long', 0.06],
    ] as const) {
      out.push(
        mk({
          id: `muzzle-flashhider-${prongs}prong-${sz}`,
          classes: GUNS,
          tags: ['military'],
          desc: `${sz} ${prongs}-prong birdcage flash hider`,
          len,
          draw: (k) => {
            const r = 0.012;
            k.zrod('main', -0.012, 0, r * 1.1, r * 1.1, 8);
            for (let j = 0; j < prongs; j++) {
              const a = (j / prongs) * Math.PI * 2;
              k.rod('main', [Math.cos(a) * r, Math.sin(a) * r, -0.01], [Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, -len], r * 0.32, r * 0.25, 4);
            }
          },
        }),
      );
    }
  }

  // --- compensators
  for (const [i, ports] of [2, 3, 5].entries()) {
    const len = 0.03 + ports * 0.008;
    out.push(
      mk({
        id: `muzzle-compensator-${ports}port`,
        classes: ['pistol', 'smg', 'rifle'],
        tags: ['sport', 'precision'],
        desc: `compensator with ${ports} top ports`,
        len,
        draw: (k) => {
          k.box('main', [0.026, 0.028 + i * 0.002, len], { p: [0, 0, -len / 2] });
          for (let j = 0; j < ports; j++) k.box('dark', [0.016, 0.006, 0.005], { p: [0, 0.0145 + i * 0.001, -0.01 - j * 0.008] });
        },
      }),
    );
  }

  // --- chokes / crowns
  for (const [i, r] of [0.016, 0.02, 0.025].entries()) {
    out.push(
      mk({
        id: `muzzle-choke-${i + 1}`,
        classes: ['shotgun'],
        tags: ['sport'],
        desc: 'extended shotgun choke tube with knurl rings',
        len: 0.04,
        draw: (k) => {
          k.zrod('main', -0.04, 0, r, r * 1.05, 10);
          k.zrod('accent', -0.03, -0.02, r * 1.1, r * 1.1, 10);
          k.zrod('dark', -0.041, -0.038, r * 0.75, r * 0.75, 10);
        },
      }),
    );
  }
  out.push(
    mk({
      id: 'muzzle-duckbill',
      classes: ['shotgun', 'weird'],
      tags: ['military', 'retro'],
      desc: 'flattened duckbill shot spreader',
      len: 0.07,
      draw: (k) => {
        k.zrod('main', -0.02, 0, 0.016, 0.016, 8);
        k.extrude('main', [[0, -0.016], [-0.07, -0.006], [-0.07, 0.006], [0, 0.016]], 0.04, 'zy', { p: [0, 0, 0], r: [0, 0, Math.PI / 2] });
      },
    }),
    mk({
      id: 'muzzle-spreader-wide',
      classes: ['shotgun', 'weird'],
      tags: ['silly', 'retro'],
      desc: 'wide fan-shaped shot spreader',
      len: 0.08,
      draw: (k) => {
        k.extrude('main', [[0, -0.015], [-0.08, -0.05], [-0.08, 0.05], [0, 0.015]], 0.018, 'xz', { r: [0, -Math.PI / 2, 0] });
        k.box('dark', [0.095, 0.014, 0.004], { p: [0, 0, -0.08] });
      },
    }),
    mk({
      id: 'muzzle-thread-cap',
      classes: GUNS,
      tags: ['standard', 'compact'],
      desc: 'small knurled thread protector cap',
      len: 0.015,
      draw: (k) => {
        k.zrod('main', -0.015, 0, 0.011, 0.011, 8);
        k.zrod('dark', -0.016, -0.013, 0.006, 0.006, 8);
      },
    }),
  );

  // --- flame nozzles
  for (const [i, [len, r]] of [
    [0.06, 0.02],
    [0.1, 0.026],
    [0.14, 0.032],
  ].entries()) {
    out.push(
      mk({
        id: `muzzle-flame-cone-${i + 1}`,
        classes: ['flamethrower'],
        tags: ['military', 'heavy'],
        desc: 'conical flame nozzle with igniter ring',
        len,
        draw: (k) => {
          k.zrod('main', -len, 0, r * 0.45, r, 8);
          k.zrod('dark', -len - 0.002, -len + 0.004, r * 0.55, r * 0.55, 8);
          k.zrod('accent', -len * 0.5 - 0.006, -len * 0.5 + 0.006, r * 0.8, r * 0.8, 8);
          k.ball('glow', r * 0.3, [0, -r * 0.6, -len], 0);
        },
      }),
    );
  }
  for (const [i, R] of [0.03, 0.045].entries()) {
    out.push(
      mk({
        id: `muzzle-flame-ring-${i + 1}`,
        classes: ['flamethrower', 'weird'],
        tags: ['scifi', 'heavy'],
        desc: 'ring burner nozzle with multiple jets',
        len: 0.05,
        draw: (k) => {
          k.zrod('main', -0.03, 0, 0.012, 0.012, 6);
          k.torus('main', R, 0.008, { p: [0, 0, -0.04] }, 4, 12);
          for (let j = 0; j < 6; j++) {
            const a = (j / 6) * Math.PI * 2;
            k.ball('glow', 0.006, [Math.cos(a) * R, Math.sin(a) * R, -0.048], 0);
          }
          for (let j = 0; j < 3; j++) {
            const a = (j / 3) * Math.PI * 2 + 0.5;
            k.rod('main', [0, 0, -0.03], [Math.cos(a) * R, Math.sin(a) * R, -0.04], 0.004, 0.004, 4);
          }
        },
      }),
    );
  }
  for (const [i, w] of [0.06, 0.09].entries()) {
    out.push(
      mk({
        id: `muzzle-flame-fan-${i + 1}`,
        classes: ['flamethrower'],
        tags: ['military'],
        desc: 'flat fan-spray flame nozzle',
        len: 0.08,
        draw: (k) => {
          k.zrod('main', -0.03, 0, 0.014, 0.014, 6);
          k.extrude('main', [[0, -0.01], [-0.05, -w / 2], [-0.05, w / 2], [0, 0.01]], 0.012, 'xz', { p: [0, 0, -0.03], r: [0, -Math.PI / 2, 0] });
          k.box('glow', [w * 0.9, 0.006, 0.004], { p: [0, 0, -0.081] });
        },
      }),
    );
  }
  for (const [i, n] of [3, 5].entries()) {
    out.push(
      mk({
        id: `muzzle-flame-multijet-${n}`,
        classes: ['flamethrower', 'weird'],
        tags: ['heavy', 'scifi'],
        desc: `${n} splayed flame jet pipes`,
        len: 0.09,
        draw: (k) => {
          k.zrod('main', -0.03, 0, 0.022, 0.016, 8);
          for (let j = 0; j < n; j++) {
            const a = (j / n) * Math.PI * 2;
            const ex = Math.cos(a) * (0.025 + i * 0.006);
            const ey = Math.sin(a) * (0.025 + i * 0.006);
            k.rod('metal', [ex * 0.3, ey * 0.3, -0.03], [ex, ey, -0.09], 0.006, 0.007, 5);
            k.ball('glow', 0.005, [ex, ey, -0.093], 0);
          }
        },
      }),
    );
  }
  out.push(
    mk({
      id: 'muzzle-flame-dragonhead',
      classes: ['flamethrower', 'weird'],
      tags: ['fantasy', 'silly', 'organic'],
      desc: 'open-jawed dragon head flame nozzle',
      len: 0.11,
      draw: (k) => {
        k.ball('main', 1, [0, 0.01, -0.04], 1, [0.035, 0.03, 0.05]);
        k.extrude('main', [[0, 0], [-0.07, 0.004], [-0.07, 0.02], [0, 0.03]], 0.05, 'zy', { p: [0, 0.008, -0.04] });
        k.extrude('main', [[0, 0], [-0.06, -0.006], [-0.06, -0.018], [0, -0.022]], 0.044, 'zy', { p: [0, -0.008, -0.04] });
        for (const x of [-0.016, 0.016]) {
          k.rod('accent', [x, 0.03, -0.03], [x * 1.4, 0.06, 0.0], 0.008, 0, 4);
          k.ball('glow', 0.006, [x, 0.03, -0.07], 0);
        }
        k.ball('glow', 0.012, [0, 0.006, -0.105], 0);
      },
    }),
    mk({
      id: 'muzzle-flame-pilot',
      classes: ['flamethrower'],
      tags: ['military', 'retro'],
      desc: 'straight nozzle with pilot flame cup underneath',
      len: 0.09,
      draw: (k) => {
        k.zrod('main', -0.09, 0, 0.012, 0.015, 8);
        k.zrod('metal', -0.08, -0.04, 0.01, 0.01, 6, 0, -0.022);
        k.zlathe('metal', [[0.01, -0.08], [0.015, -0.095]], 6, [0, -0.022, 0]);
        k.ball('glow', 0.009, [0, -0.022, -0.095], 0);
      },
    }),
    mk({
      id: 'muzzle-flame-torch',
      classes: ['flamethrower', 'weird'],
      tags: ['medieval', 'silly'],
      desc: 'medieval torch head with rag wrap',
      len: 0.08,
      draw: (k) => {
        k.zrod('wood', -0.05, 0, 0.012, 0.012, 6);
        k.zrod('#c9b38a', -0.08, -0.04, 0.02, 0.016, 7);
        k.zlathe('glow', [[0.018, -0.08], [0.022, -0.1], [0.008, -0.13], [0.0, -0.135]], 6);
      },
    }),
  );

  // --- bubble wands
  for (const [i, R] of [0.03, 0.045, 0.06].entries()) {
    out.push(
      mk({
        id: `muzzle-bubble-ring-${['small', 'mid', 'big'][i]}`,
        classes: ['bubble_gun', 'weird'],
        tags: ['toy', 'silly'],
        desc: `${['small', 'medium', 'big'][i]} bubble wand ring on stem`,
        len: 0.04 + R,
        draw: (k) => {
          k.zrod('main', -0.04, 0, 0.008, 0.01, 6);
          k.torus('accent', R, 0.006, { p: [0, 0, -0.04 - R * 0.2] }, 4, 14);
          k.rod('accent', [0, 0, -0.04], [0, -R, -0.04 - R * 0.2], 0.005, 0.005, 4);
        },
      }),
    );
  }
  for (const n of [3, 5, 7]) {
    out.push(
      mk({
        id: `muzzle-bubble-multiring-${n}`,
        classes: ['bubble_gun', 'weird'],
        tags: ['toy', 'silly'],
        desc: `${n} small bubble rings in a flower cluster`,
        len: 0.06,
        draw: (k) => {
          k.zrod('main', -0.03, 0, 0.02, 0.014, 8);
          k.zrod('main', -0.045, -0.03, 0.04, 0.02, 10);
          const rr = n === 3 ? 0.018 : n === 5 ? 0.014 : 0.011;
          const R = n === 7 ? 0.026 : 0.024;
          for (let j = 0; j < n; j++) {
            const center = n === 7 && j === 6;
            const a = (j / (n === 7 ? 6 : n)) * Math.PI * 2;
            const x = center ? 0 : Math.cos(a) * R;
            const y = center ? 0 : Math.sin(a) * R;
            k.torus('accent', rr, 0.0035, { p: [x, y, -0.05] }, 3, 10);
          }
        },
      }),
    );
  }
  out.push(
    mk({
      id: 'muzzle-bubble-star',
      classes: ['bubble_gun', 'weird'],
      tags: ['toy', 'silly'],
      desc: 'star-shaped bubble wand',
      len: 0.06,
      draw: (k) => {
        k.zrod('main', -0.03, 0, 0.008, 0.01, 6);
        const outer = starPts(0.045, 0.022, 5);
        const inner = starPts(0.037, 0.016, 5).reverse() as typeof outer;
        k.extrude('accent', outer, 0.008, 'xy', { p: [0, 0, -0.04] }, 0, [inner]);
      },
    }),
    mk({
      id: 'muzzle-bubble-heart',
      classes: ['bubble_gun', 'weird'],
      tags: ['toy', 'silly', 'cute'],
      desc: 'heart-shaped bubble wand',
      len: 0.06,
      draw: (k) => {
        k.zrod('main', -0.03, 0, 0.008, 0.01, 6);
        const outer = heartPts(0.045);
        const inner = heartPts(0.036).reverse() as typeof outer;
        k.extrude('accent', outer, 0.008, 'xy', { p: [0, 0, -0.04] }, 0, [inner]);
      },
    }),
    mk({
      id: 'muzzle-bubble-spiral',
      classes: ['bubble_gun', 'weird'],
      tags: ['toy', 'silly'],
      desc: 'spiral wire bubble whisk',
      len: 0.1,
      draw: (k) => {
        k.zrod('main', -0.02, 0, 0.008, 0.01, 6);
        const pts: [number, number, number][] = [];
        for (let j = 0; j <= 20; j++) {
          const t = j / 20;
          const a = t * Math.PI * 6;
          const r = 0.01 + t * 0.03;
          pts.push([Math.cos(a) * r, Math.sin(a) * r, -0.02 - t * 0.08]);
        }
        k.tube('accent', pts, 0.003, 40, 3);
      },
    }),
    mk({
      id: 'muzzle-bubble-hoop-giant',
      classes: ['bubble_gun', 'weird'],
      tags: ['toy', 'silly', 'heavy'],
      desc: 'giant hula-hoop bubble wand on long stem',
      len: 0.2,
      draw: (k) => {
        k.zrod('main', -0.1, 0, 0.008, 0.008, 6);
        k.torus('accent', 0.1, 0.008, { p: [0, 0, -0.1] }, 4, 16);
        k.rod('accent', [0, 0, -0.1], [0, -0.1, -0.1], 0.005, 0.005, 4);
      },
    }),
  );

  // --- funnels / bells
  out.push(
    ...[0.04, 0.06, 0.085].map((R, i) =>
      mk({
        id: `muzzle-funnel-${['small', 'mid', 'big'][i]}`,
        classes: ['weird', 'bubble_gun', 'shotgun', 'flamethrower'],
        tags: ['silly', 'improvised'],
        desc: `${['small', 'medium', 'big'][i]} kitchen funnel muzzle`,
        len: 0.03 + R,
        draw: (k) => {
          const L = 0.03 + R;
          k.zrod('main', -0.03, 0, 0.012, 0.012, 8);
          k.zrod('main', -L, -0.03, R, 0.012, 10, 0, 0);
          k.zrod('dark', -L - 0.001, -L + 0.002, R * 0.9, R * 0.9, 10);
          k.torus('accent', R * 0.6, 0.004, { p: [0, R * 0.5, -0.03 - R * 0.4], r: [Math.PI / 2, 0, 0] }, 3, 8);
        },
      }),
    ),
  );
  for (const [i, R] of [0.035, 0.055, 0.08].entries()) {
    out.push(
      mk({
        id: `muzzle-trumpet-bell-${['small', 'mid', 'big'][i]}`,
        classes: ['weird', 'shotgun', 'bubble_gun'],
        tags: ['silly', 'brass', 'musical'],
        desc: `${['small', 'medium', 'big'][i]} brass trumpet bell`,
        len: 0.05 + R * 1.2,
        draw: (k) => {
          const L = 0.05 + R * 1.2;
          k.zlathe(
            'brass',
            [
              [0.011, 0],
              [0.012, -L * 0.5],
              [R * 0.35, -L * 0.8],
              [R * 0.8, -L * 0.95],
              [R, -L],
              [R * 0.85, -L + 0.004],
              [0.008, -L * 0.6],
            ],
            12,
          );
        },
      }),
    );
  }
  out.push(
    mk({
      id: 'muzzle-tuba-bell',
      classes: ['weird'],
      tags: ['silly', 'brass', 'musical', 'heavy'],
      desc: 'huge upturned tuba bell',
      len: 0.12,
      draw: (k) => {
        k.tube('brass', [[0, 0, 0], [0, 0, -0.05], [0, 0.03, -0.09], [0, 0.07, -0.1]], 0.014, 10, 6);
        k.lathe('brass', [[0.014, 0], [0.03, 0.04], [0.07, 0.07], [0.09, 0.075], [0.07, 0.072], [0.01, 0.02]], 12, { p: [0, 0.07, -0.1] });
      },
    }),
  );

  // --- blowgun front rings & dart tips
  for (const [i, style] of ['ring', 'carved', 'feather'].entries()) {
    out.push(
      mk({
        id: `muzzle-blowgun-${style}`,
        classes: ['blowgun'],
        tags: ['tribal', 'organic'],
        desc: ['bone front ring for blowgun', 'carved wooden blowgun tip', 'feathered blowgun front tassel'][i],
        len: 0.05,
        draw: (k) => {
          if (style === 'ring') {
            k.zrod('white', -0.03, 0, 0.022, 0.02, 8);
            k.zrod('dark', -0.031, -0.028, 0.012, 0.012, 8);
          } else if (style === 'carved') {
            k.zlathe('wood', [[0.02, 0], [0.026, -0.015], [0.018, -0.03], [0.024, -0.045], [0.014, -0.05]], 8);
            k.zrod('dark', -0.051, -0.048, 0.01, 0.01, 8);
          } else {
            k.zrod('accent', -0.02, 0, 0.02, 0.02, 8);
            for (let j = 0; j < 5; j++) {
              const a = (j / 5) * Math.PI * 2;
              k.blade('#e8483a', [[0, 0], [0.06, 0.008], [0.065, -0.003], [0.01, -0.01]], 0.003, 'zy', {
                p: [Math.cos(a) * 0.02, Math.sin(a) * 0.02, -0.01],
                r: [0, 0, a + Math.PI / 2],
              });
            }
          }
        },
      }),
    );
  }

  // --- energy emitters
  for (const [i, n] of [2, 3, 4, 6].entries()) {
    out.push(
      mk({
        id: `muzzle-emitter-${n}prong`,
        classes: ['rifle', 'pistol', 'weird', 'smg'],
        tags: ['scifi', 'energy'],
        desc: `${n}-prong glowing energy emitter`,
        len: 0.06 + i * 0.01,
        draw: (k) => {
          const L = 0.06 + i * 0.01;
          k.zrod('main', -0.02, 0, 0.018, 0.016, 8);
          for (let j = 0; j < n; j++) {
            const a = (j / n) * Math.PI * 2 + Math.PI / 2;
            const x = Math.cos(a) * 0.02;
            const y = Math.sin(a) * 0.02;
            k.rod('main', [x * 0.6, y * 0.6, -0.015], [x, y, -L], 0.005, 0.003, 4);
          }
          k.ball('glow', 0.012, [0, 0, -L * 0.75], 1);
        },
      }),
    );
  }

  // --- silly muzzles
  out.push(
    mk({
      id: 'muzzle-cork-on-string',
      classes: ['weird', 'pistol', 'rifle'],
      tags: ['silly', 'toy'],
      desc: 'popgun cork dangling on a string',
      len: 0.04,
      draw: (k) => {
        k.zrod('wood', -0.03, -0.005, 0.012, 0.015, 8);
        k.tube('white', [[0, 0.012, -0.01], [0, 0.0, 0.02], [0, -0.02, 0.04], [0, -0.04, 0.05]], 0.0015, 10, 3);
      },
    }),
    mk({
      id: 'muzzle-boxing-glove',
      classes: ['weird'],
      tags: ['silly', 'toy'],
      desc: 'spring-loaded boxing glove punch',
      len: 0.14,
      draw: (k) => {
        k.zrod('metal', -0.06, 0, 0.006, 0.006, 6);
        for (let j = 0; j < 4; j++) k.torus('metal', 0.012, 0.002, { p: [0, 0, -0.01 - j * 0.013] }, 3, 8);
        k.ball('#d62828', 1, [0, 0, -0.1], 1, [0.04, 0.035, 0.045]);
        k.ball('#d62828', 0.018, [0.035, -0.005, -0.09], 1);
        k.zrod('white', -0.065, -0.055, 0.03, 0.03, 8);
      },
    }),
    mk({
      id: 'muzzle-flower',
      classes: ['weird', 'bubble_gun'],
      tags: ['silly', 'cute'],
      desc: 'daisy flower sticking out of the barrel',
      len: 0.05,
      draw: (k) => {
        k.zrod('#3a9a3a', -0.03, 0, 0.004, 0.004, 4);
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * Math.PI * 2;
          k.ball('white', 1, [Math.cos(a) * 0.02, Math.sin(a) * 0.02, -0.035], 0, [0.012, 0.012, 0.004]);
        }
        k.ball('#ffd23f', 0.011, [0, 0, -0.037], 0);
      },
    }),
    mk({
      id: 'muzzle-plunger-cup',
      classes: ['weird'],
      tags: ['silly', 'improvised'],
      desc: 'rubber plunger cup on the muzzle',
      len: 0.07,
      draw: (k) => {
        k.zrod('wood', -0.03, 0, 0.008, 0.008, 6);
        k.zlathe('#b0201f', [[0.008, -0.03], [0.03, -0.045], [0.045, -0.07], [0.04, -0.072]], 10);
      },
    }),
  );
  return out;
}
