// In-game Forge design models, shared per design. buildDesignMerged() bakes a design into one mesh
// per material; the result is cached by design content, so the viewmodel and every remote player
// holding the same design share one set of geometries + materials (instances are cheap
// Object3D.clone()s). Reference counted: release with releaseDesignModels(); unreferenced
// entries linger in a small LRU (re-equips, respawns) before their GPU resources are freed.
import * as THREE from 'three';
import type { ForgeDesign } from '@ai-gaem/shared/forge';
import type { PartsLibrary } from './partsLibrary';

interface Entry {
  key: string;
  template: THREE.Group;
  refs: number;
  lib: PartsLibrary;
}

/** unreferenced models kept around before disposal */
const IDLE_MAX = 6;

const entries = new Map<string, Entry>();
/** keys with refs === 0, oldest first */
const idle: string[] = [];
let envMap: THREE.Texture | null = null;
let envRenderer: THREE.WebGLRenderer | null = null;

/** marks an instance root (holds the cache key) */
const KEY = 'designModelKey';
/** marks meshes whose geometry / material belong to the cache (never dispose them directly) */
export const SHARED_FLAG = 'sharedDesignModel';

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

export function designKey(design: ForgeDesign): string {
  return hashString(JSON.stringify(design));
}

function applyEnv(root: THREE.Object3D, lib: PartsLibrary) {
  if (!envMap && envRenderer) envMap = lib.forgeEnvironment(envRenderer);
  lib.applyForgeEnvironment(root, envMap);
}

/**
 * Renderer whose PMREM studio environment (forgeEnvironment, generated lazily on the first design
 * model, cached per renderer) is set as `envMap` on design materials. Applied per material rather
 * than as scene.environment: the map / players keep their look (and pay nothing), while metals
 * reflect in both the world scene (remote players) and the viewmodel overlay scene.
 */
export function setDesignEnvRenderer(renderer: THREE.WebGLRenderer | null) {
  envRenderer = renderer;
  envMap = null;
  for (const e of entries.values()) applyEnv(e.template, e.lib);
}

function dispose(e: Entry) {
  entries.delete(e.key);
  e.lib.disposeDesignObject(e.template);
}

/** A model instance of `design` (shares GPU resources with every other instance of it). */
export function acquireDesignModel(lib: PartsLibrary, design: ForgeDesign): THREE.Group {
  const key = designKey(design);
  let e = entries.get(key);
  if (!e) {
    const template = lib.buildDesignMerged(design);
    template.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.userData[SHARED_FLAG] = true;
    });
    e = { key, template, refs: 0, lib };
    applyEnv(template, lib);
    entries.set(key, e);
  }
  const i = idle.indexOf(key);
  if (i >= 0) idle.splice(i, 1);
  e.refs++;
  // Object3D.clone shares geometry + material; userData is deep-copied (plain data only)
  const inst = e.template.clone(true);
  inst.userData[KEY] = key;
  return inst;
}

/** Release every cached design model instance found under `obj` (call before discarding it). */
export function releaseDesignModels(obj: THREE.Object3D | null | undefined) {
  if (!obj) return;
  const keys: string[] = [];
  obj.traverse((o) => {
    const k = o.userData?.[KEY] as string | undefined;
    if (k) {
      keys.push(k);
      delete o.userData[KEY];
    }
  });
  for (const k of keys) {
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

/** true for meshes whose geometry / material are owned by the design model cache */
export function isSharedDesignMesh(o: THREE.Object3D): boolean {
  return !!o.userData?.[SHARED_FLAG];
}

/** cache stats (tests / debugging) */
export function designModelCacheStats() {
  let refs = 0;
  for (const e of entries.values()) refs += e.refs;
  return { entries: entries.size, idle: idle.length, refs };
}
