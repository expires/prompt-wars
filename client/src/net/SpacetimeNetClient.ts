import { POSE_FLAG_BLOCK, POSE_FLAG_CROUCH, POSE_FLAG_GROUNDED, POSE_FLAG_TELEPORT, clampWeapon, type ForgeDesign } from '@ai-gaem/shared';
import { templatesJsonFor } from '../weapons/templates';
import type { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../module_bindings';
import type { Weapon } from '../weapons/types';
import type {
  GenerateWeaponResult,
  HitConfirmEvent,
  HitInfo,
  KillEvent,
  LocalHitEvent,
  LocalPose,
  NetClient,
  NetPlayer,
  NetStats,
  PoseSnapshot,
  ShotEvent,
  Vec3,
} from './NetClient';

type Listener<T> = (v: T) => void;

/** Row shapes as delivered by the generated bindings (only the fields we use). */
interface PlayerRow {
  identity: Identity;
  name: string;
  online: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  weaponId: bigint;
  respawnAt: { toMillis(): bigint };
  slowPercent: number;
  slowUntil: { toMillis(): bigint };
  slot: number;
  needsLoadout?: boolean;
}

interface PoseRow {
  slot: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  flags: number;
  sendT: number;
}

interface WeaponRow {
  id: bigint;
  name: string;
  json: string;
  design?: string;
  isPreset?: boolean;
  prompt?: string;
  ownerIdentity?: Identity;
  weaponClass?: string;
}

interface PendingShot {
  seq: number;
  origin: Vec3;
  dir: Vec3;
  charge: number;
  combo: number;
  hits: { slot: number; zone: number; ix: number; iy: number; iz: number; pellets: number }[];
}

export interface SpacetimeNetOptions {
  uri: string;
  dbName: string;
  /** display name (set via set_name after connecting) */
  name?: string;
  /** ignore any stored auth token => new identity */
  fresh?: boolean;
  /** connect timeout (ms) */
  timeoutMs?: number;
}

const ms = (ts: { toMillis(): bigint }) => Number(ts.toMillis());

/** Stable per-identity colour. */
export function colorForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360},70%,50%)`;
}

function toSnapshot(r: PoseRow, arrival: number): PoseSnapshot {
  return {
    pos: [r.x, r.y, r.z],
    vel: [r.vx, r.vy, r.vz],
    yaw: r.yaw,
    pitch: r.pitch,
    crouching: (r.flags & POSE_FLAG_CROUCH) !== 0,
    grounded: (r.flags & POSE_FLAG_GROUNDED) !== 0,
    teleport: (r.flags & POSE_FLAG_TELEPORT) !== 0,
    blocking: (r.flags & POSE_FLAG_BLOCK) !== 0,
    sendT: r.sendT,
    arrival,
  };
}

/**
 * SpacetimeDB implementation of NetClient. Movement is client-authoritative (update_transform
 * into the small `player_pose` table, keyed by a per-connection slot); damage, death, respawn,
 * weapons and spawn points are server-authoritative. The auth token is kept in sessionStorage so
 * every browser tab is its own player (reloading a tab keeps the identity; `?fresh=1` forces a
 * new one).
 *
 * Subscriptions: player, player_pose, spawn_point, the two event tables and preset weapons;
 * other weapon rows are subscribed on demand when someone equips them.
 */
export class SpacetimeNetClient implements NetClient {
  readonly authoritative = true;
  localId = '';
  conn?: DbConnection;
  connected = false;
  private identity?: Identity;
  private readonly identities = new Map<string, Identity>();
  private readonly weapons = new Map<string, Weapon>();
  private readonly requestedWeapons = new Set<string>();
  /** online players: slot -> identity hex */
  private readonly slotToId = new Map<number, string>();
  private readonly idToSlot = new Map<string, number>();
  private readonly poses = new Map<string, PoseSnapshot>();
  private seq = (Date.now() & 0x3fffffff) >>> 0;
  private pendingShot?: PendingShot;

  // stats
  private readonly callCounts: Record<string, number> = {};
  private rttMs = 0;
  private readonly sendTimes: number[] = [];

  private playersCbs: Listener<NetPlayer[]>[] = [];
  private poseCbs: ((id: string, s: PoseSnapshot) => void)[] = [];
  private localCbs: Listener<NetPlayer>[] = [];
  private killCbs: Listener<KillEvent>[] = [];
  private shotCbs: Listener<ShotEvent>[] = [];
  private localHitCbs: Listener<LocalHitEvent>[] = [];
  private confirmCbs: Listener<HitConfirmEvent>[] = [];
  private weaponCbs: Listener<void>[] = [];
  private emitScheduled = false;

  constructor(private readonly opts: SpacetimeNetOptions) {}

  private get tokenKey() {
    return `ai-gaem.token.${this.opts.uri}.${this.opts.dbName}`;
  }

  connect(): Promise<void> {
    let token: string | undefined;
    if (!this.opts.fresh) {
      try {
        token = sessionStorage.getItem(this.tokenKey) ?? undefined;
      } catch {
        /* storage unavailable */
      }
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      };
      const timer = setTimeout(
        () => done(new Error(`SpacetimeDB connect timeout (${this.opts.uri} / ${this.opts.dbName})`)),
        this.opts.timeoutMs ?? 20000,
      );

      const tryReady = () => {
        if (!this.connected || !this.identity) return;
        const me = this.conn!.db.player.identity.find(this.identity) as PlayerRow | undefined;
        if (me && me.slot > 0) {
          this.emitLocal(me);
          this.scheduleEmit();
          done();
        }
      };

      this.conn = DbConnection.builder()
        .withUri(this.opts.uri)
        .withDatabaseName(this.opts.dbName)
        .withToken(token)
        // don't wait for durability before sending updates / reducer results (lower latency)
        .withConfirmedReads(false)
        .onConnect((conn, identity, newToken) => {
          this.identity = identity;
          this.localId = identity.toHexString();
          try {
            sessionStorage.setItem(this.tokenKey, newToken);
          } catch {
            /* ignore */
          }
          this.registerCallbacks(conn);
          conn
            .subscriptionBuilder()
            .onApplied(() => {
              this.connected = true;
              for (const w of conn.db.weapon.iter()) this.cacheWeapon(w as WeaponRow);
              for (const r of conn.db.player.iter()) this.trackPlayer(r as PlayerRow);
              for (const r of conn.db.playerPose.iter()) this.onPoseRow(r as PoseRow);
              if (this.opts.name) this.setName(this.opts.name);
              tryReady();
            })
            .onError(() => done(new Error('subscription error')))
            .subscribe([
              tables.player,
              tables.playerPose,
              tables.spawnPoint,
              tables.shotEvent,
              tables.hitEvent,
              tables.weapon.where((w) => w.isPreset.eq(true)),
              // our own weapons (register_design results show up here right away)
              tables.weapon.where((w) => w.ownerIdentity.eq(identity)),
            ]);
          // the player row is inserted / updated (slot) by the server's client_connected; wait for it
          conn.db.player.onInsert(() => tryReady());
          conn.db.player.onUpdate(() => tryReady());
        })
        .onConnectError((_ctx, err) => done(err))
        .onDisconnect(() => {
          this.connected = false;
          console.warn('[net] disconnected from SpacetimeDB');
        })
        .build();
    });
  }

  /** keep the slot <-> identity maps and weapon subscriptions in sync with a player row */
  private trackPlayer(row: PlayerRow) {
    const id = row.identity.toHexString();
    this.identities.set(id, row.identity);
    const oldSlot = this.idToSlot.get(id);
    const slot = row.online && row.slot > 0 ? row.slot : 0;
    if (oldSlot !== undefined && oldSlot !== slot) {
      if (this.slotToId.get(oldSlot) === id) this.slotToId.delete(oldSlot);
      this.idToSlot.delete(id);
      this.poses.delete(id);
    }
    if (slot > 0) {
      const had = this.slotToId.get(slot) === id;
      this.slotToId.set(slot, id);
      this.idToSlot.set(id, slot);
      // the pose row may have arrived before the player row
      if (!had) {
        const pose = this.conn?.db.playerPose.slot.find(slot) as PoseRow | undefined;
        if (pose) this.onPoseRow(pose);
      }
    }
    this.ensureWeapon(String(row.weaponId));
  }

  /** subscribe to a weapon row that isn't a preset (equipped by someone) */
  private ensureWeapon(id: string) {
    if (!this.conn || id === '0' || this.weapons.has(id) || this.requestedWeapons.has(id)) return;
    this.requestedWeapons.add(id);
    const wid = BigInt(id);
    this.conn
      .subscriptionBuilder()
      .onApplied(() => {
        const row = this.conn?.db.weapon.id.find(wid) as WeaponRow | undefined;
        if (row) this.cacheWeapon(row);
      })
      .onError(() => this.requestedWeapons.delete(id))
      .subscribe(tables.weapon.where((w) => w.id.eq(wid)));
  }

  private onPoseRow(row: PoseRow) {
    const id = this.slotToId.get(row.slot);
    if (!id) return; // owner's player row not seen yet (trackPlayer replays it)
    const snap = toSnapshot(row, performance.now());
    this.poses.set(id, snap);
    if (id === this.localId) return;
    this.poseCbs.forEach((cb) => cb(id, snap));
  }

  private registerCallbacks(conn: DbConnection) {
    const db = conn.db;
    const onPlayer = (row: PlayerRow) => {
      this.trackPlayer(row);
      if (this.identity && row.identity.isEqual(this.identity)) this.emitLocal(row);
      this.scheduleEmit();
    };
    db.player.onInsert((_ctx, row) => onPlayer(row as PlayerRow));
    db.player.onUpdate((_ctx, _old, row) => onPlayer(row as PlayerRow));
    db.player.onDelete(() => this.scheduleEmit());

    // poses: one snapshot per changed row (never re-emit unchanged players)
    db.playerPose.onInsert((_ctx, row) => this.onPoseRow(row as PoseRow));
    db.playerPose.onUpdate((_ctx, _old, row) => this.onPoseRow(row as PoseRow));

    db.weapon.onInsert((_ctx, row) => this.cacheWeapon(row as WeaponRow));
    db.weapon.onUpdate((_ctx, _old, row) => this.cacheWeapon(row as WeaponRow));

    db.shotEvent.onInsert((_ctx, e) => {
      const shooterId = e.shooter.toHexString();
      if (shooterId === this.localId) return;
      const ev: ShotEvent = { shooterId, weaponId: String(e.weaponId), origin: [e.ox, e.oy, e.oz], dir: [e.dx, e.dy, e.dz], charge: e.charge, combo: e.combo };
      this.shotCbs.forEach((cb) => cb(ev));
    });

    db.hitEvent.onInsert((_ctx, e) => {
      const targetId = e.target.toHexString();
      const shooterId = e.shooter.toHexString();
      const weaponId = String(e.weaponId);
      if (targetId === this.localId) {
        const ev: LocalHitEvent = {
          shooterId,
          weaponId,
          damage: e.damage,
          killed: e.killed,
          dot: e.dot,
          knock: [e.knockX, e.knockY, e.knockZ],
          slowPercent: e.slowPercent,
          headshot: e.headshot,
          blocked: e.blocked,
        };
        this.localHitCbs.forEach((cb) => cb(ev));
      }
      if (shooterId === this.localId && targetId !== this.localId) {
        const ev: HitConfirmEvent = { targetId, damage: e.damage, killed: e.killed, headshot: e.headshot, dot: e.dot, point: [e.x, e.y, e.z], blocked: e.blocked };
        this.confirmCbs.forEach((cb) => cb(ev));
      }
      if (e.killed) {
        const kill: KillEvent = {
          killerId: shooterId,
          killerName: this.playerName(e.shooter),
          victimId: targetId,
          victimName: this.playerName(e.target),
          weaponName: this.weapons.get(weaponId)?.name ?? `#${weaponId}`,
          weaponId,
          at: Date.now(),
          headshot: e.headshot,
        };
        this.killCbs.forEach((cb) => cb(kill));
      }
    });
  }

  private playerName(id: Identity) {
    const row = this.conn?.db.player.identity.find(id) as PlayerRow | undefined;
    if (this.identity && id.isEqual(this.identity)) return row?.name ?? 'You';
    return row?.name ?? id.toHexString().slice(0, 6);
  }

  private cacheWeapon(row: WeaponRow) {
    try {
      const w: Weapon = { ...clampWeapon(JSON.parse(row.json)), id: String(row.id) };
      if (row.isPreset) w.isPreset = true;
      if (row.prompt) w.prompt = row.prompt;
      if (row.ownerIdentity) w.owner = row.ownerIdentity.toHexString();
      if (row.design) {
        try {
          const d = JSON.parse(row.design) as ForgeDesign;
          if (d && Array.isArray(d.components) && d.components.length) w.design = d;
        } catch {
          /* legacy / bad design json: render the parts */
        }
      }
      this.weapons.set(w.id!, w);
      this.weaponCbs.forEach((cb) => cb());
    } catch (err) {
      console.warn('[net] bad weapon row', row.id, err);
    }
  }

  private toNetPlayer(r: PlayerRow): NetPlayer {
    const id = r.identity.toHexString();
    const pose = id === this.localId ? undefined : this.poses.get(id);
    return {
      id,
      name: r.name,
      // remote: latest pose; local: the server's spawn / resume point
      pos: pose ? [...pose.pos] : [r.x, r.y, r.z],
      yaw: pose ? pose.yaw : r.yaw,
      pitch: pose ? pose.pitch : 0,
      hp: r.hp,
      alive: r.alive,
      online: r.online,
      weaponId: String(r.weaponId),
      color: colorForId(id),
      kills: r.kills,
      deaths: r.deaths,
      respawnAt: ms(r.respawnAt),
      slowPercent: r.slowPercent,
      slowUntil: ms(r.slowUntil),
      crouching: pose?.crouching ?? false,
      needsLoadout: !!r.needsLoadout,
    };
  }

  private emitLocal(row: PlayerRow) {
    const me = this.toNetPlayer(row);
    this.localCbs.forEach((cb) => cb(me));
  }

  private scheduleEmit() {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    queueMicrotask(() => {
      this.emitScheduled = false;
      const list = this.remotePlayers();
      this.playersCbs.forEach((cb) => cb(list));
    });
  }

  /** online remote players (with a pose slot) */
  remotePlayers(): NetPlayer[] {
    if (!this.conn) return [];
    const out: NetPlayer[] = [];
    for (const r of this.conn.db.player.iter() as Iterable<PlayerRow>) {
      if (!r.online || r.slot === 0) continue;
      const id = r.identity.toHexString();
      if (id === this.localId) continue;
      out.push(this.toNetPlayer(r));
    }
    return out;
  }

  othersOnline() {
    let n = 0;
    for (const id of this.slotToId.values()) if (id !== this.localId) n++;
    return n;
  }

  getPose(id: string) {
    return this.poses.get(id);
  }

  getLocal(): NetPlayer | undefined {
    if (!this.conn || !this.identity) return undefined;
    const r = this.conn.db.player.identity.find(this.identity) as PlayerRow | undefined;
    return r ? this.toNetPlayer(r) : undefined;
  }

  disconnect() {
    this.conn?.disconnect();
  }

  stats(): NetStats {
    const now = performance.now();
    while (this.sendTimes.length && now - this.sendTimes[0] > 1000) this.sendTimes.shift();
    return { rtt: this.rttMs, sendHz: this.sendTimes.length, calls: { ...this.callCounts } };
  }

  /** run a reducer call: count it, log failures, optionally sample the round trip */
  private call(name: string, p: Promise<unknown> | undefined, measureRtt = false) {
    if (!p) return;
    this.callCounts[name] = (this.callCounts[name] ?? 0) + 1;
    const t0 = performance.now();
    p.then(
      () => {
        if (!measureRtt) return;
        const rtt = performance.now() - t0;
        this.rttMs = this.rttMs ? this.rttMs * 0.8 + rtt * 0.2 : rtt;
      },
      (err) => console.warn(`[net] ${name} failed:`, err?.message ?? err),
    );
  }

  sendTransform(pose: LocalPose) {
    if (!this.conn || !this.connected) return;
    this.sendTimes.push(performance.now());
    const flags = (pose.crouching ? POSE_FLAG_CROUCH : 0) | (pose.grounded ? POSE_FLAG_GROUNDED : 0) | (pose.teleport ? POSE_FLAG_TELEPORT : 0) | (pose.blocking ? POSE_FLAG_BLOCK : 0);
    this.call(
      'update_transform',
      this.conn.reducers.updateTransform({
        x: pose.pos[0],
        y: pose.pos[1],
        z: pose.pos[2],
        yaw: pose.yaw,
        pitch: pose.pitch,
        vx: pose.vel[0],
        vy: pose.vel[1],
        vz: pose.vel[2],
        flags,
        sendT: Math.round(pose.sendT) >>> 0,
      }),
      true,
    );
  }

  fire(origin: Vec3, dir: Vec3, melee?: { charge: number; combo: number }): number {
    this.flushShot(); // a previous shot that was never flushed
    const seq = (this.seq = (this.seq + 1) >>> 0);
    this.pendingShot = { seq, origin, dir, charge: melee?.charge ?? 0, combo: melee?.combo ?? 0, hits: [] };
    return seq;
  }

  flushShot() {
    const s = this.pendingShot;
    if (!s) return;
    this.pendingShot = undefined;
    if (!this.conn || !this.connected) return;
    this.call(
      'fire',
      this.conn.reducers.fire({ seq: s.seq, ox: s.origin[0], oy: s.origin[1], oz: s.origin[2], dx: s.dir[0], dy: s.dir[1], dz: s.dir[2], hits: s.hits, charge: s.charge, combo: s.combo }),
      true,
    );
  }

  reportHit(targetId: string, _weaponId: string, info?: HitInfo) {
    const slot = this.idToSlot.get(targetId);
    if (!this.conn || !slot || !info) return;
    const pellets = Math.max(1, Math.min(255, Math.round(info.pellets)));
    const zone = Math.max(0, Math.min(255, Math.round(info.zone ?? 0)));
    const [ix, iy, iz] = info.point;
    const s = this.pendingShot;
    if (s && s.seq === info.seq) {
      // same shot: batched into the fire call (hitscan / stream / melee)
      if (!s.hits.some((h) => h.slot === slot)) s.hits.push({ slot, zone, ix, iy, iz, pellets });
      return;
    }
    // projectile / arc impact, later than the shot
    this.call('report_hit', this.conn.reducers.reportHit({ seq: info.seq, slot, pellets, ix, iy, iz, zone }));
  }

  reload() {
    this.call('reload', this.conn?.reducers.reload({}));
  }

  respawn(keepLoadout: boolean) {
    this.call('respawn', this.conn?.reducers.respawn({ keepLoadout }));
  }

  /** respawn, resolving/rejecting with the reducer outcome */
  respawnAsync(keepLoadout: boolean): Promise<void> {
    if (!this.conn) return Promise.reject(new Error('not connected'));
    this.callCounts.respawn = (this.callCounts.respawn ?? 0) + 1;
    return this.conn.reducers.respawn({ keepLoadout });
  }

  equipWeapon(weaponId: string): Promise<void> {
    if (!this.conn) return Promise.reject(new Error('not connected'));
    this.callCounts.equip_weapon = (this.callCounts.equip_weapon ?? 0) + 1;
    return this.conn.reducers.equipWeapon({ weaponId: BigInt(weaponId) });
  }

  presetId(weaponClass: string) {
    for (const w of (this.conn?.db.weapon.iter() ?? []) as Iterable<WeaponRow & { isPreset: boolean; weaponClass: string }>) {
      if (w.isPreset && w.weaponClass === weaponClass) return String(w.id);
    }
    return undefined;
  }

  presetIds() {
    const out: { id: string; cls: string; name: string }[] = [];
    for (const w of (this.conn?.db.weapon.iter() ?? []) as Iterable<WeaponRow>) {
      if (w.isPreset) out.push({ id: String(w.id), cls: w.weaponClass ?? '', name: w.name });
    }
    return out;
  }

  /** our own weapon ids, newest last */
  private ownWeaponIds(): bigint[] {
    const ids: bigint[] = [];
    if (!this.conn || !this.identity) return ids;
    for (const w of this.conn.db.weapon.iter() as Iterable<WeaponRow>) {
      if (!w.isPreset && w.ownerIdentity && w.ownerIdentity.isEqual(this.identity)) ids.push(w.id);
    }
    return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async registerDesign(design: ForgeDesign, prompt: string): Promise<string | null> {
    if (!this.conn) throw new Error('not connected');
    this.callCounts.register_design = (this.callCounts.register_design ?? 0) + 1;
    const before = new Set(this.ownWeaponIds().map(String));
    // locked flags are editor state; the server strips them too
    const clean: ForgeDesign = { ...design, components: design.components.map(({ locked: _l, ...c }) => c) };
    await this.conn.reducers.registerDesign({ designJson: JSON.stringify(clean), prompt: prompt.slice(0, 400) });
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      const fresh = this.ownWeaponIds().map(String).filter((id) => !before.has(id));
      if (fresh.length) {
        const id = fresh[fresh.length - 1];
        const row = this.conn.db.weapon.id.find(BigInt(id)) as WeaponRow | undefined;
        if (row) this.cacheWeapon(row);
        return id;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    return null;
  }

  requestRedeploy(): Promise<void> {
    if (!this.conn) return Promise.reject(new Error('not connected'));
    this.callCounts.request_redeploy = (this.callCounts.request_redeploy ?? 0) + 1;
    return this.conn.reducers.requestRedeploy({});
  }

  setName(name: string) {
    const clean = name.trim().slice(0, 24);
    if (clean) this.call('set_name', this.conn?.reducers.setName({ name: clean }));
  }

  async registerWeapon(json: Weapon): Promise<string> {
    // Offline sample weapons are not registered with the server; weapons come from the
    // `weapon` table (presets + generated). Keep a local id so lookups still work.
    return json.id ?? json.name;
  }

  async generateWeapon(prompt: string, weaponClass = ''): Promise<GenerateWeaponResult> {
    if (!this.conn) throw new Error('not connected');
    this.callCounts.generate_weapon = (this.callCounts.generate_weapon ?? 0) + 1;
    // the template library lives on the client (too big for the module): send the best matches
    const templatesJson = await templatesJsonFor(prompt, weaponClass);
    const res = await this.conn.procedures.generateWeapon({ prompt, weaponClass, templatesJson });
    const weaponId = String(res.weaponId);
    this.ensureWeapon(weaponId);
    // the weapon row arrives through the (on-demand) subscription; wait briefly for it
    const t0 = performance.now();
    while (!this.weapons.has(weaponId) && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    return { ok: res.ok, weaponId, message: res.message, weapon: this.weapons.get(weaponId) };
  }

  getWeapon(id: string) {
    const w = this.weapons.get(id);
    if (!w) this.ensureWeapon(id);
    return w;
  }

  onPlayersChanged(cb: Listener<NetPlayer[]>) {
    this.playersCbs.push(cb);
    if (this.connected) cb(this.remotePlayers());
    return () => (this.playersCbs = this.playersCbs.filter((c) => c !== cb));
  }

  onPose(cb: (id: string, s: PoseSnapshot) => void) {
    this.poseCbs.push(cb);
    return () => (this.poseCbs = this.poseCbs.filter((c) => c !== cb));
  }

  onLocalChanged(cb: Listener<NetPlayer>) {
    this.localCbs.push(cb);
    return () => (this.localCbs = this.localCbs.filter((c) => c !== cb));
  }

  onKill(cb: Listener<KillEvent>) {
    this.killCbs.push(cb);
    return () => (this.killCbs = this.killCbs.filter((c) => c !== cb));
  }

  onShot(cb: Listener<ShotEvent>) {
    this.shotCbs.push(cb);
    return () => (this.shotCbs = this.shotCbs.filter((c) => c !== cb));
  }

  onLocalHit(cb: Listener<LocalHitEvent>) {
    this.localHitCbs.push(cb);
    return () => (this.localHitCbs = this.localHitCbs.filter((c) => c !== cb));
  }

  onHitConfirmed(cb: Listener<HitConfirmEvent>) {
    this.confirmCbs.push(cb);
    return () => (this.confirmCbs = this.confirmCbs.filter((c) => c !== cb));
  }

  onWeaponsChanged(cb: Listener<void>) {
    this.weaponCbs.push(cb);
    return () => (this.weaponCbs = this.weaponCbs.filter((c) => c !== cb));
  }
}
