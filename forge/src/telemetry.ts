// Client crash / error telemetry: POST /api/forge/telemetry appends sanitized JSON lines to a
// size-capped log (default /var/log/ai-gaem/client-errors.jsonl, rotated to .1 when full).
// No IP addresses are stored; the client sends only name, identity prefix, UA, GPU string, version.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TelemetryConfig {
  /** JSONL path ('' = disabled) */
  path: string;
  /** rotate when the file grows past this many bytes */
  maxBytes: number;
  /** max request body */
  maxBody: number;
}

export function telemetryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  return {
    path: env.FORGE_TELEMETRY_LOG ?? '/var/log/ai-gaem/client-errors.jsonl',
    maxBytes: Number(env.FORGE_TELEMETRY_MAX_BYTES ?? 20 * 1024 * 1024),
    maxBody: 64 * 1024,
  };
}

const MAX_STR = 2000;
const MAX_KEYS = 40;
const MAX_DEPTH = 4;

/** Deep-copy JSON-ish data with bounded size: strings truncated, key / array counts capped. */
function clean(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, MAX_STR);
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(v)) return v.slice(0, MAX_KEYS).map(x => clean(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (n++ >= MAX_KEYS) break;
      const c = clean(x, depth + 1);
      if (c !== undefined) out[k.slice(0, 64)] = c;
    }
    return out;
  }
  return undefined;
}

/** Accepts a single report or `{ reports: [...] }` (batched, at most 20). Returns the cleaned lines. */
export function parseTelemetry(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body must be a JSON object');
  const b = body as Record<string, unknown>;
  const list = Array.isArray(b.reports) ? b.reports.slice(0, 20) : [b];
  const out: Record<string, unknown>[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const c = clean(r) as Record<string, unknown>;
    if (typeof c.kind !== 'string' || !c.kind) continue;
    c.kind = (c.kind as string).slice(0, 48);
    // the client only sends a prefix; enforce it
    if (typeof c.id === 'string') c.id = c.id.replace(/[^0-9a-fA-F]/g, '').slice(0, 12);
    out.push(c);
  }
  return out;
}

export class TelemetryLog {
  private size = -1;
  constructor(private readonly cfg: TelemetryConfig) {}

  get enabled() {
    return !!this.cfg.path;
  }

  append(reports: Record<string, unknown>[]): number {
    if (!this.cfg.path || !reports.length) return 0;
    const ts = new Date().toISOString();
    const text = reports.map(r => JSON.stringify({ ts, ...r })).join('\n') + '\n';
    if (this.size < 0) {
      try {
        this.size = statSync(this.cfg.path).size;
      } catch {
        mkdirSync(dirname(this.cfg.path), { recursive: true });
        this.size = 0;
      }
    }
    if (this.size + text.length > this.cfg.maxBytes) {
      try {
        renameSync(this.cfg.path, `${this.cfg.path}.1`);
      } catch {
        /* nothing to rotate */
      }
      this.size = 0;
    }
    appendFileSync(this.cfg.path, text);
    this.size += Buffer.byteLength(text);
    return reports.length;
  }
}
