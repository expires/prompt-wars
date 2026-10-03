/**
 * Lazy loader for the weapon template generator / search (@ai-gaem/parts/templates, its own
 * chunk). Needed only for weapon generation (death screen) and the offline melee samples.
 */
export type TemplatesLibrary = typeof import('@ai-gaem/parts/templates');

let loading: Promise<TemplatesLibrary> | null = null;

export function loadTemplates(): Promise<TemplatesLibrary> {
  loading ??= import('@ai-gaem/parts/templates').catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * Load the module and build the template table (~150-400 ms of CPU) so the first search is
 * instant. Call when a search is likely soon (death screen opened).
 */
export async function warmTemplates(): Promise<void> {
  const t = await loadTemplates();
  await new Promise((r) => setTimeout(r, 0));
  t.allTemplates();
}
