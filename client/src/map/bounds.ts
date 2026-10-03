import * as RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsContext } from '../engine/physics';
import type { Vec3 } from './types';

/** axis-aligned box in world space, `min`/`max` are inclusive corners */
export interface BoundsBox {
  min: Vec3;
  max: Vec3;
}

export interface BoundsOptions {
  /** collider thickness in metres */
  thickness?: number;
  /** also cap the top (scanned ceilings usually have holes too) */
  ceiling?: boolean;
}

/** grow a box by `by` metres on every axis */
export function expandBox(box: BoundsBox, by: number): BoundsBox {
  return {
    min: [box.min[0] - by, box.min[1] - by, box.min[2] - by],
    max: [box.max[0] + by, box.max[1] + by, box.max[2] + by],
  };
}

/**
 * Invisible safety net for scanned maps: four walls (and optionally a ceiling) hugging `box`,
 * sitting just *outside* the AABB so they never clip into the playable geometry. Nothing is
 * added to the scene. The returned colliders belong to the caller — push them onto the map so
 * `dispose()` removes them again.
 */
export function addBoundsColliders(
  physics: PhysicsContext,
  box: BoundsBox,
  { thickness = 1, ceiling = true }: BoundsOptions = {},
): RAPIER.Collider[] {
  const t = Math.max(0.05, thickness);
  const half = t / 2;
  const [minX, minY, minZ] = box.min;
  const [maxX, maxY, maxZ] = box.max;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  // half extents of the walls, including one thickness of outward margin
  const hx = (maxX - minX) / 2 + t;
  const hy = (maxY - minY) / 2 + t;
  const hz = (maxZ - minZ) / 2 + t;

  const slabs: { half: Vec3; center: Vec3 }[] = [
    { half: [hx, hy, half], center: [cx, cy, minZ - half] },
    { half: [hx, hy, half], center: [cx, cy, maxZ + half] },
    { half: [half, hy, hz], center: [minX - half, cy, cz] },
    { half: [half, hy, hz], center: [maxX + half, cy, cz] },
  ];
  if (ceiling) slabs.push({ half: [hx, half, hz], center: [cx, maxY + half, cz] });

  return slabs.map(({ half: h, center: c }) => {
    const desc = RAPIER.ColliderDesc.cuboid(h[0], h[1], h[2]).setTranslation(c[0], c[1], c[2]);
    return physics.world.createCollider(desc);
  });
}
