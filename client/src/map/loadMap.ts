import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PhysicsContext } from '../engine/physics';
import { buildTrimeshColliders } from './collider';
import type { GameMap, MapMeta, Vec3 } from './types';

// GLTFLoader + meshopt decoder are only needed for GLB maps: their own chunk, fetched on demand
// (in parallel with the map download itself) so they stay out of the initial bundle
let loader: Promise<GLTFLoader> | null = null;
function gltfLoader(): Promise<GLTFLoader> {
  loader ??= Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]).then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
    const l = new GLTFLoader();
    l.setMeshoptDecoder(MeshoptDecoder);
    return l;
  });
  return loader;
}

/** Above this visual triangle count, meshes stop casting shadows (big venue scans). */
const SHADOW_TRIANGLE_BUDGET = 150_000;

async function tryLoad(url: string): Promise<THREE.Group | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    // fetch the loader chunk while the map body downloads (not for an SPA-fallback index.html)
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) void gltfLoader().catch(() => {});
    const buf = await res.arrayBuffer();
    // Vite's SPA fallback serves index.html (200) for missing files: sniff the payload
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
    const isGlb = head.startsWith('glTF');
    const isGltfJson = head.trimStart().startsWith('{');
    if (!isGlb && !isGltfJson) return null;
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    const gltf = await (await gltfLoader()).parseAsync(buf, base);
    return gltf.scene;
  } catch (err) {
    console.warn('[map] could not load', url, err);
    return null;
  }
}

/** `map.glb` -> `map.meta.json` */
export function metaUrlFor(url: string) {
  return url.replace(/(\.glb|\.gltf)(\?.*)?$/i, '.meta.json$2');
}

async function tryLoadMeta(url: string): Promise<MapMeta | undefined> {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    // Same index.html sniffing as tryLoad: the SPA fallback returns HTML with a 200
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
    if (!head.trimStart().startsWith('{')) return undefined;
    const parsed = JSON.parse(new TextDecoder().decode(buf));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as MapMeta;
  } catch {
    return undefined;
  }
}

/** `map.glb` -> `map_collision.glb` */
export function collisionUrlFor(url: string) {
  return url.replace(/(\.glb|\.gltf)(\?.*)?$/i, '_collision$1$2');
}

function countVisualTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry as THREE.BufferGeometry | undefined;
    if (!geo) return;
    const index = geo.getIndex();
    if (index) tris += index.count / 3;
    else {
      const pos = geo.getAttribute('position');
      if (pos) tris += pos.count / 3;
    }
  });
  return Math.round(tris);
}

/** Maps built in code (MapDef.procedural): id -> lazy builder chunk */
const PROCEDURAL: Record<string, () => Promise<(physics: PhysicsContext, scene: THREE.Scene) => GameMap>> = {
  'tauron-remake': () => import('./tauronRemake').then((m) => m.createTauronRemake),
};

/**
 * Load a GLB map. Visuals come from `url`; colliders are built from
 * `<name>_collision.glb` if present, otherwise from the visual meshes.
 * A procedural map id (e.g. `tauron-remake`) is built in code instead.
 */
export async function loadMap(
  url: string,
  physics: PhysicsContext,
  scene: THREE.Scene,
  opts: { spawns?: Vec3[]; collisionUrl?: string; shell?: boolean } = {},
): Promise<GameMap> {
  const procedural = PROCEDURAL[url];
  if (procedural) return (await procedural())(physics, scene);
  const visual = await tryLoad(url);
  if (!visual) throw new Error(`Map not found: ${url}`);

  const triangles = countVisualTriangles(visual);
  const castShadow = triangles <= SHADOW_TRIANGLE_BUDGET;
  visual.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = castShadow;
    m.receiveShadow = true;
    // Unlit scans (KHR_materials_unlit -> MeshBasicMaterial) must keep their
    // baked texture in sRGB and stay frustum-culled like any other mesh.
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const one of mats) {
      const basic = one as THREE.MeshBasicMaterial;
      if (basic.isMeshBasicMaterial && basic.map) basic.map.colorSpace = THREE.SRGBColorSpace;
    }
    m.frustumCulled = true;
  });
  scene.add(visual);

  const collisionScene = await tryLoad(opts.collisionUrl ?? collisionUrlFor(url));
  const colliders = buildTrimeshColliders(collisionScene ?? visual, physics);
  console.info(
    `[map] ${url}: ${colliders.length} colliders from ${collisionScene ? 'collision GLB' : 'visual mesh'}, ${triangles} visual triangles`,
  );

  // Neutral backdrop: render the (solidified) collision shell's back faces so holes in the photo
  // scan read as solid walls instead of voids. polygonOffset pushes it behind the scan, so the
  // texture wins wherever the scan actually has geometry; the shell only shows through gaps.
  let shell: THREE.Object3D | null = null;
  if (collisionScene && opts.shell !== false) {
    const shellMat = new THREE.MeshBasicMaterial({ color: 0x707379, side: THREE.BackSide });
    shellMat.polygonOffset = true;
    shellMat.polygonOffsetFactor = 1;
    shellMat.polygonOffsetUnits = 1;
    collisionScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = shellMat;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = true;
    });
    collisionScene.renderOrder = -1;
    scene.add(collisionScene);
    shell = collisionScene;
  }

  const meta = await tryLoadMeta(metaUrlFor(url));

  const bb = new THREE.Box3().setFromObject(visual);
  const center = bb.getCenter(new THREE.Vector3());
  const spawns: Vec3[] = opts.spawns ?? [[center.x, bb.max.y + 1, center.z]];

  return {
    id: url.split('/').pop()!.replace(/\.[^.]+$/, ''),
    root: visual,
    colliders,
    spawns,
    killY: bb.min.y - 20,
    meta,
    dispose() {
      scene.remove(visual);
      if (shell) scene.remove(shell);
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
