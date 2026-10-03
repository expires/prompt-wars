import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d';
import type { PhysicsContext } from '../engine/physics';
import { Humanoid } from '../player/humanoid';
import { CENTER_OFFSET } from '../player/PlayerController';
import { Hitboxes } from '../player/hitboxes';
import { buildWeaponModel } from '../weapons/buildWeaponModel';
import { onPartsLibrary } from '../weapons/partsLibrary';
import { THROW_TIME } from '../weapons/throwAnim';
import { MELEE_PHASES, meleeMetaOf, meleeSwingDuration } from '@ai-gaem/shared';
import type { Weapon } from '../weapons/types';
import type { HitTarget, TargetRegistry } from '../weapons/targets';
import type { NetClient, NetPlayer, PoseSnapshot } from './NetClient';
import { RemoteInterpolator, type InterpStats } from './interp';
import { ELEMENT_LOOK, emitStatusParticles, playerStatus, statusTint, type ParticleSink, type PlayerStatus } from '../weapons/elementFx';

/** crouch blend speed (full transition in ~0.15 s) */
const CROUCH_RATE = 1 / 0.15;

interface Remote {
  id: string;
  model: Humanoid;
  body: RAPIER.RigidBody;
  hitboxes: Hitboxes;
  /** 0 standing .. 1 crouched (smoothed) */
  crouchT: number;
  interp: RemoteInterpolator;
  state: NetPlayer;
  weaponId?: string;
  /** weapon id whose model is currently attached ('' = none yet) */
  modelWeaponId: string;
  target: HitTarget;
  lastPos: THREE.Vector3;
  /** melee swings / gun recoils played (tests) */
  melees: number;
  recoils: number;
  nameTag: THREE.Sprite;
  tagText: string;
}

/**
 * Renders remote players from NetClient snapshots with interpolation, and gives each kinematic
 * head + body hitboxes (lowered while crouched) so local hitscan can hit them; hits are
 * reported with their zone to the server, which is authoritative.
 */
export class RemotePlayers {
  private remotes = new Map<string, Remote>();
  private unsub: () => void;
  private unsubWeapons?: () => void;
  private unsubPose?: () => void;
  private readonly unsubParts: () => void;
  /** per-frame hook (tests: trace rendered positions) */
  onFrame?: (now: number) => void;
  /** where status particles (burning / chilled) go; set by the game once its effects exist */
  fx?: ParticleSink;
  private statusTime = 0;

  constructor(
    private readonly net: NetClient,
    private readonly physics: PhysicsContext,
    private readonly scene: THREE.Scene,
    private readonly targets: TargetRegistry,
  ) {
    this.unsub = net.onPlayersChanged((players) => this.applyRoster(players));
    this.unsubPose = net.onPose?.((id, snap) => this.applyPose(id, snap));
    // weapon rows may arrive after the player row: retry missing models
    this.unsubWeapons = net.onWeaponsChanged?.(() => {
      for (const r of this.remotes.values()) if (r.modelWeaponId !== (r.weaponId ?? '')) this.setWeapon(r, r.weaponId);
    });
    // models built before the part library loaded are placeholders: rebuild them
    this.unsubParts = onPartsLibrary(() => {
      for (const r of this.remotes.values()) if (r.modelWeaponId) this.setWeapon(r, r.weaponId);
    });
  }

  /** remote player ids currently in the scene */
  ids(): string[] {
    return [...this.remotes.keys()];
  }

  get(id: string):
    | {
        state: NetPlayer;
        position: THREE.Vector3;
        visible: boolean;
        hasWeaponModel: boolean;
        crouchT: number;
        head: THREE.Vector3;
        /** elemental status (burning / chilled / ...) and the body glow shown for it */
        status: PlayerStatus;
        tint: number;
        /** third-person animation state */
        anim: { action: string; swing: string; combo: number; charge: number; u: number; blocking: boolean; armX: number; armY: number; twist: number; melees: number; recoils: number };
      }
    | undefined {
    const r = this.remotes.get(id);
    if (!r) return undefined;
    return {
      state: r.state,
      position: r.model.root.position.clone(),
      visible: r.model.root.visible,
      hasWeaponModel: r.model.hand.children.length > 0,
      crouchT: r.crouchT,
      head: this.headOf(id)!,
      status: playerStatus(r.state),
      tint: r.model.statusTint,
      anim: {
        action: r.model.action?.kind ?? 'none',
        swing: r.model.action?.swing ?? '',
        combo: r.model.action?.combo ?? 0,
        charge: r.model.action?.charge ?? 0,
        u: r.model.armPose.u,
        blocking: r.model.blocking,
        armX: r.model.armPose.x,
        armY: r.model.armPose.y,
        twist: r.model.armPose.twist,
        melees: r.melees,
        recoils: r.recoils,
      },
    };
  }

  /**
   * A remote player fired: melee weapons play their swing (skipping the wind-up, since the shot
   * is sent when the strike window opens), guns a recoil pose.
   */
  playShot(id: string, w: Weapon, charge = 0, combo = 0) {
    const r = this.remotes.get(id);
    if (!r) return;
    if (w.fireMode === 'melee') {
      const meta = meleeMetaOf(w);
      const ph = MELEE_PHASES[meta.swing];
      r.model.playMelee(meta.swing, combo, charge, meleeSwingDuration(meta.weight, charge, combo), ph.strikeStart);
      r.melees++;
    } else if (w.class === 'throwable') {
      r.model.playThrow(THROW_TIME);
      r.recoils++;
    } else {
      r.model.playRecoil(Math.min(1.5, 0.4 + (w.damage * w.pellets) / 40));
      r.recoils++;
    }
  }

  /** colliders of a remote player (shot raycasts exclude the shooter's own hitboxes) */
  collidersOf(id: string): RAPIER.Collider[] {
    const r = this.remotes.get(id);
    return r ? [r.hitboxes.body, r.hitboxes.head] : [];
  }

  /** interpolated body centre (for aiming) */
  centerOf(id: string, out = new THREE.Vector3()): THREE.Vector3 | undefined {
    const r = this.remotes.get(id);
    if (!r) return undefined;
    return out.copy(r.model.root.position).setY(r.model.root.position.y + CENTER_OFFSET - 0.3 * r.crouchT);
  }

  /** interpolated head-hitbox centre (for aiming / tests) */
  headOf(id: string, out = new THREE.Vector3()): THREE.Vector3 | undefined {
    const r = this.remotes.get(id);
    if (!r) return undefined;
    return out.copy(r.model.root.position).setY(r.model.root.position.y + Hitboxes.headHeight(r.crouchT));
  }

  /** player rows (name, hp, alive, weapon, ...): no movement data, never pushes snapshots */
  private applyRoster(players: NetPlayer[]) {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === this.net.localId) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) r = this.create(p);
      // respawn: don't interpolate from the death spot to the spawn point
      if (p.alive && !r.state.alive) r.interp.snapNext();
      r.state = p;
      r.model.root.visible = p.alive;
      r.hitboxes.setEnabled(p.alive);
      if (p.color) r.model.setColor(p.color);
      if (p.weaponId !== r.weaponId || r.modelWeaponId !== (p.weaponId ?? '')) this.setWeapon(r, p.weaponId);
      const tag = `${p.name}  ${Math.max(0, Math.round(p.hp))}`;
      if (tag !== r.tagText) {
        r.tagText = tag;
        drawNameTag(r.nameTag, p.name, p.hp);
      }
    }
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.removeRemote(id);
  }

  /** one pose row changed: exactly one snapshot for that player */
  private applyPose(id: string, snap: PoseSnapshot) {
    const r = this.remotes.get(id);
    if (!r) return; // roster arrives first (or replays the pose via create)
    r.interp.push(snap);
    r.state = { ...r.state, pos: [...snap.pos], yaw: snap.yaw, pitch: snap.pitch, crouching: snap.crouching };
    r.model.blocking = !!snap.blocking;
  }

  /** interpolation debug for one remote (tests) */
  debugOf(id: string) {
    const r = this.remotes.get(id);
    if (!r) return undefined;
    return { ...r.interp.stats(performance.now()), extrapolating: !!r.interp.last?.extrapolating };
  }

  /** interpolation stats (F3 overlay / tests), averaged over remotes */
  netStats(): (InterpStats & { remotes: number }) | undefined {
    const now = performance.now();
    const all = [...this.remotes.values()].map((r) => r.interp.stats(now));
    if (!all.length) return undefined;
    const avg = (k: keyof InterpStats) => all.reduce((a, s) => a + s[k], 0) / all.length;
    return { delay: avg('delay'), targetDelay: avg('targetDelay'), jitter: avg('jitter'), interval: avg('interval'), buffered: avg('buffered'), remotes: all.length };
  }

  private create(p: NetPlayer): Remote {
    const { RAPIER, world } = this.physics;
    const model = new Humanoid(p.color ?? 0xd04040);
    this.scene.add(model.root);
    // body origin = feet; hitboxes are offset from it
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.pos[0], p.pos[1], p.pos[2]));
    const nameTag = createNameTag();
    nameTag.position.set(0, 2.15, 0);
    model.root.add(nameTag);
    model.root.position.set(...p.pos);
    const r: Remote = {
      id: p.id,
      model,
      body,
      hitboxes: undefined as unknown as Hitboxes,
      crouchT: p.crouching ? 1 : 0,
      interp: new RemoteInterpolator({ pos: p.pos, yaw: p.yaw, pitch: p.pitch, crouching: p.crouching }),
      state: p,
      modelWeaponId: '',
      nameTag,
      tagText: '',
      melees: 0,
      recoils: 0,
      lastPos: new THREE.Vector3(...p.pos),
      target: {
        id: p.id,
        kind: 'player',
        getCenter: (out) => out.copy(model.root.position).setY(model.root.position.y + CENTER_OFFSET - 0.3 * r.crouchT),
        alive: () => r.state.alive,
        applyDamage: (_amount, weaponId, info) => {
          this.net.reportHit(p.id, weaponId, info);
          return false; // server decides
        },
      },
    };
    r.hitboxes = new Hitboxes(this.physics, body, this.targets, r.target);
    this.remotes.set(p.id, r);
    const pose = this.net.getPose?.(p.id);
    if (pose) r.interp.push(pose);
    return r;
  }

  private setWeapon(r: Remote, weaponId?: string) {
    r.weaponId = weaponId;
    const w = weaponId ? this.net.getWeapon?.(weaponId) : undefined;
    if (!w) return;
    r.model.hand.clear();
    r.modelWeaponId = weaponId ?? '';
    const m = buildWeaponModel(w).root;
    // third person: keep weapons hand-sized (huge LLM guns would hide the body)
    const bb = new THREE.Box3().setFromObject(m);
    const size = bb.getSize(new THREE.Vector3());
    const maxLen = w.fireMode === 'melee' ? 1.6 : 0.9;
    const s = Math.min(1, maxLen / Math.max(size.x, size.y, size.z, 0.001));
    m.scale.multiplyScalar(s);
    if (w.fireMode === 'melee') m.rotation.x = 1.0; // blade up/forward, handle in the hand
    r.model.hand.add(m);
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.hitboxes.dispose();
    this.physics.world.removeRigidBody(r.body);
    this.scene.remove(r.model.root);
    (r.nameTag.material as THREE.SpriteMaterial).map?.dispose();
    r.nameTag.material.dispose();
    r.model.dispose();
    this.remotes.delete(id);
  }

  /** call every render frame; `now` = the frame's timestamp (same clock as performance.now()) */
  update(dt: number, now = performance.now()) {
    this.statusTime += dt;
    const wall = Date.now();
    for (const r of this.remotes.values()) {
      // elemental status: body glow (fire flickers) + particles
      const status = playerStatus(r.state, wall);
      const tint = statusTint(status);
      if (tint) {
        const flicker = tint === 'fire' ? 0.55 + 0.25 * Math.sin(this.statusTime * 23 + r.melees) * Math.sin(this.statusTime * 7.3) : tint === 'shock' ? (Math.random() < 0.5 ? 0.9 : 0.2) : 0.55;
        r.model.setStatusTint(ELEMENT_LOOK[tint].tint, flicker);
        if (this.fx && r.model.root.visible) emitStatusParticles(this.fx, status, r.model.root.position, 1.8 - 0.6 * r.crouchT, dt);
      } else r.model.setStatusTint(null);
      const st = r.interp.update(now);
      if (!st) continue;
      const [x, y, z] = st.pos;
      // crouch: ease toward the (delayed) snapshot state; model + hitboxes follow the same blend
      const ct = st.crouching ? 1 : 0;
      r.crouchT = ct > r.crouchT ? Math.min(ct, r.crouchT + dt * CROUCH_RATE) : Math.max(ct, r.crouchT - dt * CROUCH_RATE);
      r.model.setCrouch(r.crouchT);
      r.hitboxes.setCrouch(r.crouchT);
      r.nameTag.position.y = 2.15 - 0.6 * r.crouchT;
      r.model.root.position.set(x, y, z);
      r.model.root.rotation.y = st.yaw;
      r.model.setPitch(st.pitch);
      const speed = dt > 0 ? Math.hypot(x - r.lastPos.x, z - r.lastPos.z) / dt : 0;
      r.model.animate(dt, speed);
      r.lastPos.set(x, y, z);
      r.body.setNextKinematicTranslation({ x, y, z });
    }
    this.onFrame?.(now);
  }

  dispose() {
    this.unsub();
    this.unsubWeapons?.();
    this.unsubPose?.();
    this.unsubParts();
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
  }
}

function createNameTag(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function drawNameTag(sprite: THREE.Sprite, name: string, hp: number) {
  const tex = (sprite.material as THREE.SpriteMaterial).map as THREE.CanvasTexture;
  const canvas = tex.image as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(8, 4, 240, 40);
  g.font = 'bold 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(name.slice(0, 18), 128, 24);
  // hp bar
  const f = Math.max(0, Math.min(1, hp / 100));
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(28, 50, 200, 8);
  g.fillStyle = f > 0.5 ? '#4ade80' : f > 0.25 ? '#fbbf24' : '#ef4444';
  g.fillRect(28, 50, 200 * f, 8);
  tex.needsUpdate = true;
}
