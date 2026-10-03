/**
 * MELEE HEADS: attach to 'head' at the top of a haft. The haft axis runs along Z
 * (head sits around z in [-0.15, 0.02]); striking face / cutting edge points +Y.
 */
import type { PartDef } from '../types';
import { part, S } from '../lib/define';
import type { Kit, Pt } from '../lib/kit';

const M = ['melee'];

interface H {
  id: string;
  tags: string[];
  desc: string;
  classes?: string[];
  draw: (k: Kit) => void;
}

function mk(h: H): PartDef {
  return part({
    id: h.id,
    category: 'head',
    classes: h.classes ?? M,
    tags: h.tags,
    desc: h.desc,
    attach: 'head',
    sockets: { deco: S([0.03, 0, -0.04], [1, 0, 0]) },
    draw: h.draw,
  });
}

/** Axe bit outline in (z,y): starts at the haft and fans out toward +Y. */
function axeBit(len: number, top: number, bot: number, beard = 0): Pt[] {
  return [
    [0.0, 0.0],
    [-0.04, 0.0],
    [-0.04 - top * 0.3, len * 0.6],
    [-0.04 - top, len],
    [0.0 + bot + beard, len * 1.02],
    [0.0 + bot * 0.3, len * 0.6],
    [0.0, 0.0],
  ].slice(0, 6) as Pt[];
}

export function headParts(): PartDef[] {
  const out: PartDef[] = [];
  const add = (h: H) => out.push(mk(h));
  const eye = (k: Kit, L = 0.06, slot: 'metal' | 'main' = 'metal') => k.box(slot, [0.03, 0.035, L], { p: [0, 0, -L / 2 + 0.01] });

  // single bit axes
  [
    ['hatchet', 0.08, 0.02, 0.02],
    ['axe', 0.11, 0.035, 0.03],
    ['greataxe', 0.15, 0.06, 0.05],
  ].forEach(([n, len, top, bot]) =>
    add({
      id: `head-axe-${n}`,
      tags: ['medieval', 'brutal'],
      desc: `${n} single-bit axe head`,
      draw: (k) => {
        eye(k);
        k.blade('metal', axeBit(len as number, top as number, bot as number), 0.016, 'zy', { p: [0, 0.015, 0] });
        k.box('dark', [0.032, 0.02, 0.03], { p: [0, -0.02, -0.02] });
      },
    }),
  );
  [0.1, 0.13].forEach((len, i) =>
    add({
      id: `head-axe-bearded-${i + 1}`,
      tags: ['medieval', 'viking'],
      desc: 'bearded viking axe head with hooked lower edge',
      draw: (k) => {
        eye(k);
        k.blade('metal', [[0.01, 0], [-0.03, 0], [-0.03, len * 0.5], [-0.07, len * 0.9], [0.04, len], [0.01, len * 0.6]], 0.016, 'zy', { p: [0, 0.015, -0.005] });
      },
    }),
  );
  [0.09, 0.12].forEach((len, i) =>
    add({
      id: `head-axe-double-${i + 1}`,
      tags: ['medieval', 'fantasy', 'heavy'],
      desc: 'double-bit labrys axe head',
      draw: (k) => {
        eye(k, 0.07);
        for (const sgn of [1, -1])
          k.blade('metal', [[0.015, 0], [-0.045, 0], [-0.07, len], [0.04, len]], 0.016, 'zy', { p: [0, sgn * 0.015, 0], r: [sgn > 0 ? 0 : Math.PI, 0, 0] });
      },
    }),
  );
  [0.14, 0.18].forEach((len, i) =>
    add({
      id: `head-axe-crescent-${i + 1}`,
      tags: ['medieval', 'fantasy', 'heavy'],
      desc: 'crescent moon battle axe head',
      draw: (k) => {
        eye(k);
        const pts: Pt[] = [];
        for (let j = 0; j <= 8; j++) {
          const a = -Math.PI * 0.45 + (j / 8) * Math.PI * 0.9;
          pts.push([-0.02 + Math.sin(a) * len * 0.75, len * 0.35 + Math.cos(a) * len * 0.55]);
        }
        pts.push([0.0, 0.0], [-0.04, 0.0]);
        k.blade('metal', pts, 0.016, 'zy', { p: [0, 0.015, 0] });
      },
    }),
  );
  add({
    id: 'head-tomahawk',
    tags: ['western', 'tribal'],
    desc: 'tomahawk head with rear spike',
    draw: (k) => {
      eye(k, 0.04);
      k.blade('metal', [[0.01, 0], [-0.02, 0], [-0.035, 0.07], [0.025, 0.08]], 0.014, 'zy', { p: [0, 0.015, 0] });
      k.rod('metal', [0, -0.015, -0.01], [0, -0.07, -0.02], 0.01, 0, 5);
      k.ball('#e8483a', 0.01, [0.02, -0.02, 0.03], 0);
    },
  });
  add({
    id: 'head-fireaxe',
    tags: ['industrial', 'brutal'],
    desc: 'red fire axe head with pick back',
    draw: (k) => {
      k.box('accent', [0.03, 0.04, 0.06], { p: [0, 0, -0.02] });
      k.blade('accent', axeBit(0.1, 0.02, 0.02), 0.016, 'zy', { p: [0, 0.02, 0] });
      k.blade('metal', [[0.0, 0], [-0.04, 0], [-0.03, 0.03]], 0.004, 'zy', { p: [0, 0.112, 0.0] });
      k.rod('accent', [0, -0.02, -0.02], [0, -0.13, -0.03], 0.014, 0.0, 4);
    },
  });
  add({
    id: 'head-halberd',
    tags: ['medieval', 'heavy'],
    desc: 'halberd head with axe blade, spike and hook',
    draw: (k) => {
      eye(k, 0.1);
      k.blade('metal', axeBit(0.12, 0.05, 0.03), 0.014, 'zy', { p: [0, 0.015, -0.02] });
      k.zrod('metal', -0.3, -0.08, 0.0, 0.016, 4);
      k.rod('metal', [0, -0.015, -0.05], [0, -0.08, -0.02], 0.012, 0.0, 4);
    },
  });
  add({
    id: 'head-iceaxe',
    tags: ['adventure', 'industrial'],
    desc: 'ice axe with curved pick and adze',
    draw: (k) => {
      k.box('metal', [0.024, 0.03, 0.03], { p: [0, 0, -0.01] });
      k.tube('metal', [[0, 0.01, -0.01], [0, 0.07, -0.02], [0, 0.12, -0.04]], 0.009, 8, 4);
      k.blade('metal', [[0.01, 0], [-0.03, 0], [-0.025, -0.06], [0.015, -0.06]], 0.006, 'zy', { p: [0, -0.01, 0] });
    },
  });

  // hammers
  [
    ['sledge', 0.07, 0.035],
    ['maul', 0.09, 0.05],
  ].forEach(([n, half, r]) =>
    add({
      id: `head-hammer-${n}`,
      tags: ['industrial', 'heavy', 'brutal'],
      desc: `${n} hammer head`,
      draw: (k) => {
        const h = half as number;
        const R = r as number;
        k.rod('main', [0, -h, -R], [0, h, -R], R, R, 8);
        k.rod('metal', [0, h, -R], [0, h + 0.012, -R], R * 1.08, R * 0.95, 8);
        k.rod('metal', [0, -h, -R], [0, -h - 0.012, -R], R * 1.08, R * 0.95, 8);
      },
    }),
  );
  [0.05, 0.07].forEach((h, i) =>
    add({
      id: `head-warhammer-${i + 1}`,
      tags: ['medieval', 'brutal'],
      desc: 'war hammer with spike back and top spike',
      draw: (k) => {
        k.box('metal', [0.04, h, 0.04], { p: [0, h / 2, -0.02] });
        k.box('main', [0.05, 0.016, 0.05], { p: [0, h, -0.02] });
        k.rod('metal', [0, 0, -0.02], [0, -0.09, -0.02], 0.016, 0.0, 4);
        k.zrod('metal', -0.1, -0.04, 0.0, 0.012, 4);
      },
    }),
  );
  [0.05, 0.065].forEach((r, i) =>
    add({
      id: `head-mallet-${i + 1}`,
      tags: ['wood', 'medieval'],
      desc: 'round wooden mallet head',
      draw: (k) => {
        k.rod('wood', [0, -0.08, -r], [0, 0.08, -r], r, r, 10);
        k.rod('metal', [0, 0.07, -r], [0, 0.08, -r], r * 1.04, r * 1.04, 10);
        k.rod('metal', [0, -0.08, -r], [0, -0.07, -r], r * 1.04, r * 1.04, 10);
      },
    }),
  );
  add({
    id: 'head-squeaky-hammer',
    tags: ['toy', 'silly'],
    classes: [...M, 'weird'],
    desc: 'squeaky toy hammer head with bellows',
    draw: (k) => {
      k.rod('main', [0, -0.08, -0.04], [0, 0.08, -0.04], 0.04, 0.04, 8);
      k.rod('accent', [0, 0.06, -0.04], [0, 0.1, -0.04], 0.045, 0.045, 8);
      k.rod('accent', [0, -0.06, -0.04], [0, -0.1, -0.04], 0.045, 0.045, 8);
      for (let j = 0; j < 3; j++) k.rod('white', [0, -0.03 + j * 0.03, -0.04], [0, -0.02 + j * 0.03, -0.04], 0.042, 0.042, 8);
    },
  });
  add({
    id: 'head-claw-hammer',
    tags: ['industrial', 'improvised'],
    desc: 'claw hammer with split claw',
    draw: (k) => {
      k.box('metal', [0.026, 0.03, 0.04], { p: [0, 0, -0.015] });
      k.rod('metal', [0, 0.01, -0.015], [0, 0.07, -0.015], 0.016, 0.018, 8);
      for (const x of [-0.006, 0.006]) k.tube('metal', [[x, -0.01, -0.015], [x, -0.05, -0.01], [x, -0.08, 0.01]], 0.006, 6, 4);
    },
  });
  add({
    id: 'head-thunder-hammer',
    tags: ['fantasy', 'heavy', 'magic'],
    desc: 'blocky rune hammer with glowing runes',
    draw: (k) => {
      k.box('main', [0.08, 0.16, 0.08], { p: [0, 0, -0.04] });
      k.box('metal', [0.084, 0.02, 0.084], { p: [0, 0.07, -0.04] });
      k.box('metal', [0.084, 0.02, 0.084], { p: [0, -0.07, -0.04] });
      k.box('glow', [0.086, 0.04, 0.01], { p: [0, 0, -0.04] });
    },
  });
  add({
    id: 'head-gavel',
    tags: ['silly', 'wood', 'fancy'],
    classes: [...M, 'weird'],
    desc: 'judge gavel head with brass bands',
    draw: (k) => {
      k.rod('wood', [0, -0.05, -0.025], [0, 0.05, -0.025], 0.025, 0.025, 10);
      k.rod('brass', [0, 0.03, -0.025], [0, 0.036, -0.025], 0.027, 0.027, 10);
      k.rod('brass', [0, -0.036, -0.025], [0, -0.03, -0.025], 0.027, 0.027, 10);
    },
  });
  add({
    id: 'head-meat-tenderizer',
    tags: ['kitchen', 'silly', 'brutal'],
    classes: [...M, 'weird'],
    desc: 'spiky meat tenderizer head',
    draw: (k) => {
      k.box('metal', [0.045, 0.1, 0.045], { p: [0, 0, -0.025] });
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) k.rod('metal', [x * 0.013, 0.05, -0.025 + z * 0.013], [x * 0.013, 0.062, -0.025 + z * 0.013], 0.005, 0, 4);
    },
  });

  // maces
  [0.04, 0.055].forEach((r, i) =>
    add({
      id: `head-mace-flanged-${i + 1}`,
      tags: ['medieval', 'brutal'],
      desc: 'flanged mace head with radial blades',
      draw: (k) => {
        k.zrod('metal', -r * 2.6, 0, r * 0.5, r * 0.5, 6);
        for (let j = 0; j < 7; j++) {
          const a = (j / 7) * Math.PI * 2;
          k.extrude('main', [[0, 0], [-r * 2.4, 0], [-r * 2, r], [-r * 0.4, r]], 0.006, 'zy', { p: [Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, 0], r: [0, 0, a - Math.PI / 2] });
        }
        k.zrod('metal', -r * 2.9, -r * 2.5, 0, r * 0.5, 6);
      },
    }),
  );
  [0.045, 0.06].forEach((r, i) =>
    add({
      id: `head-mace-spiked-${i + 1}`,
      tags: ['medieval', 'brutal'],
      desc: 'spiked ball mace head',
      draw: (k) => {
        k.ball('main', r, [0, 0, -r], 1);
        const dirs: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1], [0.7, 0.7, -0.3], [-0.7, 0.7, -0.3], [0.7, -0.7, -0.3], [-0.7, -0.7, -0.3], [0.6, 0, -0.8], [-0.6, 0, -0.8]];
        for (const [x, y, z] of dirs) {
          const l = Math.hypot(x, y, z);
          k.rod('metal', [(x / l) * r * 0.8, (y / l) * r * 0.8, -r + (z / l) * r * 0.8], [(x / l) * r * 1.6, (y / l) * r * 1.6, -r + (z / l) * r * 1.6], r * 0.22, 0, 4);
        }
      },
    }),
  );
  [0.2, 0.3].forEach((len, i) =>
    add({
      id: `head-morningstar-${i + 1}`,
      tags: ['medieval', 'brutal', 'heavy'],
      desc: 'flail with chain and spiked ball',
      draw: (k) => {
        k.ball('metal', 0.012, [0, 0, -0.005], 0);
        const n = 6;
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n;
          k.torus('metal', 0.01, 0.003, { p: [0, -Math.sin(t * 1.2) * len * 0.5, -t * len], r: [0, j % 2 ? Math.PI / 2 : 0, 0] }, 3, 6);
        }
        const path: [number, number, number][] = [];
        for (let j = 0; j <= 6; j++) {
          const t = j / 6;
          path.push([0, -Math.sin(t * 1.2) * len * 0.5, -t * (len + 0.01)]);
        }
        k.tube('dark', path, 0.0025, 12, 3);
        const c: [number, number, number] = [0, -Math.sin(1.2) * len * 0.5, -len - 0.04];
        k.ball('main', 0.04, c, 1);
        for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1]])
          k.rod('metal', [c[0] + x * 0.03, c[1] + y * 0.03, c[2] + z * 0.03], [c[0] + x * 0.065, c[1] + y * 0.065, c[2] + z * 0.065], 0.01, 0, 4);
      },
    }),
  );
  add({
    id: 'head-studded-club',
    tags: ['tribal', 'brutal', 'wood'],
    desc: 'fat wooden club head with iron studs',
    draw: (k) => {
      k.zrod('wood', -0.25, 0, 0.055, 0.025, 8);
      for (let j = 0; j < 10; j++) {
        const a = j * 2.1;
        const z = -0.05 - (j % 5) * 0.04;
        const r = 0.025 + (0.03 * -z) / 0.25 + 0.005;
        k.ball('metal', 0.008, [Math.cos(a) * r, Math.sin(a) * r, z], 0);
      }
    },
  });

  // spears
  [0.15, 0.22].forEach((L, i) =>
    add({
      id: `head-spear-leaf-${i + 1}`,
      tags: ['medieval', 'ancient'],
      desc: 'leaf-shaped spear point with socket',
      draw: (k) => {
        k.zrod('metal', -0.05, 0.02, 0.014, 0.016, 6);
        const w = (t: number) => 0.03 * Math.sin(Math.min(1, t * 1.15) * Math.PI);
        const pts: Pt[] = [];
        for (let j = 0; j <= 8; j++) pts.push([-0.05 - (j / 8) * L, w(j / 8)]);
        for (let j = 7; j >= 1; j--) pts.push([-0.05 - (j / 8) * L, -w(j / 8)]);
        k.blade('metal', pts, 0.01, 'zy');
      },
    }),
  );
  [0.2, 0.3].forEach((L, i) =>
    add({
      id: `head-spear-spike-${i + 1}`,
      tags: ['medieval', 'military'],
      desc: 'long square awl-pike spike',
      draw: (k) => {
        k.zrod('metal', -0.06, 0.02, 0.014, 0.016, 6);
        k.box('metal', [0.05, 0.05, 0.012], { p: [0, 0, -0.06] });
        k.zrod('metal', -0.06 - L, -0.06, 0.0, 0.012, 4);
      },
    }),
  );
  add({
    id: 'head-trident',
    tags: ['nautical', 'fantasy'],
    desc: 'three-pronged trident head',
    draw: (k) => {
      k.zrod('metal', -0.05, 0.02, 0.014, 0.014, 6);
      k.rod('metal', [-0.06, 0, -0.05], [0.06, 0, -0.05], 0.008, 0.008, 6);
      for (const x of [-0.06, 0, 0.06]) {
        k.zrod('metal', -0.2, -0.05, 0.006, 0.006, 5, x, 0);
        k.zrod('metal', -0.24, -0.2, 0.0, 0.01, 4, x, 0);
      }
    },
  });
  add({
    id: 'head-bident',
    tags: ['fantasy', 'spooky'],
    desc: 'two-pronged bident fork',
    draw: (k) => {
      k.zrod('metal', -0.05, 0.02, 0.014, 0.014, 6);
      k.rod('metal', [-0.04, 0, -0.05], [0.04, 0, -0.05], 0.008, 0.008, 6);
      for (const x of [-0.04, 0.04]) k.zrod('metal', -0.22, -0.05, 0.0, 0.009, 5, x, 0);
    },
  });
  add({
    id: 'head-spear-winged',
    tags: ['medieval', 'hunting'],
    desc: 'winged boar spear with side lugs',
    draw: (k) => {
      k.zrod('metal', -0.07, 0.02, 0.014, 0.016, 6);
      k.rod('metal', [-0.045, 0, -0.03], [0.045, 0, -0.03], 0.008, 0.0, 4);
      k.rod('metal', [0.045, 0, -0.03], [-0.045, 0, -0.03], 0.008, 0.0, 4);
      k.blade('metal', [[-0.07, 0], [-0.12, 0.035], [-0.26, 0], [-0.12, -0.035]], 0.01, 'zy');
    },
  });
  add({
    id: 'head-glaive',
    tags: ['medieval', 'eastern'],
    desc: 'curved glaive blade head',
    draw: (k) => {
      k.zrod('metal', -0.05, 0.02, 0.014, 0.016, 6);
      k.blade('metal', [[-0.05, -0.02], [-0.3, 0.02], [-0.35, 0.08], [-0.22, 0.05], [-0.05, 0.03]], 0.01, 'zy');
    },
  });
  add({
    id: 'head-naginata',
    tags: ['eastern', 'sleek'],
    desc: 'long curved naginata blade',
    draw: (k) => {
      k.zrod('brass', -0.04, 0.02, 0.016, 0.016, 6);
      k.blade('metal', [[-0.04, -0.016], [-0.3, -0.012], [-0.42, 0.03], [-0.3, 0.02], [-0.04, 0.016]], 0.008, 'zy');
    },
  });
  add({
    id: 'head-pitchfork',
    tags: ['farm', 'silly'],
    classes: [...M, 'weird'],
    desc: 'farm pitchfork with four tines',
    draw: (k) => {
      k.zrod('metal', -0.05, 0.02, 0.014, 0.014, 6);
      k.tube('metal', [[-0.06, 0, -0.08], [-0.05, 0, -0.05], [0, 0, -0.04], [0.05, 0, -0.05], [0.06, 0, -0.08]], 0.006, 10, 4);
      for (const x of [-0.06, -0.02, 0.02, 0.06]) k.zrod('metal', -0.25, -0.06, 0.0, 0.006, 4, x, 0);
    },
  });

  // scythes
  [0.4, 0.55].forEach((L, i) =>
    add({
      id: `head-scythe-${i + 1}`,
      tags: ['farm', 'spooky'],
      desc: 'long curved scythe blade',
      draw: (k) => {
        k.box('metal', [0.025, 0.04, 0.04], { p: [0, 0, -0.01] });
        const pts: Pt[] = [];
        for (let j = 0; j <= 8; j++) {
          const t = j / 8;
          pts.push([-0.02 - t * 0.1 * Math.sin(t * 2), 0.01 + t * L]);
        }
        for (let j = 8; j >= 0; j--) {
          const t = j / 8;
          pts.push([-0.02 - t * 0.1 * Math.sin(t * 2) - 0.05 * (1 - t) - 0.002, 0.01 + t * L * 0.98]);
        }
        k.blade('metal', pts, 0.006, 'zy');
      },
    }),
  );
  add({
    id: 'head-sickle',
    tags: ['farm'],
    desc: 'small crescent sickle blade',
    draw: (k) => {
      const pts: Pt[] = [];
      for (let j = 0; j <= 8; j++) {
        const a = (j / 8) * Math.PI * 1.1;
        pts.push([-0.08 + Math.cos(a) * -0.08 + 0.0, Math.sin(a) * 0.08]);
      }
      for (let j = 8; j >= 0; j--) {
        const a = (j / 8) * Math.PI * 1.1;
        pts.push([-0.08 + Math.cos(a) * -0.065, Math.sin(a) * 0.065 * (0.5 + 0.5 * (1 - j / 8))]);
      }
      k.blade('metal', pts, 0.006, 'zy');
    },
  });
  add({
    id: 'head-war-scythe',
    tags: ['medieval', 'brutal'],
    desc: 'straightened war scythe blade on socket',
    draw: (k) => {
      k.zrod('metal', -0.06, 0.02, 0.014, 0.016, 6);
      k.blade('metal', [[-0.06, -0.015], [-0.4, 0.0], [-0.45, 0.04], [-0.3, 0.035], [-0.06, 0.02]], 0.008, 'zy');
    },
  });

  // cookware
  [0.09, 0.12].forEach((r, i) =>
    add({
      id: `head-frying-pan-${i + 1}`,
      tags: ['kitchen', 'silly'],
      classes: [...M, 'weird'],
      desc: 'cast iron frying pan',
      draw: (k) => {
        k.lathe('#2b2b2b', [[0, 0], [r, 0.0], [r * 1.08, 0.025], [r * 1.02, 0.026], [r * 0.95, 0.006], [0, 0.006]], 12, { p: [0, -0.01, -r - 0.02] });
      },
    }),
  );
  add({
    id: 'head-wok',
    tags: ['kitchen', 'silly'],
    classes: [...M, 'weird'],
    desc: 'deep round wok',
    draw: (k) => {
      k.lathe('#3a3a3a', [[0, 0], [0.06, 0.008], [0.11, 0.04], [0.12, 0.05], [0.108, 0.048], [0.05, 0.014], [0, 0.008]], 12, { p: [0, -0.01, -0.13] });
    },
  });
  add({
    id: 'head-saucepan',
    tags: ['kitchen', 'silly'],
    classes: [...M, 'weird'],
    desc: 'tall steel saucepan',
    draw: (k) => {
      k.lathe('metal', [[0, 0], [0.07, 0], [0.072, 0.08], [0.066, 0.08], [0.064, 0.006], [0, 0.006]], 12, { p: [0, -0.04, -0.09] });
    },
  });
  add({
    id: 'head-spatula',
    tags: ['kitchen', 'silly'],
    classes: [...M, 'weird'],
    desc: 'slotted flipping spatula head',
    draw: (k) => {
      k.zrod('metal', -0.05, 0.02, 0.006, 0.008, 5);
      k.extrude('metal', [[-0.035, -0.05], [-0.04, -0.15], [0.04, -0.15], [0.035, -0.05]], 0.004, 'xz', undefined, 0, [
        [[-0.02, -0.07], [-0.022, -0.13], [-0.012, -0.13], [-0.01, -0.07]],
        [[0.01, -0.07], [0.012, -0.13], [0.022, -0.13], [0.02, -0.07]],
      ]);
    },
  });
  add({
    id: 'head-ladle',
    tags: ['kitchen', 'silly'],
    classes: [...M, 'weird'],
    desc: 'soup ladle bowl',
    draw: (k) => {
      k.tube('metal', [[0, 0, 0.02], [0, 0, -0.06], [0, -0.015, -0.095], [0, -0.022, -0.1]], 0.006, 8, 4);
      k.sphere('metal', 0.04, { p: [0, -0.02, -0.12], r: [Math.PI, 0, 0] }, 10, 4, Math.PI / 2);
    },
  });

  // bats & clubs
  [0.5, 0.6].forEach((L, i) =>
    add({
      id: `head-bat-barrel-${i + 1}`,
      tags: ['sport', 'brutal'],
      desc: 'baseball bat barrel',
      draw: (k) => k.zlathe('main', [[0.014, 0.02], [0.018, -L * 0.3], [0.032, -L * 0.75], [0.034, -L * 0.95], [0.02, -L], [0, -L - 0.004]], 10),
    }),
  );
  add({
    id: 'head-bat-nails',
    tags: ['brutal', 'improvised', 'spooky'],
    desc: 'bat barrel studded with nails',
    draw: (k) => {
      k.zlathe('wood', [[0.014, 0.02], [0.018, -0.15], [0.032, -0.38], [0.034, -0.48], [0.02, -0.5], [0, -0.504]], 10);
      for (let j = 0; j < 12; j++) {
        const a = j * 2.4;
        const z = -0.25 - (j % 6) * 0.04;
        k.rod('metal', [Math.cos(a) * 0.03, Math.sin(a) * 0.03, z], [Math.cos(a) * 0.055, Math.sin(a) * 0.055, z], 0.002, 0.002, 3);
      }
    },
  });
  add({
    id: 'head-cricket-bat',
    tags: ['sport', 'silly'],
    classes: [...M, 'weird'],
    desc: 'flat cricket bat blade',
    draw: (k) => k.extrude('wood', [[0.02, -0.04], [-0.42, -0.05], [-0.45, -0.03], [-0.45, 0.03], [-0.42, 0.05], [0.02, 0.04]], 0.03, 'xz', { r: [0, -Math.PI / 2, 0] }, 0.004),
  });
  add({
    id: 'head-caveman-club',
    tags: ['tribal', 'silly', 'wood'],
    classes: [...M, 'weird'],
    desc: 'knobbly caveman club',
    draw: (k) => {
      k.zrod('wood', -0.2, 0.02, 0.05, 0.02, 7);
      k.ball('wood', 0.055, [0, 0, -0.22], 1);
      k.ball('wood', 0.025, [0.04, 0.02, -0.12], 0);
      k.ball('wood', 0.02, [-0.03, -0.03, -0.17], 0);
    },
  });
  add({
    id: 'head-spiked-club',
    tags: ['tribal', 'brutal'],
    desc: 'club with bone spikes',
    draw: (k) => {
      k.zrod('wood', -0.3, 0.02, 0.045, 0.02, 7);
      for (let j = 0; j < 9; j++) {
        const a = j * 2.3;
        const z = -0.1 - (j % 3) * 0.08;
        k.rod('white', [Math.cos(a) * 0.03, Math.sin(a) * 0.03, z], [Math.cos(a) * 0.075, Math.sin(a) * 0.075, z - 0.02], 0.01, 0, 4);
      }
    },
  });

  // tools & misc
  const misc: [string, string, string[], (k: Kit) => void][] = [
    ['pickaxe', 'double-pointed pickaxe head', ['industrial', 'mining'], (k) => {
      k.box('metal', [0.03, 0.035, 0.035], { p: [0, 0, -0.015] });
      k.tube('metal', [[0, -0.15, 0.0], [0, -0.07, -0.02], [0, 0, -0.025], [0, 0.07, -0.02], [0, 0.15, 0.0]], 0.012, 12, 4);
    }],
    ['wrench', 'giant adjustable wrench head', ['industrial', 'silly'], (k) => {
      k.extrude('metal', [[0.02, -0.02], [-0.06, -0.025], [-0.08, -0.05], [-0.12, -0.05], [-0.12, -0.02], [-0.09, -0.012], [-0.09, 0.012], [-0.12, 0.02], [-0.12, 0.05], [-0.06, 0.04], [0.02, 0.02]], 0.014, 'zy', undefined, 0.002);
    }],
    ['plunger', 'toilet plunger head', ['silly', 'improvised'], (k) => {
      k.zlathe('#b0201f', [[0.012, 0.0], [0.04, -0.02], [0.06, -0.06], [0.055, -0.062]], 10);
    }],
    ['shovel', 'spade shovel head', ['industrial', 'improvised'], (k) => {
      k.zrod('metal', -0.06, 0.02, 0.014, 0.016, 6);
      k.extrude('metal', [[-0.06, -0.06], [-0.06, -0.2], [0, -0.25], [0.06, -0.2], [0.06, -0.06]], 0.004, 'xz', undefined, 0.002);
    }],
    ['stopsign', 'red octagon stop sign', ['silly', 'improvised'], (k) => {
      k.zrod('metal', -0.15, 0.02, 0.008, 0.008, 6);
      const pts: Pt[] = [];
      for (let j = 0; j < 8; j++) {
        const a = Math.PI / 8 + (j / 8) * Math.PI * 2;
        pts.push([Math.cos(a) * 0.12, Math.sin(a) * 0.12]);
      }
      k.extrude('#d62828', pts, 0.006, 'zy', { p: [0.008, 0, -0.2] });
      k.box('white', [0.008, 0.03, 0.15], { p: [0.012, 0, -0.2] });
    }],
    ['guitar-body', 'electric guitar body to swing', ['silly', 'musical'], (k) => {
      k.extrude('main', [[0, -0.05], [-0.12, -0.12], [-0.25, -0.1], [-0.3, -0.03], [-0.3, 0.05], [-0.22, 0.12], [-0.1, 0.06], [0, 0.04]], 0.04, 'zy', undefined, 0.004);
      k.box('white', [0.06, 0.044, 0.08], { p: [0, 0, -0.18] });
    }],
    ['racket', 'tennis racket head with strings', ['sport', 'silly'], (k) => {
      k.torus('main', 0.1, 0.008, { p: [0, 0, -0.12], s: [0.8, 1, 1] , r: [0, Math.PI / 2, 0]}, 4, 14);
      for (let j = -3; j <= 3; j++) {
        k.zrod('white', -0.2, -0.04, 0.001, 0.001, 3, 0, j * 0.022);
        k.rod('white', [0, -0.07, -0.12 + j * 0.022], [0, 0.07, -0.12 + j * 0.022], 0.001, 0.001, 3);
      }
    }],
    ['lollipop', 'giant swirl lollipop', ['silly', 'food', 'cute'], (k) => {
      k.zrod('white', -0.08, 0.02, 0.006, 0.006, 5);
      k.rod('main', [-0.012, 0, -0.17], [0.012, 0, -0.17], 0.09, 0.09, 14);
      k.torus('accent', 0.06, 0.012, { p: [0.013, 0, -0.17], r: [0, Math.PI / 2, 0] }, 3, 14);
      k.torus('white', 0.03, 0.01, { p: [0.013, 0, -0.17], r: [0, Math.PI / 2, 0] }, 3, 12);
    }],
    ['toilet-brush', 'bristly toilet brush head', ['silly', 'improvised'], (k) => {
      k.zrod('white', -0.12, 0.02, 0.008, 0.008, 5);
      k.zrod('white', -0.2, -0.1, 0.03, 0.03, 8);
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2;
        k.zrod('white', -0.2, -0.1, 0.006, 0.006, 3, Math.cos(a) * 0.032, Math.sin(a) * 0.032);
      }
    }],
    ['traffic-sign-arrow', 'arrow road sign head', ['silly', 'improvised'], (k) => {
      k.zrod('metal', -0.1, 0.02, 0.008, 0.008, 6);
      k.extrude('accent', [[0, -0.04], [-0.12, -0.04], [-0.12, -0.08], [-0.2, 0], [-0.12, 0.08], [-0.12, 0.04], [0, 0.04]], 0.006, 'zy', { p: [0.008, 0, -0.1] });
    }],
  ];
  for (const [n, d, tags, f] of misc) add({ id: `head-${n}`, tags, desc: d, classes: [...M, 'weird'], draw: f });
  return out;
}
