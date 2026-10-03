// In-memory LRU of finished designs keyed by normalized prompt (+ requested class). A repeat of a
// plain prompt (no previous design / locks / rejects, one variant) is replayed instantly instead of
// calling the model. The durable cache players see ("First forged by X") is the SpacetimeDB
// `forged_prompt` table; this one just saves model calls across players and reloads.

import { normalizePrompt } from '@ai-gaem/shared';
import type { ForgeDesign } from '@ai-gaem/shared/forge';

export interface CachedDesign<T = ForgeDesign> {
  design: T;
  warnings: string[];
  at: number;
}

export function promptCacheKey(prompt: string, cls?: string): string {
  const norm = normalizePrompt(prompt);
  return norm ? `${cls ?? ''}|${norm}` : '';
}

export class DesignCache<T = ForgeDesign> {
  private map = new Map<string, CachedDesign<T>>();
  hits = 0;
  misses = 0;
  constructor(private max = 500, private ttlMs = 24 * 3600_000, private now: () => number = Date.now) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): CachedDesign<T> | undefined {
    if (!key || this.max <= 0) return undefined;
    const v = this.map.get(key);
    if (!v || this.now() - v.at > this.ttlMs) {
      if (v) this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, v);
    this.hits++;
    return v;
  }

  set(key: string, design: T, warnings: string[] = []): void {
    if (!key || this.max <= 0) return;
    this.map.delete(key);
    this.map.set(key, { design: structuredClone(design), warnings: [...warnings], at: this.now() });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}
