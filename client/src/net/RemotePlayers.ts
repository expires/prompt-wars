import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsContext } from '../engine/physics';
import { Humanoid } from '../player/humanoid';
import { CENTER_OFFSET } from '../player/PlayerController';
import { Hitboxes } from '../player/hitboxes';
import { buildWeaponModel } from '../weapons/buildWeaponModel';
import type { HitTarget, TargetRegistry } from '../weapons/targets';
import type { NetClient, NetPlayer } from './NetClient';

/** render remote players this far in the past so we always have two snapshots to blend */
const INTERP_DELAY_MS = 100;
const MAX_SNAPSHOTS = 30;
/** crouch blend speed (full transition in ~0.15 s) */
const CROUCH_RATE = 1 / 0.15;

interface Snapshot {
  t: number;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  crouching: boolean;
}

interface Remote {
  id: string;
  model: Humanoid;
  body: RAPIER.RigidBody;
  hitboxes: Hitboxes;
  /** 0 standing .. 1 crouched (smoothed) */
  crouchT: number;
  snaps: Snapshot[];
  state: NetPlayer;
  weaponId?: string;
  /** weapon id whose model is currently attached ('' = none yet) */
  modelWeaponId: string;
  target: HitTarget;
  lastPos: THREE.Vector3;
  nameTag: THREE.Sprite;
  tagText: string;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
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

  constructor(
    private readonly net: NetClient,
    private readonly physics: PhysicsContext,
    private readonly scene: THREE.Scene,
    private readonly targets: TargetRegistry,
  ) {
    this.unsub = net.onPlayersChanged((players) => this.applySnapshot(players));
    // weapon rows may arrive after the player row: retry missing models
    this.unsubWeapons = net.onWeaponsChanged?.(() => {
      for (const r of this.remotes.values()) if (r.modelWeaponId !== (r.weaponId ?? '')) this.setWeapon(r, r.weaponId);
    });
  }

  /** remote player ids currently in the scene */
  ids(): string[] {
    return [...this.remotes.keys()];
  }

  get(id: string):
    | { state: NetPlayer; position: THREE.Vector3; visible: boolean; hasWeaponModel: boolean; crouchT: number; head: THREE.Vector3 }
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
    };
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

  private applySnapshot(players: NetPlayer[]) {
    const now = performance.now();
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === this.net.localId) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) r = this.create(p);
      r.state = p;
      r.snaps.push({ t: now, pos: new THREE.Vector3(...p.pos), yaw: p.yaw, pitch: p.pitch, crouching: !!p.crouching });
      if (r.snaps.length > MAX_SNAPSHOTS) r.snaps.shift();
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
      snaps: [],
      state: p,
      modelWeaponId: '',
      nameTag,
      tagText: '',
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
    return r;
  }

  private setWeapon(r: Remote, weaponId?: string) {
    r.weaponId = weaponId;
    const w = weaponId ? this.net.getWeapon?.(weaponId) : undefined;
    if (!w) return;
    r.model.hand.clear();
    r.modelWeaponId = weaponId ?? '';
    const m = buildWeaponModel(w).root;
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

  /** call every render frame */
  update(dt: number) {
    const renderT = performance.now() - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      const s = r.snaps;
      if (!s.length) continue;
      let pos: THREE.Vector3, yaw: number, pitch: number, crouching: boolean;
      // find the pair surrounding renderT
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > renderT) i--;
      if (i === 0 || s[i].t <= renderT) {
        const last = s[Math.min(i, s.length - 1)];
        pos = last.pos;
        yaw = last.yaw;
        pitch = last.pitch;
        crouching = last.crouching;
      } else {
        const a = s[i - 1], b = s[i];
        const t = THREE.MathUtils.clamp((renderT - a.t) / Math.max(1, b.t - a.t), 0, 1);
        pos = a.pos.clone().lerp(b.pos, t);
        yaw = lerpAngle(a.yaw, b.yaw, t);
        pitch = THREE.MathUtils.lerp(a.pitch, b.pitch, t);
        crouching = a.crouching;
      }
      // crouch: ease toward the (delayed) snapshot state; model + hitboxes follow the same blend
      const ct = crouching ? 1 : 0;
      r.crouchT = ct > r.crouchT ? Math.min(ct, r.crouchT + dt * CROUCH_RATE) : Math.max(ct, r.crouchT - dt * CROUCH_RATE);
      r.model.setCrouch(r.crouchT);
      r.hitboxes.setCrouch(r.crouchT);
      r.nameTag.position.y = 2.15 - 0.6 * r.crouchT;
      r.model.root.position.copy(pos);
      r.model.root.rotation.y = yaw;
      r.model.setPitch(pitch);
      const speed = dt > 0 ? Math.hypot(pos.x - r.lastPos.x, pos.z - r.lastPos.z) / dt : 0;
      r.model.animate(dt, speed);
      r.lastPos.copy(pos);
      r.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    }
  }

  dispose() {
    this.unsub();
    this.unsubWeapons?.();
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
