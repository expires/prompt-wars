import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d';
import { PLAYER_CROUCH_HEIGHT, PLAYER_HEIGHT } from '@ai-gaem/shared';
import type { PhysicsContext } from '../engine/physics';
import { GRAVITY } from '../engine/physics';
import type { Input } from '../engine/input';
import { BASE_MOUSE_SENS, settings } from '../settings';

export const CAPSULE_RADIUS = 0.35;
/** standing capsule half height (1.8 m tall) */
export const CAPSULE_HALF_HEIGHT = PLAYER_HEIGHT / 2 - CAPSULE_RADIUS; // 0.55
/** crouched capsule half height (1.2 m tall) */
export const CROUCH_HALF_HEIGHT = PLAYER_CROUCH_HEIGHT / 2 - CAPSULE_RADIUS; // 0.25
/** feet -> capsule center (standing) */
export const CENTER_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS; // 0.9
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = EYE_HEIGHT - (PLAYER_HEIGHT - PLAYER_CROUCH_HEIGHT); // 1.02

// ---- movement tuning (metres, seconds). Source/CS-style accelerate + friction. ----
export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 6.5;
export const CROUCH_SPEED = 2.2;
/** move speed multiplier while aiming down sights */
export const ADS_SPEED_MULT = 0.62;
/** Source `sv_accelerate`: per second, as a fraction of wish speed */
const GROUND_ACCEL = 10;
/** Source `sv_friction` */
const FRICTION = 6;
/** below this speed friction acts as if moving at STOP_SPEED (crisp stops) */
const STOP_SPEED = 1.6;
/** air control: Source-style air accelerate with a capped wish speed (limited, strafe-able) */
const AIR_ACCEL = 12;
const AIR_WISH_CAP = 0.8;
export const JUMP_HEIGHT = 1.1;
const JUMP_SPEED = Math.sqrt(2 * -GRAVITY * JUMP_HEIGHT); // ~6.6 m/s
/** jump still allowed this long after walking off a ledge */
const COYOTE_TIME = 0.1;
/** a jump pressed this long before landing still fires on touchdown */
const JUMP_BUFFER = 0.1;
/** extra jumps allowed while airborne (double jump) */
const AIR_JUMPS = 1;
const AIR_JUMP_SPEED = Math.sqrt(2 * -GRAVITY * (JUMP_HEIGHT * 0.85));
/** min time after any jump before an air jump can fire (stops one press double-firing) */
const AIR_JUMP_DELAY = 0.15;
/** eye height smoothing rate (1/s) for crouch transitions */
const EYE_LERP_RATE = 14;

/**
 * First-person kinematic character using Rapier's KinematicCharacterController.
 * - capsule collider on a kinematic position-based body (1.8 m, 1.2 m crouched)
 * - Source-style ground acceleration + friction, limited air control, coyote time, jump buffer
 * - walk / sprint (forward only) / crouch (hold or toggle) / crouch-jump (legs tuck in the air)
 * - autostep 0.4m (stairs), max climb slope 45deg, snap-to-ground, sliding along walls
 * - runs in the fixed physics step; camera is interpolated between steps
 */
export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly cc: RAPIER.KinematicCharacterController;
  private readonly physics: PhysicsContext;
  private readonly standShape: RAPIER.Capsule;

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
  /** aiming down sights (set by the game each frame): slower movement */
  aiming = false;
  /** currently crouched (collider is short) */
  crouched = false;
  /** currently sprinting (forward + shift, not crouched / aiming / shooting) */
  sprinting = false;
  /** test hook / scripted override for the crouch input (null = use keys) */
  forceCrouch: boolean | null = null;
  /** smoothed eye height above the feet (crouch transitions) */
  eyeHeight = EYE_HEIGHT;
  /** autorun (T): move forward without holding W; W or S cancels */
  autoRun = false;
  /** extra movement multiplier (blocking with a melee weapon) */
  moveMult = 1;
  /** gamepad look multiplier (aim slowdown over enemies), 1 = none */
  aimSlow = 1;
  /** sprint latched by toggle-sprint (Shift tap) or the gamepad's L3 */
  private sprintLatch = false;

  /** fired on takeoff */
  onJump?: () => void;
  /** fired on touchdown with the downward speed (m/s) */
  onLand?: (impactSpeed: number) => void;

  private crouchToggled = false;
  private jumpBuffer = 0;
  private airTime = 0;
  private jumpedAt = -1;
  private airJumpsLeft = AIR_JUMPS;
  private sprintBlock = 0;
  private time = 0;
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
    // slightly thinner than the real capsule so standing up next to a wall isn't refused
    this.standShape = new RAPIER.Capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS - 0.03);

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

  /** current capsule half height */
  get halfHeight() {
    return this.crouched ? CROUCH_HALF_HEIGHT : CAPSULE_HALF_HEIGHT;
  }

  /**
   * Per-frame input that must not be lost between fixed steps: mouse look, keyboard turning,
   * jump presses (buffered) and crouch toggling. `fovScale` scales sensitivity while zoomed.
   */
  frameInput(dt: number, fovScale = 1): { dx: number; dy: number } {
    const d = this.input.consumeMouse();
    if (!this.inputEnabled) return { dx: 0, dy: 0 };
    const s = settings.current;
    const i = this.input;
    const sens = BASE_MOUSE_SENS * s.sensitivity * fovScale * (this.aiming ? s.adsSensitivity : 1);
    this.yaw -= d.dx * sens;
    this.pitch -= d.dy * sens * (s.invertY ? -1 : 1);
    // keyboard turning (trackpad / palm-rejection fallback): arrows + Q/E
    const turn = ((s.keyTurnSpeed * Math.PI) / 180) * dt * fovScale;
    if (i.isDown('ArrowLeft') || i.isDown('KeyQ')) this.yaw += turn;
    if (i.isDown('ArrowRight') || i.isDown('KeyE')) this.yaw -= turn;
    if (i.isDown('ArrowUp')) this.pitch += turn * 0.7;
    if (i.isDown('ArrowDown')) this.pitch -= turn * 0.7;
    // gamepad right stick: rad/s at full deflection (after the response curve)
    const pad = i.pad;
    if (pad.connected && (pad.look[0] !== 0 || pad.look[1] !== 0)) {
      const rate = ((200 * Math.PI) / 180) * s.gamepadSensitivity * fovScale * this.aimSlow * (this.aiming ? s.adsSensitivity * 0.8 : 1);
      this.yaw -= pad.look[0] * rate * dt;
      this.pitch += pad.look[1] * rate * 0.75 * dt * (s.invertY ? -1 : 1);
    }
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));

    if (i.wasPressed('Space') || pad.jumpPressed) this.jumpBuffer = JUMP_BUFFER;
    if (s.crouchToggle && (i.wasPressed('KeyC') || i.wasPressed('ControlLeft') || i.wasPressed('ControlRight') || pad.crouchPressed)) {
      this.crouchToggled = !this.crouchToggled;
    }
    // autorun: T toggles, W / S (or pulling the stick back) cancels
    if (i.wasPressed('KeyT')) this.autoRun = !this.autoRun;
    else if (this.autoRun && (i.wasPressed('KeyW') || i.wasPressed('KeyS') || pad.move[1] < -0.5)) this.autoRun = false;
    // toggle sprint (Shift tap) / gamepad L3 click
    if ((s.sprintToggle && (i.wasPressed('ShiftLeft') || i.wasPressed('ShiftRight'))) || pad.sprintPressed) this.sprintLatch = !this.sprintLatch;
    return d;
  }

  /** request a jump (buffered like a key press) */
  queueJump() {
    this.jumpBuffer = JUMP_BUFFER;
  }

  /** shooting cancels sprint for a moment */
  blockSprint(seconds = 0.35) {
    this.sprintBlock = Math.max(this.sprintBlock, seconds);
    this.sprinting = false;
  }

  private wantsCrouch(): boolean {
    if (this.forceCrouch !== null) return this.forceCrouch;
    if (!this.inputEnabled) return false;
    if (settings.current.crouchToggle) return this.crouchToggled;
    const i = this.input;
    return i.isDown('KeyC') || i.isDown('ControlLeft') || i.isDown('ControlRight') || i.pad.crouch;
  }

  /** One fixed physics step. Call before world.step(). */
  fixedUpdate(dt: number) {
    this.prevFeet.copy(this.curFeet);
    this.time += dt;
    if (this.frozen) return;
    const i = this.input;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.sprintBlock = Math.max(0, this.sprintBlock - dt);
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    // ---- crouch ----
    const wantCrouch = this.wantsCrouch();
    if (wantCrouch && !this.crouched) this.setCrouched(true);
    else if (!wantCrouch && this.crouched) this.setCrouched(false);

    // ---- wish direction ----
    const wish = this.tmp.set(0, 0, 0);
    let fwd = 0;
    let analog = 1;
    if (this.inputEnabled) {
      if (i.isDown('KeyW') || this.autoRun) fwd += 1;
      if (i.isDown('KeyS')) fwd -= 1;
      if (i.isDown('KeyA')) wish.x -= 1;
      if (i.isDown('KeyD')) wish.x += 1;
      // gamepad left stick (analog: partial deflection walks slower)
      const pm = i.pad.move;
      if (pm[0] !== 0 || pm[1] !== 0) {
        const mag = Math.min(1, Math.hypot(pm[0], pm[1]));
        if (fwd === 0 && wish.x === 0) analog = Math.max(0.3, mag);
        fwd += pm[1];
        wish.x += pm[0];
      }
      fwd = Math.max(-1, Math.min(1, fwd));
      wish.z -= fwd;
    }
    const hasWish = wish.lengthSq() > 1e-6;
    if (hasWish) wish.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);

    // sprint: forward only (W, optionally diagonal), not crouched / aiming / just fired
    if (fwd <= 0.3 || this.crouched) this.sprintLatch = false;
    const sprintKey = (!settings.current.sprintToggle && (i.isDown('ShiftLeft') || i.isDown('ShiftRight'))) || this.sprintLatch;
    const canSprint = this.inputEnabled && sprintKey && fwd > 0 && !this.crouched && !this.aiming && this.sprintBlock <= 0;
    // keep sprint state through a jump, but only start sprinting on the ground
    this.sprinting = canSprint && (this.grounded || this.sprinting);

    let wishSpeed = this.crouched && this.grounded ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (this.aiming) wishSpeed = Math.min(wishSpeed, WALK_SPEED * ADS_SPEED_MULT);
    wishSpeed *= this.speedScale * this.moveMult * analog;

    // ---- jump (coyote time + buffer) ----
    const canJump = this.grounded || (this.airTime < COYOTE_TIME && this.time - this.jumpedAt > COYOTE_TIME + 0.05);
    let jumped = false;
    if (this.inputEnabled && this.jumpBuffer > 0 && canJump && this.velocity.y <= 0.5) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
      this.jumpBuffer = 0;
      this.jumpedAt = this.time;
      jumped = true;
      this.onJump?.();
    } else if (
      this.inputEnabled &&
      this.jumpBuffer > 0 &&
      !this.grounded &&
      this.airJumpsLeft > 0 &&
      this.time - this.jumpedAt > AIR_JUMP_DELAY
    ) {
      // double jump: resets vertical speed so it works on the way down too
      this.velocity.y = AIR_JUMP_SPEED;
      this.airJumpsLeft--;
      this.jumpBuffer = 0;
      this.jumpedAt = this.time;
      jumped = true;
      this.onJump?.();
    }
    if (this.grounded && !jumped) this.airJumpsLeft = AIR_JUMPS;

    // ---- horizontal: friction + accelerate (ground), capped accelerate (air) ----
    if (this.grounded && !jumped) {
      this.applyFriction(dt);
      if (hasWish) this.accelerate(wish, wishSpeed, GROUND_ACCEL, dt);
    } else if (hasWish) {
      this.accelerate(wish, Math.min(wishSpeed, AIR_WISH_CAP), AIR_ACCEL, dt);
    }

    // ---- vertical ----
    if (this.grounded && this.velocity.y <= 0) this.velocity.y = -1; // keep pressed to ground
    this.velocity.y += GRAVITY * dt;
    const fallSpeed = -this.velocity.y;

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.cc.computeColliderMovement(this.collider, desired, this.physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const move = this.cc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded() && !(jumped && this.velocity.y > 0);

    // bonked a ceiling
    if (this.velocity.y > 0 && move.y < desired.y * 0.5) this.velocity.y = 0;
    // NOTE: we deliberately do NOT clamp horizontal velocity to the achieved
    // movement when blocked. Rapier's autostep only triggers when the requested
    // horizontal step is large enough (~>0.04m/step); zeroing velocity against a
    // stair riser would leave us stuck at low speed. Wall-sliding is handled by
    // the controller, and velocity converges to the wish velocity anyway.

    if (!wasGrounded && this.grounded && this.airTime > 0.05) this.onLand?.(Math.max(0, fallSpeed));

    const t = this.body.translation();
    const next = { x: t.x + move.x, y: t.y + move.y, z: t.z + move.z };
    this.body.setNextKinematicTranslation(next);
    this.curFeet.set(next.x, next.y - this.halfHeight - CAPSULE_RADIUS, next.z);
  }

  private applyFriction(dt: number) {
    const v = this.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1e-4) {
      v.x = v.z = 0;
      return;
    }
    const drop = Math.max(speed, STOP_SPEED) * FRICTION * dt;
    const k = Math.max(0, speed - drop) / speed;
    v.x *= k;
    v.z *= k;
  }

  /** Quake/Source PM_Accelerate: add speed along wishDir up to wishSpeed */
  private accelerate(wishDir: THREE.Vector3, wishSpeed: number, accel: number, dt: number) {
    const v = this.velocity;
    const cur = v.x * wishDir.x + v.z * wishDir.z;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    const a = Math.min(add, accel * wishSpeed * dt);
    v.x += wishDir.x * a;
    v.z += wishDir.z * a;
  }

  /**
   * Resize the capsule. On the ground the feet stay planted (the head drops); in the air the
   * head stays put and the legs tuck up (crouch-jump clears higher ledges). Standing up is
   * refused while something is in the way (ceiling, vent).
   */
  private setCrouched(on: boolean): boolean {
    const dh = CAPSULE_HALF_HEIGHT - CROUCH_HALF_HEIGHT;
    const t = this.body.translation();
    let cy: number;
    if (on) {
      cy = this.grounded ? t.y - dh : t.y + dh;
    } else {
      // prefer the natural direction, fall back to the other (e.g. airborne just above a ledge)
      const first = this.grounded ? t.y + dh : t.y - dh;
      const second = this.grounded ? t.y - dh : t.y + dh;
      if (this.canStandAt(t.x, first, t.z)) cy = first;
      else if (!this.grounded && this.canStandAt(t.x, second, t.z)) cy = second;
      else return false;
    }
    this.crouched = on;
    this.collider.setHalfHeight(on ? CROUCH_HALF_HEIGHT : CAPSULE_HALF_HEIGHT);
    const pos = { x: t.x, y: cy, z: t.z };
    this.body.setTranslation(pos, true);
    this.body.setNextKinematicTranslation(pos);
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    const newFeetY = cy - this.halfHeight - CAPSULE_RADIUS;
    const delta = newFeetY - this.curFeet.y;
    this.curFeet.y += delta;
    this.prevFeet.y += delta;
    // keep the camera where it was; eyeHeight then eases toward the new target
    this.eyeHeight -= delta;
    return true;
  }

  private canStandAt(x: number, cy: number, z: number): boolean {
    const { RAPIER, world } = this.physics;
    const hit = world.intersectionWithShape(
      { x, y: cy + 0.01, z },
      { x: 0, y: 0, z: 0, w: 1 },
      this.standShape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
    );
    return !hit;
  }

  /** true if standing up right now would be blocked (ceiling check, for UI / tests) */
  ceilingBlocked(): boolean {
    if (!this.crouched) return false;
    const t = this.body.translation();
    const dh = CAPSULE_HALF_HEIGHT - CROUCH_HALF_HEIGHT;
    return !this.canStandAt(t.x, t.y + dh, t.z);
  }

  /** Place the camera at the interpolated eye position. alpha = accumulator / dt. */
  updateCamera(camera: THREE.Camera, alpha: number, dt = 0) {
    const target = this.crouched ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    if (dt > 0) this.eyeHeight += (target - this.eyeHeight) * (1 - Math.exp(-EYE_LERP_RATE * dt));
    camera.position.lerpVectors(this.prevFeet, this.curFeet, alpha);
    camera.position.y += this.eyeHeight;
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  get feet(): THREE.Vector3 {
    return this.curFeet;
  }

  /** current eye position (feet + smoothed eye height) */
  eye(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.curFeet).setY(this.curFeet.y + this.eyeHeight);
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
    const cy = feet.y + this.halfHeight + CAPSULE_RADIUS;
    this.body.setTranslation({ x: feet.x, y: cy, z: feet.z }, true);
    this.body.setNextKinematicTranslation({ x: feet.x, y: cy, z: feet.z });
    this.curFeet.copy(feet);
    this.prevFeet.copy(feet);
    this.velocity.set(0, 0, 0);
    this.eyeHeight = this.crouched ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    if (yaw !== undefined) this.yaw = yaw;
    this.pitch = 0;
  }

  /** test hook: move the feet along a scripted path for one fixed step (keeps render interpolation) */
  scriptedStep(feet: THREE.Vector3, vel: THREE.Vector3) {
    const cy = feet.y + this.halfHeight + CAPSULE_RADIUS;
    this.body.setNextKinematicTranslation({ x: feet.x, y: cy, z: feet.z });
    this.prevFeet.copy(this.curFeet);
    this.curFeet.copy(feet);
    this.velocity.copy(vel);
    this.grounded = true;
  }
}
