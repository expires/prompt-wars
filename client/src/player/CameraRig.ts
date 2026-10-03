import * as THREE from 'three';
import { settings } from '../settings';
import { SPRINT_SPEED } from './PlayerController';

const DEG = Math.PI / 180;
/** metres per footstep (one bob half-cycle) */
const STEP_LENGTH = 1.9;
/** sprint FOV kick (degrees) */
const SPRINT_FOV_KICK = 6;
const FOV_LERP_RATE = 10;
/** aim punch spring (critically damped-ish) */
const PUNCH_STIFFNESS = 120;
const PUNCH_DAMPING = 19;
/** landing dip spring */
const DIP_STIFFNESS = 90;
const DIP_DAMPING = 13;

export interface CameraFeelState {
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  crouched: boolean;
  /** 0..1 ADS blend */
  ads: number;
  /** FOV multiplier at full ADS (e.g. 0.75, sniper 0.4) */
  adsZoom: number;
}

/**
 * Camera feel layered on top of the controller's eye position: speed-scaled head bob (+ footstep
 * events), landing dip, recoil aim punch with spring recovery (affects where bullets go, like
 * CS aim punch), sprint FOV kick and ADS zoom.
 */
export class CameraRig {
  private bobT = 0;
  private bobAmt = 0;
  private dip = 0;
  private dipVel = 0;
  punchPitch = 0;
  punchYaw = 0;
  private punchPitchVel = 0;
  private punchYawVel = 0;
  fov = settings.current.fov;
  /** current fov / base fov (mouse sensitivity scales with it while zoomed) */
  fovScale = 1;
  /** called on every footstep with the current speed */
  onStep?: (speed: number) => void;

  /** recoil kick in degrees: pitch up, yaw (signed) */
  kick(pitchDeg: number, yawDeg: number) {
    // impulse sized so the peak displacement is ~= the requested kick
    const w = Math.sqrt(PUNCH_STIFFNESS);
    this.punchPitchVel += pitchDeg * DEG * w * Math.E;
    this.punchYawVel += yawDeg * DEG * w * Math.E;
  }

  resetPunch() {
    this.punchPitch = this.punchYaw = this.punchPitchVel = this.punchYawVel = 0;
  }

  /** camera dip on landing, scaled by impact speed (m/s) */
  land(impactSpeed: number) {
    const k = THREE.MathUtils.clamp((impactSpeed - 2) / 10, 0, 1);
    this.dipVel -= 0.4 + k * 2.6;
  }

  update(dt: number, s: CameraFeelState) {
    if (dt <= 0) return;
    // ---- head bob + footsteps ----
    const moving = s.grounded && s.speed > 0.4;
    const target = moving ? Math.min(1.3, s.speed / SPRINT_SPEED) : 0;
    this.bobAmt += (target - this.bobAmt) * (1 - Math.exp(-dt * 8));
    if (s.grounded) {
      const prev = this.bobT;
      this.bobT += (s.speed * dt * Math.PI) / STEP_LENGTH;
      if (moving && Math.floor(this.bobT / Math.PI) !== Math.floor(prev / Math.PI)) this.onStep?.(s.speed);
    }

    // ---- springs (semi-implicit Euler, sub-stepped for stability at low frame rates) ----
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    const spring = (x: number, v: number, k: number, c: number) => {
      const nv = v + (-k * x - c * v) * h;
      return [x + nv * h, nv] as const;
    };
    for (let i = 0; i < n; i++) {
      [this.punchPitch, this.punchPitchVel] = spring(this.punchPitch, this.punchPitchVel, PUNCH_STIFFNESS, PUNCH_DAMPING);
      [this.punchYaw, this.punchYawVel] = spring(this.punchYaw, this.punchYawVel, PUNCH_STIFFNESS, PUNCH_DAMPING);
      [this.dip, this.dipVel] = spring(this.dip, this.dipVel, DIP_STIFFNESS, DIP_DAMPING);
    }

    // ---- FOV ----
    const base = settings.current.fov;
    const sprintKick = s.sprinting && s.speed > SPRINT_SPEED * 0.75 ? SPRINT_FOV_KICK : 0;
    const zoom = 1 + (s.adsZoom - 1) * s.ads;
    const fovTarget = (base + sprintKick * (1 - s.ads)) * zoom;
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-dt * FOV_LERP_RATE));
    this.fovScale = this.fov / base;
  }

  /** apply offsets to a camera already placed at the eye by PlayerController.updateCamera */
  apply(camera: THREE.PerspectiveCamera, s: Pick<CameraFeelState, 'crouched' | 'ads'>) {
    const bobOn = settings.current.headBob;
    if (bobOn) {
      const amp = this.bobAmt * (s.crouched ? 0.6 : 1) * (1 - 0.8 * s.ads);
      const up = -Math.abs(Math.sin(this.bobT)) * 0.045 * amp + 0.02 * amp;
      const side = Math.sin(this.bobT) * 0.025 * amp;
      camera.position.y += up + this.dip;
      // lateral sway along the camera's right vector (yaw only)
      const yaw = camera.rotation.y;
      camera.position.x += Math.cos(yaw) * side;
      camera.position.z -= Math.sin(yaw) * side;
      camera.rotation.z += Math.sin(this.bobT) * 0.0035 * amp;
    }
    camera.rotation.x += this.punchPitch;
    camera.rotation.y += this.punchYaw;
    if (Math.abs(camera.fov - this.fov) > 1e-3) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }

  /** landing dip (metres, negative = down) for the viewmodel */
  get dipOffset() {
    return this.dip;
  }
}
