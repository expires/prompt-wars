import { describe, expect, it } from 'vitest';
import { ACTIVE_MAP_ID, MAPS, TAURON_ARENA_SPAWNS, activeMap, effectiveSpawns, spawnSetsEqual } from './maps';
import type { MapDef, MapSpawn } from './maps';
import { TEST_MAP_SPAWN_POINTS } from './net';

describe('MAPS registry', () => {
  it('registers testmap without a url and with the test map spawns', () => {
    const testmap = MAPS.testmap;
    expect(testmap).toBeDefined();
    expect(testmap!.id).toBe('testmap');
    expect(testmap!.url).toBeNull();
    expect(testmap!.spawns).toBe(TEST_MAP_SPAWN_POINTS);
  });

  it('registers tauron-arena with its glb url and baked spawns', () => {
    const arena = MAPS['tauron-arena'];
    expect(arena).toBeDefined();
    expect(arena!.id).toBe('tauron-arena');
    expect(arena!.url).toBe('/maps/tauron-arena.glb');
    expect(arena!.spawns).toBe(TAURON_ARENA_SPAWNS);
    expect(arena!.spawns.length).toBeGreaterThan(0);
  });

  it('keys every map entry by its id', () => {
    for (const [key, def] of Object.entries(MAPS)) {
      expect(def.id).toBe(key);
    }
  });
});

describe('activeMap', () => {
  it('defaults to the tauron arena', () => {
    expect(ACTIVE_MAP_ID).toBe('tauron-arena');
    expect(activeMap()).toBe(MAPS['tauron-arena']);
  });
});

describe('spawnSetsEqual', () => {
  const a: MapSpawn = { x: 0, y: 1, z: 2, yaw: 0 };
  const b: MapSpawn = { x: 10, y: 0, z: -10, yaw: 1.5 };

  it('is order-insensitive', () => {
    expect(spawnSetsEqual([a, b], [b, a])).toBe(true);
  });

  it('compares only x, y and z', () => {
    expect(spawnSetsEqual([{ ...a, yaw: 0 }], [{ ...a, yaw: 3.14 }])).toBe(true);
  });

  it('respects the epsilon', () => {
    const nudged: MapSpawn = { x: a.x + 0.0005, y: a.y, z: a.z, yaw: a.yaw };
    expect(spawnSetsEqual([a], [nudged])).toBe(true);
    expect(spawnSetsEqual([a], [nudged], 1e-6)).toBe(false);
    expect(spawnSetsEqual([a], [{ x: a.x + 0.5, y: a.y, z: a.z, yaw: a.yaw }])).toBe(false);
  });

  it('rejects different lengths or unknown spawns', () => {
    expect(spawnSetsEqual([a], [])).toBe(false);
    expect(spawnSetsEqual([a], [a, b])).toBe(false);
    expect(spawnSetsEqual([a], [b])).toBe(false);
  });

  it('does not reuse a single element for a duplicate spawn', () => {
    expect(spawnSetsEqual([a, a], [a, b])).toBe(false);
    expect(spawnSetsEqual([a, a], [a, { ...a }])).toBe(true);
  });

  it('treats two empty sets as equal', () => {
    expect(spawnSetsEqual([], [])).toBe(true);
  });
});

describe('effectiveSpawns', () => {
  it('falls back to the test map spawns when a map declares none', () => {
    const empty: MapDef = { id: 'custom', url: null, spawns: [] };
    expect(effectiveSpawns(empty)).toBe(TEST_MAP_SPAWN_POINTS);
  });

  it('returns the map spawns when present', () => {
    const spawn: MapSpawn = { x: 4, y: 5, z: 6, yaw: 0 };
    const def: MapDef = { id: 'custom', url: null, spawns: [spawn] };
    expect(effectiveSpawns(def)).toEqual([spawn]);
  });

  it('uses a non-empty spawn list over the fallback', () => {
    const def: MapDef = { id: 'custom', url: null, spawns: [{ x: 1, y: 2, z: 3, yaw: 0 }] };
    expect(effectiveSpawns(def)).not.toBe(TEST_MAP_SPAWN_POINTS);
  });
});
