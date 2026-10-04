// Forge record / replay server for the video capture.
//
//   record: POST /api/forge/{outfit,generate} is forwarded to a real forge (the live VPS by default),
//           streamed straight through to the browser, and every NDJSON line is saved with its
//           arrival time (ms since the request was sent) to fixtures/<kind>.ndjson + .timing.json.
//   replay: the same endpoints answer from those fixtures, one line at a time at the recorded
//           offsets, so every take builds identically (no API cost, no network).
//
// The browser reaches this server through Playwright's route.continue (any origin, the live site
// included) and, for the local Vite dev server, through FORGE_PROXY as well.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ForgeKind = 'outfit' | 'weapon';
export type ProxyMode = 'record' | 'replay';

export interface FixtureTiming {
  kind: ForgeKind;
  prompt: string;
  recordedAt: string;
  /** where it came from: the forge URL (no secrets), 'mock' when a mock forge produced it */
  source: string;
  /** ms since the request was sent, one per NDJSON line */
  offsetsMs: number[];
}

export interface ForgeProxyOptions {
  mode: ProxyMode;
  port: number;
  fixturesDir: string;
  /** record mode: the forge to record from (origin only, e.g. http://187.7.27.171) */
  upstream?: string;
  /** record mode: only these kinds are recorded, the others replay from fixtures (default: all) */
  recordKinds?: ForgeKind[];
  /** replay speed (2 = twice as fast); 1 = the recorded timing */
  speed?: number;
  log?: (msg: string) => void;
}

export interface ForgeProxy {
  url: string;
  /** kinds recorded / replayed so far */
  served: { kind: ForgeKind; prompt: string; lines: number; ms: number }[];
  close(): Promise<void>;
}

const KIND_BY_PATH: Record<string, ForgeKind> = { '/api/forge/outfit': 'outfit', '/api/forge/generate': 'weapon' };

export function fixturePaths(dir: string, kind: ForgeKind) {
  return { ndjson: join(dir, `${kind}.ndjson`), timing: join(dir, `${kind}.timing.json`) };
}

export function loadFixture(dir: string, kind: ForgeKind): { lines: string[]; timing: FixtureTiming } {
  const p = fixturePaths(dir, kind);
  if (!existsSync(p.ndjson) || !existsSync(p.timing)) throw new Error(`missing fixture ${p.ndjson} (+ .timing.json): run \`pnpm video:record\` first`);
  const lines = readFileSync(p.ndjson, 'utf8').split('\n').filter((l) => l.trim());
  const timing = JSON.parse(readFileSync(p.timing, 'utf8')) as FixtureTiming;
  if (timing.offsetsMs.length !== lines.length) throw new Error(`fixture ${kind}: ${lines.length} lines but ${timing.offsetsMs.length} offsets`);
  return { lines, timing };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ndjsonHead(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' });
  res.flushHeaders();
}

export function startForgeProxy(opts: ForgeProxyOptions): Promise<ForgeProxy> {
  const log = opts.log ?? ((m: string) => console.log(`[forge-${opts.mode}] ${m}`));
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const served: ForgeProxy['served'] = [];
  mkdirSync(opts.fixturesDir, { recursive: true });

  async function record(kind: ForgeKind, body: Record<string, unknown>, res: ServerResponse) {
    const upstream = (opts.upstream ?? 'http://187.7.27.171').replace(/\/$/, '');
    // a seed makes the forge skip its prompt cache (a cache hit dumps the whole design at once,
    // with no build-up); the real LLM path ignores the seed itself
    const fwd: Record<string, unknown> = { ...body, seed: Math.floor(Math.random() * 1e9) };
    delete fwd.playerIdentity;
    const path = kind === 'outfit' ? '/api/forge/outfit' : '/api/forge/generate';
    const t0 = performance.now();
    const up = await fetch(`${upstream}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fwd) });
    if (!up.ok || !up.body) {
      const text = await up.text().catch(() => '');
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' });
      res.end(text);
      throw new Error(`upstream ${path} -> HTTP ${up.status}: ${text.slice(0, 200)}`);
    }
    ndjsonHead(res);
    const lines: string[] = [];
    const offsets: number[] = [];
    const dec = new TextDecoder();
    let buf = '';
    const reader = up.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const now = performance.now() - t0;
      res.write(value);
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        lines.push(line);
        offsets.push(Math.round(now));
      }
    }
    if (buf.trim()) {
      lines.push(buf.trim());
      offsets.push(Math.round(performance.now() - t0));
    }
    res.end();
    const start = lines.length ? (JSON.parse(lines[0]!) as { mock?: boolean }) : {};
    const timing: FixtureTiming = {
      kind,
      prompt: String(body.prompt ?? ''),
      recordedAt: new Date().toISOString(),
      source: start.mock ? `mock (${upstream})` : upstream,
      offsetsMs: offsets,
    };
    const p = fixturePaths(opts.fixturesDir, kind);
    writeFileSync(p.ndjson, lines.join('\n') + '\n');
    writeFileSync(p.timing, JSON.stringify(timing, null, 2) + '\n');
    served.push({ kind, prompt: timing.prompt, lines: lines.length, ms: offsets.at(-1) ?? 0 });
    log(`recorded ${kind}: ${lines.length} lines over ${((offsets.at(-1) ?? 0) / 1000).toFixed(1)}s -> ${p.ndjson}${start.mock ? ' (MOCK forge)' : ''}`);
  }

  async function replay(kind: ForgeKind, body: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) {
    const { lines, timing } = loadFixture(opts.fixturesDir, kind);
    if (body.prompt && body.prompt !== timing.prompt) log(`note: prompt "${String(body.prompt)}" differs from the fixture's "${timing.prompt}" (replaying the fixture)`);
    let aborted = false;
    res.on('close', () => (aborted = !res.writableFinished));
    req.on('aborted', () => (aborted = true));
    ndjsonHead(res);
    const t0 = performance.now();
    for (let i = 0; i < lines.length && !aborted; i++) {
      const wait = timing.offsetsMs[i]! / speed - (performance.now() - t0);
      if (wait > 0) await sleep(wait);
      res.write(lines[i] + '\n');
    }
    res.end();
    served.push({ kind, prompt: timing.prompt, lines: lines.length, ms: Math.round(performance.now() - t0) });
    log(`replayed ${kind}: ${lines.length} lines over ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      try {
        if (path === '/api/forge/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, mock: false, model: opts.mode, cached: 0 }));
        }
        if (path === '/api/forge/telemetry') {
          await readBody(req);
          res.writeHead(204);
          return res.end();
        }
        const kind = KIND_BY_PATH[path];
        if (!kind || req.method !== 'POST') {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'not found' }));
        }
        const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        if (opts.mode === 'record' && (!opts.recordKinds || opts.recordKinds.includes(kind))) await record(kind, body, res);
        else await replay(kind, body, req, res);
      } catch (e) {
        log(`error on ${path}: ${(e as Error).message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        } else res.end();
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${opts.port}`,
        served,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
