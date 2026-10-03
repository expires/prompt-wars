import type RAPIER from '@dimforge/rapier3d-compat';
import {
  HEAD_CENTER_CROUCHED,
  HEAD_CENTER_STANDING,
  HEAD_RADIUS,
  HIT_ZONE_BODY,
  HIT_ZONE_HEAD,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
} from '@ai-gaem/shared';
import type { PhysicsContext } from '../engine/physics';
import type { HitTarget, TargetRegistry } from '../weapons/targets';

const BODY_RADIUS = 0.3;
/** body capsule top (feet-relative) when standing: just under the head sphere */
const BODY_TOP_STANDING = HEAD_CENTER_STANDING - HEAD_RADIUS;
const CROUCH_DROP = PLAYER_HEIGHT - PLAYER_CROUCH_HEIGHT;

/**
 * Head sphere + body capsule attached to a rigid body whose origin is at the player's feet.
 * `setCrouch(t)` (0 standing .. 1 crouched) lowers the head and shortens the body.
 */
export class Hitboxes {
  readonly body: RAPIER.Collider;
  readonly head: RAPIER.Collider;
  private crouchT = -1;

  constructor(
    private readonly physics: PhysicsContext,
    rigidBody: RAPIER.RigidBody,
    private readonly registry: TargetRegistry,
    target: HitTarget,
  ) {
    const { RAPIER, world } = physics;
    this.body = world.createCollider(RAPIER.ColliderDesc.capsule(0.45, BODY_RADIUS), rigidBody);
    // solid (not a sensor): weapon raycasts skip sensors
    this.head = world.createCollider(RAPIER.ColliderDesc.ball(HEAD_RADIUS), rigidBody);
    registry.add(this.body, target, HIT_ZONE_BODY);
    registry.add(this.head, target, HIT_ZONE_HEAD);
    this.setCrouch(0);
  }

  /** head centre above the feet for crouch blend t */
  static headHeight(t: number) {
    return HEAD_CENTER_STANDING + (HEAD_CENTER_CROUCHED - HEAD_CENTER_STANDING) * t;
  }

  setCrouch(t: number) {
    if (Math.abs(t - this.crouchT) < 1e-4) return;
    this.crouchT = t;
    const top = BODY_TOP_STANDING - CROUCH_DROP * t;
    const half = Math.max(0.05, (top - 2 * BODY_RADIUS) / 2);
    this.body.setHalfHeight(half);
    this.body.setTranslationWrtParent({ x: 0, y: top / 2, z: 0 });
    this.head.setTranslationWrtParent({ x: 0, y: Hitboxes.headHeight(t), z: 0 });
  }

  setEnabled(on: boolean) {
    this.body.setEnabled(on);
    this.head.setEnabled(on);
  }

  dispose() {
    this.registry.remove(this.body);
    this.registry.remove(this.head);
    this.physics.world.removeCollider(this.body, false);
    this.physics.world.removeCollider(this.head, false);
  }
}
