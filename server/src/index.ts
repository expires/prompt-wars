// ai-gaem SpacetimeDB module (TypeScript, SpacetimeDB 2.x).
//
// Movement is client-authoritative (update_transform -> small public `player_pose` row keyed by a
// u32 slot). Damage is server-authoritative: hitscan / stream / melee shots carry their hits in a
// single `fire` call; projectiles call `fire` and later `report_hit`. The server validates fire
// rate (token bucket), ammo, range and hit position (favor-the-shooter, swept over the victim's
// last <= 250 ms) against the *stored* weapon stats.
//
// Cost notes: there is no always-on scheduled reducer. Damage-over-time uses a per-victim
// `dot_timer` row that exists only while a DoT is active; slows expire client-side from
// `slowUntil`; expired `shot` rows are cleaned up inside `fire` for that shooter.

import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, TimeDuration, Timestamp, type Identity } from 'spacetimedb';
import {
  MAX_HP,
  POSE_FLAG_CROUCH,
  POSE_FLAG_GROUNDED,
  POSE_FLAG_TELEPORT,
  PRESET_WEAPONS,
  RESPAWN_DELAY_SECONDS,
  SLOW_DURATION,
  TEST_MAP_SPAWN_POINTS,
  WEAPON_CLASSES,
  WEAPON_GEN_SYSTEM,
  buildWeaponGenUserPrompt,
  chooseClassFromPrompt,
  clampWeapon,
  classifyHit,
  directHitDamage,
  effectiveFireRate,
  filterCatalogForClass,
  filterKnownParts,
  fireCreditsMax,
  HIT_ZONE_HEAD,
  zoneDamage,
  parseJsonObject,
  randomRawWeapon,
  spendFireCredit,
  splashDamageAt,
  splashDistance,
  sweptPoseAt,
  type PoseSample,
  type SweptPose,
  type Weapon,
} from '@ai-gaem/shared';
import { PART_CATALOG, PART_RECIPES } from './catalog.generated';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Rarely-changing public player state. Columns marked "legacy" pre-date the pose / combat split
 * and can't be dropped by an automatic migration: x/y/z/yaw now only carry the spawn point
 * (written on (re)spawn, the client teleports there); the others are no longer written.
 */
const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    online: t.bool(),
    /** spawn position (set on respawn); live position is in player_pose */
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    yaw: t.f32(),
    /** legacy */
    pitch: t.f32(),
    hp: t.f32(),
    alive: t.bool(),
    kills: t.u32(),
    deaths: t.u32(),
    weaponId: t.u64(),
    /** legacy (now player_combat) */
    ammo: t.u32(),
    /** legacy (now player_combat) */
    reloading: t.bool(),
    /** legacy (now player_combat) */
    reloadUntil: t.timestamp(),
    /** legacy (now player_combat) */
    lastFireAt: t.timestamp(),
    respawnAt: t.timestamp(),
    /** Movement slow (percent) until slowUntil; the client applies it and lets it expire. */
    slowPercent: t.f32(),
    slowUntil: t.timestamp(),
    /** legacy (now player_combat) */
    dotDps: t.f32(),
    /** legacy (now player_combat) */
    dotUntil: t.timestamp(),
    /** legacy (now player_combat) */
    dotSource: t.identity(),
    /** legacy (now player_combat) */
    dotWeaponId: t.u64(),
    /** legacy (now player_pose.flags) */
    crouching: t.bool().default(false),
    /** player_pose key while online (0 = none). Assigned on connect, reused by others when offline. */
    slot: t.u32().default(0),
  },
);

/**
 * Hot, small, public: one row per online player, updated by update_transform (~20 Hz while
 * moving, nothing while idle). sendT = sender's clock (ms, wraps) for jitter-free interpolation.
 */
const playerPose = table(
  { name: 'player_pose', public: true },
  {
    slot: t.u32().primaryKey(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    yaw: t.f32(),
    pitch: t.f32(),
    vx: t.f32(),
    vy: t.f32(),
    vz: t.f32(),
    /** POSE_FLAG_* (crouch, grounded, teleport) */
    flags: t.u8(),
    sendT: t.u32(),
  },
);

/** Private per-online-player combat state (never broadcast). */
const playerCombat = table(
  { name: 'player_combat' },
  {
    identity: t.identity().primaryKey(),
    slot: t.u32().unique(),
    ammo: t.u32(),
    reloading: t.bool(),
    reloadUntil: t.timestamp(),
    /** token bucket (see fireCreditsMax) */
    fireCredits: t.f32(),
    creditsAt: t.timestamp(),
    /** server time of the current player_pose row */
    poseAt: t.timestamp(),
    /** previous pose (favor-the-shooter hit validation) */
    px: t.f32(),
    py: t.f32(),
    pz: t.f32(),
    prevFlags: t.u8(),
    prevAt: t.timestamp(),
    dotDps: t.f32(),
    dotUntil: t.timestamp(),
    dotSource: t.identity(),
    dotWeaponId: t.u64(),
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

/** Private: recent projectile shots, used to validate report_hit. */
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

/**
 * Legacy: the old always-on 4 Hz tick. Kept only so the automatic migration doesn't have to drop
 * a table; rows are deleted on every connect and by `tick` itself, and never inserted.
 */
const tickTimer = table(
  { name: 'tick_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

/** One row per victim with an active damage-over-time effect (250 ms interval while it lasts). */
const dotTimer = table(
  { name: 'dot_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    target: t.identity().unique(),
  },
);

const spacetimedb = schema({
  player,
  playerPose,
  playerCombat,
  weapon,
  spawnPoint,
  shot,
  shotEvent,
  hitEvent,
  config,
  tickTimer,
  dotTimer,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type PlayerRow = NonNullable<ReturnType<Ctx['db']['player']['identity']['find']>>;
type PoseRow = NonNullable<ReturnType<Ctx['db']['playerPose']['slot']['find']>>;
type CombatRow = NonNullable<ReturnType<Ctx['db']['playerCombat']['identity']['find']>>;
type WeaponRow = NonNullable<ReturnType<Ctx['db']['weapon']['id']['find']>>;

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const DEFAULT_LLM_MODEL = 'claude-haiku-4-5-20251001';
const DOT_TICK_MICROS = 250_000n;
const SHOT_TTL_MICROS = 15_000_000n;
const EPOCH = new Timestamp(0n);
const RANGE_TOLERANCE_MULT = 1.2;
const RANGE_TOLERANCE_ADD = 2;
const MAX_ORIGIN_OFFSET = 4;
const MAX_COORD = 10_000;
/** max hit entries per fire call (shotguns report one entry per target, not per pellet) */
const MAX_HITS_PER_SHOT = 16;

const micros = (ts: Timestamp) => ts.microsSinceUnixEpoch;
const seconds = (ts: Timestamp) => Number(ts.microsSinceUnixEpoch) / 1e6;
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

const poseSample = (x: number, y: number, z: number, flags: number): PoseSample => ({
  x,
  y,
  z,
  crouching: (flags & POSE_FLAG_CROUCH) !== 0,
});

/** The victim's recent trajectory for hit validation (see sweptPoseAt). */
function sweptPose(ctx: Ctx, pose: PoseRow, c: CombatRow): SweptPose {
  return sweptPoseAt(
    poseSample(c.px, c.py, c.pz, c.prevFlags),
    seconds(c.prevAt),
    poseSample(pose.x, pose.y, pose.z, pose.flags),
    seconds(c.poseAt),
    seconds(ctx.timestamp),
    Math.hypot(pose.vx, pose.vy, pose.vz),
  );
}

/** Spawn point farthest from living enemies (random among the best 3 for variety). */
function pickSpawn(ctx: Ctx, forIdentity: Identity) {
  const points = [...ctx.db.spawnPoint.iter()];
  if (points.length === 0) {
    return { x: ctx.random() * 10 - 5, y: 2, z: ctx.random() * 10 - 5, yaw: 0 };
  }
  const enemies: { x: number; y: number; z: number }[] = [];
  for (const c of ctx.db.playerCombat.iter()) {
    if (c.identity.isEqual(forIdentity)) continue;
    const p = ctx.db.player.identity.find(c.identity);
    const pose = ctx.db.playerPose.slot.find(c.slot);
    if (p && p.alive && p.online && pose) enemies.push(pose);
  }
  const scored = points.map(sp => {
    let minD = Infinity;
    for (const e of enemies) minD = Math.min(minD, dist(sp.x, sp.y, sp.z, e.x, e.y, e.z));
    return { sp, score: enemies.length ? minD : ctx.random() };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(3, scored.length));
  return top[ctx.random.integerInRange(0, top.length - 1)].sp;
}

function deleteDotTimer(ctx: Ctx, target: Identity) {
  ctx.db.dotTimer.target.delete(target);
}

/**
 * (Re)spawn: full HP at a spawn point with `weaponId`. Updates the player row (with the spawn
 * position), the pose (flagged as a teleport so remotes snap) and the combat state.
 */
function spawnPlayer(ctx: Ctx, p: PlayerRow, weaponId: bigint): PlayerRow {
  const sp = pickSpawn(ctx, p.identity);
  const wRow = ctx.db.weapon.id.find(weaponId);
  const w = wRow ? parseWeapon(wRow) : undefined;
  const next: PlayerRow = {
    ...p,
    x: sp.x,
    y: sp.y,
    z: sp.z,
    yaw: sp.yaw,
    pitch: 0,
    hp: MAX_HP,
    alive: true,
    weaponId,
    respawnAt: EPOCH,
    slowPercent: 0,
    slowUntil: EPOCH,
  };
  const c = ctx.db.playerCombat.identity.find(p.identity);
  if (c) {
    const pose = ctx.db.playerPose.slot.find(c.slot);
    const flags = POSE_FLAG_GROUNDED | POSE_FLAG_TELEPORT;
    const poseRow: PoseRow = { slot: c.slot, x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, flags, sendT: pose?.sendT ?? 0 };
    if (pose) ctx.db.playerPose.slot.update(poseRow);
    else ctx.db.playerPose.insert(poseRow);
    ctx.db.playerCombat.identity.update({
      ...c,
      ammo: w ? w.magSize : 0,
      reloading: false,
      reloadUntil: EPOCH,
      fireCredits: w ? fireCreditsMax(effectiveFireRate(w)) : 1,
      creditsAt: ctx.timestamp,
      poseAt: ctx.timestamp,
      px: sp.x,
      py: sp.y,
      pz: sp.z,
      prevFlags: flags,
      prevAt: ctx.timestamp,
      dotDps: 0,
      dotUntil: EPOCH,
    });
  }
  deleteDotTimer(ctx, p.identity);
  return next;
}

/** Apply damage to a target; handles death, kill credit and the hit_event broadcast. Returns the updated target. */
function applyDamage(
  ctx: Ctx,
  target: PlayerRow,
  amount: number,
  attacker: Identity,
  weaponId: bigint,
  opts: {
    dot?: boolean;
    at?: [number, number, number];
    knock?: [number, number, number];
    slow?: number;
    headshot?: boolean;
    /** extra fields to write in the same player row update (e.g. slow) */
    patch?: Partial<PlayerRow>;
  } = {},
): PlayerRow {
  if (!target.alive || amount <= 0) return target;
  const hp = Math.max(0, target.hp - amount);
  const killed = hp <= 0;
  let next: PlayerRow = { ...target, ...(opts.patch ?? {}), hp };
  if (killed) {
    next = {
      ...next,
      alive: false,
      deaths: target.deaths + 1,
      respawnAt: addSeconds(ctx.timestamp, RESPAWN_DELAY_SECONDS),
      slowPercent: 0,
      slowUntil: EPOCH,
    };
    deleteDotTimer(ctx, target.identity);
  }
  ctx.db.player.identity.update(next);
  if (killed && !attacker.isEqual(target.identity)) {
    const killer = ctx.db.player.identity.find(attacker);
    if (killer) ctx.db.player.identity.update({ ...killer, kills: killer.kills + 1 });
  }
  const knock = opts.knock ?? [0, 0, 0];
  const at = opts.at ?? [target.x, target.y, target.z];
  ctx.db.hitEvent.insert({
    shooter: attacker,
    target: target.identity,
    weaponId,
    damage: amount,
    killed,
    dot: !!opts.dot,
    x: at[0],
    y: at[1],
    z: at[2],
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
  const presets = presetWeaponRows(ctx);
  if (presets.length === 0) {
    for (const cls of WEAPON_CLASSES) insertWeapon(ctx, ctx.sender, PRESET_WEAPONS[cls], `preset:${cls}`, true);
  }
  // Presets ship without parts: give each one the first part recipe for its class so it renders.
  if (PART_RECIPES.length > 0) {
    for (const row of presets.length ? presets : presetWeaponRows(ctx)) {
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
  // Migration: the old always-on 4 Hz tick is gone.
  for (const row of [...ctx.db.tickTimer.iter()]) ctx.db.tickTimer.scheduledId.delete(row.scheduledId);
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

/** Lowest slot >= 1 not used by an online player's combat row. */
function freeSlot(ctx: Ctx): number {
  const used = new Set<number>();
  for (const c of ctx.db.playerCombat.iter()) used.add(c.slot);
  let s = 1;
  while (used.has(s)) s++;
  return s;
}

function newCombatRow(ctx: Ctx, identity: Identity, slot: number): CombatRow {
  return {
    identity,
    slot,
    ammo: 0,
    reloading: false,
    reloadUntil: EPOCH,
    fireCredits: 1,
    creditsAt: ctx.timestamp,
    poseAt: ctx.timestamp,
    px: 0,
    py: 0,
    pz: 0,
    prevFlags: 0,
    prevAt: ctx.timestamp,
    dotDps: 0,
    dotUntil: EPOCH,
    dotSource: identity,
    dotWeaponId: 0n,
  };
}

export const onConnect = spacetimedb.clientConnected(ctx => {
  seedWorld(ctx);
  // combat row + pose slot for this connection (a stale row from an unclean disconnect is reused)
  let c = ctx.db.playerCombat.identity.find(ctx.sender);
  if (!c) c = ctx.db.playerCombat.insert(newCombatRow(ctx, ctx.sender, freeSlot(ctx)));
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    // the pose row reflects the stored spawn / last position until the client sends one
    if (!ctx.db.playerPose.slot.find(c.slot)) {
      ctx.db.playerPose.insert({
        slot: c.slot, x: existing.x, y: existing.y, z: existing.z, yaw: existing.yaw, pitch: 0,
        vx: 0, vy: 0, vz: 0, flags: POSE_FLAG_GROUNDED | POSE_FLAG_TELEPORT, sendT: 0,
      });
    }
    const p: PlayerRow = { ...existing, online: true, slot: c.slot };
    // returning players get their magazine back (combat state isn't kept while offline)
    if (p.alive && c.ammo === 0) {
      const wRow = ctx.db.weapon.id.find(p.weaponId);
      if (wRow) {
        const w = parseWeapon(wRow);
        ctx.db.playerCombat.identity.update({ ...c, ammo: w.magSize, fireCredits: fireCreditsMax(effectiveFireRate(w)) });
      }
    }
    ctx.db.player.identity.update(p);
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
    slot: c.slot,
  };
  // New players start with the preset pistol (later respawns without keepLoadout roll a random preset).
  ctx.db.player.insert(spawnPlayer(ctx, base, starterPresetId(ctx)));
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const c = ctx.db.playerCombat.identity.find(ctx.sender);
  const pose = c ? ctx.db.playerPose.slot.find(c.slot) : undefined;
  if (c) {
    ctx.db.playerPose.slot.delete(c.slot);
    ctx.db.playerCombat.identity.delete(ctx.sender);
  }
  deleteDotTimer(ctx, ctx.sender);
  for (const s of [...ctx.db.shot.by_shooter_seq.filter(ctx.sender)]) ctx.db.shot.id.delete(s.id);
  const p = ctx.db.player.identity.find(ctx.sender);
  if (p) {
    // player.x/y/z = resume point for a reconnect (the pose row is per connection)
    const at = pose && p.alive ? { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw } : {};
    ctx.db.player.identity.update({ ...p, ...at, online: false, slot: 0 });
  }
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

/**
 * Client-authoritative movement: position, look, velocity (m/s), POSE_FLAG_* flags and the
 * sender's clock (ms) for interpolation. Sent ~20 Hz while moving, immediately on discrete
 * changes (jump / land / crouch / stop), nothing while idle. Ignored while dead.
 */
export const update_transform = spacetimedb.reducer(
  {
    x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.f32(), pitch: t.f32(),
    vx: t.f32(), vy: t.f32(), vz: t.f32(), flags: t.u8(), sendT: t.u32(),
  },
  (ctx, { x, y, z, yaw, pitch, vx, vy, vz, flags, sendT }) => {
    finite(x, y, z, yaw, pitch, vx, vy, vz);
    const c = ctx.db.playerCombat.identity.find(ctx.sender);
    if (!c) throw new SenderError('not connected');
    const p = ctx.db.player.identity.find(ctx.sender);
    if (!p || !p.alive) return;
    const old = ctx.db.playerPose.slot.find(c.slot);
    const row: PoseRow = { slot: c.slot, x, y, z, yaw, pitch, vx, vy, vz, flags: flags & 0xff, sendT };
    if (old) {
      ctx.db.playerPose.slot.update(row);
      ctx.db.playerCombat.identity.update({ ...c, px: old.x, py: old.y, pz: old.z, prevFlags: old.flags, prevAt: c.poseAt, poseAt: ctx.timestamp });
    } else {
      ctx.db.playerPose.insert(row);
      ctx.db.playerCombat.identity.update({ ...c, px: x, py: y, pz: z, prevFlags: flags, prevAt: ctx.timestamp, poseAt: ctx.timestamp });
    }
  },
);

/** Start reloading the current weapon. */
export const reload = spacetimedb.reducer(ctx => {
  const p = requirePlayer(ctx);
  const c = ctx.db.playerCombat.identity.find(ctx.sender);
  if (!p.alive || !c || c.reloading) return;
  const wRow = ctx.db.weapon.id.find(p.weaponId);
  if (!wRow) return;
  const w = parseWeapon(wRow);
  if (w.fireMode === 'melee' || c.ammo >= w.magSize) return;
  ctx.db.playerCombat.identity.update({ ...c, reloading: true, reloadUntil: addSeconds(ctx.timestamp, w.reloadTime) });
});

/** One hit carried by `fire` (hitscan / stream / melee): which slot, zone, impact, pellets. */
const HitReport = t.object('HitReport', {
  slot: t.u32(),
  zone: t.u8(),
  ix: t.f32(),
  iy: t.f32(),
  iz: t.f32(),
  pellets: t.u8(),
});

interface ShotCtx {
  w: Weapon;
  weaponId: bigint;
  /** shot origin (eye) */
  o: [number, number, number];
}

/**
 * Validate and apply one hit of a shot. Direct hits: the impact must be on the victim's swept
 * hitbox (head only if claimed and plausible; otherwise body; otherwise rejected). Splash hits:
 * damage by distance from the blast point. Returns true if damage was applied.
 */
function applyHit(ctx: Ctx, s: ShotCtx, slot: number, zone: number, impact: [number, number, number], pellets: number): boolean {
  const vc = ctx.db.playerCombat.slot.find(slot);
  if (!vc || vc.identity.isEqual(ctx.sender)) return false;
  const victim = ctx.db.player.identity.find(vc.identity);
  const pose = ctx.db.playerPose.slot.find(slot);
  if (!victim || !victim.alive || !victim.online || !pose) return false;
  const { w, o } = s;
  const maxRange = w.range * RANGE_TOLERANCE_MULT + RANGE_TOLERANCE_ADD;
  const swept = sweptPose(ctx, pose, vc);

  let damage: number;
  let headshot = false;
  if (w.splashRadius > 0) {
    if (dist(o[0], o[1], o[2], impact[0], impact[1], impact[2]) > maxRange) return false;
    damage = splashDamageAt(w, splashDistance(swept, impact));
  } else {
    if (dist(o[0], o[1], o[2], pose.x, pose.y, pose.z) > maxRange) return false;
    const claimed = w.fireMode === 'stream' || w.fireMode === 'melee' ? 0 : zone;
    const z = classifyHit(swept, impact, claimed);
    if (z < 0) return false;
    headshot = z === HIT_ZONE_HEAD;
    const n = Math.max(1, Math.min(pellets, w.pellets));
    const d = dist(o[0], o[1], o[2], impact[0], impact[1], impact[2]);
    damage = zoneDamage(w, directHitDamage(w, n, d), z);
  }
  if (damage <= 0) return false;

  // Knockback away from the shooter (or blast centre).
  let knock: [number, number, number] = [0, 0, 0];
  if (w.knockback > 0) {
    const c = w.splashRadius > 0 ? impact : o;
    const len = Math.max(0.001, dist(pose.x, pose.y, pose.z, c[0], c[1], c[2]));
    knock = [((pose.x - c[0]) / len) * w.knockback, ((pose.y - c[1]) / len) * w.knockback + w.knockback * 0.3, ((pose.z - c[2]) / len) * w.knockback];
  }
  // Slow rides along in the same row update (refresh, don't stack); the client lets it expire.
  const patch: Partial<PlayerRow> = w.slowPercent > 0 ? { slowPercent: w.slowPercent, slowUntil: addSeconds(ctx.timestamp, SLOW_DURATION) } : {};
  const v = applyDamage(ctx, victim, damage, ctx.sender, s.weaponId, { at: impact, knock, slow: w.slowPercent, headshot, patch });
  if (v.alive && w.dotDamage > 0) {
    ctx.db.playerCombat.identity.update({
      ...vc,
      dotDps: w.dotDamage / Math.max(w.dotDuration, 0.5),
      dotUntil: addSeconds(ctx.timestamp, w.dotDuration),
      dotSource: ctx.sender,
      dotWeaponId: s.weaponId,
    });
    if (!ctx.db.dotTimer.target.find(vc.identity)) {
      ctx.db.dotTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(DOT_TICK_MICROS), target: vc.identity });
    }
  }
  return true;
}

/**
 * Fire one shot (one stream tick / one melee swing). `seq` is a client-chosen, per-player
 * increasing shot number (referenced by report_hit for projectiles). Origin/direction are
 * broadcast for remote visuals and used for range checks. Hitscan / stream / melee shots carry
 * their hits (`hits`, one entry per target); projectile / arc weapons report hits later via
 * report_hit. Shots that violate fire rate or ammo are silently dropped (with their hits).
 */
export const fire = spacetimedb.reducer(
  { seq: t.u32(), ox: t.f32(), oy: t.f32(), oz: t.f32(), dx: t.f32(), dy: t.f32(), dz: t.f32(), hits: t.array(HitReport) },
  (ctx, { seq, ox, oy, oz, dx, dy, dz, hits }) => {
    finite(ox, oy, oz, dx, dy, dz);
    const p = requirePlayer(ctx);
    if (!p.alive) return;
    let c = ctx.db.playerCombat.identity.find(ctx.sender);
    if (!c) return;
    const wRow = ctx.db.weapon.id.find(p.weaponId);
    if (!wRow) return;
    const w = parseWeapon(wRow);
    const now = ctx.timestamp;

    // Reload bookkeeping.
    if (c.reloading) {
      if (micros(now) < micros(c.reloadUntil)) return;
      c = { ...c, reloading: false, ammo: w.magSize };
    }
    const usesAmmo = w.fireMode !== 'melee';
    if (usesAmmo && c.ammo === 0) {
      ctx.db.playerCombat.identity.update({ ...c, reloading: true, reloadUntil: addSeconds(now, w.reloadTime) });
      return;
    }

    // Fire rate: token bucket (exact long-run rate, tolerates network bunching).
    const rate = effectiveFireRate(w);
    const spend = spendFireCredit(c.fireCredits, secondsBetween(c.creditsAt, now), rate);
    if (!spend.ok) {
      ctx.db.playerCombat.identity.update({ ...c, fireCredits: spend.credits, creditsAt: now });
      return;
    }

    // Origin must be near the player.
    const pose = ctx.db.playerPose.slot.find(c.slot);
    if (pose && dist(ox, oy, oz, pose.x, pose.y, pose.z) > MAX_ORIGIN_OFFSET) return;

    const projectile = w.fireMode === 'projectile' || w.fireMode === 'arc';
    // Projectile shots are remembered for report_hit; clean up this shooter's expired ones.
    for (const s of [...ctx.db.shot.by_shooter_seq.filter(ctx.sender)]) {
      if (micros(now) - micros(s.firedAt) > SHOT_TTL_MICROS) ctx.db.shot.id.delete(s.id);
      else if (s.seq === seq) return; // duplicate seq
    }

    let next: CombatRow = { ...c, fireCredits: spend.credits, creditsAt: now };
    if (usesAmmo) {
      const ammo = c.ammo - 1;
      next = ammo === 0 ? { ...next, ammo, reloading: true, reloadUntil: addSeconds(now, w.reloadTime) } : { ...next, ammo };
    }
    ctx.db.playerCombat.identity.update(next);
    if (projectile) {
      ctx.db.shot.insert({ id: 0n, shooter: ctx.sender, seq, weaponId: wRow.id, firedAt: now, ox, oy, oz, hitTargets: [] });
    }
    ctx.db.shotEvent.insert({ shooter: ctx.sender, seq, weaponId: wRow.id, ox, oy, oz, dx, dy, dz });

    if (projectile || hits.length === 0) return;
    const s: ShotCtx = { w, weaponId: wRow.id, o: [ox, oy, oz] };
    const done = new Set<number>();
    for (const h of hits.slice(0, MAX_HITS_PER_SHOT)) {
      if (done.has(h.slot)) continue;
      done.add(h.slot);
      finite(h.ix, h.iy, h.iz);
      applyHit(ctx, s, h.slot, h.zone, [h.ix, h.iy, h.iz], h.pellets);
    }
  },
);

/**
 * Projectile / arc weapons: report that shot `seq` hit the player in pose slot `slot`.
 * `pellets` = pellets that connected (use 1), (ix,iy,iz) = impact / blast point, `zone` = 0 body,
 * 1 head. Validated like fire hits, plus flight-time window and once per target per shot.
 */
export const report_hit = spacetimedb.reducer(
  { seq: t.u32(), slot: t.u32(), pellets: t.u32(), ix: t.f32(), iy: t.f32(), iz: t.f32(), zone: t.u8() },
  (ctx, { seq, slot, pellets, ix, iy, iz, zone }) => {
    finite(ix, iy, iz);
    requirePlayer(ctx);
    const s = [...ctx.db.shot.by_shooter_seq.filter([ctx.sender, seq])][0];
    if (!s) return;
    const vc = ctx.db.playerCombat.slot.find(slot);
    if (!vc || vc.identity.isEqual(ctx.sender)) return;
    if (s.hitTargets.some(h => h.isEqual(vc.identity))) return;
    const wRow = ctx.db.weapon.id.find(s.weaponId);
    if (!wRow) return;
    const w = parseWeapon(wRow);

    // Timing window: flight time + fuse (+ slack).
    const age = secondsBetween(s.firedAt, ctx.timestamp);
    const flight = w.projectileSpeed > 0 ? w.range / w.projectileSpeed : 0;
    const window = 1.5 + flight * (w.fireMode === 'arc' ? 2 : 1) + w.fuseTime;
    if (age > window) return;

    if (applyHit(ctx, { w, weaponId: wRow.id, o: [s.ox, s.oy, s.oz] }, slot, zone, [ix, iy, iz], pellets)) {
      ctx.db.shot.id.update({ ...s, hitTargets: [...s.hitTargets, vc.identity] });
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
// Scheduled: damage over time (only while a DoT is active), legacy tick
// ---------------------------------------------------------------------------

function requireScheduler(ctx: Ctx) {
  if (!ctx.sender.isEqual(ctx.identity)) throw new SenderError('scheduled reducer');
}

export const dot_tick = spacetimedb.reducer({ onSchedule: dotTimer }, { timer: dotTimer.rowType }, (ctx, { timer }) => {
  requireScheduler(ctx);
  const c = ctx.db.playerCombat.identity.find(timer.target);
  const p = ctx.db.player.identity.find(timer.target);
  const now = micros(ctx.timestamp);
  // this tick covers (now - 250 ms, now]; only the part before dotUntil deals damage
  const covered = c ? Number(micros(c.dotUntil) - (now - DOT_TICK_MICROS)) / 1e6 : 0;
  const seconds = Math.max(0, Math.min(Number(DOT_TICK_MICROS) / 1e6, covered));
  if (c && p && p.alive && c.dotDps > 0 && seconds > 0) {
    const pose = ctx.db.playerPose.slot.find(c.slot);
    const at: [number, number, number] = pose ? [pose.x, pose.y + 1, pose.z] : [p.x, p.y, p.z];
    applyDamage(ctx, p, c.dotDps * seconds, c.dotSource, c.dotWeaponId, { dot: true, at });
  }
  const alive = ctx.db.player.identity.find(timer.target)?.alive ?? false;
  if (!c || !alive || c.dotDps <= 0 || now >= micros(c.dotUntil)) {
    ctx.db.dotTimer.scheduledId.delete(timer.scheduledId);
    const cc = ctx.db.playerCombat.identity.find(timer.target);
    if (cc && cc.dotDps > 0) ctx.db.playerCombat.identity.update({ ...cc, dotDps: 0 });
  }
});

/** Legacy schedule target of tick_timer: just removes any leftover timer rows. */
export const tick = spacetimedb.reducer({ onSchedule: tickTimer }, { timer: tickTimer.rowType }, (ctx, { timer: _timer }) => {
  requireScheduler(ctx);
  for (const row of [...ctx.db.tickTimer.iter()]) ctx.db.tickTimer.scheduledId.delete(row.scheduledId);
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
