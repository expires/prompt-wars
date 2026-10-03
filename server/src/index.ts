// ai-gaem SpacetimeDB module (TypeScript, SpacetimeDB 2.x).
//
// Movement is client-authoritative: update_transform writes the sender's private `pose_state`;
// a coalescing one-shot `pose_flush` (every POSE_FLUSH_MS while anyone moves) copies changed
// poses into the small quantized public `pose` table (keyed by a u16 slot) in one transaction.
// Damage is server-authoritative: hitscan / stream / melee shots carry their hits in a single
// `fire` call; projectiles call `fire` and later `report_hit`. The server validates fire
// rate (token bucket), ammo, range and hit position (favor-the-shooter, swept over the victim's
// last <= 250 ms) against the *stored* weapon stats.
//
// Cost notes: there is no always-on scheduled reducer (pose_flush only runs while someone
// moves). Damage-over-time uses a per-victim `dot_timer` row that exists only while a DoT is active; slows expire client-side from
// `slowUntil`; expired `shot` rows are cleaned up inside `fire` for that shooter.

import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ScheduleAt, TimeDuration, Timestamp, type Identity } from 'spacetimedb';
import {
  MAX_HP,
  POSE_FLAG_CROUCH,
  POSE_FLAG_GROUNDED,
  POSE_FLAG_TELEPORT,
  POSE_FLAG_BLOCK,
  CROUCH_EYE_OFFSET,
  STAND_EYE_OFFSET,
  MELEE_ORIGIN_TOLERANCE,
  blockCovers,
  grantedCharge,
  isMeleeReachValid,
  meleeHitDamage,
  meleeKnockback,
  meleeMetaOf,
  meleeReach,
  parseTemplateSummaries,
  templateToRawWeapon,
  type TemplateSummary,
  PRESET_WEAPONS,
  RESPAWN_DELAY_SECONDS,
  SLOW_DURATION,
  WEAPON_CLASSES,
  WEAPON_GEN_SYSTEM,
  activeMap,
  buildWeaponGenUserPrompt,
  chooseClassFromPrompt,
  clampWeapon,
  classifyHit,
  directHitDamage,
  effectiveFireRate,
  effectiveSpawns,
  filterCatalogForClass,
  filterKnownParts,
  fireCreditsMax,
  HIT_ZONE_HEAD,
  zoneDamage,
  parseJsonObject,
  randomRawWeapon,
  spendFireCredit,
  spawnSetsEqual,
  splashDamageAt,
  splashDistance,
  sweptPoseAt,
  type PoseSample,
  type SweptPose,
  type Weapon,
  FORGE_LIMITS,
  designToWeapon,
  sanitizeDesign,
  elementCode,
  elementFromCode,
  slowDurationFor,
  stackedSlow,
  packPose,
  packedPoseEqual,
  POSE_FLUSH_MS,
  type PoseFloats,
  censorText,
  normalizePrompt,
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
    /** spawn position (set on respawn); live position is in pose / pose_state */
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
    /**
     * Public end of the active damage-over-time effect (burning / poisoned visuals; the DoT itself
     * lives in player_combat). Its element is `dotElement`.
     */
    dotUntil: t.timestamp(),
    /** legacy (now player_combat) */
    dotSource: t.identity(),
    /** legacy (now player_combat) */
    dotWeaponId: t.u64(),
    /** legacy (now pose.flags) */
    crouching: t.bool().default(false),
    /** pose key while online (0 = none). Assigned on connect, reused by others when offline. */
    slot: t.u32().default(0),
    /**
     * Forging: true for a new player until they have a weapon (register_design / equip_weapon /
     * generate_weapon while dead). Such players stay dead (alive = false) and can't respawn.
     */
    needsLoadout: t.bool().default(false),
    /** element code (@ai-gaem/shared ELEMENT_CODE, 0 = none) of the DoT active until dotUntil (fire = burning) */
    dotElement: t.u8().default(0),
    /** element code of the slow active until slowUntil (ice = chilled, shock = shocked) */
    slowElement: t.u8().default(0),
  },
);

/**
 * Legacy f32 pose table (replaced by the quantized `pose` + private `pose_state`). Kept only so
 * the automatic migration doesn't have to drop a table; emptied on connect, never written.
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

/**
 * Hot, small, public: one quantized row per online player (@ai-gaem/shared packPose: cm
 * positions, u16 yaw, cm/s velocities; 23 bytes). Written ONLY by the coalescing `pose_flush`
 * (and by spawns / connects), so all poses that changed within POSE_FLUSH_MS reach subscribers in
 * one transaction. sendT = sender's clock (ms, wraps) for jitter-free interpolation.
 */
const pose = table(
  { name: 'pose', public: true },
  {
    slot: t.u16().primaryKey(),
    x: t.i16(),
    y: t.i16(),
    z: t.i16(),
    yaw: t.u16(),
    pitch: t.i16(),
    vx: t.i16(),
    vy: t.i16(),
    vz: t.i16(),
    /** POSE_FLAG_* (crouch, grounded, teleport, block) */
    flags: t.u8(),
    sendT: t.u32(),
  },
);

/**
 * Private, authoritative per-online-player pose (full precision), written by update_transform
 * (the only per-update server work: one find + one update of this row). Also holds what hit
 * validation needs: the current pose with its server time and an "anchor" (an older pose, at
 * most ~POSE_ANCHOR_MS + one send interval old) so shots are checked against the swept segment
 * anchor -> current. `alive` mirrors player.alive so update_transform needn't read the player row.
 */
const poseState = table(
  { name: 'pose_state' },
  {
    identity: t.identity().primaryKey(),
    slot: t.u32().unique(),
    alive: t.bool(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    yaw: t.f32(),
    pitch: t.f32(),
    vx: t.f32(),
    vy: t.f32(),
    vz: t.f32(),
    flags: t.u8(),
    sendT: t.u32(),
    /** server time of the current pose */
    poseAt: t.timestamp(),
    ax: t.f32(),
    ay: t.f32(),
    az: t.f32(),
    aflags: t.u8(),
    anchorAt: t.timestamp(),
  },
);

/** One-shot pose flush (see POSE_FLUSH_MS); at most one row exists. */
const poseFlushTimer = table(
  { name: 'pose_flush_timer' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
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
    /** legacy (now pose_state.poseAt) */
    poseAt: t.timestamp(),
    /** legacy (now the pose_state anchor) */
    px: t.f32(),
    py: t.f32(),
    pz: t.f32(),
    prevFlags: t.u8(),
    prevAt: t.timestamp(),
    dotDps: t.f32(),
    dotUntil: t.timestamp(),
    dotSource: t.identity(),
    dotWeaponId: t.u64(),
    /** server time of the last accepted melee swing (bounds the claimed charge of the next one) */
    lastSwingAt: t.timestamp().default(new Timestamp(0n)),
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
    /**
     * Forge design JSON (@ai-gaem/shared `ForgeDesign`, sanitized; '' for legacy / preset weapons).
     * When set, clients render the design instead of `json.parts`; `json` stays the balanced
     * Weapon used for all gameplay (its stats always equal the design's).
     */
    design: t.string().default(''),
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
    /** melee: granted charge fraction (0 = normal swing) */
    charge: t.f32().default(0),
    /** melee: slash combo index (0..2) */
    combo: t.u8().default(0),
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
    /** melee hit reduced by the target's block */
    blocked: t.bool().default(false),
    /** element code of the hit (weapon element; DoT ticks: the DoT's element), 0 = none */
    element: t.u8().default(0),
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

/**
 * Prompt cache ("First forged by X"): one row per normalized prompt (@ai-gaem/shared
 * normalizePrompt), pointing at the first design forged from it. Clients look a prompt up here and
 * reuse that design instantly (use_forged) instead of forging again.
 */
const forgedPrompt = table(
  { name: 'forged_prompt', public: true },
  {
    norm: t.string().primaryKey(),
    designId: t.u64().index('btree'),
    firstBy: t.identity(),
    firstName: t.string(),
    at: t.timestamp(),
    /** times this prompt was forged or reused (incl. the first) */
    uses: t.u32(),
  },
);

const spacetimedb = schema({
  player,
  playerPose,
  pose,
  poseState,
  poseFlushTimer,
  playerCombat,
  weapon,
  spawnPoint,
  shot,
  shotEvent,
  hitEvent,
  config,
  tickTimer,
  dotTimer,
  forgedPrompt,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type PlayerRow = NonNullable<ReturnType<Ctx['db']['player']['identity']['find']>>;
type PoseStateRow = NonNullable<ReturnType<Ctx['db']['poseState']['identity']['find']>>;
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

function insertWeapon(ctx: Ctx, owner: Identity, w: Weapon, prompt: string, isPreset: boolean, design = ''): WeaponRow {
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
    design,
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

/** The victim's recent trajectory for hit validation (see sweptPoseAt): anchor -> current pose. */
function sweptPose(ctx: Ctx, s: PoseStateRow): SweptPose {
  return sweptPoseAt(
    poseSample(s.ax, s.ay, s.az, s.aflags),
    seconds(s.anchorAt),
    poseSample(s.x, s.y, s.z, s.flags),
    seconds(s.poseAt),
    seconds(ctx.timestamp),
    Math.hypot(s.vx, s.vy, s.vz),
  );
}

/** Write the quantized public pose row for `slot` (no-op if unchanged after quantization). */
function publishPose(ctx: Ctx, slot: number, p: PoseFloats) {
  const row = packPose(slot, p);
  const cur = ctx.db.pose.slot.find(row.slot);
  if (!cur) ctx.db.pose.insert(row);
  else if (!packedPoseEqual(cur, row)) ctx.db.pose.slot.update(row);
}

/**
 * Server-side pose write (connect / spawn): private state (anchor reset: no sweep across a
 * teleport) and the public row in the same transaction. Keeps the sender clock (sendT) as is.
 */
function setPose(ctx: Ctx, identity: Identity, slot: number, at: { x: number; y: number; z: number; yaw: number }, flags: number, alive: boolean) {
  const old = ctx.db.poseState.identity.find(identity);
  const p: PoseFloats = { x: at.x, y: at.y, z: at.z, yaw: at.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, flags, sendT: old?.sendT ?? 0 };
  const now = ctx.timestamp;
  const row: PoseStateRow = { identity, slot, alive, ...p, poseAt: now, ax: p.x, ay: p.y, az: p.z, aflags: flags, anchorAt: now };
  if (old) ctx.db.poseState.identity.update(row);
  else ctx.db.poseState.insert(row);
  publishPose(ctx, slot, p);
}

/** Mirror player.alive into pose_state (update_transform ignores dead players without reading `player`). */
function setPoseAlive(ctx: Ctx, identity: Identity, alive: boolean) {
  const s = ctx.db.poseState.identity.find(identity);
  if (s && s.alive !== alive) ctx.db.poseState.identity.update({ ...s, alive });
}

/** Spawn point farthest from living enemies (random among the best 3 for variety). */
function pickSpawn(ctx: Ctx, forIdentity: Identity) {
  const points = [...ctx.db.spawnPoint.iter()];
  if (points.length === 0) {
    return { x: ctx.random() * 10 - 5, y: 2, z: ctx.random() * 10 - 5, yaw: 0 };
  }
  const enemies: { x: number; y: number; z: number }[] = [];
  for (const s of ctx.db.poseState.iter()) {
    if (s.alive && !s.identity.isEqual(forIdentity)) enemies.push(s);
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
    slowElement: 0,
    dotUntil: EPOCH,
    dotElement: 0,
  };
  const c = ctx.db.playerCombat.identity.find(p.identity);
  if (c) {
    setPose(ctx, p.identity, c.slot, sp, POSE_FLAG_GROUNDED | POSE_FLAG_TELEPORT, true);
    ctx.db.playerCombat.identity.update({
      ...c,
      ammo: w ? w.magSize : 0,
      reloading: false,
      reloadUntil: EPOCH,
      fireCredits: w ? fireCreditsMax(effectiveFireRate(w)) : 1,
      creditsAt: ctx.timestamp,
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
    blocked?: boolean;
    /** element code (hit_event.element) */
    element?: number;
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
      slowElement: 0,
      dotUntil: EPOCH,
      dotElement: 0,
    };
    deleteDotTimer(ctx, target.identity);
    setPoseAlive(ctx, target.identity, false);
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
    blocked: !!opts.blocked,
    element: opts.element ?? 0,
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
  // Spawn points: keep the stored set in sync with the active map (ACTIVE_MAP_ID in
  // @ai-gaem/shared). Any mismatch is replaced wholesale, which also migrates older
  // sets such as the original placeholder ring.
  const activeSpawns = effectiveSpawns(activeMap());
  const points = [...ctx.db.spawnPoint.iter()];
  if (!spawnSetsEqual(points, activeSpawns)) {
    for (const p of points) ctx.db.spawnPoint.id.delete(p.id);
    for (const sp of activeSpawns) ctx.db.spawnPoint.insert({ id: 0n, x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw });
  }
  // Migration: the old always-on 4 Hz tick is gone.
  for (const row of [...ctx.db.tickTimer.iter()]) ctx.db.tickTimer.scheduledId.delete(row.scheduledId);
  // Migration: poses moved to the quantized `pose` table (+ private pose_state).
  for (const row of [...ctx.db.playerPose.iter()]) ctx.db.playerPose.slot.delete(row.slot);
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
    lastSwingAt: EPOCH,
  };
}

export const onConnect = spacetimedb.clientConnected(ctx => {
  seedWorld(ctx);
  // combat row + pose slot for this connection (a stale row from an unclean disconnect is reused)
  let c = ctx.db.playerCombat.identity.find(ctx.sender);
  if (!c) c = ctx.db.playerCombat.insert(newCombatRow(ctx, ctx.sender, freeSlot(ctx)));
  const existing = ctx.db.player.identity.find(ctx.sender);
  if (existing) {
    // the pose reflects the stored spawn / last position until the client sends one
    if (!ctx.db.poseState.identity.find(ctx.sender)) setPose(ctx, ctx.sender, c.slot, existing, POSE_FLAG_GROUNDED | POSE_FLAG_TELEPORT, existing.alive);
    else setPoseAlive(ctx, ctx.sender, existing.alive);
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
    needsLoadout: true,
    dotElement: 0,
    slowElement: 0,
  };
  // New players start dead with no weapon ("forging"): they respawn once they have registered a
  // design (register_design) or equipped a preset. The pose row parks them at a spawn point.
  const sp = pickSpawn(ctx, ctx.sender);
  ctx.db.player.insert({ ...base, x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw });
  setPose(ctx, ctx.sender, c.slot, sp, POSE_FLAG_GROUNDED | POSE_FLAG_TELEPORT, false);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const c = ctx.db.playerCombat.identity.find(ctx.sender);
  const pose = ctx.db.poseState.identity.find(ctx.sender);
  if (pose) {
    ctx.db.poseState.identity.delete(ctx.sender);
    ctx.db.pose.slot.delete(pose.slot & 0xffff);
  }
  if (c) {
    if (!pose || pose.slot !== c.slot) ctx.db.pose.slot.delete(c.slot & 0xffff);
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
  const clean = censorText(name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24));
  if (!clean) throw new SenderError('name must not be empty');
  const p = requirePlayer(ctx);
  ctx.db.player.identity.update({ ...p, name: clean });
});

/** How old the hit-validation anchor may get before it is moved up to the previous pose. */
const POSE_ANCHOR_MICROS = 100_000n;
const POSE_FLUSH_MICROS = BigInt(POSE_FLUSH_MS * 1000);

/**
 * Client-authoritative movement: position, look, velocity (m/s), POSE_FLAG_* flags and the
 * sender's clock (ms) for interpolation. Sent at 60 Hz while moving (30 Hz when nobody is near /
 * crowded server), immediately on discrete changes (jump / land / crouch / stop), nothing while
 * idle. Ignored while dead.
 *
 * Kept minimal on purpose (this runs N x 60 times a second): one find + one update of the
 * sender's private pose_state row, plus scheduling the coalescing pose_flush if none is pending.
 * Nothing is broadcast from here.
 */
export const update_transform = spacetimedb.reducer(
  {
    x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.f32(), pitch: t.f32(),
    vx: t.f32(), vy: t.f32(), vz: t.f32(), flags: t.u8(), sendT: t.u32(),
  },
  (ctx, { x, y, z, yaw, pitch, vx, vy, vz, flags, sendT }) => {
    finite(x, y, z, yaw, pitch, vx, vy, vz);
    let s = ctx.db.poseState.identity.find(ctx.sender);
    if (!s) {
      // connected before pose_state existed (module update while online): create it lazily
      const c = ctx.db.playerCombat.identity.find(ctx.sender);
      const p = ctx.db.player.identity.find(ctx.sender);
      if (!c || !p) throw new SenderError('not connected');
      setPose(ctx, ctx.sender, c.slot, { x, y, z, yaw }, flags & 0xff, p.alive);
      s = ctx.db.poseState.identity.find(ctx.sender)!;
    }
    if (!s.alive) return;
    const now = ctx.timestamp;
    const f = flags & 0xff;
    const next: PoseStateRow = { ...s, x, y, z, yaw, pitch, vx, vy, vz, flags: f, sendT, poseAt: now };
    if ((f & POSE_FLAG_TELEPORT) !== 0) {
      // discontinuity: no sweep across it
      next.ax = x;
      next.ay = y;
      next.az = z;
      next.aflags = f;
      next.anchorAt = now;
    } else if (micros(now) - micros(s.anchorAt) > POSE_ANCHOR_MICROS) {
      next.ax = s.x;
      next.ay = s.y;
      next.az = s.z;
      next.aflags = s.flags;
      next.anchorAt = s.poseAt;
    }
    ctx.db.poseState.identity.update(next);
    if (ctx.db.poseFlushTimer.count() === 0n) {
      ctx.db.poseFlushTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(micros(now) + POSE_FLUSH_MICROS) });
    }
  },
);

/**
 * Coalesced broadcast: copy every pose_state that changed since the last flush into the public
 * `pose` table (quantized), all in this one transaction. Scheduled one-shot by update_transform,
 * so it runs at most every POSE_FLUSH_MS while anyone moves and never while everyone is idle.
 */
export const pose_flush = spacetimedb.reducer({ onSchedule: poseFlushTimer }, { timer: poseFlushTimer.rowType }, (ctx, { timer }) => {
  requireScheduler(ctx);
  ctx.db.poseFlushTimer.scheduledId.delete(timer.scheduledId);
  for (const s of ctx.db.poseState.iter()) {
    if (s.alive) publishPose(ctx, s.slot, s);
  }
});

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
  /** melee: granted charge fraction */
  charge?: number;
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
  const pose = ctx.db.poseState.identity.find(vc.identity);
  if (!victim || !victim.alive || !victim.online || !pose) return false;
  const { w, o } = s;
  const maxRange = w.range * RANGE_TOLERANCE_MULT + RANGE_TOLERANCE_ADD;
  const swept = sweptPose(ctx, pose);

  let damage: number;
  let headshot = false;
  let blocked = false;
  let knockSpeed = w.knockback;
  if (w.fireMode === 'melee') {
    // reach (eye -> impact, charged reach + tolerance) and the impact on the swept hitbox
    const charge = s.charge ?? 0;
    if (!isMeleeReachValid(o, impact, meleeReach(w, charge))) return false;
    const z = classifyHit(swept, impact, zone);
    if (z < 0) return false;
    headshot = z === HIT_ZONE_HEAD;
    // block: the victim holds a melee weapon, has the block flag set and faces the attacker
    if ((pose.flags & POSE_FLAG_BLOCK) !== 0 && blockCovers([pose.x, pose.y, pose.z], pose.yaw, o)) {
      const vw = ctx.db.weapon.id.find(victim.weaponId);
      blocked = !!vw && vw.fireMode === 'melee';
    }
    damage = meleeHitDamage(w, charge, z, blocked);
    knockSpeed = blocked ? 0 : meleeKnockback(w, charge, meleeMetaOf(w).weight);
  } else if (w.splashRadius > 0) {
    if (dist(o[0], o[1], o[2], impact[0], impact[1], impact[2]) > maxRange) return false;
    damage = splashDamageAt(w, splashDistance(swept, impact));
  } else {
    if (dist(o[0], o[1], o[2], pose.x, pose.y, pose.z) > maxRange) return false;
    const claimed = w.fireMode === 'stream' ? 0 : zone;
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
  if (knockSpeed > 0) {
    const c = w.splashRadius > 0 ? impact : o;
    const len = Math.max(0.001, dist(pose.x, pose.y, pose.z, c[0], c[1], c[2]));
    knock = [((pose.x - c[0]) / len) * knockSpeed, ((pose.y - c[1]) / len) * knockSpeed + knockSpeed * 0.3, ((pose.z - c[2]) / len) * knockSpeed];
  }
  // Elemental / slow / DoT state rides along in the same player row update; the client lets it
  // expire. Slows refresh (ice stacks up to 60 %, shock is brief); DoTs refresh, never stack.
  const element = w.element ?? null;
  const code = elementCode(element);
  const now = ctx.timestamp;
  const patch: Partial<PlayerRow> = {};
  let slow = 0;
  if (w.slowPercent > 0) {
    const activeLeft = micros(victim.slowUntil) - micros(now);
    const active = activeLeft > 0n && victim.slowPercent > 0 ? { percent: victim.slowPercent, element: elementFromCode(victim.slowElement) } : null;
    const dur = slowDurationFor(element);
    slow = stackedSlow(element, w.slowPercent, active);
    // a brief shock never shortens a stronger, longer slow already running
    const keep = active && active.percent >= slow && Number(activeLeft) / 1e6 > dur;
    if (!keep) {
      patch.slowPercent = slow;
      patch.slowUntil = addSeconds(now, element === 'ice' || element === 'shock' ? dur : SLOW_DURATION);
      patch.slowElement = element === 'ice' || element === 'shock' ? code : 0;
    } else slow = active.percent;
  }
  if (w.dotDamage > 0) {
    patch.dotUntil = addSeconds(now, w.dotDuration);
    patch.dotElement = element === 'fire' || element === 'poison' ? code : 0;
  }
  const v = applyDamage(ctx, victim, damage, ctx.sender, s.weaponId, { at: impact, knock, slow, headshot, blocked, patch, element: code });
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
  {
    seq: t.u32(), ox: t.f32(), oy: t.f32(), oz: t.f32(), dx: t.f32(), dy: t.f32(), dz: t.f32(), hits: t.array(HitReport),
    charge: t.f32(), combo: t.u8(),
  },
  (ctx, { seq, ox, oy, oz, dx, dy, dz, hits, charge, combo }) => {
    finite(ox, oy, oz, dx, dy, dz);
    if (!Number.isFinite(charge)) charge = 0;
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

    // Origin must be near the player (melee: near the eye).
    const pose = ctx.db.poseState.identity.find(ctx.sender);
    if (pose && dist(ox, oy, oz, pose.x, pose.y, pose.z) > MAX_ORIGIN_OFFSET) return;
    const melee = w.fireMode === 'melee';
    if (melee && pose) {
      const eyeY = pose.y + ((pose.flags & POSE_FLAG_CROUCH) !== 0 ? CROUCH_EYE_OFFSET : STAND_EYE_OFFSET);
      const tol = MELEE_ORIGIN_TOLERANCE + Math.hypot(pose.vx, pose.vy, pose.vz) * 0.15;
      if (dist(ox, oy, oz, pose.x, eyeY, pose.z) > tol) return;
    }
    // Melee charge: bounded by the time since the previous swing (it had to be held that long).
    const granted = melee ? grantedCharge(charge, secondsBetween(c.lastSwingAt, now)) : 0;

    const projectile = w.fireMode === 'projectile' || w.fireMode === 'arc';
    // Projectile shots are remembered for report_hit; clean up this shooter's expired ones.
    for (const s of [...ctx.db.shot.by_shooter_seq.filter(ctx.sender)]) {
      if (micros(now) - micros(s.firedAt) > SHOT_TTL_MICROS) ctx.db.shot.id.delete(s.id);
      else if (s.seq === seq) return; // duplicate seq
    }

    let next: CombatRow = { ...c, fireCredits: spend.credits, creditsAt: now, ...(melee ? { lastSwingAt: now } : {}) };
    if (usesAmmo) {
      const ammo = c.ammo - 1;
      next = ammo === 0 ? { ...next, ammo, reloading: true, reloadUntil: addSeconds(now, w.reloadTime) } : { ...next, ammo };
    }
    ctx.db.playerCombat.identity.update(next);
    if (projectile) {
      ctx.db.shot.insert({ id: 0n, shooter: ctx.sender, seq, weaponId: wRow.id, firedAt: now, ox, oy, oz, hitTargets: [] });
    }
    ctx.db.shotEvent.insert({ shooter: ctx.sender, seq, weaponId: wRow.id, ox, oy, oz, dx, dy, dz, charge: granted, combo: melee ? combo % 3 : 0 });

    if (projectile || hits.length === 0) return;
    const s: ShotCtx = { w, weaponId: wRow.id, o: [ox, oy, oz], charge: granted };
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
  if (p.needsLoadout || !ctx.db.weapon.id.find(p.weaponId)) {
    throw new SenderError('forge a weapon first (register_design or equip_weapon)');
  }
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
  ctx.db.player.identity.update({ ...p, weaponId, needsLoadout: false });
});

/**
 * Store a Forge design (JSON of @ai-gaem/shared `ForgeDesign`, e.g. from the forge service).
 * Always re-sanitized here (sizes, triangle budget, unknown catalog parts, balance via clampWeapon).
 * The new weapon is equipped when the caller is dead (incl. new "forging" players and after
 * request_redeploy); otherwise it is only added to their library (equip_weapon later).
 * Clients find it by owner (`weapon.ownerIdentity`) or, when equipped, via `player.weaponId`.
 */
export const register_design = spacetimedb.reducer(
  { designJson: t.string(), prompt: t.string(), fresh: t.bool() },
  (ctx, { designJson, prompt, fresh }) => {
    if (designJson.length > FORGE_LIMITS.maxDesignJson) throw new SenderError('design json too large');
    const p = requirePlayer(ctx);
    let raw: unknown;
    try {
      raw = JSON.parse(designJson);
    } catch {
      throw new SenderError('invalid json');
    }
    const { design } = sanitizeDesign(raw, { knownPartIds: KNOWN_PART_IDS });
    if (design.components.length === 0) throw new SenderError('design has no usable components');
    // locked flags are editor state, not part of the stored weapon
    for (const c of design.components) delete c.locked;
    if (design.projectile) delete design.projectile.locked;
    // profanity: weapon / part names are broadcast to everyone
    design.name = censorText(design.name);
    for (const c of design.components) c.label = censorText(c.label);
    if (design.projectile) design.projectile.label = censorText(design.projectile.label);
    const cleanPrompt = censorText(prompt.replace(/[\u0000-\u001f]/g, ' ').trim());
    const w = designToWeapon(design);
    const row = insertWeapon(ctx, ctx.sender, w, cleanPrompt, false, JSON.stringify(design));
    if (!p.alive) ctx.db.player.identity.update({ ...p, weaponId: row.id, needsLoadout: false });
    // prompt cache: a design forged straight from a prompt (no previous design / locks / rejects)
    const norm = normalizePrompt(cleanPrompt);
    if (fresh && norm) {
      const fp = ctx.db.forgedPrompt.norm.find(norm);
      if (!fp) ctx.db.forgedPrompt.insert({ norm, designId: row.id, firstBy: ctx.sender, firstName: p.name, at: ctx.timestamp, uses: 1 });
      else ctx.db.forgedPrompt.norm.update({ ...fp, uses: fp.uses + 1 });
    }
  },
);

/**
 * Reuse the cached first design of a prompt (forged_prompt) instead of forging it again: counts a
 * use and, while dead, equips that weapon row (shared, owned by the first forger).
 */
export const use_forged = spacetimedb.reducer({ norm: t.string() }, (ctx, { norm }) => {
  const p = requirePlayer(ctx);
  const fp = ctx.db.forgedPrompt.norm.find(normalizePrompt(norm));
  if (!fp) throw new SenderError('unknown prompt');
  if (!ctx.db.weapon.id.find(fp.designId)) throw new SenderError('design is gone');
  ctx.db.forgedPrompt.norm.update({ ...fp, uses: fp.uses + 1 });
  if (!p.alive) ctx.db.player.identity.update({ ...p, weaponId: fp.designId, needsLoadout: false });
});

/**
 * Esc menu "redeploy": die on the spot (no killer credit) so the loadout can be changed, then
 * respawn after RESPAWN_DELAY_SECONDS. Free at full HP; when already damaged it counts as a death
 * (so it can't be used to deny a kill).
 */
export const request_redeploy = spacetimedb.reducer(ctx => {
  const p = requirePlayer(ctx);
  if (!p.alive) return;
  const damaged = p.hp < MAX_HP;
  ctx.db.player.identity.update({
    ...p,
    alive: false,
    deaths: damaged ? p.deaths + 1 : p.deaths,
    respawnAt: addSeconds(ctx.timestamp, RESPAWN_DELAY_SECONDS),
    slowPercent: 0,
    slowUntil: EPOCH,
    slowElement: 0,
    dotUntil: EPOCH,
    dotElement: 0,
  });
  deleteDotTimer(ctx, p.identity);
  setPoseAlive(ctx, p.identity, false);
  const c = ctx.db.playerCombat.identity.find(p.identity);
  if (c && c.dotDps > 0) ctx.db.playerCombat.identity.update({ ...c, dotDps: 0 });
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
    w.name = censorText(w.name);
    w.parts = filterKnownParts(w.parts, KNOWN_PART_IDS);
    if (w.parts.length === 0) w.parts = recipePartsFor(w.class, ctx.random());
    insertWeapon(ctx, ctx.sender, w, censorText(prompt), false);
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
    const pose = ctx.db.poseState.identity.find(timer.target);
    const at: [number, number, number] = pose ? [pose.x, pose.y + 1, pose.z] : [p.x, p.y, p.z];
    applyDamage(ctx, p, c.dotDps * seconds, c.dotSource, c.dotWeaponId, { dot: true, at, element: p.dotElement });
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

/** Client-provided templates with unknown part ids removed (templates left with no parts are dropped). */
function knownTemplates(json: string): TemplateSummary[] {
  return parseTemplateSummaries(json)
    .map(tp => ({ ...tp, parts: filterKnownParts(tp.parts, KNOWN_PART_IDS) }))
    .filter(tp => tp.parts.length > 0);
}

/**
 * Generate a weapon from a text prompt. `weaponClass` may be '' to infer it from the prompt (or
 * from the best template). `templatesJson`: up to 5 matching @ai-gaem/parts templates found by
 * the client (searchTemplates), as compact JSON summaries (see shared/src/templates.ts); they are
 * few-shot examples for the LLM and, without an API key, the best one becomes the weapon.
 * Calls Anthropic if an API key is configured (set_api_key), otherwise uses a template / random
 * stats. The result is clamped, stored in `weapon`, and auto-equipped if the caller is dead.
 */
export const generate_weapon = spacetimedb.procedure(
  { prompt: t.string(), weaponClass: t.string(), templatesJson: t.string() },
  GenerateResult,
  (ctx, { prompt, weaponClass, templatesJson }) => {
    const cleanPrompt = censorText(prompt.slice(0, 300));
    const allTemplates = knownTemplates(templatesJson);
    const setup = ctx.withTx(tx => {
      const cfg = tx.db.config.id.find(0);
      const cls = weaponClass.trim() || !allTemplates.length
        ? chooseClassFromPrompt(cleanPrompt, weaponClass, () => tx.random())
        : allTemplates[0].class;
      const seed = tx.random();
      const recipeRoll = tx.random();
      return { recipeRoll, apiKey: cfg?.anthropicApiKey ?? '', model: cfg?.llmModel || DEFAULT_LLM_MODEL, cls, seed };
    });

    const templates = allTemplates.filter(tp => tp.class === setup.cls);
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
            messages: [{ role: 'user', content: buildWeaponGenUserPrompt(setup.cls, cleanPrompt, subset, templates) }],
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
      if (templates.length) {
        // best matching template: class preset stats scaled by its hints, its parts + melee meta
        raw = templateToRawWeapon(templates[0]);
        message = message === 'ok' ? `template ${templates[0].id}` : `${message} (template ${templates[0].id})`;
      } else {
        let s = setup.seed * 2147483646 + 1;
        const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        raw = randomRawWeapon(setup.cls, cleanPrompt, rnd);
      }
    } else {
      // Keep the class we chose (and pre-filtered parts for) unless the LLM picked a valid one.
      const r = raw as Record<string, unknown>;
      if (!r.class) r.class = setup.cls;
      // melee without animation metadata: borrow the closest melee template's
      if (!r.melee) {
        const mt = allTemplates.find(tp => tp.melee && tp.class === r.class);
        if (mt) r.melee = mt.melee;
      }
    }

    const w = clampWeapon(raw);
    w.name = censorText(w.name);
    w.parts = filterKnownParts(w.parts, KNOWN_PART_IDS);
    if (w.parts.length === 0) w.parts = recipePartsFor(w.class, setup.recipeRoll);

    const weaponId = ctx.withTx(tx => {
      const row = insertWeapon(tx, ctx.sender, w, cleanPrompt, false);
      const p = tx.db.player.identity.find(ctx.sender);
      if (p && !p.alive) tx.db.player.identity.update({ ...p, weaponId: row.id, needsLoadout: false });
      return row.id;
    });
    return { ok: true, weaponId, message };
  },
);
