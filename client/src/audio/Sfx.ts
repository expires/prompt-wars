import type * as THREE from 'three';
import type { WeaponClass } from '@ai-gaem/shared';
import { settings } from '../settings';

/** per-class gunshot recipe: filtered noise crack + low sine thump */
interface ShotRecipe {
  /** noise band-pass centre (Hz) and Q */
  freq: number;
  q: number;
  /** noise decay (s) */
  decay: number;
  /** thump start / end frequency (Hz), decay (s), gain */
  thumpFrom: number;
  thumpTo: number;
  thumpDecay: number;
  thump: number;
  gain: number;
}

const SHOT: Record<string, ShotRecipe> = {
  pistol: { freq: 1800, q: 0.8, decay: 0.12, thumpFrom: 180, thumpTo: 60, thumpDecay: 0.08, thump: 0.5, gain: 0.55 },
  smg: { freq: 2200, q: 0.9, decay: 0.07, thumpFrom: 160, thumpTo: 70, thumpDecay: 0.05, thump: 0.35, gain: 0.4 },
  rifle: { freq: 1400, q: 0.7, decay: 0.14, thumpFrom: 150, thumpTo: 50, thumpDecay: 0.1, thump: 0.6, gain: 0.55 },
  lmg: { freq: 1100, q: 0.7, decay: 0.15, thumpFrom: 130, thumpTo: 45, thumpDecay: 0.1, thump: 0.65, gain: 0.55 },
  shotgun: { freq: 700, q: 0.5, decay: 0.3, thumpFrom: 120, thumpTo: 35, thumpDecay: 0.2, thump: 0.9, gain: 0.7 },
  sniper: { freq: 900, q: 0.5, decay: 0.55, thumpFrom: 110, thumpTo: 30, thumpDecay: 0.3, thump: 1, gain: 0.75 },
  rocket_launcher: { freq: 500, q: 0.4, decay: 0.6, thumpFrom: 90, thumpTo: 30, thumpDecay: 0.35, thump: 0.9, gain: 0.6 },
  grenade_launcher: { freq: 600, q: 0.6, decay: 0.2, thumpFrom: 140, thumpTo: 60, thumpDecay: 0.12, thump: 0.8, gain: 0.5 },
  crossbow: { freq: 2500, q: 2, decay: 0.08, thumpFrom: 300, thumpTo: 120, thumpDecay: 0.06, thump: 0.3, gain: 0.35 },
  blowgun: { freq: 3000, q: 1.5, decay: 0.06, thumpFrom: 400, thumpTo: 200, thumpDecay: 0.03, thump: 0.1, gain: 0.25 },
  flamethrower: { freq: 600, q: 0.4, decay: 0.09, thumpFrom: 80, thumpTo: 60, thumpDecay: 0.05, thump: 0.05, gain: 0.18 },
  bubble_gun: { freq: 2600, q: 4, decay: 0.05, thumpFrom: 900, thumpTo: 1600, thumpDecay: 0.05, thump: 0.15, gain: 0.12 },
  melee: { freq: 1200, q: 0.6, decay: 0.18, thumpFrom: 0, thumpTo: 0, thumpDecay: 0, thump: 0, gain: 0.25 },
  weird: { freq: 1500, q: 3, decay: 0.15, thumpFrom: 600, thumpTo: 150, thumpDecay: 0.12, thump: 0.4, gain: 0.4 },
};

/**
 * Lightweight procedural WebAudio sound effects: no asset files. Gunshots by weapon class,
 * hitmarker tick, headshot ding, kill chime, footsteps, jump / land, reload clicks.
 * Remote sounds are attenuated by distance and panned left/right relative to the camera.
 */
export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private listener?: THREE.Camera;

  constructor() {
    settings.onChange((s) => this.master && (this.master.gain.value = s.volume));
    // browsers only allow audio after a user gesture
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setListener(cam: THREE.Camera) {
    this.listener = cam;
  }

  private ensure(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return undefined;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = settings.current.volume;
      // gentle limiter so overlapping shots don't clip
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = undefined;
    }
    return this.ctx;
  }

  private ready(): AudioContext | undefined {
    const c = this.ctx;
    if (!c || c.state !== 'running' || settings.current.volume <= 0) return undefined;
    return c;
  }

  /** output node for a sound at `pos` (attenuated + panned), or straight to master */
  private out(c: AudioContext, gain: number, pos?: THREE.Vector3): AudioNode | undefined {
    let g = gain;
    let pan = 0;
    if (pos && this.listener) {
      const lp = this.listener.position;
      const dx = pos.x - lp.x, dy = pos.y - lp.y, dz = pos.z - lp.z;
      const dist = Math.hypot(dx, dy, dz);
      g *= 1 / (1 + Math.max(0, dist - 2) * 0.08);
      if (g < 0.01) return undefined;
      // right vector of the camera (yaw only)
      const yaw = this.listener.rotation.y;
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      pan = dist > 0.1 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) * 0.8 : 0;
    }
    const gn = c.createGain();
    gn.gain.value = g;
    if (pan !== 0 && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      gn.connect(p).connect(this.master!);
    } else gn.connect(this.master!);
    return gn;
  }

  private noiseBurst(c: AudioContext, dest: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, decay: number, gain: number, attack = 0.002) {
    const src = c.createBufferSource();
    src.buffer = this.noise!;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
  }

  private tone(c: AudioContext, dest: AudioNode, t: number, from: number, to: number, decay: number, gain: number, type: OscillatorType = 'sine') {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  gunshot(cls: WeaponClass | string, pos?: THREE.Vector3) {
    const c = this.ready();
    if (!c) return;
    const r = SHOT[cls] ?? SHOT.weird;
    const dest = this.out(c, r.gain, pos);
    if (!dest) return;
    const t = c.currentTime;
    if (cls === 'melee') {
      this.noiseBurst(c, dest, t, 'bandpass', 900, 0.7, r.decay, 0.6, 0.06); // swoosh
      return;
    }
    this.noiseBurst(c, dest, t, 'bandpass', r.freq * (0.92 + Math.random() * 0.16), r.q, r.decay, 1);
    this.noiseBurst(c, dest, t, 'highpass', 4000, 0.7, 0.025, 0.6); // crack
    if (r.thump > 0) this.tone(c, dest, t, r.thumpFrom, r.thumpTo, r.thumpDecay, r.thump);
  }

  explosion(pos?: THREE.Vector3) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.8, pos);
    if (!dest) return;
    const t = c.currentTime;
    this.noiseBurst(c, dest, t, 'lowpass', 600, 0.7, 0.8, 1, 0.005);
    this.tone(c, dest, t, 90, 25, 0.6, 1);
  }

  hitTick() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.35)!;
    this.tone(c, dest, c.currentTime, 1900, 1700, 0.05, 0.6, 'triangle');
  }

  headshotDing() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.4)!;
    const t = c.currentTime;
    this.tone(c, dest, t, 1320, 1320, 0.45, 0.7);
    this.tone(c, dest, t, 2640, 2640, 0.3, 0.3);
    this.tone(c, dest, t, 3960, 3960, 0.15, 0.12);
  }

  killChime() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.35)!;
    const t = c.currentTime;
    this.tone(c, dest, t, 880, 880, 0.18, 0.5, 'triangle');
    this.tone(c, dest, t + 0.09, 1320, 1320, 0.3, 0.5, 'triangle');
  }

  footstep(speed: number, crouched: boolean, pos?: THREE.Vector3) {
    const c = this.ready();
    if (!c) return;
    const loud = Math.min(1, speed / 6.5) * (crouched ? 0.3 : 1);
    if (loud < 0.05) return;
    const dest = this.out(c, 0.22 * loud, pos);
    if (!dest) return;
    const t = c.currentTime;
    this.noiseBurst(c, dest, t, 'lowpass', 500 + Math.random() * 400, 1, 0.07, 1, 0.004);
    this.tone(c, dest, t, 90 + Math.random() * 20, 60, 0.05, 0.5);
  }

  jump() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.12)!;
    this.noiseBurst(c, dest, c.currentTime, 'lowpass', 700, 1, 0.08, 1, 0.01);
  }

  land(impactSpeed: number) {
    const c = this.ready();
    if (!c) return;
    const k = Math.min(1, impactSpeed / 12);
    const dest = this.out(c, 0.15 + 0.35 * k)!;
    const t = c.currentTime;
    this.noiseBurst(c, dest, t, 'lowpass', 400, 1, 0.12, 1, 0.003);
    this.tone(c, dest, t, 110, 45, 0.12, 0.8);
  }

  reload() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.18)!;
    const t = c.currentTime;
    this.noiseBurst(c, dest, t, 'bandpass', 2500, 3, 0.03, 1);
    this.noiseBurst(c, dest, t + 0.18, 'bandpass', 1800, 3, 0.04, 1);
  }

  dryFire() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.15)!;
    this.noiseBurst(c, dest, c.currentTime, 'bandpass', 3200, 4, 0.02, 1);
  }
}
