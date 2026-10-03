// HTTP server (plain node:http): POST /api/forge/generate streams NDJSON forge events.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { censorText, normalizeClass, type WeaponClass } from '@ai-gaem/shared';
import { sanitizeComponent, sanitizeDesign, sanitizeProjectile, FORGE_LIMITS, type Component, type ForgeDesign, type ForgeEvent, type ProjectileDesign } from '@ai-gaem/shared/forge';
import { DesignAssembler } from './assembler';
import { classFromPrompt } from '@ai-gaem/shared/forge/refine';
import { catalogContext, type PromptContext } from './prompt';
import { generateMock } from './mock';
import { generateWithLlm } from './llm';
import { RateLimiter } from './ratelimit';
import { DesignCache, promptCacheKey } from './cache';
import { TelemetryLog, parseTelemetry, telemetryConfigFromEnv, type TelemetryConfig } from './telemetry';
import { catalog } from '@ai-gaem/parts';

export interface ForgeConfig {
  apiKey: string;
  model: string;
  /** generations (variants) per window per IP and per identity */
  rateLimit: number;
  rateWindowMs: number;
  timeoutMs: number;
  maxBodyBytes: number;
  /** extra allowed browser origins (dev), besides same-origin */
  allowedOrigins: string[];
  mockDelayMs: number;
  /** trust X-Forwarded-For from loopback (Caddy) */
  trustProxy: boolean;
  /** prompt cache entries (0 = off) */
  cacheMax: number;
  /** client crash telemetry log */
  telemetry: TelemetryConfig;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ForgeConfig {
  return {
    apiKey: (env.ANTHROPIC_API_KEY ?? '').trim(),
    model: (env.FORGE_MODEL ?? '').trim() || 'claude-haiku-4-5-20251001',
    rateLimit: Number(env.FORGE_RATE_LIMIT ?? 40),
    rateWindowMs: Number(env.FORGE_RATE_WINDOW_MS ?? 10 * 60_000),
    timeoutMs: Number(env.FORGE_TIMEOUT_MS ?? 45_000),
    maxBodyBytes: Number(env.FORGE_MAX_BODY ?? 240_000),
    allowedOrigins: (env.FORGE_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    mockDelayMs: Number(env.FORGE_MOCK_DELAY_MS ?? 90),
    trustProxy: env.FORGE_TRUST_PROXY !== '0',
    cacheMax: Number(env.FORGE_CACHE_MAX ?? 500),
    telemetry: telemetryConfigFromEnv(env),
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > max) return reject(new HttpError(413, 'request too large'));
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new HttpError(413, 'request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const remote = req.socket.remoteAddress ?? '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const xff = req.headers['x-forwarded-for'];
  if (trustProxy && loopback && typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return remote;
}

/** Same-origin only (plus configured dev origins). Requests without Origin (curl, server-side) pass. */
function checkOrigin(req: IncomingMessage, cfg: ForgeConfig): string | null {
  const origin = req.headers.origin;
  if (!origin) return null;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  try {
    if (new URL(origin).host === host) return origin;
  } catch {
    /* fallthrough */
  }
  if (cfg.allowedOrigins.includes(origin)) return origin;
  throw new HttpError(403, 'cross-origin requests are not allowed');
}

export interface ParsedRequest {
  prompt: string;
  cls?: WeaponClass;
  locked: Component[];
  lockedProjectile?: ProjectileDesign;
  rejected: string[];
  previous?: ForgeDesign;
  variants: number;
  identity: string;
  seed?: number;
}

export function parseGenerateRequest(body: unknown): ParsedRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'body must be a JSON object');
  const b = body as Record<string, unknown>;
  // profanity is censored before the model ever sees it (and so in names derived from it)
  const prompt = typeof b.prompt === 'string' ? censorText(b.prompt.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 400)) : '';
  if (!prompt && !b.previous) throw new HttpError(400, 'prompt is required');
  const clsRaw = typeof b.class === 'string' ? b.class.trim() : '';
  const cls = clsRaw ? normalizeClass(clsRaw) : undefined;
  const locked: Component[] = [];
  if (Array.isArray(b.locked)) {
    const seen = new Set<string>();
    for (const c of b.locked.slice(0, FORGE_LIMITS.maxComponents)) {
      const s = sanitizeComponent(c);
      if (s && s.id && !seen.has(s.id)) {
        seen.add(s.id);
        s.locked = true;
        locked.push(s);
      }
    }
  }
  // locked parents must be locked too or present: drop dangling parent links
  for (const c of locked) if (c.parent && !locked.some(p => p.id === c.parent)) delete c.parent, delete c.attach;
  const rejected = Array.isArray(b.rejected)
    ? b.rejected.filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, 48)).filter(Boolean).slice(0, 32)
    : [];
  const previous = b.previous ? sanitizeDesign(b.previous).design : undefined;
  if (previous) for (const c of previous.components) if (c.locked && !locked.some(l => l.id === c.id)) locked.push(c);
  let lockedProjectile = b.lockedProjectile ? sanitizeProjectile(b.lockedProjectile) : undefined;
  if (!lockedProjectile && previous?.projectile?.locked) lockedProjectile = previous.projectile;
  if (lockedProjectile) lockedProjectile.locked = true;
  const variants = Math.max(1, Math.min(3, Math.floor(Number(b.variants ?? 1)) || 1));
  const identity = typeof b.playerIdentity === 'string' ? b.playerIdentity.replace(/[^0-9a-fA-F]/g, '').slice(0, 64).toLowerCase() : '';
  const seed = typeof b.seed === 'number' && Number.isFinite(b.seed) ? Math.floor(b.seed) : undefined;
  return { prompt: prompt || previous!.name, cls, locked, lockedProjectile, rejected, previous, variants, identity, seed };
}

/** A plain prompt (nothing to keep / avoid, one variant, not a seeded mock run) can use the cache. */
export function cacheKeyFor(r: ParsedRequest): string {
  if (r.previous || r.locked.length || r.lockedProjectile || r.rejected.length || r.variants !== 1 || r.seed !== undefined) return '';
  return promptCacheKey(r.prompt, r.cls);
}

export function createForgeServer(cfg: ForgeConfig = configFromEnv()): Server & { limiter: RateLimiter; cache: DesignCache } {
  const limiter = new RateLimiter(cfg.rateLimit, cfg.rateWindowMs);
  const cache = new DesignCache(cfg.cacheMax);
  const telemetry = new TelemetryLog(cfg.telemetry ?? telemetryConfigFromEnv({}));
  // telemetry: 60 requests / 10 min per IP (the client batches and dedupes; this caps abuse)
  const telemetryLimiter = new RateLimiter(60, 10 * 60_000);
  const mock = !cfg.apiKey;

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/\/+$/, '');
    let origin: string | null = null;
    try {
      origin = checkOrigin(req, cfg);
      if (origin) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-methods': 'POST, GET, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
        });
        return res.end();
      }
      if (path === '/api/forge/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, mock, model: mock ? 'mock' : cfg.model, cached: cache.size }));
      }
      if (path === '/api/forge/telemetry') {
        if (req.method !== 'POST') throw new HttpError(405, 'use POST', { allow: 'POST' });
        // sendBeacon posts text/plain; accept both
        const text = await readBody(req, cfg.telemetry?.maxBody ?? 64 * 1024);
        const rl = telemetryLimiter.take([`ip:${clientIp(req, cfg.trustProxy)}`]);
        if (!rl.ok) throw new HttpError(429, 'telemetry rate limit', { 'retry-after': String(rl.retryAfter) });
        let reports: Record<string, unknown>[];
        try {
          reports = parseTelemetry(JSON.parse(text));
        } catch {
          throw new HttpError(400, 'invalid telemetry');
        }
        let written = 0;
        try {
          written = telemetry.append(reports);
        } catch (e) {
          console.error('[forge] telemetry write failed', (e as Error).message);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, written }));
      }
      if (path !== '/api/forge/generate') throw new HttpError(404, 'not found');
      if (req.method !== 'POST') throw new HttpError(405, 'use POST', { allow: 'POST' });
      const ctype = String(req.headers['content-type'] ?? '');
      if (!ctype.includes('application/json')) throw new HttpError(415, 'content-type must be application/json');
      const text = await readBody(req, cfg.maxBodyBytes);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, 'invalid JSON');
      }
      const r = parseGenerateRequest(body);
      const key = cacheKeyFor(r);
      const hit = key ? cache.get(key) : undefined;
      if (hit) return replayCached(res, hit.design, hit.warnings, r.prompt);
      const ip = clientIp(req, cfg.trustProxy);
      const keys = [`ip:${ip}`, ...(r.identity ? [`id:${r.identity}`] : [])];
      const rl = limiter.take(keys, r.variants);
      if (!rl.ok) throw new HttpError(429, `rate limit: ${cfg.rateLimit} generations per ${Math.round(cfg.rateWindowMs / 60000)} min`, { 'retry-after': String(rl.retryAfter) });
      await streamGeneration(req, res, cfg, r, mock, (design, warnings) => {
        if (key) cache.set(key, design, warnings);
      });
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, 'internal error');
      if (!(e instanceof HttpError)) console.error('[forge]', e);
      if (!res.headersSent) {
        res.writeHead(err.status, { 'content-type': 'application/json', ...err.headers });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
  };

  const server = createServer((req, res) => void handler(req, res)) as Server & { limiter: RateLimiter; cache: DesignCache };
  server.limiter = limiter;
  server.cache = cache;
  server.requestTimeout = cfg.timeoutMs + 15_000;
  return server;
}

function ndjsonHead(res: ServerResponse) {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
}

/** Cache hit: the whole event sequence of the stored design at once (no rate-limit cost). */
function replayCached(res: ServerResponse, design: ForgeDesign, warnings: string[], prompt: string) {
  ndjsonHead(res);
  const lines: ForgeEvent[] = [
    { type: 'start', variant: -1, variants: 1, model: 'cache', mock: false, cached: true },
    { type: 'meta', variant: 0, name: design.name, class: design.class, fireMode: design.fireMode, palette: design.palette, fx: design.fx },
    ...design.components.map((component): ForgeEvent => ({ type: 'component', variant: 0, component })),
    ...(design.projectile ? [{ type: 'projectile', variant: 0, projectile: design.projectile } as ForgeEvent] : []),
    { type: 'stats', variant: 0, stats: design.stats },
    { type: 'done', variant: 0, design, warnings },
    { type: 'end', variant: -1 },
  ];
  res.end(lines.map(ev => JSON.stringify(ev)).join('\n') + '\n');
  console.log(`[forge] cache hit "${prompt.slice(0, 60)}"`);
}

async function streamGeneration(req: IncomingMessage, res: ServerResponse, cfg: ForgeConfig, r: ParsedRequest, mock: boolean, onDone?: (design: ForgeDesign, warnings: string[]) => void) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('timeout')), cfg.timeoutMs);
  res.on('close', () => {
    if (!res.writableFinished) ac.abort(new Error('client closed'));
  });
  ndjsonHead(res);
  res.flushHeaders();
  const emit = (ev: ForgeEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(ev)}\n`);
  };
  const t0 = Date.now();
  emit({ type: 'start', variant: -1, variants: r.variants, model: mock ? 'mock' : cfg.model, mock });

  // the prompt's archetype ("revolver" -> pistol) beats catalog template guesses
  const classHint = r.cls ?? r.previous?.class ?? classFromPrompt(r.prompt);
  const cat = catalogContext(r.prompt, classHint);
  const knownPartIds = getKnownIds();
  const hint: WeaponClass | undefined = classHint ?? cat.templates[0]?.class;

  await Promise.all(
    Array.from({ length: r.variants }, async (_, variant) => {
      const ctx: PromptContext = {
        prompt: r.prompt,
        classHint: hint,
        requestedClass: !!r.cls,
        templates: cat.templates,
        // catalog parts are not offered to the model any more: from-scratch shapes are seated and
        // proportioned by the readability pass, catalog parts can't be (and clash in style)
        catalogLines: [],
        locked: r.locked,
        lockedProjectile: r.lockedProjectile,
        rejected: r.rejected,
        previous: r.previous,
        variant,
        variants: r.variants,
      };
      const asm = new DesignAssembler({ variant, locked: r.locked, lockedProjectile: r.lockedProjectile, rejected: r.rejected, previous: r.previous, classHint: hint, knownPartIds, prompt: r.prompt }, emit);
      try {
        if (mock) await generateMock({ signal: ac.signal, delayMs: cfg.mockDelayMs, seed: r.seed }, ctx, asm);
        else await generateWithLlm({ apiKey: cfg.apiKey, model: cfg.model, signal: ac.signal }, ctx, asm);
        if (asm.componentCount === 0) throw new Error('the forge produced no components');
        const design = asm.finish();
        if (!ac.signal.aborted && asm.warnings.length === 0) onDone?.(design, []);
        if (asm.notes.length) console.log(`[forge] refine v${variant}: ${asm.notes.slice(0, 12).join(' | ')}`);
      } catch (e) {
        const msg = ac.signal.aborted ? `generation aborted (${String((ac.signal.reason as Error)?.message ?? 'timeout')})` : errorMessage(e);
        if (asm.componentCount > 0 && !ac.signal.aborted) {
          asm.warnings.push(msg);
          asm.finish();
        } else {
          emit({ type: 'error', variant, message: msg });
        }
      }
    }),
  );
  clearTimeout(timer);
  emit({ type: 'end', variant: -1 });
  res.end();
  console.log(`[forge] ${mock ? 'mock' : cfg.model} v=${r.variants} ${Date.now() - t0}ms "${r.prompt.slice(0, 60)}"`);
}

function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  // never leak keys / internals
  return m.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***').slice(0, 200);
}

let KNOWN: Set<string> | null = null;
function getKnownIds(): Set<string> {
  return (KNOWN ??= new Set(catalog().map(e => e.id)));
}
