// THREE builder for outfits (browser + Node). Not exported from '@ai-gaem/shared' (the SpacetimeDB
// module must not bundle THREE): import from '@ai-gaem/shared/outfit/build'.
//
//   buildOutfitBones(outfit)   in-game: per humanoid bone one Group of merged meshes (bone frame),
//                              one mesh per quantized material, colours in vertex colours
//   buildOutfitPieces(outfit)  editor: one Group per piece (userData.componentId) per bone,
//                              unmerged, for picking / highlighting
//   disposeOutfitObject(obj)   frees geometries + materials of either

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MaterialCache, envIntensityFor, makeGeometry, resolveColor, setTransform } from '../forge/geometry';
import type { DesignPalette, Shape, ShapeMaterial } from '../forge/types';
import { socketFrame } from './sockets';
import { BONES, SOCKET_INFO, type BoneName, type OutfitDesign, type OutfitPiece } from './types';

const DEG = Math.PI / 180;

/** bone-frame matrix of a piece on its socket (mirrored: on the partner socket, flipped in X) */
export function pieceMatrix(outfit: Pick<OutfitDesign, 'body'>, p: OutfitPiece, mirrored = false): { bone: BoneName; m: THREE.Matrix4 } {
  const socket = mirrored ? SOCKET_INFO[p.socket].mirror! : p.socket;
  const f = socketFrame(socket, outfit.body);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...f.pos), new THREE.Quaternion(), new THREE.Vector3(...f.scale));
  if (mirrored) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  const t = p.transform;
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(...t.pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rot[0] * DEG, t.rot[1] * DEG, t.rot[2] * DEG, 'XYZ')),
    new THREE.Vector3(...t.scale),
  );
  m.multiply(local);
  return { bone: f.bone, m };
}

function shapeMatrix(s: Shape): THREE.Matrix4 {
  const r = s.rot ?? [0, 0, 0];
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(s.pos ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ')),
    new THREE.Vector3(...(s.scale ?? [1, 1, 1])),
  );
}

/** placements of a piece: itself, plus the mirrored copy */
function placements(outfit: OutfitDesign, p: OutfitPiece) {
  const out = [pieceMatrix(outfit, p, false)];
  if (p.mirror && SOCKET_INFO[p.socket].mirror) out.push(pieceMatrix(outfit, p, true));
  return out;
}

// ---------------------------------------------------------------------------
// in-game (merged)
// ---------------------------------------------------------------------------

const q = (v: number, step: number) => Math.round(v / step) * step;

/** quantized material key (colour goes to vertex colours) */
function matKey(m: ShapeMaterial, palette: DesignPalette): string {
  const metal = q(m.metalness ?? 0.1, 0.1);
  const rough = q(m.roughness ?? ((m.metalness ?? 0.1) > 0.5 ? 0.4 : 0.7), 0.1);
  const em = m.emissive ? resolveColor(m.emissive, palette, palette.glow) : '';
  // >= 8 '|' fields: isOwnDesignMaterial() -> the forge environment map is applied to it
  return ['outfit', metal.toFixed(1), rough.toFixed(1), m.flatShading === false ? 's' : 'f', em, em ? (m.emissiveIntensity ?? 1).toFixed(2) : '', (m.opacity ?? 1).toFixed(2), 'vc'].join('|');
}

function makeMaterial(key: string): THREE.MeshStandardMaterial {
  const [, metal, rough, flat, em, ei, op] = key.split('|');
  const opacity = Number(op);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: Number(metal),
    roughness: Number(rough),
    flatShading: flat !== 's',
    emissive: new THREE.Color(em || '#000000'),
    emissiveIntensity: em ? Number(ei) : 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    envMapIntensity: envIntensityFor(Number(metal)),
  });
  mat.name = key;
  return mat;
}

/** geometry baked with matrix `m`: position / normal / uv / color, indexed, winding fixed */
function bake(src: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color): THREE.BufferGeometry | null {
  const pos = src.getAttribute('position');
  if (!pos || pos.count === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', (pos as THREE.BufferAttribute).clone());
  const n = src.getAttribute('normal');
  if (n) g.setAttribute('normal', (n as THREE.BufferAttribute).clone());
  const uv = src.getAttribute('uv');
  g.setAttribute('uv', uv ? (uv as THREE.BufferAttribute).clone() : new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
  if (src.index) g.setIndex(src.index.clone());
  else g.setIndex(Array.from({ length: pos.count }, (_, i) => i));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    cols[i * 3] = color.r;
    cols[i * 3 + 1] = color.g;
    cols[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    const ix = g.index!;
    for (let i = 0; i + 2 < ix.count; i += 3) {
      const b = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, b);
    }
  }
  return g;
}

export interface OutfitBonesUserData {
  outfit: string;
  tris: number;
  /** draw calls (meshes) over all bones */
  meshes: number;
}

/**
 * In-game model: for each bone that carries pieces, a Group (bone frame) holding one merged mesh
 * per material. Materials are shared across bones. Attach each Group to the humanoid's bone.
 */
export function buildOutfitBones(outfit: OutfitDesign): { bones: Partial<Record<BoneName, THREE.Group>>; userData: OutfitBonesUserData } {
  const buckets = new Map<BoneName, Map<string, THREE.BufferGeometry[]>>();
  const color = new THREE.Color();
  for (const p of outfit.pieces) {
    for (const { bone, m } of placements(outfit, p)) {
      let byMat = buckets.get(bone);
      if (!byMat) buckets.set(bone, (byMat = new Map()));
      for (const s of p.shapes) {
        const src = makeGeometry(s);
        color.set(resolveColor(s.material.color, outfit.palette, outfit.palette.primary));
        const g = bake(src, m.clone().multiply(shapeMatrix(s)), color);
        src.dispose();
        if (!g) continue;
        const key = matKey(s.material, outfit.palette);
        let list = byMat.get(key);
        if (!list) byMat.set(key, (list = []));
        list.push(g);
      }
    }
  }
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const bones: Partial<Record<BoneName, THREE.Group>> = {};
  let tris = 0;
  let meshes = 0;
  for (const bone of BONES) {
    const byMat = buckets.get(bone);
    if (!byMat) continue;
    const grp = new THREE.Group();
    grp.name = `outfit:${bone}`;
    for (const [key, list] of byMat) {
      let mat = mats.get(key);
      if (!mat) mats.set(key, (mat = makeMaterial(key)));
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      if (merged !== list[0]) for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      grp.add(mesh);
      tris += merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3;
      meshes++;
    }
    bones[bone] = grp;
  }
  return { bones, userData: { outfit: outfit.name, tris, meshes } };
}

// ---------------------------------------------------------------------------
// editor (unmerged, per piece)
// ---------------------------------------------------------------------------

/**
 * Editor model: per piece, per bone it touches, a Group with userData { componentId, label, role }
 * whose first child holds the piece meshes (bone frame). `components` maps piece id -> the Group
 * on the piece's own socket bone (a mirrored copy on another bone is a second Group with the same
 * componentId, listed in `extra`).
 */
export function buildOutfitPieces(outfit: OutfitDesign, opts: { highlight?: readonly string[] } = {}) {
  const mats = new MaterialCache(outfit.palette);
  const perBone: { bone: BoneName; group: THREE.Group }[] = [];
  const components = new Map<string, THREE.Group>();
  for (const p of outfit.pieces) {
    const byBone = new Map<BoneName, THREE.Group>();
    for (const { bone, m } of placements(outfit, p)) {
      let g = byBone.get(bone);
      if (!g) {
        g = new THREE.Group();
        g.name = p.id;
        g.userData = { componentId: p.id, label: p.label, role: p.socket };
        g.add(new THREE.Group());
        byBone.set(bone, g);
        perBone.push({ bone, group: g });
      }
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(m);
      for (const s of p.shapes) {
        const mesh = new THREE.Mesh(makeGeometry(s), mats.get(s.material, !!opts.highlight?.includes(p.id)));
        setTransform(mesh, s.pos ?? [0, 0, 0], s.rot ?? [0, 0, 0], s.scale ?? [1, 1, 1]);
        mesh.castShadow = true;
        holder.add(mesh);
      }
      g.children[0].add(holder);
    }
    const own = byBone.get(socketFrame(p.socket, outfit.body).bone);
    if (own) components.set(p.id, own);
  }
  return { perBone, components };
}

/** Free geometries + materials of buildOutfitBones / buildOutfitPieces output. */
export function disposeOutfitObject(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) if (x) mats.add(x);
  });
  for (const m of mats) m.dispose();
}
