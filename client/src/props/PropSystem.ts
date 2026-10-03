import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d';
import type { PhysicsContext } from '../engine/physics';
import type { Vec3 } from '../map/types';
import { HIT_ZONE_BODY } from '@ai-gaem/shared';
import type { HitInfo, HitTarget, TargetRegistry } from '../weapons/targets';
import { PROP_DEFS, type PropDef, type PropSpawn } from './propDefs';

const RESPAWN_S = 8;
const DEBRIS_TTL = 4;
const DEG = Math.PI / 180;

interface PropInstance extends HitTarget {
  def: PropDef;
  spawn: Vec3;
  spawnYaw: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Object3D;
  hp: number;
  broken: boolean;
  respawnAt: number;
}

interface Debris {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  ttl: number;
}

const tmp = new THREE.Vector3();

/**
 * Breakable, dynamic props (chairs, crates, cones, bottles). The first dynamic Rapier bodies in
 * the game: they collide with the static map and each other, take damage from every weapon (they
 * register as `HitTarget`s, so hitscan/projectile/stream/splash/melee all reach them), react to
 * blasts and player contact, and burst into debris when their HP hits zero, then respawn.
 *
 * Props never touch the actual walls — walls are static map colliders and are never registered here.
 */
export class PropSystem {
  readonly props: PropInstance[] = [];
  private readonly debris: Debris[] = [];
  private time = 0;
  private readonly debrisGeo = new THREE.BoxGeometry(1, 1, 1);

  constructor(
    private readonly physics: PhysicsContext,
    private readonly scene: THREE.Scene,
    private readonly registry: TargetRegistry,
    spawns: readonly PropSpawn[],
  ) {
    for (const s of spawns) this.spawn(s.kind, s.pos, s.yaw ?? 0);
  }

  spawn(kind: string, pos: Vec3, yaw = 0): PropInstance | null {
    const def = PROP_DEFS[kind];
    if (!def) return null;
    const { RAPIER, world } = this.physics;
    const [hx, hy, hz] = def.half;

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setLinearDamping(0.15).setAngularDamping(0.5),
    );
    const density = def.mass / (8 * hx * hy * hz);
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setDensity(density).setFriction(0.9).setRestitution(0.15),
      body,
    );

    const mesh = def.build();
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);

    const p: PropInstance = {
      id: `prop-${kind}-${this.props.length}`,
      kind: 'prop',
      def,
      spawn: pos,
      spawnYaw: yaw,
      body,
      collider,
      mesh,
      hp: def.hp,
      broken: false,
      respawnAt: 0,
      getCenter: (out) => {
        const t = p.body.translation();
        return out.set(t.x, t.y, t.z);
      },
      alive: () => !p.broken,
      applyDamage: (amount, _weaponId, info) => this.hit(p, amount, info),
    };
    this.registry.add(collider, p, HIT_ZONE_BODY);
    this.props.push(p);
    return p;
  }

  private hit(p: PropInstance, amount: number, info?: HitInfo): boolean {
    if (p.broken || amount <= 0) return false;
    p.hp -= amount;
    if (info?.point) this.impulse(p, info.point[0], info.point[1], info.point[2], Math.min(7, amount * 0.35));
    if (p.hp <= 0) {
      this.break(p);
      return true;
    }
    return false;
  }

  /** push a prop away from a world point with `power` (impulse magnitude) */
  private impulse(p: PropInstance, x: number, y: number, z: number, power: number) {
    const t = p.body.translation();
    tmp.set(t.x - x, t.y - y + 0.15, t.z - z);
    if (tmp.lengthSq() < 1e-6) tmp.set(0, 1, 0);
    tmp.normalize().multiplyScalar(power);
    p.body.applyImpulse({ x: tmp.x, y: tmp.y, z: tmp.z }, true);
  }

  private break(p: PropInstance) {
    p.broken = true;
    p.mesh.visible = false;
    p.collider.setEnabled(false);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    p.body.sleep();
    p.respawnAt = this.time + RESPAWN_S;
    this.registry.remove(p.collider);
    this.spawnDebris(p);
  }

  private spawnDebris(p: PropInstance) {
    const { RAPIER, world } = this.physics;
    const t = p.body.translation();
    const q = p.body.rotation();
    const mat = new THREE.MeshStandardMaterial({ color: p.def.color, roughness: 0.9, flatShading: true, transparent: true });
    const s = p.def.half[0] * 0.5;
    for (let i = 0; i < p.def.fragments; i++) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(t.x + (Math.random() - 0.5) * s, t.y + (Math.random() - 0.5) * s, t.z + (Math.random() - 0.5) * s)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinearDamping(0.2)
          .setAngularDamping(0.6),
      );
      world.createCollider(RAPIER.ColliderDesc.cuboid(s, s, s).setDensity(400).setFriction(0.8).setRestitution(0.25), body);
      const mesh = new THREE.Mesh(this.debrisGeo, mat.clone());
      mesh.scale.setScalar(s * 2);
      mesh.position.set(t.x, t.y, t.z);
      this.scene.add(mesh);
      const kick = 2 + Math.random() * 3;
      body.applyImpulse({ x: (Math.random() - 0.5) * kick, y: Math.random() * kick + 1, z: (Math.random() - 0.5) * kick }, true);
      body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.4, y: (Math.random() - 0.5) * 0.4, z: (Math.random() - 0.5) * 0.4 }, true);
      this.debris.push({ body, mesh, ttl: DEBRIS_TTL });
    }
  }

  private respawn(p: PropInstance) {
    p.hp = p.def.hp;
    p.broken = false;
    this.physics.world.removeRigidBody(p.body);
    const { RAPIER, world } = this.physics;
    const [hx, hy, hz] = p.def.half;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.spawn[0], p.spawn[1], p.spawn[2]).setLinearDamping(0.15).setAngularDamping(0.5),
    );
    const density = p.def.mass / (8 * hx * hy * hz);
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setDensity(density).setFriction(0.9).setRestitution(0.15),
      body,
    );
    p.body = body;
    p.collider = collider;
    body.setRotation({ x: 0, y: Math.sin((p.spawnYaw * DEG) / 2), z: 0, w: Math.cos((p.spawnYaw * DEG) / 2) }, false);
    this.registry.add(collider, p, HIT_ZONE_BODY);
    p.mesh.visible = true;
    p.mesh.position.set(p.spawn[0], p.spawn[1], p.spawn[2]);
    p.mesh.rotation.set(0, p.spawnYaw, 0);
  }

  /** blast impulse + optional damage to props within `radius` of a world point (explosions, melee kicks) */
  blast(point: THREE.Vector3, radius: number, power: number, damage = 0) {
    for (const p of this.props) {
      if (p.broken) continue;
      const c = p.getCenter(tmp);
      const d = c.distanceTo(point);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      this.impulse(p, point.x, point.y, point.z, power * falloff);
      if (damage > 0) this.hit(p, damage * falloff, { seq: 0, pellets: 1, point: [point.x, point.y, point.z], zone: HIT_ZONE_BODY });
    }
  }

  update(dt: number) {
    this.time += dt;

    // sync prop meshes from their bodies
    for (const p of this.props) {
      if (p.broken) {
        if (this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }

    // debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.ttl -= dt;
      if (d.ttl <= 0) {
        this.scene.remove(d.mesh);
        (d.mesh.material as THREE.Material).dispose();
        this.physics.world.removeRigidBody(d.body);
        this.debris.splice(i, 1);
        continue;
      }
      const t = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      (d.mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(1, d.ttl / 1.2);
    }
  }

  dispose() {
    for (const p of this.props) {
      this.registry.remove(p.collider);
      this.scene.remove(p.mesh);
      this.physics.world.removeRigidBody(p.body);
    }
    this.props.length = 0;
    for (const d of this.debris) {
      this.scene.remove(d.mesh);
      (d.mesh.material as THREE.Material).dispose();
      this.physics.world.removeRigidBody(d.body);
    }
    this.debris.length = 0;
  }
}
