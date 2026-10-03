import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsContext } from '../engine/physics';

/**
 * Build fixed trimesh colliders from every mesh under `root` (world space).
 * One collider per mesh keeps BVHs small and lets us skip broken geometry.
 */
export function buildTrimeshColliders(root: THREE.Object3D, physics: PhysicsContext): RAPIER.Collider[] {
  const { RAPIER, world } = physics;
  root.updateMatrixWorld(true);
  const colliders: RAPIER.Collider[] = [];
  const v = new THREE.Vector3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    if (!pos || pos.count < 3) return;
    const vertices = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      vertices[i * 3] = v.x;
      vertices[i * 3 + 1] = v.y;
      vertices[i * 3 + 2] = v.z;
    }
    let indices: Uint32Array;
    if (geo.index) {
      indices = new Uint32Array(geo.index.array as ArrayLike<number>);
    } else {
      indices = new Uint32Array(pos.count - (pos.count % 3));
      for (let i = 0; i < indices.length; i++) indices[i] = i;
    }
    if (indices.length < 3) return;
    try {
      // FIX_INTERNAL_EDGES reduces snagging on triangle seams (important for scans)
      colliders.push(world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)));
    } catch {
      try {
        colliders.push(world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices)));
      } catch (err) {
        console.warn('[map] failed to build trimesh collider for', mesh.name, err);
      }
    }
  });
  return colliders;
}
