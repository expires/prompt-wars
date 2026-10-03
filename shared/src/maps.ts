import { TEST_MAP_SPAWN_POINTS } from './net';
import { TAURON_ARENA_SPAWNS } from './tauron-arena.spawns';

export { TAURON_ARENA_SPAWNS };

export interface MapSpawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface MapDef {
  id: string;
  url: string | null;
  collisionUrl?: string;
  spawns: readonly MapSpawn[];
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  killY?: number;
}

export const MAPS: Record<string, MapDef> = {
  testmap: {
    id: 'testmap',
    url: null,
    spawns: TEST_MAP_SPAWN_POINTS,
  },
  'tauron-arena': {
    id: 'tauron-arena',
    url: '/maps/tauron-arena.glb',
    spawns: TAURON_ARENA_SPAWNS,
    bounds: { min: [-77.71, 0, -73.31], max: [77.71, 37.94, 73.31] },
  },
};

export const ACTIVE_MAP_ID = 'tauron-arena';

export function activeMap(): MapDef {
  const def = MAPS[ACTIVE_MAP_ID];
  if (!def) throw new Error(`unknown map id: ${ACTIVE_MAP_ID}`);
  return def;
}

// Order-insensitive: each spawn in `a` must match an unused spawn in `b`.
export function spawnSetsEqual(a: readonly MapSpawn[], b: readonly MapSpawn[], eps = 1e-3): boolean {
  if (a.length !== b.length) return false;
  const used: boolean[] = new Array(b.length).fill(false);
  for (const s of a) {
    let matched = false;
    for (let i = 0; i < b.length; i++) {
      if (used[i]) continue;
      const t = b[i]!;
      if (Math.abs(s.x - t.x) <= eps && Math.abs(s.y - t.y) <= eps && Math.abs(s.z - t.z) <= eps) {
        used[i] = true;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

export function effectiveSpawns(def: MapDef): readonly MapSpawn[] {
  return def.spawns.length > 0 ? def.spawns : TEST_MAP_SPAWN_POINTS;
}
