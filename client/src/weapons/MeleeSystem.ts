import * as THREE from 'three';
import {
  MELEE_CHARGE_TIME,
  MELEE_COMBO_LENGTH,
  MELEE_COMBO_WINDOW,
  MELEE_MIN_CHARGE,
  MELEE_PHASES,
  effectiveFireRate,
  meleeHitDamage,
  meleeMetaOf,
  meleeReach,
  meleeSwingDuration,
  sampleMeleeArc,
  type MeleeMeta,
} from '@ai-gaem/shared';
import type RAPIER from '@dimforge/rapier3d';
import type { HitTarget, TargetRegistry } from './targets';
import type { Weapon } from './types';

/** What the player wants this frame (mouse / keys / gamepad, already merged). */
export interface MeleeIntent {
  /** primary attack held (LMB / RT) */
  attack: boolean;
  /** heavy attack held (RMB / LT): charge while held, swing on release */
  heavy: boolean;
  /** block held (F / RB; RMB for shields) */
  block: boolean;
}

export interface MeleeHost {
  camera: THREE.PerspectiveCamera;
  targets: TargetRegistry;
  /** sphere cast from `origin` along unit `dir` up to `len`; first collider hit (excluding us) */
  castBall(origin: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number): { collider: RAPIER.Collider; point: THREE.Vector3; distance: number } | null;
}

export interface MeleeEvents {
  /** a swing started (swoosh / camera) */
  onSwingStart?(meta: MeleeMeta, charge: number, combo: number): void;
  /** the strike window opened: send the network shot, returns its seq */
  onStrike?(origin: THREE.Vector3, dir: THREE.Vector3, charge: number, combo: number): number;
  /** the blade connected with a target (zone 1 = head) for `damage` (local estimate) */
  onContact?(target: HitTarget, zone: number, point: THREE.Vector3, damage: number, info: { seq: number; charge: number }): void;
  /** the blade hit the world (spark / clank) */
  onWorldHit?(point: THREE.Vector3, normal: THREE.Vector3 | undefined): void;
  /** first contact of a swing: hit-stop / camera punch / lunge */
  onFirstContact?(meta: MeleeMeta, charge: number, swingDir: THREE.Vector3): void;
  /** the strike window closed: flush the network shot (with its hits) */
  onStrikeEnd?(): void;
}

export interface SwingState {
  meta: MeleeMeta;
  combo: number;
  charge: number;
  /** seconds into the swing (slowed by hit-stop) */
  t: number;
  duration: number;
  /** strike window open (network shot pending) */
  open: boolean;
  struck: boolean;
  hit: Set<HitTarget>;
  wallHit: boolean;
  contacts: number;
  seq: number;
}

/** what the viewmodel should show */
export type MeleeView =
  | { kind: 'idle' }
  | { kind: 'block' }
  | { kind: 'charge'; meta: MeleeMeta; combo: number; charge: number }
  | { kind: 'swing'; meta: MeleeMeta; combo: number; u: number; charge: number; frozen: boolean };

/** hit-stop on contact: the swing runs at HIT_STOP_SCALE speed for HIT_STOP seconds */
export const HIT_STOP = 0.07;
const HIT_STOP_SCALE = 0.08;
const BALL_RADIUS = 0.1;

/** impact sound material: edged weapons slice, everything else thuds */
export function meleeMaterial(w: Weapon): 'blade' | 'blunt' {
  return /blade|sword|katana|knife|dagger|sabre|saber|axe|spear|scythe|sickle|glaive|naginata|halberd|trident|machete|cleaver|razor/i.test(
    `${w.name} ${w.parts.map((p) => p.partId).join(' ')}`,
  )
    ? 'blade'
    : 'blunt';
}

const isShield = (w: Weapon, m: MeleeMeta) => m.swing === 'bash' && /shield|buckler/i.test(`${w.name} ${w.parts.map((p) => p.partId).join(' ')}`);

/**
 * Melee state machine: light swings (slash 3-hit combo), hold-to-charge heavy attacks, block.
 * During each swing's strike window the arc is swept every frame with sphere casts (dense enough
 * that nothing slips between samples); each target is hit at most once per swing. All hits of a
 * swing travel in one `fire` call (opened at strike start, flushed at strike end).
 */
export class MeleeSystem {
  weapon!: Weapon;
  meta!: MeleeMeta;
  shield = false;
  swing: SwingState | null = null;
  chargeT = 0;
  charging = false;
  blocking = false;
  hitStop = 0;
  private time = 0;
  private nextSwingAt = 0;
  private lastSwingEnd = -10;
  private lastCombo = -1;
  private readonly tmpO = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  /** swings started (tests) */
  swings = 0;
  /** test hook / screenshots: hold every swing at this progress (0..1), null = run */
  freezeU: number | null = null;
  /** last swing summary (tests) */
  last: { swing: string; combo: number; charge: number; contacts: number } | null = null;

  constructor(private readonly host: MeleeHost, private readonly events: MeleeEvents = {}) {}

  setWeapon(w: Weapon) {
    this.cancel();
    this.weapon = w;
    this.meta = meleeMetaOf(w);
    this.shield = isShield(w, this.meta);
    this.nextSwingAt = this.time + 0.25;
    this.lastCombo = -1;
  }

  /** seconds between swing starts (server token bucket rate) */
  get interval() {
    return 1 / effectiveFireRate(this.weapon);
  }

  get busy() {
    return !!this.swing;
  }

  cancel() {
    if (this.swing?.open) this.events.onStrikeEnd?.();
    this.swing = null;
    this.charging = false;
    this.chargeT = 0;
    this.blocking = false;
    this.hitStop = 0;
  }

  /** start a swing now; `force` ignores the local cooldown (test hook) */
  startSwing(charge = 0, force = false): boolean {
    if (!force && (this.swing || this.time < this.nextSwingAt)) return false;
    if (this.swing?.open) this.events.onStrikeEnd?.();
    const m = this.meta;
    const c = charge >= MELEE_MIN_CHARGE ? Math.min(1, charge) : 0;
    let combo = 0;
    if (m.swing === 'slash' && c === 0 && this.time - this.lastSwingEnd <= MELEE_COMBO_WINDOW && this.lastCombo >= 0) {
      combo = (this.lastCombo + 1) % MELEE_COMBO_LENGTH;
    }
    const duration = meleeSwingDuration(m.weight, c, combo);
    this.swing = { meta: m, combo, charge: c, t: 0, duration, open: false, struck: false, hit: new Set(), wallHit: false, contacts: 0, seq: 0 };
    this.nextSwingAt = this.time + Math.max(duration, this.interval);
    this.blocking = false;
    this.swings++;
    this.events.onSwingStart?.(m, c, combo);
    return true;
  }

  update(dt: number, intent: MeleeIntent) {
    this.time += dt;
    const heavyHeld = intent.heavy && !this.shield;
    const blockHeld = intent.block || (this.shield && intent.heavy);

    if (!this.swing) {
      // block (not while charging a heavy attack)
      this.blocking = blockHeld && !this.charging;
      if (!this.blocking) {
        if (heavyHeld && this.time >= this.nextSwingAt) {
          this.charging = true;
          this.chargeT += dt;
        } else if (this.charging && !heavyHeld) {
          const charge = Math.min(1, this.chargeT / MELEE_CHARGE_TIME);
          this.charging = false;
          this.chargeT = 0;
          this.startSwing(charge, true);
        } else if (intent.attack && !this.charging) {
          this.startSwing(0);
        }
      }
    }
    if (this.swing) this.advance(dt);
  }

  private advance(dt: number) {
    const s = this.swing!;
    const scale = this.hitStop > 0 ? HIT_STOP_SCALE : 1;
    this.hitStop = Math.max(0, this.hitStop - dt);
    const ph = MELEE_PHASES[s.meta.swing];
    const u0 = s.t / s.duration;
    if (this.freezeU !== null) {
      s.t = Math.max(s.t, this.freezeU * s.duration);
      if (s.t / s.duration > this.freezeU) s.t = this.freezeU * s.duration;
    } else s.t += dt * scale;
    const u1 = Math.min(1, s.t / s.duration);
    if (!s.struck && u1 >= ph.strikeStart) {
      s.struck = true;
      s.open = true;
      const eye = this.host.camera.getWorldPosition(this.tmpO);
      const fwd = this.host.camera.getWorldDirection(this.tmpD);
      s.seq = this.events.onStrike?.(eye.clone(), fwd.clone(), s.charge, s.combo) ?? 0;
    }
    if (s.open) {
      const w0 = Math.max(0, (u0 - ph.strikeStart) / (ph.strikeEnd - ph.strikeStart));
      const w1 = Math.min(1, (u1 - ph.strikeStart) / (ph.strikeEnd - ph.strikeStart));
      if (w1 >= w0) this.sweep(s, u0 <= ph.strikeStart ? 0 : w0, w1);
      // (frozen for a screenshot: send the shot right away so other clients play the swing)
      if (u1 >= ph.strikeEnd || this.freezeU !== null) {
        s.open = false;
        this.events.onStrikeEnd?.();
      }
    }
    if (u1 >= 1) {
      this.last = { swing: s.meta.swing, combo: s.combo, charge: s.charge, contacts: s.contacts };
      this.lastSwingEnd = this.time;
      this.lastCombo = s.combo;
      this.swing = null;
    }
  }

  /** sweep the arc between strike progress w0 and w1 (0..1) */
  private sweep(s: SwingState, w0: number, w1: number) {
    const cam = this.host.camera;
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const reach = meleeReach(this.weapon, s.charge);
    const arc = Math.max(40, this.weapon.spread || 90) * (s.charge > 0 ? 1.2 : 1);
    const dir = new THREE.Vector3();
    for (const a of sampleMeleeArc(s.meta.swing, s.combo, w0, w1, arc, 3)) {
      dir.set(a.dir[0], a.dir[1], a.dir[2]).applyQuaternion(cam.quaternion);
      const hit = this.host.castBall(eye, dir, reach * a.reachFrac, BALL_RADIUS);
      if (!hit) continue;
      const th = this.host.targets.hitFromCollider(hit.collider);
      if (th) {
        const t = th.target;
        if (s.hit.has(t) || !t.alive()) continue;
        s.hit.add(t);
        s.contacts++;
        const damage = meleeHitDamage(this.weapon, s.charge, th.zone);
        this.events.onContact?.(t, th.zone, hit.point, damage, { seq: s.seq, charge: s.charge });
        if (s.contacts === 1) {
          this.hitStop = HIT_STOP * (s.meta.weight === 'heavy' ? 1.15 : 1);
          this.events.onFirstContact?.(s.meta, s.charge, dir.clone());
        }
      } else if (!s.wallHit && s.contacts === 0) {
        s.wallHit = true;
        this.events.onWorldHit?.(hit.point, undefined);
        this.hitStop = HIT_STOP * 0.6;
      }
    }
  }

  view(): MeleeView {
    if (this.swing) {
      const s = this.swing;
      return { kind: 'swing', meta: s.meta, combo: s.combo, u: s.t / s.duration, charge: s.charge, frozen: this.hitStop > 0 };
    }
    if (this.charging) {
      return { kind: 'charge', meta: this.meta, combo: 0, charge: Math.min(1, this.chargeT / MELEE_CHARGE_TIME) };
    }
    if (this.blocking) return { kind: 'block' };
    return { kind: 'idle' };
  }

  /** charge fraction while charging (HUD) */
  get chargeFraction() {
    return this.charging ? Math.min(1, this.chargeT / MELEE_CHARGE_TIME) : 0;
  }
}

