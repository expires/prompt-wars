import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

export interface PhysicsContext {
  RAPIER: Rapier;
  world: RAPIER.World;
}

export const FIXED_DT = 1 / 60;
export const GRAVITY = -20;

export async function initPhysics(): Promise<PhysicsContext> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  return { RAPIER, world };
}
