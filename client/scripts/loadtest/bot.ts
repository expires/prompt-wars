// Load-test worker: runs `--count` headless bot clients in one Node process. Each bot connects
// with a fresh identity, subscribes exactly like the browser client, equips a preset, respawns
// and then sends update_transform at `--rate` Hz (always moving: the worst case) for
// `--duration` seconds. Observers (`--observers`, the first k bots of this worker) additionally
// record per-remote-player delivery: inter-arrival gaps, end-to-end latency (arrival - sendT;
// all bots share the machine clock) and update counts. Prints one JSON line with the results.
//
// Usage (normally via run.ts): tsx scripts/loadtest/bot.ts --uri ws://127.0.0.1:3100 --db pw-load \
//   --count 8 --rate 60 --duration 20 --observers 1 --warmup 5
import { DbConnection, tables } from '../../src/module_bindings';
import { encodePose, decodePose, type PoseFields } from './codec';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const URI = args.get('uri') ?? 'ws://127.0.0.1:3100';
const DB = args.get('db') ?? 'pw-load';
const COUNT = Number(args.get('count') ?? 4);
const RATE = Number(args.get('rate') ?? 60);
const DURATION = Number(args.get('duration') ?? 20) * 1000;
const WARMUP = Number(args.get('warmup') ?? 5) * 1000;
const OBSERVERS = Number(args.get('observers') ?? 1);
const START_AT = Number(args.get('startAt') ?? Date.now() + 3000);
const LIGHT = args.get('light') === '1';
const COMPRESSION = (args.get('compression') ?? 'gzip') as 'gzip' | 'none';
const WORKER = args.get('worker') ?? '0';
/** 'packed' = current module (`pose` table); 'f32' = legacy module (`player_pose`) */
const FORMAT = args.get('format') ?? 'packed';

// count on-wire bytes / messages (all bots in this process)
let wireBytes = 0;
let wireMsgs = 0;
const BaseWS = globalThis.WebSocket;
class CountingWS extends BaseWS {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    this.addEventListener('message', (e: MessageEvent) => {
      if (!measuring) return;
      wireMsgs++;
      const d = e.data as ArrayBuffer | string;
      wireBytes += typeof d === 'string' ? d.length : d.byteLength;
    });
  }
}
(globalThis as { WebSocket: typeof WebSocket }).WebSocket = CountingWS as typeof WebSocket;

const now = () => performance.timeOrigin + performance.now();
let measuring = false;

interface Obs {
  /** slot -> last arrival (ms) */
  lastArrival: Map<number, number>;
  gaps: number[];
  lat: number[];
  updates: number;
}

interface Bot {
  i: number;
  conn?: DbConnection;
  slot: number;
  alive: boolean;
  obs?: Obs;
  rtt: number[];
  sent: number;
  acked: number;
  errors: number;
  received: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const poseTable = (conn: DbConnection): any => (FORMAT === 'f32' ? conn.db.playerPose : conn.db.pose);

const bots: Bot[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(b: Bot): Promise<void> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`bot ${b.i} connect timeout`)), 30000);
    let builder = DbConnection.builder().withUri(URI).withDatabaseName(DB).withConfirmedReads(false).withCompression(COMPRESSION);
    if (LIGHT) builder = builder.withLightMode(true);
    b.conn = builder
      .onConnect((conn, identity) => {
        const me = identity.toHexString();
        poseTable(conn).onUpdate((_c, _o, row) => onPose(b, row as unknown as PoseFields));
        poseTable(conn).onInsert((_c, row) => onPose(b, row as unknown as PoseFields));
        conn.db.player.onUpdate((_c, _o, row) => {
          if (row.identity.toHexString() === me) {
            b.slot = row.slot;
            b.alive = row.alive;
          }
        });
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            clearTimeout(to);
            const p = [...conn.db.player.iter()].find((r) => r.identity.toHexString() === me);
            if (p) {
              b.slot = p.slot;
              b.alive = p.alive;
            }
            resolve();
          })
          .onError(() => reject(new Error('subscription error')))
          .subscribe([
            tables.player,
            FORMAT === 'f32' ? tables.playerPose : tables.pose,
            tables.spawnPoint,
            tables.shotEvent,
            tables.hitEvent,
            tables.weapon.where((w) => w.isPreset.eq(true)),
            tables.weapon.where((w) => w.ownerIdentity.eq(identity)),
          ]);
      })
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

function onPose(b: Bot, raw: PoseFields) {
  if (!measuring) return;
  b.received++;
  const o = b.obs;
  if (!o) return;
  const p = decodePose(raw);
  if (p.slot === b.slot) return;
  const t = now();
  o.updates++;
  const prev = o.lastArrival.get(p.slot);
  if (prev !== undefined) o.gaps.push(t - prev);
  o.lastArrival.set(p.slot, t);
  // sendT = sender's Date-based clock (u32 ms)
  const lat = (((Math.floor(t) >>> 0) - p.sendT) | 0);
  if (lat > -5 && lat < 10000) o.lat.push(lat);
}

async function spawnBot(b: Bot) {
  const conn = b.conn!;
  const preset = [...conn.db.weapon.iter()].find((w) => w.isPreset);
  if (!preset) throw new Error('no preset weapons');
  for (let k = 0; k < 20 && !b.alive; k++) {
    try {
      await conn.reducers.equipWeapon({ weaponId: preset.id });
    } catch {
      /* alive already, or racing */
    }
    try {
      await conn.reducers.respawn({ keepLoadout: true });
    } catch {
      /* respawn delay */
    }
    await sleep(300);
  }
}

function sendLoop(b: Bot, endAt: number) {
  const interval = 1000 / RATE;
  // random phase so bots don't all fire on the same millisecond
  let next = now() + Math.random() * interval;
  const cx = (Math.random() - 0.5) * 20;
  const cz = (Math.random() - 0.5) * 20;
  const r = 3 + Math.random() * 3;
  const w = 6 / r; // ~6 m/s
  const t0Loop = now();
  const tick = () => {
    const t = now();
    if (t >= endAt) return;
    if (t >= next) {
      next += interval;
      if (next < t) next = t + interval;
      const a = (((t - t0Loop) / 1000) * w) % (Math.PI * 2);
      const pose = {
        x: cx + Math.cos(a) * r,
        y: 0.1,
        z: cz + Math.sin(a) * r,
        yaw: a,
        pitch: 0.1,
        vx: -Math.sin(a) * r * w,
        vy: 0,
        vz: Math.cos(a) * r * w,
        flags: 2,
        sendT: Math.floor(t) >>> 0,
      };
      const t0 = now();
      const m = measuring;
      if (m) b.sent++;
      b.conn!.reducers.updateTransform(encodePose(pose) as never).then(
        () => {
          if (m && measuring) {
            b.acked++;
            b.rtt.push(now() - t0);
          }
        },
        (e: unknown) => {
          if (m && b.errors++ === 0 && b.i === 0) process.stderr.write(`[w${WORKER}] update_transform error: ${(e as Error)?.message ?? e}\n`);
        },
      );
    }
    setTimeout(tick, Math.max(0, Math.min(4, next - now() - 0.5)));
  };
  tick();
}

function pct(a: number[], p: number) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

async function main() {
  for (let i = 0; i < COUNT; i++) {
    bots.push({ i, slot: 0, alive: false, rtt: [], sent: 0, acked: 0, errors: 0, received: 0, obs: i < OBSERVERS ? { lastArrival: new Map(), gaps: [], lat: [], updates: 0 } : undefined });
  }
  // connect in small batches
  for (let i = 0; i < bots.length; i += 4) await Promise.all(bots.slice(i, i + 4).map(connect));
  for (let i = 0; i < bots.length; i += 4) await Promise.all(bots.slice(i, i + 4).map(spawnBot));
  const aliveCount = bots.filter((b) => b.alive).length;
  process.stderr.write(`[w${WORKER}] ${aliveCount}/${COUNT} alive, waiting for start\n`);
  await sleep(Math.max(0, START_AT - Date.now()));
  const endAt = now() + WARMUP + DURATION;
  for (const b of bots) sendLoop(b, endAt);
  await sleep(WARMUP);
  measuring = true;
  // event loop lag of this worker (client-side saturation check)
  const lags: number[] = [];
  let lt = now();
  const lagTimer = setInterval(() => {
    const t = now();
    lags.push(t - lt - 50);
    lt = t;
  }, 50);
  const cpu0 = process.cpuUsage();
  await sleep(DURATION);
  measuring = false;
  clearInterval(lagTimer);
  const cpu = process.cpuUsage(cpu0);
  await sleep(500);
  const obs = bots.filter((b) => b.obs).map((b) => b.obs!);
  const allRtt = bots.flatMap((b) => b.rtt);
  const out = {
    worker: WORKER,
    count: COUNT,
    alive: aliveCount,
    sent: bots.reduce((s, b) => s + b.sent, 0),
    acked: bots.reduce((s, b) => s + b.acked, 0),
    errors: bots.reduce((s, b) => s + b.errors, 0),
    received: bots.reduce((s, b) => s + b.received, 0),
    rtt: { p50: pct(allRtt, 0.5), p95: pct(allRtt, 0.95), p99: pct(allRtt, 0.99) },
    obs: {
      updates: obs.reduce((s, o) => s + o.updates, 0),
      n: obs.length,
      gapP50: pct(obs.flatMap((o) => o.gaps), 0.5),
      gapP95: pct(obs.flatMap((o) => o.gaps), 0.95),
      gapP99: pct(obs.flatMap((o) => o.gaps), 0.99),
      latP50: pct(obs.flatMap((o) => o.lat), 0.5),
      latP95: pct(obs.flatMap((o) => o.lat), 0.95),
      latP99: pct(obs.flatMap((o) => o.lat), 0.99),
    },
    wireBytes,
    wireMsgs,
    cpuPct: ((cpu.user + cpu.system) / 1000 / DURATION) * 100,
    lagP95: pct(lags, 0.95),
  };
  process.stdout.write(JSON.stringify(out) + '\n');
  for (const b of bots) b.conn?.disconnect();
  await sleep(300);
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`[w${WORKER}] ${e?.stack ?? e}\n`);
  process.exit(1);
});
