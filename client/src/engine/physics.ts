import type RAPIER from '@dimforge/rapier3d';

export type Rapier = typeof RAPIER;

export interface PhysicsContext {
  RAPIER: Rapier;
  world: RAPIER.World;
}

export const FIXED_DT = 1 / 60;
export const GRAVITY = -20;

let rapier: Promise<Rapier> | null = null;

/**
 * Load Rapier (its own chunk + a separate, streamed-compiled .wasm; see vite.config.ts). Called
 * early from main.ts so the download overlaps the rest of the boot; initPhysics() awaits it.
 */
export function loadRapier(): Promise<Rapier> {
  rapier ??= import('@dimforge/rapier3d').then((m) => m.default);
  return rapier;
}

export async function initPhysics(): Promise<PhysicsContext> {
  const R = await loadRapier();
  const world = new R.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  return { RAPIER: R, world };
}
