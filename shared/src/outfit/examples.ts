// Hand-built outfits: the Closet presets (Scout / Soldier / Tank, also seeded on the server) and
// few-shot examples for the forge LLM (knight, astronaut, ninja, banana suit, riot cop, robot).
// Plain primitives only (no macros): valid stored DSL as is.

import type { Shape, ShapeMaterial, V3 } from '../forge/types';
import type { OutfitDesign, OutfitPiece, SocketName } from './types';
import { sanitizeOutfit } from './sanitize';

type Mat = ShapeMaterial;
const mat = (color: string, metalness?: number, roughness?: number, extra: Partial<Mat> = {}): Mat => ({
  color,
  ...(metalness !== undefined ? { metalness } : {}),
  ...(roughness !== undefined ? { roughness } : {}),
  ...extra,
});
const smooth = (m: Mat): Mat => ({ ...m, flatShading: false });

const box = (size: V3, m: Mat, pos?: V3, rot?: V3): Shape => ({ type: 'box', size, material: m, ...(pos ? { pos } : {}), ...(rot ? { rot } : {}) });
const sph = (r: number, m: Mat, pos?: V3, scale?: V3, seg = 14): Shape => ({ type: 'sphere', r, wseg: seg, hseg: Math.max(6, Math.round(seg * 0.6)), material: m, ...(pos ? { pos } : {}), ...(scale ? { scale } : {}) });
const cyl = (rTop: number, rBottom: number, h: number, m: Mat, pos?: V3, rot?: V3, seg = 14): Shape => ({ type: 'cylinder', rTop, rBottom, h, seg, material: m, ...(pos ? { pos } : {}), ...(rot ? { rot } : {}) });
const cap = (r: number, h: number, m: Mat, pos?: V3, rot?: V3, scale?: V3): Shape => ({ type: 'capsule', r, h, seg: 12, material: m, ...(pos ? { pos } : {}), ...(rot ? { rot } : {}), ...(scale ? { scale } : {}) });
const tor = (r: number, tube: number, m: Mat, pos?: V3, rot?: V3, scale?: V3): Shape => ({ type: 'torus', r, tube, seg: 18, material: m, ...(pos ? { pos } : {}), ...(rot ? { rot } : {}), ...(scale ? { scale } : {}) });

const piece = (id: string, label: string, socket: SocketName, shapes: Shape[], o: { pos?: V3; rot?: V3; scale?: V3; mirror?: boolean } = {}): OutfitPiece => ({
  id,
  label,
  socket,
  transform: { pos: o.pos ?? [0, 0, 0], rot: o.rot ?? [0, 0, 0], scale: o.scale ?? [1, 1, 1] },
  shapes,
  ...(o.mirror ? { mirror: true } : {}),
});

const P = mat('primary', 0.1, 0.7);
const S = mat('secondary', 0.05, 0.8);
const A = mat('accent', 0.3, 0.5);
const RUBBER = mat('#2e3034', 0, 0.9);
const STEEL = smooth(mat('#c9ced6', 0.9, 0.28));
const DARK = mat('#3a3d44', 0.5, 0.5);

/** sanitizer notes per hand-built outfit (tests: authored outfits must already be legal) */
export const EXAMPLE_FIT_WARNINGS: Record<string, string[]> = {};

function fin(o: OutfitDesign): OutfitDesign {
  const r = sanitizeOutfit(o);
  EXAMPLE_FIT_WARNINGS[o.name] = r.warnings;
  return r.outfit;
}

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------

export const OUTFIT_SCOUT: OutfitDesign = fin({
  v: 1,
  name: 'Scout',
  theme: 'light recon runner',
  body: { size: 0.85, build: 0.9, head: 0.95, limbs: 1.05 },
  skin: '#d9a77f',
  palette: { primary: '#2f8f83', secondary: '#3a4450', accent: '#ff8a1f', glow: '#7af0ff' },
  pieces: [
    piece('cap', 'field cap', 'head', [box([0.3, 0.07, 0.3], P, [0, 0.135, 0.005]), box([0.27, 0.025, 0.12], P, [0, 0.11, -0.19], [-6, 0, 0]), box([0.31, 0.03, 0.31], mat('accent', 0.1, 0.6), [0, 0.1, 0.005])]),
    piece('goggles', 'tinted goggles', 'face', [box([0.25, 0.07, 0.035], smooth(mat('#ff8a1f', 0.6, 0.15)), [0, 0.01, -0.015]), box([0.3, 0.025, 0.03], RUBBER, [0, 0.01, 0.0])]),
    piece('scarf', 'neck scarf', 'torso', [tor(0.13, 0.05, A, [0, 0.3, 0], [90, 0, 0], [1.25, 1.05, 1])]),
    piece('vest', 'light vest', 'torso', [box([0.52, 0.42, 0.31], P, [0, 0.06, 0]), box([0.14, 0.1, 0.05], S, [-0.12, 0.0, -0.17]), box([0.14, 0.1, 0.05], S, [0.12, 0.0, -0.17])]),
    piece('pack', 'slim backpack', 'back', [box([0.34, 0.38, 0.12], S, [0, -0.02, 0.07]), box([0.3, 0.06, 0.13], A, [0, -0.2, 0.07])]),
    piece('belt', 'utility belt', 'belt', [box([0.53, 0.06, 0.31], RUBBER), box([0.1, 0.1, 0.06], S, [0.18, -0.04, -0.16])]),
    piece('wrap', 'arm wrap', 'armL', [cyl(0.078, 0.078, 0.16, S, [0, 0, -0.12], [90, 0, 0], 8)], { mirror: true }),
    piece('shoe', 'trail runner', 'footL', [box([0.19, 0.09, 0.29], mat('#e8e8e8', 0, 0.7), [0, 0.0, -0.01]), box([0.2, 0.03, 0.3], A, [0, -0.04, -0.01])], { mirror: true }),
  ],
});

export const OUTFIT_SOLDIER: OutfitDesign = fin({
  v: 1,
  name: 'Soldier',
  theme: 'modern infantry',
  body: { size: 1, build: 1, head: 1, limbs: 1 },
  skin: '#c9946b',
  palette: { primary: '#5b6b47', secondary: '#8a7a5a', accent: '#c9a24a', glow: '#9dff6a' },
  pieces: [
    piece('helmet', 'combat helmet', 'head', [sph(0.235, smooth(P), [0, 0.03, 0.01], [1, 0.78, 1.04], 16), box([0.4, 0.03, 0.4], P, [0, -0.02, 0.01])]),
    piece('nvg', 'helmet mount', 'head', [box([0.08, 0.06, 0.05], DARK, [0, 0.12, -0.2])]),
    piece('carrier', 'plate carrier', 'torso', [box([0.55, 0.46, 0.34], P, [0, 0.04, 0]), box([0.12, 0.13, 0.06], S, [-0.15, -0.08, -0.19]), box([0.12, 0.13, 0.06], S, [0, -0.08, -0.19]), box([0.12, 0.13, 0.06], S, [0.15, -0.08, -0.19])]),
    piece('radio', 'radio pouch', 'back', [box([0.12, 0.2, 0.08], S, [0.12, 0.02, 0.05]), cyl(0.008, 0.008, 0.3, DARK, [0.15, 0.25, 0.05], undefined, 5)]),
    piece('belt', 'battle belt', 'belt', [box([0.54, 0.07, 0.32], S), box([0.09, 0.12, 0.07], P, [-0.2, -0.05, -0.15])]),
    piece('knee', 'knee pad', 'shinL', [box([0.15, 0.13, 0.06], RUBBER, [0, 0.19, -0.11])], { mirror: true }),
    piece('glove', 'tactical glove', 'handL', [box([0.11, 0.1, 0.11], RUBBER)], { mirror: true }),
    piece('boot', 'combat boot', 'footL', [box([0.2, 0.13, 0.3], mat('#4a3a2a', 0, 0.8), [0, 0.02, -0.01]), box([0.21, 0.03, 0.31], RUBBER, [0, -0.045, -0.01])], { mirror: true }),
  ],
});

export const OUTFIT_TANK: OutfitDesign = fin({
  v: 1,
  name: 'Tank',
  theme: 'heavy assault armour',
  body: { size: 1.08, build: 1.3, head: 1.1, limbs: 1 },
  skin: '#b98a63',
  palette: { primary: '#4a4f57', secondary: '#2f3237', accent: '#ffc21a', glow: '#ff6a2a' },
  pieces: [
    piece('helm', 'heavy helm', 'head', [box([0.34, 0.33, 0.34], smooth(mat('primary', 0.7, 0.4)), [0, 0.01, 0]), box([0.25, 0.05, 0.02], mat('glow', 0, 0.4, { emissive: 'glow', emissiveIntensity: 1.6 }), [0, 0.03, -0.172])]),
    piece('plate', 'chest plate', 'torso', [box([0.58, 0.5, 0.36], mat('primary', 0.7, 0.4), [0, 0.05, 0]), box([0.3, 0.18, 0.04], A, [0, 0.09, -0.19]), box([0.06, 0.18, 0.04], RUBBER, [0, 0.09, -0.205])]),
    piece('pauldron', 'pauldron', 'shoulderL', [sph(0.15, smooth(mat('primary', 0.7, 0.4)), [-0.02, 0.0, 0], [1.05, 0.7, 1.05]), box([0.05, 0.03, 0.2], A, [-0.1, 0.06, 0], [0, 0, 25])], { mirror: true }),
    piece('pack', 'power pack', 'back', [box([0.42, 0.46, 0.2], S, [0, 0.0, 0.1]), cyl(0.05, 0.05, 0.3, mat('glow', 0.2, 0.4, { emissive: 'glow', emissiveIntensity: 1.2 }), [0.12, 0.05, 0.2]), cyl(0.05, 0.05, 0.3, mat('glow', 0.2, 0.4, { emissive: 'glow', emissiveIntensity: 1.2 }), [-0.12, 0.05, 0.2])]),
    piece('tassets', 'armoured tassets', 'belt', [box([0.56, 0.1, 0.34], S), box([0.2, 0.2, 0.04], mat('primary', 0.7, 0.4), [-0.13, -0.14, -0.18]), box([0.2, 0.2, 0.04], mat('primary', 0.7, 0.4), [0.13, -0.14, -0.18])]),
    piece('gauntlet', 'gauntlet', 'armL', [box([0.17, 0.17, 0.3], mat('primary', 0.7, 0.4), [0, 0, -0.1])], { mirror: true }),
    piece('greave', 'greave', 'shinL', [box([0.2, 0.42, 0.14], mat('primary', 0.7, 0.4), [0, 0, -0.04]), box([0.16, 0.12, 0.05], A, [0, 0.18, -0.12])], { mirror: true }),
    piece('thighplate', 'thigh plate', 'thighL', [box([0.22, 0.34, 0.06], S, [0, 0, -0.12])], { mirror: true }),
    piece('boot', 'sabaton', 'footL', [box([0.22, 0.14, 0.32], S, [0, 0.02, -0.02])], { mirror: true }),
  ],
});

/** Closet quick picks (also seeded as preset outfit rows on the server). */
export const OUTFIT_PRESETS: readonly OutfitDesign[] = [OUTFIT_SCOUT, OUTFIT_SOLDIER, OUTFIT_TANK];

// ---------------------------------------------------------------------------
// few-shot examples
// ---------------------------------------------------------------------------

export const OUTFIT_KNIGHT: OutfitDesign = fin({
  v: 1,
  name: 'Knight Errant',
  theme: 'medieval knight',
  body: { size: 1.05, build: 1.08, head: 1, limbs: 1 },
  skin: '#e0b89a',
  palette: { primary: '#c9ced6', secondary: '#5a4636', accent: '#b3202a', glow: '#ffd27a' },
  pieces: [
    piece('helm', 'great helm', 'head', [cyl(0.205, 0.2, 0.34, STEEL, [0, 0.01, 0], undefined, 16), cyl(0.13, 0.205, 0.07, STEEL, [0, 0.215, 0], undefined, 16)]),
    piece('slit', 'eye slit', 'face', [box([0.24, 0.03, 0.03], mat('#202226', 0.3, 0.6), [0, 0.0, -0.065]), box([0.03, 0.14, 0.03], STEEL, [0, -0.09, -0.07])]),
    piece('plume', 'red plume', 'head', [sph(0.06, A, [0, 0.31, 0.03], [0.6, 1.6, 1.4], 8)]),
    piece('breast', 'breastplate', 'torso', [box([0.54, 0.5, 0.34], STEEL, [0, 0.05, 0]), box([0.04, 0.4, 0.03], STEEL, [0, 0.05, -0.18])]),
    piece('tabard', 'tabard', 'torso', [box([0.3, 0.55, 0.02], A, [0, -0.15, -0.185])]),
    piece('pauldron', 'pauldron', 'shoulderL', [sph(0.13, STEEL, [-0.02, 0, 0], [1.1, 0.75, 1.1]), tor(0.1, 0.015, STEEL, [-0.02, -0.04, 0], [90, 0, 0])], { mirror: true }),
    piece('cape', 'crimson cape', 'back', [box([0.5, 0.95, 0.02], mat('accent', 0, 0.9), [0, -0.38, 0.03], [6, 0, 0])]),
    piece('tasset', 'mail skirt', 'belt', [cyl(0.26, 0.31, 0.3, mat('#8a8f99', 0.8, 0.5), [0, -0.12, 0], undefined, 12), box([0.54, 0.06, 0.33], S, [0, 0.02, 0])]),
    piece('vambrace', 'vambrace', 'armL', [cyl(0.085, 0.08, 0.3, STEEL, [0, 0, -0.1], [90, 0, 0], 10)], { mirror: true }),
    piece('gauntlet', 'gauntlet', 'handL', [box([0.12, 0.11, 0.13], STEEL)], { mirror: true }),
    piece('greave', 'greave', 'shinL', [cyl(0.1, 0.09, 0.42, STEEL, [0, 0, 0], undefined, 10), sph(0.07, STEEL, [0, 0.2, -0.08], [1, 0.9, 0.7], 8)], { mirror: true }),
    piece('sabaton', 'sabaton', 'footL', [box([0.19, 0.11, 0.3], STEEL, [0, 0.01, -0.02])], { mirror: true }),
  ],
});

export const OUTFIT_ASTRONAUT: OutfitDesign = fin({
  v: 1,
  name: 'Moonwalker',
  theme: 'astronaut',
  body: { size: 1, build: 1.12, head: 1.1, limbs: 1 },
  skin: '#e0b89a',
  palette: { primary: '#eef0f2', secondary: '#c4c8ce', accent: '#2b6fd6', glow: '#ffcc33' },
  pieces: [
    piece('helmet', 'bubble helmet', 'head', [sph(0.25, smooth(mat('primary', 0.1, 0.4)), [0, 0.01, 0.01], undefined, 18)]),
    piece('visor', 'gold visor', 'face', [sph(0.17, smooth(mat('#d9a520', 1, 0.12)), [0, -0.01, -0.06], [1, 0.78, 0.5], 18)]),
    piece('collar', 'neck ring', 'torso', [tor(0.14, 0.035, mat('secondary', 0.6, 0.35), [0, 0.3, 0], [90, 0, 0])]),
    piece('suit', 'pressure suit', 'torso', [box([0.56, 0.62, 0.34], smooth(P), [0, 0.0, 0]), box([0.2, 0.12, 0.06], mat('secondary', 0.3, 0.5), [0, 0.06, -0.19]), box([0.04, 0.04, 0.02], mat('#ff3a30', 0, 0.4, { emissive: '#ff3a30', emissiveIntensity: 1 }), [-0.06, 0.08, -0.225]), box([0.04, 0.04, 0.02], A, [0.06, 0.08, -0.225]), box([0.1, 0.06, 0.01], A, [0.16, 0.18, -0.175])]),
    piece('pls', 'life support pack', 'back', [box([0.46, 0.52, 0.2], P, [0, 0.0, 0.1]), cyl(0.03, 0.03, 0.44, mat('secondary', 0.6, 0.35), [0.2, 0.0, 0.2], undefined, 8)]),
    piece('belt', 'suit belt', 'belt', [box([0.56, 0.08, 0.35], mat('secondary', 0.3, 0.5))]),
    piece('sleeve', 'puffy sleeve', 'armL', [cyl(0.095, 0.095, 0.44, smooth(P), [0, 0, -0.02], [90, 0, 0], 10), tor(0.09, 0.02, A, [0, 0, -0.22])], { mirror: true }),
    piece('glove', 'suit glove', 'handL', [sph(0.07, smooth(mat('secondary', 0.1, 0.6)), [0, 0, -0.01], [1, 0.9, 1.2], 10)], { mirror: true }),
    piece('leg', 'suit leg', 'thighL', [cyl(0.12, 0.11, 0.46, smooth(P), undefined, undefined, 10)], { mirror: true }),
    piece('shin', 'suit shin', 'shinL', [cyl(0.11, 0.1, 0.44, smooth(P), undefined, undefined, 10)], { mirror: true }),
    piece('boot', 'moon boot', 'footL', [box([0.22, 0.15, 0.33], mat('secondary', 0.1, 0.7), [0, 0.03, -0.02])], { mirror: true }),
  ],
});

export const OUTFIT_NINJA: OutfitDesign = fin({
  v: 1,
  name: 'Shadow Ninja',
  theme: 'ninja',
  body: { size: 0.9, build: 0.92, head: 1, limbs: 1.05 },
  skin: '#d6a27a',
  palette: { primary: '#2c2f36', secondary: '#3c4049', accent: '#c4212b', glow: '#ff4655' },
  pieces: [
    piece('hood', 'hood', 'head', [sph(0.235, P, [0, 0.03, 0.03], [1, 1, 1.05], 12)]),
    piece('mask', 'face mask', 'face', [box([0.3, 0.14, 0.05], P, [0, -0.09, -0.07])]),
    piece('band', 'headband', 'head', [tor(0.215, 0.02, A, [0, 0.07, 0.02], [90, 0, 0]), box([0.04, 0.22, 0.01], A, [0.03, -0.04, 0.25], [12, 0, 18]), box([0.04, 0.2, 0.01], A, [-0.02, -0.05, 0.25], [12, 0, -12])]),
    piece('gi', 'wrapped gi', 'torso', [box([0.52, 0.6, 0.3], P), box([0.08, 0.6, 0.02], S, [-0.06, 0, -0.16], [0, 0, 20])]),
    piece('sash', 'red sash', 'belt', [box([0.53, 0.09, 0.31], A), box([0.08, 0.22, 0.02], A, [0.14, -0.12, -0.16], [0, 0, -10])]),
    piece('katana', 'sheathed katana', 'back', [cyl(0.022, 0.022, 0.75, mat('#1c1d20', 0.2, 0.5), [0, -0.05, 0.04], [0, 0, 35], 8), cyl(0.018, 0.018, 0.22, mat('accent', 0, 0.8), [-0.27, 0.37, 0.04], [0, 0, 35], 8), cyl(0.045, 0.045, 0.015, mat('#c9a24a', 0.9, 0.3), [-0.2, 0.28, 0.04], [0, 0, 35], 10)]),
    piece('wrap', 'arm wrap', 'armL', [cyl(0.076, 0.07, 0.3, S, [0, 0, -0.1], [90, 0, 0], 8)], { mirror: true }),
    piece('shin', 'shin wrap', 'shinL', [cyl(0.095, 0.085, 0.3, S, [0, -0.06, 0], undefined, 8)], { mirror: true }),
    piece('tabi', 'tabi boot', 'footL', [box([0.17, 0.09, 0.27], S, [0, 0, -0.01])], { mirror: true }),
  ],
});

export const OUTFIT_BANANA: OutfitDesign = fin({
  v: 1,
  name: 'Top Banana',
  theme: 'banana mascot suit',
  body: { size: 1, build: 1.15, head: 1.1, limbs: 1 },
  skin: '#e8b88f',
  palette: { primary: '#ffd83a', secondary: '#f2c21a', accent: '#5a3d1e', glow: '#fff3a0' },
  pieces: [
    piece('peel', 'banana body', 'torso', [cap(0.29, 0.4, smooth(mat('primary', 0, 0.5)), [0, 0.04, 0.02], undefined, [1, 1, 0.82]), box([0.04, 0.7, 0.02], mat('secondary', 0, 0.6), [0.16, 0.04, -0.235])]),
    piece('hood', 'banana top', 'head', [cap(0.22, 0.16, smooth(mat('primary', 0, 0.5)), [0, 0.05, 0.02], [-6, 0, 0]), cyl(0.035, 0.05, 0.14, mat('accent', 0, 0.8), [0, 0.33, 0.05], [-14, 0, 0], 8), cyl(0.04, 0.04, 0.03, mat('#3a2a14', 0, 0.9), [0, 0.4, 0.07], [-14, 0, 0], 8)]),
    piece('window', 'face window', 'face', [sph(0.12, smooth(mat('#e8b88f', 0, 0.7)), [0, -0.02, -0.075], [1, 1.05, 0.35], 14), sph(0.02, mat('#2a1d10', 0, 0.6), [-0.045, 0.02, -0.115], undefined, 8), sph(0.02, mat('#2a1d10', 0, 0.6), [0.045, 0.02, -0.115], undefined, 8)]),
    piece('flap', 'peel flap', 'back', [box([0.18, 0.55, 0.03], smooth(mat('secondary', 0, 0.6)), [0.12, -0.38, 0.06], [18, 0, 12]), box([0.18, 0.55, 0.03], smooth(mat('secondary', 0, 0.6)), [-0.12, -0.38, 0.06], [18, 0, -12])]),
    piece('glove', 'mascot glove', 'handL', [sph(0.075, smooth(mat('#f4f4f4', 0, 0.6)), undefined, [1, 0.9, 1.15], 10)], { mirror: true }),
    piece('shoe', 'big shoe', 'footL', [box([0.21, 0.13, 0.33], mat('accent', 0, 0.7), [0, 0.02, -0.03])], { mirror: true }),
  ],
});

export const OUTFIT_RIOT: OutfitDesign = fin({
  v: 1,
  name: 'Riot Control',
  theme: 'riot police',
  body: { size: 1.05, build: 1.1, head: 1, limbs: 1 },
  skin: '#c48c62',
  palette: { primary: '#253048', secondary: '#1f2430', accent: '#e8e8e8', glow: '#3aa0ff' },
  pieces: [
    piece('helmet', 'riot helmet', 'head', [sph(0.235, smooth(mat('primary', 0.3, 0.4)), [0, 0.04, 0.01], [1, 0.85, 1.04], 16)]),
    piece('visor', 'clear visor', 'face', [box([0.34, 0.22, 0.02], smooth(mat('#9fc4e8', 0.2, 0.05, { opacity: 0.45 })), [0, -0.02, -0.11], [-8, 0, 0])]),
    piece('vest', 'riot vest', 'torso', [box([0.56, 0.52, 0.35], mat('primary', 0.2, 0.6), [0, 0.03, 0]), box([0.3, 0.07, 0.02], mat('accent', 0, 0.5), [0, 0.12, -0.185])]),
    piece('pad', 'shoulder guard', 'shoulderL', [box([0.17, 0.08, 0.2], mat('secondary', 0.2, 0.6), [-0.03, 0.01, 0], [0, 0, 18])], { mirror: true }),
    piece('elbow', 'forearm guard', 'armL', [box([0.15, 0.15, 0.26], mat('secondary', 0.2, 0.6), [0, 0, -0.09])], { mirror: true }),
    piece('belt', 'duty belt', 'belt', [box([0.55, 0.07, 0.33], RUBBER), box([0.06, 0.16, 0.06], RUBBER, [0.26, -0.08, 0]), cyl(0.018, 0.018, 0.4, RUBBER, [-0.27, -0.15, 0.02], undefined, 6)]),
    piece('knee', 'knee guard', 'shinL', [box([0.16, 0.3, 0.07], mat('secondary', 0.2, 0.6), [0, 0.06, -0.11])], { mirror: true }),
    piece('thigh', 'thigh guard', 'thighL', [box([0.2, 0.28, 0.05], mat('secondary', 0.2, 0.6), [0, 0, -0.125])], { mirror: true }),
    piece('glove', 'glove', 'handL', [box([0.11, 0.1, 0.12], RUBBER)], { mirror: true }),
    piece('boot', 'duty boot', 'footL', [box([0.2, 0.14, 0.3], RUBBER, [0, 0.02, -0.01])], { mirror: true }),
  ],
});

export const OUTFIT_ROBOT: OutfitDesign = fin({
  v: 1,
  name: 'Unit 7',
  theme: 'retro robot',
  body: { size: 1.1, build: 1.15, head: 1.05, limbs: 1 },
  skin: '#9aa3ad',
  palette: { primary: '#9aa3ad', secondary: '#5d6670', accent: '#ff8a1f', glow: '#3affd2' },
  pieces: [
    piece('head', 'box head', 'head', [box([0.34, 0.32, 0.32], smooth(mat('primary', 0.85, 0.3))), box([0.06, 0.12, 0.12], mat('secondary', 0.8, 0.4), [0.2, 0, 0]), box([0.06, 0.12, 0.12], mat('secondary', 0.8, 0.4), [-0.2, 0, 0])]),
    piece('eyes', 'visor eyes', 'face', [box([0.26, 0.06, 0.03], mat('glow', 0, 0.3, { emissive: 'glow', emissiveIntensity: 2 }), [0, 0.01, -0.035]), box([0.18, 0.03, 0.02], mat('secondary', 0.8, 0.4), [0, -0.1, -0.03])]),
    piece('antenna', 'antenna', 'head', [cyl(0.01, 0.01, 0.2, mat('secondary', 0.8, 0.4), [0, 0.25, 0], undefined, 6), sph(0.03, mat('accent', 0.2, 0.4, { emissive: 'accent', emissiveIntensity: 1.5 }), [0, 0.36, 0], undefined, 8)]),
    piece('chest', 'chest casing', 'torso', [box([0.56, 0.58, 0.34], smooth(mat('primary', 0.85, 0.3))), cyl(0.07, 0.07, 0.03, mat('glow', 0, 0.3, { emissive: 'glow', emissiveIntensity: 1.6 }), [0, 0.08, -0.18], [90, 0, 0], 16), box([0.36, 0.04, 0.02], mat('secondary', 0.8, 0.4), [0, -0.12, -0.175]), box([0.36, 0.04, 0.02], mat('secondary', 0.8, 0.4), [0, -0.18, -0.175])]),
    piece('shoulder', 'shoulder block', 'shoulderL', [box([0.16, 0.13, 0.17], mat('secondary', 0.8, 0.4), [-0.02, 0, 0]), box([0.17, 0.03, 0.18], A, [-0.02, 0.07, 0])], { mirror: true }),
    piece('exhaust', 'exhaust pipes', 'back', [cyl(0.04, 0.04, 0.3, mat('secondary', 0.8, 0.4), [0.1, 0.12, 0.05], undefined, 10), cyl(0.04, 0.04, 0.3, mat('secondary', 0.8, 0.4), [-0.1, 0.12, 0.05], undefined, 10)]),
    piece('hip', 'hip ring', 'belt', [cyl(0.29, 0.29, 0.1, mat('secondary', 0.8, 0.4), undefined, undefined, 12)]),
    piece('arm', 'piston arm', 'armL', [cyl(0.08, 0.08, 0.5, smooth(mat('primary', 0.85, 0.3)), [0, 0, 0], [90, 0, 0], 10), tor(0.08, 0.02, A, [0, 0, -0.05])], { mirror: true }),
    piece('claw', 'claw hand', 'handL', [box([0.12, 0.12, 0.1], mat('secondary', 0.8, 0.4))], { mirror: true }),
    piece('leg', 'leg plate', 'thighL', [box([0.22, 0.44, 0.22], smooth(mat('primary', 0.85, 0.3)))], { mirror: true }),
    piece('shin', 'shin plate', 'shinL', [box([0.2, 0.42, 0.2], smooth(mat('primary', 0.85, 0.3))), sph(0.06, A, [0, 0.21, -0.08], undefined, 8)], { mirror: true }),
    piece('foot', 'block foot', 'footL', [box([0.22, 0.12, 0.32], mat('secondary', 0.8, 0.4), [0, 0.01, -0.03])], { mirror: true }),
  ],
});

/** few-shot examples (prompt, outfit) for the forge LLM */
export const OUTFIT_EXAMPLES: readonly [string, OutfitDesign][] = [
  ['a medieval knight in full plate with a red cape', OUTFIT_KNIGHT],
  ['astronaut', OUTFIT_ASTRONAUT],
  ['a small fast ninja', OUTFIT_NINJA],
  ['banana suit', OUTFIT_BANANA],
  ['riot cop', OUTFIT_RIOT],
  ['a big clunky retro robot', OUTFIT_ROBOT],
];
