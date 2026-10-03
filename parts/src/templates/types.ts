import type { RecipePart, WeaponClass } from '../types';

export type FireMode = 'hitscan' | 'projectile' | 'arc' | 'stream' | 'melee';
export type Swing = 'slash' | 'overhead' | 'thrust' | 'bash' | 'spin';
export type MeleeWeight = 'light' | 'medium' | 'heavy';
export type Level = 'low' | 'med' | 'high';
export type Speed = 'slow' | 'med' | 'fast';

export interface StatHints {
  damage?: Level;
  fireRate?: Speed;
  range?: 'short' | 'med' | 'long';
  spread?: Level;
  magSize?: 'small' | 'med' | 'large';
  projectileSpeed?: Speed;
  splash?: boolean;
}

/** Melee animation metadata. reach = meters from the hand to the striking tip. */
export interface MeleeMeta {
  swing: Swing;
  reach: number;
  weight: MeleeWeight;
}

export interface Template {
  /** stable-ish id: `<class>-<hash>` (curated: `curated-<slug>`) */
  id: string;
  name: string;
  class: WeaponClass;
  fireMode: FireMode;
  tags: string[];
  theme: string;
  /** <= 15 words */
  desc: string;
  keywords: string[];
  /** core first; assembles with assembleWeapon({ name, class, parts }) */
  parts: RecipePart[];
  statHints?: StatHints;
  /** present on every melee template */
  melee?: MeleeMeta;
  /** hand-made recipe from recipes.ts */
  curated?: boolean;
}

export interface SearchOpts {
  class?: string;
  theme?: string;
  limit?: number;
  /** only melee / only ranged */
  melee?: boolean;
}
