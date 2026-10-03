// THREE builder for Forge designs (browser + Node). Not exported from '@ai-gaem/shared' (the
// SpacetimeDB module must not bundle THREE): import from '@ai-gaem/shared/forge/build'.
//
//   const group = buildDesign(design);           // THREE.Group, origin = grip / hand, forward = -Z
//   group.userData.components: Map<id, Object3D> // one Group per component (for editor picking)
//   disposeDesignObject(group)                   // frees geometries + materials
//   const merged = buildDesignMerged(design);    // in-game: one Mesh per material, no component groups

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getPart } from '@ai-gaem/parts/registry';
import type { PartDef } from '@ai-gaem/parts';
import type { Component, DesignPalette, ForgeDesign } from './types';
import { emptyBox, layoutComponents, shapeBox, unionBox, type Box3 } from './math';
import { MaterialCache, makeGeometry, resolveColor, setTransform } from './geometry';

export { resolveColor };
export { forgeEnvironment, envIntensityFor } from './geometry';

export interface BuildDesignOptions {
  /** catalog lookup (default: @ai-gaem/parts getPart) */
  lookup?: (id: string) => PartDef | undefined;
  /** highlight these component ids (editor selection): emissive tint */
  highlight?: readonly string[];
}

export interface DesignObjectUserData {
  design: string;
  components: Map<string, THREE.Object3D>;
  tris: number;
  /** catalog part ids that were not found */
  missing: string[];
}

function countTris(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry;
      n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });
  return n;
}

/** Build the content (shapes or catalog part) of one component, in the component frame. */
function buildContent(c: Component, mats: MaterialCache, palette: DesignPalette, opts: BuildDesignOptions, missing: string[]): { obj: THREE.Object3D; box: Box3 } {
  const highlight = !!opts.highlight?.includes(c.id);
  if (c.catalogPart) {
    const def = (opts.lookup ?? getPart)(c.catalogPart.partId);
    if (!def) {
      missing.push(c.catalogPart.partId);
      return { obj: new THREE.Group(), box: emptyBox() };
    }
    const obj = def.build({ color: c.catalogPart.color ?? palette.primary, accent: c.catalogPart.accent ?? palette.accent });
    if (highlight) {
      obj.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material && !Array.isArray(m.material)) {
          const mm = (m.material as THREE.MeshStandardMaterial).clone();
          mm.emissive = new THREE.Color('#ffaa33');
          mm.emissiveIntensity = 0.6;
          m.material = mm;
        }
      });
    }
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    const box: Box3 = b.isEmpty() ? emptyBox() : { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
    return { obj, box };
  }
  const g = new THREE.Group();
  let box = emptyBox();
  for (const s of c.shapes ?? []) {
    const mesh = new THREE.Mesh(makeGeometry(s), mats.get(s.material, highlight));
    setTransform(mesh, s.pos ?? [0, 0, 0], s.rot ?? [0, 0, 0], s.scale ?? [1, 1, 1]);
    mesh.castShadow = true;
    g.add(mesh);
    box = unionBox(box, shapeBox(s));
  }
  return { obj: g, box };
}

/**
 * Build a (sanitized) design. Every component becomes a Group named by its id with
 * userData { componentId, label, role }, nested under its parent's Group.
 */
export function buildDesign(design: ForgeDesign, opts: BuildDesignOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = design.name;
  const mats = new MaterialCache(design.palette);
  const missing: string[] = [];
  const contents = new Map<string, { obj: THREE.Object3D; box: Box3 }>();
  for (const c of design.components) contents.set(c.id, buildContent(c, mats, design.palette, opts, missing));
  const layout = layoutComponents(design.components, c => contents.get(c.id)!.box);
  const groups = new Map<string, THREE.Object3D>();
  for (const c of design.components) {
    const e = layout.get(c.id)!;
    const g = new THREE.Group();
    g.name = c.id;
    g.userData = { componentId: c.id, label: c.label, role: c.role };
    const pos = [e.anchor[0] + c.transform.pos[0], e.anchor[1] + c.transform.pos[1], e.anchor[2] + c.transform.pos[2]];
    setTransform(g, pos, c.transform.rot, c.transform.scale);
    g.add(contents.get(c.id)!.obj);
    const parent = c.parent ? groups.get(c.parent) : undefined;
    (parent ?? root).add(g);
    groups.set(c.id, g);
  }
  root.updateMatrixWorld(true);
  const ud: DesignObjectUserData = { design: design.name, components: groups, tris: countTris(root), missing };
  root.userData = ud;
  return root;
}

/** Free GPU resources of a buildDesign() result (catalog part materials are shared: not disposed). */
export function disposeDesignObject(root: THREE.Object3D): void {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[];
    for (const x of Array.isArray(mat) ? mat : [mat]) {
      // part-kit materials are cached and shared across parts: only dispose our own
      if (x && isOwnDesignMaterial(x)) x.dispose();
    }
  });
}

export { countTris as countDesignTris };

/** our own MaterialCache materials (vs. shared catalog part-kit materials, which are never disposed) */
export function isOwnDesignMaterial(m: THREE.Material): boolean {
  return !!m.name && m.name.includes('|') && m.name.split('|').length >= 8;
}

/**
 * Set `env` (forgeEnvironment(renderer)) as envMap on the design's own materials (their
 * envMapIntensity is tuned by metalness). Catalog part-kit materials are shared: left alone.
 */
export function applyForgeEnvironment(root: THREE.Object3D, env: THREE.Texture | null): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (!sm.isMeshStandardMaterial || !isOwnDesignMaterial(sm) || sm.envMap === env) continue;
      sm.envMap = env;
      sm.needsUpdate = true;
    }
  });
}

export interface MergedDesignUserData {
  design: string;
  tris: number;
  missing: string[];
  /** merged mesh count (= draw calls) */
  meshes: number;
  /** per component role: union AABB (root frame) of the components with that role, incl. their children */
  roleBoxes: Record<string, [number, number, number, number, number, number]>;
}

const KEEP_ATTRS = ['position', 'normal', 'uv'] as const;

/** clone + bake `m` into a merge-ready geometry (indexed, position/normal/uv only, winding fixed) */
function bakeGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry | null {
  const pos = src.getAttribute('position');
  if (!pos || pos.count === 0) return null;
  const g = new THREE.BufferGeometry();
  for (const k of KEEP_ATTRS) {
    const a = src.getAttribute(k);
    if (a) g.setAttribute(k, (a as THREE.BufferAttribute).clone());
  }
  if (src.index) g.setIndex(src.index.clone());
  else {
    const idx = new Array<number>(pos.count);
    for (let i = 0; i < pos.count; i++) idx[i] = i;
    g.setIndex(idx);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    // mirrored transform: flip triangle winding so front faces stay front faces
    const ix = g.index!;
    for (let i = 0; i + 2 < ix.count; i += 3) {
      const b = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, b);
    }
  }
  return g;
}

/**
 * In-game variant of buildDesign(): same model, but every mesh is baked into the root frame and
 * merged per material (one draw call per material instead of one per shape). Component groups
 * are dropped (no editor picking / highlight); roles survive as `userData.roleBoxes` (muzzle /
 * blade placement). Materials keep their MaterialCache keys, so flat- vs smooth-shaded variants
 * of a colour stay separate meshes. Free with disposeDesignObject().
 */
export function buildDesignMerged(design: ForgeDesign, opts: Pick<BuildDesignOptions, 'lookup'> = {}): THREE.Group {
  const src = buildDesign(design, { lookup: opts.lookup });
  const sud = src.userData as DesignObjectUserData;
  const roleBoxes: MergedDesignUserData['roleBoxes'] = {};
  const tmp = new THREE.Box3();
  for (const g of sud.components.values()) {
    const role = (g.userData as { role?: string }).role;
    if (!role) continue;
    tmp.setFromObject(g);
    if (tmp.isEmpty()) continue;
    const r = roleBoxes[role];
    roleBoxes[role] = r
      ? [Math.min(r[0], tmp.min.x), Math.min(r[1], tmp.min.y), Math.min(r[2], tmp.min.z), Math.max(r[3], tmp.max.x), Math.max(r[4], tmp.max.y), Math.max(r[5], tmp.max.z)]
      : [tmp.min.x, tmp.min.y, tmp.min.z, tmp.max.x, tmp.max.y, tmp.max.z];
  }

  const root = new THREE.Group();
  root.name = design.name;
  src.updateMatrixWorld(true);
  const inv = src.matrixWorld.clone().invert();
  const rel = new THREE.Matrix4();
  // material -> baked geometries (insertion order = first appearance: stable draw order)
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const extras: THREE.Object3D[] = [];
  src.traverse((o) => {
    if (o === src) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) {
      // non-mesh renderables (lines / points / sprites from catalog parts): keep, baked transform
      if ((o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) {
        const c = o.clone(false);
        rel.multiplyMatrices(inv, o.matrixWorld);
        rel.decompose(c.position, c.quaternion, c.scale);
        extras.push(c);
      }
      return;
    }
    if (!mesh.visible) return;
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    const mat = mesh.material;
    if (Array.isArray(mat) || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.geometry.morphAttributes.position) {
      // multi-material / special meshes: not merged, just re-parented with the baked transform
      const c = new THREE.Mesh(mesh.geometry.clone(), mat);
      rel.decompose(c.position, c.quaternion, c.scale);
      c.castShadow = mesh.castShadow;
      extras.push(c);
      return;
    }
    const g = bakeGeometry(mesh.geometry, rel);
    if (!g) return;
    let list = buckets.get(mat);
    if (!list) buckets.set(mat, (list = []));
    list.push(g);
  });

  for (const [mat, list] of buckets) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (merged) {
      if (merged !== list[0]) for (const g of list) g.dispose();
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      root.add(m);
    } else {
      // incompatible attributes (shouldn't happen after bakeGeometry): keep them separate
      for (const g of list) {
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        root.add(m);
      }
    }
  }
  for (const e of extras) root.add(e);

  // the source tree's geometries were cloned: free them (materials are reused by the merged meshes)
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry?.dispose();
  });

  root.updateMatrixWorld(true);
  const ud: MergedDesignUserData = { design: design.name, tris: countTris(root), missing: sud.missing, meshes: root.children.length, roleBoxes };
  root.userData = ud;
  return root;
}
