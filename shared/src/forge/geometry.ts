// THREE geometry / material helpers for Forge shapes (no catalog dependency: safe to import from
// the main client bundle, e.g. the projectile builder). Used by ./build and ./projectile3d.

import * as THREE from 'three';
import type { DesignPalette, Shape, ShapeMaterial } from './types';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SEG_DEFAULTS, tubeSegments } from './math';

const DEG = Math.PI / 180;

export function resolveColor(c: string | undefined, palette: DesignPalette, dflt: string): string {
  if (!c) return dflt;
  if (c === 'primary' || c === 'secondary' || c === 'accent' || c === 'glow') return palette[c];
  return c;
}

export function makeGeometry(s: Shape): THREE.BufferGeometry {
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

export class MaterialCache {
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
        envMapIntensity: envIntensityFor(metal),
      });
      mat.name = key;
      this.map.set(key, mat);
    }
    return mat;
  }
}

/**
 * Reflection strength for a Forge material: metals rely on the environment for their look (they
 * have no diffuse), dielectrics only get a soft ambient lift so painted / plastic parts don't wash
 * out. Only honoured when the env is set as material.envMap (see forgeEnvironment).
 */
export function envIntensityFor(metalness: number): number {
  const m = Math.max(0, Math.min(1, metalness));
  return 0.08 + 0.92 * m * m;
}

const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/**
 * A cheap prefiltered (PMREM) studio environment for Forge weapons: three's RoomEnvironment,
 * generated once per renderer and cached. Apply it per material (applyForgeEnvironment in ./build):
 * with `scene.environment` three uses scene.environmentIntensity and ignores the per-material
 * envMapIntensity tuning (non-metals would wash out).
 */
export function forgeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  let tex = envCache.get(renderer);
  if (!tex) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    tex = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    envCache.set(renderer, tex);
  }
  return tex;
}

export function setTransform(o: THREE.Object3D, pos: readonly number[], rot: readonly number[], scale: readonly number[]) {
  o.position.set(pos[0], pos[1], pos[2]);
  o.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ');
  o.scale.set(scale[0], scale[1], scale[2]);
}
