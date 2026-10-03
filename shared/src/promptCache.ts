// Prompt cache key: the same idea typed slightly differently ("A Baguette, that fires BEES!!" vs
// "a baguette that fires bees") maps to one key. Used by the forge service cache and the
// SpacetimeDB `forged_prompt` table ("First forged by X").

/** Max length of a normalized prompt (table key). */
export const MAX_NORM_PROMPT = 200;

/** lowercase, trim, punctuation -> space, collapse whitespace (letters / digits of any script kept). */
export function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NORM_PROMPT)
    .trim();
}
