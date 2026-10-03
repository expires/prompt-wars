import * as THREE from 'three';
import { DEFAULT_BODY, MELEE_PHASES, boneLayout, type BoneName, type MeleeSwing, type OutfitBody } from '@ai-gaem/shared';

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
// throw: wind-up (arm back/up) -> release (whip forward) -> recover
const THROW_KEYS: ArmKeys = [
  [-1.3, 0.2, 0, 0.12, -0.2],
  [1.1, 0.1, 0, -0.3, 0.25],
  [0.2, 0.1, 0, -0.05, 0.1],
];
const BLOCK_KEY: ArmKey = [0.6, 0.95, 0, -0.05, 0.2];
const smooth = (t: number) => t * t * (3 - 2 * t);

export interface HumanoidAction {
  kind: 'melee' | 'recoil' | 'throw';
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
  private readonly skinMat: THREE.MeshStandardMaterial;
  private readonly visorMat: THREE.MeshStandardMaterial;
  private readonly limbMat: THREE.MeshStandardMaterial;
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly shinL: THREE.Object3D;
  private readonly shinR: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  /** rigid segments outfit pieces attach to (bone frames, see @ai-gaem/shared socketFrame) */
  readonly bones: Record<BoneName, THREE.Object3D>;
  private readonly meshes: {
    torso: THREE.Mesh;
    head: THREE.Mesh;
    visor: THREE.Mesh;
    thighs: THREE.Mesh[];
    shins: THREE.Mesh[];
    feet: THREE.Mesh[];
    arms: THREE.Mesh[];
  };
  /** current body proportions */
  body: OutfitBody = { ...DEFAULT_BODY };
  /** attached outfit groups (per bone) */
  private outfitParts: THREE.Object3D[] = [];
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
    this.baseColor.set(color);
    this.limbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), flatShading: true });
    const skin = (this.skinMat = new THREE.MeshStandardMaterial({ color: 0xe0b89a, flatShading: true }));
    const visor = (this.visorMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 }));

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
    const thighs: THREE.Mesh[] = [];
    const shins: THREE.Mesh[] = [];
    const feet: THREE.Mesh[] = [];
    const arms: THREE.Mesh[] = [];
    const leg = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, 0);
      thighs.push(mk(new THREE.BoxGeometry(0.2, 0.46, 0.22), this.limbMat, 0, -0.225, 0, pivot));
      const knee = new THREE.Group();
      knee.position.set(0, -0.45, 0);
      shins.push(mk(new THREE.BoxGeometry(0.18, 0.45, 0.2), this.limbMat, 0, -0.215, 0, knee));
      feet.push(mk(new THREE.BoxGeometry(0.17, 0.07, 0.26), this.limbMat, 0, -0.405, -0.05, knee));
      pivot.add(knee);
      this.hips.add(pivot);
      return [pivot, knee] as const;
    };
    [this.legL, this.shinL] = leg(-0.13);
    [this.legR, this.shinR] = leg(0.13);

    const torso = mk(new THREE.BoxGeometry(0.5, 0.6, 0.28), this.bodyMat, 0, 0.3, 0, this.hips); // torso

    this.upper.position.set(0, 0.55, 0);
    this.hips.add(this.upper);
    const head = mk(new THREE.BoxGeometry(0.28, 0.3, 0.28), skin, 0, 0.21, 0, this.upper); // head
    const visorMesh = mk(new THREE.BoxGeometry(0.24, 0.08, 0.02), visor, 0, 0.24, -0.145, this.upper); // visor (shows facing)

    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, 0);
      arms.push(mk(new THREE.BoxGeometry(0.14, 0.14, 0.55), this.limbMat, 0, -0.08, -0.25, pivot)); // arms forward (aiming)
      this.upper.add(pivot);
      return pivot;
    };
    this.armL = arm(-0.3);
    this.armR = arm(0.3);
    this.meshes = { torso, head, visor: visorMesh, thighs, shins, feet, arms };
    this.bones = { hips: this.hips, upper: this.upper, armL: this.armL, armR: this.armR, thighL: this.legL, thighR: this.legR, shinL: this.shinL, shinR: this.shinR };
    // the hand (weapon) hangs off the right arm so swings carry the weapon
    this.hand.position.set(-0.08, -0.1, -0.45);
    this.armR.add(this.hand);
  }

  setColor(color: THREE.ColorRepresentation) {
    this.baseColor.set(color);
    this.applyColors();
  }

  /**
   * Body proportions (outfit): overall size scales the whole character, build widens torso / legs
   * (and arms half as much), head scales the head, limbs the arm length. Matches the hitbox maths
   * in @ai-gaem/shared (headCenter / bodyRadius) and the socket frames outfit pieces sit on.
   */
  setBody(b: OutfitBody) {
    this.body = { ...b };
    const L = boneLayout(b);
    this.root.scale.setScalar(b.size);
    const m = this.meshes;
    m.torso.scale.set(b.build, 1, b.build);
    for (const t of m.thighs) t.scale.set(b.build, 1, b.build);
    for (const t of m.shins) t.scale.set(b.build, 1, b.build);
    for (const t of m.feet) t.scale.set(b.build, 1, b.build);
    this.legL.position.x = -L.thighX;
    this.legR.position.x = L.thighX;
    this.armL.position.x = -L.armX;
    this.armR.position.x = L.armX;
    for (const a of m.arms) {
      a.scale.set(L.armGirth, L.armGirth, b.limbs);
      a.position.z = -0.25 * b.limbs;
    }
    this.hand.position.z = -0.45 * b.limbs;
    m.head.scale.setScalar(b.head);
    m.head.position.y = 0.06 + 0.15 * b.head;
    m.visor.scale.setScalar(b.head);
    m.visor.position.set(0, 0.06 + 0.18 * b.head, -0.145 * b.head);
  }

  /** outfit colours: suit (torso), undersuit (limbs), skin; null restores the player colour look */
  private look: { suit: THREE.Color; limbs: THREE.Color } | null = null;

  setLook(look: { suit: string; limbs: string; skin: string } | null) {
    if (look) {
      this.look = { suit: new THREE.Color(look.suit), limbs: new THREE.Color(look.limbs) };
      this.skinMat.color.set(look.skin);
    } else {
      this.look = null;
      this.skinMat.color.set(0xe0b89a);
    }
    this.applyColors();
  }

  /** Attach outfit groups (bone frame) to their bones; returns nothing, see detachOutfit. */
  attachOutfit(parts: Partial<Record<BoneName, THREE.Object3D>>, opts: { hideVisor?: boolean } = {}) {
    this.detachOutfit();
    for (const [bone, obj] of Object.entries(parts) as [BoneName, THREE.Object3D][]) {
      if (!obj) continue;
      this.bones[bone].add(obj);
      this.outfitParts.push(obj);
    }
    this.meshes.visor.visible = !opts.hideVisor;
  }

  /** Detach (not dispose) the outfit groups; returns them for the caller to release. */
  detachOutfit(): THREE.Object3D[] {
    const out = this.outfitParts;
    for (const o of out) o.parent?.remove(o);
    this.outfitParts = [];
    this.meshes.visor.visible = true;
    return out;
  }

  /** outfit groups currently attached (tests) */
  get outfitObjects(): readonly THREE.Object3D[] {
    return this.outfitParts;
  }

  private readonly baseColor = new THREE.Color();
  private tint: THREE.Color | null = null;
  private tintK = 0;

  private applyColors() {
    this.bodyMat.color.copy(this.look ? this.look.suit : this.baseColor);
    if (this.tint) this.bodyMat.color.lerp(this.tint, 0.75);
    if (this.look) {
      this.limbMat.color.copy(this.look.limbs);
      if (this.tint) this.limbMat.color.lerp(this.tint, 0.75);
    } else this.limbMat.color.copy(this.bodyMat.color).multiplyScalar(0.6);
  }

  /** elemental status look (burning orange / chilled blue ...): body recoloured + glow; null clears it */
  setStatusTint(color: THREE.ColorRepresentation | null, intensity = 0.5) {
    if (color === null) {
      if (!this.tint) return;
      this.tint = null;
      this.tintK = 0;
      for (const m of [this.bodyMat, this.limbMat]) {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0;
      }
      this.applyColors();
      return;
    }
    const c = new THREE.Color(color);
    if (!this.tint || !this.tint.equals(c)) {
      this.tint = c;
      this.applyColors();
    }
    this.tintK = intensity;
    for (const m of [this.bodyMat, this.limbMat]) {
      m.emissive.copy(c);
      m.emissiveIntensity = intensity;
    }
  }

  /** current status glow intensity (tests) */
  get statusTint(): number {
    return this.tint ? Math.max(0.01, this.tintK) : 0;
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

  /** play a throw (third person) */
  playThrow(duration = 0.5, startAt = 0) {
    this.action = { kind: 'throw', swing: 'thrust', combo: 0, charge: 0, t: startAt * duration, duration, kick: 0 };
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
      } else if (a.kind === 'throw') {
        const [w, s, f] = THROW_KEYS;
        const lerp = (p: ArmKey, q: ArmKey, t: number): ArmKey => p.map((v, i) => v + (q[i] - v) * t) as ArmKey;
        const zero: ArmKey = [0, 0, 0, 0, 0];
        let k: ArmKey;
        if (u < 0.4) k = lerp(zero, w, smooth(u / 0.4));
        else if (u < 0.6) k = lerp(w, s, Math.pow((u - 0.4) / 0.2, 1.5));
        else k = lerp(s, f, smooth((u - 0.6) / 0.4));
        [rx, ry, rz, push, twist] = k;
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

  /** frees the body's own geometry + materials (detach / free a held weapon model first) */
  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      // never touch cached design-model / projectile / outfit geometry if something is still attached
      if (m.isMesh && !m.userData?.sharedDesignModel && !m.userData?.sharedProjectile && !m.userData?.sharedOutfit) m.geometry.dispose();
    });
    this.bodyMat.dispose();
    this.limbMat.dispose();
    this.skinMat.dispose();
    this.visorMat.dispose();
  }
}
