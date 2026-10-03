// ai-gaem SpacetimeDB module (TypeScript, SpacetimeDB 2.x).
//
// Movement is client-authoritative (update_transform). Damage is server-authoritative:
// clients call `fire` for every shot and `report_hit` for every target that shot hit; the
// server validates cooldown / ammo / range / timing against the *stored* weapon stats.

import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, TimeDuration, Timestamp, type Identity } from 'spacetimedb';
import {
  MAX_HP,
  PRESET_WEAPONS,
  RESPAWN_DELAY_SECONDS,
  SLOW_DURATION,
  TEST_MAP_SPAWN_POINTS,
  WEAPON_CLASSES,
  WEAPON_GEN_SYSTEM,
  buildWeaponGenUserPrompt,
  chooseClassFromPrompt,
  clampWeapon,
  filterCatalogForClass,
  filterKnownParts,
  HIT_ZONE_BODY,
  HIT_ZONE_HEAD,
  isPlausibleHeadHit,
  zoneDamage,
  parseJsonObject,
  randomRawWeapon,
  splashDamageAt,
  type Weapon,
} from '@ai-gaem/shared';
import { PART_CATALOG, PART_RECIPES } from './catalog.generated';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    online: t.bool(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    yaw: t.f32(),
    pitch: t.f32(),
    hp: t.f32(),
    alive: t.bool(),
    kills: t.u32(),
    deaths: t.u32(),
    weaponId: t.u64(),
    ammo: t.u32(),
    reloading: t.bool(),
    reloadUntil: t.timestamp(),
    lastFireAt: t.timestamp(),
    respawnAt: t.timestamp(),
    /** Movement slow currently applied (percent), until slowUntil. Client applies it. */
    slowPercent: t.f32(),
    slowUntil: t.timestamp(),
    /** Active damage-over-time, applied server-side by the tick reducer. */
    dotDps: t.f32(),
    dotUntil: t.timestamp(),
    dotSource: t.identity(),
    dotWeaponId: t.u64(),
    /** Crouch state (client-authoritative, sent with update_transform); lowers the head hitbox. */
    crouching: t.bool().default(false),
  },
);

const weapon = table(
  { name: 'weapon', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    ownerIdentity: t.identity().index('btree'),
    name: t.string(),
    weaponClass: t.string(),
    fireMode: t.string(),
    /** Full clamped Weapon JSON (shape: @ai-gaem/shared `Weapon`). */
    json: t.string(),
    prompt: t.string(),
    isPreset: t.bool(),
    createdAt: t.timestamp(),
  },
);

const spawnPoint = table(
  { name: 'spawn_point', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    yaw: t.f32(),
  },
);

/** Private: recent shots, used to validate report_hit. */
const shot = table(
  {
    name: 'shot',
    indexes: [{ accessor: 'by_shooter_seq', algorithm: 'btree', columns: ['shooter', 'seq'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    shooter: t.identity(),
    seq: t.u32(),
    weaponId: t.u64(),
    firedAt: t.timestamp(),
    ox: t.f32(),
    oy: t.f32(),
    oz: t.f32(),
    hitTargets: t.array(t.identity()),
  },
);

/** Broadcast: a shot was fired (for remote tracers / projectiles / muzzle flash). */
const shotEvent = table(
  { name: 'shot_event', public: true, event: true },
  {
    shooter: t.identity(),
    seq: t.u32(),
    weaponId: t.u64(),
    ox: t.f32(),
    oy: t.f32(),
    oz: t.f32(),
    dx: t.f32(),
    dy: t.f32(),
    dz: t.f32(),
  },
);

/** Broadcast: damage was dealt. `shooter == target` never happens; DoT ticks have seq = 0 and dot = true. */
const hitEvent = table(
  { name: 'hit_event', public: true, event: true },
  {
    shooter: t.identity(),
    target: t.identity(),
    weaponId: t.u64(),
    damage: t.f32(),
    killed: t.bool(),
    dot: t.bool(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    knockX: t.f32(),
    knockY: t.f32(),
    knockZ: t.f32(),
    slowPercent: t.f32(),
    /** Direct hit on the head hitbox (multiplier applied). */
    headshot: t.bool().default(false),
  },
);

/** Private singleton (id = 0): admin identity + LLM settings. */
const config = table(
  { name: 'config' },
  {
    id: t.u32().primaryKey(),
    admin: t.identity(),
    anthropicApiKey: t.string(),
    llmModel: t.string(),
  },
);

const tickTimer = table(
  { name: 'tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

const spacetimedb = schema({ player, weapon, spawnPoint, shot, shotEvent, hitEvent, config, tickTimer });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type PlayerRow = NonNullable<ReturnType<Ctx['db']['player']['identity']['find']>>;
type WeaponRow = NonNullable<ReturnType<Ctx['db']['weapon']['id']['find']>>;

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const DEFAULT_LLM_MODEL = 'claude-haiku-4-5-20251001';
const TICK_MICROS = 250_000n;
const SHOT_TTL_MICROS = 15_000_000n;
const EPOCH = new Timestamp(0n);
/** Network tolerance on fire-rate cooldowns (accept shots up to 15% early). */
const COOLDOWN_TOLERANCE = 0.85;
const RANGE_TOLERANCE_MULT = 1.2;
const RANGE_TOLERANCE_ADD = 2;
const MAX_ORIGIN_OFFSET = 4;
const MAX_COORD = 10_000;

const micros = (ts: Timestamp) => ts.microsSinceUnixEpoch;
const addSeconds = (ts: Timestamp, s: number) => new Timestamp(ts.microsSinceUnixEpoch + BigInt(Math.round(s * 1e6)));
const secondsBetween = (a: Timestamp, b: Timestamp) => Number(b.microsSinceUnixEpoch - a.microsSinceUnixEpoch) / 1e6;
const dist = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
  Math.hypot(ax - bx, ay - by, az - bz);

function finite(...v: number[]) {
  for (const n of v) if (!Number.isFinite(n) || Math.abs(n) > MAX_COORD) throw new SenderError('bad coordinates');
}

function parseWeapon(row: WeaponRow): Weapon {
  return clampWeapon(JSON.parse(row.json));
}

function getConfig(ctx: Ctx) {
  return ctx.db.config.id.find(0);
}

function requireAdmin(ctx: Ctx) {
  const cfg = getConfig(ctx);
  if (!cfg || !cfg.admin.isEqual(ctx.sender)) throw new SenderError('admin only');
  return cfg;
}

function requirePlayer(ctx: Ctx): PlayerRow {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (!p) throw new SenderError('no player row; reconnect');
  return p;
}

function insertWeapon(ctx: Ctx, owner: Identity, w: Weapon, prompt: string, isPreset: boolean): WeaponRow {
  return ctx.db.weapon.insert({
    id: 0n,
    ownerIdentity: owner,
    name: w.name,
    weaponClass: w.class,
    fireMode: w.fireMode,
    json: JSON.stringify(w),
    prompt: prompt.slice(0, 300),
    isPreset,
    createdAt: ctx.timestamp,
  });
}

function presetWeaponRows(ctx: Ctx): WeaponRow[] {
  return [...ctx.db.weapon.iter()].filter(w => w.isPreset);
}

function randomPresetId(ctx: Ctx): bigint {
  const presets = presetWeaponRows(ctx);
  if (presets.length === 0) return 0n;
  return presets[ctx.random.integerInRange(0, presets.length - 1)].id;
}

function starterPresetId(ctx: Ctx): bigint {
  const pistol = presetWeaponRows(ctx).find(w => w.weaponClass === 'pistol');
  return pistol ? pistol.id : randomPresetId(ctx);
}

/** Spawn point farthest from living enemies (random among the best 3 for variety). */
function pickSpawn(ctx: Ctx, forIdentity: Identity) {
  const points = [...ctx.db.spawnPoint.iter()];
  if (points.length === 0) {
    return { x: ctx.random() * 10 - 5, y: 2, z: ctx.random() * 10 - 5, yaw: 0 };
  }
  const enemies = [...ctx.db.player.iter()].filter(p => p.alive && p.online && !p.identity.isEqual(forIdentity));
  const scored = points.map(sp => {
    let minD = Infinity;
    for (const e of enemies) minD = Math.min(minD, dist(sp.x, sp.y, sp.z, e.x, e.y, e.z));
    return { sp, score: enemies.length ? minD : ctx.random() };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(3, scored.length));
  return top[ctx.random.integerInRange(0, top.length - 1)].sp;
}

function spawnPlayer(ctx: Ctx, p: PlayerRow, weaponId: bigint): PlayerRow {
  const sp = pickSpawn(ctx, p.identity);
  const wRow = ctx.db.weapon.id.find(weaponId);
  const mag = wRow ? parseWeapon(wRow).magSize : 0;
  return {
    ...p,
    x: sp.x,
    y: sp.y,
    z: sp.z,
    yaw: sp.yaw,
    pitch: 0,
    hp: MAX_HP,
    alive: true,
    weaponId,
    ammo: mag,
    reloading: false,
    reloadUntil: EPOCH,
    lastFireAt: EPOCH,
    respawnAt: EPOCH,
    slowPercent: 0,
    slowUntil: EPOCH,
    dotDps: 0,
    dotUntil: EPOCH,
    dotSource: p.identity,
    dotWeaponId: 0n,
    crouching: false,
  };
}

/** Apply damage to a target; handles death, kill credit and the hit_event broadcast. Returns the updated target. */
function applyDamage(
  ctx: Ctx,
  target: PlayerRow,
  amount: number,
  attacker: Identity,
  weaponId: bigint,
  opts: { dot?: boolean; x?: number; y?: number; z?: number; knock?: [number, number, number]; slow?: number; headshot?: boolean } = {},
): PlayerRow {
  if (!target.alive || amount <= 0) return target;
  const hp = Math.max(0, target.hp - amount);
  const killed = hp <= 0;
  let next: PlayerRow = { ...target, hp };
  if (killed) {
    next = {
      ...next,
      alive: false,
      deaths: target.deaths + 1,
      respawnAt: addSeconds(ctx.timestamp, RESPAWN_DELAY_SECONDS),
      dotDps: 0,
      dotUntil: EPOCH,
      slowPercent: 0,
      slowUntil: EPOCH,
    };
  }
  ctx.db.player.identity.update(next);
  if (killed && !attacker.isEqual(target.identity)) {
    const killer = ctx.db.player.identity.find(attacker);
    if (killer) ctx.db.player.identity.update({ ...killer, kills: killer.kills + 1 });
  }
  const knock = opts.knock ?? [0, 0, 0];
  ctx.db.hitEvent.insert({
    shooter: attacker,
    target: target.identity,
    weaponId,
    damage: amount,
    killed,
    dot: !!opts.dot,
    x: opts.x ?? target.x,
    y: opts.y ?? target.y,
    z: opts.z ?? target.z,
    knockX: knock[0],
    knockY: knock[1],
    knockZ: knock[2],
    slowPercent: opts.slow ?? 0,
    headshot: !!opts.headshot,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Idempotent world seeding. Runs from `init` (fresh database) and from every client connect,
 * because a database that existed before this module was first published never runs `init`.
 */
function seedWorld(ctx: Ctx) {
  if (presetWeaponRows(ctx).length === 0) {
    for (const cls of WEAPON_CLASSES) insertWeapon(ctx, ctx.sender, PRESET_WEAPONS[cls], `preset:${cls}`, true);
  }
  // Presets ship without parts: give each one the first part recipe for its class so it renders.
  if (PART_RECIPES.length > 0) {
    for (const row of presetWeaponRows(ctx)) {
      const w = parseWeapon(row);
      if (w.parts.length > 0) continue;
      const recipe = PART_RECIPES.find(r => r.class === w.class);
      if (!recipe) continue;
      ctx.db.weapon.id.update({ ...row, json: JSON.stringify(clampWeapon({ ...w, parts: recipe.parts })) });
    }
  }
  // Spawn points: seed the TEST MAP spawns. Also migrates the old placeholder ring
  // (8 points at radius 12, y = 2) that earlier module versions seeded.
  const points = [...ctx.db.spawnPoint.iter()];
  const isOldRing =
    points.length === 8 && points.every(p => Math.abs(p.y - 2) < 1e-3 && Math.abs(Math.hypot(p.x, p.z) - 12) < 1e-2);
  if (points.length === 0 || isOldRing) {
    for (const p of points) ctx.db.spawnPoint.id.delete(p.id);
    for (const sp of TEST_MAP_SPAWN_POINTS) ctx.db.spawnPoint.insert({ id: 0n, x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw });
  }
  if (ctx.db.tickTimer.count() === 0n) {
    ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS) });
  }
}

/** Parts for a weapon that has none (no LLM, or the LLM only used unknown ids): a random class recipe. */
function recipePartsFor(cls: string, rand01: number) {
  const list = PART_RECIPES.filter(r => r.class === cls);
  const pool = list.length ? list : PART_RECIPES;
  if (!pool.length) return [];
  return pool[Math.floor(rand01 * pool.length) % pool.length].parts;
}

export const init = spacetimedb.init(ctx => {
  ctx.db.config.insert({ id: 0, admin: ctx.sender, anthropicApiKey: '', llmModel: DEFAULT_LLM_MODEL });
  seedWorld(ctx);
});

/**
 * One-shot: if no admin exists yet (database pre-dated the module, so `init` never ran),
 * the caller becomes admin. Run it once from the CLI right after the first publish.
 */
export const claim_admin = spacetimedb.reducer(ctx => {
  if (getConfig(ctx)) throw new SenderError('admin already set');
  ctx.db.config.insert({ id: 0, admin: ctx.sender, anthropicApiKey: '', llmModel: DEFAULT_LLM_MODEL });
  seedWorld(ctx);
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  seedWorld(ctx);
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    ctx.db.player.identity.update({ ...existing, online: true });
    return;
  }
  const base: PlayerRow = {
    identity: ctx.sender,
    name: `Player-${ctx.sender.toHexString().slice(0, 4)}`,
    online: true,
    x: 0,
    y: 2,
    z: 0,
    yaw: 0,
    pitch: 0,
    hp: MAX_HP,
    alive: false,
    kills: 0,
    deaths: 0,
    weaponId: 0n,
    ammo: 0,
    reloading: false,
    reloadUntil: EPOCH,
    lastFireAt: EPOCH,
    respawnAt: EPOCH,
    slowPercent: 0,
    slowUntil: EPOCH,
    dotDps: 0,
    dotUntil: EPOCH,
    dotSource: ctx.sender,
    dotWeaponId: 0n,
    crouching: false,
  };
  // New players start with the preset pistol (later respawns without keepLoadout roll a random preset).
  ctx.db.player.insert(spawnPlayer(ctx, base, starterPresetId(ctx)));
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) ctx.db.player.identity.update({ ...p, online: false });
});

// ---------------------------------------------------------------------------
// Player reducers
// ---------------------------------------------------------------------------

export const set_name = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  if (!clean) throw new SenderError('name must not be empty');
  const p = requirePlayer(ctx);
  ctx.db.player.identity.update({ ...p, name: clean });
});

/** Client-authoritative movement + crouch state. Call ~15-20 Hz (and on crouch changes). Ignored while dead. */
export const update_transform = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.f32(), pitch: t.f32(), crouching: t.bool() },
  (ctx, { x, y, z, yaw, pitch, crouching }) => {
    finite(x, y, z, yaw, pitch);
    const p = requirePlayer(ctx);
    if (!p.alive) return;
    ctx.db.player.identity.update({ ...p, x, y, z, yaw, pitch, crouching });
  },
);

/** Start reloading the current weapon. */
export const reload = spacetimedb.reducer(ctx => {
  const p = requirePlayer(ctx);
  if (!p.alive || p.reloading) return;
  const wRow = ctx.db.weapon.id.find(p.weaponId);
  if (!wRow) return;
  const w = parseWeapon(wRow);
  if (w.fireMode === 'melee' || p.ammo >= w.magSize) return;
  ctx.db.player.identity.update({ ...p, reloading: true, reloadUntil: addSeconds(ctx.timestamp, w.reloadTime) });
});

/**
 * Fire one shot (one stream tick / one melee swing). `seq` is a client-chosen, per-player
 * increasing shot number referenced later by report_hit. Origin/direction are for broadcast
 * only. Shots that violate cooldown or ammo are silently dropped (their hits will be rejected).
 */
export const fire = spacetimedb.reducer(
  { seq: t.u32(), ox: t.f32(), oy: t.f32(), oz: t.f32(), dx: t.f32(), dy: t.f32(), dz: t.f32() },
  (ctx, { seq, ox, oy, oz, dx, dy, dz }) => {
    finite(ox, oy, oz, dx, dy, dz);
    let p = requirePlayer(ctx);
    if (!p.alive) return;
    const wRow = ctx.db.weapon.id.find(p.weaponId);
    if (!wRow) return;
    const w = parseWeapon(wRow);
    const now = ctx.timestamp;

    // Reload bookkeeping.
    if (p.reloading) {
      if (micros(now) < micros(p.reloadUntil)) return;
      p = { ...p, reloading: false, ammo: w.magSize };
    }
    const usesAmmo = w.fireMode !== 'melee';
    if (usesAmmo && p.ammo === 0) {
      ctx.db.player.identity.update({ ...p, reloading: true, reloadUntil: addSeconds(now, w.reloadTime) });
      return;
    }

    // Cooldown from stored fireRate (+ charge time).
    const minInterval = (1 / w.fireRate + w.chargeTime) * COOLDOWN_TOLERANCE;
    if (secondsBetween(p.lastFireAt, now) < minInterval) return;

    // Origin must be near the player.
    if (dist(ox, oy, oz, p.x, p.y, p.z) > MAX_ORIGIN_OFFSET) return;

    // Duplicate seq => ignore.
    if ([...ctx.db.shot.by_shooter_seq.filter([ctx.sender, seq])].length > 0) return;

    let next: PlayerRow = { ...p, lastFireAt: now };
    if (usesAmmo) {
      const ammo = p.ammo - 1;
      next = ammo === 0
        ? { ...next, ammo, reloading: true, reloadUntil: addSeconds(now, w.reloadTime) }
        : { ...next, ammo };
    }
    ctx.db.player.identity.update(next);
    ctx.db.shot.insert({ id: 0n, shooter: ctx.sender, seq, weaponId: wRow.id, firedAt: now, ox, oy, oz, hitTargets: [] });
    ctx.db.shotEvent.insert({ shooter: ctx.sender, seq, weaponId: wRow.id, ox, oy, oz, dx, dy, dz });
  },
);

/**
 * Report that shot `seq` hit `target`. `pellets` = pellets that connected (shotguns; use 1
 * otherwise). (ix,iy,iz) = impact point (used for splash falloff; for direct hits pass the
 * hit position). `zone` = hit zone (0 body, 1 head; anything else counts as body). Damage comes
 * only from stored weapon stats: head hits apply the weapon's headshotMultiplier (capped at
 * 150), but only if the impact point is plausibly at the target's head (stored position +
 * crouch state); otherwise the hit is downgraded to a body hit.
 */
export const report_hit = spacetimedb.reducer(
  { seq: t.u32(), target: t.identity(), pellets: t.u32(), ix: t.f32(), iy: t.f32(), iz: t.f32(), zone: t.u8() },
  (ctx, { seq, target, pellets, ix, iy, iz, zone }) => {
    finite(ix, iy, iz);
    if (target.isEqual(ctx.sender)) return;
    const shooter = requirePlayer(ctx);
    const s = [...ctx.db.shot.by_shooter_seq.filter([ctx.sender, seq])][0];
    if (!s) return;
    if (s.hitTargets.some(h => h.isEqual(target))) return;
    const victim = ctx.db.player.identity.find(target);
    if (!victim || !victim.alive || !victim.online) return;
    const wRow = ctx.db.weapon.id.find(s.weaponId);
    if (!wRow) return;
    const w = parseWeapon(wRow);

    // Timing window: hitscan/melee/stream immediate; projectiles get flight time + fuse.
    const age = secondsBetween(s.firedAt, ctx.timestamp);
    const flight = w.projectileSpeed > 0 ? w.range / w.projectileSpeed : 0;
    const window = 1.5 + flight * (w.fireMode === 'arc' ? 2 : 1) + w.fuseTime;
    if (age > window) return;

    // Range: shot origin -> impact, and impact -> victim's last known position.
    const maxRange = w.range * RANGE_TOLERANCE_MULT + RANGE_TOLERANCE_ADD;
    const toVictim = dist(s.ox, s.oy, s.oz, victim.x, victim.y, victim.z);
    let damage: number;
    let headshot = false;
    if (w.splashRadius > 0) {
      if (dist(s.ox, s.oy, s.oz, ix, iy, iz) > maxRange) return;
      const d = Math.max(0, dist(ix, iy, iz, victim.x, victim.y, victim.z) - 1.0); // 1 m latency slack
      damage = splashDamageAt(w, d);
    } else {
      if (toVictim > maxRange) return;
      const n = Math.max(1, Math.min(pellets, w.pellets));
      headshot =
        zone === HIT_ZONE_HEAD &&
        w.fireMode !== 'stream' &&
        w.fireMode !== 'melee' &&
        isPlausibleHeadHit([victim.x, victim.y, victim.z], victim.crouching, [ix, iy, iz]);
      damage = zoneDamage(w, w.damage * n, headshot ? HIT_ZONE_HEAD : HIT_ZONE_BODY);
    }
    if (damage <= 0) return;

    ctx.db.shot.id.update({ ...s, hitTargets: [...s.hitTargets, target] });

    // Knockback away from the shooter (or blast centre).
    let knock: [number, number, number] = [0, 0, 0];
    if (w.knockback > 0) {
      const cx = w.splashRadius > 0 ? ix : shooter.x;
      const cy = w.splashRadius > 0 ? iy : shooter.y;
      const cz = w.splashRadius > 0 ? iz : shooter.z;
      const len = Math.max(0.001, dist(victim.x, victim.y, victim.z, cx, cy, cz));
      knock = [((victim.x - cx) / len) * w.knockback, ((victim.y - cy) / len) * w.knockback + w.knockback * 0.3, ((victim.z - cz) / len) * w.knockback];
    }

    let v = applyDamage(ctx, victim, damage, ctx.sender, wRow.id, { x: ix, y: iy, z: iz, knock, slow: w.slowPercent, headshot });
    if (!v.alive) return;

    // Status effects (refresh, don't stack).
    if (w.dotDamage > 0 || w.slowPercent > 0) {
      v = { ...v };
      if (w.dotDamage > 0) {
        v.dotDps = w.dotDamage / Math.max(w.dotDuration, 0.5);
        v.dotUntil = addSeconds(ctx.timestamp, w.dotDuration);
        v.dotSource = ctx.sender;
        v.dotWeaponId = wRow.id;
      }
      if (w.slowPercent > 0) {
        v.slowPercent = w.slowPercent;
        v.slowUntil = addSeconds(ctx.timestamp, SLOW_DURATION);
      }
      ctx.db.player.identity.update(v);
    }
  },
);

/**
 * Respawn after death once `respawnAt` has passed. keepLoadout=true keeps the current weapon;
 * false picks a random preset (call equip_weapon / generate_weapon first to choose a new one).
 */
export const respawn = spacetimedb.reducer({ keepLoadout: t.bool() }, (ctx, { keepLoadout }) => {
  const p = requirePlayer(ctx);
  if (p.alive) return;
  if (micros(ctx.timestamp) < micros(p.respawnAt)) throw new SenderError('respawn not ready');
  const keep = keepLoadout && !!ctx.db.weapon.id.find(p.weaponId);
  ctx.db.player.identity.update(spawnPlayer(ctx, p, keep ? p.weaponId : randomPresetId(ctx)));
});

/** Equip a weapon from the library (your own or a preset). Only while dead. */
export const equip_weapon = spacetimedb.reducer({ weaponId: t.u64() }, (ctx, { weaponId }) => {
  const p = requirePlayer(ctx);
  if (p.alive) throw new SenderError('can only change weapon while dead');
  const w = ctx.db.weapon.id.find(weaponId);
  if (!w) throw new SenderError('unknown weapon');
  if (!w.isPreset && !w.ownerIdentity.isEqual(ctx.sender)) throw new SenderError('not your weapon');
  ctx.db.player.identity.update({ ...p, weaponId });
});

/** Store a weapon from raw JSON (e.g. produced by an external generator). Always re-balanced. */
export const register_weapon = spacetimedb.reducer(
  { rawJson: t.string(), prompt: t.string() },
  (ctx, { rawJson, prompt }) => {
    if (rawJson.length > 20_000) throw new SenderError('weapon json too large');
    let raw: unknown;
    try {
      raw = JSON.parse(rawJson);
    } catch {
      throw new SenderError('invalid json');
    }
    const w = clampWeapon(raw);
    w.parts = filterKnownParts(w.parts, KNOWN_PART_IDS);
    if (w.parts.length === 0) w.parts = recipePartsFor(w.class, ctx.random());
    insertWeapon(ctx, ctx.sender, w, prompt, false);
  },
);

// ---------------------------------------------------------------------------
// Map editing
// ---------------------------------------------------------------------------

export const add_spawn_point = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.f32() },
  (ctx, { x, y, z, yaw }) => {
    finite(x, y, z, yaw);
    ctx.db.spawnPoint.insert({ id: 0n, x, y, z, yaw });
  },
);

export const remove_spawn_point = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  ctx.db.spawnPoint.id.delete(id);
});

export const clear_spawn_points = spacetimedb.reducer(ctx => {
  requireAdmin(ctx);
  for (const sp of [...ctx.db.spawnPoint.iter()]) ctx.db.spawnPoint.id.delete(sp.id);
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** `spacetime call prompt-wars-63xhe set_api_key '"sk-ant-..."'` from the publishing identity. */
export const set_api_key = spacetimedb.reducer({ key: t.string() }, (ctx, { key }) => {
  const cfg = requireAdmin(ctx);
  ctx.db.config.id.update({ ...cfg, anthropicApiKey: key.trim() });
});

export const set_llm_model = spacetimedb.reducer({ model: t.string() }, (ctx, { model }) => {
  const cfg = requireAdmin(ctx);
  ctx.db.config.id.update({ ...cfg, llmModel: model.trim() || DEFAULT_LLM_MODEL });
});

// ---------------------------------------------------------------------------
// Tick: DoT, effect expiry, shot cleanup
// ---------------------------------------------------------------------------

export const tick = spacetimedb.reducer({ onSchedule: tickTimer }, { timer: tickTimer.rowType }, (ctx, { timer: _timer }) => {
  const now = micros(ctx.timestamp);
  const dt = Number(TICK_MICROS) / 1e6;
  for (const p of [...ctx.db.player.iter()]) {
    if (!p.alive) continue;
    if (p.dotDps > 0) {
      if (now >= micros(p.dotUntil)) {
        ctx.db.player.identity.update({ ...p, dotDps: 0 });
      } else {
        applyDamage(ctx, p, p.dotDps * dt, p.dotSource, p.dotWeaponId, { dot: true });
      }
    } else if (p.slowPercent > 0 && now >= micros(p.slowUntil)) {
      ctx.db.player.identity.update({ ...p, slowPercent: 0 });
    }
  }
  for (const s of [...ctx.db.shot.iter()]) {
    if (now - micros(s.firedAt) > SHOT_TTL_MICROS) ctx.db.shot.id.delete(s.id);
  }
});

// ---------------------------------------------------------------------------
// LLM weapon generation (procedure: may do outbound HTTP)
// ---------------------------------------------------------------------------

const KNOWN_PART_IDS = new Set(PART_CATALOG.map(e => e.id));

const GenerateResult = t.object('GenerateResult', {
  ok: t.bool(),
  weaponId: t.u64(),
  message: t.string(),
});

/**
 * Generate a weapon from a text prompt. `weaponClass` may be '' to infer it from the prompt.
 * Calls Anthropic if an API key is configured (set_api_key), otherwise rolls random stats.
 * The result is clamped, stored in `weapon`, and auto-equipped if the caller is dead.
 */
export const generate_weapon = spacetimedb.procedure(
  { prompt: t.string(), weaponClass: t.string() },
  GenerateResult,
  (ctx, { prompt, weaponClass }) => {
    const cleanPrompt = prompt.slice(0, 300);
    const setup = ctx.withTx(tx => {
      const cfg = tx.db.config.id.find(0);
      const cls = chooseClassFromPrompt(cleanPrompt, weaponClass, () => tx.random());
      const seed = tx.random();
      const recipeRoll = tx.random();
      return { recipeRoll, apiKey: cfg?.anthropicApiKey ?? '', model: cfg?.llmModel || DEFAULT_LLM_MODEL, cls, seed };
    });

    let raw: unknown;
    let message = 'ok';
    if (setup.apiKey) {
      const subset = filterCatalogForClass(PART_CATALOG, setup.cls, cleanPrompt);
      try {
        const res = ctx.http.fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': setup.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: setup.model,
            max_tokens: 2000,
            system: WEAPON_GEN_SYSTEM,
            messages: [{ role: 'user', content: buildWeaponGenUserPrompt(setup.cls, cleanPrompt, subset) }],
          }),
          timeout: TimeDuration.fromMillis(30_000),
        });
        if (res.status === 200) {
          const body = JSON.parse(res.text()) as { content?: { type: string; text?: string }[] };
          const text = (body.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
          raw = parseJsonObject(text);
          if (!raw) message = 'LLM returned no JSON; used random weapon';
        } else {
          message = `LLM HTTP ${res.status}; used random weapon`;
        }
      } catch (e) {
        message = `LLM request failed (${String(e).slice(0, 120)}); used random weapon`;
      }
    } else {
      message = 'no API key configured; used random weapon';
    }

    if (!raw || typeof raw !== 'object') {
      let s = setup.seed * 2147483646 + 1;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      raw = randomRawWeapon(setup.cls, cleanPrompt, rnd);
    } else {
      // Keep the class we chose (and pre-filtered parts for) unless the LLM picked a valid one.
      const r = raw as Record<string, unknown>;
      if (!r.class) r.class = setup.cls;
    }

    const w = clampWeapon(raw);
    w.parts = filterKnownParts(w.parts, KNOWN_PART_IDS);
    if (w.parts.length === 0) w.parts = recipePartsFor(w.class, setup.recipeRoll);

    const weaponId = ctx.withTx(tx => {
      const row = insertWeapon(tx, ctx.sender, w, cleanPrompt, false);
      const p = tx.db.player.identity.find(ctx.sender);
      if (p && !p.alive) tx.db.player.identity.update({ ...p, weaponId: row.id });
      return row.id;
    });
    return { ok: true, weaponId, message };
  },
);
