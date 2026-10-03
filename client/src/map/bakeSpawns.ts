import type { PhysicsContext } from '../engine/physics';
import type { GameMap } from './types';

/**
 * Dev-only spawn baking for scanned maps. `findGroundSpawns` only ever finds the top-most floor
 * of a column, which is useless for a multi-level arena; this walks every column down to the
 * bottom so bowl tiers, concourses and landings all get respawn points a human can paste into
 * `MAPS[id].spawns`.
 */

export interface BakedSpawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface BakeSpawnsOptions {
  /** grid pitch in metres */
  spacing?: number;
  /** explicit bounds (defaults to `map.meta.bbox`) */
  bbox?: { min: Point3; max: Point3 };
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface GridPoint {
  x: number;
  z: number;
}

// ------------------------------------------------------------------ pure helpers

/** XZ grid over a map bbox, `spacing` apart, starting at the min corner. */
export function gridPoints(min: Point3, max: Point3, spacing: number): GridPoint[] {
  const step = spacing > 0 ? spacing : 1;
  const out: GridPoint[] = [];
  for (let x = min.x; x <= max.x + 1e-6; x += step) {
    for (let z = min.z; z <= max.z + 1e-6; z += step) out.push({ x, z });
  }
  return out;
}

/** Greedy filter: keep a point only if it is at least `spacing` away from every kept point. */
export function minDistanceFilter<T extends Point3>(points: T[], spacing: number): T[] {
  const minSq = spacing * spacing;
  const kept: T[] = [];
  for (const p of points) {
    let clash = false;
    for (const k of kept) {
      const dx = k.x - p.x;
      const dy = k.y - p.y;
      const dz = k.z - p.z;
      if (dx * dx + dy * dy + dz * dz < minSq) {
        clash = true;
        break;
      }
    }
    if (!clash) kept.push(p);
  }
  return kept;
}

/** Yaw facing the map centre — the convention used by shared/src/net.ts. */
export function yawToCentre(x: number, z: number, centreX: number, centreZ: number): number {
  return Math.atan2(x - centreX, z - centreZ);
}

// ------------------------------------------------------------------ rapier

type World = PhysicsContext['world'];
type RayArg = Parameters<World['castRayAndGetNormal']>[0];
type RayHit = NonNullable<ReturnType<World['castRayAndGetNormal']>>;

const NORMAL_MIN_Y = 0.85;
const HEADROOM = 2.0;
const CLEARANCE = 0.6;
const CLEARANCE_HEIGHT = 1.0;
const CEILING_MAX = 30;
const PROBE_EPS = 0.05;
const MAX_HITS_PER_COLUMN = 64;

/** Rapier renamed `toi` to `timeOfImpact`; accept either so a version bump cannot break the bake. */
function hitToi(hit: RayHit): number {
  const h = hit as unknown as { toi?: number; timeOfImpact?: number };
  return h.timeOfImpact ?? h.toi ?? 0;
}

/** Rapier only reads origin/dir off a ray, so a plain object keeps this module Rapier-free. */
function ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): RayArg {
  return { origin: { x: ox, y: oy, z: oz }, dir: { x: dx, y: dy, z: dz } } as unknown as RayArg;
}

/** 0.6 m of free space at waist height, probed with 8 horizontal rays. */
function hasClearance(world: World, x: number, y: number, z: number): boolean {
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    if (world.castRayAndGetNormal(ray(x, y, z, Math.cos(a), 0, Math.sin(a)), CLEARANCE, true)) return false;
  }
  return true;
}

/** Map bounds from the scan's `<name>.meta.json` sidecar, as `Point3` corners. */
function boundsFromMap(map: GameMap): { min: Point3; max: Point3 } {
  const meta = map.meta?.bbox;
  if (!meta) throw new Error('bakeSpawns: map has no meta.bbox and no explicit bbox was given');
  return {
    min: { x: meta.min[0], y: meta.min[1], z: meta.min[2] },
    max: { x: meta.max[0], y: meta.max[1], z: meta.max[2] },
  };
}

/**
 * Bake multi-floor spawn candidates for a scanned map. Only reads the query pipeline (plus one
 * `step()` to make sure it is current); the world is never mutated.
 */
export function bakeSpawns(
  map: GameMap,
  physics: PhysicsContext,
  { spacing = 3, bbox: explicitBox }: BakeSpawnsOptions = {},
): BakedSpawn[] {
  const world = physics.world;
  world.step(); // the query pipeline is only refreshed by a step

  // Bounds come from the explicit option, else the scan's meta sidecar (T-004).
  const bbox = explicitBox ?? boundsFromMap(map);
  const centreX = (bbox.min.x + bbox.max.x) / 2;
  const centreZ = (bbox.min.z + bbox.max.z) / 2;
  const floorY = bbox.min.y;
  const startY = bbox.max.y + 0.2;
  const maxDown = startY - floorY + 1;

  // every upward-facing surface in every column: re-cast 5 cm below each hit so the floors
  // underneath it (bowl tiers, concourses, landings) are collected too
  const surfaces: Point3[] = [];
  for (const p of gridPoints(bbox.min, bbox.max, spacing)) {
    let y = startY;
    for (let i = 0; i < MAX_HITS_PER_COLUMN && y > floorY; i++) {
      const hit = world.castRayAndGetNormal(ray(p.x, y, p.z, 0, -1, 0), maxDown, false);
      if (!hit) break;
      const hitY = y - hitToi(hit);
      if (hitY < floorY) break;
      if (hit.normal.y > NORMAL_MIN_Y) surfaces.push({ x: p.x, y: hitY, z: p.z });
      y = hitY - PROBE_EPS;
    }
  }

  // playable: 2 m of headroom and a bit of elbow room at waist height
  const open: Array<Point3 & { ceiling: number | null }> = [];
  for (const s of surfaces) {
    const up = world.castRayAndGetNormal(ray(s.x, s.y + PROBE_EPS, s.z, 0, 1, 0), CEILING_MAX, true);
    const ceiling = up ? hitToi(up) : null;
    if (ceiling !== null && ceiling < HEADROOM - PROBE_EPS - 1e-6) continue;
    if (!hasClearance(world, s.x, s.y + CLEARANCE_HEIGHT, s.z)) continue;
    open.push({ ...s, ceiling });
  }

  // roof/outside points are only noise when the map actually has an interior
  const roofed = open.some((c) => c.ceiling !== null) ? open.filter((c) => c.ceiling !== null) : open;

  return minDistanceFilter(roofed, spacing).map((c) => ({
    x: c.x,
    y: c.y,
    z: c.z,
    yaw: yawToCentre(c.x, c.z, centreX, centreZ),
  }));
}
