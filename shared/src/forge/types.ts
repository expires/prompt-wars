// Forge DSL: a JSON weapon *design* the LLM writes from scratch (shapes) or from catalog parts.
// Pure types + constants (no runtime deps): bundled into the SpacetimeDB module.
//
// Coordinate conventions (metres): forward = -Z, up = +Y, right = +X.
//   Guns:  the grip / trigger hand is at the origin, the muzzle points toward -Z.
//   Melee: the hand is at the origin, the striking end points toward -Z (blade / head forward),
//          the rest of the handle / pommel toward +Z.
// Rotations are Euler degrees, order XYZ (same as THREE.Euler 'XYZ').
// Primitive axes: cylinder / cone / capsule / lathe stand along +Y (rot [90,0,0] lays them along Z;
// a cone tip points +Y, so rot [-90,0,0] points it at -Z); torus lies in the XY plane (hole along Z);
// extrude takes an XY outline and extrudes it along Z, centred on z = 0.

import type { FireMode, WeaponClass } from '../weapon';
import type { MeleeMeta } from '../melee';
import type { Element } from '../elements';

export const FORGE_DSL_VERSION = 1;

export const COMPONENT_ROLES = [
  'core',
  'barrel',
  'muzzle',
  'stock',
  'grip',
  'mag',
  'sight',
  'under',
  'tank',
  'blade',
  'head',
  'handle',
  'guard',
  'pommel',
  'deco',
] as const;
export type ComponentRole = (typeof COMPONENT_ROLES)[number];

/** Named anchor on the parent's bounding box (face centres), or an explicit point in parent space. */
export const ANCHORS = ['front', 'back', 'top', 'bottom', 'left', 'right', 'center'] as const;
export type AnchorName = (typeof ANCHORS)[number];
export type Anchor = AnchorName | [number, number, number];

export type V3 = [number, number, number];
export type V2 = [number, number];

export interface Transform {
  pos: V3;
  /** Euler degrees, XYZ order */
  rot: V3;
  scale: V3;
}

/** Hex '#rrggbb' or a palette token. Tokens follow the design palette (recolouring is free). */
export type ColorRef = string;
export const PALETTE_TOKENS = ['primary', 'secondary', 'accent', 'glow'] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];

export interface ShapeMaterial {
  color: ColorRef;
  metalness?: number;
  roughness?: number;
  emissive?: ColorRef;
  emissiveIntensity?: number;
  /** 0.15 - 1 (transparent below 1, e.g. bubble tanks, glass) */
  opacity?: number;
  /** default true (low-poly look) */
  flatShading?: boolean;
}

interface ShapeBase {
  pos?: V3;
  rot?: V3;
  scale?: V3;
  material: ShapeMaterial;
}

export interface BoxShape extends ShapeBase { type: 'box'; size: V3 }
export interface CylinderShape extends ShapeBase { type: 'cylinder'; rTop: number; rBottom: number; h: number; seg?: number }
export interface ConeShape extends ShapeBase { type: 'cone'; r: number; h: number; seg?: number }
export interface SphereShape extends ShapeBase { type: 'sphere'; r: number; wseg?: number; hseg?: number }
export interface TorusShape extends ShapeBase { type: 'torus'; r: number; tube: number; seg?: number; arc?: number }
export interface CapsuleShape extends ShapeBase { type: 'capsule'; r: number; h: number; seg?: number }
/** points: [radius, y] profile revolved around +Y */
export interface LatheShape extends ShapeBase { type: 'lathe'; points: V2[]; seg?: number }
/** outline: [x, y] polygon in the XY plane, extruded `depth` along Z (centred) */
export interface ExtrudeShape extends ShapeBase { type: 'extrude'; outline: V2[]; depth: number; bevel?: number }
/** path: smooth curve through [x, y, z] points, radius r */
export interface TubeShape extends ShapeBase { type: 'tube'; path: V3[]; r: number; seg?: number }

export type Shape =
  | BoxShape
  | CylinderShape
  | ConeShape
  | SphereShape
  | TorusShape
  | CapsuleShape
  | LatheShape
  | ExtrudeShape
  | TubeShape;
export type ShapeType = Shape['type'];
export const SHAPE_TYPES: readonly ShapeType[] = ['box', 'cylinder', 'cone', 'sphere', 'torus', 'capsule', 'lathe', 'extrude', 'tube'];

export interface CatalogPartRef {
  partId: string;
  color?: string;
  accent?: string;
}

export interface Component {
  /** stable short id, [a-z0-9_-]{1,24}, unique in the design */
  id: string;
  /** what it is, e.g. "fluted barrel", "crocodile-jaw muzzle" */
  label: string;
  role: ComponentRole;
  /** parent component id (its transform is relative to the parent's frame + anchor) */
  parent?: string;
  /** where on the parent it attaches (default 'center'); ignored for root components */
  attach?: Anchor;
  transform: Transform;
  /** exactly one of catalogPart / shapes */
  catalogPart?: CatalogPartRef;
  shapes?: Shape[];
  /** editor: kept verbatim by reprompts */
  locked?: boolean;
}

export interface DesignPalette {
  primary: string;
  secondary: string;
  accent: string;
  /** emissive / energy colour */
  glow: string;
}

export const PROJECTILE_SHAPES = ['pellet', 'bolt', 'rocket', 'sphere', 'bubble', 'arrow', 'blob', 'disc', 'shard'] as const;
export type ProjectileShape = (typeof PROJECTILE_SHAPES)[number];
export const TRAILS = ['none', 'smoke', 'spark', 'fire', 'bubble', 'glow'] as const;
export type Trail = (typeof TRAILS)[number];

export interface DesignFx {
  muzzleFlashColor?: string;
  projectileColor?: string;
  projectileShape?: ProjectileShape;
  /** 0.2 - 3 */
  projectileScale?: number;
  trail?: Trail;
  trailColor?: string;
}

// ---------------------------------------------------------------------------
// Projectile (optional, cosmetic): the model of what the weapon fires / throws, built from the
// same primitives as components. Frame: centred on the origin, flight direction = -Z.
// Absent -> clients fall back to fx.projectileShape (a built-in preset made of the same shapes).
// ---------------------------------------------------------------------------

/** Editor / edit-op id of the projectile (not a legal component id, so it never collides). */
export const PROJECTILE_ID = '@projectile';
export const PROJECTILE_IMPACTS = ['puff', 'spark', 'splash', 'shatter', 'burst', 'splat'] as const;
export type ProjectileImpact = (typeof PROJECTILE_IMPACTS)[number];
export const SPIN_AXES = ['x', 'y', 'z'] as const;
export type SpinAxis = (typeof SPIN_AXES)[number];

export interface ProjectileDesign {
  /** what it is, e.g. "soap bubble", "finned rocket" */
  label: string;
  /** primitives in the projectile frame (same vocabulary as component shapes) */
  shapes: Shape[];
  /** revolutions / s around a projectile axis (z = roll around the flight direction) */
  spin?: { axis: SpinAxis; rate: number };
  /** 0 - 1: squash / stretch + sway in flight (bubbles, blobs) */
  wobble?: number;
  trail?: Trail;
  trailColor?: string;
  impact?: ProjectileImpact;
  /** editor: kept verbatim by reprompts */
  locked?: boolean;
}

/** Stats: the numeric Weapon fields (always balanced by clampWeapon) + melee meta. */
export interface DesignStats {
  damage: number;
  pellets: number;
  fireRate: number;
  magSize: number;
  reloadTime: number;
  range: number;
  spread: number;
  projectileSpeed: number;
  splashRadius: number;
  gravityScale: number;
  fuseTime: number;
  dotDamage: number;
  dotDuration: number;
  knockback: number;
  slowPercent: number;
  chargeTime: number;
  headshotMultiplier: number;
  melee?: MeleeMeta;
  /** fire | ice | poison | shock | null (none); inferred from the name / class when missing */
  element?: Element | null;
  /** carry-weight movement multiplier (derived from class + model size by sanitizeDesign) */
  moveSpeedMult?: number;
}

export interface ForgeDesign {
  v: number;
  name: string;
  class: WeaponClass;
  fireMode: FireMode;
  stats: DesignStats;
  palette: DesignPalette;
  fx: DesignFx;
  components: Component[];
  /** projectile / thrown-object model (projectile and arc fire modes only) */
  projectile?: ProjectileDesign;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const FORGE_LIMITS = {
  maxComponents: 32,
  maxShapesPerComponent: 16,
  maxTris: 8000,
  /** whole-weapon bounding box, longest side */
  maxSizeRanged: 2.5,
  maxSizeMelee: 3,
  /** per-axis bound for positions / anchors (m) */
  maxCoord: 2,
  /** any single primitive dimension (m) */
  maxDim: 3,
  minDim: 0.002,
  minScale: 0.05,
  maxScale: 4,
  maxLathePoints: 24,
  maxOutlinePoints: 32,
  maxTubePoints: 16,
  maxBevel: 0.05,
  /** estimate used for catalog parts in the pure tri / size estimate */
  catalogPartTris: 350,
  catalogPartHalfSize: 0.15,
  maxNameLength: 40,
  maxLabelLength: 48,
  /** projectile model */
  maxProjectileShapes: 8,
  projectileMinSize: 0.05,
  projectileMaxSize: 1.2,
  projectileMaxTris: 600,
  /** revolutions / s */
  maxProjectileSpin: 6,
  /** register_design / service payload limit */
  maxDesignJson: 96_000,
} as const;
