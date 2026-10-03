#!/usr/bin/env node
// Headless netcode load test against a LOCAL SpacetimeDB (never Maincloud).
//
//   node scripts/loadtest/run.mjs --port 3100 --db pw-load --n 8,16,32,64 --rate 30,60 [--duration 20]
//
// For each (N, rate) it spreads N bot clients over worker processes (scripts/loadtest/bot.ts),
// all sending update_transform at `rate` Hz while subscribed like the browser client, and
// samples the SpacetimeDB server process' CPU time. One observer bot per worker records
// delivery (updates/s per remote player vs. the send rate), inter-arrival gaps and end-to-end
// latency. Prints a table plus a JSON line per run.
import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const PORT = Number(args.get('port') ?? 3100);
const DB = args.get('db') ?? 'pw-load';
const NS = (args.get('n') ?? '8,16,32').split(',').map(Number);
const RATES = (args.get('rate') ?? '30,60').split(',').map(Number);
const DURATION = Number(args.get('duration') ?? 20);
const WARMUP = Number(args.get('warmup') ?? 4);
const PER_WORKER = Number(args.get('perWorker') ?? 8);
const LIGHT = args.get('light') ?? '0';
const COMPRESSION = args.get('compression') ?? 'gzip';
const FORMAT = args.get('format') ?? 'packed';
if (PORT === 443 || String(args.get('uri') ?? '').includes('maincloud')) throw new Error('local only');

const tsxCandidates = [resolve(here, '../../../forge/node_modules/.bin/tsx'), resolve(here, '../../node_modules/.bin/tsx')];
const TSX = tsxCandidates.find(existsSync) ?? 'tsx';

function serverPid() {
  const out = execFileSync('lsof', ['-tiTCP:' + PORT, '-sTCP:LISTEN']).toString().trim().split('\n')[0];
  return Number(out);
}

/** cumulative CPU seconds of a pid (ps TIME = [[dd-]hh:]mm:ss.ss) */
function cpuSeconds(pid) {
  const t = execFileSync('ps', ['-o', 'time=', '-p', String(pid)]).toString().trim();
  const parts = t.split(':').map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

function rssMb(pid) {
  return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim()) / 1024;
}

function runWorker(i, count, rate, startAt) {
  return new Promise((res, rej) => {
    const p = spawn(TSX, [resolve(here, 'bot.ts'), '--uri', `ws://127.0.0.1:${PORT}`, '--db', DB, '--count', String(count), '--rate', String(rate),
      '--duration', String(DURATION), '--warmup', String(WARMUP), '--observers', '1', '--startAt', String(startAt), '--worker', String(i),
      '--light', LIGHT, '--compression', COMPRESSION, '--format', FORMAT], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', (code) => {
      const line = out.trim().split('\n').pop();
      if (code !== 0 || !line) return rej(new Error(`worker ${i} exited ${code}`));
      res(JSON.parse(line));
    });
  });
}

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');

async function runOne(n, rate) {
  const workers = Math.max(1, Math.ceil(n / PER_WORKER));
  const sizes = Array.from({ length: workers }, (_, i) => Math.floor(n / workers) + (i < n % workers ? 1 : 0));
  // connecting + spawning takes a while for large N
  const startAt = Date.now() + 4000 + n * 120;
  const pid = serverPid();
  const runs = sizes.map((c, i) => runWorker(i, c, rate, startAt));
  // sample server CPU over the measurement window
  await new Promise((r) => setTimeout(r, Math.max(0, startAt - Date.now()) + WARMUP * 1000));
  const c0 = cpuSeconds(pid);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, DURATION * 1000));
  const c1 = cpuSeconds(pid);
  const cpu = ((c1 - c0) / ((Date.now() - t0) / 1000)) * 100;
  const rss = rssMb(pid);
  const res = await Promise.all(runs);
  const sum = (k) => res.reduce((s, r) => s + r[k], 0);
  const alive = sum('alive');
  const sent = sum('sent');
  const acked = sum('acked');
  const obsUpdates = res.reduce((s, r) => s + r.obs.updates, 0);
  const obsN = res.reduce((s, r) => s + r.obs.n, 0);
  // what each observer should see: every other bot's sends
  const sendRate = sent / DURATION / Math.max(1, alive);
  const expectedPerObs = sendRate * (alive - 1) * DURATION;
  const delivery = obsUpdates / Math.max(1, obsN * expectedPerObs);
  const worst = (k) => Math.max(...res.map((r) => r.obs[k]).filter(Number.isFinite));
  const med = (k) => {
    const a = res.map((r) => r.obs[k]).filter(Number.isFinite).sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };
  const summary = {
    n,
    rate,
    alive,
    reducersPerSec: acked / DURATION,
    sendRatePerBot: sendRate,
    errors: sum('errors'),
    serverCpuPct: cpu,
    serverRssMb: rss,
    rtt: { p50: Math.max(...res.map((r) => r.rtt.p50)), p95: Math.max(...res.map((r) => r.rtt.p95)), p99: Math.max(...res.map((r) => r.rtt.p99)) },
    delivery,
    gapP50: med('gapP50'),
    gapP95: worst('gapP95'),
    gapP99: worst('gapP99'),
    latP50: med('latP50'),
    latP95: worst('latP95'),
    latP99: worst('latP99'),
    rowsPerSecPerClient: sum('received') / DURATION / Math.max(1, alive),
    kbPerSecPerClient: sum('wireBytes') / DURATION / Math.max(1, alive) / 1024,
    msgsPerSecPerClient: sum('wireMsgs') / DURATION / Math.max(1, alive),
    clientCpuMaxPct: Math.max(...res.map((r) => r.cpuPct)),
    clientLagP95: Math.max(...res.map((r) => r.lagP95)),
  };
  console.log(
    `N=${String(n).padStart(3)} ${String(rate).padStart(2)}Hz alive=${alive} red/s=${f(summary.reducersPerSec, 0)} srvCPU=${f(cpu, 0)}% ` +
      `rtt p50/p95/p99=${f(summary.rtt.p50)}/${f(summary.rtt.p95)}/${f(summary.rtt.p99)}ms deliv=${f(delivery * 100)}% ` +
      `gap p50/p95/p99=${f(summary.gapP50)}/${f(summary.gapP95)}/${f(summary.gapP99)} lat p50/p95/p99=${f(summary.latP50)}/${f(summary.latP95)}/${f(summary.latP99)}ms ` +
      `KB/s/cl=${f(summary.kbPerSecPerClient)} msg/s/cl=${f(summary.msgsPerSecPerClient, 0)} cliCPU=${f(summary.clientCpuMaxPct, 0)}% lag95=${f(summary.clientLagP95)}`,
  );
  console.log('JSON ' + JSON.stringify(summary));
  return summary;
}

for (const rate of RATES) {
  for (const n of NS) {
    try {
      await runOne(n, rate);
    } catch (e) {
      console.log(`N=${n} ${rate}Hz FAILED: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000)); // let disconnects settle
  }
}
