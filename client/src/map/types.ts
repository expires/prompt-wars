import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

export type Vec3 = [number, number, number];

export interface MapMeta {
  bbox?: { min: [number, number, number]; max: [number, number, number] };
  [k: string]: unknown;
}

export interface GameMap {
  /** id used for per-map storage (spawn points etc.) */
  id: string;
  root: THREE.Object3D;
  colliders: RAPIER.Collider[];
  /** built-in default spawn points (feet position) */
  spawns: Vec3[];
  /** y below which a player is considered out of the world */
  killY: number;
  /** optional sidecar metadata from `<name>.meta.json` */
  meta?: MapMeta;
  dispose(): void;
}
