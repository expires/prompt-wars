import * as THREE from 'three';
import { MELEE_PHASES, type MeleeSwing } from '@ai-gaem/shared';

/** right-arm rotation (x, y, z), hand push (z, metres) and torso twist (y) for one key */
type ArmKey = [number, number, number, number, number];
type ArmKeys = [ArmKey, ArmKey, ArmKey];
// arm points forward (-Z) at rest; +x raises it, +y swings it to the left
const ARM_KEYS: Record<string, ArmKeys> = {
  slash0: [[0.9, -1.0, 0, 0, -0.5], [0.1, 1.0, 0, -0.1, 0.5], [-0.1, 1.2, 0, 0, 0.6]],
  slash1: [[0.9, 0.95, 0, 0, 0.45], [0.1, -1.1, 0, -0.1, -0.5], [-0.1, -1.3, 0, 0, -0.6]],
  slash2: [[0.3, -1.35, 0, 0.05, -0.75], [0.2, 1.3, 0, -0.15, 0.7], [0.1, 1.5, 0, -0.1, 0.8]],
  overhead: [[2.4, 0.1, 0, 0.1, -0.1], [-0.5, 0.2, 0, -0.15, 0.15], [-0.8, 0.2, 0, -0.1, 0.15]],
  thrust: [[0.1, 0.3, 0, 0.22, -0.3], [0.05, 0.05, 0, -0.28, 0.3], [0.0, 0.05, 0, -0.3, 0.3]],
  bash: [[0.25, 0.5, 0, 0.15, -0.2], [0.1, -0.2, 0, -0.22, 0.2], [0.05, -0.25, 0, -0.24, 0.2]],
  spin: [[0.3, -1.0, 0, 0, 0.5], [0.3, 1.0, 0, -0.1, 0.5], [0.2, 1.2, 0, 0, 0.5]],
};
const BLOCK_KEY: ArmKey = [0.6, 0.95, 0, -0.05, 0.2];
const smooth = (t: number) => t * t * (3 - 2 * t);

export interface HumanoidAction {
  kind: 'melee' | 'recoil';
  swing: MeleeSwing;
  combo: number;
  charge: number;
  /** seconds since start, total seconds */
  t: number;
  duration: number;
  /** recoil strength */
  kick: number;
}

/**
 * Simple low-poly humanoid placeholder built from primitives (1.8m tall,
 * origin at the feet, facing -Z). Used for remote players and target dummies.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  /** pitches with aim; children: head + arms */
  readonly upper = new THREE.Group();
  /** attach a weapon model here (right hand, pointing -Z) */
  readonly hand = new THREE.Group();
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly limbMat: THREE.MeshStandardMaterial;
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly shinL: THREE.Object3D;
  private readonly shinR: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  /** current one-shot action (melee swing / gun recoil), if any */
  action: HumanoidAction | null = null;
  /** holding a melee block */
  blocking = false;
  private blockT = 0;
  /** test hook / screenshots: hold actions at this progress (0..1) */
  static freezeU: number | null = null;
  /** last evaluated arm pose (tests) */
  readonly armPose = { x: 0, y: 0, twist: 0, u: -1 };
  /** torso + upper body; lowered when crouching */
  private readonly hips = new THREE.Group();
  private walkPhase = 0;
  private crouchT = 0;

  constructor(color: THREE.ColorRepresentation = 0x3a7bd5) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7 });
    this.limbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b89a, flatShading: true });
    const visor = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // everything above the legs hangs off the hips (y = 0.9 standing), so crouching just lowers them
    this.hips.position.set(0, 0.9, 0);
    this.root.add(this.hips);
    // legs: thigh pivots at the hip, shin at the knee (bends when crouching)
    const leg = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, 0);
      mk(new THREE.BoxGeometry(0.2, 0.46, 0.22), this.limbMat, 0, -0.225, 0, pivot);
      const knee = new THREE.Group();
      knee.position.set(0, -0.45, 0);
      mk(new THREE.BoxGeometry(0.18, 0.45, 0.2), this.limbMat, 0, -0.215, 0, knee);
      pivot.add(knee);
      this.hips.add(pivot);
      return [pivot, knee] as const;
    };
    [this.legL, this.shinL] = leg(-0.13);
    [this.legR, this.shinR] = leg(0.13);

    mk(new THREE.BoxGeometry(0.5, 0.6, 0.28), this.bodyMat, 0, 0.3, 0, this.hips); // torso

    this.upper.position.set(0, 0.55, 0);
    this.hips.add(this.upper);
    mk(new THREE.BoxGeometry(0.28, 0.3, 0.28), skin, 0, 0.22, 0, this.upper); // head
    mk(new THREE.BoxGeometry(0.24, 0.08, 0.02), visor, 0, 0.25, -0.145, this.upper); // visor (shows facing)

    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, 0);
      mk(new THREE.BoxGeometry(0.14, 0.14, 0.55), this.limbMat, 0, -0.08, -0.25, pivot); // arms forward (aiming)
      this.upper.add(pivot);
      return pivot;
    };
    this.armL = arm(-0.3);
    this.armR = arm(0.3);
    // the hand (weapon) hangs off the right arm so swings carry the weapon
    this.hand.position.set(-0.08, -0.1, -0.45);
    this.armR.add(this.hand);
  }

  setColor(color: THREE.ColorRepresentation) {
    this.bodyMat.color.set(color);
    this.limbMat.color.set(color).multiplyScalar(0.6);
  }

  /** aim pitch in radians (positive = up) */
  setPitch(pitch: number) {
    this.upper.rotation.x = pitch;
  }

  /**
   * Crouch blend 0 (standing) .. 1 (crouched: 0.6 m shorter). Hips drop, knees bend forward so
   * the feet stay under the body.
   */
  setCrouch(t: number) {
    this.crouchT = t;
  }

  /** animate legs based on horizontal speed (m/s) */
  animate(dt: number, speed: number) {
    const c = this.crouchT;
    const hipY = 0.9 - 0.6 * c;
    this.hips.position.y = hipY;
    // two 0.45 m segments: thigh forward by a, shin back by 2a => hip height 0.9*cos(a)
    const bend = Math.acos(THREE.MathUtils.clamp(hipY / 0.9, -1, 1));
    this.walkPhase += dt * speed * (c > 0.5 ? 3.2 : 2.2);
    const a = Math.min(1, speed / 5) * (0.6 - 0.3 * c) * Math.sin(this.walkPhase);
    this.legL.rotation.x = bend + a;
    this.legR.rotation.x = bend - a;
    this.shinL.rotation.x = -2 * bend + Math.max(0, -a) * 0.6;
    this.shinR.rotation.x = -2 * bend + Math.max(0, a) * 0.6;
    this.armL.rotation.set(-a * 0.2, 0, 0);
    this.animateAction(dt);
  }

  /** play a melee swing (third person) */
  playMelee(swing: MeleeSwing, combo: number, charge: number, duration: number, startAt = 0) {
    this.action = { kind: 'melee', swing, combo, charge, t: startAt * duration, duration, kick: 0 };
  }

  /** gun recoil pose (arms kick up, slight lean back) */
  playRecoil(kick = 1) {
    if (this.action?.kind === 'melee') return;
    this.action = { kind: 'recoil', swing: 'slash', combo: 0, charge: 0, t: 0, duration: 0.22, kick: Math.min(1.5, kick) };
  }

  private animateAction(dt: number) {
    this.blockT += ((this.blocking ? 1 : 0) - this.blockT) * (1 - Math.exp(-dt * 12));
    let rx = 0, ry = 0, rz = 0, push = 0, twist = 0, spin = 0, lean = 0;
    const a = this.action;
    let u = -1;
    if (a) {
      if (Humanoid.freezeU !== null) a.t = Humanoid.freezeU * a.duration;
      else a.t += dt;
      u = a.t / a.duration;
      if (u >= 1) this.action = null;
      else if (a.kind === 'recoil') {
        const k = (1 - u) * (1 - u) * a.kick;
        rx = 0.35 * k;
        lean = -0.1 * k;
      } else {
        const ph = MELEE_PHASES[a.swing];
        const key = a.swing === 'slash' ? `slash${a.combo % 3}` : a.swing;
        const [w, s, f] = ARM_KEYS[key];
        const amp = a.charge > 0 ? 1.2 : 1;
        const lerp = (p: ArmKey, q: ArmKey, t: number): ArmKey => p.map((v, i) => v + (q[i] - v) * t) as ArmKey;
        const zero: ArmKey = [0, 0, 0, 0, 0];
        const wind = w.map((v) => v * amp) as ArmKey;
        let k: ArmKey;
        if (u < ph.strikeStart) k = lerp(zero, wind, smooth(u / ph.strikeStart));
        else if (u < ph.strikeEnd) k = lerp(wind, s, Math.pow((u - ph.strikeStart) / (ph.strikeEnd - ph.strikeStart), 1.5));
        else if (u < ph.followEnd) k = lerp(s, f, (u - ph.strikeEnd) / (ph.followEnd - ph.strikeEnd));
        else k = lerp(f, zero, smooth((u - ph.followEnd) / (1 - ph.followEnd)));
        [rx, ry, rz, push, twist] = k;
        if (a.swing === 'spin' && u >= ph.strikeStart && u < ph.strikeEnd) {
          spin = -Math.PI * 2 * smooth((u - ph.strikeStart) / (ph.strikeEnd - ph.strikeStart));
        }
      }
    }
    const b = this.blockT;
    if (b > 0.001) {
      rx += (BLOCK_KEY[0] - rx) * b;
      ry += (BLOCK_KEY[1] - ry) * b;
      push += (BLOCK_KEY[3] - push) * b;
      twist += (BLOCK_KEY[4] - twist) * b;
      this.armL.rotation.x += 0.8 * b;
      this.armL.rotation.y -= 0.5 * b;
    }
    this.armR.rotation.set(rx, ry, rz);
    this.armR.position.z = push;
    this.upper.rotation.y = twist;
    this.hips.rotation.y = spin;
    this.hips.rotation.x = lean;
    this.armPose.x = rx;
    this.armPose.y = ry;
    this.armPose.twist = twist;
    this.armPose.u = u;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.bodyMat.dispose();
    this.limbMat.dispose();
  }
}
