// Scripted bot fights for the arena flyover: real SpacetimeDB clients (the same bindings and
// reducers as the browser / client/scripts/loadtest), each with a different weapon so the
// spectator renders varied effects (fire / ice / shock / poison elements, rockets, a grenade
// lobber, a bubble stream, a fire sniper) and outfits. They pair off on the floor around the stage
// and on the stage deck, strafe while facing their opponent and fire in bursts; hits go through
// `fire` (hitscan / stream) or `fire` + `report_hit` after the flight time (projectile / arc), so
// the server applies the damage, elements, deaths and respawns. LOCAL server only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DbConnection, tables } from '../../client/src/module_bindings';
import { EXAMPLE_AK, EXAMPLE_BANANA_LAUNCHER, EXAMPLE_BUBBLE_GUN, EXAMPLE_CROC_LAUNCHER, EXAMPLE_GLOCK, EXAMPLE_PUMP_SHOTGUN, EXAMPLE_REVOLVER } from '../../shared/src/forge/examples';
import { OUTFIT_ASTRONAUT, OUTFIT_KNIGHT } from '../../shared/src/outfit/examples';
import { videoDir } from './lib';

const GROUNDED = 2;
const TELEPORT = 4;

type Design = { name: string; stats: Record<string, unknown> } & Record<string, unknown>;

/** a forge example with an element / name override (the server re-sanitizes + balances it) */
function variant(base: unknown, name: string, element: string | null): Design {
  const d = structuredClone(base) as Design;
  d.name = name;
  d.stats = { ...d.stats, element };
  return d;
}

/** the recorded real forge design (fixtures/weapon.ndjson, the fire sniper) */
function fixtureDesign(): Design | null {
  try {
    const lines = readFileSync(join(videoDir, 'fixtures', 'weapon.ndjson'), 'utf8').split('\n').filter(Boolean);
    const done = lines.map((l) => JSON.parse(l) as { type: string; design?: Design }).find((e) => e.type === 'done');
    return done?.design ?? null;
  } catch {
    return null;
  }
}

interface Fighter {
  name: string;
  design: () => Design;
  /** preset outfit name, or a custom outfit design */
  outfit: string | object;
  /** fight spot (feet) and the opponent's index */
  at: [number, number, number];
  foe: number;
  /** share of shots that hit (keeps fights a few seconds long) */
  acc: number;
}

/**
 * Four duels in the camera's field of view (it orbits the stage at r 12-14 m looking at its
 * centre): one on the stage deck (y 1.2), three on the floor around it. Stage deck: |x| < 6,
 * |z| < 4; truss towers at (±8, ±6.6).
 */
const FIGHTERS: Fighter[] = [
  // stage deck: fire sniper vs ice rifle (ends the shot)
  { name: 'Ember', design: () => fixtureDesign() ?? variant(EXAMPLE_REVOLVER, 'Ember Hand Cannon', 'fire'), outfit: OUTFIT_KNIGHT, at: [-4.2, 1.2, -1.8], foe: 1, acc: 0.6 },
  { name: 'Frost', design: () => variant(EXAMPLE_AK, 'Frostbite Kalash', 'ice'), outfit: 'Tank', at: [3.4, 1.2, 1.6], foe: 0, acc: 0.3 },
  // north floor: rocket launcher vs shock pistol
  { name: 'Boomer', design: () => variant(EXAMPLE_CROC_LAUNCHER, 'Croc Rocket', null), outfit: 'Soldier', at: [-6.5, 0, 9.5], foe: 3, acc: 0.8 },
  { name: 'Volt', design: () => variant(EXAMPLE_GLOCK, 'Volt Striker', 'shock'), outfit: 'Scout', at: [5.5, 0, 9.8], foe: 2, acc: 0.35 },
  // south floor: poison shotgun vs grenade lobber
  { name: 'Viper', design: () => variant(EXAMPLE_PUMP_SHOTGUN, 'Viper Scattergun', 'poison'), outfit: OUTFIT_ASTRONAUT, at: [-5.5, 0, -9.2], foe: 5, acc: 0.5 },
  { name: 'Peel', design: () => variant(EXAMPLE_BANANA_LAUNCHER, 'Peel Lobber', null), outfit: 'Tank', at: [6.5, 0, -9.6], foe: 4, acc: 0.8 },
  // west floor (in front of the camera at the end): bubble stream vs fire revolver
  { name: 'Bubbles', design: () => variant(EXAMPLE_BUBBLE_GUN, 'Fizzwhistle Bubbler', null), outfit: 'Scout', at: [-9.6, 0, -3.2], foe: 7, acc: 0.45 },
  { name: 'Blaze', design: () => variant(EXAMPLE_REVOLVER, 'Blaze Revolver', 'fire'), outfit: 'Soldier', at: [-9.2, 0, 3.4], foe: 6, acc: 0.35 },
];

interface Weap {
  fireMode: string;
  fireRate: number;
  range: number;
  projectileSpeed: number;
  pellets: number;
  fuseTime: number;
}

interface Bot {
  f: Fighter;
  i: number;
  conn: DbConnection;
  me: string;
  slot: number;
  alive: boolean;
  pos: [number, number, number];
  teleport: boolean;
  seq: number;
  w: Weap | null;
  nextShot: number;
  burstUntil: number;
  restUntil: number;
  phase: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(uri: string, db: string): Promise<{ conn: DbConnection; me: string }> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('bot connect timeout')), 30_000);
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(db)
      .onConnect((conn, identity) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => {
            clearTimeout(to);
            resolve({ conn, me: identity.toHexString() });
          })
          .onError(() => reject(new Error('subscription error')))
          .subscribe([tables.player, tables.outfit.where((o) => o.isPreset.eq(true)), tables.weapon.where((w) => w.ownerIdentity.eq(identity))]);
      })
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

function myRow(b: Bot) {
  return [...b.conn.db.player.iter()].find((r) => r.identity.toHexString() === b.me);
}

function weaponOf(b: Bot): Weap | null {
  const p = myRow(b);
  if (!p) return null;
  const w = [...b.conn.db.weapon.iter()].find((x) => x.id === p.weaponId);
  if (!w) return null;
  const j = JSON.parse(w.json) as Partial<Weap>;
  return {
    fireMode: w.fireMode,
    fireRate: Number(j.fireRate ?? 2),
    range: Number(j.range ?? 30),
    projectileSpeed: Number(j.projectileSpeed ?? 0),
    pellets: Number(j.pellets ?? 1),
    fuseTime: Number(j.fuseTime ?? 0),
  };
}

export interface Fights {
  kills: () => number;
  stop: () => void;
}

export async function startFighters(opts: { uri: string; db: string; log?: (m: string) => void }): Promise<Fights> {
  const log = opts.log ?? ((m: string) => console.log(`[fighters] ${m}`));
  const bots: Bot[] = [];
  for (const [i, f] of FIGHTERS.entries()) {
    const { conn, me } = await connect(opts.uri, opts.db);
    bots.push({ f, i, conn, me, slot: -1, alive: false, pos: [...f.at], teleport: true, seq: 1, w: null, nextShot: 0, burstUntil: 0, restUntil: 0, phase: Math.random() * 6 });
  }
  let kills = 0;
  for (const b of bots) {
    const r = b.conn.reducers;
    await r.setName({ name: b.f.name }).catch(() => {});
    if (typeof b.f.outfit === 'string') {
      const o = [...b.conn.db.outfit.iter()].find((x) => x.name === b.f.outfit);
      if (o) await r.equipOutfit({ outfitId: o.id }).catch((e: Error) => log(`${b.f.name} outfit: ${e.message}`));
    } else {
      const d = b.f.outfit as { name: string };
      await r.registerOutfit({ outfitJson: JSON.stringify(d), prompt: d.name }).catch((e: Error) => log(`${b.f.name} outfit: ${e.message}`));
    }
    const d = b.f.design();
    await r.registerDesign({ designJson: JSON.stringify(d), prompt: String(d.name), fresh: false }).catch((e: Error) => log(`${b.f.name} weapon: ${e.message}`));
    b.conn.db.player.onUpdate((_c, old, row) => {
      if (row.identity.toHexString() !== b.me) return;
      if (old.alive && !row.alive) kills++;
    });
  }
  await sleep(500);
  for (const b of bots) {
    b.w = weaponOf(b);
    log(`${b.f.name}: ${b.w ? `${b.w.fireMode} rate ${b.w.fireRate}/s range ${b.w.range}` : 'NO WEAPON'}`);
  }

  let stopped = false;
  const t0 = performance.now();

  // respawn loop (the server keeps a 3 s delay)
  const respawner = setInterval(() => {
    for (const b of bots) {
      const p = myRow(b);
      if (!p) continue;
      b.slot = p.slot;
      if (b.alive && !p.alive) b.teleport = true;
      b.alive = p.alive;
      if (!p.alive && Date.now() > Number(p.respawnAt.toMillis())) void b.conn.reducers.respawn({ keepLoadout: true }).catch(() => {});
    }
  }, 250);

  const tick = () => {
    if (stopped) return;
    const t = (performance.now() - t0) / 1000;
    for (const b of bots) {
      if (!b.alive) continue;
      const foe = bots[b.f.foe]!;
      // strafe sideways (perpendicular to the duel line), slow drift, facing the foe
      const [ax, ay, az] = b.f.at;
      const dx0 = foe.f.at[0] - ax, dz0 = foe.f.at[2] - az;
      const len = Math.hypot(dx0, dz0) || 1;
      const px = -dz0 / len, pz = dx0 / len;
      const s = Math.sin(t * 1.7 + b.phase) * 1.6 + Math.sin(t * 0.6 + b.phase * 2) * 0.6;
      const vS = (Math.cos(t * 1.7 + b.phase) * 1.7 * 1.6 + Math.cos(t * 0.6 + b.phase * 2) * 0.36) ;
      b.pos = [ax + px * s, ay, az + pz * s];
      const dx = foe.pos[0] - b.pos[0], dz = foe.pos[2] - b.pos[2];
      const yaw = Math.atan2(-dx, -dz);
      const flags = GROUNDED | (b.teleport ? TELEPORT : 0);
      b.teleport = false;
      void b.conn.reducers
        .updateTransform({ x: b.pos[0], y: b.pos[1], z: b.pos[2], yaw, pitch: 0, vx: px * vS, vy: 0, vz: pz * vS, flags, sendT: Date.now() >>> 0 })
        .catch(() => {});
    }
    setTimeout(tick, 33);
  };
  tick();

  // fire: bursts of ~1-2 s, short pauses; hits roll against the fighter's accuracy
  const shooter = setInterval(() => {
    const now = performance.now();
    for (const b of bots) {
      const foe = bots[b.f.foe]!;
      if (!b.alive || !foe.alive || !b.w || foe.slot < 0) continue;
      if (now < b.restUntil) continue;
      if (now > b.burstUntil) {
        if (b.burstUntil) {
          b.restUntil = now + 500 + Math.random() * 900;
          b.burstUntil = 0;
          continue;
        }
        b.burstUntil = now + 900 + Math.random() * 1200;
      }
      if (now < b.nextShot) continue;
      b.nextShot = now + 1000 / Math.max(0.5, b.w.fireRate) + 15;
      const eye: [number, number, number] = [b.pos[0], b.pos[1] + 1.55, b.pos[2]];
      const hit = Math.random() < b.f.acc;
      const aimY = foe.pos[1] + (hit ? 1.1 : 1.1 + (Math.random() - 0.3) * 1.4);
      const side = hit ? 0 : (Math.random() - 0.5) * 2.2;
      const tx = foe.pos[0] + side * 0.7, tz = foe.pos[2] + side * 0.7;
      let dx = tx - eye[0], dy = aimY - eye[1], dz = tz - eye[2];
      const dist = Math.hypot(dx, dy, dz) || 1;
      dx /= dist;
      dy /= dist;
      dz /= dist;
      const seq = b.seq++;
      const projectile = b.w.fireMode === 'projectile' || b.w.fireMode === 'arc';
      const at = { ix: foe.pos[0], iy: foe.pos[1] + 1.1, iz: foe.pos[2] };
      const hits = !projectile && hit ? [{ slot: foe.slot, pellets: Math.max(1, Math.round(b.w.pellets * 0.7)), ...at, zone: 0 }] : [];
      void b.conn.reducers.fire({ seq, ox: eye[0], oy: eye[1], oz: eye[2], dx, dy, dz, hits, charge: 0, combo: 0 }).catch(() => {});
      if (projectile && hit) {
        const flight = b.w.projectileSpeed > 0 ? (dist / b.w.projectileSpeed) * 1000 : 300;
        const delay = b.w.fireMode === 'arc' ? Math.max(flight * 1.3, 400) : flight;
        const slot = foe.slot;
        setTimeout(() => {
          if (foe.alive) void b.conn.reducers.reportHit({ seq, slot, pellets: 1, ix: foe.pos[0], iy: foe.pos[1] + 0.6, iz: foe.pos[2], zone: 0 }).catch(() => {});
        }, delay);
      }
    }
  }, 20);

  return {
    kills: () => kills,
    stop: () => {
      stopped = true;
      clearInterval(respawner);
      clearInterval(shooter);
      for (const b of bots) {
        try {
          b.conn.disconnect();
        } catch {
          /* gone */
        }
      }
    },
  };
}
