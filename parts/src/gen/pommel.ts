/** POMMELS: attach to 'pommel' at the butt of a handle, extend toward +Z. */
import type { PartDef } from '../types';
import { part } from '../lib/define';
import type { Kit } from '../lib/kit';

const M = ['melee'];

function mk(id: string, tags: string[], desc: string, draw: (k: Kit) => void, classes = M): PartDef {
  return part({ id, category: 'pommel', classes, tags, desc, attach: 'pommel', sockets: {}, draw });
}

export function pommelParts(): PartDef[] {
  const out: PartDef[] = [];
  [0.018, 0.026].forEach((r, i) =>
    out.push(mk(`pommel-ball-${i ? 'big' : 'small'}`, ['medieval', 'classic'], `${i ? 'big' : 'small'} round ball pommel`, (k) => k.ball('main', r, [0, 0, r * 0.9], 1))),
  );
  [0.025, 0.035].forEach((r, i) =>
    out.push(
      mk(`pommel-disc-${i + 1}`, ['medieval', 'classic'], 'flat wheel disc pommel', (k) => {
        k.zrod('main', 0, 0.018, r, r, 12);
        k.zrod('accent', -0.001, 0.019, r * 0.4, r * 0.4, 8);
      }),
    ),
  );
  out.push(
    mk('pommel-scentstopper', ['medieval', 'ornate'], 'scent-stopper bottle pommel', (k) =>
      k.zlathe('main', [[0.012, 0], [0.02, 0.012], [0.012, 0.024], [0.016, 0.034], [0.0, 0.05]], 8),
    ),
  );
  [0.02, 0.028].forEach((r, i) =>
    out.push(
      mk(`pommel-gem-${i + 1}`, ['fantasy', 'magic'], 'faceted glowing gem pommel in a cup', (k) => {
        k.zrod('brass', 0, 0.01, 0.014, r * 0.9, 8);
        k.ball('glow', r * 0.8, [0, 0, 0.01 + r * 0.6], 0);
      }),
    ),
  );
  [0.04, 0.07].forEach((L, i) =>
    out.push(
      mk(`pommel-spike-${i + 1}`, ['brutal', 'medieval'], 'spiked pommel for skull-cracking', (k) => {
        k.zrod('main', 0, 0.01, 0.016, 0.016, 6);
        k.zrod('metal', 0.01, 0.01 + L, 0.014, 0.0, 4);
      }),
    ),
  );
  [0.016, 0.024].forEach((r, i) =>
    out.push(
      mk(`pommel-ring-${i + 1}`, ['eastern', 'classic'], 'open ring pommel', (k) => {
        k.zrod('main', 0, 0.008, 0.014, 0.014, 6);
        k.torus('main', r, 0.005, { p: [0, 0, 0.008 + r], r: [0, Math.PI / 2, 0] }, 4, 10);
      }),
    ),
  );
  out.push(
    mk('pommel-fishtail', ['ancient', 'classic'], 'flared fishtail pommel', (k) =>
      k.extrude('main', [[-0.012, 0], [0.012, 0], [0.03, 0.035], [0, 0.025], [-0.03, 0.035]], 0.02, 'xz', { r: [-Math.PI, 0, 0] }, 0.002),
    ),
    mk('pommel-wheel-spoked', ['medieval', 'ornate'], 'spoked wheel pommel', (k) => {
      k.torus('main', 0.025, 0.006, { p: [0, 0, 0.03], r: [0, Math.PI / 2, 0] }, 4, 12);
      k.rod('main', [0, -0.025, 0.03], [0, 0.025, 0.03], 0.004, 0.004, 4);
      k.rod('main', [0, 0, 0.005], [0, 0, 0.055], 0.004, 0.004, 4);
    }),
    mk('pommel-skull', ['spooky', 'fantasy'], 'tiny grinning skull pommel', (k) => {
      k.ball('white', 0.022, [0, 0.004, 0.024], 1);
      k.box('white', [0.022, 0.014, 0.016], { p: [0, -0.014, 0.026] });
      k.ball('#111111', 0.006, [0.009, 0.006, 0.042], 0);
      k.ball('#111111', 0.006, [-0.009, 0.006, 0.042], 0);
    }),
    mk('pommel-crescent', ['fantasy', 'eastern'], 'crescent moon pommel', (k) =>
      k.torus('main', 0.024, 0.006, { p: [0, 0, 0.022], r: [0, Math.PI / 2, -Math.PI / 2] }, 4, 10, Math.PI * 1.2),
    ),
    mk('pommel-mushroom', ['medieval', 'classic'], 'mushroom cap pommel', (k) =>
      k.zlathe('main', [[0.01, 0], [0.012, 0.01], [0.03, 0.016], [0.026, 0.026], [0.0, 0.032]], 10),
    ),
    mk('pommel-lanyard', ['modern', 'tactical'], 'lanyard loop with paracord', (k) => {
      k.zrod('dark', 0, 0.012, 0.012, 0.01, 6);
      k.torus('#3a7bd5', 0.012, 0.003, { p: [0, 0, 0.024], r: [0, Math.PI / 2, 0] }, 3, 8);
    }),
  );
  [0.022, 0.03].forEach((r, i) =>
    out.push(mk(`pommel-cap-${i + 1}`, ['sport', 'modern'], 'rounded end cap knob', (k) => k.zlathe('main', [[0.012, 0], [r, 0.006], [r, 0.014], [0, 0.018]], 10))),
  );
  out.push(
    mk('pommel-glow-orb', ['scifi', 'magic'], 'glowing orb in a claw cage', (k) => {
      k.ball('glow', 0.018, [0, 0, 0.024], 1);
      for (let j = 0; j < 3; j++) {
        const a = (j / 3) * Math.PI * 2;
        k.tube('main', [[0, 0, 0], [Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0.018], [Math.cos(a) * 0.008, Math.sin(a) * 0.008, 0.042]], 0.003, 6, 3);
      }
    }),
    mk('pommel-gear', ['steampunk'], 'small brass gear pommel', (k) => {
      k.zrod('brass', 0, 0.012, 0.02, 0.02, 10);
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2;
        k.box('brass', [0.008, 0.008, 0.012], { p: [Math.cos(a) * 0.023, Math.sin(a) * 0.023, 0.006], r: [0, 0, a] });
      }
    }),
    mk('pommel-duck', ['silly', 'toy'], 'rubber duck head pommel', (k) => {
      k.ball('#ffd23f', 0.022, [0, 0.0, 0.024], 1);
      k.extrude('#ff8c1a', [[0, 0], [0.018, -0.004], [0.018, 0.006], [0, 0.01]], 0.014, 'xy', { p: [0, 0, 0.03], r: [0, -Math.PI / 2, 0] });
      k.ball('#111111', 0.004, [0.012, 0.01, 0.038], 0);
      k.ball('#111111', 0.004, [-0.012, 0.01, 0.038], 0);
    }, [...M, 'weird']),
    mk('pommel-dice', ['silly'], 'fuzzy dice pommel', (k) => {
      k.box('white', [0.026, 0.026, 0.026], { p: [0, 0, 0.016], r: [0.3, 0.4, 0] });
      k.ball('#111111', 0.004, [0, 0, 0.032], 0);
    }, [...M, 'weird']),
    mk('pommel-cube', ['scifi', 'modern'], 'faceted cube pommel', (k) => k.box('main', [0.026, 0.026, 0.026], { p: [0, 0, 0.015], r: [0, 0, Math.PI / 4] })),
    mk('pommel-crown', ['fancy', 'fantasy'], 'tiny golden crown pommel', (k) => {
      k.zrod('brass', 0, 0.014, 0.02, 0.02, 8, 0, 0);
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * Math.PI * 2;
        k.rod('brass', [Math.cos(a) * 0.018, Math.sin(a) * 0.018, 0.014], [Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0.03], 0.005, 0, 4);
      }
    }),
  );
  return out;
}
