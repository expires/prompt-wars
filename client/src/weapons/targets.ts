import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { HIT_ZONE_BODY } from '@ai-gaem/shared';

/** Which network shot produced a hit, how many pellets connected, where, and which zone. */
export interface HitInfo {
  seq: number;
  pellets: number;
  point: [number, number, number];
  /** 0 body, 1 head */
  zone: number;
}

/** Something weapons can damage (dummy, remote player, ...). */
export interface HitTarget {
  id: string;
  kind: 'dummy' | 'player';
  /** center of mass in world space (for splash) */
  getCenter(out: THREE.Vector3): THREE.Vector3;
  alive(): boolean;
  /**
   * Apply local damage (already zone-adjusted). Return true if this killed the target.
   * Remote players should just report (server-authoritative) and return false.
   */
  applyDamage(amount: number, weaponId: string, info?: HitInfo): boolean;
}

/** collider handle -> (target, hit zone) lookup used by hitscan/projectiles. A target may own several colliders. */
export class TargetRegistry {
  private byCollider = new Map<number, { target: HitTarget; zone: number }>();
  private refs = new Map<HitTarget, number>();

  add(collider: RAPIER.Collider, target: HitTarget, zone = HIT_ZONE_BODY) {
    if (this.byCollider.has(collider.handle)) this.remove(collider);
    this.byCollider.set(collider.handle, { target, zone });
    this.refs.set(target, (this.refs.get(target) ?? 0) + 1);
  }

  remove(collider: RAPIER.Collider) {
    const e = this.byCollider.get(collider.handle);
    if (!e) return;
    this.byCollider.delete(collider.handle);
    const n = (this.refs.get(e.target) ?? 1) - 1;
    if (n <= 0) this.refs.delete(e.target);
    else this.refs.set(e.target, n);
  }

  fromCollider(collider: RAPIER.Collider): HitTarget | undefined {
    return this.byCollider.get(collider.handle)?.target;
  }

  /** target + hit zone for a collider */
  hitFromCollider(collider: RAPIER.Collider): { target: HitTarget; zone: number } | undefined {
    return this.byCollider.get(collider.handle);
  }

  all(): Iterable<HitTarget> {
    return this.refs.keys();
  }
}
