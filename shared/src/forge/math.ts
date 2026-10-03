// Pure geometry helpers for the Forge DSL: bounding boxes, triangle estimates and the component
// layout (parent frame + anchor + transform). Used by sanitizeDesign (no THREE) and by the THREE
// builder (`buildDesign`), so both agree on where components go.

import { FORGE_LIMITS, type Anchor, type Component, type Shape, type Transform, type V3 } from './types';

export interface Box3 {
  min: V3;
  max: V3;
}

/** Affine transform: 3x3 row-major linear part + translation. */
export interface Affine {
  m: number[];
  t: V3;
}

const DEG = Math.PI / 180;

export const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

/** Rotation matrix for Euler degrees in XYZ order (matches THREE.Matrix4.makeRotationFromEuler). */
export function eulerMatrix(rotDeg: V3): number[] {
  const x = rotDeg[0] * DEG;
  const y = rotDeg[1] * DEG;
  const z = rotDeg[2] * DEG;
  const a = Math.cos(x), b = Math.sin(x);
  const c = Math.cos(y), d = Math.sin(y);
  const e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [
    c * e, -c * f, d,
    af + be * d, ae - bf * d, -b * c,
    bf - ae * d, be + af * d, a * c,
  ];
}

/** T(pos) * R(rot) * S(scale) */
export function composeAffine(pos: V3, rot: V3, scale: V3): Affine {
  const r = eulerMatrix(rot);
  return {
    m: [
      r[0] * scale[0], r[1] * scale[1], r[2] * scale[2],
      r[3] * scale[0], r[4] * scale[1], r[5] * scale[2],
      r[6] * scale[0], r[7] * scale[1], r[8] * scale[2],
    ],
    t: [pos[0], pos[1], pos[2]],
  };
}

/** a * b (apply b first) */
export function mulAffine(a: Affine, b: Affine): Affine {
  const A = a.m, B = b.m;
  const m = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) m[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return { m, t: applyAffine(a, b.t) };
}

export function applyAffine(a: Affine, p: V3): V3 {
  const M = a.m;
  return [
    M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + a.t[0],
    M[3] * p[0] + M[4] * p[1] + M[5] * p[2] + a.t[1],
    M[6] * p[0] + M[7] * p[1] + M[8] * p[2] + a.t[2],
  ];
}

export function emptyBox(): Box3 {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function isEmptyBox(b: Box3): boolean {
  return !(b.min[0] <= b.max[0]);
}

export function expandByPoint(b: Box3, p: V3): void {
  for (let i = 0; i < 3; i++) {
    if (p[i] < b.min[i]) b.min[i] = p[i];
    if (p[i] > b.max[i]) b.max[i] = p[i];
  }
}

export function unionBox(a: Box3, b: Box3): Box3 {
  if (isEmptyBox(b)) return a;
  const out = { min: [...a.min] as V3, max: [...a.max] as V3 };
  expandByPoint(out, b.min);
  expandByPoint(out, b.max);
  return out;
}

export function transformBox(b: Box3, a: Affine): Box3 {
  const out = emptyBox();
  if (isEmptyBox(b)) return out;
  for (let i = 0; i < 8; i++) {
    expandByPoint(
      out,
      applyAffine(a, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]),
    );
  }
  return out;
}

export function boxSize(b: Box3): V3 {
  if (isEmptyBox(b)) return [0, 0, 0];
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

const sym = (x: number, y: number, z: number): Box3 => ({ min: [-x, -y, -z], max: [x, y, z] });

/** Bounding box of a primitive in its own frame (before the shape's pos/rot/scale). */
export function shapeLocalBox(s: Shape): Box3 {
  switch (s.type) {
    case 'box':
      return sym(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2);
    case 'cylinder': {
      const r = Math.max(s.rTop, s.rBottom);
      return sym(r, s.h / 2, r);
    }
    case 'cone':
      return sym(s.r, s.h / 2, s.r);
    case 'sphere':
      return sym(s.r, s.r, s.r);
    case 'torus':
      return sym(s.r + s.tube, s.r + s.tube, s.tube);
    case 'capsule':
      return sym(s.r, s.h / 2 + s.r, s.r);
    case 'lathe': {
      let r = 0, y0 = Infinity, y1 = -Infinity;
      for (const [pr, py] of s.points) {
        r = Math.max(r, Math.abs(pr));
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
      if (!Number.isFinite(y0)) return emptyBox();
      return { min: [-r, y0, -r], max: [r, y1, r] };
    }
    case 'extrude': {
      const b = emptyBox();
      const bev = s.bevel ?? 0;
      for (const [x, y] of s.outline) expandByPoint(b, [x, y, 0]);
      if (isEmptyBox(b)) return b;
      return {
        min: [b.min[0] - bev, b.min[1] - bev, -s.depth / 2 - bev],
        max: [b.max[0] + bev, b.max[1] + bev, s.depth / 2 + bev],
      };
    }
    case 'tube': {
      const b = emptyBox();
      for (const p of s.path) expandByPoint(b, p);
      if (isEmptyBox(b)) return b;
      return {
        min: [b.min[0] - s.r, b.min[1] - s.r, b.min[2] - s.r],
        max: [b.max[0] + s.r, b.max[1] + s.r, b.max[2] + s.r],
      };
    }
  }
}

export function shapeAffine(s: Shape): Affine {
  return composeAffine(s.pos ?? [0, 0, 0], s.rot ?? [0, 0, 0], s.scale ?? [1, 1, 1]);
}

/** Bounding box of a shape in its component's frame. */
export function shapeBox(s: Shape): Box3 {
  return transformBox(shapeLocalBox(s), shapeAffine(s));
}

/** Default segment counts (the builder uses the same values). */
export const SEG_DEFAULTS = {
  cylinder: 12,
  cone: 12,
  sphereW: 12,
  sphereH: 8,
  torus: 16,
  torusTube: 6,
  capsule: 8,
  capsuleCap: 3,
  lathe: 12,
  tubeRadial: 6,
};

export function tubeSegments(pathLen: number): number {
  return Math.min(64, Math.max(4, (pathLen - 1) * 8));
}

/** Triangle count the builder will produce for a primitive (exact for most, close for the rest). */
export function shapeTris(s: Shape): number {
  switch (s.type) {
    case 'box':
      return 12;
    case 'cylinder': {
      // THREE skips the degenerate torso triangle next to a zero radius
      const seg = s.seg ?? SEG_DEFAULTS.cylinder;
      const torso = s.rTop > 0 && s.rBottom > 0 ? seg * 2 : seg;
      return torso + (s.rTop > 0 ? seg : 0) + (s.rBottom > 0 ? seg : 0);
    }
    case 'cone':
      return (s.seg ?? SEG_DEFAULTS.cone) * 2;
    case 'sphere': {
      const w = s.wseg ?? SEG_DEFAULTS.sphereW;
      const h = s.hseg ?? SEG_DEFAULTS.sphereH;
      return w * (h - 1) * 2;
    }
    case 'torus':
      return (s.seg ?? SEG_DEFAULTS.torus) * SEG_DEFAULTS.torusTube * 2;
    case 'capsule': {
      const seg = s.seg ?? SEG_DEFAULTS.capsule;
      return seg * (SEG_DEFAULTS.capsuleCap * 4 + 2);
    }
    case 'lathe':
      return Math.max(0, s.points.length - 1) * (s.seg ?? SEG_DEFAULTS.lathe) * 2;
    case 'extrude': {
      const n = s.outline.length;
      const caps = Math.max(0, n - 2) * 2;
      const sideBands = s.bevel ? 3 : 1;
      return caps + n * 2 * sideBands;
    }
    case 'tube':
      return tubeSegments(s.path.length) * (s.seg ?? SEG_DEFAULTS.tubeRadial) * 2;
  }
}

export function componentTrisEstimate(c: Component): number {
  if (c.catalogPart) return FORGE_LIMITS.catalogPartTris;
  let n = 0;
  for (const s of c.shapes ?? []) n += shapeTris(s);
  return n;
}

export function designTrisEstimate(components: readonly Component[]): number {
  let n = 0;
  for (const c of components) n += componentTrisEstimate(c);
  return n;
}

/** Component content box in its own frame (pure estimate: catalog parts are a nominal cube). */
export function pureComponentBox(c: Component): Box3 {
  if (c.catalogPart) {
    const h = FORGE_LIMITS.catalogPartHalfSize;
    return sym(h, h, h);
  }
  let b = emptyBox();
  for (const s of c.shapes ?? []) b = unionBox(b, shapeBox(s));
  return b;
}

/** Point on a parent's content box for an anchor. */
export function anchorPoint(parentBox: Box3, anchor: Anchor | undefined): V3 {
  if (Array.isArray(anchor)) return [anchor[0], anchor[1], anchor[2]];
  if (isEmptyBox(parentBox)) return [0, 0, 0];
  const { min, max } = parentBox;
  const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  switch (anchor) {
    case 'front':
      return [c[0], c[1], min[2]];
    case 'back':
      return [c[0], c[1], max[2]];
    case 'top':
      return [c[0], max[1], c[2]];
    case 'bottom':
      return [c[0], min[1], c[2]];
    case 'left':
      return [min[0], c[1], c[2]];
    case 'right':
      return [max[0], c[1], c[2]];
    default:
      return c;
  }
}

/** Local transform of a component relative to its parent frame: T(anchor + pos) R S. */
export function componentLocalAffine(t: Transform, anchor: V3): Affine {
  return composeAffine([anchor[0] + t.pos[0], anchor[1] + t.pos[1], anchor[2] + t.pos[2]], t.rot, t.scale);
}

export interface LayoutEntry {
  component: Component;
  /** content box in the component frame */
  localBox: Box3;
  /** anchor point in the parent frame (origin for roots) */
  anchor: V3;
  /** component frame -> parent frame */
  local: Affine;
  /** component frame -> weapon frame */
  world: Affine;
  worldBox: Box3;
}

/**
 * Lay out components (parents must precede children; sanitizeDesign guarantees it).
 * `boxOf` gives each component's content box in its own frame.
 */
export function layoutComponents(
  components: readonly Component[],
  boxOf: (c: Component) => Box3 = pureComponentBox,
): Map<string, LayoutEntry> {
  const out = new Map<string, LayoutEntry>();
  for (const c of components) {
    const parent = c.parent ? out.get(c.parent) : undefined;
    const localBox = boxOf(c);
    const anchor: V3 = parent ? anchorPoint(parent.localBox, c.attach) : [0, 0, 0];
    const local = componentLocalAffine(c.transform, anchor);
    const world = parent ? mulAffine(parent.world, local) : local;
    out.set(c.id, { component: c, localBox, anchor, local, world, worldBox: transformBox(localBox, world) });
  }
  return out;
}

export function designBox(layout: Map<string, LayoutEntry>): Box3 {
  let b = emptyBox();
  for (const e of layout.values()) b = unionBox(b, e.worldBox);
  return b;
}
