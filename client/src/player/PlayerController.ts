import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsContext } from '../engine/physics';
import { GRAVITY } from '../engine/physics';
import type { Input } from '../engine/input';

export const CAPSULE_HALF_HEIGHT = 0.55;
export const CAPSULE_RADIUS = 0.35;
/** feet -> capsule center */
export const CENTER_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS; // 0.9 => 1.8m tall
export const EYE_HEIGHT = 1.62;

const WALK_SPEED = 5.5;
const SPRINT_SPEED = 8.5;
const JUMP_SPEED = 7;
const GROUND_ACCEL = 60;
const AIR_ACCEL = 12;
const MOUSE_SENS = 0.0022;

/**
 * First-person kinematic character using Rapier's KinematicCharacterController.
 * - capsule collider on a kinematic position-based body
 * - autostep 0.4m (stairs), max climb slope 45deg, snap-to-ground, sliding along walls
 * - runs in the fixed physics step; camera is interpolated between steps
 */
export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly cc: RAPIER.KinematicCharacterController;
  private readonly physics: PhysicsContext;

  yaw = 0;
  pitch = 0;
  readonly velocity = new THREE.Vector3();
  grounded = false;
  /** when false, no movement input is applied (dead / menu); gravity still applies */
  inputEnabled = true;
  /** when true, the body is frozen entirely */
  frozen = false;
  /** movement speed multiplier (server slow effects); 1 = normal */
  speedScale = 1;

  private readonly prevFeet = new THREE.Vector3();
  private readonly curFeet = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(physics: PhysicsContext, private readonly input: Input, spawn: THREE.Vector3) {
    this.physics = physics;
    const { RAPIER, world } = physics;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + CENTER_OFFSET, spawn.z),
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS), this.body);

    this.cc = world.createCharacterController(0.02);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableAutostep(0.4, 0.15, false);
    this.cc.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((46 * Math.PI) / 180);
    this.cc.enableSnapToGround(0.45);
    this.cc.setSlideEnabled(true);
    this.cc.setApplyImpulsesToDynamicBodies(false);

    this.curFeet.copy(spawn);
    this.prevFeet.copy(spawn);
  }

  /** Per-frame mouse look (not tied to the physics rate). */
  look(): { dx: number; dy: number } {
    const d = this.input.consumeMouse();
    const { dx, dy } = d;
    if (!this.inputEnabled) return { dx: 0, dy: 0 };
    this.yaw -= dx * MOUSE_SENS;
    this.pitch -= dy * MOUSE_SENS;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    return d;
  }

  /** One fixed physics step. Call before world.step(). */
  fixedUpdate(dt: number) {
    this.prevFeet.copy(this.curFeet);
    if (this.frozen) return;
    const i = this.input;
    const wish = this.tmp.set(0, 0, 0);
    if (this.inputEnabled) {
      if (i.isDown('KeyW')) wish.z -= 1;
      if (i.isDown('KeyS')) wish.z += 1;
      if (i.isDown('KeyA')) wish.x -= 1;
      if (i.isDown('KeyD')) wish.x += 1;
    }
    if (wish.lengthSq() > 0) wish.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
    const sprint = this.inputEnabled && i.isDown('ShiftLeft') && wish.lengthSq() > 0;
    const speed = (sprint ? SPRINT_SPEED : WALK_SPEED) * this.speedScale;
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;

    // accelerate horizontal velocity toward the wish velocity
    const tx = wish.x * speed - this.velocity.x;
    const tz = wish.z * speed - this.velocity.z;
    const tl = Math.hypot(tx, tz);
    const maxDv = accel * dt;
    if (tl > 0) {
      const k = Math.min(1, maxDv / tl);
      this.velocity.x += tx * k;
      this.velocity.z += tz * k;
    }

    // gravity + jump
    if (this.grounded && this.velocity.y <= 0) this.velocity.y = -1; // keep pressed to ground
    if (this.grounded && this.inputEnabled && i.isDown('Space')) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.velocity.y += GRAVITY * dt;

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.cc.computeColliderMovement(this.collider, desired, this.physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const move = this.cc.computedMovement();
    this.grounded = this.cc.computedGrounded();

    // bonked a ceiling
    if (this.velocity.y > 0 && move.y < desired.y * 0.5) this.velocity.y = 0;
    // NOTE: we deliberately do NOT clamp horizontal velocity to the achieved
    // movement when blocked. Rapier's autostep only triggers when the requested
    // horizontal step is large enough (~>0.04m/step); zeroing velocity against a
    // stair riser would leave us stuck at low speed. Wall-sliding is handled by
    // the controller, and velocity converges to the wish velocity anyway.

    const t = this.body.translation();
    const next = { x: t.x + move.x, y: t.y + move.y, z: t.z + move.z };
    this.body.setNextKinematicTranslation(next);
    this.curFeet.set(next.x, next.y - CENTER_OFFSET, next.z);
  }

  /** Place the camera at interpolated eye position. alpha = accumulator / dt. */
  updateCamera(camera: THREE.Camera, alpha: number) {
    camera.position.lerpVectors(this.prevFeet, this.curFeet, alpha);
    camera.position.y += EYE_HEIGHT;
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  get feet(): THREE.Vector3 {
    return this.curFeet;
  }

  horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** add an instantaneous velocity change (knockback), m/s */
  applyImpulse(v: THREE.Vector3) {
    this.velocity.add(v);
    if (v.y > 0) this.grounded = false;
  }

  teleport(feet: THREE.Vector3, yaw?: number) {
    this.body.setTranslation({ x: feet.x, y: feet.y + CENTER_OFFSET, z: feet.z }, true);
    this.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + CENTER_OFFSET, z: feet.z });
    this.curFeet.copy(feet);
    this.prevFeet.copy(feet);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.pitch = 0;
  }
}
