// How a weapon's projectile looks in flight: the Forge design's generated `projectile`, else the
// built-in preset for fx.projectileShape, else null (legacy glowing sphere). Resolved once per
// weapon object; meshes share a cached merged geometry + materials (cheap with many in flight).
import * as THREE from 'three';
import { presetProjectile, type ProjectileDesign, type ProjectileImpact, type Trail } from '@ai-gaem/shared';
import { createProjectileMesh } from '@ai-gaem/shared/forge/projectile3d';
import type { Weapon } from './types';
import { shotColor } from './elementFx';

export interface ProjectileLook {
  /** the generated / preset model (null: legacy sphere) */
  design: ProjectileDesign | null;
  /** true when it comes from the design's own `projectile` (the thrown object for throwables) */
  generated: boolean;
  make(): THREE.Object3D;
  /** rad / s around a local axis (null = none) */
  spin: { axis: THREE.Vector3; rate: number } | null;
  wobble: number;
  trail: Trail;
  trailColor: number;
  impact: ProjectileImpact | null;
  impactColor: number;
}

const DEFAULT_PALETTE = { primary: '#3a3f47', secondary: '#8a8f99', accent: '#ff7a1a', glow: '#66e0ff' };
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const TRAIL_COLORS: Record<Trail, number> = { none: 0, smoke: 0x888888, spark: 0xffc040, fire: 0xff6a20, bubble: 0xa0e0ff, glow: 0x80e0ff };
const looks = new WeakMap<Weapon, ProjectileLook>();

export function projectileLookOf(w: Weapon): ProjectileLook {
  let look = looks.get(w);
  if (!look) looks.set(w, (look = resolveLook(w)));
  return look;
}

function resolveLook(w: Weapon): ProjectileLook {
  const d = w.design;
  const palette = d?.palette ?? { ...DEFAULT_PALETTE, ...(w.colors ?? {}) };
  const fx = d?.fx ?? {};
  const color = fx.projectileColor ?? palette.accent;
  const generated = !!d?.projectile;
  const design = d?.projectile ?? (fx.projectileShape ? presetProjectile(fx.projectileShape, color) : null);
  const scale = generated ? 1 : (fx.projectileScale ?? 1);
  const trail: Trail = design?.trail ?? fx.trail ?? 'smoke';
  const trailHex = design?.trailColor ?? fx.trailColor;
  const accent = new THREE.Color(color).getHex();
  let make: () => THREE.Object3D;
  if (design) {
    make = () => {
      const m = createProjectileMesh(design, palette);
      if (scale !== 1) m.scale.setScalar(scale);
      return m;
    };
  } else {
    // legacy look: a small glowing sphere in the accent colour (one shared material per weapon)
    const geo = legacyGeo();
    const mat = new THREE.MeshBasicMaterial({ color: shotColor(w, 0xffaa33) });
    const s = (w.fireMode === 'arc' ? 1 : 1.3) * scale;
    make = () => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(s);
      m.userData.sharedProjectile = true;
      return m;
    };
  }
  return {
    design,
    generated,
    make,
    spin: design?.spin ? { axis: AXES[design.spin.axis], rate: design.spin.rate * Math.PI * 2 } : null,
    wobble: design?.wobble ?? 0,
    trail,
    trailColor: trailHex ? new THREE.Color(trailHex).getHex() : trail === 'glow' ? accent : TRAIL_COLORS[trail],
    impact: design?.impact ?? null,
    impactColor: accent,
  };
}

let LEGACY_GEO: THREE.SphereGeometry | null = null;
function legacyGeo() {
  return (LEGACY_GEO ??= new THREE.SphereGeometry(0.08, 8, 6));
}
