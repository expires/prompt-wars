/**
 * Kit: a tiny geometry accumulator. Generators push primitives into material
 * "slots"; on build, each slot is merged into ONE mesh with a shared, cached,
 * flat-shaded material. A part is therefore usually 1-4 draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildOpts, Vec3 } from '../types';

/** Named material slots. Any '#rrggbb' string is also accepted as a fixed color. */
export type Slot =
  | 'main'
  | 'accent'
  | 'dark'
  | 'metal'
  | 'glow'
  | 'wood'
  | 'brass'
  | 'rubber'
  | 'white'
  | `#${string}`;

const FIXED: Record<string, string> = {
  dark: '#2d2f36',
  metal: '#9aa1ab',
  wood: '#8a5a32',
  brass: '#c99a2e',
  rubber: '#1f1f22',
  white: '#f2efe8',
};

export interface Xf {
  p?: Vec3;
  r?: Vec3;
  s?: Vec3 | number;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function getMaterial(color: string, slot: string): THREE.MeshStandardMaterial {
  const glow = slot === 'glow';
  const metal = slot === 'metal' || slot === 'brass';
  const key = `${color}|${glow ? 'g' : metal ? 'm' : 's'}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: metal ? 0.45 : 0.75,
      metalness: metal ? 0.45 : 0.05,
      emissive: glow ? new THREE.Color(color) : new THREE.Color(0x000000),
      emissiveIntensity: glow ? 0.9 : 0,
    });
    m.name = key;
    matCache.set(key, m);
  }
  return m;
}

export function materialCacheSize(): number {
  return matCache.size;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function xfMatrix(t?: Xf): THREE.Matrix4 {
  const p = t?.p ?? [0, 0, 0];
  const r = t?.r ?? [0, 0, 0];
  const s = t?.s ?? 1;
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  _v.set(p[0], p[1], p[2]);
  return _m.compose(_v, _q, _s);
}

export type Pt = [number, number];

export class Kit {
  private slots = new Map<string, THREE.BufferGeometry[]>();

  /** Add an arbitrary geometry (takes ownership). */
  add(slot: Slot, geo: THREE.BufferGeometry, t?: Xf): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (t) g.applyMatrix4(xfMatrix(t));
    const list = this.slots.get(slot) ?? [];
    list.push(g);
    this.slots.set(slot, list);
    return this;
  }

  box(slot: Slot, size: Vec3, t?: Xf): this {
    return this.add(slot, new THREE.BoxGeometry(size[0], size[1], size[2]), t);
  }

  /** Cylinder/cone/prism from point a to point b with radius r0 at a and r1 at b. */
  rod(slot: Slot, a: Vec3, b: Vec3, r0: number, r1 = r0, seg = 8, open = false): this {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    if (len < 1e-6) return this;
    // CylinderGeometry: top (+Y) radius first.
    const g = new THREE.CylinderGeometry(Math.max(r1, 0), Math.max(r0, 0), len, seg, 1, open);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    const mid = va.add(vb).multiplyScalar(0.5);
    g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    return this.add(slot, g);
  }

  /** Convenience: rod along Z from z0 to z1 at (x, y). */
  zrod(slot: Slot, z0: number, z1: number, r0: number, r1 = r0, seg = 8, x = 0, y = 0): this {
    return this.rod(slot, [x, y, z0], [x, y, z1], r0, r1, seg);
  }

  /** Low-poly ball (icosahedron). detail 0 = 20 tris, 1 = 80 tris. */
  ball(slot: Slot, r: number, p: Vec3 = [0, 0, 0], detail = 1, s?: Vec3): this {
    return this.add(slot, new THREE.IcosahedronGeometry(r, detail), { p, s });
  }

  /** UV sphere (for smoother domes / hemispheres). */
  sphere(slot: Slot, r: number, t?: Xf, wSeg = 8, hSeg = 6, thetaLen = Math.PI): this {
    return this.add(slot, new THREE.SphereGeometry(r, wSeg, hSeg, 0, Math.PI * 2, 0, thetaLen), t);
  }

  /** Torus in XY plane by default (ring facing Z). */
  torus(slot: Slot, R: number, r: number, t?: Xf, radial = 5, tubular = 12, arc = Math.PI * 2): this {
    return this.add(slot, new THREE.TorusGeometry(R, r, radial, tubular, arc), t);
  }

  /** Lathe profile ([radius, height] points) around Y, then transformed. */
  lathe(slot: Slot, pts: Pt[], seg = 8, t?: Xf): this {
    const v = pts.map(([x, y]) => new THREE.Vector2(Math.max(x, 0.0001), y));
    return this.add(slot, new THREE.LatheGeometry(v, seg), t);
  }

  /** Lathe whose axis runs along Z: pts are [radius, z]. */
  zlathe(slot: Slot, pts: Pt[], seg = 8, p: Vec3 = [0, 0, 0]): this {
    // Lathe builds along +Y; rotate +Y -> +Z.
    return this.lathe(slot, pts, seg, { p, r: [Math.PI / 2, 0, 0] });
  }

  /**
   * Extrude a 2D outline. plane:
   *  'xy' shape (u,v)->(x,y), thickness along z
   *  'zy' shape (u,v)->(z,y), thickness along x   (blades, stocks, grips seen from the side)
   *  'xz' shape (u,v)->(x,z), thickness along y   (top-down profiles)
   */
  extrude(
    slot: Slot,
    pts: Pt[],
    depth: number,
    plane: 'xy' | 'zy' | 'xz' = 'zy',
    t?: Xf,
    bevel = 0,
    holes: Pt[][] = [],
  ): this {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: 1,
      curveSegments: 4,
    });
    g.translate(0, 0, -depth / 2);
    if (plane === 'zy') g.rotateY(-Math.PI / 2);
    else if (plane === 'xz') g.rotateX(Math.PI / 2);
    return this.add(slot, g, t);
  }

  /** Bevelled blade-like extrusion whose edges taper (thin sharp look). */
  blade(slot: Slot, pts: Pt[], thick: number, plane: 'zy' | 'xy' | 'xz' = 'zy', t?: Xf): this {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: thick * 0.25,
      bevelEnabled: true,
      bevelThickness: thick * 0.375,
      bevelSize: thick * 0.6,
      bevelSegments: 1,
      curveSegments: 3,
    });
    g.translate(0, 0, -thick * 0.125);
    if (plane === 'zy') g.rotateY(-Math.PI / 2);
    else if (plane === 'xz') g.rotateX(Math.PI / 2);
    return this.add(slot, g, t);
  }

  /** Swept tube through points. */
  tube(slot: Slot, pts: Vec3[], r: number, segs = 12, radial = 5, closed = false): this {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed);
    return this.add(slot, new THREE.TubeGeometry(curve, segs, r, radial, closed));
  }

  /** Flat-ish decal (thin extrusion) facing +X by default (for side stickers). */
  decal(slot: Slot, pts: Pt[], t?: Xf, thick = 0.003): this {
    return this.extrude(slot, pts, thick, 'zy', t);
  }

  /** Apply a transform to everything added so far (all slots). */
  transformAll(t: Xf): this {
    const m = xfMatrix(t).clone();
    for (const list of this.slots.values()) for (const g of list) g.applyMatrix4(m);
    return this;
  }

  triCount(): number {
    let n = 0;
    for (const list of this.slots.values()) for (const g of list) n += g.attributes.position.count / 3;
    return n;
  }

  /** Merge each slot into one mesh. */
  toObject(opts: BuildOpts, defColor: string, defAccent: string, name = 'part'): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    const color = opts.color ?? defColor;
    const accent = opts.accent ?? defAccent;
    for (const [slot, list] of this.slots) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      if (list.length > 1) for (const g of list) g.dispose();
      let c: string;
      if (slot === 'main') c = color;
      else if (slot === 'accent' || slot === 'glow') c = accent;
      else if (slot.startsWith('#')) c = slot;
      else c = FIXED[slot] ?? '#ff00ff';
      const mesh = new THREE.Mesh(merged, getMaterial(c, slot));
      mesh.name = `${name}:${slot}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.slots.clear();
    const s = opts.scale ?? 1;
    if (s !== 1) group.scale.setScalar(s);
    return group;
  }
}

/** Count triangles in any object tree. */
export function countTris(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry;
      n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });
  return n;
}

/* ---------------- 2D outline helpers ---------------- */

export function rectPts(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Rectangle with chamfered corners. */
export function chamferRect(x0: number, y0: number, x1: number, y1: number, c: number): Pt[] {
  return [
    [x0 + c, y0],
    [x1 - c, y0],
    [x1, y0 + c],
    [x1, y1 - c],
    [x1 - c, y1],
    [x0 + c, y1],
    [x0, y1 - c],
    [x0, y0 + c],
  ];
}

export function circlePts(r: number, n = 10, cx = 0, cy = 0, rot = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export function starPts(ro: number, ri: number, n = 5, rot = Math.PI / 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? ro : ri;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

export function heartPts(s: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push([(x / 17) * s, (y / 17) * s]);
  }
  return out;
}

/** Deterministic pseudo-random for jitter, seeded by string. */
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}
