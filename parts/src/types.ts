import type * as THREE from 'three';

export type Vec3 = [number, number, number];

export type Socket = { pos: [number, number, number]; dir?: [number, number, number] };

export interface BuildOpts {
  color?: string;
  accent?: string;
  scale?: number;
}

export interface PartDef {
  /** kebab-case, unique, descriptive e.g. 'barrel-long-fluted-3' */
  id: string;
  category: string;
  /** weapon classes it suits */
  classes: string[];
  /** style tags: 'military','scifi','toy','steampunk','medieval','organic','silly','heavy','sleek', ... */
  tags: string[];
  /** short human/LLM description (<= 12 words) */
  desc: string;
  /** socket name on parent this plugs into ('' for core) */
  attach: string;
  /** sockets this part exposes for children */
  sockets: Record<string, Socket>;
  build(opts: BuildOpts): THREE.Object3D;
}

export const WEAPON_CLASSES = [
  'pistol',
  'smg',
  'rifle',
  'shotgun',
  'sniper',
  'lmg',
  'rocket_launcher',
  'grenade_launcher',
  'flamethrower',
  'bubble_gun',
  'blowgun',
  'crossbow',
  'melee',
  'weird',
] as const;
export type WeaponClass = (typeof WEAPON_CLASSES)[number];

export const CATEGORIES = [
  'core',
  'barrel',
  'muzzle',
  'stock',
  'grip',
  'magazine',
  'sight',
  'underbarrel',
  'tank',
  'launcher',
  'crossbow',
  'blade',
  'head',
  'guard',
  'pommel',
  'deco',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SOCKET_NAMES = [
  'barrel',
  'muzzle',
  'stock',
  'grip',
  'mag',
  'top',
  'under',
  'side',
  'tank',
  'nozzle',
  'blade',
  'handle',
  'guard',
  'pommel',
  'head',
  'deco',
] as const;

export interface RecipePart {
  partId: string;
  color?: string;
  accent?: string;
  scale?: number;
  /** optional explicit socket name override (defaults to the part's `attach`) */
  socket?: string;
}

export interface Recipe {
  name: string;
  class: string;
  parts: RecipePart[];
}

export interface CatalogEntry {
  id: string;
  category: string;
  classes: string[];
  tags: string[];
  desc: string;
  attach: string;
}
