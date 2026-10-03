/**
 * Validates everyday-object parts: builds each, checks tris <= 500, <= 8 meshes, finite verts,
 * desc <= 12 words, unique ids, and that every socket lies within 2.5 cm of the surface.
 * Usage: tsx scripts/check-obj.ts [groupOrKindSubstring]
 */
import * as THREE from 'three';
import { PARTS } from '../src/registry';
import { OBJ_INFO } from '../src/gen/obj';
import { countTris } from '../src/lib/kit';

const filter = process.argv[2];
const seen = new Map<string, number>();
for (const p of PARTS) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);

const tri = new THREE.Triangle();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const cp = new THREE.Vector3();

export function socketDistance(obj: THREE.Object3D, pos: [number, number, number]): number {
  const pt = new THREE.Vector3(...pos);
  let best = Infinity;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const arr = m.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < arr.length; i += 9) {
      a.set(arr[i], arr[i + 1], arr[i + 2]);
      b.set(arr[i + 3], arr[i + 4], arr[i + 5]);
      c.set(arr[i + 6], arr[i + 7], arr[i + 8]);
      tri.set(a, b, c);
      tri.closestPointToPoint(pt, cp);
      const d = cp.distanceTo(pt);
      if (d < best) best = d;
    }
  });
  return best;
}

let n = 0;
const problems: string[] = [];
const byGroup: Record<string, number> = {};
const byRole: Record<string, number> = {};
for (const p of PARTS) {
  const info = OBJ_INFO.get(p.id);
  if (!info) continue;
  if (filter && !(info.spec.group.includes(filter) || info.spec.kind.includes(filter))) continue;
  n++;
  byGroup[info.spec.group] = (byGroup[info.spec.group] ?? 0) + 1;
  byRole[info.role] = (byRole[info.role] ?? 0) + 1;
  if ((seen.get(p.id) ?? 0) > 1) problems.push(`DUP ${p.id}`);
  if (p.desc.split(/\s+/).length > 12) problems.push(`DESC ${p.id}: ${p.desc}`);
  let obj: THREE.Object3D;
  try {
    obj = p.build({});
  } catch (e) {
    problems.push(`ERR ${p.id}: ${(e as Error).message}`);
    continue;
  }
  const t = countTris(obj);
  if (t > 500) problems.push(`TRIS ${p.id}: ${t}`);
  let meshes = 0;
  let nan = false;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const arr = m.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) nan = true;
  });
  if (nan) problems.push(`NAN ${p.id}`);
  if (meshes > 8) problems.push(`MESHES ${p.id}: ${meshes}`);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length();
  if (size > 2.6 || size < 0.02) problems.push(`SIZE ${p.id}: ${size.toFixed(2)}m`);
  for (const [name, s] of Object.entries(p.sockets)) {
    const d = socketDistance(obj, s.pos);
    if (d > 0.025) problems.push(`SOCKET ${p.id}.${name} is ${(d * 100).toFixed(1)}cm off surface`);
  }
}
console.log(`${n} object parts checked`, byGroup, byRole);
console.log(problems.length ? problems.join('\n') : 'OK - no problems');
if (problems.length) process.exitCode = 1;
