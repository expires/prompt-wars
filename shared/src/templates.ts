// Weapon templates (from @ai-gaem/parts) as used by generate_weapon. The 20k-template library is
// too big to bundle into the SpacetimeDB module, so the client searches it (searchTemplates) and
// sends the best few matches as compact summaries; the server uses them as LLM few-shot examples
// or, without an API key, turns the best one into a weapon (class preset + statHints -> clampWeapon).
// Part ids are always re-validated against the module's synced catalog.

import { CLASS_TEMPLATES, normalizeClass, sanitizeParts } from './balance';
import { isMeleeSwing, isMeleeWeight, type MeleeMeta } from './melee';
import type { WeaponClass, WeaponPart } from './weapon';

export type Level = 'low' | 'med' | 'high';
export type Speed = 'slow' | 'med' | 'fast';

export interface TemplateStatHints {
  damage?: Level;
  fireRate?: Speed;
  range?: 'short' | 'med' | 'long';
  spread?: Level;
  magSize?: 'small' | 'med' | 'large';
  projectileSpeed?: Speed;
  splash?: boolean;
}

/** What the client sends per template (subset of the parts Template). */
export interface TemplateSummary {
  id: string;
  name: string;
  class: WeaponClass;
  fireMode?: string;
  desc?: string;
  parts: WeaponPart[];
  statHints?: TemplateStatHints;
  melee?: MeleeMeta;
}

export const MAX_TEMPLATES_PER_REQUEST = 5;
export const MAX_TEMPLATES_JSON = 16_000;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, max) : '');
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

/** Parse + sanitize the client's template list (never trusted: ids are re-checked later). */
export function parseTemplateSummaries(json: string): TemplateSummary[] {
  if (!json || json.length > MAX_TEMPLATES_JSON) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: TemplateSummary[] = [];
  for (const r of raw.slice(0, MAX_TEMPLATES_PER_REQUEST)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const parts = sanitizeParts(o.parts);
    if (!parts.length) continue;
    const h = (o.statHints && typeof o.statHints === 'object' ? o.statHints : {}) as Record<string, unknown>;
    const statHints: TemplateStatHints = {
      damage: pick(h.damage, ['low', 'med', 'high'] as const),
      fireRate: pick(h.fireRate, ['slow', 'med', 'fast'] as const),
      range: pick(h.range, ['short', 'med', 'long'] as const),
      spread: pick(h.spread, ['low', 'med', 'high'] as const),
      magSize: pick(h.magSize, ['small', 'med', 'large'] as const),
      projectileSpeed: pick(h.projectileSpeed, ['slow', 'med', 'fast'] as const),
      splash: typeof h.splash === 'boolean' ? h.splash : undefined,
    };
    const m = (o.melee && typeof o.melee === 'object' ? o.melee : undefined) as Record<string, unknown> | undefined;
    const melee =
      m && isMeleeSwing(m.swing) && isMeleeWeight(m.weight) && typeof m.reach === 'number' && Number.isFinite(m.reach)
        ? { swing: m.swing, weight: m.weight, reach: m.reach }
        : undefined;
    out.push({
      id: str(o.id, 60),
      name: str(o.name, 40) || 'Template',
      class: normalizeClass(o.class),
      fireMode: str(o.fireMode, 12) || undefined,
      desc: str(o.desc, 120) || undefined,
      parts,
      statHints,
      ...(melee ? { melee } : {}),
    });
  }
  return out;
}

const LEVEL: Record<string, number> = { low: 0.75, med: 1, high: 1.3, slow: 0.7, fast: 1.35, short: 0.75, long: 1.3, small: 0.6, large: 1.6 };

/**
 * Raw weapon from a template: class preset stats scaled by the template's hints (damage, fire
 * rate, range, spread, magazine, projectile speed), the template's parts / fire mode / melee meta.
 * Always pass the result through clampWeapon.
 */
export function templateToRawWeapon(t: TemplateSummary, name?: string): Record<string, unknown> {
  const cls = t.class;
  const ct = CLASS_TEMPLATES[cls];
  const d = ct.defaults;
  const h = t.statHints ?? {};
  const k = (v: string | undefined) => (v ? (LEVEL[v] ?? 1) : 1);
  const raw: Record<string, unknown> = {
    ...d,
    name: name || t.name,
    class: cls,
    fireMode: t.fireMode && (ct.modes as string[]).includes(t.fireMode) ? t.fireMode : ct.modes[0],
    damage: d.damage * k(h.damage),
    fireRate: d.fireRate * k(h.fireRate),
    range: d.range * k(h.range),
    spread: d.spread * k(h.spread),
    magSize: Math.round(d.magSize * k(h.magSize)),
    projectileSpeed: d.projectileSpeed * k(h.projectileSpeed),
    parts: t.parts,
  };
  if (h.splash === false) raw.splashRadius = 0;
  if (t.melee) raw.melee = t.melee;
  return raw;
}

/** Few-shot block for the LLM prompt. */
export function templatesPromptBlock(list: readonly TemplateSummary[]): string {
  if (!list.length) return '';
  const lines = list.map(t =>
    JSON.stringify({
      name: t.name,
      class: t.class,
      fireMode: t.fireMode,
      desc: t.desc,
      parts: t.parts,
      ...(t.melee ? { melee: t.melee } : {}),
      statHints: t.statHints,
    }),
  );
  return [
    'Reference designs that match the request (adapt the closest one: keep its part ids and, for melee, its "melee" object; you may rename, recolour and add a few parts):',
    ...lines,
  ].join('\n');
}
