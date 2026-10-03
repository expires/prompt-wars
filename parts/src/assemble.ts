/**
 * assembleWeapon(recipe): places the first (core) part at the origin, then
 * attaches each following part to a free socket with a matching name on the
 * parts already placed. Unknown part ids are skipped (and reported in
 * group.userData.missing).
 *
 * Socket search order: most-recently placed part first (so a muzzle device
 * lands on the barrel tip, a blade on the guard, etc.), then back toward the
 * core. If no exact name is free, a small alias table is tried (e.g. 'deco'
 * can fall back to 'top'/'side').
 *
 * Orientation: every part is modelled growing along a default axis for the
 * socket name it plugs into (barrel -> -Z, stock -> +Z, grip/mag -> -Y,
 * top/deco -> +Y, side -> +X ...). If the parent's socket declares a `dir`,
 * the child is rotated from that default axis onto `dir`.
 */
import * as THREE from 'three';
import type { PartDef, Recipe, RecipePart, Vec3 } from './types';
import { getPart } from './registry';

export const DEFAULT_AXIS: Record<string, Vec3> = {
  barrel: [0, 0, -1],
  muzzle: [0, 0, -1],
  nozzle: [0, 0, -1],
  blade: [0, 0, -1],
  head: [0, 0, -1],
  guard: [0, 0, -1],
  stock: [0, 0, 1],
  pommel: [0, 0, 1],
  handle: [0, 0, 1],
  grip: [0, -1, 0],
  mag: [0, -1, 0],
  under: [0, -1, 0],
  tank: [0, -1, 0],
  top: [0, 1, 0],
  deco: [0, 1, 0],
  side: [1, 0, 0],
};

export const SOCKET_ALIASES: Record<string, string[]> = {
  deco: ['top', 'side', 'under'],
  side: ['deco'],
  tank: ['under', 'mag', 'top'],
  nozzle: ['muzzle', 'barrel'],
  muzzle: ['nozzle', 'barrel'],
  barrel: ['muzzle'],
  blade: ['head', 'guard'],
  head: ['blade', 'guard'],
  guard: ['blade', 'head'],
  under: ['mag'],
  mag: ['under'],
  top: ['deco'],
  pommel: ['stock'],
  stock: ['pommel'],
  grip: ['under'],
};

interface Placed {
  def: PartDef;
  obj: THREE.Object3D;
  used: Set<string>;
}

const _q = new THREE.Quaternion();

function axisOf(name: string): THREE.Vector3 {
  const a = DEFAULT_AXIS[name] ?? [0, 1, 0];
  return new THREE.Vector3(a[0], a[1], a[2]);
}

function findSocket(placed: Placed[], wanted: string): { p: Placed; name: string } | null {
  const names = [wanted, ...(SOCKET_ALIASES[wanted] ?? [])];
  for (const name of names) {
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i];
      if (p.def.sockets[name] && !p.used.has(name)) return { p, name };
    }
  }
  return null;
}

export interface AssembleResult extends THREE.Group {
  userData: { missing: string[]; unplaced: string[]; recipe: string };
}

export function assembleWeapon(recipe: Recipe, lookup: (id: string) => PartDef | undefined = getPart): THREE.Group {
  const root = new THREE.Group();
  root.name = recipe.name;
  const missing: string[] = [];
  const unplaced: string[] = [];
  const placed: Placed[] = [];

  for (const rp of recipe.parts) {
    const def = lookup(rp.partId);
    if (!def) {
      missing.push(rp.partId);
      continue;
    }
    const obj = def.build({ color: rp.color, accent: rp.accent, scale: rp.scale });
    if (placed.length === 0) {
      root.add(obj);
      obj.updateMatrixWorld(true);
      placed.push({ def, obj, used: new Set() });
      continue;
    }
    const want = rp.socket || def.attach || 'deco';
    const hit = findSocket(placed, want);
    if (!hit) {
      unplaced.push(rp.partId);
      continue;
    }
    hit.p.used.add(hit.name);
    attachTo(obj, def, hit.p, hit.name);
    root.add(obj);
    obj.updateMatrixWorld(true);
    placed.push({ def, obj, used: new Set() });
  }
  root.userData = { missing, unplaced, recipe: recipe.name };
  return root;
}

function attachTo(child: THREE.Object3D, def: PartDef, parent: Placed, socketName: string) {
  const sock = parent.def.sockets[socketName];
  parent.obj.updateMatrixWorld(true);
  // world position of socket (respects parent's scale/rotation)
  const pos = new THREE.Vector3(...sock.pos);
  parent.obj.localToWorld(pos);
  // direction in parent-local space
  const childAxis = axisOf(def.attach || socketName);
  const dirLocal = sock.dir ? new THREE.Vector3(...sock.dir).normalize() : axisOf(socketName);
  const local = new THREE.Quaternion().setFromUnitVectors(childAxis, dirLocal);
  // preserve "up" as much as possible when flipping 180 deg about a vertical-ish axis
  if (childAxis.dot(dirLocal) < -0.999) {
    const flipAxis = Math.abs(childAxis.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    local.setFromAxisAngle(flipAxis, Math.PI);
  }
  parent.obj.getWorldQuaternion(_q);
  child.quaternion.copy(_q).multiply(local);
  child.position.copy(pos);
}

/** Convenience: assemble a list of RecipePart without a name. */
export function assembleParts(parts: RecipePart[], cls = 'weird'): THREE.Group {
  return assembleWeapon({ name: 'custom', class: cls, parts });
}
