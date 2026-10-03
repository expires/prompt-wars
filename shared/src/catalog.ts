// Helpers for LLM weapon generation: part-catalog filtering, prompt building, response parsing.
// The catalog itself lives in @ai-gaem/parts/catalog.json; this file only knows its shape.

import { CLASS_TEMPLATES, describeTemplateForPrompt, normalizeClass } from './balance';
import { WEAPON_CLASSES, type WeaponClass } from './weapon';

export interface CatalogEntry {
  id: string;
  category: string;
  classes: string[];
  tags: string[];
  desc: string;
}

const KEYWORDS: [RegExp, WeaponClass][] = [
  [/flam|fire|burn|napalm|torch|dragon/i, 'flamethrower'],
  [/bubble|soap|foam/i, 'bubble_gun'],
  [/dart|blow ?gun|poison|venom/i, 'blowgun'],
  [/cross ?bow|bolt|ballista/i, 'crossbow'],
  [/rocket|missile|bazooka|rpg/i, 'rocket_launcher'],
  [/grenade|mortar|lob|bomb/i, 'grenade_launcher'],
  [/sniper|scope|marksman|long ?range|railgun/i, 'sniper'],
  [/shotgun|scatter|blunderbuss|boomstick/i, 'shotgun'],
  [/\blmg\b|minigun|gatling|machine ?gun|chaingun/i, 'lmg'],
  [/\bsmg\b|uzi|sub ?machine|spray/i, 'smg'],
  [/rifle|\bar\b|carbine|assault/i, 'rifle'],
  [/pistol|revolver|handgun|deagle/i, 'pistol'],
  [/sword|knife|axe|hammer|bat|katana|melee|club|fish|baguette|spoon/i, 'melee'],
];

/** Pick a weapon class from a free-text prompt. `rand01` must be deterministic in the module (ctx.random). */
export function chooseClassFromPrompt(prompt: string, requested: string, rand01: () => number): WeaponClass {
  if (requested && requested.trim()) {
    const c = normalizeClass(requested);
    if (c !== 'weird' || requested.trim().toLowerCase() === 'weird') return c;
  }
  for (const [re, cls] of KEYWORDS) if (re.test(prompt)) return cls;
  // Unmatched prompt: random class, with 'weird' weighted up because it is the most fun.
  const pool: WeaponClass[] = [...WEAPON_CLASSES, 'weird', 'weird'];
  return pool[Math.floor(rand01() * pool.length) % pool.length];
}

/**
 * Pre-filter the part catalog for a class to keep prompt tokens low.
 * Entries that list the class (or 'any'/'*'/no classes) are kept; entries whose tags/desc
 * mention prompt words rank first. Returns at most `limit` entries.
 */
export function filterCatalogForClass(
  catalog: readonly CatalogEntry[],
  cls: WeaponClass,
  prompt: string,
  limit = 160,
): CatalogEntry[] {
  const words = prompt.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  const scored: { e: CatalogEntry; score: number; i: number }[] = [];
  catalog.forEach((e, i) => {
    const classes = (e.classes ?? []).map(c => c.toLowerCase());
    const universal = classes.length === 0 || classes.includes('any') || classes.includes('*') || classes.includes('all');
    const matchesClass = classes.includes(cls);
    if (!matchesClass && !universal && cls !== 'weird') return;
    const hay = `${e.id} ${e.category} ${(e.tags ?? []).join(' ')} ${e.desc ?? ''}`.toLowerCase();
    let score = matchesClass ? 2 : 0;
    for (const w of words) if (hay.includes(w)) score += 3;
    scored.push({ e, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  // Keep category diversity: take the best few from each category first.
  const byCat = new Map<string, CatalogEntry[]>();
  for (const { e } of scored) {
    const list = byCat.get(e.category) ?? [];
    list.push(e);
    byCat.set(e.category, list);
  }
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const list of byCat.values()) {
      const e = list[round];
      if (e && !seen.has(e.id)) {
        out.push(e);
        seen.add(e.id);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return out;
}

export function compactCatalogLines(entries: readonly CatalogEntry[]): string {
  return entries.map(e => `${e.id}|${e.category}|${(e.tags ?? []).slice(0, 4).join(',')}|${(e.desc ?? '').slice(0, 60)}`).join('\n');
}

export const WEAPON_GEN_SYSTEM = `You design weapons for a fast, silly multiplayer browser FPS.
Reply with ONE JSON object and nothing else (no markdown fences). Shape:
{
  "name": string (<= 32 chars, fun),
  "class": string, "fireMode": string,
  "damage": number, "pellets": integer, "fireRate": number (shots/s), "magSize": integer,
  "reloadTime": number (s), "range": number (m), "spread": number (deg),
  "projectileSpeed": number (m/s, 0 for hitscan/stream/melee), "splashRadius": number (m),
  "gravityScale": number, "fuseTime": number (s), "dotDamage": number (total), "dotDuration": number (s),
  "knockback": number, "slowPercent": number, "chargeTime": number (s),
  "colors": { "primary": "#rrggbb", "secondary": "#rrggbb", "accent": "#rrggbb" },
  "parts": [ { "partId": string from the catalog, "scale"?: number | [x,y,z], "color"?: "#rrggbb", "offset"?: [x,y,z] } ]
}
Rules: use ONLY partIds from the provided catalog. Use 4-14 parts. Offsets are metres, weapon points down -Z,
grip at the origin. Stay inside the given stat ranges; the server re-balances anything overpowered anyway
(sustained DPS budget ~55, max 95 damage per shot), so prefer interesting trade-offs over maxing stats.`;

export function buildWeaponGenUserPrompt(cls: WeaponClass, playerPrompt: string, catalogSubset: readonly CatalogEntry[]): string {
  return [
    `Player request: ${JSON.stringify(playerPrompt.slice(0, 300))}`,
    '',
    'Stat template:',
    describeTemplateForPrompt(cls),
    '',
    'Part catalog (id|category|tags|desc):',
    catalogSubset.length ? compactCatalogLines(catalogSubset) : '(catalog unavailable: return "parts": [])',
  ].join('\n');
}

/** Extract the first top-level JSON object from model text. Returns undefined if none parses. */
export function parseJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Drop parts whose ids are not in the catalog (when a catalog is available). */
export function filterKnownParts<T extends { partId: string }>(parts: T[], known: ReadonlySet<string>): T[] {
  if (known.size === 0) return parts;
  return parts.filter(p => known.has(p.partId));
}

/** Random stat roll inside a class template, used when no LLM key is configured. */
export function randomRawWeapon(cls: WeaponClass, prompt: string, rand01: () => number): Record<string, unknown> {
  const t = CLASS_TEMPLATES[cls];
  const out: Record<string, unknown> = { class: cls, fireMode: t.modes[Math.floor(rand01() * t.modes.length) % t.modes.length] };
  for (const [k, d] of Object.entries(t.defaults)) {
    out[k] = d === 0 ? 0 : d * (0.7 + rand01() * 0.6);
  }
  const hue = () => '#' + Math.floor(rand01() * 0xffffff).toString(16).padStart(6, '0');
  out.colors = { primary: hue(), secondary: hue(), accent: hue() };
  const title = prompt.trim().split(/\s+/).slice(0, 3).join(' ');
  out.name = title ? title.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 32) : undefined;
  return out;
}
