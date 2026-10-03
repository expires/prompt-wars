import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PhysicsContext } from '../engine/physics';
import { buildTrimeshColliders } from './collider';
import type { GameMap, Vec3 } from './types';

const loader = new GLTFLoader();

async function tryLoad(url: string): Promise<THREE.Group | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Vite's SPA fallback serves index.html (200) for missing files: sniff the payload
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
    const isGlb = head.startsWith('glTF');
    const isGltfJson = head.trimStart().startsWith('{');
    if (!isGlb && !isGltfJson) return null;
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    const gltf = await loader.parseAsync(buf, base);
    return gltf.scene;
  } catch (err) {
    console.warn('[map] could not load', url, err);
    return null;
  }
}

/** `map.glb` -> `map_collision.glb` */
export function collisionUrlFor(url: string) {
  return url.replace(/(\.glb|\.gltf)(\?.*)?$/i, '_collision$1$2');
}

/**
 * Load a GLB map. Visuals come from `url`; colliders are built from
 * `<name>_collision.glb` if present, otherwise from the visual meshes.
 */
export async function loadMap(
  url: string,
  physics: PhysicsContext,
  scene: THREE.Scene,
  opts: { spawns?: Vec3[]; collisionUrl?: string } = {},
): Promise<GameMap> {
  const visual = await tryLoad(url);
  if (!visual) throw new Error(`Map not found: ${url}`);
  visual.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  scene.add(visual);

  const collisionScene = await tryLoad(opts.collisionUrl ?? collisionUrlFor(url));
  const colliders = buildTrimeshColliders(collisionScene ?? visual, physics);
  console.info(`[map] ${url}: ${colliders.length} colliders from ${collisionScene ? 'collision GLB' : 'visual mesh'}`);

  const bb = new THREE.Box3().setFromObject(visual);
  const center = bb.getCenter(new THREE.Vector3());
  const spawns: Vec3[] = opts.spawns ?? [[center.x, bb.max.y + 1, center.z]];

  return {
    id: url.split('/').pop()!.replace(/\.[^.]+$/, ''),
    root: visual,
    colliders,
    spawns,
    killY: bb.min.y - 20,
    dispose() {
      scene.remove(visual);
      colliders.forEach((c) => physics.world.removeCollider(c, false));
    },
  };
}

/**
 * Guess spawn points for a scanned map with no saved spawns: cast rays down
 * from a grid at mid-height and keep hits on walkable (upward-facing) ground.
 * Requires the query pipeline to be up to date (call after a world.step()).
 */
export function findGroundSpawns(map: GameMap, physics: PhysicsContext, grid = 5): Vec3[] {
  const { RAPIER, world } = physics;
  const bb = new THREE.Box3().setFromObject(map.root);
  const size = bb.getSize(new THREE.Vector3());
  const startY = bb.min.y + size.y * 0.5;
  const out: Vec3[] = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = bb.min.x + size.x * ((i + 0.5) / grid);
      const z = bb.min.z + size.z * ((j + 0.5) / grid);
      const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y: startY, z }, { x: 0, y: -1, z: 0 }), size.y, true);
      if (hit && hit.normal.y > 0.8) out.push([x, startY - hit.timeOfImpact + 0.05, z]);
    }
  }
  return out;
}
