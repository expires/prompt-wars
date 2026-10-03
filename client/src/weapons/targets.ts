import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/** Which network shot produced a hit, how many pellets connected, and where. */
export interface HitInfo {
  seq: number;
  pellets: number;
  point: [number, number, number];
}

/** Something weapons can damage (dummy, remote player, ...). */
export interface HitTarget {
  id: string;
  kind: 'dummy' | 'player';
  /** center of mass in world space (for splash) */
  getCenter(out: THREE.Vector3): THREE.Vector3;
  alive(): boolean;
  /**
   * Apply local damage. Return true if this killed the target.
   * Remote players should just report (server-authoritative) and return false.
   */
  applyDamage(amount: number, weaponId: string, info?: HitInfo): boolean;
}

/** collider handle -> target lookup used by hitscan/projectiles. */
export class TargetRegistry {
  private byCollider = new Map<number, HitTarget>();
  private targets = new Set<HitTarget>();

  add(collider: RAPIER.Collider, target: HitTarget) {
    this.byCollider.set(collider.handle, target);
    this.targets.add(target);
  }

  remove(collider: RAPIER.Collider) {
    const t = this.byCollider.get(collider.handle);
    this.byCollider.delete(collider.handle);
    if (t) this.targets.delete(t);
  }

  fromCollider(collider: RAPIER.Collider): HitTarget | undefined {
    return this.byCollider.get(collider.handle);
  }

  all(): Iterable<HitTarget> {
    return this.targets;
  }
}
