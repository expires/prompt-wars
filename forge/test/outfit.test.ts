import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { configFromEnv, createForgeServer } from '../src/server';
import { NdjsonParser } from '../src/assembler';
import { OUTFIT_SYSTEM_PROMPT, OutfitAssembler, bodyFromPrompt, outfitToNdjson } from '../src/outfit';
import { BODY_LIMITS, OUTFIT_LIMITS, bodyStats, outfitTris, sanitizeOutfit, type OutfitEvent } from '@ai-gaem/shared';
import { OUTFIT_KNIGHT } from '@ai-gaem/shared/outfit/examples';

let base = '';
let server: ReturnType<typeof createForgeServer>;

beforeAll(async () => {
  server = createForgeServer({ ...configFromEnv({}), apiKey: '', mockDelayMs: 0, rateLimit: 6 });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

async function outfit(body: unknown, path = '/api/forge/outfit'): Promise<{ status: number; events: OutfitEvent[]; json?: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.headers.get('content-type')?.includes('ndjson')) return { status: res.status, events: [], json: await res.json() };
  const events: OutfitEvent[] = [];
  const p = new NdjsonParser(o => events.push(o as unknown as OutfitEvent));
  p.push(await res.text());
  p.end();
  return { status: res.status, events };
}

const doneOf = (events: OutfitEvent[]) => events.find(e => e.type === 'done') as Extract<OutfitEvent, { type: 'done' }>;

describe('closet service (mock)', () => {
  it('streams start -> meta -> pieces -> done -> end with a legal outfit', async () => {
    const { status, events } = await outfit({ prompt: 'medieval knight', seed: 1 });
    expect(status).toBe(200);
    const types = events.map(e => e.type);
    expect(types[0]).toBe('start');
    expect(types[1]).toBe('meta');
    expect(types.slice(2, -2).every(t => t === 'piece')).toBe(true);
    expect(types.at(-2)).toBe('done');
    expect(types.at(-1)).toBe('end');
    const done = doneOf(events);
    expect(sanitizeOutfit(done.outfit).outfit).toEqual(done.outfit);
    expect(done.outfit.pieces.length).toBeGreaterThan(4);
    expect(outfitTris(done.outfit.pieces)).toBeLessThanOrEqual(OUTFIT_LIMITS.maxTris);
    const streamed = events.filter(e => e.type === 'piece').map(e => (e as Extract<OutfitEvent, { type: 'piece' }>).piece.id);
    expect(done.outfit.pieces.map(p => p.id).sort()).toEqual([...streamed].sort());
  });

  it('size words drive the body (and so HP)', async () => {
    const small = doneOf((await outfit({ prompt: 'tiny goblin scout', seed: 2 })).events).outfit;
    const big = doneOf((await outfit({ prompt: 'giant heavy robot', seed: 2 })).events).outfit;
    expect(small.body.size).toBeLessThan(1);
    expect(big.body.size).toBeGreaterThan(1);
    expect(bodyStats(small.body).maxHp).toBeLessThan(bodyStats(big.body).maxHp);
    expect(bodyFromPrompt('a giant', { size: 1, build: 1, head: 1, limbs: 1 }).size).toBe(BODY_LIMITS.size[1]);
  });

  it('keeps locked pieces verbatim and skips rejected ones', async () => {
    const helm = { ...OUTFIT_KNIGHT.pieces.find(p => p.id === 'helm')!, locked: true };
    const { events } = await outfit({ prompt: 'astronaut', seed: 3, locked: [helm], rejected: ['pls', 'gold visor'] });
    const done = doneOf(events);
    expect(done.outfit.pieces.find(p => p.id === 'helm')).toEqual(helm);
    expect(done.outfit.pieces.some(p => p.label === 'gold visor' || p.id === 'pls')).toBe(false);
  });

  it('plain prompts replay from the cache without spending rate limit', async () => {
    const a = await outfit({ prompt: 'Riot cop!' });
    const before = server.limiter;
    const b = await outfit({ prompt: 'riot cop' });
    expect(b.events[0]).toMatchObject({ type: 'start', cached: true });
    expect(doneOf(b.events).outfit).toEqual(doneOf(a.events).outfit);
    expect(server.limiter).toBe(before);
  });

  it('shares the weapon forge rate limiter', async () => {
    // 6 per window: the tests above used some; weapons + outfits drain the same bucket
    let last = 200;
    for (let i = 0; i < 8 && last === 200; i++) {
      const r = i % 2 ? await outfit({ prompt: `ninja ${i}`, seed: i }) : await outfit({ prompt: `pistol ${i}`, seed: i }, '/api/forge/generate');
      last = r.status;
    }
    expect(last).toBe(429);
  });

  it('rejects bad requests', async () => {
    expect((await outfit('nope')).status).toBe(400);
    expect((await outfit({})).status).toBe(400);
  });
});

describe('outfit assembler', () => {
  it('sanitizes / fits raw model lines, censors names, emits pieces as they arrive', () => {
    const events: OutfitEvent[] = [];
    const asm = new OutfitAssembler({ variant: 0, locked: [], rejected: [] }, e => events.push(e));
    asm.push({ t: 'meta', name: 'Test', body: { size: 5 }, palette: { primary: '#ff0000' } });
    asm.push({ t: 'piece', id: 'h', label: 'hat', socket: 'helmet', shapes: [{ type: 'bevelbox', size: [0.3, 0.2, 0.3], material: { color: 'primary' } }] });
    asm.push({ t: 'piece', id: 'x', label: 'bad', socket: 'tail-fin', shapes: [{ type: 'box', size: [0.1, 0.1, 0.1] }] });
    const o = asm.finish();
    expect(o.body.size).toBe(BODY_LIMITS.size[1]);
    expect(o.pieces.map(p => p.socket)).toEqual(['head']);
    expect(o.pieces[0].shapes[0].type).toBe('extrude'); // macro expanded
    expect(events.map(e => e.type)).toEqual(['meta', 'piece', 'done']);
  });

  it('system prompt lists every socket + few-shot examples round-trip', () => {
    for (const s of ['head', 'face', 'torso', 'back', 'belt', 'shoulderL', 'armL', 'handL', 'thighL', 'shinL', 'footL']) expect(OUTFIT_SYSTEM_PROMPT).toContain(`* ${s}`);
    const events: OutfitEvent[] = [];
    const asm = new OutfitAssembler({ variant: 0, locked: [], rejected: [] }, e => events.push(e));
    const p = new NdjsonParser(o => asm.push(o));
    p.push(outfitToNdjson(OUTFIT_KNIGHT));
    p.end();
    const o = asm.finish();
    // same build (the palette may be lifted for readability)
    expect({ ...o, palette: null }).toEqual({ ...OUTFIT_KNIGHT, palette: null });
  });
});
