// In-game outfit models, shared per outfit (same pattern as weapons/designModelCache): an outfit is
// baked once (buildOutfitBones: per bone one Group, one merged mesh per material) and every player
// wearing it gets cheap Object3D.clone()s sharing geometry + materials. Reference counted; idle
// entries linger in a small LRU before their GPU resources are freed.
import * as THREE from 'three';
import type { BoneName, OutfitDesign } from '@ai-gaem/shared';
import { buildOutfitBones, disposeOutfitObject } from '@ai-gaem/shared/outfit/build';
import { forgeEnvironment } from '@ai-gaem/shared/forge/geometry';

interface Entry {
  key: string;
  /** template groups per bone (never attached to a scene) */
  bones: Partial<Record<BoneName, THREE.Group>>;
  refs: number;
  tris: number;
}

const IDLE_MAX = 8;
const entries = new Map<string, Entry>();
const idle: string[] = [];
let envRenderer: THREE.WebGLRenderer | null = null;
let envMap: THREE.Texture | null = null;

const KEY = 'outfitModelKey';
/** meshes whose geometry / material belong to this cache */
export const OUTFIT_SHARED_FLAG = 'sharedOutfit';

function hashString(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519) + (h2 >>> 13);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}:${s.length}`;
}

export function outfitKey(o: OutfitDesign): string {
  return hashString(JSON.stringify(o));
}

function applyEnv(e: Entry) {
  if (!envRenderer) return;
  envMap ??= forgeEnvironment(envRenderer);
  for (const g of Object.values(e.bones)) {
    g?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.envMap !== envMap) {
        mat.envMap = envMap;
        mat.needsUpdate = true;
      }
    });
  }
}

export function setOutfitEnvRenderer(renderer: THREE.WebGLRenderer | null) {
  envRenderer = renderer;
  envMap = null;
  for (const e of entries.values()) applyEnv(e);
}

function dispose(e: Entry) {
  entries.delete(e.key);
  for (const g of Object.values(e.bones)) if (g) disposeOutfitObject(g);
}

/** Per-bone instances of an outfit (attach with Humanoid.attachOutfit, free with releaseOutfitParts). */
export function acquireOutfitParts(outfit: OutfitDesign): Partial<Record<BoneName, THREE.Group>> {
  const key = outfitKey(outfit);
  let e = entries.get(key);
  if (!e) {
    const built = buildOutfitBones(outfit);
    for (const g of Object.values(built.bones)) {
      g?.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.userData[OUTFIT_SHARED_FLAG] = true;
      });
    }
    e = { key, bones: built.bones, refs: 0, tris: built.userData.tris };
    applyEnv(e);
    entries.set(key, e);
  }
  const i = idle.indexOf(key);
  if (i >= 0) idle.splice(i, 1);
  e.refs++;
  const out: Partial<Record<BoneName, THREE.Group>> = {};
  let first = true;
  for (const [bone, g] of Object.entries(e.bones) as [BoneName, THREE.Group][]) {
    const inst = g.clone(true);
    // one ref per acquire: the key rides on the first group only
    if (first) inst.userData[KEY] = key;
    first = false;
    out[bone] = inst;
  }
  if (first) {
    // outfit without pieces: still count the ref on a placeholder so release stays balanced
    const ph = new THREE.Group();
    ph.userData[KEY] = key;
    out.hips = ph;
  }
  return out;
}

/** Release outfit instances (from acquireOutfitParts / Humanoid.detachOutfit). */
export function releaseOutfitParts(objs: readonly THREE.Object3D[]) {
  for (const o of objs) {
    const k = o.userData?.[KEY] as string | undefined;
    if (!k) continue;
    delete o.userData[KEY];
    const e = entries.get(k);
    if (!e || e.refs <= 0) continue;
    if (--e.refs === 0) {
      idle.push(k);
      while (idle.length > IDLE_MAX) {
        const old = entries.get(idle.shift()!);
        if (old && old.refs === 0) dispose(old);
      }
    }
  }
}

export function outfitCacheStats() {
  let refs = 0;
  let tris = 0;
  for (const e of entries.values()) {
    refs += e.refs;
    tris += e.tris;
  }
  return { entries: entries.size, idle: idle.length, refs, tris };
}
