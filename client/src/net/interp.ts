import { POSE_SEND_HZ } from '@ai-gaem/shared';
import type { PoseSnapshot, Vec3 } from './NetClient';

/**
 * Snapshot interpolation for one remote player, driven by the *sender's* clock (`sendT`) instead
 * of arrival time, so network jitter / TCP bunching doesn't turn into hold-then-rush:
 *
 * - clock offset = min(arrival - sendT) over the last ~2 s (the fastest delivery),
 * - jitter = p95 of (arrival - sendT - offset), rising at once and decaying by 10 ms/s,
 * - target delay = 2 x send interval + jitter, clamped to [40, 150] ms (60 Hz senders: ~33 ms +
 *   jitter, which includes the server's POSE_FLUSH_MS batching; 30 Hz senders: ~67 ms + jitter),
 * - playback time advances at 0.95..1.05x real time to converge on the target (no jumps unless
 *   the error exceeds 250 ms),
 * - cubic Hermite between snapshots using the sent velocities (linear if they disagree with the
 *   displacement), extrapolation along the last velocity for <= 150 ms when the buffer starves,
 *   and a short exponential blend to hide the correction when data arrives again.
 */

export const MIN_DELAY_MS = 40;
export const MAX_DELAY_MS = 150;
const OFFSET_WINDOW_MS = 2000;
const MAX_EXTRAPOLATE_MS = 150;
const SNAP_DISTANCE = 3;
const RESYNC_MS = 250;
const CORRECTION_TAU = 0.1;
const MAX_SAMPLES = 64;
const JITTER_DECAY_PER_S = 10;

interface Sample {
  /** unwrapped sender time (ms) */
  t: number;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
}

export interface InterpState {
  pos: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  /** extrapolating past the newest snapshot */
  extrapolating: boolean;
}

export interface InterpStats {
  /** current render delay behind the newest data (ms) */
  delay: number;
  targetDelay: number;
  jitter: number;
  interval: number;
  /** snapshots newer than the playback time */
  buffered: number;
}

function wrapAngle(d: number) {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class RemoteInterpolator {
  private samples: Sample[] = [];
  private lastRawT: number | null = null;
  private lastT = 0;
  private offsets: { arrival: number; off: number }[] = [];
  private minOffset = 0;
  private jitter = 0;
  /** smoothed sender interval (ms); starts at the 60 Hz move rate */
  private interval = 1000 / POSE_SEND_HZ;
  private playT: number | null = null;
  private corr: Vec3 = [0, 0, 0];
  private pendingCorrection = false;
  private lastRender: InterpState | null = null;
  private snapPending = false;
  private lastNow: number | null = null;
  private lastOffsetAt: number | null = null;

  constructor(initial?: { pos: Vec3; yaw: number; pitch?: number; crouching?: boolean }) {
    if (initial) {
      this.lastRender = { pos: [...initial.pos], yaw: initial.yaw, pitch: initial.pitch ?? 0, crouching: !!initial.crouching, extrapolating: false };
    }
  }

  /** next snapshot replaces the buffer instead of being interpolated to (respawn) */
  snapNext() {
    this.snapPending = true;
  }

  get targetDelay() {
    return clamp(2 * this.interval + this.jitter, MIN_DELAY_MS, MAX_DELAY_MS);
  }

  push(s: PoseSnapshot) {
    // unwrap the u32 sender clock (signed 32-bit difference)
    let t: number;
    if (this.lastRawT === null) t = s.sendT;
    else t = this.lastT + ((s.sendT - this.lastRawT) | 0);
    const prev = this.samples[this.samples.length - 1];
    const sample: Sample = { t, pos: [...s.pos], vel: [...s.vel], yaw: s.yaw, pitch: s.pitch, crouching: s.crouching };
    const jump = prev ? Math.hypot(s.pos[0] - prev.pos[0], s.pos[1] - prev.pos[1], s.pos[2] - prev.pos[2]) : 0;
    const snap = s.teleport || this.snapPending || !prev || jump > SNAP_DISTANCE;

    if (!snap && t <= prev.t) return; // duplicate / stale

    // clock offset + jitter (skip teleport rows: the server writes those with a stale sendT)
    if (!s.teleport && prev) {
      if (prev && !snap) {
        const dt = t - prev.t;
        if (dt > 0 && dt < 200) this.interval = this.interval * 0.9 + dt * 0.1;
      }
      this.addOffset(s.arrival, s.arrival - t);
    }
    this.lastRawT = s.sendT;
    this.lastT = t;

    if (snap) {
      this.samples = [sample];
      this.snapPending = false;
      this.corr = [0, 0, 0];
      this.pendingCorrection = false;
      this.lastRender = { pos: [...sample.pos], yaw: sample.yaw, pitch: sample.pitch, crouching: sample.crouching, extrapolating: false };
      this.playT = null; // re-sync to the clock on the next update()
      return;
    }

    // first movement after standing still: hold the old position until just before this sample
    const idleGap = t - prev.t > Math.max(120, 2.5 * this.interval);
    if (idleGap && Math.hypot(prev.vel[0], prev.vel[2]) < 0.05) {
      this.samples.push({ ...prev, t: t - Math.min(this.interval, t - prev.t - 1), vel: [0, 0, 0] });
    }
    // data arriving while we were extrapolating: blend from where we drew the player
    if (this.playT !== null && this.playT > prev.t) this.pendingCorrection = true;
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  private addOffset(arrival: number, off: number) {
    this.offsets.push({ arrival, off });
    while (this.offsets.length > 5 && arrival - this.offsets[0].arrival > OFFSET_WINDOW_MS) this.offsets.shift();
    let min = Infinity;
    for (const o of this.offsets) min = Math.min(min, o.off);
    this.minOffset = min;
    const late = this.offsets.map((o) => o.off - min).sort((a, b) => a - b);
    const p95 = late[Math.min(late.length - 1, Math.floor(late.length * 0.95))] ?? 0;
    // rise immediately, fall slowly (10 ms per second): a steady target delay instead of one that
    // chases every quiet moment and then starves on the next spike
    const since = this.lastOffsetAt === null ? 0 : Math.max(0, arrival - this.lastOffsetAt) / 1000;
    this.jitter = Math.max(p95, this.jitter - JITTER_DECAY_PER_S * since);
    this.lastOffsetAt = arrival;
  }

  /**
   * Advance playback to local time `now` (performance.now() clock) and sample. Playback uses the
   * real elapsed time (not the game's clamped frame dt), so long frames don't make it fall behind.
   */
  update(now: number): InterpState | null {
    const dt = this.lastNow === null ? 0 : Math.max(0, Math.min(1, (now - this.lastNow) / 1000));
    this.lastNow = now;
    if (!this.samples.length) return this.lastRender;
    if (!this.offsets.length) {
      // no clock estimate yet (only the initial / teleport snapshot): show the newest sample
      const l = this.samples[this.samples.length - 1];
      return (this.lastRender = { pos: [...l.pos], yaw: l.yaw, pitch: l.pitch, crouching: l.crouching, extrapolating: false });
    }
    const ideal = now - this.minOffset - this.targetDelay;
    if (this.playT === null || Math.abs(ideal - this.playT) > RESYNC_MS) {
      this.playT = ideal;
    } else {
      const err = ideal - this.playT; // > 0: we're too far behind
      const rate = clamp(1 + err / 1000, 0.95, 1.05);
      this.playT += dt * 1000 * rate;
    }
    const raw = this.sampleAt(this.playT);

    if (this.pendingCorrection && this.lastRender) {
      const d: Vec3 = [this.lastRender.pos[0] - raw.pos[0], this.lastRender.pos[1] - raw.pos[1], this.lastRender.pos[2] - raw.pos[2]];
      if (Math.hypot(d[0], d[1], d[2]) < 2) this.corr = d;
      this.pendingCorrection = false;
    }
    const k = Math.exp(-dt / CORRECTION_TAU);
    this.corr = [this.corr[0] * k, this.corr[1] * k, this.corr[2] * k];
    const out: InterpState = { ...raw, pos: [raw.pos[0] + this.corr[0], raw.pos[1] + this.corr[1], raw.pos[2] + this.corr[2]] };
    this.lastRender = out;
    this.prune();
    return out;
  }

  private prune() {
    // keep one sample at/before playT (the interpolation start) plus everything newer
    const pt = this.playT ?? 0;
    let i = 0;
    while (i + 1 < this.samples.length && this.samples[i + 1].t <= pt - 200) i++;
    if (i > 0) this.samples.splice(0, i);
  }

  private sampleAt(t: number): InterpState {
    const s = this.samples;
    const last = s[s.length - 1];
    if (t >= last.t) {
      const e = Math.min(t - last.t, MAX_EXTRAPOLATE_MS) / 1000;
      const moving = Math.hypot(last.vel[0], last.vel[1], last.vel[2]) > 0.05;
      return {
        pos: moving ? [last.pos[0] + last.vel[0] * e, last.pos[1] + last.vel[1] * e, last.pos[2] + last.vel[2] * e] : [...last.pos],
        yaw: last.yaw,
        pitch: last.pitch,
        crouching: last.crouching,
        extrapolating: moving && t > last.t,
      };
    }
    if (t <= s[0].t) {
      const f = s[0];
      return { pos: [...f.pos], yaw: f.yaw, pitch: f.pitch, crouching: f.crouching, extrapolating: false };
    }
    let i = s.length - 2;
    while (i > 0 && s[i].t > t) i--;
    const a = s[i];
    const b = s[i + 1];
    const span = Math.max(1, b.t - a.t);
    const u = clamp((t - a.t) / span, 0, 1);
    const dts = span / 1000;
    const pos = hermite(a.pos, a.vel, b.pos, b.vel, dts, u);
    return {
      pos,
      yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * u,
      pitch: a.pitch + (b.pitch - a.pitch) * u,
      crouching: u < 1 ? a.crouching : b.crouching,
      extrapolating: false,
    };
  }

  /** last rendered state (debug / tests) */
  get last() {
    return this.lastRender;
  }

  stats(now: number): InterpStats {
    const pt = this.playT ?? 0;
    return {
      delay: this.samples.length ? now - this.minOffset - pt : 0,
      targetDelay: this.targetDelay,
      jitter: this.jitter,
      interval: this.interval,
      buffered: this.samples.filter((s) => s.t > pt).length,
    };
  }
}

/** cubic Hermite between p0 (vel v0) and p1 (vel v1) over dt seconds; linear if the velocities disagree with the chord */
export function hermite(p0: Vec3, v0: Vec3, p1: Vec3, v1: Vec3, dt: number, u: number): Vec3 {
  const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const l0 = Math.hypot(v0[0], v0[1], v0[2]) * dt;
  const l1 = Math.hypot(v1[0], v1[1], v1[2]) * dt;
  const out: Vec3 = [0, 0, 0];
  // velocities that don't match the displacement (wall sliding, knockback, teleports) => lerp
  if (l0 > 2 * chord + 0.15 || l1 > 2 * chord + 0.15 || dt > 0.3) {
    for (let k = 0; k < 3; k++) out[k] = p0[k] + (p1[k] - p0[k]) * u;
    return out;
  }
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  for (let k = 0; k < 3; k++) out[k] = h00 * p0[k] + h10 * dt * v0[k] + h01 * p1[k] + h11 * dt * v1[k];
  return out;
}
