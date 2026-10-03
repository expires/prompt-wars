import type { Weapon } from '../weapons/types';

export type Vec3 = [number, number, number];

/** Snapshot of a (remote or local) player as the network layer sees it. */
export interface NetPlayer {
  id: string;
  name: string;
  /** feet position */
  pos: Vec3;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  weaponId?: string;
  color?: string;
  kills?: number;
  deaths?: number;
  online?: boolean;
  /** ms since epoch when respawn becomes allowed (server-authoritative clients) */
  respawnAt?: number;
  /** movement slow (percent, 0-60) active until slowUntil (ms since epoch) */
  slowPercent?: number;
  slowUntil?: number;
  /** crouched (lower hitboxes, crouched model) */
  crouching?: boolean;
}

export interface KillEvent {
  killerId: string;
  killerName: string;
  victimId: string;
  victimName: string;
  weaponName: string;
  at: number;
  /** the killing blow was a headshot */
  headshot?: boolean;
}

/** A shot fired by a remote player (for tracers / projectiles / muzzle flashes). */
export interface ShotEvent {
  shooterId: string;
  weaponId: string;
  origin: Vec3;
  dir: Vec3;
  /** melee: granted charge (0 = normal swing) and slash combo index */
  charge?: number;
  combo?: number;
}

/** Damage the server applied to the local player. */
export interface LocalHitEvent {
  shooterId: string;
  weaponId: string;
  damage: number;
  killed: boolean;
  dot: boolean;
  knock: Vec3;
  slowPercent: number;
  headshot: boolean;
  /** melee hit reduced by our block */
  blocked?: boolean;
}

/**
 * Local player's pose as sent to the server (update_transform): feet position, look, velocity,
 * flags and the sender clock (ms) the sample belongs to.
 */
export interface LocalPose {
  pos: Vec3;
  yaw: number;
  pitch: number;
  vel: Vec3;
  crouching: boolean;
  grounded: boolean;
  /** discontinuity (teleport / respawn): remotes snap */
  teleport: boolean;
  /** blocking with a melee weapon */
  blocking?: boolean;
  /** sender clock, ms */
  sendT: number;
}

/** A remote player's pose sample, as received. */
export interface PoseSnapshot {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  grounded: boolean;
  teleport: boolean;
  blocking?: boolean;
  /** sender clock (ms, may wrap at 2^32) */
  sendT: number;
  /** local arrival time (performance.now()) */
  arrival: number;
}

/** Network statistics for the F3 overlay / tests. */
export interface NetStats {
  /** smoothed reducer round trip (ms), 0 = unknown */
  rtt: number;
  /** update_transform calls in the last second */
  sendHz: number;
  /** reducer calls per name since connect */
  calls: Record<string, number>;
}

/** Extra info for a hit report: which shot hit, how many pellets connected, where, which zone. */
export interface HitInfo {
  seq: number;
  pellets: number;
  point: Vec3;
  /** 0 body, 1 head (server re-validates and applies the weapon's headshot multiplier) */
  zone: number;
  /** melee: charge fraction of the swing */
  charge?: number;
}

/** Damage the server applied to someone else, from a shot by the local player. */
export interface HitConfirmEvent {
  targetId: string;
  damage: number;
  killed: boolean;
  headshot: boolean;
  /** damage-over-time tick */
  dot?: boolean;
  /** impact point (world) */
  point?: Vec3;
  /** melee hit reduced by the target's block */
  blocked?: boolean;
}

export interface GenerateWeaponResult {
  ok: boolean;
  weaponId: string;
  message: string;
  weapon?: Weapon;
}

/**
 * Networking seam. The game only talks to this interface: OfflineNetClient (no server,
 * local simulation) and SpacetimeNetClient (SpacetimeDB, server-authoritative damage).
 */
export interface NetClient {
  readonly localId: string;
  /** true when hp / death / weapon / spawn come from the server */
  readonly authoritative: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  /** send the local pose now (the send policy lives in PoseSender) */
  sendTransform(pose: LocalPose): void;
  /**
   * A shot was fired locally; returns the shot sequence number. Hits reported (reportHit) with
   * this seq before `flushShot()` travel in the same network call (hitscan / stream / melee).
   */
  fire(origin: Vec3, dir: Vec3, melee?: { charge: number; combo: number }): number;
  /** send the shot started by `fire` together with its batched hits */
  flushShot?(): void;
  /** client-detected hit on another player; server validates & applies damage */
  reportHit(targetId: string, weaponId: string, info?: HitInfo): void;
  /** local player started a reload */
  reload?(): void;
  respawn(keepLoadout: boolean): void;
  /** equip a library weapon (server: only while dead) */
  equipWeapon?(weaponId: string): Promise<void>;
  /** id of the preset weapon of a class (tests / debug) */
  presetId?(weaponClass: string): string | undefined;
  /** register a weapon; resolves to its id */
  registerWeapon(json: Weapon): Promise<string>;
  /** server-side (LLM) weapon generation; auto-equipped while dead */
  generateWeapon?(prompt: string, weaponClass?: string): Promise<GenerateWeaponResult>;
  setName?(name: string): void;
  /** fires with all *remote* players whenever any player row (not pose) changes */
  onPlayersChanged(cb: (players: NetPlayer[]) => void): () => void;
  /** a remote player's pose changed (one call per received row) */
  onPose?(cb: (id: string, snap: PoseSnapshot) => void): () => void;
  /** latest pose sample of a remote player */
  getPose?(id: string): PoseSnapshot | undefined;
  /** number of other online players (send-rate throttling) */
  othersOnline?(): number;
  stats?(): NetStats;
  /** fires when the local player's authoritative state changes (hp, death, weapon) */
  onLocalChanged?(cb: (me: NetPlayer) => void): () => void;
  onKill?(cb: (e: KillEvent) => void): () => void;
  /** shots fired by remote players */
  onShot?(cb: (e: ShotEvent) => void): () => void;
  /** damage applied to the local player */
  onLocalHit?(cb: (e: LocalHitEvent) => void): () => void;
  /** server-confirmed damage dealt by the local player */
  onHitConfirmed?(cb: (e: HitConfirmEvent) => void): () => void;
  /** fires when a weapon definition arrives/changes */
  onWeaponsChanged?(cb: () => void): () => void;
  /** current local player state, if known */
  getLocal?(): NetPlayer | undefined;
  /** look up weapon definitions by id (for remote player models) */
  getWeapon?(id: string): Weapon | undefined;
}
