// refineDesign: deterministic "make it readable" pass the forge service runs on LLM / mock output
// (after sanitizeDesign, before the design is shown). It does not trust model coordinates for the
// structural skeleton:
//   1. archetype detection (karambit, katana, revolver, shotgun...) -> blueprint (sizes, sockets)
//   2. reparenting: structural roles hang off their canonical parent (blade -> guard/handle,
//      barrel -> core, muzzle -> barrel, ...)
//   3. proportions: overall length + per-role size ranges per archetype, hand-scale grips / handles
//   4. socket seating: each structural part sits flush on its parent's socket face, centred on the
//      symmetry plane, overlapping the face (no floating, no corner-touching)
//   5. hand alignment: the grip / handle is moved to the origin
//   6. materials: palette value contrast, no near-black mud, metals that render, parent / child
//      value contrast, emissive used sparingly
// Pure (no THREE). Not used by sanitizeDesign / the SpacetimeDB module: stored designs are plain DSL.

import type { WeaponClass } from '../weapon';
import {
  FORGE_LIMITS as L,
  type AnchorName,
  type Component,
  type ComponentRole,
  type DesignPalette,
  type ForgeDesign,
  type Shape,
  type ShapeMaterial,
  type V3,
} from './types';
import {
  designTrisEstimate,
  shapeTris,
  anchorPoint,
  applyAffine,
  boxSize,
  designBox,
  eulerMatrix,
  isEmptyBox,
  layoutComponents,
  shapeBox,
  transformBox,
  type Affine,
  type Box3,
  type LayoutEntry,
} from './math';
import { matrixToEuler } from './macros';
import { descendantsOf, fixHierarchy, sanitizeDesign, sanitizeHex, type SanitizeOptions } from './sanitize';

// ---------------------------------------------------------------------------
// archetypes / blueprints
// ---------------------------------------------------------------------------

export const ARCHETYPES = [
  'karambit', 'knife', 'katana', 'sword', 'axe', 'hammer', 'mace', 'spear', 'staff', 'bat', 'pan', 'melee',
  'revolver', 'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg', 'launcher', 'grenade_launcher',
  'flamethrower', 'bubble_gun', 'blowgun', 'crossbow', 'bow', 'throwable', 'weird',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

type Range = [number, number];
type Kind = 'gun' | 'melee' | 'free';

export interface Blueprint {
  kind: Kind;
  cls: WeaponClass;
  /** whole weapon, longest side (m) */
  length?: Range;
  /** per role: longest side of the component's own geometry (m) */
  parts?: Partial<Record<ComponentRole, Range>>;
  /** one-line build recipe for the prompt */
  recipe: string;
}

const GUN_GRIP: Range = [0.075, 0.15];

export const BLUEPRINTS: Record<Archetype, Blueprint> = {
  karambit: {
    kind: 'melee', cls: 'melee', length: [0.16, 0.25],
    parts: { blade: [0.055, 0.1], handle: [0.08, 0.115], pommel: [0.035, 0.05], guard: [0.012, 0.04] },
    recipe: 'REAL ~19 cm overall. Handle ~10 cm (bevelbox ~0.024 x 0.03, G10 / micarta scales + 2 steel pins), slightly curved down; claw blade (blade macro length ~0.075, width ~0.028, thickness 0.005, curve -0.9, tip "hook") on the handle FRONT; finger ring (torus r ~0.019, tube ~0.005, rot [0,90,0], role pommel, steel) on the handle BACK; optional spine jimping. No crossguard, no pommel ball.',
  },
  knife: {
    kind: 'melee', cls: 'melee', length: [0.2, 0.36],
    parts: { blade: [0.09, 0.22], handle: [0.09, 0.135], guard: [0.02, 0.07], pommel: [0.012, 0.035] },
    recipe: 'REAL: blade 10-20 cm (blade macro, tip point / clip / tanto, fuller for big knives), small guard / bolster on the handle front, handle ~12 cm with scales + pins, lanyard hole or pommel cap on the back.',
  },
  katana: {
    kind: 'melee', cls: 'melee', length: [0.95, 1.08],
    parts: { blade: [0.65, 0.75], handle: [0.25, 0.3], guard: [0.07, 0.09], pommel: [0.02, 0.04] },
    recipe: 'REAL ~1 m. Tsuka 27 cm at the origin (bevelbox ~0.028 x 0.034, dark silk wrap + light diamond accents, menuki); round tsuba (cylinder r ~0.04, h 0.008, rot [90,0,0], dark iron or brass) + habaki collar on its front; blade (blade macro length ~0.7, width ~0.031, thickness 0.007, curve ~0.04, tip kissaki, polished steel, light hamon edge) on the guard front; kashira cap on the back.',
  },
  sword: {
    kind: 'melee', cls: 'melee', length: [0.75, 1.3],
    parts: { blade: [0.55, 1.0], handle: [0.14, 0.3], guard: [0.12, 0.3], pommel: [0.03, 0.07] },
    recipe: 'handle 0.18-0.25 m at the origin, wide crossguard (bevelbox spanning X) on its front, long blade (blade macro, tip spear or point) on the guard front, pommel on the back.',
  },
  axe: {
    kind: 'melee', cls: 'melee', length: [0.45, 1.1],
    parts: { head: [0.12, 0.35], blade: [0.12, 0.35], handle: [0.4, 1.0] },
    recipe: 'long handle along Z with the hand near its back end; axe head (wedge with front ~2 or a blade macro with tip "square") crosswise on the handle FRONT, edge pointing up or down (+/-Y); handle tip pokes through the head.',
  },
  hammer: {
    kind: 'melee', cls: 'melee', length: [0.35, 1.3],
    parts: { head: [0.1, 0.42], blade: [0.1, 0.42], handle: [0.25, 1.1] },
    recipe: 'handle along Z, hand near the back; big blocky head (bevelbox or cylinder) crosswise (long axis Y) on the handle FRONT; the handle tip goes into the head.',
  },
  mace: {
    kind: 'melee', cls: 'melee', length: [0.5, 1.0],
    parts: { head: [0.1, 0.28], handle: [0.3, 0.8] },
    recipe: 'handle along Z, heavy flanged / spiked head (sphere + cones) on the handle FRONT, pommel on the back.',
  },
  spear: {
    kind: 'melee', cls: 'melee', length: [1.5, 2.6],
    parts: { head: [0.15, 0.45], blade: [0.15, 0.45], handle: [1.2, 2.3] },
    recipe: 'long thin shaft (r ~0.016) along Z, hand at about 1/3 from the back; spear head (blade macro, tip spear, edge double) on the shaft FRONT with a small collar.',
  },
  staff: {
    kind: 'melee', cls: 'melee', length: [1.2, 2.2],
    parts: { handle: [1.0, 2.1] },
    recipe: 'long shaft along Z, decorated / glowing head on the FRONT, cap on the back.',
  },
  bat: {
    kind: 'melee', cls: 'melee', length: [0.6, 1.1],
    parts: { handle: [0.15, 0.45], head: [0.3, 0.8] },
    recipe: 'thin wrapped handle at the origin, thick barrel / club head (lathe or tapered cylinder) on its FRONT, knob on the back.',
  },
  pan: {
    kind: 'melee', cls: 'melee', length: [0.4, 0.75],
    parts: { handle: [0.15, 0.32], head: [0.2, 0.4] },
    recipe: 'handle at the origin, flat round head (lathe) on its FRONT.',
  },
  melee: {
    kind: 'melee', cls: 'melee', length: [0.15, 2.8],
    parts: { handle: [0.08, 2.2], pommel: [0.015, 0.12] },
    recipe: 'handle at the origin along Z, the striking part (blade / head) on the handle FRONT, guard between them, pommel on the back.',
  },
  revolver: {
    kind: 'gun', cls: 'pistol', length: [0.24, 0.36],
    parts: { barrel: [0.08, 0.17], grip: GUN_GRIP, mag: [0.038, 0.06], core: [0.08, 0.17] },
    recipe: 'REAL (S&W Model 29-ish, 4-6 in barrel): frame (bevelbox ~0.035 wide) above the grip; fluted cylinder drum (role mag, cylinder r ~0.02, seg 6-12, laid along Z, WIDER than the frame, blued or stainless) set into the frame centre; round barrel with an under-lug on the frame FRONT + ramp front sight; grip (pistolgrip angle ~22, wooden) on the frame BOTTOM-BACK; hammer spur, trigger + trigger guard (half torus) under the frame; rear sight notch.',
  },
  pistol: {
    kind: 'gun', cls: 'pistol', length: [0.17, 0.25],
    parts: { grip: GUN_GRIP, core: [0.16, 0.22] },
    recipe: 'REAL (Glock 17: 186 mm long, 25.5 mm wide slide, 138 mm tall): slide (bevelbox ~0.186 x 0.028 x 0.025 wide, gunmetal / black nitride) on top; polymer frame under its front half with a short accessory rail (rail macro) under the dust cover; barrel muzzle just visible at the slide front; grip (pistolgrip h ~0.1, angle ~22, polymer, texture) at the back; trigger guard (half torus, squared front) + trigger; ejection port (darker inset box) on the right of the slide; front + rear sights; rear serrations (thin boxes); mag base plate under the grip.',
  },
  smg: {
    kind: 'gun', cls: 'smg', length: [0.45, 0.7],
    parts: { grip: GUN_GRIP, mag: [0.12, 0.25], barrel: [0.06, 0.25], stock: [0.12, 0.3] },
    recipe: 'REAL (MP5-ish ~0.55-0.7 m): slim receiver (~0.05 wide); short barrel / handguard on the FRONT; long straight or curved mag on the BOTTOM ahead of the grip; grip on the BOTTOM-BACK; retractable / folding stock on the BACK; top rail + iron sights; charging handle tube.',
  },
  rifle: {
    kind: 'gun', cls: 'rifle', length: [0.82, 1.0],
    parts: { grip: GUN_GRIP, barrel: [0.3, 0.5], stock: [0.2, 0.32], mag: [0.16, 0.26], sight: [0.03, 0.2] },
    recipe: 'REAL (AK-47: 880 mm, 415 mm barrel, ~45 mm receiver): stamped receiver (bevelbox ~0.26 x 0.06 x 0.045) above the grip with a dust cover + charging handle on the right; wooden handguard + gas tube on the FRONT, then the barrel with front sight post and slant muzzle brake; CURVED 30-round mag (extrude, forward-curved banana profile, ~0.25 long) on the BOTTOM ahead of the grip; grip (pistolgrip angle ~18); wooden stock on the BACK; rear tangent sight on the receiver top; or for modern rifles: rails (rail macro), optic, polymer furniture.',
  },
  shotgun: {
    kind: 'gun', cls: 'shotgun', length: [0.95, 1.12],
    parts: { grip: GUN_GRIP, barrel: [0.45, 0.7], stock: [0.25, 0.38], under: [0.14, 0.24] },
    recipe: 'REAL (Remington 870: ~1.05 m, 18-28 in barrel, 12 gauge r ~0.011 bore, barrel r ~0.0105-0.012 outer ~0.012): receiver (bevelbox ~0.22 x 0.065 x 0.04, blued steel, ejection port right) ; barrel on the FRONT with a bead sight; tube magazine (cylinder r ~0.011) under the barrel; ribbed pump fore-end (role under, wood or polymer) around the tube; trigger guard; stock with recoil pad on the BACK (wood); grip on the BOTTOM.',
  },
  sniper: {
    kind: 'gun', cls: 'sniper', length: [1.05, 1.3],
    parts: { grip: GUN_GRIP, barrel: [0.5, 0.75], stock: [0.25, 0.4], sight: [0.3, 0.4] },
    recipe: 'REAL (bolt-action, ~1.2 m): long heavy barrel (r ~0.011-0.015) on the FRONT with a muzzle brake; receiver with bolt handle on the right; BIG scope (tube r ~0.015 + bell ends r ~0.025, ~0.35 long) on scope rings on TOP; detachable box mag; chassis / wooden stock with cheek rest on the BACK; folded bipod under the front.',
  },
  lmg: {
    kind: 'gun', cls: 'lmg', length: [0.9, 1.3],
    parts: { grip: GUN_GRIP, barrel: [0.35, 0.7], mag: [0.1, 0.3], stock: [0.15, 0.4] },
    recipe: 'heavy receiver; thick barrel with cooling shroud on the FRONT; box / drum mag on the BOTTOM or side; carry handle on TOP; stock on the BACK; bipod under the front.',
  },
  launcher: {
    kind: 'gun', cls: 'rocket_launcher', length: [0.9, 1.45],
    parts: { grip: GUN_GRIP },
    recipe: 'fat launch tube (r 0.06-0.09) along Z sitting on the shoulder above the grip; flared / themed muzzle on the FRONT; exhaust bell on the BACK; grip + trigger under the tube near the middle; optic on the side / top.',
  },
  grenade_launcher: {
    kind: 'gun', cls: 'grenade_launcher', length: [0.45, 1.0],
    parts: { grip: GUN_GRIP },
    recipe: 'stubby fat barrel or drum; grip under the body; short stock on the BACK; big ladder sight on TOP.',
  },
  flamethrower: {
    kind: 'gun', cls: 'flamethrower', length: [0.7, 1.25],
    parts: { grip: GUN_GRIP, tank: [0.15, 0.45] },
    recipe: 'nozzle body along Z with a flared nozzle + pilot flame on the FRONT; fuel tank(s) (capsule, bright colour) on TOP or BOTTOM; hose (tube) from tank to nozzle; grip on the BOTTOM.',
  },
  bubble_gun: {
    kind: 'gun', cls: 'bubble_gun', length: [0.3, 0.75],
    parts: { grip: GUN_GRIP },
    recipe: 'toy-like rounded body; translucent soap tank on TOP; bubble wand ring / funnel muzzle on the FRONT; chunky grip on the BOTTOM.',
  },
  blowgun: {
    kind: 'gun', cls: 'blowgun', length: [0.6, 1.4],
    parts: {},
    recipe: 'long thin tube along Z, mouthpiece on the BACK, wraps / feathers as accents.',
  },
  crossbow: {
    kind: 'gun', cls: 'crossbow', length: [0.5, 0.95],
    parts: { grip: GUN_GRIP, stock: [0.15, 0.4] },
    recipe: 'stock / tiller along Z; bow limbs (tube or extrude) across X on the FRONT; string (thin tube); loaded bolt on top; grip on the BOTTOM.',
  },
  bow: {
    kind: 'gun', cls: 'crossbow', length: [0.9, 1.5],
    parts: {},
    recipe: 'tall curved limbs (tube) in the YZ plane, grip at the origin, string (thin tube) behind it, arrow nocked along Z.',
  },
  throwable: { kind: 'free', cls: 'throwable', length: [0.06, 1.0], recipe: 'the object itself at real size, held near the origin.' },
  weird: { kind: 'free', cls: 'weird', recipe: 'anything; keep a clear main body, a front (business end) and a grip at the origin.' },
};

const ARCH_RULES: [RegExp, Archetype][] = [
  [/karambit|claw knife|talon knife|hawkbill/i, 'karambit'],
  [/katana|wakizashi|nodachi|odachi|\btachi\b|samurai sword/i, 'katana'],
  [/revolver|six[- ]?shooter|magnum|peacemaker/i, 'revolver'],
  [/sniper|marksman|anti[- ]?materi[ae]l|railgun|long ?rifle/i, 'sniper'],
  [/shotgun|blunderbuss|scattergun|boomstick|double[- ]?barrel/i, 'shotgun'],
  [/flame ?thrower|flamer\b|incinerator|napalm/i, 'flamethrower'],
  [/bubble/i, 'bubble_gun'],
  [/grenade ?launcher|mortar|\blobber\b/i, 'grenade_launcher'],
  [/rocket|bazooka|\brpg\b|launcher|missile/i, 'launcher'],
  [/crossbow/i, 'crossbow'],
  [/\b(long|short|recurve|compound)?bow\b/i, 'bow'],
  [/blow ?gun|blow ?pipe|dart gun/i, 'blowgun'],
  [/\b(lmg|minigun|gatling|machine ?gun|chain ?gun)\b/i, 'lmg'],
  [/\b(smg|uzi|sub ?machine|mp5|mac-?10|tommy gun)\b/i, 'smg'],
  [/rifle|\bak-?47\b|\bm4\b|carbine|musket|assault/i, 'rifle'],
  [/pistol|handgun|glock|deagle|desert eagle|derringer|blaster|ray ?gun|flare gun/i, 'pistol'],
  [/dagger|knife|shiv|stiletto|kunai|\bdirk\b|cleaver|switchblade|bowie/i, 'knife'],
  [/spear|lance|trident|halberd|glaive|\bpike\b|naginata|scythe|polearm/i, 'spear'],
  [/sword|sabre|saber|scimitar|rapier|cutlass|machete|claymore|longsword|broadsword|blade\b/i, 'sword'],
  [/\baxe\b|hatchet|tomahawk|battleaxe|battle axe/i, 'axe'],
  [/hammer|mallet|\bmaul\b|gavel/i, 'hammer'],
  [/\bmace\b|flail|morning ?star|spiked club/i, 'mace'],
  [/\bstaff\b|quarterstaff|\bbo staff\b|walking stick/i, 'staff'],
  [/\bbat\b|club\b|bludgeon|crowbar|baton|nightstick|cudgel|lead pipe/i, 'bat'],
  [/frying pan|\bpan\b|skillet|\bwok\b/i, 'pan'],
];

const CLASS_ARCH: Record<WeaponClass, Archetype> = {
  pistol: 'pistol', smg: 'smg', rifle: 'rifle', shotgun: 'shotgun', sniper: 'sniper', lmg: 'lmg',
  rocket_launcher: 'launcher', grenade_launcher: 'grenade_launcher', flamethrower: 'flamethrower',
  bubble_gun: 'bubble_gun', blowgun: 'blowgun', crossbow: 'crossbow', melee: 'melee', throwable: 'throwable', weird: 'weird',
};

const THROW_RE = /\b(throw|throwing|toss|lob|hurl|chuck|fling|yeet)/i;

/** Archetype named by the text alone (undefined when nothing matches). */
export function archetypeFromText(text: string): Archetype | undefined {
  if (THROW_RE.test(text)) return 'throwable';
  for (const [re, a] of ARCH_RULES) if (re.test(text)) return a;
  return undefined;
}

/**
 * Archetype for a design: the prompt wins, then the design name; it must agree with the class
 * (a melee archetype for a melee design, a gun one for a gun) or the class default is used.
 */
export function detectArchetype(prompt: string, cls: WeaponClass, name = ''): Archetype {
  const fromClass = CLASS_ARCH[cls] ?? 'weird';
  for (const text of [prompt, name]) {
    const a = text ? archetypeFromText(text) : undefined;
    if (!a) continue;
    const bp = BLUEPRINTS[a];
    if (cls === 'weird') return a;
    if (bp.cls === cls) return a;
    if (cls === 'melee' && bp.kind === 'melee') return a;
  }
  return fromClass;
}

/** Class a prompt implies through its archetype (e.g. "revolver" -> pistol), if any. */
export function classFromPrompt(prompt: string): WeaponClass | undefined {
  const a = archetypeFromText(prompt);
  return a ? BLUEPRINTS[a].cls : undefined;
}

/** "giant", "tiny", "comically large": the player asked for unreal proportions. */
export const EXAGGERATION_RE = /\b(giant|huge|massive|colossal|enormous|mega|gigantic|oversized|titanic|titan|tiny|mini|micro|pocket|comically|absurd|ridiculous|huuge|xxl|big ass|two[- ]handed|great ?sword|greataxe)\b/i;

/** Prompt line for an archetype (sizes + recipe). */
export function blueprintPromptLine(a: Archetype): string {
  const bp = BLUEPRINTS[a];
  const parts = Object.entries(bp.parts ?? {})
    .map(([role, r]) => `${role} ${r![0]}-${r![1]} m`)
    .join(', ');
  const len = bp.length ? `total ${bp.length[0]}-${bp.length[1]} m` : '';
  return `${a} (class ${bp.cls}${len ? `, ${len}` : ''}${parts ? `; ${parts}` : ''}): ${bp.recipe}`;
}

// ---------------------------------------------------------------------------
// sockets
// ---------------------------------------------------------------------------

interface Socket {
  parents: ComponentRole[];
  face: AnchorName;
}

const GUN_SOCKETS: Partial<Record<ComponentRole, Socket>> = {
  barrel: { parents: ['core'], face: 'front' },
  muzzle: { parents: ['barrel', 'core'], face: 'front' },
  stock: { parents: ['core'], face: 'back' },
  grip: { parents: ['core'], face: 'bottom' },
  mag: { parents: ['core'], face: 'bottom' },
  sight: { parents: ['core', 'barrel'], face: 'top' },
  under: { parents: ['barrel', 'core'], face: 'bottom' },
};

const MELEE_SOCKETS: Partial<Record<ComponentRole, Socket>> = {
  guard: { parents: ['handle'], face: 'front' },
  blade: { parents: ['guard', 'handle'], face: 'front' },
  head: { parents: ['guard', 'handle'], face: 'front' },
  pommel: { parents: ['handle'], face: 'back' },
};

/** Parts whose position is structural (seated + centred); the rest (deco, tank, catalog) only must touch. */
const STRUCTURAL = new Set<ComponentRole>(['barrel', 'muzzle', 'stock', 'grip', 'mag', 'sight', 'under', 'blade', 'head', 'guard', 'pommel']);

const FACE_AXIS: Record<AnchorName, [number, 1 | -1]> = {
  front: [2, -1], back: [2, 1], top: [1, 1], bottom: [1, -1], right: [0, 1], left: [0, -1], center: [2, -1],
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fix = (v: number) => {
  const r = Number(v.toFixed(4));
  return r === 0 ? 0 : r;
};
const centerOf = (b: Box3): V3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

function invertAffine(a: Affine): Affine {
  const m = a.m;
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const d = Math.abs(det) < 1e-12 ? 1e-12 : det;
  const inv = [
    (m[4] * m[8] - m[5] * m[7]) / d, (m[2] * m[7] - m[1] * m[8]) / d, (m[1] * m[5] - m[2] * m[4]) / d,
    (m[5] * m[6] - m[3] * m[8]) / d, (m[0] * m[8] - m[2] * m[6]) / d, (m[2] * m[3] - m[0] * m[5]) / d,
    (m[3] * m[7] - m[4] * m[6]) / d, (m[1] * m[6] - m[0] * m[7]) / d, (m[0] * m[4] - m[1] * m[3]) / d,
  ];
  const t = a.t;
  return {
    m: inv,
    t: [
      -(inv[0] * t[0] + inv[1] * t[1] + inv[2] * t[2]),
      -(inv[3] * t[0] + inv[4] * t[1] + inv[5] * t[2]),
      -(inv[6] * t[0] + inv[7] * t[1] + inv[8] * t[2]),
    ],
  };
}

/** Effective role for socket logic (melee grips / bodies act as the handle, gun handles as the grip). */
function effRole(c: Component, kind: Kind, list: readonly Component[]): ComponentRole {
  if (kind === 'melee') {
    if (c.role === 'grip') return 'handle';
    if (c.role === 'core' && !list.some(x => x.role === 'handle' || x.role === 'grip')) return 'handle';
  }
  if (kind === 'gun' && c.role === 'handle') return 'grip';
  return c.role;
}

const editable = (c: Component) => !c.locked && !c.catalogPart && !!c.shapes?.length;

// ---------------------------------------------------------------------------
// content scaling (shapes inside a component; children are re-seated afterwards)
// ---------------------------------------------------------------------------

/** Scale a component's geometry by f along its own (component-frame) axes. */
export function scaleComponentContent(c: Component, f: V3): void {
  if (!c.shapes) return;
  for (const s of c.shapes) {
    if (s.pos) s.pos = s.pos.map((v, i) => fix(clamp(v * f[i], -L.maxCoord, L.maxCoord))) as V3;
    const R = eulerMatrix(s.rot ?? [0, 0, 0]);
    const sc = s.scale ?? [1, 1, 1];
    const next = [0, 1, 2].map(k => {
      // component axis most aligned with this shape's local axis k
      let j = 0;
      for (let q = 1; q < 3; q++) if (Math.abs(R[q * 3 + k]) > Math.abs(R[j * 3 + k])) j = q;
      return fix(clamp(sc[k] * f[j], L.minScale, L.maxScale));
    }) as V3;
    if (next.every(v => v === 1)) delete s.scale;
    else s.scale = next;
  }
}

/** Component-frame axis most aligned with each weapon axis, from a world affine. */
function worldToLocalAxis(world: Affine): [number, number, number] {
  const m = world.m;
  return [0, 1, 2].map(i => {
    let j = 0;
    for (let q = 1; q < 3; q++) if (Math.abs(m[i * 3 + q]) > Math.abs(m[i * 3 + j])) j = q;
    return j;
  }) as [number, number, number];
}

// ---------------------------------------------------------------------------
// colour helpers
// ---------------------------------------------------------------------------

function hexRgb(hex: string): V3 {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as V3;
}
function rgbHex(rgb: V3): string {
  return `#${rgb.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
}
/** CIE L* (0-100) */
export function lightness(hex: string): number {
  const lin = hexRgb(hex).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}
function rgbToHsl([r, g, b]: V3): V3 {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}
function hslToRgb([h, s, l]: V3): V3 {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
/** Same hue / saturation, HSL lightness moved until L* reaches `target`. */
export function withLightness(hex: string, target: number): string {
  const [h, s] = rgbToHsl(hexRgb(hex));
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (lightness(rgbHex(hslToRgb([h, s, mid]))) < target) lo = mid;
    else hi = mid;
  }
  return rgbHex(hslToRgb([h, s, (lo + hi) / 2]));
}
function hueOf(hex: string): number {
  return rgbToHsl(hexRgb(hex))[0] * 360;
}
function satOf(hex: string): number {
  return rgbToHsl(hexRgb(hex))[1];
}

const resolve = (c: string, p: DesignPalette): string => (c === 'primary' || c === 'secondary' || c === 'accent' || c === 'glow' ? p[c] : c);

/** Minimum L* gap between primary and secondary, and between adjacent parts. */
export const MIN_CONTRAST = 18;
/** Darkest L* for a palette's primary / any large part (charcoal still reads, pure black is mud). */
export const MIN_BODY_LIGHTNESS = 20;

/**
 * Palette with value structure: primary not near-black, secondary at least MIN_CONTRAST away from
 * primary, accent saturated and distinct from both. Idempotent.
 */
export function refinePalette(p: DesignPalette): DesignPalette {
  const out = { ...p };
  if (lightness(out.primary) < MIN_BODY_LIGHTNESS + 6) out.primary = withLightness(out.primary, MIN_BODY_LIGHTNESS + 8);
  const lp = lightness(out.primary);
  const ls = lightness(out.secondary);
  if (Math.abs(lp - ls) < MIN_CONTRAST) {
    // push secondary away from primary (toward the side with more room)
    const target = lp > 55 ? Math.max(MIN_BODY_LIGHTNESS - 6, lp - MIN_CONTRAST - 4) : Math.min(92, lp + MIN_CONTRAST + 4);
    out.secondary = withLightness(out.secondary, target);
  }
  const la = lightness(out.accent);
  const hueGap = Math.abs(((hueOf(out.accent) - hueOf(out.primary) + 540) % 360) - 180);
  if ((Math.abs(la - lp) < 12 && (hueGap < 40 || satOf(out.accent) < 0.35)) || la < 30) {
    const [h, s] = rgbToHsl(hexRgb(out.accent));
    const hh = hueGap < 40 ? (h + 0.5) % 1 : h;
    out.accent = withLightness(rgbHex(hslToRgb([hh, Math.max(s, 0.7), 0.5])), lp > 60 ? 45 : 70);
  }
  for (const k of ['primary', 'secondary', 'accent', 'glow'] as const) out[k] = sanitizeHex(out[k]) ?? p[k];
  return out;
}

/** Fix one material in place (dark mud + metals that render black without an env map). */
function refineMaterial(m: ShapeMaterial, palette: DesignPalette, bigPart: boolean, tiny = false): void {
  // tiny details (bores, ports, screws) may be as dark as they like
  const isToken = tiny || m.color === 'primary' || m.color === 'secondary' || m.color === 'accent' || m.color === 'glow';
  let hex = resolve(m.color, palette);
  if (!isToken && bigPart && lightness(hex) < MIN_BODY_LIGHTNESS - 4) {
    hex = withLightness(hex, MIN_BODY_LIGHTNESS);
    m.color = hex;
  } else if (!isToken && lightness(hex) < 9) {
    hex = withLightness(hex, 12);
    m.color = hex;
  }
  if (m.metalness !== undefined) {
    // Metals need light to reflect: clients light designs with a PMREM room environment, but very
    // dark, fully metallic surfaces still read as black holes. Cap metalness by lightness.
    // metals turn black. Cap metalness by how light the colour is.
    const cap = fix(0.6 + 0.35 * (lightness(hex) / 100));
    if (m.metalness > cap) m.metalness = cap;
    if (m.roughness !== undefined && m.roughness < 0.25) m.roughness = 0.25;
  }
}

function shapeVolume(s: Shape): number {
  const b = shapeBox(s);
  if (isEmptyBox(b)) return 0;
  const [x, y, z] = boxSize(b);
  return Math.max(x, 0.002) * Math.max(y, 0.002) * Math.max(z, 0.002);
}

/** Volume-weighted dominant (resolved) colour of a component and its L*. */
function dominant(c: Component, palette: DesignPalette): { color: string; ref: string; l: number; glow: boolean } | null {
  if (!c.shapes?.length) return null;
  const vol = new Map<string, number>();
  for (const s of c.shapes) vol.set(s.material.color, (vol.get(s.material.color) ?? 0) + shapeVolume(s));
  let best = '';
  let bv = -1;
  for (const [k, v] of vol) if (v > bv) (bv = v), (best = k);
  const main = c.shapes.find(s => s.material.color === best)!;
  const hex = resolve(best, palette);
  return { color: hex, ref: best, l: lightness(hex), glow: !!main.material.emissive || (main.material.opacity ?? 1) < 0.8 };
}

const STEEL_LIGHT = '#cdd3da';
const STEEL_DARK = '#4b515b';

/** Recolour the child's main material for value contrast against its parent. */
function contrastAgainst(child: Component, parent: Component, palette: DesignPalette, role: ComponentRole, notes: string[]): void {
  const dc = dominant(child, palette);
  const dp = dominant(parent, palette);
  if (!dc || !dp || dc.glow || dp.glow) return;
  // blades / heads are the silhouette's focal point: they get a stronger value break
  if (Math.abs(dc.l - dp.l) >= (role === 'blade' ? 28 : MIN_CONTRAST)) return;
  if (role === 'blade' && dc.l >= 65) return; // bright steel always reads
  let next: string;
  let metal: number | undefined;
  if (role === 'blade') {
    next = dp.l < 58 ? STEEL_LIGHT : STEEL_DARK;
    metal = dp.l < 58 ? 0.6 : 0.4;
  } else {
    const cands = (['secondary', 'primary', 'accent'] as const).filter(t => t !== dc.ref);
    let bestT: string = cands[0];
    let bestGap = -1;
    for (const t of cands) {
      const gap = Math.abs(lightness(palette[t]) - dp.l) - (t === 'accent' ? 6 : 0);
      if (gap > bestGap) (bestGap = gap), (bestT = t);
    }
    next = bestGap + (bestT === 'accent' ? 6 : 0) >= MIN_CONTRAST ? bestT : withLightness(dc.color, dp.l < 50 ? Math.min(90, dp.l + MIN_CONTRAST + 6) : Math.max(15, dp.l - MIN_CONTRAST - 6));
  }
  for (const s of child.shapes!) {
    if (s.material.color !== dc.ref) continue;
    s.material.color = next;
    if (metal !== undefined) {
      s.material.metalness = metal;
      s.material.roughness = 0.35;
    }
  }
  notes.push(`"${child.label}" recoloured for contrast`);
}

// ---------------------------------------------------------------------------
// structural passes
// ---------------------------------------------------------------------------

export interface RefineOptions extends SanitizeOptions {
  /** the player's request (archetype + exaggeration detection) */
  prompt?: string;
  archetype?: Archetype;
}

export interface RefineContext {
  archetype: Archetype;
  bp: Blueprint;
  exaggerated: boolean;
}

export function refineContext(design: Pick<ForgeDesign, 'class' | 'name'>, opts: RefineOptions = {}): RefineContext {
  const archetype = opts.archetype ?? detectArchetype(opts.prompt ?? '', design.class, design.name);
  return { archetype, bp: BLUEPRINTS[archetype], exaggerated: EXAGGERATION_RE.test(`${opts.prompt ?? ''} ${design.name}`) };
}

function socketFor(role: ComponentRole, kind: Kind): Socket | undefined {
  return kind === 'gun' ? GUN_SOCKETS[role] : kind === 'melee' ? MELEE_SOCKETS[role] : undefined;
}

/** Hang structural parts off their canonical parent (keeping their world position). */
function reparent(list: Component[], ctx: RefineContext, only: Set<string> | null, notes: string[]): Component[] {
  const kind = ctx.bp.kind;
  if (kind === 'free') return list;
  let changed = false;
  for (const c of list) {
    if (only && !only.has(c.id)) continue;
    if (c.locked || c === list[0]) continue;
    const role = effRole(c, kind, list);
    const sock = socketFor(role, kind);
    if (!sock) continue;
    const cur = c.parent ? list.find(x => x.id === c.parent) : undefined;
    const curRole = cur ? effRole(cur, kind, list) : undefined;
    if (curRole && (sock.parents.includes(curRole) || curRole === role)) continue;
    // the earliest component with the best-ranked parent role that isn't c's descendant
    const desc = descendantsOf(list, c.id);
    let target: Component | undefined;
    for (const pr of sock.parents) {
      target = list.find(x => x !== c && !desc.has(x.id) && effRole(x, kind, list) === pr && list.indexOf(x) < list.indexOf(c));
      if (!target) target = list.find(x => x !== c && !desc.has(x.id) && effRole(x, kind, list) === pr);
      if (target) break;
    }
    if (!target || target.id === c.parent) continue;
    // keep the world centre: solve the new local translation in the new parent's frame
    const lay = layoutComponents(list);
    const e = lay.get(c.id)!;
    const pe = lay.get(target.id)!;
    if (isEmptyBox(e.localBox) || isEmptyBox(pe.localBox)) continue;
    const worldCentre = centerOf(e.worldBox);
    const inParent = applyAffine(invertAffine(pe.world), worldCentre);
    const anchor = anchorPoint(pe.localBox, sock.face);
    const linear: Affine = { m: [...e.local.m], t: [0, 0, 0] };
    const contentCentre = applyAffine(linear, centerOf(e.localBox));
    c.parent = target.id;
    c.attach = sock.face;
    c.transform.pos = [0, 1, 2].map(i => fix(clamp(inParent[i] - anchor[i] - contentCentre[i], -L.maxCoord, L.maxCoord))) as V3;
    notes.push(`"${c.label}" re-attached to "${target.label}"`);
    changed = true;
  }
  return changed ? fixHierarchy(list) : list;
}

/** Overall length into the archetype range: scale the roots (children follow). */
/**
 * Shapes inside one component must touch each other: a shape floating away from the rest (a knob
 * 10 cm behind its handle) is pulled in until its box touches the others. Bounding boxes, so
 * rotated shapes are approximate. Mutates; returns whether anything moved.
 */
export function compactShapes(c: Component): boolean {
  const shapes = c.shapes;
  if (!shapes || shapes.length < 2) return false;
  let moved = false;
  const boxes = shapes.map(s => shapeBox(s));
  const gapVec = (a: Box3, b: Box3): V3 => {
    const g: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      if (a.min[k] > b.max[k]) g[k] = b.max[k] - a.min[k];
      else if (a.max[k] < b.min[k]) g[k] = b.min[k] - a.max[k];
    }
    return g;
  };
  // biggest shape first; a shape is "lost" when it is far from EVERY other shape compared to its
  // own size (rows of rivets / scutes / studs are spaced on purpose and stay where they are)
  const order = shapes.map((s, i) => ({ i, v: shapeVolume(s) })).sort((a, b) => b.v - a.v).map(x => x.i);
  for (const i of order.slice(1)) {
    const b = boxes[i];
    if (isEmptyBox(b)) continue;
    let best: V3 | null = null;
    let bestD = Infinity;
    for (let j = 0; j < shapes.length; j++) {
      if (j === i || isEmptyBox(boxes[j])) continue;
      const g = gapVec(b, boxes[j]);
      const d = Math.hypot(...g);
      if (d < bestD) (bestD = d), (best = g);
    }
    const own = Math.max(...boxSize(b));
    if (!best || bestD <= Math.max(0.01, 2 * own)) continue;
    const p = shapes[i].pos ?? [0, 0, 0];
    const g = best;
    shapes[i].pos = p.map((v, k) => fix(clamp(v + g[k] + Math.sign(g[k]) * 0.002, -L.maxCoord, L.maxCoord))) as V3;
    boxes[i] = shapeBox(shapes[i]);
    moved = true;
  }
  return moved;
}

function compactAll(list: Component[], only: Set<string> | null, notes: string[]): void {
  for (const c of list) {
    if (only && !only.has(c.id)) continue;
    if (editable(c) && compactShapes(c)) notes.push(`"${c.label}": loose shapes pulled together`);
  }
}

/** Real guns are slim: receiver / slide width cap (m) for these archetypes. */
const SLIM_GUNS = new Set<Archetype>(['pistol', 'revolver', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg']);
/** receiver / slide width (m): Glock slide 25.5 mm, revolver frame ~35 mm, AK receiver ~45 mm */
const SLIM_WIDTH: Partial<Record<Archetype, number>> = { pistol: 0.04, revolver: 0.045, smg: 0.06, rifle: 0.06, shotgun: 0.065, sniper: 0.07, lmg: 0.09 };

/**
 * Realistic shading: round primitives with enough segments get smooth normals, and visible
 * round parts get more segments while the design stays inside the triangle budget.
 */
function smoothRound(list: Component[], maxTris: number, notes: string[]): void {
  const ROUND = new Set(['cylinder', 'sphere', 'capsule', 'lathe', 'torus', 'tube']);
  let budget = maxTris * 0.85 - designTrisEstimate(list);
  let bumped = 0;
  for (const c of list) {
    if (!editable(c)) continue;
    for (const sh of c.shapes!) {
      if (!ROUND.has(sh.type)) continue;
      const rec = sh as unknown as Record<string, number>;
      const key = sh.type === 'sphere' ? 'wseg' : 'seg';
      const seg = rec[key];
      // 3-7 segments = a deliberate polygon (hex drum, octagonal grip): keep it faceted
      if (typeof seg !== 'number' || seg < 8) continue;
      const big = Math.max(...boxSize(shapeBox(sh))) > 0.03;
      const want = big ? (sh.type === 'torus' ? 20 : 16) : 12;
      if (seg < want) {
        const before = shapeTris(sh);
        const prev = seg;
        rec[key] = want;
        if (sh.type === 'sphere' && typeof rec.hseg === 'number' && rec.hseg < 10) rec.hseg = 10;
        const cost = shapeTris(sh) - before;
        if (cost > budget) {
          rec[key] = prev;
        } else {
          budget -= cost;
          bumped++;
        }
      }
      if (rec[key] >= 10 && sh.material.flatShading === undefined) sh.material.flatShading = false;
    }
  }
  if (bumped) notes.push(`${bumped} round shapes smoothed`);
}

const STRIKING = new Set<ComponentRole>(['blade', 'head']);
const MUZZLE_END = new Set<ComponentRole>(['barrel', 'muzzle']);

/** Rotate every root by `rotDeg` about the weapon origin (children follow). */
function rotateRoots(list: Component[], rotDeg: V3): void {
  const R = eulerMatrix(rotDeg);
  for (const c of list) {
    if (c.parent !== undefined) continue;
    const p = c.transform.pos;
    c.transform.pos = [0, 1, 2].map(i => fix(clamp(R[i * 3] * p[0] + R[i * 3 + 1] * p[1] + R[i * 3 + 2] * p[2], -L.maxCoord, L.maxCoord))) as V3;
    const m = eulerMatrix(c.transform.rot);
    const prod = new Array<number>(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) prod[i * 3 + j] = R[i * 3] * m[j] + R[i * 3 + 1] * m[3 + j] + R[i * 3 + 2] * m[6 + j];
    c.transform.rot = matrixToEuler(prod);
  }
}

/**
 * Orientation: melee handles lie along Z with the blade / head toward -Z; gun barrels point -Z.
 * (Models sometimes build an axe standing up, or a gun facing backwards.)
 */
function orient(list: Component[], ctx: RefineContext, notes: string[]): void {
  const kind = ctx.bp.kind;
  if (kind === 'free' || list.some(c => c.locked)) return;
  const lay = layoutComponents(list);
  const centreOfRoles = (roles: Set<ComponentRole>): V3 | undefined => {
    const bs = list.filter(c => roles.has(effRole(c, kind, list))).map(c => lay.get(c.id)!.worldBox).filter(b => !isEmptyBox(b));
    if (!bs.length) return undefined;
    const cs = bs.map(centerOf);
    return [0, 1, 2].map(i => cs.reduce((a, c) => a + c[i], 0) / cs.length) as V3;
  };
  if (kind === 'melee') {
    const h = list.find(c => effRole(c, kind, list) === 'handle');
    if (!h) return;
    const hb = lay.get(h.id)!.worldBox;
    if (isEmptyBox(hb)) return;
    const size = boxSize(hb);
    const hc = centerOf(hb);
    const strike = centreOfRoles(STRIKING);
    const long = size.indexOf(Math.max(...size));
    if (long === 1 && size[1] > size[2] * 1.5) {
      const up = strike ? strike[1] > hc[1] : true;
      rotateRoots(list, [up ? -90 : 90, 0, 0]);
      notes.push('laid the handle along Z');
    } else if (long === 0 && size[0] > size[2] * 1.5) {
      const right = strike ? strike[0] > hc[0] : true;
      rotateRoots(list, [0, right ? -90 : 90, 0]);
      notes.push('laid the handle along Z');
    } else if (strike && strike[2] > hc[2] + size[2] * 0.25) {
      rotateRoots(list, [0, 180, 0]);
      notes.push('turned the striking end forward');
    }
  } else {
    const core = list.find(c => c.role === 'core');
    const muzzle = centreOfRoles(MUZZLE_END);
    if (!core || !muzzle) return;
    const cb = lay.get(core.id)!.worldBox;
    if (isEmptyBox(cb)) return;
    if (muzzle[2] > centerOf(cb)[2] + boxSize(cb)[2] * 0.3) {
      rotateRoots(list, [0, 180, 0]);
      notes.push('turned the muzzle forward');
    }
  }
}

/** Axe / hammer heads lie ACROSS the handle: a head built parallel to the handle is turned 90 degrees. */
function orientHeads(list: Component[], ctx: RefineContext, handle: Component, notes: string[]): void {
  if (ctx.archetype !== 'axe' && ctx.archetype !== 'hammer') return;
  const lay = layoutComponents(list);
  const hs = boxSize(lay.get(handle.id)!.worldBox);
  const hl = hs.indexOf(Math.max(...hs));
  for (const c of list) {
    if (!editable(c) || !STRIKING.has(c.role) || c.id === handle.id) continue;
    const s = boxSize(lay.get(c.id)!.worldBox);
    const cl = s.indexOf(Math.max(...s));
    if (cl !== hl || s[cl] < 1.4 * Math.max(...s.filter((_, i) => i !== cl))) continue;
    if (hl !== 2) continue; // only once the handle lies along Z (orient() runs first)
    // rotate 90 degrees about X (component frame ~ weapon frame: melee parts are rarely rotated)
    const R = eulerMatrix([90, 0, 0]);
    const m = eulerMatrix(c.transform.rot);
    const prod = new Array<number>(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) prod[i * 3 + j] = R[i * 3] * m[j] + R[i * 3 + 1] * m[3 + j] + R[i * 3 + 2] * m[6 + j];
    c.transform.rot = matrixToEuler(prod);
    notes.push(`"${c.label}" turned across the handle`);
  }
}

function clampLength(list: Component[], ctx: RefineContext, notes: string[]): void {
  const range = ctx.bp.length;
  if (!range || ctx.exaggerated || list.some(c => c.locked)) return;
  const b = designBox(layoutComponents(list));
  if (isEmptyBox(b)) return;
  const longest = Math.max(...boxSize(b));
  let f = 1;
  if (longest > range[1] * 1.05) f = range[1] / longest;
  else if (longest < range[0] * 0.95) f = range[0] / longest;
  if (f === 1) return;
  f = clamp(f, 0.3, 3);
  for (const c of list) {
    if (c.parent !== undefined) continue;
    c.transform.pos = c.transform.pos.map(x => fix(x * f)) as V3;
    c.transform.scale = c.transform.scale.map(x => fix(clamp(x * f, L.minScale, L.maxScale))) as V3;
  }
  notes.push(`resized ${longest.toFixed(2)} m -> ${(longest * f).toFixed(2)} m (${ctx.archetype})`);
}

/** Per-role size ranges + hand-scale cross-sections. */
function normalizeParts(list: Component[], ctx: RefineContext, only: Set<string> | null, notes: string[]): void {
  const kind = ctx.bp.kind;
  if (kind === 'free') return;
  let lay = layoutComponents(list);
  for (const c of list) {
    if (only && !only.has(c.id)) continue;
    if (!editable(c)) continue;
    const role = effRole(c, kind, list);
    const e = lay.get(c.id)!;
    if (isEmptyBox(e.worldBox)) continue;
    let size = boxSize(e.worldBox);
    const range = ctx.exaggerated ? undefined : ctx.bp.parts?.[role];
    let touched = false;
    if (range) {
      const longest = Math.max(...size);
      let f = 1;
      if (longest > range[1] * 1.08) f = range[1] / longest;
      else if (longest < range[0] * 0.92) f = range[0] / longest;
      if (f !== 1) {
        f = clamp(f, 0.25, 4);
        scaleComponentContent(c, [f, f, f]);
        touched = true;
        notes.push(`"${c.label}" ${role} resized x${f.toFixed(2)}`);
      }
    }
    // hand-scale: a hand closes around ~3-5 cm
    const caps: (number | undefined)[] =
      kind === 'gun' && role === 'grip'
        ? [0.05, undefined, 0.075]
        : kind === 'melee' && role === 'handle'
          ? [0.06, 0.06, 0.06]
          : kind === 'gun' && role === 'core' && !ctx.exaggerated && SLIM_GUNS.has(ctx.archetype) && c === list.find(x => x.role === 'core')
            ? [SLIM_WIDTH[ctx.archetype] ?? 0.07, undefined, undefined]
            : [];
    if (caps.length) {
      if (touched) {
        lay = layoutComponents(list);
        size = boxSize(lay.get(c.id)!.worldBox);
      }
      const axisMap = worldToLocalAxis(lay.get(c.id)!.world);
      const longAxis = size.indexOf(Math.max(...size));
      const f: V3 = [1, 1, 1];
      for (let i = 0; i < 3; i++) {
        const cap = caps[i];
        if (cap === undefined || (kind === 'melee' && i === longAxis)) continue;
        if (size[i] > cap * 1.05) f[axisMap[i]] = Math.min(f[axisMap[i]], cap / size[i]);
      }
      if (f.some(v => v !== 1)) {
        scaleComponentContent(c, f.map(v => clamp(v, 0.2, 1)) as V3);
        touched = true;
        notes.push(`"${c.label}" slimmed to hand size`);
      }
    }
    if (touched) lay = layoutComponents(list);
  }
}

const SEAT_TOL = 0.004;

/** Seat structural parts flush on their parent's socket face. */
function seat(list: Component[], ctx: RefineContext, only: Set<string> | null, notes: string[]): void {
  const kind = ctx.bp.kind;
  let lay = layoutComponents(list);
  for (const c of list) {
    if (only && !only.has(c.id)) continue;
    if (!editable(c) || c.parent === undefined) continue;
    const parent = list.find(x => x.id === c.parent);
    if (!parent || parent.catalogPart) continue;
    const role = effRole(c, kind, list);
    const sock = socketFor(role, kind);
    const structural = STRUCTURAL.has(role) && kind !== 'free';
    // non-structural parts (deco, tanks, sights on odd spots) only need to touch (sanitizeDesign's
    // snap does that) - but not corner-to-corner: a part on a named face must overlap that face
    if (!structural || !sock) {
      if (typeof c.attach !== 'string' || c.attach === 'center') continue;
      const e = lay.get(c.id)!;
      const pBox = lay.get(parent.id)!.localBox;
      if (isEmptyBox(pBox) || isEmptyBox(e.localBox)) continue;
      const cb = transformBox(e.localBox, e.local);
      const cs = boxSize(cb);
      const ps = boxSize(pBox);
      const [a] = FACE_AXIS[c.attach];
      const delta: V3 = [0, 0, 0];
      for (let b = 0; b < 3; b++) {
        if (b === a) continue;
        const ov = Math.min(cb.max[b], pBox.max[b]) - Math.max(cb.min[b], pBox.min[b]);
        if (ov >= 0.15 * Math.min(cs[b], ps[b])) continue;
        const cc = (cb.min[b] + cb.max[b]) / 2;
        const half = Math.min(cs[b] / 2, ps[b] / 2);
        delta[b] = (cs[b] >= ps[b] ? (pBox.min[b] + pBox.max[b]) / 2 : clamp(cc, pBox.min[b] + half, pBox.max[b] - half)) - cc;
      }
      if (Math.hypot(...delta) < 1e-4) continue;
      c.transform.pos = c.transform.pos.map((v, i) => fix(clamp(v + delta[i], -L.maxCoord, L.maxCoord))) as V3;
      notes.push(`"${c.label}" moved onto the ${c.attach} of "${parent.label}"`);
      lay = layoutComponents(list);
      continue;
    }
    const e = lay.get(c.id)!;
    const pBox = lay.get(parent.id)!.localBox;
    if (isEmptyBox(pBox) || isEmptyBox(e.localBox)) continue;
    const cb = transformBox(e.localBox, e.local);
    const cs = boxSize(cb);
    const ps = boxSize(pBox);
    const cc = centerOf(cb);
    const pc = centerOf(pBox);
    const delta: V3 = [0, 0, 0];
    // face: the socket (structural) or the declared named anchor
    const face: AnchorName = sock.face;
    // parts set INTO their parent (revolver drum, pump around a barrel) are deliberate: leave them
    const loose = role === 'mag' || role === 'under' || role === 'sight';
    {
      // the socket direction is in WEAPON space (front = -Z): find it in the parent's frame
      const pw = lay.get(parent.id)!.world.m;
      const [wa, ws] = FACE_AXIS[face];
      const local = [0, 1, 2].map(j => pw[wa * 3 + j] * ws);
      const a = [0, 1, 2].reduce((best, j) => (Math.abs(local[j]) > Math.abs(local[best]) ? j : best), 0);
      const s: 1 | -1 = local[a] < 0 ? -1 : 1;
      // parent-frame axis that maps to the weapon's X (symmetry plane normal)
      const xa = [0, 1, 2].reduce((best, j) => (Math.abs(pw[j]) > Math.abs(pw[best]) ? j : best), 0);
      const pFace = s < 0 ? pBox.min[a] : pBox.max[a];
      const cNear = s < 0 ? cb.max[a] : cb.min[a];
      const cFar = s < 0 ? cb.min[a] : cb.max[a];
      const pen = s < 0 ? cNear - pFace : pFace - cNear; // >0 overlaps into the parent, <0 gap
      const crosswise = (role === 'head' || role === 'guard') && a === 2 && cs[2] < Math.max(cs[0], cs[1]) * 0.8;
      const want = crosswise
        ? cs[a] * (role === 'guard' ? 0.5 : 0.7)
        : role === 'mag' && kind === 'gun'
          ? Math.min(cs[a] * 0.35, 0.03)
          : clamp(Math.min(cs[a], ps[a]) * 0.12, 0.002, 0.02);
      const margin = 0.25 * ps[a];
      const wrongSide = !loose && (s < 0 ? cc[a] > pc[a] + margin : cc[a] < pc[a] - margin);
      const swallowed = s < 0 ? cFar > pFace - 0.005 : cFar < pFace + 0.005;
      const mustProtrude = role === 'blade' || role === 'head' || role === 'barrel' || role === 'muzzle' || role === 'stock' || role === 'grip' || role === 'pommel';
      const tooDeep = !loose && pen > Math.max(want * 1.8, want + 0.012);
      if (pen < -SEAT_TOL || wrongSide || (mustProtrude && swallowed) || tooDeep) {
        const target = pFace - s * want;
        delta[a] = target - cNear;
      }
      // lateral: overlap the face, structural parts on the symmetry plane
      for (let b = 0; b < 3; b++) {
        if (b === a) continue;
        const twin = list.some(x => x !== c && x.parent === c.parent && x.role === c.role);
        if (b === xa && !twin && Math.abs(cc[b] - pc[b]) > 0.002) {
          delta[b] = pc[b] - cc[b];
          continue;
        }
        const ov = Math.min(cb.max[b], pBox.max[b]) - Math.max(cb.min[b], pBox.min[b]);
        const need = (loose ? 0.1 : 0.3) * Math.min(cs[b], ps[b]);
        if (ov < need) {
          const half = cs[b] / 2;
          const lo = pBox.min[b] + Math.min(half, ps[b] / 2);
          const hi = pBox.max[b] - Math.min(half, ps[b] / 2);
          const target = cs[b] >= ps[b] ? pc[b] : clamp(cc[b], lo, hi);
          delta[b] = target - cc[b];
        }
      }
    }
    if (Math.hypot(...delta) < 1e-4) continue;
    const before = c.transform.pos.join();
    c.transform.pos = c.transform.pos.map((v, i) => fix(clamp(v + delta[i], -L.maxCoord, L.maxCoord))) as V3;
    if (c.transform.pos.join() === before) continue;
    if (Math.hypot(...delta) > 0.01) notes.push(`"${c.label}" seated on "${parent.label}" (moved ${Math.hypot(...delta).toFixed(2)} m)`);
    lay = layoutComponents(list);
  }
}

/** Hand at the origin: guns -> top of the grip, melee -> middle of the handle. */
function alignHand(list: Component[], ctx: RefineContext, notes: string[]): void {
  const kind = ctx.bp.kind;
  if (kind === 'free' || list.some(c => c.locked)) return;
  const lay = layoutComponents(list);
  const want: ComponentRole = kind === 'gun' ? 'grip' : 'handle';
  const h = list.find(c => effRole(c, kind, list) === want && !isEmptyBox(lay.get(c.id)!.worldBox));
  if (!h) return;
  const b = lay.get(h.id)!.worldBox;
  const size = boxSize(b);
  let hand: V3;
  if (kind === 'gun') {
    hand = [(b.min[0] + b.max[0]) / 2, b.max[1] - Math.min(0.035, size[1] * 0.3), (b.min[2] + b.max[2]) / 2];
  } else {
    const c = centerOf(b);
    // long shafts (spear / staff / axe / hammer): hand toward the back third
    const long = size[2] > 0.3 ? b.max[2] - size[2] * 0.3 : c[2];
    hand = [c[0], c[1], long];
  }
  if (Math.hypot(...hand) < 0.03) return;
  for (const c of list) {
    if (c.parent !== undefined) continue;
    c.transform.pos = c.transform.pos.map((v, i) => fix(clamp(v - hand[i], -L.maxCoord, L.maxCoord))) as V3;
  }
  notes.push(`grip moved to the hand (${Math.hypot(...hand).toFixed(2)} m)`);
}

/** Materials: dark lift / metal caps, parent-child contrast, emissive restraint. */
function refineMaterials(list: Component[], palette: DesignPalette, ctx: RefineContext, only: Set<string> | null, notes: string[]): void {
  const kind = ctx.bp.kind;
  const lay = layoutComponents(list);
  let total = 0;
  const vols = new Map<string, number>();
  for (const c of list) {
    const e = lay.get(c.id)!;
    if (isEmptyBox(e.worldBox)) continue;
    const [x, y, z] = boxSize(e.worldBox);
    const v = Math.max(x, 0.005) * Math.max(y, 0.005) * Math.max(z, 0.005);
    vols.set(c.id, v);
    total += v;
  }
  for (const c of list) {
    if (only && !only.has(c.id)) continue;
    if (!editable(c)) continue;
    const big = (vols.get(c.id) ?? 0) / Math.max(total, 1e-9) > 0.12 || STRUCTURAL.has(c.role) || c.role === 'core' || c.role === 'handle';
    for (const s of c.shapes!) refineMaterial(s.material, palette, big, shapeVolume(s) < 2e-5);
  }
  for (const c of list) {
    if (only && !only.has(c.id)) continue;
    if (!editable(c) || !c.parent) continue;
    const p = list.find(x => x.id === c.parent);
    if (!p || !p.shapes?.length) continue;
    const role = effRole(c, kind, list);
    const pairs = kind === 'melee' ? ['blade', 'head', 'handle', 'pommel', 'guard'] : kind === 'gun' ? ['grip', 'stock', 'under'] : [];
    if (pairs.includes(role)) contrastAgainst(c, p, palette, role, notes);
  }
  if (only) return;
  // emissive restraint: glow on <= ~20% of the weapon
  let glowVol = 0;
  for (const c of list) if (c.shapes?.some(s => s.material.emissive && (s.material.emissiveIntensity ?? 1) > 0.5)) glowVol += vols.get(c.id) ?? 0;
  if (glowVol / Math.max(total, 1e-9) > 0.35) {
    for (const c of [...list].sort((a, b) => (vols.get(b.id) ?? 0) - (vols.get(a.id) ?? 0))) {
      if (!editable(c) || glowVol / Math.max(total, 1e-9) <= 0.35) continue;
      const lit = c.shapes!.filter(s => s.material.emissive && (s.material.emissiveIntensity ?? 1) > 0.5);
      if (!lit.length) continue;
      for (const s of lit) s.material.emissiveIntensity = 0.35;
      glowVol -= vols.get(c.id) ?? 0;
      notes.push(`"${c.label}" glow toned down`);
    }
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------
// macro guard rails + auto-detailing
// ---------------------------------------------------------------------------

/** blade macro curve range per archetype (a katana is barely curved, a karambit is a claw) */
const BLADE_CURVE: Partial<Record<Archetype, Range>> = {
  katana: [0.01, 0.035], sword: [-0.05, 0.3], knife: [-0.15, 0.2], karambit: [-1, -0.65], spear: [-0.05, 0.05], axe: [-0.3, 0.3],
};

/**
 * Archetype guard rails on a RAW component before its macros are expanded (e.g. clamp a katana's
 * blade curve). Returns a shallow copy when something changed.
 */
const BLADE_TYPES = new Set(['blade', 'knifeblade', 'swordblade']);

export function adjustRawMacros<T>(raw: T, archetype: Archetype): T {
  const range = BLADE_CURVE[archetype];
  const r = raw as unknown as Record<string, unknown>;
  if (!range || !r || !Array.isArray(r.shapes)) return raw;
  let changed = false;
  const shapes = r.shapes.map(sh => {
    const o = sh as Record<string, unknown>;
    if (!o || typeof o !== 'object' || !BLADE_TYPES.has(String(o.type ?? '').trim().toLowerCase().replace(/[\s_-]/g, ''))) return sh;
    const c = typeof o.curve === 'number' ? o.curve : 0;
    const k = clamp(c, range[0], range[1]);
    if (k === c && !(archetype === 'katana' && (!o.tip || o.tip === 'point'))) return sh;
    changed = true;
    return { ...o, curve: k, ...(archetype === 'karambit' && !o.tip ? { tip: 'hook' } : {}), ...(archetype === 'katana' && (!o.tip || o.tip === 'point') ? { tip: 'kissaki' } : {}) };
  });
  return changed ? ({ ...r, shapes } as unknown as T) : raw;
}

const DETAIL_GUNS = new Set<Archetype>(['pistol', 'revolver', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg']);
const DARK = '#1b1d20';

/**
 * Small realistic details guns almost always have, added as extra shapes when the model left them
 * out: dark bore at the muzzle, trigger + trigger guard ahead of the grip, front / rear sights,
 * ejection port. Only touches unlocked from-scratch components with room for more shapes.
 */
function autoDetail(list: Component[], ctx: RefineContext, notes: string[]): void {
  if (ctx.bp.kind !== 'gun' || !DETAIL_GUNS.has(ctx.archetype)) return;
  // children hang off their parent's box faces: adding shapes may grow the box, so remember where
  // every child's anchor was and put it back afterwards
  const before = layoutComponents(list);
  try {
    autoDetailInner(list, ctx, notes);
  } finally {
    const after = layoutComponents(list);
    for (const c of list) {
      if (c.parent === undefined || c.locked) continue;
      const a0 = before.get(c.id)?.anchor;
      const a1 = after.get(c.id)?.anchor;
      if (!a0 || !a1 || Array.isArray(c.attach)) continue;
      const d = [0, 1, 2].map(i => a0[i] - a1[i]);
      if (Math.hypot(...d) > 1e-6) c.transform.pos = c.transform.pos.map((v, i) => fix(clamp(v + d[i], -L.maxCoord, L.maxCoord))) as V3;
    }
  }
}

function autoDetailInner(list: Component[], ctx: RefineContext, notes: string[]): void {
  const text = list.map(c => `${c.id} ${c.label}`).join(' ').toLowerCase();
  const core = list.find(c => c.role === 'core');
  const lay = layoutComponents(list);
  const room = (c: Component, n: number) => editable(c) && c.shapes!.length + n <= L.maxShapesPerComponent;
  const added: string[] = [];
  // bore: the dark hole at the muzzle end of the front-most barrel / muzzle
  const tubes = list.filter(c => (c.role === 'muzzle' || c.role === 'barrel') && editable(c));
  const front = tubes.sort((a, b) => lay.get(a.id)!.worldBox.min[2] - lay.get(b.id)!.worldBox.min[2])[0];
  const BORE = '#0b0c0e';
  if (front && room(front, 1) && !/\bbore\b/.test(text) && !front.shapes!.some(s => s.material.color === BORE)) {
    const b = lay.get(front.id)!.localBox;
    const sz = boxSize(b);
    const r = Math.min(sz[0], sz[1]) / 2;
    if (sz[2] > Math.max(sz[0], sz[1]) * 0.25 && r > 0.004 && r < 0.05) {
      const c = centerOf(b);
      front.shapes!.push({ type: 'cylinder', rTop: fix(r * 0.55), rBottom: fix(r * 0.55), h: 0.003, seg: 12, pos: [fix(c[0]), fix(c[1]), fix(b.min[2] - 0.001)], rot: [90, 0, 0], material: { color: BORE, roughness: 1 } });
      added.push('bore');
    }
  }
  // DARK marks details added by an earlier pass (idempotent)
  if (!core || !room(core, 1) || core.shapes!.some(s => s.material.color === DARK)) {
    if (added.length) notes.push(`details added: ${added.join(', ')}`);
    return;
  }
  const B = lay.get(core.id)!.localBox;
  if (isEmptyBox(B)) return;
  const S = boxSize(B);
  const C = centerOf(B);
  const grip = list.find(c => c.role === 'grip' && c.parent === core.id);
  const hasGuard = list.some(c => c.shapes?.some(s => s.type === 'torus' && s.arc !== undefined && s.arc < 300));
  if (grip && !/trigger/.test(text) && !hasGuard && room(core, 2)) {
    const ge = lay.get(grip.id)!;
    const G = transformBox(ge.localBox, ge.local);
    if (!isEmptyBox(G)) {
      const z = fix(G.min[2] - 0.019);
      core.shapes!.push(
        { type: 'torus', r: 0.02, tube: 0.0032, seg: 12, arc: 180, pos: [fix(C[0]), fix(B.min[1]), z], rot: [0, 90, 180], material: { color: 'primary', metalness: 0.5, roughness: 0.5 } },
        { type: 'box', size: [0.005, 0.017, 0.005], pos: [fix(C[0]), fix(B.min[1] - 0.009), fix(z + 0.004)], rot: [-15, 0, 0], material: { color: DARK, metalness: 0.4 } },
      );
      added.push('trigger guard');
    }
  }
  const hasSight = list.some(c => c.role === 'sight') || /sight|scope|optic/.test(text);
  if (!hasSight && ctx.archetype !== 'sniper' && room(core, 2) && S[2] > 0.08) {
    core.shapes!.push(
      { type: 'box', size: [0.004, 0.007, 0.008], pos: [fix(C[0]), fix(B.max[1] + 0.0035), fix(B.min[2] + 0.012)], material: { color: DARK, metalness: 0.5 } },
      { type: 'box', size: [0.016, 0.008, 0.01], pos: [fix(C[0]), fix(B.max[1] + 0.004), fix(B.max[2] - 0.016)], material: { color: DARK, metalness: 0.5 } },
    );
    added.push('sights');
  }
  if (ctx.archetype !== 'revolver' && !/eject|port/.test(text) && room(core, 1) && S[2] > 0.1 && S[1] > 0.02) {
    core.shapes!.push({
      type: 'box', size: [0.002, fix(Math.min(0.014, S[1] * 0.4)), fix(Math.min(0.05, S[2] * 0.22))],
      pos: [fix(B.max[0] + 0.0004), fix(C[1] + S[1] * 0.15), fix(C[2] - S[2] * 0.08)], material: { color: DARK, roughness: 0.7 },
    });
    added.push('ejection port');
  }
  if (added.length) notes.push(`details added: ${added.join(', ')}`);
}

/**
 * Refine one freshly streamed component in the context of the components before it (parents
 * first): reparent, size, seat, materials. Returns a refined copy; `prior` is not modified.
 */
export function refineIncoming(prior: readonly Component[], comp: Component, palette: DesignPalette, ctx: RefineContext, notes: string[] = []): Component {
  if (comp.locked || comp.catalogPart) return comp;
  let list = [...prior.map(c => clone(c)), clone(comp)];
  const id = comp.id;
  const only = new Set([id]);
  compactAll(list, only, notes);
  list = reparent(list, ctx, only, notes);
  normalizeParts(list, ctx, only, notes);
  seat(list, ctx, only, notes);
  refineMaterials(list, palette, ctx, only, notes);
  return list.find(c => c.id === id) ?? comp;
}

export interface RefineResult {
  design: ForgeDesign;
  notes: string[];
  archetype: Archetype;
}

/** Full refinement of a sanitized design; the result is sanitized again (stats, reach, carry). */
export function refineDesign(input: ForgeDesign, opts: RefineOptions = {}): RefineResult {
  const notes: string[] = [];
  const d = clone(input);
  const ctx = refineContext(d, opts);
  d.palette = refinePalette(d.palette);
  let list = d.components;
  if (list.length) {
    compactAll(list, null, notes);
    list = reparent(list, ctx, null, notes);
    orient(list, ctx, notes);
    // heads that were parallel to a standing handle are now parallel to the laid-down one
    {
      const h = list.find(c => effRole(c, ctx.bp.kind, list) === 'handle');
      if (h && ctx.bp.kind === 'melee' && !list.some(c => c.locked)) orientHeads(list, ctx, h, notes);
    }
    clampLength(list, ctx, notes);
    normalizeParts(list, ctx, null, notes);
    // seating moves children relative to parents: two passes settle chains (guard -> blade)
    seat(list, ctx, null, notes);
    seat(list, ctx, null, notes);
    alignHand(list, ctx, notes);
    refineMaterials(list, d.palette, ctx, null, notes);
    if (!list.some(c => c.locked)) autoDetail(list, ctx, notes);
    smoothRound(list, opts.maxTris ?? L.maxTris, notes);
  }
  d.components = list;
  // reach / carry weight are re-derived from the refined model
  if (d.stats.melee) delete (d.stats.melee as { reach?: number }).reach;
  const res = sanitizeDesign(d, opts);
  return { design: res.design, notes: [...notes, ...res.warnings], archetype: ctx.archetype };
}
