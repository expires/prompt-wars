import * as THREE from 'three';
import {
  assembleWeapon,
  getPart as getLibraryPart,
  RECIPES,
  type PartDef as LibraryPartDef,
  type Recipe,
  type RecipePart,
} from '@ai-gaem/parts';
import './parts'; // registers the built-in fallback kit
import { getPart, isLocalPart, registerRegistry, type PartDef, type PartRegistryLike } from './partRegistry';
import type { Weapon, WeaponPartRef } from './types';

// The 1000+ part library (@ai-gaem/parts) resolves through the registry too. Its parts use a
// different assembly convention (socket dirs, aliases), so library weapons are assembled with
// its own assembleWeapon(); the built-in kit keeps the legacy builder below.
registerRegistry({ getPart: getLibraryPart } as unknown as PartRegistryLike);

export interface WeaponModel {
  root: THREE.Group;
  /** empty object at the muzzle / blade tip (for flashes, tracers) */
  muzzle: THREE.Object3D;
  /** ids that were skipped because they were unknown or had no socket */
  skipped: string[];
}

interface FreeSocket {
  name: string;
  pos: THREE.Vector3;
  used: boolean;
  order: number;
}

const PALETTE_KEYS = ['primary', 'secondary', 'accent'] as const;

function defaultCoreFor(cls: string): string {
  switch (cls) {
    case 'melee':
      return 'handle_melee';
    case 'pistol':
    case 'blowgun':
    case 'bubble_gun':
      return 'receiver_pistol';
    case 'lmg':
    case 'rocket_launcher':
    case 'grenade_launcher':
    case 'flamethrower':
      return 'receiver_bulky';
    default:
      return 'receiver_rifle';
  }
}

function resolveColor(weapon: Weapon, ref: WeaponPartRef, def: PartDef): string | undefined {
  const c = ref.color;
  if (c) {
    if ((PALETTE_KEYS as readonly string[]).includes(c)) return weapon.colors[c as keyof Weapon['colors']];
    return c;
  }
  // category-based palette defaults; deco/blade keep their own look
  switch (def.category) {
    case 'core':
    case 'stock':
      return weapon.colors?.primary;
    case 'barrel':
    case 'grip':
    case 'mag':
    case 'muzzle':
    case 'scope':
    case 'tank':
      return weapon.colors?.secondary;
    default:
      return undefined;
  }
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A part recipe for weapons with no (known) parts: deterministic per weapon name + class. */
export function recipeFor(weapon: Pick<Weapon, 'name' | 'class'>): Recipe | undefined {
  const list = RECIPES.filter((r) => r.class === weapon.class);
  const pool = list.length ? list : RECIPES;
  if (!pool.length) return undefined;
  return pool[hashString(`${weapon.class}:${weapon.name}`) % pool.length];
}

function paletteColor(weapon: Weapon, c: string | undefined): string | undefined {
  if (!c) return undefined;
  if ((PALETTE_KEYS as readonly string[]).includes(c)) return weapon.colors?.[c as keyof Weapon['colors']];
  return c;
}

/** Library weapon: core part first, then everything else via @ai-gaem/parts assembleWeapon. */
function buildFromLibrary(weapon: Weapon, parts: (WeaponPartRef | RecipePart)[]): WeaponModel {
  const refs = parts.filter((p) => getLibraryPart(p.partId));
  const coreIdx = refs.findIndex((p) => (getLibraryPart(p.partId) as LibraryPartDef).category === 'core');
  if (coreIdx > 0) refs.unshift(...refs.splice(coreIdx, 1));
  const recipe: Recipe = {
    name: weapon.name,
    class: weapon.class,
    parts: refs.map((p) => ({
      partId: p.partId,
      color: paletteColor(weapon, p.color),
      accent: paletteColor(weapon, p.accent),
      scale: typeof p.scale === 'number' ? p.scale : undefined,
      socket: p.socket,
    })),
  };
  const assembled = assembleWeapon(recipe);
  const root = new THREE.Group();
  root.name = `weapon:${weapon.name}`;
  root.add(assembled);
  // per-axis scale / offset refs from LLM output are applied to the whole model only if uniform
  const bb = new THREE.Box3().setFromObject(root);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.min.z);
  root.add(muzzle);
  const ud = assembled.userData as { missing?: string[]; unplaced?: string[] };
  const skipped = [
    ...parts.filter((p) => !getLibraryPart(p.partId)).map((p) => p.partId),
    ...(ud.missing ?? []),
    ...(ud.unplaced ?? []),
  ];
  return { root, muzzle, skipped };
}

/**
 * Build the 3D model for a weapon:
 *  1. parts from the @ai-gaem/parts library -> its assembleWeapon()
 *  2. parts from the built-in fallback kit -> the legacy socket builder
 *  3. no known parts (presets, random weapons) -> a library recipe for the weapon's class
 */
export function buildWeaponModel(weapon: Weapon): WeaponModel {
  const parts = weapon.parts ?? [];
  if (parts.some((p) => !isLocalPart(p.partId) && getLibraryPart(p.partId))) return buildFromLibrary(weapon, parts);
  if (parts.some((p) => isLocalPart(p.partId))) return buildLegacyWeaponModel(weapon);
  const recipe = recipeFor(weapon);
  if (recipe) return buildFromLibrary(weapon, recipe.parts);
  return buildLegacyWeaponModel(weapon);
}

/**
 * Assemble a weapon model from its part list via the part registry.
 * Root = first 'core' part (or a class default) at origin; every other part
 * plugs into the first free matching socket on an already-placed part
 * (multi-pass so list order doesn't matter; falls back to reusing a taken socket).
 * Unknown partIds are skipped.
 */
export function buildLegacyWeaponModel(weapon: Weapon): WeaponModel {
  const root = new THREE.Group();
  root.name = `weapon:${weapon.name}`;
  const skipped: string[] = [];
  const sockets: FreeSocket[] = [];
  let order = 0;

  const refs: { ref: WeaponPartRef; def: PartDef }[] = [];
  for (const ref of weapon.parts ?? []) {
    const def = isLocalPart(ref.partId) ? getPart(ref.partId) : undefined;
    if (!def) {
      skipped.push(ref.partId);
      continue;
    }
    refs.push({ ref, def });
  }

  let coreIdx = refs.findIndex((r) => r.def.category === 'core');
  if (coreIdx < 0) {
    const def = getPart(defaultCoreFor(weapon.class))!;
    refs.unshift({ ref: { partId: def.id }, def });
    coreIdx = 0;
  }
  const [core] = refs.splice(coreIdx, 1);

  const place = (ref: WeaponPartRef, def: PartDef, at: THREE.Vector3) => {
    const uniform = typeof ref.scale === 'number' ? ref.scale : 1;
    const obj = def.build({ color: resolveColor(weapon, ref, def), accent: weapon.colors?.accent, scale: uniform });
    if (Array.isArray(ref.scale)) obj.scale.multiply(new THREE.Vector3(...ref.scale));
    obj.position.copy(at);
    if (ref.offset) obj.position.add(new THREE.Vector3(...ref.offset));
    obj.userData.partId = def.id;
    root.add(obj);
    obj.updateMatrix();
    for (const [name, s] of Object.entries(def.sockets)) {
      const p = new THREE.Vector3(...s.pos).applyMatrix4(obj.matrix);
      sockets.push({ name, pos: p, used: false, order: order++ });
    }
  };

  place(core.ref, core.def, new THREE.Vector3());

  let pending = refs;
  for (const allowReuse of [false, true]) {
    let progress = true;
    while (progress && pending.length) {
      progress = false;
      const next: typeof pending = [];
      for (const r of pending) {
        let s = sockets.find((k) => k.name === r.def.attach && !k.used);
        if (!s && allowReuse) s = sockets.find((k) => k.name === r.def.attach);
        if (s) {
          s.used = true;
          place(r.ref, r.def, s.pos);
          progress = true;
        } else next.push(r);
      }
      pending = next;
    }
  }
  for (const r of pending) skipped.push(r.ref.partId);

  // muzzle: the most recently exposed free muzzle socket, else any muzzle, else front of bbox
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  const muzzles = sockets.filter((s) => s.name === 'muzzle');
  const freeMuzzle = muzzles.filter((s) => !s.used).sort((a, b) => b.order - a.order)[0];
  const anyMuzzle = muzzles.sort((a, b) => a.pos.z - b.pos.z)[0];
  if (freeMuzzle || anyMuzzle) {
    muzzle.position.copy((freeMuzzle ?? anyMuzzle).pos);
  } else {
    const bb = new THREE.Box3().setFromObject(root);
    muzzle.position.set(0, (bb.min.y + bb.max.y) / 2, bb.min.z);
  }
  root.add(muzzle);

  if (skipped.length) console.warn(`[weapon] ${weapon.name}: skipped parts`, skipped);
  return { root, muzzle, skipped };
}
