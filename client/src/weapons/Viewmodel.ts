import * as THREE from 'three';
import { buildWeaponModel, type WeaponModel } from './buildWeaponModel';
import { onPartsLibrary } from './partsLibrary';
import { isSharedDesignMesh, releaseDesignModels } from './designModelCache';
import type { Weapon } from './types';
import type { MeleeView } from './MeleeSystem';
import { BLOCK_POSE, GLOVE_BASELINE, MELEE_SPRINT_POSE, SHIELD_BLOCK_POSE, blendPose, chargePose, swingPose, type VmPose } from './meleeAnim';
import { throwPose, throwReleased } from './throwAnim';

/** equip (draw) animation length, seconds */
export const EQUIP_TIME = 0.4;

const ANCHOR = new THREE.Vector3(0.19, -0.19, -0.5);
/** ADS: centred, closer; y is adjusted per weapon so the top of the gun sits on the crosshair */
const ADS_ANCHOR = new THREE.Vector3(0, -0.02, -0.46);

export interface ViewmodelState {
  /** horizontal speed m/s */
  speed: number;
  grounded: boolean;
  /** 0..1 ADS blend */
  ads: number;
  sprinting: boolean;
  crouched: boolean;
  /** sideways velocity in camera space (m/s, + = right) for inertia tilt */
  strafe: number;
  /** camera landing dip (m, negative = down) */
  dip: number;
  /** melee weapons: current swing / charge / block state */
  melee?: MeleeView;
  /** melee shield (block pose differs) */
  shield?: boolean;
  /** throwable weapons: throw animation progress 0..1, or null when not throwing */
  throwing?: { t: number } | null;
}
const MAX_LEN = 0.6;
const MAX_LEN_MELEE = 0.75;
const MAX_HEIGHT = 0.28;

/** Boxing gloves / fists get a low punch animation and a fist-forward orientation. */
const GLOVE_RE = /glove|boxing|fist|knuckle|gauntlet/i;
function isGloveWeapon(w: Weapon): boolean {
  return GLOVE_RE.test(w.name) || w.parts.some((p) => GLOVE_RE.test(p.partId));
}

/** First-person weapon model rendered in the overlay scene (bottom-right). */
export class Viewmodel {
  private readonly anchor = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private model?: WeaponModel;
  private weapon?: Weapon;
  private holder?: THREE.Group;
  private readonly flash: THREE.Mesh;
  private recoil = 0;
  private swing = 0;
  private bobT = 0;
  private sway = new THREE.Vector2();
  private flashLife = 0;
  private sprintT = 0;
  private strafeT = 0;
  private crouchT = 0;
  /** ADS anchor for the current model (centre x, top of the gun on the crosshair) */
  private readonly adsAnchor = ADS_ANCHOR.clone();
  /** hide the model at full ADS (scoped weapons draw a scope overlay instead) */
  hideWhenAimed = false;
  /** 0..1 while reloading (drives the dip animation) */
  reloadProgress = -1;
  /** seconds since the weapon was equipped (draw animation) */
  private equipT = 0;
  private time = 0;
  private melee = false;
  /** boxing glove: fists held low, with a punch-from-the-bottom animation */
  private glove = false;
  /** smoothed block blend 0..1 */
  private blockT = 0;
  /** last applied melee offset (tests / screenshots) */
  readonly meleeOffset: VmPose = { p: [0, 0, 0], r: [0, 0, 0] };

  constructor(private readonly viewScene: THREE.Scene, private readonly viewCamera: THREE.PerspectiveCamera) {
    this.anchor.position.copy(ANCHOR);
    this.anchor.add(this.pivot);
    viewScene.add(this.anchor);
    const flashGeo = new THREE.PlaneGeometry(0.16, 0.16);
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(flashGeo, flashMat);
    this.flash.visible = false;
    // swap the placeholder model for the real one once the part library has loaded
    onPartsLibrary(() => {
      if (this.model?.placeholder && this.weapon) this.setWeapon(this.weapon, true);
    });
  }

  /** `keepAnim`: rebuild the model without replaying the draw animation */
  setWeapon(weapon: Weapon, keepAnim = false) {
    this.weapon = weapon;
    this.flash.removeFromParent();
    if (this.holder) {
      this.pivot.remove(this.holder);
      releaseDesignModels(this.holder);
      disposeTree(this.holder);
    }
    const m = buildWeaponModel(weapon);
    const holder = new THREE.Group();
    const orient = new THREE.Group();
    orient.add(m.root);
    holder.add(orient);
    const melee = weapon.fireMode === 'melee';
    this.melee = melee;
    this.glove = melee && isGloveWeapon(weapon);
    if (!keepAnim) this.equipT = 0;
    if (melee) {
      // Blades rest shouldered (tilted blade-up). A boxing glove is a fist, so keep it level and
      // let the low GLOVE_BASELINE pose hold it at the bottom of the screen.
      orient.rotation.set(this.glove ? -0.15 : 1.05, this.glove ? 0 : 0.15, this.glove ? 0.05 : -0.25);
      orient.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(orient);
      const size = bb.getSize(new THREE.Vector3());
      const budget = this.glove ? MAX_LEN_MELEE * 1.15 : MAX_LEN_MELEE;
      const s = Math.min(1.2, budget / Math.max(size.x, size.y, size.z, 0.001));
      holder.scale.setScalar(s);
      holder.position.set(0.02, 0.02, -0.02);
    } else {
      const bb = new THREE.Box3().setFromObject(orient);
      const size = bb.getSize(new THREE.Vector3());
      // cap length, and height/width so bulky weapons (tanks, bubble domes) don't cover the screen
      const s = Math.min(1, MAX_LEN / Math.max(size.z, 0.001), MAX_HEIGHT / Math.max(size.y, size.x, 0.001));
      holder.scale.setScalar(s);
      // keep the gun's rear at roughly the anchor so long guns extend forward
      holder.position.set(0, 0, -Math.max(0, bb.max.z * s - 0.12));
      // ADS: centre the gun horizontally and put its top edge just under the screen centre
      const cx = ((bb.min.x + bb.max.x) / 2) * s;
      this.adsAnchor.set(-cx, -bb.max.y * s - 0.008, ADS_ANCHOR.z);
    }
    if (melee) this.adsAnchor.copy(ANCHOR);
    m.muzzle.add(this.flash);
    this.flash.position.set(0, 0, -0.04);
    this.pivot.add(holder);
    this.holder = holder;
    this.model = m;
  }

  /** number of meshes in the current weapon model (used by e2e checks) */
  meshCount(): number {
    let n = 0;
    this.holder?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== this.flash) n++;
    });
    return n;
  }

  kick(amount = 1) {
    this.recoil = Math.min(1.5, this.recoil + amount);
    this.flashLife = 0.05;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.7 + Math.random() * 0.6);
  }

  /** legacy one-shot swing (unused by MeleeSystem weapons) */
  meleeSwing() {
    this.swing = 1;
  }

  /** 0..1 progress of the equip animation */
  get equipProgress() {
    return Math.min(1, this.equipT / EQUIP_TIME);
  }

  addSway(dx: number, dy: number) {
    this.sway.x = THREE.MathUtils.clamp(this.sway.x - dx * 0.00025, -0.04, 0.04);
    this.sway.y = THREE.MathUtils.clamp(this.sway.y + dy * 0.00025, -0.04, 0.04);
  }

  update(dt: number, st: ViewmodelState) {
    const ease = (cur: number, target: number, rate: number) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
    this.time += dt;
    this.equipT += dt;
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.swing = Math.max(0, this.swing - dt * 3.5);
    this.sway.multiplyScalar(Math.exp(-dt * 10));
    this.sprintT = ease(this.sprintT, st.sprinting && st.speed > 3 ? 1 : 0, 10);
    this.strafeT = ease(this.strafeT, THREE.MathUtils.clamp(st.strafe / 6.5, -1, 1), 8);
    this.crouchT = ease(this.crouchT, st.crouched ? 1 : 0, 10);
    const ads = st.ads * st.ads * (3 - 2 * st.ads); // smoothstep
    if (st.grounded) this.bobT += dt * st.speed * 1.65;
    const bobAmt = Math.min(1.3, st.speed / 6) * 0.014 * (1 - 0.85 * ads) * (1 + 0.6 * this.sprintT);

    // anchor: hip -> ADS
    this.anchor.position.lerpVectors(ANCHOR, this.adsAnchor, ads);
    this.anchor.visible = !(this.hideWhenAimed && st.ads > 0.95);

    const p = this.pivot;
    const swayK = 1 - 0.7 * ads;
    p.position.set(
      this.sway.x * swayK + Math.sin(this.bobT) * bobAmt - this.strafeT * 0.012 * swayK,
      this.sway.y * swayK + Math.abs(Math.cos(this.bobT)) * bobAmt - this.recoil * 0.01 * (1 - 0.5 * ads) + st.dip * 0.25,
      this.recoil * (0.05 + 0.03 * ads),
    );
    p.rotation.set(this.recoil * 0.12 * (1 - 0.6 * ads), 0, -this.strafeT * 0.06 * swayK + this.crouchT * 0.06 * (1 - ads));
    // idle sway (breathing), mostly when standing still
    const still = 1 - Math.min(1, st.speed / 2);
    p.position.y += Math.sin(this.time * 1.7) * 0.0035 * still * (1 - 0.8 * ads);
    p.position.x += Math.sin(this.time * 0.85) * 0.0025 * still * (1 - 0.8 * ads);
    p.rotation.z += Math.sin(this.time * 0.85 + 0.6) * 0.012 * still * (1 - ads);
    const mv = st.melee;
    const swinging = !!mv && (mv.kind === 'swing' || mv.kind === 'charge');
    // sprint pose: guns muzzle down and across the body; melee weapons shouldered
    if (this.melee && this.sprintT > 0.001) {
      const k = this.sprintT * (swinging ? 0 : 1);
      this.addPose(MELEE_SPRINT_POSE, k);
    } else if (this.sprintT > 0.001) {
      const k = this.sprintT;
      p.rotation.x -= 0.45 * k;
      p.rotation.y += 0.7 * k;
      p.rotation.z += 0.15 * k;
      p.position.x -= 0.06 * k;
      p.position.y -= 0.05 * k;
    }
    if (this.reloadProgress >= 0) {
      const k = Math.sin(Math.PI * this.reloadProgress);
      p.rotation.x -= k * 0.8;
      p.rotation.z += k * 0.3;
      p.position.y -= k * 0.08;
    }
    // melee: swing / charge / block keyframes
    this.blockT = ease(this.blockT, mv?.kind === 'block' ? 1 : 0, 14);
    // gloves rest low (GLOVE_BASELINE) and add the punch on top; other melee rests at zero
    const off = this.meleeOffset;
    off.p = this.glove ? [...GLOVE_BASELINE.p] : [0, 0, 0];
    off.r = this.glove ? [...GLOVE_BASELINE.r] : [0, 0, 0];
    if (mv?.kind === 'swing') {
      const pose = swingPose(mv.meta.swing, mv.combo, mv.u, mv.meta.weight, mv.charge > 0);
      const k = this.glove ? 1.35 : 1; // gloves thrust further forward
      off.p[0] += pose.p[0] * k;
      off.p[1] += pose.p[1] * k;
      off.p[2] += pose.p[2] * k;
      off.r[0] += pose.r[0];
      off.r[1] += pose.r[1];
      off.r[2] += pose.r[2];
      // alternate left/right jab per punch
      if (this.glove) off.p[0] += (mv.combo % 2 ? -1 : 1) * 0.04;
    } else if (mv?.kind === 'charge') {
      const pose = chargePose(mv.meta.swing, mv.combo, mv.charge, mv.meta.weight, this.time);
      off.p[0] += pose.p[0];
      off.p[1] += pose.p[1];
      off.p[2] += pose.p[2];
      off.r[0] += pose.r[0];
      off.r[1] += pose.r[1];
      off.r[2] += pose.r[2];
    }
    if (this.blockT > 0.001) {
      const b = blendPose(off, st.shield ? SHIELD_BLOCK_POSE : BLOCK_POSE, this.blockT);
      off.p = b.p;
      off.r = b.r;
    }
    if (this.melee) this.addPose(off, 1);
    // throwable: wind-up -> release -> recover; the held object vanishes at the release frame
    if (st.throwing) {
      this.addPose(throwPose(st.throwing.t), 1);
      if (this.holder) this.holder.visible = !throwReleased(st.throwing.t);
    } else if (this.holder && !this.holder.visible) {
      this.holder.visible = true;
    }
    // equip (draw): rise from below the screen, rotating up into place
    if (this.equipT < EQUIP_TIME) {
      const t = this.equipT / EQUIP_TIME;
      const c1 = 1.70158;
      const e = 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); // easeOutBack
      const k = 1 - e;
      p.position.y -= 0.32 * k;
      p.position.x += 0.04 * k;
      p.rotation.x += (this.melee ? -0.9 : 0.9) * k;
      p.rotation.z -= 0.35 * k;
    }
    if (this.swing > 0) {
      const t = 1 - this.swing; // 0..1
      const a = Math.sin(t * Math.PI);
      p.rotation.y += 1.2 * a - 0.4;
      p.rotation.z -= 0.9 * a;
      p.position.x -= 0.15 * a;
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.visible = false;
    }
  }

  private addPose(o: VmPose, k: number) {
    const p = this.pivot;
    p.position.x += o.p[0] * k;
    p.position.y += o.p[1] * k;
    p.position.z += o.p[2] * k;
    p.rotation.x += o.r[0] * k;
    p.rotation.y += o.r[1] * k;
    p.rotation.z += o.r[2] * k;
  }

  /**
   * World-space position that appears on screen where the viewmodel muzzle is,
   * `depth` meters in front of the main camera.
   */
  muzzleWorld(mainCamera: THREE.PerspectiveCamera, out: THREE.Vector3, depth = 0.7): THREE.Vector3 {
    if (!this.model) return out.copy(mainCamera.position);
    this.viewScene.updateMatrixWorld();
    this.model.muzzle.getWorldPosition(out).project(this.viewCamera);
    // unproject the NDC through the main camera, then put it at `depth` along that ray
    const dir = new THREE.Vector3(out.x, out.y, 0.5).unproject(mainCamera).sub(mainCamera.position).normalize();
    return out.copy(mainCamera.position).addScaledVector(dir, depth);
  }
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,220,1)');
  grd.addColorStop(0.3, 'rgba(255,190,80,0.9)');
  grd.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 12 : 32;
    const a = (i / 10) * Math.PI * 2;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    // materials are cached/shared in parts.ts; Forge design models belong to the design model cache
    if (m.isMesh && !isSharedDesignMesh(m)) m.geometry.dispose();
  });
}
