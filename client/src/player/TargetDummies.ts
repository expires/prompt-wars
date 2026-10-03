import * as THREE from 'three';
import type { PhysicsContext } from '../engine/physics';
import { Humanoid } from './humanoid';
import { Hitboxes } from './hitboxes';
import { CENTER_OFFSET } from './PlayerController';
import type { HitTarget, TargetRegistry } from '../weapons/targets';
import type { Vec3 } from '../map/types';

const MAX_HP = 100;
const RESPAWN_S = 3;

class HpBar {
  readonly root = new THREE.Group();
  private readonly fill: THREE.Mesh;
  constructor() {
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x220000, depthTest: false, transparent: true, opacity: 0.8 }),
    );
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.06), new THREE.MeshBasicMaterial({ color: 0x40e040, depthTest: false, transparent: true }));
    this.fill.position.z = 0.001;
    bg.renderOrder = 10;
    this.fill.renderOrder = 11;
    this.root.add(bg, this.fill);
  }
  set(frac: number) {
    const f = Math.max(0, Math.min(1, frac));
    this.fill.scale.x = Math.max(0.0001, f);
    this.fill.position.x = -0.38 * (1 - f);
    (this.fill.material as THREE.MeshBasicMaterial).color.setHSL(0.33 * f, 0.8, 0.5);
  }
}

export interface Dummy extends HitTarget {
  hp: number;
  model: Humanoid;
  bar: HpBar;
  hitboxes: Hitboxes;
  crouched: boolean;
  respawnAt: number;
  flash: number;
}

/** Stationary target dummies (head + body hitboxes like remote players) with HP bars. Every third one crouches. */
export class TargetDummies {
  readonly dummies: Dummy[] = [];
  private time = 0;
  onKilled?: (d: Dummy) => void;

  constructor(
    physics: PhysicsContext,
    scene: THREE.Scene,
    registry: TargetRegistry,
    positions: Vec3[],
  ) {
    const { RAPIER, world } = physics;
    positions.forEach((p, i) => {
      const model = new Humanoid(new THREE.Color().setHSL(i / positions.length, 0.6, 0.5));
      model.root.position.set(...p);
      model.root.rotation.y = Math.random() * Math.PI * 2;
      scene.add(model.root);
      const bar = new HpBar();
      bar.root.position.set(p[0], p[1] + 2.1, p[2]);
      scene.add(bar.root);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p[0], p[1], p[2]));
      const crouched = i % 3 === 1;
      const d: Dummy = {
        id: `dummy-${i}`,
        kind: 'dummy',
        hp: MAX_HP,
        model,
        bar,
        hitboxes: undefined as unknown as Hitboxes,
        crouched,
        respawnAt: 0,
        flash: 0,
        getCenter: (out) => out.set(p[0], p[1] + (crouched ? CENTER_OFFSET - 0.3 : CENTER_OFFSET), p[2]),
        alive: () => d.hp > 0,
        applyDamage: (amount) => this.damage(d, amount),
      };
      d.hitboxes = new Hitboxes(physics, body, registry, d);
      if (crouched) {
        d.hitboxes.setCrouch(1);
        model.setCrouch(1);
        model.animate(0, 0);
        bar.root.position.y -= 0.6;
      }
      this.dummies.push(d);
    });
  }

  private damage(d: Dummy, amount: number): boolean {
    if (d.hp <= 0) return false;
    d.hp = Math.max(0, d.hp - amount);
    d.flash = 0.1;
    d.bar.set(d.hp / MAX_HP);
    if (d.hp <= 0) {
      d.model.root.visible = false;
      d.bar.root.visible = false;
      d.hitboxes.setEnabled(false);
      d.respawnAt = this.time + RESPAWN_S;
      this.onKilled?.(d);
      return true;
    }
    return false;
  }

  revive(d: Dummy) {
    d.hp = MAX_HP;
    d.bar.set(1);
    d.model.root.visible = true;
    d.bar.root.visible = true;
    d.hitboxes.setEnabled(true);
  }

  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    for (const d of this.dummies) {
      if (d.hp <= 0 && this.time >= d.respawnAt) this.revive(d);
      d.bar.root.quaternion.copy(camera.quaternion);
      if (d.flash > 0) {
        d.flash -= dt;
        d.model.root.scale.setScalar(d.flash > 0 ? 1.04 : 1);
      }
    }
  }

  dispose() {
    for (const d of this.dummies) d.hitboxes.dispose();
  }
}
