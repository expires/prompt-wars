import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildDesign, buildDesignMerged, disposeDesignObject, type MergedDesignUserData } from '../src/forge/build';
import { FORGE_EXAMPLES } from '../src/forge/examples';
import { sanitizeDesign } from '../src';

const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o, true);

describe('buildDesignMerged', () => {
  it('merges every example per material with identical tris and bounds', () => {
    for (const ex of FORGE_EXAMPLES) {
      const { design } = sanitizeDesign(ex);
      const full = buildDesign(design);
      const merged = buildDesignMerged(design);
      const ud = merged.userData as MergedDesignUserData;
      const fud = full.userData as { tris: number };
      expect(ud.tris).toBe(fud.tris);
      // one mesh per distinct material
      const mats = new Set<THREE.Material>();
      full.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) mats.add((o as THREE.Mesh).material as THREE.Material);
      });
      expect(merged.children.length).toBe(mats.size);
      expect(ud.meshes).toBe(mats.size);
      const a = boxOf(full);
      const b = boxOf(merged);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(b.min[k]).toBeCloseTo(a.min[k], 4);
        expect(b.max[k]).toBeCloseTo(a.max[k], 4);
      }
      // role boxes (muzzle / blade placement) present for every role
      for (const c of design.components) expect(ud.roleBoxes[c.role]).toBeDefined();
      disposeDesignObject(full);
      disposeDesignObject(merged);
    }
  });

  it('keeps flat and smooth shaded variants of a colour as separate meshes', () => {
    const { design } = sanitizeDesign({
      class: 'pistol',
      components: [
        {
          id: 'a',
          label: 'a',
          role: 'core',
          transform: {},
          shapes: [
            { type: 'sphere', r: 0.05, material: { color: '#888888', metalness: 0.9 } },
            { type: 'sphere', r: 0.05, pos: [0.1, 0, 0], material: { color: '#888888', metalness: 0.9, flatShading: false } },
            { type: 'box', size: [0.1, 0.1, 0.1], pos: [0, 0.2, 0], material: { color: '#888888', metalness: 0.9 } },
          ],
        },
      ],
    });
    const merged = buildDesignMerged(design);
    expect(merged.children.length).toBe(2);
    const flat = merged.children.map((m) => ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).flatShading).sort();
    expect(flat).toEqual([false, true]);
    disposeDesignObject(merged);
  });

  it('flips winding for mirrored shapes', () => {
    const { design } = sanitizeDesign({
      class: 'pistol',
      components: [{ id: 'a', label: 'a', role: 'core', transform: {}, shapes: [{ type: 'box', size: [0.1, 0.1, 0.1], scale: [-1, 1, 1], material: { color: '#ff0000' } }] }],
    });
    const merged = buildDesignMerged(design);
    const g = (merged.children[0] as THREE.Mesh).geometry;
    // first triangle's geometric normal must agree with its vertex normals (outward)
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const ix = g.index!;
    const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, ix.getX(k)));
    const face = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize();
    const vn = new THREE.Vector3().fromBufferAttribute(n, ix.getX(0));
    expect(face.dot(vn)).toBeGreaterThan(0.9);
    disposeDesignObject(merged);
  });
});
