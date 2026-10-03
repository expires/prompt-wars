import { settings } from '../settings';

/**
 * Procedural "indie" lobby music — no audio files. Each time it starts it composes a new track
 * (random key, mode, tempo and chord progression) and loops it, re-randomising the arpeggio and
 * melody every 4 bars so it never quite repeats. Layers: soft pad chords, a wandering pluck,
 * bass, brushed drums and the occasional lead note, glued with a lowpass + feedback delay.
 */

const MUSIC_LEVEL = 0.22;

const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  penta: [0, 3, 5, 7, 10],
};
/** scale-degree triads (0 = I). Classic indie loops. */
const PROGRESSIONS: number[][] = [
  [0, 4, 5, 3], // I V vi IV
  [5, 3, 0, 4], // vi IV I V
  [0, 5, 3, 4], // I vi IV V
  [3, 4, 0, 5], // IV V I vi
  [0, 3, 4, 3], // I IV V IV
  [5, 4, 0, 3], // vi V I IV
];
const TEMPOS = [72, 76, 80, 84, 88, 92, 96];
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private ctx?: AudioContext;
  private master?: GainNode;
  private bus?: GainNode;
  private delay?: DelayNode;
  private noise?: AudioBuffer;
  private timer?: number;
  private nextTime = 0;
  private step = 0;
  private playing = false;
  private cycleArp: number[] = [];

  // current composed track
  private root = 45;
  private scale: number[] = SCALES.major;
  private tempo = 84;
  private prog: number[] = PROGRESSIONS[0];
  private stepDur = 0.35;

  constructor() {
    settings.onChange((s) => this.applyVolume(s.volume));
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private applyVolume(v: number) {
    if (this.master) this.master.gain.value = v * MUSIC_LEVEL;
  }

  private ensure(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return undefined;
      const c = new Ctor();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = settings.current.volume * MUSIC_LEVEL;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);

      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;
      this.bus = c.createGain();
      this.bus.gain.value = 0;
      this.bus.connect(lp).connect(this.master);

      // feedback delay for the plucks (indie shimmer)
      const delay = c.createDelay(0.6);
      delay.delayTime.value = 0.34;
      const fb = c.createGain();
      fb.gain.value = 0.32;
      const wet = c.createGain();
      wet.gain.value = 0.4;
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(lp);
      this.delay = delay;

      const len = Math.floor(c.sampleRate * 1);
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = undefined;
    }
    return this.ctx;
  }

  /** start (or keep) the lobby track; idempotent */
  play() {
    const c = this.ensure();
    if (!c) return;
    void c.resume();
    if (this.playing) return;
    this.compose();
    this.step = 0;
    this.nextTime = c.currentTime + 0.06;
    this.playing = true;
    this.bus!.gain.cancelScheduledValues(c.currentTime);
    this.bus!.gain.setValueAtTime(0.0001, c.currentTime);
    this.bus!.gain.exponentialRampToValueAtTime(1, c.currentTime + 1.2);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** fade out and stop */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    const c = this.ctx;
    if (c && this.bus) {
      this.bus.gain.cancelScheduledValues(c.currentTime);
      this.bus.gain.setValueAtTime(this.bus.gain.value, c.currentTime);
      this.bus.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.8);
    }
    if (this.timer) window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private compose() {
    this.root = pick([43, 45, 46, 48, 50]); // G2..D3
    this.scale = SCALES[pick(Object.keys(SCALES))];
    this.tempo = pick(TEMPOS);
    this.prog = pick(PROGRESSIONS);
    this.stepDur = 60 / this.tempo / 2; // eighth notes
    this.cycleArp = [];
  }

  /** chord tones for a scale degree (triad, wrapped into the scale) */
  private triad(deg: number): number[] {
    const s = this.scale;
    const n = s.length;
    return [deg, deg + 2, deg + 4].map((i) => this.root + 12 + s[((i % n) + n) % n] + 12 * Math.floor(i / n));
  }

  private schedule() {
    const c = this.ctx;
    if (!c) return;
    while (this.nextTime < c.currentTime + 0.12) {
      this.voice(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
    }
  }

  private voice(step: number, t: number) {
    const beat = step % 8;
    const bar = Math.floor(step / 8);
    const barInCycle = bar % 4;
    const deg = this.prog[bar % this.prog.length];
    const notes = this.triad(deg);

    // new arp shape every 4-bar cycle
    if (barInCycle === 0 && beat === 0) {
      const shape = [0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 0, 2];
      this.cycleArp = shape.map((k) => (Math.random() < 0.25 ? (k + 1) % 3 : k));
    }

    // drums
    if (beat === 0 || beat === 4) this.kick(t);
    if (beat === 2 || beat === 6) this.snare(t);
    this.hat(t, beat % 2 === 0 ? 0.045 : 0.022);

    // pad chords at the top of each half-bar
    if (beat === 0) this.pad(notes, t, this.stepDur * 8);
    else if (beat === 4) this.pad(notes, t, this.stepDur * 4, 0.6);

    // bass root on a simple indie pulse
    if (beat === 0 || beat === 4 || beat === 3 || beat === 7) {
      const b = this.root + this.scale[deg % this.scale.length] - 12;
      this.bass(b, t, beat === 3 || beat === 7 ? 0.5 : 1);
    }

    // plucked arpeggio on the eighths
    if (beat % 2 === 0) {
      const idx = this.cycleArp[(step / 2) % this.cycleArp.length] ?? 0;
      this.pluck(notes[idx % notes.length] + 12, t);
    }

    // sparse lead
    if (barInCycle >= 1 && beat % 2 === 0 && Math.random() < 0.1) {
      this.lead(this.root + 24 + pick(this.scale), t);
    }
  }

  // ------------------------------------------------------------------ voices
  private pad(notes: number[], t: number, dur: number, level = 1) {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * level, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1600;
    f.Q.value = 0.6;
    g.connect(f).connect(this.bus!);
    for (const n of notes) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midi(n);
      o.detune.value = (Math.random() - 0.5) * 8;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private pluck(freq: number, t: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midi(freq);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g);
    g.connect(this.bus!);
    g.connect(this.delay!);
    o.start(t);
    o.stop(t + 0.55);
  }

  private bass(freq: number, t: number, level: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = midi(freq);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.5);
  }

  private lead(freq: number, t: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = midi(freq);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g).connect(this.bus!);
    g.connect(this.delay!);
    o.start(t);
    o.stop(t + 1.2);
  }

  private kick(t: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.25);
  }

  private snare(t: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise!;
    src.playbackRate.value = 1;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(f).connect(g).connect(this.bus!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
  }

  private hat(t: number, gain: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise!;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(f).connect(g).connect(this.bus!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.08);
  }
}
