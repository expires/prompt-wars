import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configFromEnv, createForgeServer } from '../src/server';
import { TelemetryLog, parseTelemetry } from '../src/telemetry';

const dir = mkdtempSync(join(tmpdir(), 'forge-telemetry-'));
const logPath = join(dir, 'client-errors.jsonl');
let base = '';
let server: ReturnType<typeof createForgeServer>;

beforeAll(async () => {
  const cfg = configFromEnv({ FORGE_TELEMETRY_LOG: logPath });
  server = createForgeServer({ ...cfg, apiKey: '' });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe('telemetry endpoint', () => {
  it('appends sanitized reports (text/plain beacons too)', async () => {
    const res = await fetch(`${base}/api/forge/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ reports: [{ kind: 'error', msg: 'x'.repeat(5000), id: 'abcdef0123456789zz', name: 'Ash' }, { nokind: 1 }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, written: 1 });
    const lines = readFileSync(logPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('error');
    expect(lines[0].msg.length).toBe(2000);
    expect(lines[0].id).toBe('abcdef012345');
    expect(typeof lines[0].ts).toBe('string');
  });

  it('rejects junk', async () => {
    const res = await fetch(`${base}/api/forge/telemetry`, { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect((await fetch(`${base}/api/forge/telemetry`)).status).toBe(405);
  });

  it('rotates when the cap is hit', () => {
    const p = join(dir, 'rot.jsonl');
    const log = new TelemetryLog({ path: p, maxBytes: 300, maxBody: 1000 });
    for (let i = 0; i < 10; i++) log.append(parseTelemetry({ kind: 'mem', i, pad: 'y'.repeat(60) }));
    expect(existsSync(`${p}.1`)).toBe(true);
    expect(readFileSync(p, 'utf8').length).toBeLessThanOrEqual(300);
  });
});
