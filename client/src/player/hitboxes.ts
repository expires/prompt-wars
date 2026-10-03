import type RAPIER from '@dimforge/rapier3d';
import {
  DEFAULT_DIMS,
  HIT_ZONE_BODY,
  HIT_ZONE_HEAD,
  bodyRadius,
  headCenter,
  headRadius,
  type BodyDims,
} from '@ai-gaem/shared';
import type { PhysicsContext } from '../engine/physics';
import type { HitTarget, TargetRegistry } from '../weapons/targets';

/**
 * Head sphere + body capsule attached to a rigid body whose origin is at the player's feet.
 * `setCrouch(t)` (0 standing .. 1 crouched) lowers the head and shortens the body; `setDims`
 * scales both with the player's body (outfit size / build / head), matching the server's checks.
 */
export class Hitboxes {
  readonly body: RAPIER.Collider;
  readonly head: RAPIER.Collider;
  private crouchT = -1;
  private dims: BodyDims = DEFAULT_DIMS;

  constructor(
    private readonly physics: PhysicsContext,
    rigidBody: RAPIER.RigidBody,
    private readonly registry: TargetRegistry,
    target: HitTarget,
  ) {
    const { RAPIER, world } = physics;
    this.body = world.createCollider(RAPIER.ColliderDesc.capsule(0.45, bodyRadius(DEFAULT_DIMS)), rigidBody);
    // solid (not a sensor): weapon raycasts skip sensors
    this.head = world.createCollider(RAPIER.ColliderDesc.ball(headRadius(DEFAULT_DIMS)), rigidBody);
    registry.add(this.body, target, HIT_ZONE_BODY);
    registry.add(this.head, target, HIT_ZONE_HEAD);
    this.setCrouch(0);
  }

  /** head centre above the feet for crouch blend t (standard body unless `dims` given) */
  static headHeight(t: number, dims: BodyDims = DEFAULT_DIMS) {
    return headCenter(dims, t);
  }

  get bodyDims(): BodyDims {
    return this.dims;
  }

  setDims(d: BodyDims) {
    if (d.scale === this.dims.scale && d.build === this.dims.build && d.head === this.dims.head) return;
    this.dims = { scale: d.scale, build: d.build, head: d.head };
    this.body.setRadius(bodyRadius(this.dims));
    this.head.setRadius(headRadius(this.dims));
    const t = this.crouchT;
    this.crouchT = -1;
    this.setCrouch(Math.max(0, t));
  }

  setCrouch(t: number) {
    if (Math.abs(t - this.crouchT) < 1e-4) return;
    this.crouchT = t;
    const d = this.dims;
    const r = bodyRadius(d);
    // body capsule top: just under the head sphere
    const top = headCenter(d, t) - headRadius(d);
    const half = Math.max(0.05, (top - 2 * r) / 2);
    this.body.setHalfHeight(half);
    this.body.setTranslationWrtParent({ x: 0, y: top / 2, z: 0 });
    this.head.setTranslationWrtParent({ x: 0, y: headCenter(d, t), z: 0 });
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
