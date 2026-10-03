import { TEST_MAP_SPAWN_POINTS } from './net';
import { TAURON_ARENA_SPAWNS } from './tauron-arena.spawns';
import { TAURON_REMAKE_PICKUPS, TAURON_REMAKE_SPAWNS } from './tauronRemake/spawns';
import type { MapPickup } from './pickups';

export { TAURON_ARENA_SPAWNS, TAURON_REMAKE_SPAWNS, TAURON_REMAKE_PICKUPS };

export interface MapSpawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface MapDef {
  id: string;
  url: string | null;
  /** built in code by the client (`url` is null): `?map=<id>` selects it */
  procedural?: boolean;
  collisionUrl?: string;
  spawns: readonly MapSpawn[];
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  killY?: number;
  /** health packs etc. (server seeds one `pickup` row each for the active map) */
  pickups?: readonly MapPickup[];
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
  // Same arena as a watertight greybox (the solidified shell itself): no holes, no textures.
  // Try it with `?map=/maps/tauron-solid.glb` if the photo mesh's gaps bother you.
  'tauron-solid': {
    id: 'tauron-solid',
    url: '/maps/tauron-solid.glb',
    spawns: TAURON_ARENA_SPAWNS,
    bounds: { min: [-77.71, 0, -73.31], max: [77.71, 37.94, 73.31] },
  },
  // Original procedural remake of TAURON Arena Kraków (no scan data): bowl, boxes, concourse,
  // tunnels. Built by client/src/map/tauronRemake.ts from shared/src/tauronRemake. `?map=tauron-remake`
  'tauron-remake': {
    id: 'tauron-remake',
    url: null,
    procedural: true,
    spawns: TAURON_REMAKE_SPAWNS,
    pickups: TAURON_REMAKE_PICKUPS,
    bounds: { min: [-68.6, 0, -55.6], max: [68.6, 30, 55.6] },
    killY: -20,
  },
};

export const ACTIVE_MAP_ID = 'tauron-remake';

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

/** what the client loads for a map: its GLB url, or its id for a procedural map */
export function mapSource(def: MapDef): string | undefined {
  return def.url ?? (def.procedural ? def.id : undefined);
}

/** registry entry for a `?map=` value / loaded url: matches a GLB url or a procedural map id */
export function findMapDef(source: string | undefined): MapDef | undefined {
  if (!source) return undefined;
  return Object.values(MAPS).find((m) => m.url === source || (m.procedural === true && m.id === source));
}

export function effectiveSpawns(def: MapDef): readonly MapSpawn[] {
  return def.spawns.length > 0 ? def.spawns : TEST_MAP_SPAWN_POINTS;
}

/** pickups of a map (none when it defines none) */
export function mapPickups(def: MapDef | undefined): readonly MapPickup[] {
  return def?.pickups ?? [];
}
