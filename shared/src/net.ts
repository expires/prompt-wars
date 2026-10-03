// SpacetimeDB connection defaults. Override in the client with VITE_SPACETIMEDB_HOST /
// VITE_SPACETIMEDB_DB_NAME (e.g. ws://localhost:3000 for a local `spacetime start`).
export const SPACETIME_MAINCLOUD_URI = 'wss://maincloud.spacetimedb.com';
export const SPACETIME_LOCAL_URI = 'ws://localhost:3000';
export const SPACETIME_DB_NAME = 'prompt-wars-63xhe';

/**
 * Spawn points (feet position + yaw facing the arena centre) for the procedural TEST MAP
 * (client/src/map/testMap.ts). The server seeds `spawn_point` with these.
 * Yaw convention: 0 faces -Z, yaw = atan2(dirX, dirZ) of the *backward* vector, i.e. facing
 * the centre from (x, z) is atan2(x, z).
 */
export const TEST_MAP_SPAWN_POINTS: readonly { x: number; y: number; z: number; yaw: number }[] = (
  [
    [0, 0.1, 8],
    [-12, 0.1, -8],
    [14, 0.1, 6],
    [20, 3.1, -16],
    [-20, 2.1, 15],
    [8, 0.1, -24],
    [-25, 0.1, 25],
    [25, 0.1, 25],
  ] as const
).map(([x, y, z]) => ({ x, y, z, yaw: Math.atan2(x, z) }));
