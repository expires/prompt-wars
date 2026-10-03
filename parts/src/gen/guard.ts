/** GUARDS: attach to 'guard' on a handle; centred on origin; expose 'blade'/'head' on their -Z face. */
import type { PartDef } from '../types';
import { part, S } from '../lib/define';
import type { Kit, Pt } from '../lib/kit';

const M = ['melee'];

interface G {
  /** crossguard-style geometry modelled along X; rotated so it spans the blade width (Y) */
  spanY?: boolean;
  id: string;
  tags: string[];
  desc: string;
  t?: number;
  classes?: string[];
  draw: (k: Kit) => void;
}

function mk(g: G): PartDef {
  const t = g.t ?? 0.02;
  return part({
    id: g.id,
    category: 'guard',
    classes: g.classes ?? M,
    tags: g.tags,
    desc: g.desc,
    attach: 'guard',
    sockets: { blade: S([0, 0, -t]), head: S([0, 0, -t]), deco: S([0, 0.02, -t / 2]) },
    draw: g.spanY
      ? (k) => {
          g.draw(k);
          k.transformAll({ r: [0, 0, Math.PI / 2] });
        }
      : g.draw,
  });
}

export function guardParts(): PartDef[] {
  const out: PartDef[] = [];
  const add = (g: G) => out.push(mk(g));

  // straight crossguards
  [0.12, 0.18, 0.26].forEach((w, i) =>
    add({
      spanY: true, id: `guard-cross-${['short', 'std', 'wide'][i]}`,
      tags: ['medieval', 'classic'],
      desc: `${['short', 'standard', 'wide'][i]} straight crossguard`,
      draw: (k) => {
        k.box('main', [w, 0.016 + i * 0.002, 0.02], { p: [0, 0, -0.01] });
        k.ball('main', 0.012, [w / 2, 0, -0.01], 0);
        k.ball('main', 0.012, [-w / 2, 0, -0.01], 0);
      },
    }),
  );
  // curved crossguards (in XZ plane curve toward blade / toward hand)
  [1, -1].forEach((dir, i) =>
    add({
      spanY: true, id: `guard-cross-curved-${dir > 0 ? 'forward' : 'back'}`,
      tags: ['medieval', 'fancy'],
      desc: `crossguard with tips curving ${dir > 0 ? 'toward the blade' : 'toward the hand'}`,
      draw: (k) => {
        k.tube('main', [[-0.1, 0, -0.01 - dir * 0.04], [-0.05, 0, -0.01 - dir * 0.008], [0, 0, -0.01], [0.05, 0, -0.01 - dir * 0.008], [0.1, 0, -0.01 - dir * 0.04]], 0.01, 12, 5);
        k.box('main', [0.03, 0.022, 0.024], { p: [0, 0, -0.01] });
        void i;
      },
    }),
  );
  // recurved quillons (S-shape)
  [0.16, 0.22].forEach((w, i) =>
    add({
      spanY: true, id: `guard-quillon-s-${i + 1}`,
      tags: ['medieval', 'ornate'],
      desc: 'S-curved quillon guard',
      draw: (k) => {
        k.tube('main', [[-w / 2, 0, 0.03], [-w / 3, 0, -0.01], [0, 0, -0.01], [w / 3, 0, -0.01], [w / 2, 0, -0.05]], 0.009, 12, 5);
        k.box('main', [0.03, 0.022, 0.024], { p: [0, 0, -0.01] });
      },
    }),
  );
  // discs / tsuba
  [
    ['round', 0.04, 12],
    ['square', 0.042, 4],
    ['oct', 0.042, 8],
  ].forEach(([n, r, seg]) =>
    add({
      id: `guard-tsuba-${n}`,
      tags: ['eastern', 'sleek'],
      desc: `${n} tsuba disc guard`,
      t: 0.012,
      draw: (k) => {
        k.zrod('main', -0.012, 0, r as number, r as number, seg as number);
        k.zrod('brass', -0.014, 0.002, 0.018, 0.018, 8);
      },
    }),
  );
  add({
    id: 'guard-tsuba-flower',
    tags: ['eastern', 'ornate'],
    desc: 'flower-petal tsuba guard',
    t: 0.012,
    draw: (k) => {
      k.zrod('main', -0.012, 0, 0.03, 0.03, 10);
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * Math.PI * 2;
        k.zrod('main', -0.012, 0, 0.014, 0.014, 8, Math.cos(a) * 0.03, Math.sin(a) * 0.03);
      }
    },
  });
  add({
    spanY: true, id: 'guard-ring',
    tags: ['classic', 'fancy'],
    desc: 'crossguard with finger ring',
    draw: (k) => {
      k.box('main', [0.14, 0.014, 0.018], { p: [0, 0, -0.01] });
      k.torus('main', 0.025, 0.005, { p: [0, 0.03, -0.01] }, 4, 10);
    },
  });
  [0.05, 0.065].forEach((r, i) =>
    add({
      spanY: true, id: `guard-shell-${i + 1}`,
      tags: ['classic', 'fancy'],
      desc: 'cup shell guard like a rapier',
      t: 0.03,
      draw: (k) => {
        k.sphere('main', r, { p: [0, 0, 0.0], r: [-Math.PI / 2, 0, 0], s: [1, 0.55, 1] }, 12, 4, Math.PI / 2);
        k.box('main', [0.16, 0.012, 0.012], { p: [0, 0, -0.02] });
      },
    }),
  );
  [0.06, 0.075].forEach((r, i) =>
    add({
      id: `guard-basket-${i + 1}`,
      tags: ['classic', 'ornate', 'heavy'],
      desc: 'caged basket hilt guard',
      t: 0.02,
      draw: (k) => {
        for (let j = 0; j < 6; j++) {
          const a = -Math.PI / 2 + (j / 5) * Math.PI;
          k.tube('main', [[Math.cos(a) * 0.02, Math.sin(a) * 0.02, -0.01], [Math.cos(a) * r, Math.sin(a) * r, 0.04], [Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, 0.12]], 0.004, 8, 3);
        }
        k.zrod('main', -0.02, 0, 0.025, 0.025, 8);
      },
    }),
  );
  add({
    id: 'guard-swept',
    tags: ['classic', 'fancy'],
    desc: 'swept hilt with knuckle bow',
    t: 0.02,
    draw: (k) => {
      k.box('main', [0.16, 0.012, 0.014], { p: [0, 0, -0.01] });
      k.tube('main', [[0.0, 0.0, -0.01], [0, 0.05, 0.03], [0, 0.05, 0.12], [0, 0.02, 0.17]], 0.005, 10, 4);
      k.torus('main', 0.02, 0.004, { p: [0.03, 0, -0.02], r: [0, Math.PI / 2, 0] }, 3, 8);
      k.torus('main', 0.02, 0.004, { p: [-0.03, 0, -0.02], r: [0, Math.PI / 2, 0] }, 3, 8);
    },
  });
  [0.14, 0.2].forEach((w, i) =>
    add({
      spanY: true, id: `guard-spiked-${i + 1}`,
      tags: ['brutal', 'fantasy'],
      desc: 'crossguard with forward spikes',
      draw: (k) => {
        k.box('main', [w, 0.02, 0.022], { p: [0, 0, -0.01] });
        for (const x of [-w / 2, w / 2]) k.rod('main', [x, 0, -0.01], [x * 1.15, 0, -0.07], 0.012, 0, 4);
      },
    }),
  );
  [0.16, 0.22].forEach((w, i) =>
    add({
      spanY: true, id: `guard-winged-${i + 1}`,
      tags: ['fantasy', 'ornate'],
      desc: 'feathered angel wing guard',
      draw: (k) => {
        for (const s of [-1, 1])
          k.extrude('main', [[0, 0], [s * w / 2, 0.04], [s * w * 0.45, 0.0], [s * w * 0.35, -0.02], [s * 0.02, -0.012]], 0.012, 'xy', { p: [0, 0, -0.01] });
        k.ball('accent', 0.014, [0, 0, -0.01], 0);
      },
    }),
  );
  [0.03, 0.045].forEach((r, i) =>
    add({
      id: `guard-emitter-${i + 1}`,
      tags: ['scifi', 'energy'],
      desc: 'laser sword emitter shroud',
      t: 0.03,
      classes: [...M, 'weird'],
      draw: (k) => {
        k.zrod('metal', -0.03, 0, r, r * 0.7, 10);
        k.zrod('glow', -0.032, -0.028, r * 0.6, r * 0.6, 10);
        if (i) for (const x of [-r, r]) k.zrod('dark', -0.03, -0.005, 0.006, 0.006, 4, x, 0);
      },
    }),
  );
  add({
    spanY: true, id: 'guard-toy',
    tags: ['toy', 'silly'],
    classes: [...M, 'weird'],
    desc: 'chunky rounded toy crossguard',
    draw: (k) => {
      k.ball('main', 1, [0, 0, -0.01], 1, [0.08, 0.02, 0.018]);
      k.ball('accent', 0.02, [0.08, 0, -0.01], 1);
      k.ball('accent', 0.02, [-0.08, 0, -0.01], 1);
    },
  });
  add({
    id: 'guard-gear',
    tags: ['steampunk', 'ornate'],
    desc: 'brass cogwheel guard',
    t: 0.012,
    draw: (k) => {
      k.zrod('brass', -0.012, 0, 0.04, 0.04, 12);
      for (let j = 0; j < 10; j++) {
        const a = (j / 10) * Math.PI * 2;
        k.box('brass', [0.012, 0.012, 0.012], { p: [Math.cos(a) * 0.045, Math.sin(a) * 0.045, -0.006], r: [0, 0, a] });
      }
      k.zrod('dark', -0.013, 0.001, 0.012, 0.012, 6);
    },
  });
  add({
    spanY: true, id: 'guard-bone',
    tags: ['organic', 'tribal', 'spooky'],
    desc: 'crossguard made of a rib bone',
    draw: (k) => {
      k.tube('white', [[-0.09, 0.02, -0.01], [-0.04, 0, -0.01], [0.04, 0, -0.01], [0.09, 0.02, -0.01]], 0.01, 10, 5);
      k.ball('white', 0.016, [-0.09, 0.02, -0.01], 0);
      k.ball('white', 0.016, [0.09, 0.02, -0.01], 0);
    },
  });
  [0.13, 0.17].forEach((len, i) =>
    add({
      id: `guard-knucklebow-${i + 1}`,
      tags: ['classic', 'military'],
      desc: 'D-shaped knuckle bow guard',
      draw: (k) => {
        k.box('main', [0.05, 0.014, 0.016], { p: [0, 0, -0.01] });
        k.tube('main', [[0, 0, -0.01], [0, 0.04, 0.01], [0, 0.045, len * 0.6], [0, 0.015, len]], 0.006, 10, 4);
      },
    }),
  );
  [0.035, 0.045].forEach((w, i) =>
    add({
      id: `guard-bolster-${i + 1}`,
      tags: ['modern', 'compact'],
      desc: 'small knife bolster guard',
      t: 0.012,
      draw: (k) => {
        k.box('metal', [0.022, w, 0.012], { p: [0, -w * 0.15, -0.006] });
      },
    }),
  );
  add({
    spanY: true, id: 'guard-dragon',
    tags: ['fantasy', 'ornate'],
    desc: 'dragon-wing crossguard with gem',
    draw: (k) => {
      for (const s of [-1, 1])
        k.extrude('main', [[0, -0.01], [s * 0.05, -0.02], [s * 0.1, 0.03], [s * 0.07, 0.01], [s * 0.05, 0.03], [s * 0.02, 0.01]], 0.014, 'xy', { p: [0, 0, -0.01] });
      k.ball('glow', 0.012, [0, 0, -0.002], 0);
    },
  });
  add({
    id: 'guard-trigger-loop',
    tags: ['silly', 'weird'],
    classes: [...M, 'weird'],
    desc: 'gun trigger guard loop as a sword guard',
    draw: (k) => {
      const outer: Pt[] = [[-0.03, 0.01], [0.03, 0.01], [0.03, -0.04], [-0.03, -0.04]];
      const hole: Pt[] = [[-0.022, 0.0], [0.022, 0.0], [0.022, -0.032], [-0.022, -0.032]];
      k.extrude('main', outer, 0.012, 'xy', { p: [0, 0, -0.008] }, 0, [hole]);
    },
  });
  return out;
}
