// THREE builder for Forge projectiles (no catalog dependency: safe for the main client bundle).
// Import from '@ai-gaem/shared/forge/projectile3d'.
//
//   createProjectileMesh(p, palette)   // one Mesh sharing a cached merged geometry + materials
//   buildProjectileGroup(p, palette)   // one Mesh per shape, own materials (editor preview)

import * as THREE from 'three';
import type { DesignPalette, ProjectileDesign } from './types';
import { MaterialCache, makeGeometry, setTransform } from './geometry';

export interface ProjectileModel {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  /** longest side (m) */
  size: number;
}

const MAX_CACHE = 48;
const cache = new Map<string, ProjectileModel>();
const keyOf = new WeakMap<object, string>();

function cacheKey(p: ProjectileDesign, palette: DesignPalette): string {
  let k = keyOf.get(p);
  if (k === undefined) {
    k = JSON.stringify(p.shapes);
    keyOf.set(p, k);
  }
  return `${palette.primary}${palette.secondary}${palette.accent}${palette.glow}|${k}`;
}

/**
 * Merged, cached geometry (one draw group per material) + shared materials for a projectile.
 * Cached per (shapes, palette): many projectiles in flight share one geometry / material set.
 */
export function projectileModel(p: ProjectileDesign, palette: DesignPalette): ProjectileModel {
  const key = cacheKey(p, palette);
  const hit = cache.get(key);
  if (hit) {
    // LRU touch
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const mats = new MaterialCache(palette);
  const byMat = new Map<THREE.Material, { pos: number[]; nrm: number[] }>();
  const tmp = new THREE.Object3D();
  for (const s of p.shapes) {
    let g = makeGeometry(s);
    setTransform(tmp, s.pos ?? [0, 0, 0], s.rot ?? [0, 0, 0], s.scale ?? [1, 1, 1]);
    tmp.updateMatrix();
    g.applyMatrix4(tmp.matrix);
    if (g.index) {
      const ni = g.toNonIndexed();
      g.dispose();
      g = ni;
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = mats.get(s.material, false);
    let bucket = byMat.get(mat);
    if (!bucket) byMat.set(mat, (bucket = { pos: [], nrm: [] }));
    const pa = g.attributes.position.array as ArrayLike<number>;
    const na = g.attributes.normal.array as ArrayLike<number>;
    for (let i = 0; i < pa.length; i++) bucket.pos.push(pa[i]);
    for (let i = 0; i < na.length; i++) bucket.nrm.push(na[i]);
    g.dispose();
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const geometry = new THREE.BufferGeometry();
  const materials: THREE.Material[] = [];
  for (const [mat, b] of byMat) {
    geometry.addGroup(pos.length / 3, b.pos.length / 3, materials.length);
    materials.push(mat);
    for (const v of b.pos) pos.push(v);
    for (const v of b.nrm) nrm.push(v);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const bs = geometry.boundingBox!.getSize(new THREE.Vector3());
  const model: ProjectileModel = { geometry, materials, size: Math.max(bs.x, bs.y, bs.z) };
  cache.set(key, model);
  if (cache.size > MAX_CACHE) {
    // evict the least recently used (a mesh still in flight just re-uploads it if rendered)
    const [oldKey, old] = cache.entries().next().value as [string, ProjectileModel];
    cache.delete(oldKey);
    old.geometry.dispose();
    for (const m of old.materials) m.dispose();
  }
  return model;
}

/** A Mesh for one projectile in flight (shares the cached geometry / materials: never dispose them). */
export function createProjectileMesh(p: ProjectileDesign, palette: DesignPalette): THREE.Mesh {
  const m = projectileModel(p, palette);
  const mesh = new THREE.Mesh(m.geometry, m.materials);
  mesh.name = 'projectile';
  mesh.userData.sharedProjectile = true;
  return mesh;
}

/** Unmerged preview group (own geometries + materials; free with disposeProjectileGroup). */
export function buildProjectileGroup(p: ProjectileDesign, palette: DesignPalette): THREE.Group {
  const g = new THREE.Group();
  g.name = 'projectile';
  const mats = new MaterialCache(palette);
  for (const s of p.shapes) {
    const mesh = new THREE.Mesh(makeGeometry(s), mats.get(s.material, false));
    setTransform(mesh, s.pos ?? [0, 0, 0], s.rot ?? [0, 0, 0], s.scale ?? [1, 1, 1]);
    g.add(mesh);
  }
  return g;
}

export function disposeProjectileGroup(g: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) if (!seen.has(x)) (seen.add(x), x.dispose());
  });
}
