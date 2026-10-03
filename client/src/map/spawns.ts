import type { Vec3 } from './types';

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

const key = (mapId: string) => `ai-gaem.spawns.${mapId}`;

export function loadSavedSpawns(mapId: string): SpawnPoint[] {
  try {
    const raw = localStorage.getItem(key(mapId));
    const arr = raw ? (JSON.parse(raw) as SpawnPoint[]) : [];
    return Array.isArray(arr) ? arr.filter((s) => Array.isArray(s.pos) && s.pos.length === 3) : [];
  } catch {
    return [];
  }
}

export function saveSpawns(mapId: string, spawns: SpawnPoint[]) {
  try {
    localStorage.setItem(key(mapId), JSON.stringify(spawns));
  } catch {
    /* storage unavailable */
  }
}

/** Saved (editor) spawns win over the map's built-in defaults. */
export function getSpawnPoints(mapId: string, defaults: Vec3[]): SpawnPoint[] {
  const saved = loadSavedSpawns(mapId);
  return saved.length ? saved : defaults.map((pos) => ({ pos, yaw: Math.random() * Math.PI * 2 }));
}

export function pickRandomSpawn(points: SpawnPoint[], avoid?: Vec3[]): SpawnPoint {
  if (!avoid?.length || points.length < 2) return points[Math.floor(Math.random() * points.length)];
  // prefer the spawn farthest from the nearest other player, with some randomness
  const scored = points.map((p) => {
    const d = Math.min(...avoid.map((a) => Math.hypot(a[0] - p.pos[0], a[1] - p.pos[1], a[2] - p.pos[2])));
    return { p, s: d * (0.7 + Math.random() * 0.6) };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0].p;
}
