import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { configFromEnv, createForgeServer, parseGenerateRequest } from '../src/server';
import { DesignCache, promptCacheKey } from '../src/cache';
import { NdjsonParser } from '../src/assembler';
import { sanitizeDesign, type ForgeEvent } from '@ai-gaem/shared/forge';
import { EXAMPLE_REVOLVER } from '@ai-gaem/shared/forge/examples';

let base = '';
let server: ReturnType<typeof createForgeServer>;

beforeAll(async () => {
  server = createForgeServer({ ...configFromEnv({}), apiKey: '', mockDelayMs: 0, rateLimit: 3 });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

async function generate(body: unknown) {
  const res = await fetch(`${base}/api/forge/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.headers.get('content-type')?.includes('ndjson')) return { status: res.status, events: [] as ForgeEvent[] };
  const events: ForgeEvent[] = [];
  const p = new NdjsonParser(o => events.push(o as unknown as ForgeEvent));
  p.push(await res.text());
  p.end();
  return { status: res.status, events };
}
const doneOf = (events: ForgeEvent[]) => (events.find(e => e.type === 'done') as Extract<ForgeEvent, { type: 'done' }>).design;
const startOf = (events: ForgeEvent[]) => events.find(e => e.type === 'start') as Extract<ForgeEvent, { type: 'start' }>;

describe('forge prompt cache', () => {
  it('replays the same normalized prompt instantly, without spending rate budget', async () => {
    const first = await generate({ prompt: 'A baguette that fires angry bees', playerIdentity: 'c0' });
    expect(first.status).toBe(200);
    expect(startOf(first.events).cached).toBeFalsy();
    const d1 = doneOf(first.events);
    for (let i = 0; i < 5; i++) {
      const again = await generate({ prompt: '  a BAGUETTE, that fires angry bees!! ', playerIdentity: 'c0' });
      expect(again.status).toBe(200);
      expect(startOf(again.events).cached).toBe(true);
      expect(doneOf(again.events)).toEqual(d1);
      // same event shape as a live stream
      expect(again.events.map(e => e.type).filter(t => t !== 'component' && t !== 'projectile')).toEqual(['start', 'meta', 'stats', 'done', 'end']);
    }
    expect(server.cache.hits).toBeGreaterThanOrEqual(5);
  });

  it('bypasses the cache for reforges with marks, variants or seeds', async () => {
    server.limiter['hits'].clear();
    const prev = sanitizeDesign(EXAMPLE_REVOLVER).design;
    const locked = [{ ...prev.components[0], locked: true }];
    const withLock = await generate({ prompt: 'a baguette that fires angry bees', locked });
    expect(startOf(withLock.events).cached).toBeFalsy();
    const withReject = await generate({ prompt: 'a baguette that fires angry bees', rejected: ['crust'] });
    expect(startOf(withReject.events).cached).toBeFalsy();
    server.limiter['hits'].clear();
    const variants = await generate({ prompt: 'a baguette that fires angry bees', variants: 2 });
    expect(startOf(variants.events).cached).toBeFalsy();
  });

  it('keys by normalized prompt and requested class', () => {
    const k = (b: unknown) => promptCacheKey(parseGenerateRequest(b).prompt, parseGenerateRequest(b).cls);
    expect(k({ prompt: 'Laser Spoon!' })).toBe(k({ prompt: 'laser   spoon' }));
    expect(k({ prompt: 'laser spoon', class: 'melee' })).not.toBe(k({ prompt: 'laser spoon' }));
    expect(promptCacheKey('?!')).toBe('');
  });

  it('LRU evicts the oldest and expires by ttl', () => {
    let t = 0;
    const c = new DesignCache(2, 1000, () => t);
    const d = sanitizeDesign(EXAMPLE_REVOLVER).design;
    c.set('a', d);
    c.set('b', d);
    expect(c.get('a')).toBeTruthy(); // a is now newest
    c.set('c', d);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBeTruthy();
    t = 5000;
    expect(c.get('a')).toBeUndefined();
  });

  it('censors profanity in prompts before generation', () => {
    expect(parseGenerateRequest({ prompt: 'a fucking huge gun' }).prompt).toBe('a ******* huge gun');
    expect(parseGenerateRequest({ prompt: 'a cocktail shaker' }).prompt).toBe('a cocktail shaker');
  });
});
