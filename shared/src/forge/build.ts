// THREE builder for Forge designs (browser + Node). Not exported from '@ai-gaem/shared' (the
// SpacetimeDB module must not bundle THREE): import from '@ai-gaem/shared/forge/build'.
//
//   const group = buildDesign(design);           // THREE.Group, origin = grip / hand, forward = -Z
//   group.userData.components: Map<id, Object3D> // one Group per component (for editor picking)
//   disposeDesignObject(group)                   // frees geometries + materials

import * as THREE from 'three';
import { getPart } from '@ai-gaem/parts/registry';
import type { PartDef } from '@ai-gaem/parts';
import type { Component, DesignPalette, ForgeDesign, Shape, ShapeMaterial } from './types';
import { emptyBox, layoutComponents, SEG_DEFAULTS, shapeBox, tubeSegments, unionBox, type Box3 } from './math';

const DEG = Math.PI / 180;

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

export function resolveColor(c: string | undefined, palette: DesignPalette, dflt: string): string {
  if (!c) return dflt;
  if (c === 'primary' || c === 'secondary' || c === 'accent' || c === 'glow') return palette[c];
  return c;
}

function makeGeometry(s: Shape): THREE.BufferGeometry {
  switch (s.type) {
    case 'box':
      return new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]);
    case 'cylinder':
      return new THREE.CylinderGeometry(s.rTop, s.rBottom, s.h, s.seg ?? SEG_DEFAULTS.cylinder);
    case 'cone':
      return new THREE.ConeGeometry(s.r, s.h, s.seg ?? SEG_DEFAULTS.cone);
    case 'sphere':
      return new THREE.SphereGeometry(s.r, s.wseg ?? SEG_DEFAULTS.sphereW, s.hseg ?? SEG_DEFAULTS.sphereH);
    case 'torus':
      return new THREE.TorusGeometry(s.r, s.tube, SEG_DEFAULTS.torusTube, s.seg ?? SEG_DEFAULTS.torus, (s.arc ?? 360) * DEG);
    case 'capsule':
      return new THREE.CapsuleGeometry(s.r, s.h, SEG_DEFAULTS.capsuleCap, s.seg ?? SEG_DEFAULTS.capsule);
    case 'lathe':
      return new THREE.LatheGeometry(
        s.points.map(([r, y]) => new THREE.Vector2(r, y)),
        s.seg ?? SEG_DEFAULTS.lathe,
      );
    case 'extrude': {
      const shape = new THREE.Shape(s.outline.map(([x, y]) => new THREE.Vector2(x, y)));
      const bev = s.bevel ?? 0;
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: s.depth,
        curveSegments: 1,
        bevelEnabled: bev > 0,
        bevelThickness: bev,
        bevelSize: bev,
        bevelSegments: 1,
      });
      g.translate(0, 0, -s.depth / 2);
      return g;
    }
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3(s.path.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      return new THREE.TubeGeometry(curve, tubeSegments(s.path.length), s.r, s.seg ?? SEG_DEFAULTS.tubeRadial, false);
    }
  }
}

class MaterialCache {
  private map = new Map<string, THREE.MeshStandardMaterial>();
  constructor(private palette: DesignPalette) {}
  get(m: ShapeMaterial, highlight: boolean): THREE.MeshStandardMaterial {
    const color = resolveColor(m.color, this.palette, this.palette.primary);
    const emissive = m.emissive ? resolveColor(m.emissive, this.palette, this.palette.glow) : undefined;
    const key = [color, m.metalness ?? '', m.roughness ?? '', emissive ?? '', m.emissiveIntensity ?? '', m.opacity ?? '', m.flatShading ?? '', highlight ? 'h' : ''].join('|');
    let mat = this.map.get(key);
    if (!mat) {
      const metal = m.metalness ?? 0.1;
      mat = new THREE.MeshStandardMaterial({
        color,
        metalness: metal,
        roughness: m.roughness ?? (metal > 0.5 ? 0.4 : 0.7),
        flatShading: m.flatShading !== false,
        emissive: new THREE.Color(highlight ? '#ffaa33' : (emissive ?? '#000000')),
        emissiveIntensity: highlight ? 0.6 : emissive ? (m.emissiveIntensity ?? 1) : 0,
        transparent: m.opacity !== undefined && m.opacity < 1,
        opacity: m.opacity ?? 1,
        depthWrite: !(m.opacity !== undefined && m.opacity < 1),
      });
      mat.name = key;
      this.map.set(key, mat);
    }
    return mat;
  }
}

function setTransform(o: THREE.Object3D, pos: readonly number[], rot: readonly number[], scale: readonly number[]) {
  o.position.set(pos[0], pos[1], pos[2]);
  o.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ');
  o.scale.set(scale[0], scale[1], scale[2]);
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
