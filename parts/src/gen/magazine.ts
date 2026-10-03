/** MAGAZINE / AMMO parts. Most attach to 'mag' and hang toward -Y. */
import type { PartDef } from '../types';
import { part } from '../lib/define';
import type { Kit, Pt } from '../lib/kit';

interface Mg {
  id: string;
  classes: string[];
  tags: string[];
  desc: string;
  attach?: string;
  draw: (k: Kit) => void;
}

function mk(m: Mg): PartDef {
  return part({
    id: m.id,
    category: 'magazine',
    classes: m.classes,
    tags: m.tags,
    desc: m.desc,
    attach: m.attach ?? 'mag',
    sockets: {},
    draw: m.draw,
  });
}

/** Curved (banana) magazine outline in zy plane. */
function banana(len: number, w: number, curve: number): Pt[] {
  const n = 5;
  const front: Pt[] = [];
  const back: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -t * len;
    const off = -curve * t * t;
    front.push([-w / 2 + off, y]);
    back.push([w / 2 + off, y]);
  }
  return [...back, ...front.reverse()];
}

export function magazineParts(): PartDef[] {
  const out: PartDef[] = [];

  // straight box mags
  for (const [li, len] of [0.06, 0.1, 0.15, 0.22].entries())
    for (const [wi, w] of [0.026, 0.036].entries())
      out.push(
        mk({
          id: `mag-box-${['stubby', 'std', 'extended', 'huge'][li]}-${wi ? 'wide' : 'narrow'}`,
          classes: li === 0 ? ['pistol', 'smg'] : wi ? ['rifle', 'sniper', 'shotgun', 'lmg'] : ['smg', 'rifle', 'pistol'],
          tags: ['military', 'standard'],
          desc: `${['stubby', 'standard', 'extended', 'huge'][li]} ${wi ? 'wide' : 'narrow'} straight box magazine`,
          draw: (k) => {
            k.box('main', [w * 0.75, len, w], { p: [0, -len / 2, 0] });
            k.box('dark', [w * 0.85, 0.01, w * 1.15], { p: [0, -len - 0.004, 0.002] });
            for (let i = 0; i < Math.floor(len / 0.04); i++)
              k.box('dark', [w * 0.78, 0.004, w * 0.6], { p: [0, -0.02 - i * 0.04, 0] });
          },
        }),
      );

  // curved banana mags
  for (const [ci, curve] of [0.02, 0.04, 0.06].entries())
    for (const [li, len] of [0.12, 0.18].entries())
      out.push(
        mk({
          id: `mag-curved-${['slight', 'banana', 'hook'][ci]}-${li ? 'long' : 'std'}`,
          classes: ['rifle', 'smg', 'lmg'],
          tags: ['military', 'classic'],
          desc: `${li ? 'long' : 'standard'} ${['slightly curved', 'banana', 'hooked'][ci]} magazine`,
          draw: (k) => {
            k.extrude('main', banana(len, 0.036, curve), 0.024, 'zy', undefined, 0.002);
            for (let i = 1; i < 4; i++) {
              const t = i / 4;
              k.box('dark', [0.028, 0.004, 0.03], { p: [0, -t * len, -curve * t * t] });
            }
          },
        }),
      );

  // pistol mags w/ baseplates
  for (const [i, len] of [0.03, 0.05, 0.09].entries())
    out.push(
      mk({
        id: `mag-pistol-${['flush', 'plus', 'stick'][i]}`,
        classes: ['pistol', 'smg'],
        tags: ['standard', 'compact'],
        desc: `pistol magazine ${['flush baseplate', 'plus-two extension', 'long stick extension'][i]}`,
        draw: (k) => {
          k.box('main', [0.02, len, 0.026], { p: [0, -len / 2, 0.012] });
          k.box('accent', [0.026, 0.012, 0.036], { p: [0, -len - 0.006, 0.012] });
        },
      }),
    );

  // drums
  for (const [ri, R] of [0.045, 0.06, 0.075].entries())
    for (const [ti, T] of [0.03, 0.05].entries())
      out.push(
        mk({
          id: `mag-drum-${['small', 'mid', 'big'][ri]}-${ti ? 'thick' : 'thin'}`,
          classes: ri === 2 ? ['lmg', 'shotgun', 'weird'] : ['smg', 'rifle', 'shotgun', 'lmg'],
          tags: ['military', 'heavy', 'retro'],
          desc: `${['small', 'medium', 'big'][ri]} ${ti ? 'thick' : 'thin'} drum magazine`,
          draw: (k) => {
            k.box('main', [0.022, 0.04, 0.03], { p: [0, -0.02, 0] });
            k.rod('main', [-T / 2, -0.03 - R, 0], [T / 2, -0.03 - R, 0], R, R, 12);
            k.rod('dark', [T / 2, -0.03 - R, 0], [T / 2 + 0.006, -0.03 - R, 0], R * 0.35, R * 0.35, 8);
            k.rod('accent', [-T / 2 - 0.003, -0.03 - R, 0], [T / 2 + 0.003, -0.03 - R, 0], R * 1.02, R * 1.02, 12, true);
          },
        }),
      );

  // double drum
  for (const [i, R] of [0.04, 0.05, 0.06].entries())
    out.push(
      mk({
        id: `mag-cmag-${i + 1}`,
        classes: ['rifle', 'lmg', 'smg'],
        tags: ['military', 'heavy'],
        desc: 'twin-drum high-capacity magazine',
        draw: (k) => {
          k.box('main', [0.024, 0.05, 0.03], { p: [0, -0.025, 0] });
          for (const x of [-1, 1]) k.rod('main', [x * 0.012, -0.05 - R * 0.7, 0], [x * (0.012 + 0.035), -0.05 - R * 0.7, 0], R, R, 10);
          for (const x of [-1, 1]) k.rod('dark', [x * 0.047, -0.05 - R * 0.7, 0], [x * 0.052, -0.05 - R * 0.7, 0], R * 0.4, R * 0.4, 8);
        },
      }),
    );

  // pan mags on top
  for (const [i, R] of [0.06, 0.08, 0.1].entries())
    out.push(
      mk({
        id: `mag-pan-top-${i + 1}`,
        attach: 'top',
        classes: ['lmg', 'smg', 'weird'],
        tags: ['retro', 'military', 'heavy'],
        desc: 'flat pan magazine mounted on top',
        draw: (k) => {
          k.box('dark', [0.02, 0.02, 0.03], { p: [0, 0.01, 0] });
          k.lathe('main', [[0, 0], [R, 0.004], [R, 0.022], [R * 0.3, 0.035], [0, 0.036]], 12, { p: [0, 0.018, 0] });
          k.lathe('dark', [[R * 0.2, 0.034], [R * 0.22, 0.042], [0, 0.043]], 8, { p: [0, 0.018, 0] });
        },
      }),
    );

  // belt boxes
  for (const [i, [w, h]] of [
    [0.06, 0.08],
    [0.08, 0.1],
    [0.1, 0.12],
    [0.07, 0.14],
  ].entries())
    out.push(
      mk({
        id: `mag-beltbox-${i + 1}`,
        classes: ['lmg', 'weird'],
        tags: ['military', 'heavy'],
        desc: 'ammo box with dangling bullet belt',
        draw: (k) => {
          k.box('main', [w, h, 0.08], { p: [0.01, -h / 2 - 0.02, 0] });
          k.box('dark', [w + 0.004, 0.012, 0.082], { p: [0.01, -0.024, 0] });
          k.rod('dark', [0.01 - w * 0.3, -0.016, 0], [0.01 + w * 0.3, -0.016, 0], 0.004, 0.004, 4);
          for (let j = 0; j < 4; j++) {
            const y = -0.01 - j * 0.004;
            k.rod('brass', [-0.012, y, -0.008 + j * 0.0], [-0.03 - j * 0.012, y - 0.01 * j, -0.008], 0.004, 0.004, 5);
          }
        },
      }),
    );

  // ammo belts
  for (const [i, n] of [6, 10].entries())
    out.push(
      mk({
        id: `mag-belt-loop-${n}`,
        attach: 'side',
        classes: ['lmg', 'weird'],
        tags: ['military', 'heavy', 'rambo'],
        desc: `hanging loop of ${n} belted rounds`,
        draw: (k) => {
          const belt: [number, number, number][] = [];
          for (let j = 0; j < n; j++) {
            const t = j / (n - 1);
            belt.push([0.012, -Math.sin(t * Math.PI) * 0.08 * (1 + i * 0.4), -0.06 + t * 0.12 * (1 + i * 0.3)]);
          }
          k.tube('dark', belt, 0.006, n + 2, 3);
          for (let j = 0; j < n; j++) {
            const t = j / (n - 1);
            const a = t * Math.PI;
            const y = -Math.sin(a) * 0.08 * (1 + i * 0.4);
            const z = -0.06 + t * 0.12 * (1 + i * 0.3);
            k.rod('brass', [0, y, z], [0.035, y, z], 0.005, 0.005, 5);
            k.rod('metal', [0.035, y, z], [0.048, y, z], 0.005, 0.001, 5);
          }
        },
      }),
    );

  // shell tube (under barrel)
  for (const [i, len] of [0.18, 0.28, 0.38].entries())
    out.push(
      mk({
        id: `mag-shelltube-${['short', 'std', 'long'][i]}`,
        attach: 'under',
        classes: ['shotgun', 'grenade_launcher'],
        tags: ['sport', 'classic'],
        desc: `${['short', 'standard', 'long'][i]} under-barrel shell tube magazine`,
        draw: (k) => {
          k.zrod('main', 0.12, 0.12 - len, 0.013, 0.013, 8, 0, -0.014);
          k.zrod('dark', 0.12 - len - 0.008, 0.12 - len, 0.014, 0.014, 8, 0, -0.014);
        },
      }),
    );

  // side saddle shell holders
  for (const [i, n] of [4, 6, 8].entries())
    out.push(
      mk({
        id: `mag-sidesaddle-${n}`,
        attach: 'side',
        classes: ['shotgun'],
        tags: ['tactical', 'sport'],
        desc: `side saddle carrying ${n} shotgun shells`,
        draw: (k) => {
          const w = n * 0.016;
          k.box('dark', [0.006, 0.03, w + 0.006], { p: [0.003, 0, 0] });
          for (let j = 0; j < n; j++) {
            const z = -w / 2 + 0.008 + j * 0.016;
            k.rod('#c0392b', [0.012, -0.02, z], [0.012, 0.02, z], 0.007, 0.007, 6);
            k.rod('brass', [0.012, -0.03, z], [0.012, -0.02, z], 0.0075, 0.0075, 6);
          }
          void i;
        },
      }),
    );

  // spare rockets on side
  for (const [i, r] of [0.03, 0.04, 0.05].entries())
    out.push(
      mk({
        id: `mag-spare-rocket-${i + 1}`,
        attach: 'side',
        classes: ['rocket_launcher'],
        tags: ['military', 'heavy'],
        desc: 'spare rocket clipped to the side',
        draw: (k) => {
          const L = 0.25 + i * 0.05;
          k.zrod('main', -L / 2, L / 2 - 0.05, r * 0.6, r * 0.6, 8, r, 0);
          k.zrod('accent', -L / 2 - r * 1.5, -L / 2, 0, r, 8, r, 0);
          for (let j = 0; j < 4; j++) {
            const a = (j / 4) * Math.PI * 2;
            k.extrude('dark', [[0, 0], [0.05, 0], [0.05, r * 0.8]], 0.004, 'zy', { p: [r, 0, L / 2 - 0.05], r: [0, 0, a] });
          }
          k.box('dark', [0.01, 0.02, 0.04], { p: [0.005, 0, 0] });
        },
      }),
    );

  // grenade mags (40mm)
  for (const [i, n] of [3, 5].entries())
    out.push(
      mk({
        id: `mag-grenade-box-${n}`,
        classes: ['grenade_launcher'],
        tags: ['military', 'heavy'],
        desc: `box magazine of ${n} fat grenades`,
        draw: (k) => {
          const h = n * 0.042;
          k.box('main', [0.05, h, 0.06], { p: [0, -h / 2, 0] });
          for (let j = 0; j < n; j++) k.rod('accent', [0.026, -0.021 - j * 0.042, 0], [0.03, -0.021 - j * 0.042, 0], 0.018, 0.018, 8);
          void i;
        },
      }),
    );

  // dart quivers
  for (const [i, n] of [5, 8, 12, 16].entries())
    out.push(
      mk({
        id: `mag-dart-quiver-${n}`,
        attach: i % 2 ? 'side' : 'mag',
        classes: ['blowgun', 'crossbow'],
        tags: i < 2 ? ['tribal', 'organic'] : ['tactical'],
        desc: `${i % 2 ? 'side-mounted' : 'under-slung'} quiver of ${n} darts`,
        draw: (k) => {
          const r = 0.012 + n * 0.0012;
          const L = 0.1 + i * 0.02;
          const side = i % 2 === 1;
          const p0: [number, number, number] = side ? [r, 0, -L / 2] : [0, -r, -L / 2];
          const p1: [number, number, number] = side ? [r, 0, L / 2] : [0, -r, L / 2];
          k.rod(i < 2 ? 'wood' : 'main', p0, p1, r, r, 8);
          for (let j = 0; j < Math.min(n, 6); j++) {
            const a = (j / Math.min(n, 6)) * Math.PI * 2;
            const ox = Math.cos(a) * r * 0.5;
            const oy = Math.sin(a) * r * 0.5;
            k.rod('#e8483a', [p0[0] + ox, p0[1] + oy, -L / 2], [p0[0] + ox, p0[1] + oy, -L / 2 - 0.03], 0.004, 0.001, 4);
          }
        },
      }),
    );

  // soap bottles
  for (const [i, s] of [0.8, 1, 1.3, 1.6].entries()) {
    const top = i >= 2;
    out.push(
      mk({
        id: `mag-soap-bottle-${['mini', 'std', 'big', 'jumbo'][i]}`,
        attach: top ? 'top' : 'mag',
        classes: ['bubble_gun', 'weird'],
        tags: ['toy', 'silly', 'clean'],
        desc: `${['mini', 'standard', 'big', 'jumbo'][i]} soap bottle ${top ? 'upside-down on top' : 'feeding from below'}`,
        draw: (k) => {
          const d = top ? 1 : -1;
          const H = 0.09 * s;
          const R = 0.024 * s;
          k.rod('accent', [0, 0, 0], [0, d * 0.02, 0], 0.01, 0.012, 8);
          k.rod('main', [0, d * 0.02, 0], [0, d * (0.03 + H), 0], R * 0.8, R, 8);
          k.ball('main', 1, [0, d * (0.03 + H), 0], 1, [R, R * 0.6, R]);
          k.box('white', [R * 1.6, H * 0.4, 0.004], { p: [0, d * (0.03 + H * 0.5), R * 0.95] });
        },
      }),
    );
  }

  // fuel canisters (flamethrower mags)
  for (const [i, s] of [0.8, 1, 1.25].entries())
    out.push(
      mk({
        id: `mag-fuel-canister-${i + 1}`,
        classes: ['flamethrower'],
        tags: ['military', 'industrial'],
        desc: 'squat pressurised fuel canister',
        draw: (k) => {
          k.rod('dark', [0, 0, 0], [0, -0.015, 0], 0.012, 0.012, 6);
          k.lathe(
            'main',
            [
              [0.012, 0],
              [0.035 * s, -0.01],
              [0.04 * s, -0.03],
              [0.04 * s, -0.09 * s],
              [0.03 * s, -0.1 * s],
              [0, -0.1 * s],
            ],
            10,
            { p: [0, -0.015, 0] },
          );
          k.box('#e63946', [0.03 * s, 0.03 * s, 0.004], { p: [0, -0.06 * s, 0.04 * s] });
        },
      }),
    );

  // energy cells
  for (const [i, [L, R]] of [
    [0.06, 0.016],
    [0.09, 0.018],
    [0.12, 0.02],
    [0.08, 0.026],
  ].entries())
    out.push(
      mk({
        id: `mag-energy-cell-${i + 1}`,
        classes: ['rifle', 'pistol', 'smg', 'weird', 'sniper'],
        tags: ['scifi', 'energy'],
        desc: 'glowing translucent energy cell',
        draw: (k) => {
          k.rod('main', [0, 0, 0], [0, -0.012, 0], R * 1.2, R * 1.2, 6);
          k.rod('glow', [0, -0.012, 0], [0, -0.012 - L, 0], R, R, 6);
          k.rod('main', [0, -0.012 - L, 0], [0, -0.024 - L, 0], R * 1.2, R * 1.2, 6);
          for (let j = 0; j < 3; j++) {
            const a = (j / 3) * Math.PI * 2;
            k.rod('main', [Math.cos(a) * R, -0.012, Math.sin(a) * R], [Math.cos(a) * R, -0.012 - L, Math.sin(a) * R], 0.003, 0.003, 4);
          }
        },
      }),
    );

  // battery packs
  for (const [i, n] of [2, 4].entries())
    out.push(
      mk({
        id: `mag-battery-pack-${n}`,
        classes: ['weird', 'bubble_gun', 'smg'],
        tags: ['silly', 'improvised'],
        desc: `${n} giant AA batteries taped together`,
        draw: (k) => {
          for (let j = 0; j < n; j++) {
            const x = (j - (n - 1) / 2) * 0.026;
            k.rod('#222222', [x, 0, 0], [x, -0.08, 0], 0.012, 0.012, 8);
            k.rod('#e8a33d', [x, -0.08, 0], [x, -0.1, 0], 0.012, 0.012, 8);
            k.rod('metal', [x, -0.1, 0], [x, -0.106, 0], 0.005, 0.005, 6);
          }
          k.box('#cccccc', [n * 0.026 + 0.004, 0.015, 0.026], { p: [0, -0.04, 0] });
          void i;
        },
      }),
    );

  // jungle taped mags
  for (const [i, len] of [0.12, 0.16].entries())
    out.push(
      mk({
        id: `mag-jungle-taped-${i + 1}`,
        classes: ['rifle', 'smg'],
        tags: ['military', 'improvised'],
        desc: 'two magazines taped together jungle style',
        draw: (k) => {
          k.box('main', [0.024, len, 0.032], { p: [0, -len / 2, 0] });
          k.box('main', [0.024, len, 0.032], { p: [0.03, -len * 0.6, 0.004], r: [Math.PI, 0, 0] });
          k.box('#5a5a5a', [0.06, 0.02, 0.036], { p: [0.015, -len * 0.45, 0.002] });
        },
      }),
    );

  // helical mags on top
  for (const [i, len] of [0.18, 0.26].entries())
    out.push(
      mk({
        id: `mag-helical-${i + 1}`,
        attach: 'top',
        classes: ['smg', 'rifle', 'weird'],
        tags: ['retro', 'scifi'],
        desc: 'long cylindrical helical magazine on top',
        draw: (k) => {
          k.zrod('main', -len * 0.6, len * 0.4, 0.024, 0.024, 10, 0, 0.026);
          for (let j = 0; j < 5; j++) {
            const z = -len * 0.5 + j * (len / 5);
            k.zrod('dark', z, z + 0.008, 0.026, 0.026, 10, 0, 0.026);
          }
        },
      }),
    );

  // stripper clips
  for (const [i, n] of [5, 10].entries())
    out.push(
      mk({
        id: `mag-stripper-clip-${n}`,
        attach: 'top',
        classes: ['rifle', 'sniper'],
        tags: ['retro', 'military'],
        desc: `stripper clip of ${n} rounds loaded from top`,
        draw: (k) => {
          const w = n * 0.0085;
          k.box('metal', [0.012, 0.004, w + 0.006], { p: [0, 0.002, 0] });
          for (let j = 0; j < n; j++) {
            const z = -w / 2 + 0.004 + j * 0.0085;
            k.rod('brass', [0, 0.004, z], [0, 0.04, z], 0.004, 0.004, 5);
            k.rod('metal', [0, 0.04, z], [0, 0.052, z], 0.004, 0.0012, 5);
          }
          void i;
        },
      }),
    );

  // foam dart mags
  for (const [i, n] of [6, 12].entries())
    out.push(
      mk({
        id: `mag-foam-dart-${n}`,
        classes: ['bubble_gun', 'weird', 'smg', 'pistol'],
        tags: ['toy', 'silly'],
        desc: `translucent toy magazine of ${n} foam darts`,
        draw: (k) => {
          const h = 0.06 + i * 0.06;
          k.box('main', [0.03, h, 0.08], { p: [0, -h / 2, 0] });
          k.box('accent', [0.032, 0.01, 0.082], { p: [0, -h, 0] });
          for (let j = 0; j < Math.min(n, 6); j++) k.rod('#ff6b35', [0.016, -0.01 - j * (h / 6.5), 0.035], [0.016, -0.01 - j * (h / 6.5), 0.045], 0.006, 0.006, 6);
        },
      }),
    );

  // paintball hoppers
  for (const [i, s] of [0.8, 1, 1.25].entries())
    out.push(
      mk({
        id: `mag-hopper-${i + 1}`,
        attach: 'top',
        classes: ['bubble_gun', 'weird', 'smg', 'grenade_launcher'],
        tags: ['toy', 'sport'],
        desc: 'paintball hopper with balls inside',
        draw: (k) => {
          k.rod('dark', [0, 0, 0], [0, 0.03, -0.02 * s], 0.012, 0.012, 6);
          k.ball('main', 1, [0, 0.07 * s, -0.01], 1, [0.045 * s, 0.045 * s, 0.07 * s]);
          k.ball('accent', 0.012, [0.035 * s, 0.07 * s, -0.04 * s], 0);
          k.ball('accent', 0.012, [-0.03 * s, 0.08 * s, 0.0], 0);
        },
      }),
    );

  // silly containers
  out.push(
    mk({
      id: 'mag-coffee-can',
      classes: ['weird'],
      tags: ['silly', 'improvised'],
      desc: 'coffee can taped on as a magazine',
      draw: (k) => {
        k.rod('main', [0, -0.005, 0], [0, -0.12, 0], 0.04, 0.04, 10);
        k.rod('accent', [0, -0.04, 0], [0, -0.08, 0], 0.041, 0.041, 10);
        k.rod('metal', [0, 0, 0], [0, -0.006, 0], 0.041, 0.041, 10);
      },
    }),
    mk({
      id: 'mag-juice-box',
      classes: ['weird', 'bubble_gun'],
      tags: ['silly', 'cute'],
      desc: 'juice box with bendy straw feed',
      draw: (k) => {
        k.box('main', [0.035, 0.08, 0.05], { p: [0, -0.06, 0] });
        k.box('accent', [0.036, 0.03, 0.04], { p: [0, -0.06, 0.006] });
        k.tube('white', [[0, -0.02, 0.01], [0, -0.005, 0.01], [0, 0, 0.0]], 0.003, 6, 4);
      },
    }),
    mk({
      id: 'mag-honey-jar',
      classes: ['weird', 'bubble_gun'],
      tags: ['silly', 'organic'],
      desc: 'honey pot magazine dripping gold',
      draw: (k) => {
        k.lathe('#e09f1f', [[0.012, 0], [0.03, -0.02], [0.042, -0.06], [0.03, -0.1], [0, -0.1]], 10, {});
        k.rod('#7a4a28', [0, 0, 0], [0, -0.012, 0], 0.03, 0.03, 10);
        k.ball('#f6c244', 0.008, [0.03, -0.035, 0.0], 0);
      },
    }),
    mk({
      id: 'mag-nail-strip',
      classes: ['weird', 'smg', 'pistol'],
      tags: ['industrial', 'improvised'],
      desc: 'angled nail-gun strip magazine',
      draw: (k) => {
        k.extrude('main', [[-0.012, 0], [0.012, 0], [0.09, -0.08], [0.066, -0.08]], 0.016, 'zy', undefined, 0);
        for (let j = 0; j < 6; j++) k.rod('metal', [0, -0.01 - j * 0.012, 0.004 + j * 0.013], [0, -0.004 - j * 0.012, -0.004 + j * 0.013], 0.003, 0.003, 4);
      },
    }),
    mk({
      id: 'mag-cannonball-rack',
      attach: 'side',
      classes: ['weird', 'grenade_launcher'],
      tags: ['pirate', 'silly', 'heavy'],
      desc: 'rack of tiny cannonballs on the side',
      draw: (k) => {
        k.box('wood', [0.012, 0.02, 0.12], { p: [0.006, -0.02, 0] });
        for (let j = 0; j < 4; j++) k.ball('#222222', 0.013, [0.016, -0.004, -0.045 + j * 0.03], 1);
      },
    }),
  );
  return out;
}
