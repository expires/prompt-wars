/**
 * DECO / TRIM / SILLY: most attach to 'deco' (falls back to top/side) and sit on +Y.
 * Stickers attach to 'side' and face +X.
 */
import type { PartDef } from '../types';
import { part } from '../lib/define';
import { type Kit, type Pt, type Slot, circlePts, heartPts, starPts } from '../lib/kit';

const ALL = [
  'pistol',
  'smg',
  'rifle',
  'shotgun',
  'sniper',
  'lmg',
  'rocket_launcher',
  'grenade_launcher',
  'flamethrower',
  'bubble_gun',
  'blowgun',
  'crossbow',
  'melee',
  'weird',
];

function mk(id: string, tags: string[], desc: string, draw: (k: Kit) => void, attach = 'deco', classes = ALL): PartDef {
  return part({ id, category: 'deco', classes, tags, desc, attach, sockets: {}, draw });
}

/** Sticker: thin plate facing +X (shape drawn in (z,y)). */
function sticker(id: string, desc: string, pts: Pt[], slot: Slot = 'accent', extra?: (k: Kit) => void): PartDef {
  return mk(
    `deco-sticker-${id}`,
    ['sticker', 'silly'],
    desc,
    (k) => {
      k.extrude(slot, pts, 0.002, 'zy', { p: [0.001, 0, 0] });
      extra?.(k);
    },
    'side',
  );
}

export function decoParts(): PartDef[] {
  const out: PartDef[] = [];

  // stickers
  out.push(
    sticker('star', 'star sticker decal', starPts(0.025, 0.011, 5), '#ffd23f'),
    sticker('heart', 'heart sticker decal', heartPts(0.022), '#ff4f9a'),
    sticker('lightning', 'lightning bolt sticker decal', [[0.012, 0.025], [-0.008, 0.002], [0.002, 0.002], [-0.012, -0.025], [0.008, -0.002], [-0.002, -0.002]], '#ffd23f'),
    sticker('smiley', 'yellow smiley face sticker', circlePts(0.022, 12), '#ffd23f', (k) => {
      k.box('#111111', [0.003, 0.006, 0.004], { p: [0.002, 0.006, -0.007] });
      k.box('#111111', [0.003, 0.006, 0.004], { p: [0.002, 0.006, 0.007] });
      k.box('#111111', [0.003, 0.003, 0.016], { p: [0.002, -0.008, 0] });
    }),
    sticker('flame', 'hot-rod flame sticker', [[0.03, -0.01], [-0.03, -0.01], [-0.02, 0.0], [-0.03, 0.012], [-0.01, 0.004], [0.0, 0.016], [0.006, 0.004], [0.02, 0.012], [0.012, 0.0]], '#ff6b1a'),
    sticker('number7', 'racing number 7 roundel', circlePts(0.022, 12), 'white', (k) => {
      k.extrude('#111111', [[-0.008, 0.012], [0.01, 0.012], [0.01, 0.008], [0.0, -0.014], [-0.004, -0.014], [0.005, 0.008], [-0.008, 0.008]], 0.002, 'zy', { p: [0.0025, 0, 0] });
    }),
    sticker('warning', 'yellow hazard triangle sticker', [[0.024, -0.02], [-0.024, -0.02], [0, 0.022]], '#ffd23f', (k) => {
      k.box('#111111', [0.003, 0.016, 0.004], { p: [0.002, 0.0, 0] });
    }),
    sticker('stripes', 'racing stripe pair decal', [[0.08, 0.004], [-0.08, 0.004], [-0.08, 0.012], [0.08, 0.012]], 'white', (k) => {
      k.extrude('white', [[0.08, -0.012], [-0.08, -0.012], [-0.08, -0.004], [0.08, -0.004]], 0.002, 'zy', { p: [0.001, 0, 0] });
    }),
  );
  out.push(
    sticker('skull', 'skull and crossbones sticker', circlePts(0.014, 10, 0, 0.006), 'white', (k) => {
      k.box('white', [0.002, 0.008, 0.014], { p: [0.001, -0.009, 0] });
      k.box('#111111', [0.003, 0.005, 0.005], { p: [0.002, 0.007, -0.005] });
      k.box('#111111', [0.003, 0.005, 0.005], { p: [0.002, 0.007, 0.005] });
      k.box('white', [0.002, 0.005, 0.05], { p: [0.0005, -0.006, 0], r: [0.6, 0, 0] });
      k.box('white', [0.002, 0.005, 0.05], { p: [0.0005, -0.006, 0], r: [-0.6, 0, 0] });
    }),
  );

  const duck = (s: number) => (k: Kit) => {
    k.ball('#ffd23f', 1, [0, 0.025 * s, 0.005 * s], 1, [0.026 * s, 0.022 * s, 0.034 * s]);
    k.ball('#ffd23f', 0.017 * s, [0, 0.055 * s, -0.016 * s], 1);
    k.extrude('#ff8c1a', [[0, 0], [-0.018 * s, 0.002 * s], [-0.02 * s, 0.008 * s], [0, 0.012 * s]], 0.014 * s, 'zy', { p: [0, 0.048 * s, -0.028 * s] });
    k.ball('#111111', 0.003 * s, [0.01 * s, 0.062 * s, -0.028 * s], 0);
    k.ball('#111111', 0.003 * s, [-0.01 * s, 0.062 * s, -0.028 * s], 0);
    k.extrude('#ffd23f', [[0, 0], [0.025 * s, 0.01 * s], [0.02 * s, 0.03 * s]], 0.008 * s, 'zy', { p: [0, 0.025 * s, 0.03 * s] });
  };
  out.push(
    mk('deco-rubber-duck', ['silly', 'toy', 'cute'], 'little yellow rubber duck', duck(1)),
    mk('deco-rubber-duck-big', ['silly', 'toy', 'cute'], 'big yellow rubber duck', duck(1.8)),
  );
  [0.05, 0.09].forEach((h, i) =>
    out.push(
      mk(`deco-candle-${i + 1}`, ['silly', 'spooky', 'cozy'], `${i ? 'tall' : 'short'} lit candle with drips`, (k) => {
        k.rod('white', [0, 0, 0], [0, h, 0], 0.01, 0.01, 8);
        k.ball('white', 0.004, [0.009, h * 0.8, 0], 0);
        k.rod('#111111', [0, h, 0], [0, h + 0.006, 0], 0.001, 0.001, 3);
        k.lathe('glow', [[0.0, 0], [0.005, 0.006], [0.003, 0.014], [0, 0.02]], 6, { p: [0, h + 0.004, 0] });
      }),
    ),
  );
  // antennas
  out.push(
    mk('deco-antenna-whip', ['military', 'scifi'], 'tall thin whip antenna', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.012, 0], 0.006, 0.006, 6);
      k.rod('dark', [0, 0.012, 0], [0, 0.2, 0.01], 0.0018, 0.001, 3);
    }),
    mk('deco-antenna-ball', ['toy', 'retro', 'scifi'], 'springy antenna with ball tip', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.1, 0], 0.0025, 0.0025, 4);
      k.ball('accent', 0.012, [0, 0.1, 0], 1);
    }),
    mk('deco-antenna-dish', ['scifi', 'military'], 'tiny radar dish on a post', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.03, 0], 0.003, 0.003, 4);
      k.sphere('main', 0.025, { p: [0, 0.04, 0], r: [-2.2, 0, 0] }, 10, 3, Math.PI / 2.5);
      k.rod('dark', [0, 0.04, 0], [0, 0.045, -0.02], 0.0015, 0.0015, 3);
    }),
  );
  // LEDs
  [6, 10].forEach((n, i) =>
    out.push(
      mk(`deco-led-strip-${n}`, ['scifi', 'gamer'], `strip of ${n} glowing LEDs`, (k) => {
        k.box('dark', [0.012, 0.004, n * 0.012], { p: [0, 0.002, 0] });
        for (let j = 0; j < n; j++) k.box('glow', [0.007, 0.004, 0.007], { p: [0, 0.006, -n * 0.006 + 0.006 + j * 0.012] });
        void i;
      }),
    ),
  );
  out.push(
    mk('deco-led-cluster', ['scifi', 'gamer'], 'triangle cluster of glowing LEDs', (k) => {
      for (const [x, z] of [[0, -0.008], [0.008, 0.006], [-0.008, 0.006]]) k.sphere('glow', 0.005, { p: [x, 0, z] }, 6, 3, Math.PI / 2);
    }),
  );
  // fins
  out.push(
    mk('deco-fin-shark', ['silly', 'nautical'], 'shark fin sticking up', (k) => k.extrude('main', [[0.04, 0], [-0.03, 0], [-0.04, 0.06], [-0.01, 0.03]], 0.008, 'zy', undefined, 0.002)),
    mk('deco-fin-tail', ['retro', 'scifi'], 'swept retro rocket tail fin', (k) => k.extrude('accent', [[0.05, 0], [-0.02, 0], [-0.06, 0.05], [-0.03, 0.05]], 0.006, 'zy', undefined, 0.002)),
    mk('deco-fin-dorsal-row', ['organic', 'fantasy'], 'row of spiny dorsal fins', (k) => {
      for (let j = 0; j < 4; j++) k.extrude('accent', [[0.02, 0], [-0.02, 0], [-0.025, 0.03 - j * 0.004]], 0.004, 'zy', { p: [0, 0, -0.06 + j * 0.04] });
    }),
  );
  // spikes
  [
    ['short', 0.02, 5],
    ['long', 0.045, 4],
    ['mohawk', 0.035, 7],
  ].forEach(([n, h, c]) =>
    out.push(
      mk(`deco-spikes-${n}`, ['brutal', 'punk'], `row of ${n} metal spikes`, (k) => {
        const cnt = c as number;
        for (let j = 0; j < cnt; j++) {
          const z = (j - (cnt - 1) / 2) * 0.022;
          const hh = n === 'mohawk' ? (h as number) * (1 - Math.abs(j - (cnt - 1) / 2) / cnt) : (h as number);
          k.rod(n === 'mohawk' ? 'accent' : 'metal', [0, 0, z], [0, hh, z + (n === 'mohawk' ? 0.01 : 0)], 0.007, 0, 5);
        }
      }),
    ),
  );
  // googly eyes
  [0.012, 0.022].forEach((r, i) =>
    out.push(
      mk(`deco-googly-eyes-${i ? 'big' : 'small'}`, ['silly', 'cute'], `${i ? 'big' : 'small'} pair of googly eyes`, (k) => {
        for (const z of [-r * 1.1, r * 1.1]) {
          k.rod('white', [0, 0, z], [0, 0.006, z], r, r, 10);
          k.rod('#111111', [r * 0.3, 0.006, z + r * 0.2], [r * 0.3, 0.008, z + r * 0.2], r * 0.5, r * 0.5, 8);
        }
      }),
    ),
  );
  out.push(
    mk('deco-plushie-bear', ['silly', 'cute', 'toy'], 'tiny teddy bear plushie riding along', (k) => {
      k.ball('#a0703c', 1, [0, 0.022, 0], 1, [0.018, 0.022, 0.015]);
      k.ball('#a0703c', 0.016, [0, 0.055, 0], 1);
      k.ball('#a0703c', 0.006, [0.012, 0.068, 0], 0);
      k.ball('#a0703c', 0.006, [-0.012, 0.068, 0], 0);
      k.ball('#d9b48a', 0.006, [0, 0.052, -0.014], 0);
      for (const x of [-0.016, 0.016]) k.ball('#a0703c', 0.007, [x, 0.03, -0.006], 0);
      k.ball('#111111', 0.0025, [0.006, 0.06, -0.014], 0);
      k.ball('#111111', 0.0025, [-0.006, 0.06, -0.014], 0);
    }),
    mk('deco-fish', ['silly', 'organic'], 'little orange fish on top', (k) => {
      k.ball('#ff8c1a', 1, [0, 0.016, 0], 1, [0.008, 0.016, 0.03]);
      k.extrude('#ff8c1a', [[0, 0], [0.02, 0.014], [0.02, -0.014]], 0.004, 'zy', { p: [0, 0.016, 0.026] });
      k.ball('#111111', 0.003, [0.007, 0.02, -0.02], 0);
    }),
    mk('deco-banana', ['silly', 'food'], 'ripe curved banana', (k) => {
      const pts: [number, number, number][] = [];
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        pts.push([0, 0.01 + Math.sin(t * Math.PI) * 0.025, -0.06 + t * 0.12]);
      }
      k.tube('#ffd23f', pts, 0.012, 10, 5);
      k.rod('#5a3d1e', [0, 0.012, 0.06], [0, 0.016, 0.07], 0.004, 0.003, 4);
    }),
    mk('deco-traffic-cone', ['silly', 'improvised'], 'small orange traffic cone', (k) => {
      k.box('#ff6b1a', [0.04, 0.006, 0.04], { p: [0, 0.003, 0] });
      k.rod('#ff6b1a', [0, 0.006, 0], [0, 0.06, 0], 0.016, 0.003, 8);
      k.rod('white', [0, 0.026, 0], [0, 0.036, 0], 0.011, 0.009, 8);
    }),
    mk('deco-propeller', ['silly', 'toy'], 'spinning beanie propeller', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.02, 0], 0.003, 0.003, 4);
      k.box('accent', [0.08, 0.003, 0.014], { p: [0, 0.022, 0], r: [0.2, 0, 0] });
      k.box('main', [0.014, 0.003, 0.08], { p: [0, 0.022, 0], r: [0, 0, 0.2] });
      k.ball('#d62828', 0.005, [0, 0.025, 0], 0);
    }),
    mk('deco-flag-pennant', ['silly', 'festive'], 'triangular pennant flag on pole', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.1, 0], 0.002, 0.002, 4);
      k.extrude('accent', [[0, 0.1], [0, 0.07], [0.05, 0.085]], 0.002, 'zy');
    }),
    mk('deco-flag-banner', ['military', 'medieval'], 'rectangular banner flag on pole', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.13, 0], 0.002, 0.002, 4);
      k.extrude('accent', [[0, 0.13], [0, 0.08], [0.07, 0.08], [0.06, 0.105], [0.07, 0.13]], 0.002, 'zy');
    }),
    mk('deco-bike-horn', ['silly', 'toy'], 'honking bike horn with rubber bulb', (k) => {
      k.zlathe('brass', [[0.003, 0], [0.004, -0.04], [0.02, -0.06], [0.018, -0.062]], 8, [0, 0.015, 0]);
      k.ball('#d62828', 0.016, [0, 0.015, 0.012], 1);
    }),
    mk('deco-bell', ['silly', 'festive'], 'little jingle bell', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.008, 0], 0.002, 0.002, 3);
      k.lathe('brass', [[0, 0.03], [0.008, 0.028], [0.012, 0.016], [0.016, 0.006], [0, 0.006]], 8, {});
      k.ball('dark', 0.004, [0, 0.005, 0], 0);
    }),
    mk('deco-dice', ['silly', 'retro'], 'pair of fuzzy dice', (k) => {
      k.rod('white', [0, 0, 0], [0, 0.02, 0], 0.001, 0.001, 3);
      k.box('white', [0.018, 0.018, 0.018], { p: [-0.012, 0.03, 0], r: [0.3, 0.5, 0.2] });
      k.box('#d62828', [0.018, 0.018, 0.018], { p: [0.012, 0.028, 0], r: [-0.2, 0.3, 0.5] });
    }),
    mk('deco-keychain', ['silly', 'cute'], 'dangling keychain charm with star', (k) => {
      k.torus('metal', 0.008, 0.0015, { p: [0, 0.006, 0], r: [0, Math.PI / 2, 0] }, 3, 8);
      k.rod('metal', [0, 0, 0], [0, -0.02, 0], 0.001, 0.001, 3);
      k.extrude('accent', starPts(0.012, 0.005, 5), 0.004, 'zy', { p: [0, -0.03, 0] });
    }),
  );
  [0.02, 0.032].forEach((r, i) =>
    out.push(
      mk(`deco-gear-${i ? 'big' : 'small'}`, ['steampunk', 'ornate'], `${i ? 'big' : 'small'} brass cog gear`, (k) => {
        k.rod('brass', [0, 0, 0], [0, 0.006, 0], r, r, 10);
        const n = 8 + i * 4;
        for (let j = 0; j < n; j++) {
          const a = (j / n) * Math.PI * 2;
          k.box('brass', [0.006, 0.006, 0.006], { p: [Math.cos(a) * (r + 0.002), 0.003, Math.sin(a) * (r + 0.002)], r: [0, -a, 0] });
        }
        k.rod('dark', [0, 0.006, 0], [0, 0.008, 0], r * 0.3, r * 0.3, 6);
      }),
    ),
  );
  out.push(
    mk('deco-pipes', ['steampunk', 'industrial'], 'bent copper pipes with valve wheel', (k) => {
      k.tube('#b87333', [[0, 0, -0.05], [0, 0.02, -0.04], [0, 0.02, 0.04], [0, 0, 0.05]], 0.005, 10, 4);
      k.torus('#d62828', 0.01, 0.002, { p: [0, 0.03, 0], r: [Math.PI / 2, 0, 0] }, 3, 8);
      k.rod('#b87333', [0, 0.02, 0], [0, 0.03, 0], 0.002, 0.002, 3);
    }),
    mk('deco-rivet-strip', ['steampunk', 'industrial', 'heavy'], 'plate with a row of rivets', (k) => {
      k.box('main', [0.02, 0.004, 0.1], { p: [0, 0.002, 0] });
      for (let j = 0; j < 6; j++) k.ball('metal', 0.003, [0, 0.004, -0.04 + j * 0.016], 0);
    }),
    mk('deco-crown', ['silly', 'fancy'], 'golden crown with jewels', (k) => {
      k.rod('brass', [0, 0, 0], [0, 0.014, 0], 0.022, 0.022, 10, true);
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * Math.PI * 2;
        k.rod('brass', [Math.cos(a) * 0.02, 0.014, Math.sin(a) * 0.02], [Math.cos(a) * 0.022, 0.032, Math.sin(a) * 0.022], 0.006, 0, 4);
        k.ball('#d62828', 0.003, [Math.cos(a) * 0.022, 0.007, Math.sin(a) * 0.022], 0);
      }
    }),
    mk('deco-party-hat', ['silly', 'festive'], 'striped party hat with pom-pom', (k) => {
      k.rod('main', [0, 0, 0], [0, 0.05, 0], 0.018, 0, 8);
      k.rod('accent', [0, 0.015, 0], [0, 0.022, 0], 0.0128, 0.0115, 8);
      k.ball('white', 0.006, [0, 0.052, 0], 0);
    }),
    mk('deco-cactus', ['silly', 'desert'], 'potted mini cactus', (k) => {
      k.rod('#b5651d', [0, 0, 0], [0, 0.018, 0], 0.012, 0.015, 8);
      k.rod('#3a9a3a', [0, 0.018, 0], [0, 0.06, 0], 0.008, 0.008, 6);
      k.rod('#3a9a3a', [0, 0.035, 0], [0.016, 0.035, 0], 0.005, 0.005, 5);
      k.rod('#3a9a3a', [0.016, 0.035, 0], [0.016, 0.05, 0], 0.005, 0.005, 5);
    }),
    mk('deco-mushroom', ['silly', 'organic', 'fantasy'], 'red spotted toadstool', (k) => {
      k.rod('white', [0, 0, 0], [0, 0.025, 0], 0.006, 0.007, 6);
      k.sphere('#d62828', 0.02, { p: [0, 0.022, 0], s: [1, 0.7, 1] }, 10, 4, Math.PI / 2);
      k.ball('white', 0.004, [0.01, 0.034, 0.004], 0);
      k.ball('white', 0.004, [-0.008, 0.033, -0.008], 0);
    }),
    mk('deco-tentacle', ['silly', 'organic', 'spooky'], 'wiggly purple tentacle', (k) => {
      k.tube('#8e44ad', [[0, 0, 0], [0.01, 0.02, 0], [-0.008, 0.04, 0.006], [0.006, 0.06, 0.012], [0.016, 0.07, 0.004]], 0.007, 14, 5);
      for (let j = 0; j < 3; j++) k.ball('#d7a9e8', 0.0035, [0.004 - j * 0.004, 0.015 + j * 0.018, -0.006], 0);
    }),
    mk('deco-eyeball', ['silly', 'spooky', 'organic'], 'bloodshot eyeball on top', (k) => {
      k.ball('white', 0.016, [0, 0.016, 0], 1);
      k.zrod('#3a7bd5', -0.017, -0.013, 0.007, 0.007, 8, 0, 0.016);
      k.zrod('#111111', -0.018, -0.016, 0.003, 0.003, 6, 0, 0.016);
    }),
    mk('deco-chili', ['silly', 'food', 'fire'], 'red hot chili pepper', (k) => {
      k.tube('#d62828', [[0, 0.008, 0.03], [0, 0.012, 0], [0, 0.008, -0.025], [0, 0.0, -0.04]], 0.008, 8, 5);
      k.rod('#3a9a3a', [0, 0.008, 0.03], [0, 0.014, 0.04], 0.004, 0.003, 4);
    }),
    mk('deco-carrot', ['silly', 'food'], 'carrot with leafy top', (k) => {
      k.rod('#ff8c1a', [0, 0.01, -0.04], [0, 0.01, 0.03], 0.0, 0.01, 6);
      for (let j = 0; j < 3; j++) k.rod('#3a9a3a', [0, 0.01, 0.03], [(j - 1) * 0.008, 0.03, 0.045], 0.003, 0.0, 3);
    }),
    mk('deco-top-hat', ['silly', 'fancy'], 'tiny dapper top hat', (k) => {
      k.rod('#111111', [0, 0, 0], [0, 0.004, 0], 0.024, 0.024, 10);
      k.rod('#111111', [0, 0.004, 0], [0, 0.04, 0], 0.015, 0.016, 10);
      k.rod('#d62828', [0, 0.008, 0], [0, 0.014, 0], 0.0162, 0.0162, 10);
    }),
    mk('deco-bow-ribbon', ['silly', 'cute', 'festive'], 'big gift bow ribbon', (k) => {
      for (const s of [-1, 1]) k.ball('accent', 1, [s * 0.016, 0.012, 0], 0, [0.016, 0.01, 0.006]);
      k.ball('accent', 0.007, [0, 0.012, 0], 0);
      for (const s of [-1, 1]) k.box('accent', [0.006, 0.02, 0.003], { p: [s * 0.006, 0.0, 0], r: [0, 0, s * 0.4] });
    }),
    mk('deco-feather', ['silly', 'tribal', 'fancy'], 'tall plume feather', (k) => {
      k.rod('white', [0, 0, 0], [0, 0.09, 0.02], 0.0015, 0.0008, 3);
      k.blade('accent', [[0, 0.01], [0.012, 0.05], [0.006, 0.09], [-0.006, 0.05]], 0.003, 'zy', { r: [0, 0, 0] });
    }),
    mk('deco-flower', ['silly', 'cute'], 'daisy flower on stem', (k) => {
      k.rod('#3a9a3a', [0, 0, 0], [0, 0.05, 0], 0.002, 0.002, 4);
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * Math.PI * 2;
        k.ball('white', 1, [Math.cos(a) * 0.012, 0.05, Math.sin(a) * 0.012], 0, [0.008, 0.003, 0.008]);
      }
      k.ball('#ffd23f', 0.006, [0, 0.052, 0], 0);
    }),
    mk('deco-skull', ['spooky', 'brutal'], 'small skull trophy', (k) => {
      k.ball('white', 0.018, [0, 0.022, 0], 1);
      k.box('white', [0.018, 0.012, 0.014], { p: [0, 0.008, -0.006] });
      k.ball('#111111', 0.005, [0.007, 0.024, -0.014], 0);
      k.ball('#111111', 0.005, [-0.007, 0.024, -0.014], 0);
    }),
    mk('deco-devil-horns', ['silly', 'spooky'], 'pair of red devil horns', (k) => {
      for (const s of [-1, 1]) k.tube('#d62828', [[s * 0.015, 0, 0], [s * 0.022, 0.015, 0], [s * 0.018, 0.03, -0.006]], 0.006, 6, 4);
      for (const s of [-1, 1]) k.rod('#d62828', [s * 0.018, 0.03, -0.006], [s * 0.012, 0.04, -0.01], 0.005, 0, 4);
    }),
    mk('deco-halo', ['silly', 'fantasy'], 'floating glowing halo', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.03, 0], 0.001, 0.001, 3);
      k.torus('glow', 0.022, 0.003, { p: [0, 0.035, 0], r: [Math.PI / 2, 0, 0] }, 3, 14);
    }),
    mk('deco-unicorn-horn', ['silly', 'fantasy', 'cute'], 'spiral rainbow unicorn horn', (k) => {
      k.rod('#f7c6e0', [0, 0, 0], [0, 0.07, -0.02], 0.012, 0, 6);
      for (let j = 0; j < 4; j++) k.torus('#c6a5ff', 0.011 - j * 0.0025, 0.002, { p: [0, 0.012 + j * 0.015, -0.0035 - j * 0.0043], r: [Math.PI / 2 + 0.28, 0, 0] }, 3, 8);
    }),
    mk('deco-pompom', ['silly', 'cute'], 'fluffy pom-pom ball', (k) => k.ball('accent', 0.016, [0, 0.016, 0], 1)),
    mk('deco-lightbulb', ['silly', 'retro'], 'glowing idea lightbulb', (k) => {
      k.rod('metal', [0, 0, 0], [0, 0.012, 0], 0.007, 0.007, 8);
      k.ball('glow', 0.014, [0, 0.026, 0], 1);
    }),
    mk('deco-tesla-coil', ['steampunk', 'scifi', 'energy'], 'mini tesla coil with glowing orb', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.008, 0], 0.014, 0.014, 8);
      k.rod('#b87333', [0, 0.008, 0], [0, 0.05, 0], 0.008, 0.006, 8);
      for (let j = 0; j < 4; j++) k.torus('#b87333', 0.009, 0.0015, { p: [0, 0.014 + j * 0.009, 0], r: [Math.PI / 2, 0, 0] }, 3, 8);
      k.ball('glow', 0.012, [0, 0.062, 0], 1);
    }),
    mk('deco-solar-panel', ['scifi', 'eco'], 'small tilted solar panel', (k) => {
      k.rod('dark', [0, 0, 0], [0, 0.02, 0], 0.003, 0.003, 4);
      k.box('#1f3a68', [0.05, 0.003, 0.035], { p: [0, 0.022, 0], r: [0.3, 0, 0] });
      k.box('metal', [0.052, 0.002, 0.002], { p: [0, 0.024, 0], r: [0.3, 0, 0] });
    }),
    mk('deco-coffee-cup', ['silly', 'cozy'], 'paper coffee cup with lid', (k) => {
      k.rod('white', [0, 0, 0], [0, 0.04, 0], 0.012, 0.016, 8);
      k.rod('#7a4a28', [0, 0.015, 0], [0, 0.026, 0], 0.0142, 0.0155, 8);
      k.rod('dark', [0, 0.04, 0], [0, 0.046, 0], 0.017, 0.016, 8);
    }),
    mk('deco-donut', ['silly', 'food'], 'pink frosted donut', (k) => {
      k.torus('#d4a055', 0.016, 0.009, { p: [0, 0.009, 0], r: [Math.PI / 2, 0, 0] }, 5, 10);
      k.torus('#ff8fc4', 0.016, 0.0075, { p: [0, 0.012, 0], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.8] }, 4, 10);
    }),
    mk('deco-pizza-slice', ['silly', 'food'], 'cheesy pizza slice', (k) => {
      k.extrude('#ffcf5c', [[0, 0.03], [-0.025, -0.03], [0.025, -0.03]], 0.004, 'xz', { p: [0, 0.004, 0] });
      k.box('#d4a055', [0.054, 0.008, 0.008], { p: [0, 0.006, 0.03] });
      for (const [x, z] of [[0, 0], [-0.008, 0.015], [0.009, 0.018]]) k.rod('#c0392b', [x, 0.006, z], [x, 0.008, z], 0.005, 0.005, 6);
    }),
    mk('deco-rubber-chicken', ['silly', 'toy'], 'floppy rubber chicken', (k) => {
      k.ball('#ffe36b', 1, [0, 0.012, 0.01], 1, [0.012, 0.012, 0.03]);
      k.tube('#ffe36b', [[0, 0.012, -0.015], [0, 0.03, -0.03], [0, 0.04, -0.04]], 0.005, 6, 4);
      k.ball('#ffe36b', 0.008, [0, 0.042, -0.042], 0);
      k.rod('#d62828', [0, 0.05, -0.042], [0, 0.056, -0.04], 0.004, 0.002, 4);
      k.rod('#ff8c1a', [0, 0.042, -0.05], [0, 0.04, -0.058], 0.003, 0, 4);
    }),
    mk('deco-cherry', ['silly', 'food', 'cute'], 'pair of cherries on stems', (k) => {
      k.ball('#c0392b', 0.009, [-0.01, 0.009, 0], 1);
      k.ball('#c0392b', 0.009, [0.01, 0.009, 0.004], 1);
      k.tube('#3a9a3a', [[-0.01, 0.017, 0], [-0.004, 0.035, 0], [0.0, 0.04, 0.002]], 0.0012, 6, 3);
      k.tube('#3a9a3a', [[0.01, 0.017, 0.004], [0.004, 0.035, 0.002], [0.0, 0.04, 0.002]], 0.0012, 6, 3);
    }),
    mk('deco-cat-ears', ['silly', 'cute'], 'pair of triangle cat ears', (k) => {
      for (const s of [-1, 1]) {
        k.extrude('main', [[-0.012, 0], [0.012, 0], [0.002, 0.026]], 0.005, 'xy', { p: [s * 0.018, 0, 0] });
        k.extrude('#ff8fc4', [[-0.006, 0.003], [0.006, 0.003], [0.001, 0.016]], 0.002, 'xy', { p: [s * 0.018, 0, -0.003] });
      }
    }),
    mk('deco-tassel', ['fancy', 'eastern'], 'hanging silk tassel', (k) => {
      k.rod('accent', [0, 0, 0], [0, -0.02, 0], 0.0015, 0.0015, 3);
      k.ball('brass', 0.005, [0, -0.022, 0], 0);
      k.rod('accent', [0, -0.025, 0], [0, -0.06, 0], 0.003, 0.009, 6);
    }),
    mk('deco-bandana-wrap', ['military', 'rambo'], 'tied cloth bandana wrap with tails', (k) => {
      k.rod('accent', [-0.02, 0, 0], [0.02, 0, 0], 0.016, 0.016, 8);
      k.box('accent', [0.004, 0.03, 0.01], { p: [0.022, -0.012, 0.004], r: [0, 0, 0.4] });
      k.box('accent', [0.004, 0.035, 0.01], { p: [0.022, -0.012, -0.006], r: [0, 0, 0.2] });
    }),
    mk('deco-tally-marks', ['military', 'brutal'], 'carved tally mark notches', (k) => {
      for (let j = 0; j < 4; j++) k.box('dark', [0.004, 0.002, 0.016], { p: [0, 0.001, -0.012 + j * 0.008], r: [0, Math.PI / 2, 0] });
      k.box('dark', [0.004, 0.002, 0.04], { p: [0, 0.002, 0], r: [0, 0.8, 0] });
    }),
    mk('deco-chain-loop', ['brutal', 'punk'], 'drooping chain loop', (k) => {
      for (let j = 0; j < 6; j++) {
        const t = j / 5;
        k.torus('metal', 0.006, 0.0018, { p: [0, -Math.sin(t * Math.PI) * 0.025, -0.03 + t * 0.06], r: [0, j % 2 ? Math.PI / 2 : 0, 0] }, 3, 6);
      }
    }),
    mk('deco-name-tag', ['military'], 'stamped metal dog tag', (k) => {
      k.rod('metal', [0, 0, 0], [0, -0.015, 0], 0.001, 0.001, 3);
      k.extrude('metal', [[-0.012, -0.015], [0.012, -0.015], [0.012, -0.03], [-0.012, -0.03]], 0.002, 'zy', undefined, 0.001);
    }),
    mk('deco-snorkel', ['silly', 'nautical'], 'bent snorkel tube', (k) => {
      k.tube('main', [[0, 0, 0.02], [0, 0.04, 0.02], [0, 0.06, 0.0], [0, 0.07, -0.02]], 0.006, 10, 5);
      k.ball('accent', 0.008, [0, 0.0, 0.02], 0);
    }),
  );
  return out;
}
