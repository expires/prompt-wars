import * as THREE from 'three';
import { settings } from '../settings';

type V3 = { x: number; y: number; z: number };

const NOTE = { F4: 349.23, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, B5: 987.77, C6: 1046.5, D6: 1174.66, G6: 1567.98 };

/**
 * Procedural WebAudio for the explorer (no asset files). World sounds go through HRTF panners
 * so they can be located by ear (the guide's ping, the hejnał from the tower, the dragon), which
 * matters most to players who rely on sound. The listener follows the camera every frame.
 */
export class ExploreAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private ambienceNodes: AudioNode[] = [];
  private birdTimer = 0;
  private ambienceOn = false;
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor() {
    settings.onChange((s) => this.master && (this.master.gain.value = s.volume));
    // browsers only start audio after a user gesture
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private ensure(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return undefined;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = settings.current.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 5;
      this.master.connect(comp).connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      if (this.ambienceOn) this.startAmbience();
    } catch {
      this.ctx = undefined;
    }
    return this.ctx;
  }

  private ready(): AudioContext | undefined {
    const c = this.ensure();
    return c && c.state === 'running' ? c : undefined;
  }

  /** move the listener to the camera (call once per frame) */
  updateListener(cam: THREE.Camera) {
    const c = this.ctx;
    if (!c) return;
    const l = c.listener;
    const p = cam.position;
    cam.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      const t = c.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(this.fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(this.fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(this.fwd.z, t, 0.02);
      l.upX.setTargetAtTime(this.up.x, t, 0.02);
      l.upY.setTargetAtTime(this.up.y, t, 0.02);
      l.upZ.setTargetAtTime(this.up.z, t, 0.02);
    } else {
      // Firefox: the deprecated setters
      const legacy = l as AudioListener & { setPosition(x: number, y: number, z: number): void; setOrientation(...a: number[]): void };
      legacy.setPosition(p.x, p.y, p.z);
      legacy.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
  }

  /** a gain stage, optionally behind an HRTF panner at `pos` */
  private out(c: AudioContext, gain: number, pos?: V3, refDistance = 6): GainNode {
    const g = c.createGain();
    g.gain.value = gain;
    if (!pos) {
      g.connect(this.master!);
      return g;
    }
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = 1;
    p.maxDistance = 2000;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else (p as PannerNode & { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    g.connect(p).connect(this.master!);
    return g;
  }

  private tone(c: AudioContext, dest: AudioNode, t: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine', attack = 0.005) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(c: AudioContext, dest: AudioNode, t: number, type: BiquadFilterType, f: number, q: number, dur: number, vol: number, attack = 0.005, f1?: number) {
    const s = c.createBufferSource();
    s.buffer = this.noise!;
    s.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, t);
    if (f1) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    filt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(filt).connect(g).connect(dest);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- player

  footstep(speed: number) {
    const c = this.ready();
    if (!c) return;
    const loud = Math.min(1, speed / 6);
    if (loud < 0.05) return;
    const dest = this.out(c, 0.16 * loud);
    const t = c.currentTime;
    this.noiseBurst(c, dest, t, 'bandpass', 900 + Math.random() * 500, 0.8, 0.06, 1, 0.003);
    this.tone(c, dest, t, 120 + Math.random() * 30, 70, 0.05, 0.4);
  }

  land(impact: number) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.12 + 0.25 * Math.min(1, impact / 10));
    this.noiseBurst(c, dest, c.currentTime, 'lowpass', 500, 1, 0.12, 1, 0.003);
  }

  // ---------------------------------------------------------------- interface

  click() {
    const c = this.ready();
    if (!c) return;
    this.tone(c, this.out(c, 0.08), c.currentTime, 1400, 1400, 0.05, 0.6, 'triangle');
  }

  /** a landmark found: a bright rising arpeggio */
  discover() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.22);
    const t = c.currentTime;
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => this.tone(c, dest, t + i * 0.11, f, f, 0.9, 0.5, 'triangle', 0.01));
  }

  /** a secret found: sparkly and a little mysterious */
  secret() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.2);
    const t = c.currentTime;
    [NOTE.G5, NOTE.B5, NOTE.D6, NOTE.G6].forEach((f, i) => {
      this.tone(c, dest, t + i * 0.09, f, f, 1.2, 0.45, 'sine', 0.01);
      this.tone(c, dest, t + i * 0.09, f * 2.01, f * 2.01, 0.6, 0.12, 'sine', 0.01);
    });
  }

  /** the guide's ping, placed at the target so it can be followed by ear */
  ping(pos: V3, near: number) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.5, pos, 12);
    const t = c.currentTime;
    const f = 880 + 440 * near;
    this.tone(c, dest, t, f, f, 0.22, 0.6, 'sine', 0.004);
    this.tone(c, dest, t + 0.07, f * 1.5, f * 1.5, 0.18, 0.3, 'sine', 0.004);
  }

  /** blind mode sonar: a short click from the wall ahead, higher as it gets closer */
  sonar(pos: V3, near: number) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.35, pos, 2);
    const f = 500 + 900 * near;
    this.tone(c, dest, c.currentTime, f, f, 0.035, 0.7, 'square', 0.002);
  }

  /** walked into something */
  bump() {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.35);
    const t = c.currentTime;
    this.tone(c, dest, t, 140, 60, 0.15, 0.9, 'sine', 0.002);
    this.noiseBurst(c, dest, t, 'lowpass', 600, 1, 0.08, 0.6, 0.002);
  }

  // ---------------------------------------------------------------- Kraków

  /**
   * The hejnał from St Mary's tower: a brass fanfare that breaks off mid-note (the watchman's
   * arrow). Returns its length in seconds.
   */
  hejnal(pos: V3): number {
    const c = this.ready();
    if (!c) return 0;
    const beat = 0.42;
    const tune: [number, number][] = [
      [NOTE.F4, 1], [NOTE.A4, 1], [NOTE.C5, 2], [NOTE.A4, 0.5], [NOTE.C5, 0.5], [NOTE.D5, 1], [NOTE.C5, 2],
      [NOTE.A4, 1], [NOTE.F4, 1], [NOTE.A4, 1], [NOTE.C5, 1.5], [NOTE.D5, 0.5], [NOTE.C5, 1], [NOTE.A4, 1],
      [NOTE.G4, 1], [NOTE.F4, 2], [0, 0.5], [NOTE.C5, 1], [NOTE.F5, 2], [NOTE.E5, 0.5], [NOTE.D5, 0.5],
      [NOTE.C5, 1], [NOTE.A4, 1],
    ];
    const dest = this.out(c, 0.9, pos, 40);
    let t = c.currentTime + 0.05;
    for (const [f, beats] of tune) {
      if (f) this.trumpet(c, dest, t, f, beats * beat * 0.95, false);
      t += beats * beat;
    }
    // the broken note: cut off sharply, as if the player was struck
    this.trumpet(c, dest, t, NOTE.C5, beat * 0.55, true);
    t += beat * 0.55;
    return t - c.currentTime;
  }

  private trumpet(c: AudioContext, dest: AudioNode, t: number, f: number, dur: number, cut: boolean) {
    const g = c.createGain();
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 2;
    filt.frequency.setValueAtTime(f * 1.5, t);
    filt.frequency.exponentialRampToValueAtTime(f * 6, t + 0.06);
    filt.frequency.exponentialRampToValueAtTime(f * 4, t + Math.min(dur, 0.3));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.04);
    g.gain.setValueAtTime(0.26, t + Math.max(0.05, dur - (cut ? 0.012 : 0.08)));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    filt.connect(g).connect(dest);
    // gentle vibrato on held notes
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 5.2;
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(dur > 0.5 ? f * 0.006 : 0, t + Math.min(0.25, dur));
    lfo.connect(lfoGain);
    for (const [mult, type, vol] of [[1, 'sawtooth', 0.6], [1.003, 'sawtooth', 0.4], [2, 'square', 0.12]] as const) {
      const o = c.createOscillator();
      const og = c.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      lfoGain.connect(o.frequency);
      og.gain.value = vol;
      o.connect(og).connect(filt);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.02);
  }

  /** the Zygmunt Bell: deep, long, inharmonic partials */
  bell(pos: V3) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.8, pos, 30);
    const t = c.currentTime;
    const f = 73;
    const partials: [number, number, number][] = [
      [0.5, 0.5, 10], [1, 1, 8], [1.19, 0.55, 6], [1.5, 0.35, 5], [2, 0.45, 4], [2.52, 0.22, 3], [3.01, 0.2, 2.4], [4.13, 0.1, 1.4],
    ];
    for (const [r, v, d] of partials) this.tone(c, dest, t, f * r, f * r * 0.998, d, v * 0.5, 'sine', 0.003);
    this.noiseBurst(c, dest, t, 'bandpass', 1800, 2, 0.12, 0.4, 0.001);
  }

  /** the dragon's fire: a roar under a rushing whoosh */
  dragonFire(pos: V3) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.7, pos, 10);
    const t = c.currentTime;
    this.noiseBurst(c, dest, t, 'bandpass', 500, 0.7, 1.8, 0.9, 0.15, 1600);
    this.tone(c, dest, t, 95, 55, 1.4, 0.35, 'sawtooth', 0.08);
    this.tone(c, dest, t, 140, 80, 1.1, 0.15, 'sawtooth', 0.06);
  }

  /** the sulfur sheep goes down: gulps, then a big (soft-edged) bang */
  dragonBurst(pos: V3) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.8, pos, 10);
    const t = c.currentTime;
    for (let i = 0; i < 4; i++) this.tone(c, dest, t + i * 0.35, 320, 110, 0.18, 0.5, 'sine', 0.01);
    this.noiseBurst(c, dest, t + 1.6, 'lowpass', 300, 1, 0.5, 0.6, 0.3, 900);
    this.noiseBurst(c, dest, t + 2.4, 'lowpass', 1200, 0.7, 1.4, 1, 0.005, 120);
    this.tone(c, dest, t + 2.4, 70, 30, 1.2, 0.9, 'sine', 0.005);
  }

  /** pigeons taking off */
  flutter(pos: V3) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.5, pos, 6);
    const t = c.currentTime;
    for (let i = 0; i < 22; i++) this.noiseBurst(c, dest, t + i * 0.045 + Math.random() * 0.02, 'highpass', 1400, 0.7, 0.05, 0.6, 0.004);
  }

  coo(pos: V3) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.25, pos, 6);
    const t = c.currentTime;
    this.tone(c, dest, t, 410, 380, 0.25, 0.5, 'sine', 0.05);
    this.tone(c, dest, t + 0.3, 440, 360, 0.4, 0.5, 'sine', 0.06);
  }

  /** the armillary sphere: a shimmer of glassy tones */
  shimmer(pos?: V3) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.25, pos, 6);
    const t = c.currentTime;
    [NOTE.C6, NOTE.G5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.D6].forEach((f, i) => this.tone(c, dest, t + i * 0.12, f, f, 1, 0.3, 'sine', 0.01));
  }

  /** a soft "bonk": the Lajkonik's mace */
  bonk(pos?: V3) {
    const c = this.ready();
    if (!c) return;
    const dest = this.out(c, 0.4, pos, 6);
    const t = c.currentTime;
    this.tone(c, dest, t, 520, 260, 0.18, 0.7, 'triangle');
    this.noiseBurst(c, dest, t, 'bandpass', 2000, 1.5, 0.05, 0.4);
    // and a little drum roll of hooves
    for (let i = 0; i < 6; i++) this.noiseBurst(c, dest, t + 0.25 + i * 0.11, 'bandpass', 700, 2, 0.05, 0.5);
  }

  // ---------------------------------------------------------------- ambience

  setAmbience(on: boolean) {
    this.ambienceOn = on;
    if (!this.ctx) return;
    if (on && !this.ambienceNodes.length) this.startAmbience();
    else if (!on) this.stopAmbience();
  }

  private startAmbience() {
    const c = this.ctx;
    if (!c || !this.noise) return;
    // wind: looped noise, low-passed, slowly breathing
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0.05;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.03;
    lfo.connect(lfoG).connect(g.gain);
    s.connect(lp).connect(g).connect(this.master!);
    s.start();
    lfo.start();
    this.ambienceNodes = [s, lfo, g];
  }

  private stopAmbience() {
    for (const n of this.ambienceNodes) {
      try {
        if (n instanceof AudioScheduledSourceNode) n.stop();
        n.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.ambienceNodes = [];
  }

  /** occasional birdsong around the listener (call every frame) */
  updateAmbience(dt: number, around: V3) {
    if (!this.ambienceOn) return;
    this.birdTimer -= dt;
    if (this.birdTimer > 0) return;
    this.birdTimer = 4 + Math.random() * 9;
    const c = this.ready();
    if (!c) return;
    const a = Math.random() * Math.PI * 2;
    const pos = { x: around.x + Math.cos(a) * 25, y: around.y + 12, z: around.z + Math.sin(a) * 25 };
    const dest = this.out(c, 0.12, pos, 10);
    const t = c.currentTime;
    const base = 2600 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.tone(c, dest, t + i * 0.14, base * (1 + Math.random() * 0.2), base * 0.8, 0.09, 0.5, 'sine', 0.005);
  }
}
