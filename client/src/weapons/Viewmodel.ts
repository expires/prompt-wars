import * as THREE from 'three';
import { buildWeaponModel, type WeaponModel } from './buildWeaponModel';
import type { Weapon } from './types';

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
}
const MAX_LEN = 0.6;
const MAX_LEN_MELEE = 0.75;
const MAX_HEIGHT = 0.28;

/** First-person weapon model rendered in the overlay scene (bottom-right). */
export class Viewmodel {
  private readonly anchor = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private model?: WeaponModel;
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
  }

  setWeapon(weapon: Weapon) {
    this.flash.removeFromParent();
    if (this.holder) {
      this.pivot.remove(this.holder);
      disposeTree(this.holder);
    }
    const m = buildWeaponModel(weapon);
    const holder = new THREE.Group();
    const orient = new THREE.Group();
    orient.add(m.root);
    holder.add(orient);
    const melee = weapon.fireMode === 'melee';
    if (melee) {
      // melee convention: blade/head grows toward -Z from the origin, handle toward +Z.
      // Tilt it so the blade points up and forward, with the handle in the hand.
      orient.rotation.set(1.05, 0.15, -0.25);
      orient.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(orient);
      const size = bb.getSize(new THREE.Vector3());
      const s = Math.min(1.2, MAX_LEN_MELEE / Math.max(size.x, size.y, size.z, 0.001));
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

  meleeSwing() {
    this.swing = 1;
  }

  addSway(dx: number, dy: number) {
    this.sway.x = THREE.MathUtils.clamp(this.sway.x - dx * 0.00025, -0.04, 0.04);
    this.sway.y = THREE.MathUtils.clamp(this.sway.y + dy * 0.00025, -0.04, 0.04);
  }

  update(dt: number, st: ViewmodelState) {
    const ease = (cur: number, target: number, rate: number) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
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
    // sprint pose: muzzle down and across the body
    if (this.sprintT > 0.001) {
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
    if (m.isMesh) m.geometry.dispose(); // materials are cached/shared in parts.ts
  });
}
