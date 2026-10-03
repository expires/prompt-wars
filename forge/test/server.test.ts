import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { configFromEnv, createForgeServer } from '../src/server';
import { NdjsonParser } from '../src/assembler';
import { sanitizeDesign, type ForgeDesign, type ForgeEvent } from '@ai-gaem/shared/forge';
import { EXAMPLE_REVOLVER } from '@ai-gaem/shared/forge/examples';
import { RateLimiter } from '../src/ratelimit';

let base = '';
let server: ReturnType<typeof createForgeServer>;

beforeAll(async () => {
  server = createForgeServer({ ...configFromEnv({}), apiKey: '', mockDelayMs: 0, rateLimit: 8, allowedOrigins: ['http://localhost:5173'] });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

async function generate(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; events: ForgeEvent[]; json?: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/forge/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.headers.get('content-type')?.includes('ndjson')) return { status: res.status, events: [], json: await res.json() };
  const events: ForgeEvent[] = [];
  const p = new NdjsonParser(o => events.push(o as unknown as ForgeEvent));
  p.push(await res.text());
  p.end();
  return { status: res.status, events };
}

describe('forge service (mock)', () => {
  it('health reports mock mode', async () => {
    const r = await (await fetch(`${base}/api/forge/health`)).json();
    expect(r).toEqual({ ok: true, mock: true, model: 'mock' });
  });

  it('streams start -> meta -> components -> stats -> done -> end, with a legal final design', async () => {
    const { status, events } = await generate({ prompt: 'a frying pan that shoots baguettes', seed: 1, playerIdentity: 'aa01' });
    expect(status).toBe(200);
    const types = events.map(e => e.type);
    expect(types[0]).toBe('start');
    expect(types[1]).toBe('meta');
    expect(types.at(-1)).toBe('end');
    expect(types.at(-2)).toBe('done');
    const firstStats = types.indexOf('stats');
    expect(types.slice(2, firstStats).every(t => t === 'component')).toBe(true);
    expect(firstStats).toBeGreaterThan(2);
    const done = events.find(e => e.type === 'done') as Extract<ForgeEvent, { type: 'done' }>;
    expect(sanitizeDesign(done.design).design).toEqual(done.design);
    // streamed components are the final ones (ids stable for the editor)
    const streamed = events.filter(e => e.type === 'component').map(e => (e as Extract<ForgeEvent, { type: 'component' }>).component.id);
    expect(done.design.components.map(c => c.id).sort()).toEqual([...streamed].sort());
    expect(done.design.components.some(c => c.shapes)).toBe(true);
    expect(done.design.components.some(c => c.catalogPart)).toBe(true);
  });

  it('runs variants in parallel, tagged by index', async () => {
    const { events } = await generate({ prompt: 'bubble gun', variants: 3, seed: 2 });
    const dones = events.filter(e => e.type === 'done');
    expect(dones.map(e => e.variant).sort()).toEqual([0, 1, 2]);
    expect(events.filter(e => e.type === 'meta').length).toBe(3);
  });

  it('preserves locked components verbatim and excludes rejected ones', async () => {
    const prev = sanitizeDesign(EXAMPLE_REVOLVER).design;
    const locked = prev.components.filter(c => c.id === 'barrel' || c.id === 'frame').map(c => ({ ...c, locked: true }));
    const first = await generate({ prompt: 'crocodile rocket launcher', seed: 3 });
    const done0 = first.events.find(e => e.type === 'done') as Extract<ForgeEvent, { type: 'done' }>;
    const rejectLabel = done0.design.components.find(c => c.catalogPart)!.label;
    const { events } = await generate({ prompt: 'crocodile rocket launcher', seed: 3, locked, rejected: [rejectLabel] });
    const done = events.find(e => e.type === 'done') as Extract<ForgeEvent, { type: 'done' }>;
    for (const l of locked) expect(done.design.components.find(c => c.id === l.id)).toEqual(l);
    expect(done.design.components.some(c => c.label === rejectLabel)).toBe(false);
    // locked come right after meta
    const comps = events.filter(e => e.type === 'component').slice(0, 2).map(e => (e as Extract<ForgeEvent, { type: 'component' }>).component.id);
    expect(comps.sort()).toEqual(['barrel', 'frame']);
  });

  it('locked components inside `previous` are kept too', async () => {
    const prev: ForgeDesign = sanitizeDesign(EXAMPLE_REVOLVER).design;
    prev.components[0].locked = true;
    const { events } = await generate({ prompt: 'make it a shotgun', previous: prev, seed: 4 });
    const done = events.find(e => e.type === 'done') as Extract<ForgeEvent, { type: 'done' }>;
    expect(done.design.components.find(c => c.id === 'frame')).toEqual(prev.components[0]);
  });

  it('validates requests', async () => {
    expect((await generate({})).status).toBe(400);
    expect((await generate([1, 2])).status).toBe(400);
    const big = await generate({ prompt: 'x', junk: 'y'.repeat(200_000) });
    expect(big.status).toBe(413);
    const res = await fetch(`${base}/api/forge/generate`, { method: 'GET' });
    expect(res.status).toBe(405);
    const bad = await fetch(`${base}/api/forge/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    expect(bad.status).toBe(400);
  });

  it('rejects cross-origin browsers, allows same-origin and configured dev origins', async () => {
    expect((await generate({ prompt: 'pistol' }, { origin: 'https://evil.example' })).status).toBe(403);
    const host = new URL(base).host;
    const same = await fetch(`${base}/api/forge/health`, { headers: { origin: `http://${host}` } });
    expect(same.status).toBe(200);
    const pre = await fetch(`${base}/api/forge/generate`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('rate limits per identity (variants count as generations)', async () => {
    server.limiter['hits'].clear();
    const id = 'beef';
    const results: number[] = [];
    for (let i = 0; i < 3; i++) results.push((await generate({ prompt: 'smg', variants: 3, playerIdentity: id, seed: i })).status);
    expect(results).toEqual([200, 200, 429]);
    const r = await generate({ prompt: 'smg', playerIdentity: id });
    expect(r.status).toBe(200); // 7th generation: still within 8
    expect((await generate({ prompt: 'smg', playerIdentity: id })).status).toBe(200); // 8th
    const r2 = await generate({ prompt: 'smg', playerIdentity: id });
    expect(r2.status).toBe(429);
    expect(String(r2.json?.error)).toContain('rate limit');
  });
});

describe('RateLimiter', () => {
  it('slides the window', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect(rl.take(['a']).ok).toBe(true);
    expect(rl.take(['a']).ok).toBe(true);
    const no = rl.take(['a']);
    expect(no.ok).toBe(false);
    t = 1001;
    expect(rl.take(['a']).ok).toBe(true);
  });
});

describe('NdjsonParser', () => {
  it('handles chunk boundaries, fences and prose', () => {
    const out: unknown[] = [];
    const bad: string[] = [];
    const p = new NdjsonParser(o => out.push(o), l => bad.push(l));
    for (const ch of ['```json\n{"t":"me', 'ta","a":1}\nSure! here\n{"t":"stats"', ',"b":2}']) p.push(ch);
    p.end();
    expect(out).toEqual([{ t: 'meta', a: 1 }, { t: 'stats', b: 2 }]);
    expect(bad).toEqual(['Sure! here']);
  });
});
