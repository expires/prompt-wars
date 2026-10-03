// Sliding-window rate limiter (in memory; one forge process).
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number, private now: () => number = Date.now) {}

  /** Remaining budget for `key`. */
  remaining(key: string): number {
    return this.limit - this.recent(key).length;
  }

  /** Try to spend `cost` for every key; all-or-nothing. Returns seconds until retry when refused. */
  take(keys: string[], cost = 1): { ok: true } | { ok: false; retryAfter: number } {
    const t = this.now();
    for (const k of keys) {
      const list = this.recent(k);
      if (list.length + cost > this.limit) {
        const oldest = list[Math.max(0, list.length + cost - this.limit - 1)] ?? t;
        return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + this.windowMs - t) / 1000)) };
      }
    }
    for (const k of keys) {
      const list = this.recent(k);
      for (let i = 0; i < cost; i++) list.push(t);
      this.hits.set(k, list);
    }
    if (this.hits.size > 50_000) this.sweep();
    return { ok: true };
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter(x => x > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  private sweep(): void {
    for (const k of [...this.hits.keys()]) this.recent(k);
  }
}
