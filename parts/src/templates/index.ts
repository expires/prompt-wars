/**
 * Weapon TEMPLATES public API.
 *
 *   searchTemplates('a frying pan that shoots baguettes', { limit: 8 })  -> Template[]
 *   templatesForClass('shotgun', { theme: 'pirate', limit: 20 })        -> Template[]
 *   randomTemplate('melee', seed?)                                       -> Template
 *   getTemplate(id) / allTemplates() / templateToRecipe(t)
 *
 * Templates are generated deterministically on first use (~150 ms) and cached.
 */
import type { Recipe } from '../types';
import { generateTemplates, mulberry32, hashStr } from './generate';
import { scoreTemplates } from './search';
import type { SearchOpts, Template } from './types';

let ALL: Template[] | null = null;
let BY_ID: Map<string, Template> | null = null;

export function allTemplates(): Template[] {
  if (!ALL) {
    ALL = generateTemplates();
    BY_ID = new Map(ALL.map((t) => [t.id, t]));
  }
  return ALL;
}

export function getTemplate(id: string): Template | undefined {
  allTemplates();
  return BY_ID!.get(id);
}

/** Best matches for a free-text prompt. Falls back to class templates when nothing matches. */
export function searchTemplates(query: string, opts: SearchOpts = {}): Template[] {
  const limit = opts.limit ?? 8;
  const res = scoreTemplates(allTemplates(), query, { ...opts, limit }).map((s) => s.t);
  if (res.length >= limit || !opts.class) return res;
  const seen = new Set(res.map((t) => t.id));
  for (const t of templatesForClass(opts.class, { theme: opts.theme, limit: limit * 3 })) {
    if (res.length >= limit) break;
    if (!seen.has(t.id)) res.push(t);
  }
  return res;
}

/** Templates of one class (curated first), optionally filtered by theme. */
export function templatesForClass(cls: string, opts: { theme?: string; limit?: number } = {}): Template[] {
  const out: Template[] = [];
  for (const t of allTemplates()) {
    if (t.class !== cls || (opts.theme && t.theme !== opts.theme)) continue;
    out.push(t);
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

/** Deterministic for a given seed (number or string); random when seed is omitted. */
export function randomTemplate(cls?: string, seed?: number | string): Template {
  const pool = cls ? templatesForClass(cls) : allTemplates();
  const list = pool.length ? pool : allTemplates();
  const r = seed === undefined ? Math.random() : mulberry32(typeof seed === 'number' ? seed : hashStr(seed))();
  return list[Math.floor(r * list.length) % list.length];
}

/** Recipe for assembleWeapon(). */
export function templateToRecipe(t: Template): Recipe {
  return { name: t.name, class: t.class, parts: t.parts, ...(t.curated ? { curated: true } : {}) };
}

/** Counts by class / theme / melee / everyday. */
export function templateStats() {
  const byClass: Record<string, number> = {};
  const byTheme: Record<string, number> = {};
  let melee = 0;
  let everyday = 0;
  let curated = 0;
  for (const t of allTemplates()) {
    byClass[t.class] = (byClass[t.class] ?? 0) + 1;
    byTheme[t.theme] = (byTheme[t.theme] ?? 0) + 1;
    if (t.melee) melee++;
    if (t.tags.includes('everyday')) everyday++;
    if (t.curated) curated++;
  }
  return { total: allTemplates().length, byClass, byTheme, melee, everyday, curated };
}

export { generateTemplates, curatedTemplates, TEMPLATE_VERSION, CLASS_TARGET } from './generate';
export { THEMES, THEME_BY_ID } from './themes';
export { tokenize, scoreTemplates } from './search';
export { encodeTemplates, decodeTemplates } from './codec';
export type { Template, SearchOpts, MeleeMeta, StatHints, FireMode, Swing, MeleeWeight } from './types';
export type { Theme, Palette } from './themes';
