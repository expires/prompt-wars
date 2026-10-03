import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildDesign, disposeDesignObject } from '../src/forge/build';
import { FORGE_EXAMPLES } from '../src/forge/examples';
import { boxSize, designBox, designTrisEstimate, layoutComponents, sanitizeDesign, shapeTris, type Shape } from '../src';

describe('buildDesign', () => {
  it('produces exactly the estimated triangle count for every primitive', () => {
    const shapes: Shape[] = [
      { type: 'box', size: [0.1, 0.2, 0.3], material: { color: '#ff0000' } },
      { type: 'cylinder', rTop: 0.05, rBottom: 0.07, h: 0.2, seg: 9, material: { color: 'primary' } },
      { type: 'cylinder', rTop: 0, rBottom: 0.07, h: 0.2, seg: 9, material: { color: 'primary' } },
      { type: 'cone', r: 0.05, h: 0.2, seg: 7, material: { color: 'primary' } },
      { type: 'sphere', r: 0.05, wseg: 10, hseg: 7, material: { color: 'primary' } },
      { type: 'torus', r: 0.05, tube: 0.01, seg: 14, material: { color: 'primary' } },
      { type: 'capsule', r: 0.03, h: 0.1, seg: 8, material: { color: 'primary' } },
      { type: 'lathe', points: [[0.01, 0], [0.03, 0.05], [0.02, 0.1]], seg: 9, material: { color: 'primary' } },
      { type: 'extrude', outline: [[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.08]], depth: 0.02, material: { color: 'primary' } },
      { type: 'extrude', outline: [[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.08]], depth: 0.02, bevel: 0.003, material: { color: 'primary' } },
      { type: 'tube', path: [[0, 0, 0], [0.1, 0.05, 0], [0.2, 0, 0.05]], r: 0.01, seg: 5, material: { color: 'primary' } },
    ];
    for (const s of shapes) {
      const { design } = sanitizeDesign({ class: 'pistol', components: [{ id: 'a', label: 'a', role: 'core', transform: {}, shapes: [s] }] });
      const g = buildDesign(design);
      const ud = g.userData as { tris: number };
      expect([s.type, ud.tris]).toEqual([s.type, shapeTris(design.components[0].shapes![0])]);
      disposeDesignObject(g);
    }
  });

  it('builds the examples with matching layout and within the triangle budget', () => {
    for (const ex of FORGE_EXAMPLES) {
      const { design } = sanitizeDesign(ex);
      const g = buildDesign(design);
      const ud = g.userData as { tris: number; components: Map<string, THREE.Object3D>; missing: string[] };
      expect(ud.tris).toBe(designTrisEstimate(design.components));
      expect(ud.tris).toBeLessThanOrEqual(4000);
      expect(ud.components.size).toBe(design.components.length);
      // THREE bounds agree with the pure layout (pure boxes are ~conservative: rotated AABBs)
      const real = new THREE.Box3().setFromObject(g);
      const pure = designBox(layoutComponents(design.components));
      const rs = real.getSize(new THREE.Vector3());
      const ps = boxSize(pure);
      // (extrude bevels mitre slightly past the outline at sharp corners)
      expect(rs.x).toBeLessThanOrEqual(ps[0] * 1.03);
      expect(rs.z).toBeLessThanOrEqual(ps[2] * 1.03);
      expect(rs.z).toBeGreaterThan(ps[2] * 0.85);
      disposeDesignObject(g);
    }
  });

  it('builds catalog-part components with @ai-gaem/parts', () => {
    const { design } = sanitizeDesign({
      class: 'pistol',
      components: [
        { id: 'core', label: 'frame', role: 'core', transform: {}, catalogPart: { partId: 'core-pistol-block' } },
        { id: 'tip', label: 'tip', role: 'muzzle', parent: 'core', attach: 'front', transform: {}, shapes: [{ type: 'sphere', r: 0.02, material: { color: 'accent' } }] },
      ],
    });
    const g = buildDesign(design);
    const ud = g.userData as { tris: number; missing: string[]; components: Map<string, THREE.Object3D> };
    expect(ud.missing).toEqual([]);
    expect(ud.tris).toBeGreaterThan(12);
    // the tip sits on the real front face of the part
    const core = new THREE.Box3().setFromObject(ud.components.get('core')!.children[0]);
    const tipPos = new THREE.Vector3();
    ud.components.get('tip')!.getWorldPosition(tipPos);
    expect(tipPos.z).toBeCloseTo(core.min.z, 4);
  });
});
