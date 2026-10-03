// Outfit DSL ("Closet"): body proportions + armour / clothing pieces attached to body sockets of
// the procedural humanoid. Pure types + constants (no runtime deps): bundled into the SpacetimeDB
// module.
//
// Pieces reuse the Forge shape vocabulary (box / cylinder / sphere / ... + macros in the forge
// service) and PBR materials. Every piece sits on one SOCKET: its shapes are written in the socket
// frame (metres for a standard 1.8 m body, origin at the socket, forward = -Z, up = +Y, the
// character's right = +X). The body's build / head proportions stretch the socket frame, the
// overall size scales the whole character, so armour always follows the body it was made for.
//
// Gameplay: only `body` matters (size -> max HP, hitbox, speed: see ./balance). Pieces are cosmetic.

import type { DesignPalette, Shape, Transform } from '../forge/types';

export const OUTFIT_DSL_VERSION = 1;

/** Humanoid bones (rigid segments) pieces are baked onto. */
export const BONES = ['hips', 'upper', 'armL', 'armR', 'thighL', 'thighR', 'shinL', 'shinR'] as const;
export type BoneName = (typeof BONES)[number];

export const SOCKETS = [
  'head',
  'face',
  'torso',
  'back',
  'belt',
  'shoulderL',
  'shoulderR',
  'armL',
  'armR',
  'handL',
  'handR',
  'thighL',
  'thighR',
  'shinL',
  'shinR',
  'footL',
  'footR',
] as const;
export type SocketName = (typeof SOCKETS)[number];

export interface SocketInfo {
  bone: BoneName;
  /** body segment the socket wraps: half extents (m, standard body) around the socket origin */
  half: [number, number, number];
  /** max distance (per axis) of a piece's centre from the socket origin */
  reach: number;
  /** longest side of one piece (m) */
  maxSize: number;
  /** what the LLM is told about the frame */
  hint: string;
  /** mirror partner (L <-> R) */
  mirror?: SocketName;
}

export const SOCKET_INFO: Record<SocketName, SocketInfo> = {
  head: { bone: 'upper', half: [0.16, 0.2, 0.16], reach: 0.3, maxSize: 0.75, hint: 'centre of the head (head cube 0.28 wide, 0.30 tall, 0.28 deep; face toward -Z, crown at y=+0.15)' },
  face: { bone: 'upper', half: [0.13, 0.09, 0.1], reach: 0.2, maxSize: 0.4, hint: 'front of the face at eye height (visors, masks, goggles, beards); the face plane is z=0, outward is -Z' },
  torso: { bone: 'hips', half: [0.25, 0.3, 0.14], reach: 0.3, maxSize: 1.0, hint: 'centre of the chest/torso box (0.50 wide, 0.60 tall, 0.28 deep); chest front at z=-0.14, shoulders at y=+0.3, waist at y=-0.3' },
  back: { bone: 'hips', half: [0.25, 0.3, 0.06], reach: 0.5, maxSize: 1.3, hint: 'middle of the back surface (capes, backpacks, jetpacks, wings, quivers); outward is +Z, cape hangs down to y=-0.9 (knees)' },
  belt: { bone: 'hips', half: [0.25, 0.06, 0.14], reach: 0.25, maxSize: 0.7, hint: 'waist ring at the hips (belts, pouches, holsters, skirts / tassets hang down to y=-0.3)' },
  shoulderL: { bone: 'upper', half: [0.08, 0.07, 0.08], reach: 0.2, maxSize: 0.45, hint: 'top of the left shoulder joint (pauldrons, shoulder pads); outward is -X', mirror: 'shoulderR' },
  shoulderR: { bone: 'upper', half: [0.08, 0.07, 0.08], reach: 0.2, maxSize: 0.45, hint: 'top of the right shoulder joint; outward is +X', mirror: 'shoulderL' },
  armL: { bone: 'armL', half: [0.07, 0.07, 0.27], reach: 0.2, maxSize: 0.6, hint: 'middle of the left arm, which points FORWARD along -Z (aiming pose): length runs along Z (shoulder z=+0.27, wrist z=-0.27); bracers / sleeves wrap around Z', mirror: 'armR' },
  armR: { bone: 'armR', half: [0.07, 0.07, 0.27], reach: 0.2, maxSize: 0.6, hint: 'middle of the right arm (points forward along -Z)', mirror: 'armL' },
  handL: { bone: 'armL', half: [0.06, 0.06, 0.06], reach: 0.12, maxSize: 0.3, hint: 'the left hand / wrist (gloves, gauntlets); fingers toward -Z', mirror: 'handR' },
  handR: { bone: 'armR', half: [0.06, 0.06, 0.06], reach: 0.12, maxSize: 0.3, hint: 'the right hand (holds the weapon: keep gloves thin)', mirror: 'handL' },
  thighL: { bone: 'thighL', half: [0.1, 0.23, 0.11], reach: 0.2, maxSize: 0.55, hint: 'middle of the left thigh (0.20 wide, 0.46 tall): hip at y=+0.23, knee at y=-0.23', mirror: 'thighR' },
  thighR: { bone: 'thighR', half: [0.1, 0.23, 0.11], reach: 0.2, maxSize: 0.55, hint: 'middle of the right thigh', mirror: 'thighL' },
  shinL: { bone: 'shinL', half: [0.09, 0.22, 0.1], reach: 0.2, maxSize: 0.55, hint: 'middle of the left shin (knee at y=+0.22, ankle at y=-0.22): greaves, knee pads (front = -Z)', mirror: 'shinR' },
  shinR: { bone: 'shinR', half: [0.09, 0.22, 0.1], reach: 0.2, maxSize: 0.55, hint: 'middle of the right shin', mirror: 'shinL' },
  footL: { bone: 'shinL', half: [0.09, 0.04, 0.14], reach: 0.15, maxSize: 0.4, hint: 'the left foot on the ground (boots, sabatons); sole at y=-0.04, toes toward -Z', mirror: 'footR' },
  footR: { bone: 'shinR', half: [0.09, 0.04, 0.14], reach: 0.15, maxSize: 0.4, hint: 'the right foot', mirror: 'footL' },
};

/** Body proportions (all multipliers of the standard 1.8 m body). */
export interface OutfitBody {
  /** overall size (height, and everything with it) */
  size: number;
  /** width / bulk of torso and limbs */
  build: number;
  /** head size relative to the body */
  head: number;
  /** arm length (cosmetic) */
  limbs: number;
}

export interface OutfitPiece {
  /** stable short id, [a-z0-9_-]{1,24}, unique in the outfit */
  id: string;
  /** what it is, e.g. "great helm", "left pauldron" */
  label: string;
  socket: SocketName;
  /** offset / rotation / scale of the piece in the socket frame */
  transform: Transform;
  shapes: Shape[];
  /** also place a mirrored copy on the partner socket (L <-> R) */
  mirror?: boolean;
  /** editor: kept verbatim by reprompts */
  locked?: boolean;
}

export interface OutfitDesign {
  v: number;
  name: string;
  /** free-text silhouette theme ("knight", "astronaut", "banana mascot") */
  theme: string;
  body: OutfitBody;
  /** skin colour (face / hands when uncovered) */
  skin: string;
  /** palette tokens: primary = suit, secondary = limbs / undersuit, accent, glow */
  palette: DesignPalette;
  pieces: OutfitPiece[];
}

export const OUTFIT_LIMITS = {
  maxPieces: 24,
  maxShapesPerPiece: 12,
  /** whole outfit (mirrored copies count twice) */
  maxTris: 5000,
  maxNameLength: 40,
  maxThemeLength: 40,
  maxLabelLength: 48,
  /** register_outfit / service payload limit */
  maxOutfitJson: 64_000,
} as const;
