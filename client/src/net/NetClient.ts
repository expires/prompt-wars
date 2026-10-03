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
}

/** Extra info for a hit report: which shot hit, how many pellets connected, where, which zone. */
export interface HitInfo {
  seq: number;
  pellets: number;
  point: Vec3;
  /** 0 body, 1 head (server re-validates and applies the weapon's headshot multiplier) */
  zone: number;
}

/** Damage the server applied to someone else, from a shot by the local player. */
export interface HitConfirmEvent {
  targetId: string;
  damage: number;
  killed: boolean;
  headshot: boolean;
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
  /** called at a fixed rate (~15Hz) with the local player's transform + crouch state; `force` skips throttling */
  sendTransform(pos: Vec3, yaw: number, pitch: number, crouching: boolean, force?: boolean): void;
  /** a shot was fired locally; returns the shot sequence number used by reportHit */
  fire(origin: Vec3, dir: Vec3): number;
  /** client-detected hit on another player; server validates & applies damage */
  reportHit(targetId: string, weaponId: string, info?: HitInfo): void;
  /** local player started a reload */
  reload?(): void;
  respawn(keepLoadout: boolean): void;
  /** register a weapon; resolves to its id */
  registerWeapon(json: Weapon): Promise<string>;
  /** server-side (LLM) weapon generation; auto-equipped while dead */
  generateWeapon?(prompt: string, weaponClass?: string): Promise<GenerateWeaponResult>;
  setName?(name: string): void;
  /** fires with all *remote* players whenever any change */
  onPlayersChanged(cb: (players: NetPlayer[]) => void): () => void;
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
