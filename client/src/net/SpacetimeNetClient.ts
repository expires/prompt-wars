import { clampWeapon } from '@ai-gaem/shared';
import type { Identity } from 'spacetimedb';
import { DbConnection } from '../module_bindings';
import type { Weapon } from '../weapons/types';
import type {
  GenerateWeaponResult,
  HitInfo,
  KillEvent,
  LocalHitEvent,
  NetClient,
  NetPlayer,
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
  pitch: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  weaponId: bigint;
  respawnAt: { toMillis(): bigint };
  slowPercent: number;
  slowUntil: { toMillis(): bigint };
}

interface WeaponRow {
  id: bigint;
  name: string;
  json: string;
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

/**
 * SpacetimeDB implementation of NetClient. Movement is client-authoritative
 * (update_transform at ~15Hz); damage, death, respawn, weapons and spawn points are
 * server-authoritative. The auth token is kept in sessionStorage so every browser tab is its
 * own player (reloading a tab keeps the identity; `?fresh=1` forces a new one).
 */
export class SpacetimeNetClient implements NetClient {
  readonly authoritative = true;
  localId = '';
  conn?: DbConnection;
  connected = false;
  private identity?: Identity;
  private readonly identities = new Map<string, Identity>();
  private readonly weapons = new Map<string, Weapon>();
  private seq = (Date.now() & 0x3fffffff) >>> 0;
  private lastSent?: { pos: Vec3; yaw: number; pitch: number; t: number };

  private playersCbs: Listener<NetPlayer[]>[] = [];
  private localCbs: Listener<NetPlayer>[] = [];
  private killCbs: Listener<KillEvent>[] = [];
  private shotCbs: Listener<ShotEvent>[] = [];
  private localHitCbs: Listener<LocalHitEvent>[] = [];
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
        if (me) {
          this.emitLocal(me);
          this.scheduleEmit();
          done();
        }
      };

      this.conn = DbConnection.builder()
        .withUri(this.opts.uri)
        .withDatabaseName(this.opts.dbName)
        .withToken(token)
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
              if (this.opts.name) this.setName(this.opts.name);
              tryReady();
            })
            .onError((_ctx) => done(new Error('subscription error')))
            .subscribeToAllTables();
          // the player row is inserted by the server's client_connected; wait for it
          conn.db.player.onInsert(() => tryReady());
        })
        .onConnectError((_ctx, err) => done(err))
        .onDisconnect(() => {
          this.connected = false;
          console.warn('[net] disconnected from SpacetimeDB');
        })
        .build();
    });
  }

  private registerCallbacks(conn: DbConnection) {
    const db = conn.db;
    const onPlayer = (row: PlayerRow) => {
      this.identities.set(row.identity.toHexString(), row.identity);
      if (this.identity && row.identity.isEqual(this.identity)) this.emitLocal(row);
      this.scheduleEmit();
    };
    db.player.onInsert((_ctx, row) => onPlayer(row as PlayerRow));
    db.player.onUpdate((_ctx, _old, row) => onPlayer(row as PlayerRow));
    db.player.onDelete(() => this.scheduleEmit());

    db.weapon.onInsert((_ctx, row) => this.cacheWeapon(row as WeaponRow));
    db.weapon.onUpdate((_ctx, _old, row) => this.cacheWeapon(row as WeaponRow));

    db.shotEvent.onInsert((_ctx, e) => {
      const shooterId = e.shooter.toHexString();
      if (shooterId === this.localId) return;
      const ev: ShotEvent = { shooterId, weaponId: String(e.weaponId), origin: [e.ox, e.oy, e.oz], dir: [e.dx, e.dy, e.dz] };
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
        };
        this.localHitCbs.forEach((cb) => cb(ev));
      }
      if (e.killed) {
        const kill: KillEvent = {
          killerId: shooterId,
          killerName: this.playerName(e.shooter),
          victimId: targetId,
          victimName: this.playerName(e.target),
          weaponName: this.weapons.get(weaponId)?.name ?? `#${weaponId}`,
          at: Date.now(),
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
      this.weapons.set(w.id!, w);
      this.weaponCbs.forEach((cb) => cb());
    } catch (err) {
      console.warn('[net] bad weapon row', row.id, err);
    }
  }

  private toNetPlayer(r: PlayerRow): NetPlayer {
    const id = r.identity.toHexString();
    return {
      id,
      name: r.name,
      pos: [r.x, r.y, r.z],
      yaw: r.yaw,
      pitch: r.pitch,
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

  /** online remote players */
  remotePlayers(): NetPlayer[] {
    if (!this.conn) return [];
    const out: NetPlayer[] = [];
    for (const r of this.conn.db.player.iter() as Iterable<PlayerRow>) {
      if (!r.online) continue;
      const id = r.identity.toHexString();
      if (id === this.localId) continue;
      out.push(this.toNetPlayer(r));
    }
    return out;
  }

  getLocal(): NetPlayer | undefined {
    if (!this.conn || !this.identity) return undefined;
    const r = this.conn.db.player.identity.find(this.identity) as PlayerRow | undefined;
    return r ? this.toNetPlayer(r) : undefined;
  }

  disconnect() {
    this.conn?.disconnect();
  }

  private call(name: string, p: Promise<unknown> | undefined) {
    p?.catch((err) => console.warn(`[net] ${name} failed:`, err?.message ?? err));
  }

  sendTransform(pos: Vec3, yaw: number, pitch: number, force = false) {
    if (!this.conn || !this.connected) return;
    const now = performance.now();
    const l = this.lastSent;
    if (
      !force &&
      l &&
      now - l.t < 1000 &&
      Math.abs(l.pos[0] - pos[0]) + Math.abs(l.pos[1] - pos[1]) + Math.abs(l.pos[2] - pos[2]) < 0.005 &&
      Math.abs(l.yaw - yaw) + Math.abs(l.pitch - pitch) < 0.002
    )
      return;
    this.lastSent = { pos: [...pos] as Vec3, yaw, pitch, t: now };
    this.call('updateTransform', this.conn.reducers.updateTransform({ x: pos[0], y: pos[1], z: pos[2], yaw, pitch }));
  }

  fire(origin: Vec3, dir: Vec3): number {
    const seq = (this.seq = (this.seq + 1) >>> 0);
    if (this.conn && this.connected) {
      this.call(
        'fire',
        this.conn.reducers.fire({ seq, ox: origin[0], oy: origin[1], oz: origin[2], dx: dir[0], dy: dir[1], dz: dir[2] }),
      );
    }
    return seq;
  }

  reportHit(targetId: string, _weaponId: string, info?: HitInfo) {
    const target = this.identities.get(targetId);
    if (!this.conn || !target || !info) return;
    this.call(
      'reportHit',
      this.conn.reducers.reportHit({
        seq: info.seq,
        target,
        pellets: Math.max(1, Math.round(info.pellets)),
        ix: info.point[0],
        iy: info.point[1],
        iz: info.point[2],
      }),
    );
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
    return this.conn.reducers.respawn({ keepLoadout });
  }

  setName(name: string) {
    const clean = name.trim().slice(0, 24);
    if (clean) this.call('setName', this.conn?.reducers.setName({ name: clean }));
  }

  async registerWeapon(json: Weapon): Promise<string> {
    // Offline sample weapons are not registered with the server; weapons come from the
    // `weapon` table (presets + generated). Keep a local id so lookups still work.
    return json.id ?? json.name;
  }

  async generateWeapon(prompt: string, weaponClass = ''): Promise<GenerateWeaponResult> {
    if (!this.conn) throw new Error('not connected');
    const res = await this.conn.procedures.generateWeapon({ prompt, weaponClass });
    const weaponId = String(res.weaponId);
    // the weapon row arrives through the subscription; wait briefly for it
    const t0 = performance.now();
    while (!this.weapons.has(weaponId) && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    return { ok: res.ok, weaponId, message: res.message, weapon: this.weapons.get(weaponId) };
  }

  getWeapon(id: string) {
    return this.weapons.get(id);
  }

  onPlayersChanged(cb: Listener<NetPlayer[]>) {
    this.playersCbs.push(cb);
    if (this.connected) cb(this.remotePlayers());
    return () => (this.playersCbs = this.playersCbs.filter((c) => c !== cb));
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

  onWeaponsChanged(cb: Listener<void>) {
    this.weaponCbs.push(cb);
    return () => (this.weaponCbs = this.weaponCbs.filter((c) => c !== cb));
  }
}
