// THREE builder for Forge designs (browser + Node). Not exported from '@ai-gaem/shared' (the
// SpacetimeDB module must not bundle THREE): import from '@ai-gaem/shared/forge/build'.
//
//   const group = buildDesign(design);           // THREE.Group, origin = grip / hand, forward = -Z
//   group.userData.components: Map<id, Object3D> // one Group per component (for editor picking)
//   disposeDesignObject(group)                   // frees geometries + materials

import * as THREE from 'three';
import { getPart } from '@ai-gaem/parts/registry';
import type { PartDef } from '@ai-gaem/parts';
import type { Component, DesignPalette, ForgeDesign } from './types';
import { emptyBox, layoutComponents, shapeBox, unionBox, type Box3 } from './math';
import { MaterialCache, makeGeometry, resolveColor, setTransform } from './geometry';

export { resolveColor };

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
      if (x && x.name && x.name.includes('|') && x.name.split('|').length >= 8) x.dispose();
    }
  });
}

export { countTris as countDesignTris };
