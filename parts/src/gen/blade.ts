/** MELEE BLADES: attach to 'blade', extend from origin toward -Z. Width along Y, thickness along X. */
import type { PartDef } from '../types';
import { part, S } from '../lib/define';
import type { Kit, Pt, Slot } from '../lib/kit';

const M = ['melee'];

/** Build a closed outline from top/bottom edge functions of t in [0,1]; u = -t*L. */
function outline(L: number, top: (t: number) => number, bot: (t: number) => number, n = 8, tipPinch = true): Pt[] {
  const up: Pt[] = [];
  const dn: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    up.push([-t * L, top(t)]);
    dn.push([-t * L, bot(t)]);
  }
  if (tipPinch) {
    const tipY = (top(1) + bot(1)) / 2;
    up.pop();
    dn.pop();
    return [...dn, [-L, tipY], ...up.reverse()];
  }
  return [...dn, ...up.reverse()];
}

interface B {
  id: string;
  tags: string[];
  desc: string;
  L: number;
  classes?: string[];
  color?: string;
  draw: (k: Kit) => void;
}

function mk(b: B): PartDef {
  return part({
    id: b.id,
    category: 'blade',
    classes: b.classes ?? M,
    tags: b.tags,
    desc: b.desc,
    attach: 'blade',
    color: b.color,
    sockets: { deco: S([0, 0, -b.L * 0.5], [1, 0, 0]), muzzle: S([0, 0, -b.L]) },
    draw: b.draw,
  });
}

function fuller(k: Kit, L: number, w: number, thick: number, from = 0.05, to = 0.7, y = 0) {
  k.box('dark', [thick * 1.6, w, L * (to - from)], { p: [0, y, -L * (from + to) / 2] });
}

function std(k: Kit, pts: Pt[], thick: number, slot: Slot = 'main') {
  k.blade(slot, pts, thick, 'zy');
}

const LEN_WORDS = ['short', 'standard', 'long', 'great'];

export function bladeParts(): PartDef[] {
  const out: PartDef[] = [];
  const add = (b: B) => out.push(mk(b));

  // longswords
  [0.5, 0.7, 0.9, 1.1].forEach((L, i) =>
    add({
      id: `blade-longsword-${LEN_WORDS[i]}`,
      tags: ['medieval', 'classic'],
      desc: `${LEN_WORDS[i]} straight double-edged sword blade`,
      L,
      draw: (k) => std(k, outline(L, (t) => 0.024 * (1 - t * 0.3), (t) => -0.024 * (1 - t * 0.3), 4), 0.008),
    }),
  );
  // fullered
  [0.6, 0.8, 1.0].forEach((L, i) =>
    add({
      id: `blade-longsword-fullered-${i + 1}`,
      tags: ['medieval', 'classic'],
      desc: 'double-edged sword blade with dark fuller groove',
      L,
      draw: (k) => {
        std(k, outline(L, (t) => 0.026 * (1 - t * 0.35), (t) => -0.026 * (1 - t * 0.35), 4), 0.008);
        fuller(k, L, 0.008, 0.008);
      },
    }),
  );
  // broadswords
  [0.6, 0.8, 1.0].forEach((L, i) =>
    add({
      id: `blade-broadsword-${i + 1}`,
      tags: ['medieval', 'heavy'],
      desc: 'wide heavy broadsword blade',
      L,
      draw: (k) => std(k, outline(L, (t) => (t > 0.9 ? 0.04 * (1 - (t - 0.9) * 6) : 0.04), (t) => (t > 0.9 ? -0.04 * (1 - (t - 0.9) * 6) : -0.04), 10), 0.01),
    }),
  );
  // katana family
  const curved = (L: number, W: number, c: number, slot: Slot = 'main') => (k: Kit) => {
    const spine = (t: number) => W / 2 + c * t * t;
    const pts = outline(L, (t) => spine(t), (t) => spine(t) - W * (t > 0.9 ? 1 - (t - 0.9) * 9 : 1), 10);
    std(k, pts, 0.008, slot);
    k.blade('white', outline(L * 0.95, (t) => spine(t) - W * 0.65, (t) => spine(t) - W * (t > 0.85 ? 0.95 - (t - 0.85) * 5 : 0.95), 8), 0.003, 'zy', { p: [0, 0, -0.005] });
  };
  [
    ['wakizashi', 0.45, 0.03, 0.02],
    ['katana', 0.7, 0.032, 0.035],
    ['katana-long', 0.85, 0.033, 0.045],
    ['nodachi', 1.1, 0.036, 0.06],
  ].forEach(([n, L, W, c]) =>
    add({ id: `blade-${n}`, tags: ['eastern', 'sleek'], desc: `curved single-edge ${String(n).replace('-', ' ')} blade with hamon`, L: L as number, draw: curved(L as number, W as number, c as number) }),
  );
  // scimitars
  [0.55, 0.7, 0.85].forEach((L, i) =>
    add({
      id: `blade-scimitar-${i + 1}`,
      tags: ['desert', 'classic'],
      desc: 'deeply curved scimitar widening toward the tip',
      L,
      draw: (k) => {
        const spine = (t: number) => 0.02 + 0.12 * t * t;
        std(k, outline(L, spine, (t) => spine(t) - (0.035 + 0.03 * Math.sin(t * Math.PI * 0.9)) * (t > 0.92 ? (1 - t) * 12 : 1), 10), 0.008);
      },
    }),
  );
  // sabres
  [0.65, 0.8].forEach((L, i) =>
    add({
      id: `blade-sabre-${i + 1}`,
      tags: ['classic', 'sleek'],
      desc: 'slender gently curved cavalry sabre',
      L,
      draw: (k) => {
        const spine = (t: number) => 0.012 + 0.05 * t * t;
        std(k, outline(L, spine, (t) => spine(t) - 0.024 * (1 - t * 0.6), 8), 0.006);
        fuller(k, L, 0.004, 0.006, 0.05, 0.5, 0.004);
      },
    }),
  );
  // rapiers
  [0.8, 1.0].forEach((L, i) =>
    add({
      id: `blade-rapier-${i + 1}`,
      tags: ['classic', 'sleek', 'fancy'],
      desc: 'thin needle-like rapier blade',
      L,
      draw: (k) => std(k, outline(L, (t) => 0.009 * (1 - t * 0.7), (t) => -0.009 * (1 - t * 0.7), 3), 0.006),
    }),
  );
  // gladius / leaf
  [0.45, 0.55].forEach((L, i) =>
    add({
      id: `blade-gladius-${i + 1}`,
      tags: ['ancient', 'classic'],
      desc: 'wasp-waisted gladius with long point',
      L,
      draw: (k) => {
        const w = (t: number) => (t < 0.75 ? 0.028 - 0.006 * Math.sin((t / 0.75) * Math.PI) : 0.028 * (1 - (t - 0.75) * 4));
        std(k, outline(L, w, (t) => -w(t), 10), 0.009);
      },
    }),
  );
  [0.4, 0.6].forEach((L, i) =>
    add({
      id: `blade-leaf-${i + 1}`,
      tags: ['ancient', 'fantasy'],
      desc: 'leaf-shaped bronze blade',
      L,
      draw: (k) => {
        const w = (t: number) => 0.022 + 0.022 * Math.sin(t * Math.PI * 0.95);
        std(k, outline(L, (t) => w(t) * (t > 0.85 ? (1 - t) * 6.6 : 1), (t) => -w(t) * (t > 0.85 ? (1 - t) * 6.6 : 1), 10), 0.009, 'brass');
      },
    }),
  );
  // flamberge / kris
  [0.9, 1.15].forEach((L, i) =>
    add({
      id: `blade-flamberge-${i + 1}`,
      tags: ['medieval', 'fancy', 'brutal'],
      desc: 'wavy flame-bladed flamberge',
      L,
      draw: (k) => {
        const w = (t: number) => (0.026 + 0.006 * Math.sin(t * Math.PI * 12)) * (t > 0.9 ? (1 - t) * 10 : 1);
        std(k, outline(L, w, (t) => -w(t), 24), 0.008);
      },
    }),
  );
  [0.3, 0.4].forEach((L, i) =>
    add({
      id: `blade-kris-${i + 1}`,
      tags: ['eastern', 'ornate'],
      desc: 'wavy kris dagger blade',
      L,
      draw: (k) => {
        const c = (t: number) => 0.01 * Math.sin(t * Math.PI * 7);
        const w = (t: number) => 0.022 * (1 - t * 0.85);
        std(k, outline(L, (t) => c(t) + w(t), (t) => c(t) - w(t), 21), 0.007);
      },
    }),
  );
  // daggers
  [0.18, 0.24, 0.3].forEach((L, i) =>
    add({
      id: `blade-dagger-${i + 1}`,
      tags: ['classic', 'compact'],
      desc: 'double-edged dagger blade with center ridge',
      L,
      draw: (k) => {
        std(k, outline(L, (t) => 0.022 * (1 - t * 0.8), (t) => -0.022 * (1 - t * 0.8), 3), 0.007);
        k.zrod('metal', -L * 0.9, 0, 0.0, 0.005, 4);
      },
    }),
  );
  // bowie / tanto / combat
  [0.2, 0.28].forEach((L, i) =>
    add({
      id: `blade-bowie-${i + 1}`,
      tags: ['western', 'brutal'],
      desc: 'clip-point bowie knife blade',
      L,
      draw: (k) =>
        std(
          k,
          [
            [0, -0.018],
            [-L * 0.6, -0.02],
            [-L * 0.9, -0.012],
            [-L, 0.006],
            [-L * 0.75, 0.012],
            [-L * 0.65, 0.018],
            [0, 0.018],
          ],
          0.008,
        ),
    }),
  );
  [0.18, 0.26].forEach((L, i) =>
    add({
      id: `blade-tanto-${i + 1}`,
      tags: ['eastern', 'tactical'],
      desc: 'angular tanto-point blade',
      L,
      draw: (k) =>
        std(
          k,
          [
            [0, -0.016],
            [-L * 0.85, -0.016],
            [-L, 0.01],
            [-L, 0.016],
            [0, 0.016],
          ],
          0.008,
        ),
    }),
  );
  [0.22, 0.3].forEach((L, i) =>
    add({
      id: `blade-cleaver-${i + 1}`,
      tags: ['kitchen', 'brutal', 'heavy'],
      desc: 'big rectangular butcher cleaver blade',
      L,
      classes: [...M, 'weird'],
      draw: (k) => {
        std(k, [[0, -0.02], [-L, -0.02], [-L, 0.07], [0, 0.07]].map(([a, b]) => [a, b - 0.04] as Pt), 0.007, 'metal');
        k.rod('dark', [-0.01, 0.015, -L * 0.85], [0.01, 0.015, -L * 0.85], 0.008, 0.008, 8);
      },
    }),
  );
  [0.45, 0.6].forEach((L, i) =>
    add({
      id: `blade-machete-${i + 1}`,
      tags: ['jungle', 'brutal'],
      desc: 'long machete blade widening to a round tip',
      L,
      draw: (k) => std(k, outline(L, (t) => 0.02 + 0.012 * t, (t) => -0.02 - 0.012 * t * (t > 0.9 ? (1 - t) * 10 : 1), 8, true), 0.007),
    }),
  );
  add({
    id: 'blade-karambit',
    tags: ['tactical', 'brutal', 'compact'],
    desc: 'hooked claw karambit blade',
    L: 0.15,
    draw: (k) => {
      const outer: Pt[] = [];
      const inner: Pt[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 0.8;
        const ri = 0.075 + 0.025 * (i / 8);
        outer.push([-Math.sin(a) * 0.1, Math.cos(a) * 0.1 - 0.1 + 0.012]);
        inner.push([-Math.sin(a) * ri, Math.cos(a) * ri - 0.1 + 0.012]);
      }
      std(k, [...outer, ...inner.reverse().slice(1)], 0.007);
    },
  });
  [0.5, 0.65].forEach((L, i) =>
    add({
      id: `blade-falchion-${i + 1}`,
      tags: ['medieval', 'brutal'],
      desc: 'single-edged falchion with clipped wide tip',
      L,
      draw: (k) => std(k, [[0, 0.018], [-L * 0.85, 0.02], [-L, 0.0], [-L * 0.92, -0.05], [-L * 0.5, -0.04], [0, -0.022]], 0.009),
    }),
  );
  add({
    id: 'blade-khopesh',
    tags: ['ancient', 'brutal'],
    desc: 'sickle-shaped khopesh blade',
    L: 0.55,
    draw: (k) => {
      k.zrod('metal', -0.25, 0, 0.01, 0.012, 6);
      const pts: Pt[] = [];
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * 0.1 + (i / 8) * Math.PI * 0.9;
        pts.push([-0.383 + Math.cos(a) * 0.14, -Math.sin(a) * 0.14]);
      }
      for (let i = 8; i >= 0; i--) {
        const a = Math.PI * 0.1 + (i / 8) * Math.PI * 0.9;
        pts.push([-0.383 + Math.cos(a) * 0.1, -Math.sin(a) * 0.1]);
      }
      std(k, pts.map(([u, v]) => [u, v + 0.043] as Pt), 0.008);
    },
  });
  add({
    id: 'blade-zweihander',
    tags: ['medieval', 'heavy'],
    desc: 'huge zweihander blade with ricasso and parry lugs',
    L: 1.3,
    draw: (k) => {
      k.zrod('metal', -0.22, 0, 0.012, 0.012, 6);
      k.rod('metal', [0, 0.05, -0.22], [0, -0.05, -0.22], 0.008, 0.008, 6);
      k.blade('main', outline(1.08, (t) => 0.03 * (1 - t * 0.4), (t) => -0.03 * (1 - t * 0.4), 4), 0.01, 'zy', { p: [0, 0, -0.22] });
    },
  });
  // serrated / saw
  [0.35, 0.55, 0.75].forEach((L, i) =>
    add({
      id: `blade-serrated-${i + 1}`,
      tags: ['brutal', 'military'],
      desc: 'blade with saw-tooth serrated spine',
      L,
      draw: (k) => {
        const pts: Pt[] = [[0, -0.022]];
        pts.push([-L * 0.9, -0.018], [-L, 0.0]);
        const n = Math.round(L / 0.035);
        for (let j = 0; j < n; j++) {
          const u = -L * 0.85 + (j * L * 0.8) / n;
          pts.push([u, 0.024], [u + (L * 0.4) / n, 0.016]);
        }
        pts.push([0, 0.02]);
        std(k, pts, 0.008);
      },
    }),
  );
  add({
    id: 'blade-jagged-1',
    tags: ['brutal', 'spooky', 'fantasy'],
    desc: 'jagged broken-tooth blade',
    L: 0.6,
    draw: (k) => {
      const pts: Pt[] = [[0, -0.025], [-0.15, -0.035], [-0.2, -0.02], [-0.32, -0.04], [-0.38, -0.022], [-0.5, -0.03], [-0.6, 0.0], [-0.45, 0.03], [-0.4, 0.018], [-0.25, 0.04], [-0.2, 0.024], [-0.08, 0.035], [0, 0.025]];
      std(k, pts, 0.01);
    },
  });
  add({
    id: 'blade-jagged-2',
    tags: ['brutal', 'orc', 'heavy'],
    desc: 'crude orcish slab blade with notches',
    L: 0.75,
    draw: (k) => {
      const pts: Pt[] = [[0, -0.03], [-0.3, -0.04], [-0.33, -0.028], [-0.36, -0.045], [-0.7, -0.03], [-0.75, 0.02], [-0.5, 0.045], [-0.2, 0.04], [0, 0.03]];
      std(k, pts, 0.014, 'metal');
    },
  });
  // chainsaw
  [0.45, 0.65].forEach((L, i) =>
    add({
      id: `blade-chainsaw-${i + 1}`,
      tags: ['brutal', 'industrial', 'heavy'],
      desc: 'chainsaw bar with teeth and motor',
      L,
      classes: [...M, 'weird'],
      draw: (k) => {
        k.box('accent', [0.07, 0.09, 0.12], { p: [0, 0.01, -0.06] });
        k.extrude('metal', [[-0.12, -0.03], [-L, -0.03], [-L - 0.03, 0], [-L, 0.03], [-0.12, 0.03]], 0.008, 'zy');
        const n = Math.round(L / 0.035);
        for (let j = 0; j < n; j++) {
          const u = -0.14 - j * ((L - 0.14) / n);
          k.box('dark', [0.012, 0.01, 0.01], { p: [0, 0.034, u], r: [0.5, 0, 0] });
          k.box('dark', [0.012, 0.01, 0.01], { p: [0, -0.034, u], r: [-0.5, 0, 0] });
        }
      },
    }),
  );
  // energy blades
  [0.6, 0.8, 1.0].forEach((L, i) =>
    add({
      id: `blade-energy-${LEN_WORDS[i]}`,
      tags: ['scifi', 'energy'],
      desc: `${LEN_WORDS[i]} glowing laser sword beam`,
      L,
      classes: [...M, 'weird'],
      draw: (k) => {
        k.zrod('glow', -L + 0.02, 0, 0.016, 0.016, 8);
        k.sphere('glow', 0.016, { p: [0, 0, -L + 0.02], r: [-Math.PI / 2, 0, 0] }, 8, 3, Math.PI / 2);
        k.zrod('white', -L + 0.04, 0, 0.008, 0.008, 6);
      },
    }),
  );
  // crystal / bone / wood / toy
  [0.5, 0.7].forEach((L, i) =>
    add({
      id: `blade-crystal-${i + 1}`,
      tags: ['fantasy', 'magic'],
      desc: 'faceted glowing crystal blade',
      L,
      draw: (k) => {
        k.zrod('glow', -L * 0.8, 0, 0.034, 0.02, 4);
        k.zrod('glow', -L, -L * 0.8, 0.0, 0.034, 4);
        k.zrod('accent', -L * 0.4, -0.05, 0.0, 0.02, 3, 0.02, 0.02);
      },
    }),
  );
  [0.4, 0.55].forEach((L, i) =>
    add({
      id: `blade-bone-${i + 1}`,
      tags: ['organic', 'tribal', 'spooky'],
      desc: 'jagged bone blade with knobby ridges',
      L,
      draw: (k) => {
        const w = (t: number) => 0.026 * (1 - t * 0.85) + 0.004 * Math.sin(t * 20);
        std(k, outline(L, w, (t) => -w(t), 12), 0.012, 'white');
        for (let j = 0; j < 3; j++) k.ball('white', 0.008, [0, 0.02, -L * (0.2 + j * 0.2)], 0);
      },
    }),
  );
  [0.6, 0.8].forEach((L, i) =>
    add({
      id: `blade-wooden-${i + 1}`,
      tags: ['wood', 'training'],
      desc: 'wooden training sword blade',
      L,
      draw: (k) => {
        k.extrude('wood', outline(L, (t) => 0.022 * (t > 0.92 ? (1 - t) * 12 : 1), (t) => -0.022 * (t > 0.92 ? (1 - t) * 12 : 1), 6), 0.016, 'zy', undefined, 0.004);
      },
    }),
  );
  [0.5, 0.7].forEach((L, i) =>
    add({
      id: `blade-foam-${i + 1}`,
      tags: ['toy', 'silly'],
      desc: 'fat rounded foam toy sword blade',
      L,
      classes: [...M, 'weird'],
      draw: (k) => {
        k.zrod('main', -L + 0.03, 0, 0.03, 0.03, 8);
        k.sphere('main', 0.03, { p: [0, 0, -L + 0.03], r: [-Math.PI / 2, 0, 0] }, 8, 3, Math.PI / 2);
        for (let j = 0; j < 3; j++) k.zrod('accent', -0.1 - j * L * 0.25, -0.08 - j * L * 0.25, 0.031, 0.031, 8);
      },
    }),
  );
  // silly blades
  [0.5, 0.7].forEach((L, i) =>
    add({
      id: `blade-baguette-${i + 1}`,
      tags: ['silly', 'food', 'french'],
      desc: 'crusty baguette as a sword blade',
      L,
      classes: [...M, 'weird'],
      color: '#d4a055',
      draw: (k) => {
        k.ball('#d4a055', 1, [0, 0, -L / 2], 1, [0.03, 0.028, L / 2]);
        for (let j = 0; j < 5; j++) k.box('#a8692e', [0.01, 0.004, 0.05], { p: [0, 0.026, -L * 0.15 - j * L * 0.16], r: [0, 0.6, 0] });
      },
    }),
  );
  const silly: [string, string, number, (k: Kit) => void][] = [
    ['fish', 'big floppy fish as a blade', 0.5, (k) => {
      k.ball('#7fb3d5', 1, [0, 0, -0.25], 1, [0.02, 0.06, 0.2]);
      k.extrude('#7fb3d5', [[0, 0], [-0.06, 0.05], [-0.06, -0.05]], 0.008, 'zy', { p: [0, 0, -0.03] });
      k.ball('white', 0.012, [0.015, 0.02, -0.4], 0);
      k.ball('#111111', 0.006, [0.022, 0.02, -0.405], 0);
    }],
    ['ruler', 'wooden ruler blade with inch marks', 0.45, (k) => {
      k.box('wood', [0.006, 0.04, 0.45], { p: [0, 0, -0.225] });
      for (let j = 0; j < 12; j++) k.box('dark', [0.007, j % 3 ? 0.008 : 0.016, 0.002], { p: [0, 0.016 - (j % 3 ? 0.004 : 0), -0.02 - j * 0.035] });
    }],
    ['cucumber', 'cucumber blade with bumpy skin', 0.4, (k) => {
      k.ball('#3d8b3d', 1, [0, 0, -0.2], 1, [0.025, 0.025, 0.2]);
      for (let j = 0; j < 6; j++) k.ball('#2c6b2c', 0.005, [0.018 * Math.cos(j * 2), 0.018 * Math.sin(j * 2), -0.06 - j * 0.05], 0);
    }],
    ['candycane', 'striped candy cane sword', 0.6, (k) => {
      k.zrod('white', -0.5, 0, 0.016, 0.016, 8);
      for (let j = 0; j < 8; j++) k.zrod('#d62828', -0.02 - j * 0.06, -0.0 - j * 0.06, 0.017, 0.017, 8);
      k.torus('#d62828', 0.05, 0.016, { p: [0, 0.05, -0.5], r: [0, Math.PI / 2, 0] }, 5, 8, Math.PI);
    }],
    ['umbrella', 'closed umbrella as a rapier', 0.7, (k) => {
      k.zrod('main', -0.6, 0, 0.006, 0.03, 8);
      k.zrod('metal', -0.7, -0.6, 0.0, 0.004, 5);
      k.zrod('accent', -0.25, -0.2, 0.026, 0.026, 8);
    }],
    ['feather', 'giant tickle feather blade', 0.6, (k) => {
      k.zrod('white', -0.6, 0, 0.0, 0.004, 4);
      std(k, outline(0.58, (t) => 0.05 * Math.sin(t * Math.PI) + 0.004, (t) => -0.04 * Math.sin(t * Math.PI) - 0.004, 10), 0.003, 'main');
    }],
    ['icicle', 'frozen icicle blade', 0.55, (k) => {
      k.zrod('glow', -0.55, 0, 0.0, 0.03, 6);
      k.zrod('#cfefff', -0.3, -0.02, 0.0, 0.015, 5, 0.018, 0.0);
    }],
    ['lightning', 'zig-zag lightning bolt blade', 0.6, (k) => {
      std(k, [[0, -0.02], [-0.2, -0.03], [-0.18, 0.0], [-0.4, -0.03], [-0.6, 0.02], [-0.36, 0.01], [-0.38, 0.04], [-0.16, 0.03], [-0.14, 0.02], [0, 0.02]], 0.01, 'glow');
    }],
    ['keyboard', 'computer keyboard as a blade', 0.45, (k) => {
      k.box('main', [0.02, 0.12, 0.45], { p: [0, 0, -0.225] });
      for (let j = 0; j < 8; j++) for (let m = 0; m < 3; m++) k.box('white', [0.008, 0.024, 0.04], { p: [0.012, -0.035 + m * 0.035, -0.04 - j * 0.052] });
    }],
    ['handsaw', 'carpenter hand saw blade', 0.45, (k) => {
      const pts: Pt[] = [[0, 0.04], [-0.45, 0.015]];
      for (let j = 0; j < 14; j++) {
        const u = -0.45 + j * 0.032;
        pts.push([u, -0.02 - j * 0.0035], [u + 0.016, -0.03 - j * 0.0035]);
      }
      pts.push([0, -0.07]);
      k.extrude('metal', pts, 0.003, 'zy');
    }],
    ['hooksword', 'hook sword with curled tip', 0.7, (k) => {
      std(k, outline(0.6, () => 0.016, () => -0.016, 2, false), 0.007);
      k.torus('main', 0.05, 0.012, { p: [0, 0.05, -0.6], r: [0, Math.PI / 2, 0] }, 4, 10, Math.PI);
    }],
    ['guitar-neck', 'electric guitar neck as a blade', 0.55, (k) => {
      k.box('wood', [0.016, 0.045, 0.45], { p: [0, 0, -0.225] });
      k.box('dark', [0.02, 0.07, 0.1], { p: [0, 0.01, -0.5] });
      for (let j = 0; j < 6; j++) k.zrod('metal', -0.45, 0, 0.001, 0.001, 3, 0.009, -0.015 + j * 0.006);
    }],
  ];
  for (const [n, d, L, f] of silly) add({ id: `blade-${n}`, tags: ['silly', 'weird'], desc: d, L, classes: [...M, 'weird'], draw: f });
  return out;
}
