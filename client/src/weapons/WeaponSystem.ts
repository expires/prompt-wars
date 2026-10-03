import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsContext } from '../engine/physics';
import type { Input } from '../engine/input';
import { HIT_ZONE_BODY, HIT_ZONE_HEAD, zoneDamage } from '@ai-gaem/shared';
import { Effects } from './effects';
import { Viewmodel } from './Viewmodel';
import type { HitInfo, HitTarget, TargetRegistry } from './targets';
import { resolveFireMode, type FireMode, type Weapon } from './types';
import { effectiveSpread, weaponHandling, type Handling, type MoveState } from './handling';
import { WALK_SPEED } from '../player/PlayerController';

const ARC_GRAVITY = 12;
const DEG = Math.PI / 180;

interface Projectile {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  ttl: number;
  mesh: THREE.Mesh;
  /** visual offset from logical pos (starts at muzzle, decays to 0) */
  visOffset: THREE.Vector3;
  damage: number;
  splash: number;
  /** shot sequence number (for server hit reports) */
  seq: number;
  /** remote player's shot: visuals only, never deals damage */
  visualOnly: boolean;
}

export interface WeaponEvents {
  /** a target was hit locally (zone 1 = head); damage is the local estimate */
  onHit?(target: HitTarget, damage: number, killed: boolean, zone: number): void;
  /** recoil aim punch for this shot (degrees) */
  onRecoil?(pitchDeg: number, yawDeg: number): void;
  /** a projectile / grenade exploded (sound) */
  onExplosion?(pos: THREE.Vector3, remote: boolean): void;
  onAmmoChanged?(ammo: number, mag: number, reloading: boolean): void;
  onFire?(weapon: Weapon): void;
  /** a shot left the gun: returns the network shot sequence number */
  onShot?(origin: THREE.Vector3, dir: THREE.Vector3): number;
  /** a reload started */
  onReload?(): void;
}

/**
 * Local weapon logic: fire rate, magazine, reload, and the five fire modes
 * (hitscan, projectile, arc, stream, melee). Hits are resolved against the
 * Rapier world; targets come from the TargetRegistry.
 */
export class WeaponSystem {
  weapon!: Weapon;
  fireMode: FireMode = 'hitscan';
  ammo = 0;
  reloading = false;
  private reloadT = 0;
  private cooldown = 0;
  private projectiles: Projectile[] = [];
  readonly effects: Effects;
  readonly viewmodel: Viewmodel;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly projGeo = new THREE.SphereGeometry(0.08, 8, 6);
  handling!: Handling;
  /** current spread bloom (degrees) */
  bloom = 0;
  /** test hook: no spread, no bloom, no recoil (deterministic e2e aiming) */
  perfectAim = false;
  /** movement state for the spread model (set by the game) */
  moveState: MoveState = { speed: 0, grounded: true, crouched: false, ads: 0 };

  constructor(
    private readonly physics: PhysicsContext,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    viewScene: THREE.Scene,
    viewCamera: THREE.PerspectiveCamera,
    private readonly targets: TargetRegistry,
    private readonly ownCollider: RAPIER.Collider,
    private readonly events: WeaponEvents = {},
  ) {
    this.effects = new Effects(scene);
    this.viewmodel = new Viewmodel(viewScene, viewCamera);
  }

  get weaponId() {
    return this.weapon.id ?? this.weapon.name;
  }

  get infiniteAmmo() {
    return this.fireMode === 'melee' || this.weapon.magSize <= 0;
  }

  setWeapon(w: Weapon) {
    this.weapon = w;
    this.fireMode = resolveFireMode(w);
    this.handling = weaponHandling(w);
    this.bloom = 0;
    this.viewmodel.hideWhenAimed = w.class === 'sniper';
    this.ammo = Math.max(0, w.magSize);
    this.reloading = false;
    this.viewmodel.reloadProgress = -1;
    this.cooldown = 0.2;
    this.viewmodel.setWeapon(w);
    this.emitAmmo();
  }

  /** refill without rebuilding the model (respawn w/ same loadout) */
  refill() {
    this.ammo = Math.max(0, this.weapon.magSize);
    this.reloading = false;
    this.viewmodel.reloadProgress = -1;
    this.emitAmmo();
  }

  private emitAmmo() {
    this.events.onAmmoChanged?.(this.infiniteAmmo ? Infinity : this.ammo, this.weapon.magSize, this.reloading);
  }

  startReload() {
    if (this.reloading || this.infiniteAmmo || this.ammo >= this.weapon.magSize) return;
    this.reloading = true;
    this.reloadT = 0;
    this.events.onReload?.();
    this.emitAmmo();
  }

  /**
   * Fire one shot right now, ignoring the local fire-rate cooldown (test hook: lets e2e tests
   * check that the *server* enforces fire rate). Still consumes ammo; returns false when empty.
   */
  fireOnce(): boolean {
    if (this.reloading) return false;
    if (!this.infiniteAmmo && this.ammo <= 0) {
      this.startReload();
      return false;
    }
    this.fire();
    if (!this.infiniteAmmo) this.ammo--;
    this.emitAmmo();
    return true;
  }

  /** current effective spread (degrees) for hitscan / projectile shots */
  currentSpread(): number {
    if (this.perfectAim) return 0;
    if (this.fireMode === 'stream' || this.fireMode === 'melee') return this.weapon.spread;
    return effectiveSpread(this.weapon, this.handling, this.moveState, this.bloom, WALK_SPEED);
  }

  update(dt: number, input: Input, canFire: boolean) {
    const w = this.weapon;
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - this.handling.bloomRecovery * dt);

    if (this.reloading) {
      this.reloadT += dt;
      this.viewmodel.reloadProgress = Math.min(1, this.reloadT / Math.max(0.05, w.reloadTime));
      if (this.reloadT >= w.reloadTime) {
        this.reloading = false;
        this.viewmodel.reloadProgress = -1;
        this.ammo = w.magSize;
        this.emitAmmo();
      }
    }

    if (canFire && input.wasPressed('KeyR')) this.startReload();

    const wantsFire = canFire && input.mouseDown;
    if (wantsFire && !this.reloading) {
      if (!this.infiniteAmmo && this.ammo <= 0) {
        this.startReload();
      } else {
        let guard = 0;
        while (this.cooldown <= 0 && guard++ < 4 && (this.infiniteAmmo || this.ammo > 0)) {
          this.fire();
          this.cooldown += 1 / Math.max(0.1, w.fireRate);
          if (!this.infiniteAmmo) this.ammo--;
          this.emitAmmo();
        }
      }
    }
    if (this.cooldown < 0) this.cooldown = 0;

    this.updateProjectiles(dt);
    this.effects.update(dt);
  }

  // ---------------------------------------------------------------- firing

  private aimDir(spreadDeg: number, out: THREE.Vector3) {
    this.camera.getWorldDirection(out);
    if (spreadDeg > 0) {
      // uniform random point in a cone
      const r = Math.sqrt(Math.random()) * Math.tan(spreadDeg * DEG);
      const a = Math.random() * Math.PI * 2;
      const right = this.tmpB.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      out.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    }
    return out;
  }

  /** Raycast the world (excluding ourselves). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) {
    const { RAPIER, world } = this.physics;
    const ray = new RAPIER.Ray(origin, dir);
    const hit = world.castRayAndGetNormal(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.ownCollider);
    if (!hit) return null;
    return {
      point: origin.clone().addScaledVector(dir, hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      distance: hit.timeOfImpact,
    };
  }

  private curSeq = 0;

  private fire() {
    const w = this.weapon;
    this.events.onFire?.(w);
    const muzzle = this.viewmodel.muzzleWorld(this.camera, new THREE.Vector3());
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    this.curSeq = this.events.onShot?.(eye, this.camera.getWorldDirection(new THREE.Vector3())) ?? 0;
    this.pendingHits.clear();
    const spread = this.currentSpread();
    const h = this.handling;
    if (!this.perfectAim) {
      const ads = this.moveState.ads;
      const k = (1 - 0.3 * ads) * (this.moveState.crouched && this.moveState.grounded ? 0.85 : 1);
      if (h.kickPitch > 0) this.events.onRecoil?.(h.kickPitch * k * (0.85 + Math.random() * 0.3), (Math.random() * 2 - 1) * h.kickYaw * k);
      this.bloom = Math.min(h.bloomMax, this.bloom + h.bloomPerShot);
    }
    switch (this.fireMode) {
      case 'hitscan':
        this.viewmodel.kick(h.vmKick);
        this.effects.muzzleLight(muzzle);
        for (let i = 0; i < Math.max(1, w.pellets); i++) this.fireHitscan(eye, muzzle, spread);
        // one report per target per shot, with the number of pellets that connected. Head zone
        // only if most connecting pellets hit the head (single-pellet guns: that pellet).
        for (const [t, hit] of this.pendingHits) {
          const zone = hit.head * 2 > hit.pellets ? HIT_ZONE_HEAD : HIT_ZONE_BODY;
          this.damageTarget(t, w.damage * hit.pellets, { seq: this.curSeq, pellets: hit.pellets, point: hit.point, zone });
        }
        this.pendingHits.clear();
        break;
      case 'projectile':
      case 'arc':
        this.viewmodel.kick(Math.max(0.6, h.vmKick));
        this.effects.muzzleLight(muzzle);
        for (let i = 0; i < Math.max(1, w.pellets); i++) this.spawnProjectile(eye, muzzle, this.fireMode === 'arc', w, undefined, false, spread);
        break;
      case 'stream':
        this.viewmodel.kick(0.08);
        this.fireStream(eye, muzzle);
        break;
      case 'melee':
        this.viewmodel.meleeSwing();
        this.fireMelee(eye);
        break;
    }
  }

  private readonly pendingHits = new Map<HitTarget, { pellets: number; head: number; point: [number, number, number] }>();

  /** `dmg` = body damage; the head multiplier is applied here for the local estimate (dummies) */
  private damageTarget(t: HitTarget, dmg: number, info: HitInfo) {
    if (!t.alive()) return;
    const amount = zoneDamage(this.weapon, dmg, info.zone);
    const killed = t.applyDamage(amount, this.weaponId, info);
    this.events.onHit?.(t, amount, killed, info.zone);
  }

  private info(point: THREE.Vector3, seq = this.curSeq, pellets = 1, zone = HIT_ZONE_BODY): HitInfo {
    return { seq, pellets, point: [point.x, point.y, point.z], zone };
  }

  private fireHitscan(eye: THREE.Vector3, muzzle: THREE.Vector3, spread: number) {
    const w = this.weapon;
    const dir = this.aimDir(spread, this.tmpA);
    const hit = this.raycast(eye, dir, w.range);
    const end = hit ? hit.point : eye.clone().addScaledVector(dir, w.range);
    this.effects.tracer(muzzle, end, w.colors?.accent ?? 0xffe9a0);
    if (!hit) return;
    const th = this.targets.hitFromCollider(hit.collider);
    const target = th?.target;
    if (th && target) {
      const isHead = th.zone === HIT_ZONE_HEAD;
      const h = this.pendingHits.get(target);
      if (h) {
        h.pellets++;
        if (isHead) {
          h.head++;
          h.point = [hit.point.x, hit.point.y, hit.point.z];
        }
      } else if (target.alive()) this.pendingHits.set(target, { pellets: 1, head: isHead ? 1 : 0, point: [hit.point.x, hit.point.y, hit.point.z] });
      this.effects.impact(hit.point, hit.normal, isHead ? 0xffd040 : 0xff3030);
    } else {
      this.effects.impact(hit.point, hit.normal);
    }
    if (w.splashRadius > 0) this.splash(hit.point, w.splashRadius, w.damage, target, this.curSeq);
  }

  private spawnProjectile(
    eye: THREE.Vector3,
    muzzle: THREE.Vector3,
    arc: boolean,
    w = this.weapon,
    baseDir?: THREE.Vector3,
    visualOnly = false,
    spread = w.spread,
  ) {
    const dir = baseDir ? baseDir.clone() : this.aimDir(spread, this.tmpA).clone();
    if (arc) dir.y += 0.12;
    dir.normalize();
    const speed = w.projectileSpeed > 0 ? w.projectileSpeed : 30;
    const mesh = new THREE.Mesh(
      this.projGeo,
      new THREE.MeshBasicMaterial({ color: w.colors?.accent ?? 0xffaa33 }),
    );
    mesh.scale.setScalar(arc ? 1 : 1.3);
    this.scene.add(mesh);
    this.projectiles.push({
      pos: eye.clone(),
      vel: dir.multiplyScalar(speed),
      gravity: arc ? ARC_GRAVITY : 0,
      ttl: Math.max(0.5, (w.range / speed) * (arc ? 3 : 1.2)),
      mesh,
      visOffset: muzzle.clone().sub(eye),
      damage: w.damage,
      splash: w.splashRadius,
      seq: this.curSeq,
      visualOnly,
    });
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.ttl -= dt;
      p.vel.y -= p.gravity * dt;
      const step = p.vel.length() * dt;
      const dir = this.tmpA.copy(p.vel).normalize();
      const hit = step > 0 ? this.raycast(p.pos, dir, step) : null;
      if (hit || p.ttl <= 0) {
        const at = hit ? hit.point : p.pos;
        const th = hit && !p.visualOnly ? this.targets.hitFromCollider(hit.collider) : undefined;
        const target = th?.target;
        // splash weapons have headshotMultiplier 1, so the zone only matters for direct-hit projectiles
        if (target) this.damageTarget(target, p.damage, this.info(at, p.seq, 1, th.zone));
        if (p.splash > 0) {
          this.effects.explosion(at, p.splash);
          this.events.onExplosion?.(at, p.visualOnly);
          if (!p.visualOnly) this.splash(at, p.splash, p.damage, target, p.seq);
        } else this.effects.impact(at, hit?.normal);
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
        continue;
      }
      p.pos.addScaledVector(dir, step);
      p.visOffset.multiplyScalar(Math.exp(-dt * 12));
      p.mesh.position.copy(p.pos).add(p.visOffset);
      if (Math.random() < 0.6 && p.visOffset.lengthSq() < 0.01) this.effects.emit(p.mesh.position, new THREE.Vector3(), 0.3, 0x888888);
    }
  }

  /** splash damage with linear falloff; `exclude` already took a direct hit */
  private splash(center: THREE.Vector3, radius: number, damage: number, exclude: HitTarget | undefined, seq: number) {
    const c = new THREE.Vector3();
    for (const t of this.targets.all()) {
      if (t === exclude || !t.alive()) continue;
      const d = t.getCenter(c).distanceTo(center);
      if (d > radius) continue;
      // line of sight from blast to target center
      const dir = c.clone().sub(center);
      const len = dir.length();
      if (len > 0.01) {
        const hit = this.raycast(center.clone().addScaledVector(dir.normalize(), 0.05), dir, len);
        if (hit && this.targets.fromCollider(hit.collider) !== t) continue;
      }
      this.damageTarget(t, Math.round(damage * (1 - d / radius)), this.info(center, seq));
    }
  }

  private fireStream(eye: THREE.Vector3, muzzle: THREE.Vector3) {
    const w = this.weapon;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const cosHalf = Math.cos(Math.max(3, w.spread) * DEG);
    // particles
    const isBubble = w.class === 'bubble_gun';
    const fwdStart = this.viewmodel.muzzleWorld(this.camera, new THREE.Vector3(), 1.3);
    for (let i = 0; i < 6; i++) {
      const d = this.aimDir(Math.max(3, w.spread), new THREE.Vector3());
      const speed = (w.range / 0.45) * (0.7 + Math.random() * 0.3);
      const color = isBubble ? 0xa0e0ff : Math.random() < 0.5 ? 0xff7020 : 0xffc040;
      this.effects.emit(fwdStart, d.multiplyScalar(speed), 0.45, color);
    }
    this.effects.muzzleLight(muzzle, isBubble ? 0x80c0ff : 0xff8030);
    // cone damage with line-of-sight
    const c = new THREE.Vector3();
    for (const t of this.targets.all()) {
      if (!t.alive()) continue;
      const to = t.getCenter(c).sub(eye);
      const dist = to.length();
      if (dist > w.range + 0.5) continue;
      if (to.normalize().dot(fwd) < cosHalf && dist > 1.2) continue;
      const hit = this.raycast(eye, to, dist + 0.5);
      if (hit && this.targets.fromCollider(hit.collider) !== t) continue;
      this.damageTarget(t, w.damage, this.info(t.getCenter(new THREE.Vector3())));
    }
  }

  private fireMelee(eye: THREE.Vector3) {
    const w = this.weapon;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const reach = Math.max(1.5, w.range);
    let best: HitTarget | undefined;
    let bestD = Infinity;
    const c = new THREE.Vector3();
    for (const t of this.targets.all()) {
      if (!t.alive()) continue;
      const to = t.getCenter(c).sub(eye);
      // compare against capsule surface roughly: subtract radius
      const dist = to.length() - 0.35;
      if (dist > reach) continue;
      if (to.normalize().dot(fwd) < Math.cos(50 * DEG)) continue;
      if (dist < bestD) {
        best = t;
        bestD = dist;
      }
    }
    if (best) {
      this.damageTarget(best, w.damage, this.info(best.getCenter(new THREE.Vector3())));
      this.effects.impact(best.getCenter(c), undefined, 0xff3030);
    } else {
      const hit = this.raycast(eye, fwd, reach);
      if (hit) this.effects.impact(hit.point, hit.normal);
    }
  }

  // ------------------------------------------------------------ remote shots

  /** Visuals for a shot fired by another player (no damage; the server handles that). */
  playRemoteShot(w: Weapon, origin: THREE.Vector3, dir: THREE.Vector3, exclude: RAPIER.Collider[] = []) {
    const mode = resolveFireMode(w);
    const d = dir.clone().normalize();
    // start slightly in front of the shooter so the ray doesn't begin inside their capsule
    const start = origin.clone().addScaledVector(d, 0.45);
    switch (mode) {
      case 'hitscan': {
        const { RAPIER: R, world } = this.physics;
        const skip = new Set(exclude.map((c) => c.handle));
        const hit = world.castRay(new R.Ray(start, d), w.range, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (c) => !skip.has(c.handle));
        const end = hit ? start.clone().addScaledVector(d, hit.timeOfImpact) : start.clone().addScaledVector(d, w.range);
        this.effects.tracer(start, end, w.colors?.accent ?? 0xffe9a0);
        this.effects.muzzleLight(start);
        if (hit) this.effects.impact(end);
        break;
      }
      case 'projectile':
      case 'arc':
        this.spawnProjectile(start, start, mode === 'arc', w, d, true);
        break;
      case 'stream': {
        const isBubble = w.class === 'bubble_gun';
        for (let i = 0; i < 4; i++) {
          const v = d.clone().multiplyScalar((w.range / 0.45) * (0.7 + Math.random() * 0.3));
          v.x += (Math.random() - 0.5) * 3;
          v.y += (Math.random() - 0.5) * 3;
          v.z += (Math.random() - 0.5) * 3;
          this.effects.emit(start, v, 0.45, isBubble ? 0xa0e0ff : Math.random() < 0.5 ? 0xff7020 : 0xffc040);
        }
        break;
      }
      case 'melee':
        break;
    }
  }
}
