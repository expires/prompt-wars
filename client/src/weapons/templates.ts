import type { Template } from '@ai-gaem/parts';
import { MAX_TEMPLATES_PER_REQUEST, type TemplateSummary } from '@ai-gaem/shared';
import { loadTemplates } from './templatesLibrary';

/** Compact summary of a parts template (what generate_weapon accepts in `templatesJson`). */
export function toTemplateSummary(t: Template): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    class: t.class,
    fireMode: t.fireMode,
    desc: t.desc,
    parts: t.parts.map((p) => ({ ...p })),
    ...(t.statHints ? { statHints: { ...t.statHints } } : {}),
    ...(t.melee ? { melee: { ...t.melee } } : {}),
  };
}

/**
 * Best matching templates for a weapon prompt, as JSON for generate_weapon (<= 5). The template
 * library is a lazily loaded chunk generated on first use (~150-400 ms), so this yields first.
 */
export async function templatesJsonFor(prompt: string, weaponClass = ''): Promise<string> {
  try {
    const { searchTemplates } = await loadTemplates();
    await new Promise((r) => setTimeout(r, 0));
    const list = searchTemplates(prompt, { limit: MAX_TEMPLATES_PER_REQUEST, ...(weaponClass ? { class: weaponClass } : {}) });
    return JSON.stringify(list.slice(0, MAX_TEMPLATES_PER_REQUEST).map(toTemplateSummary));
  } catch (err) {
    console.warn('[templates] search failed', err);
    return '[]';
  }
}
