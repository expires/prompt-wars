import './slot.css';
import { el, esc, isolate } from './dom';

/**
 * Weapon slot machine: three reels physically scroll down, a big lever gets pulled, and the
 * combo is handed to the forge ("molten toaster cannon"). Purely a fun front-end for the
 * existing weapon generator — it never fabricates weapon stats itself.
 */

const ADJ = [
  'molten', 'haunted', 'cozy', 'cyber', 'rusty', 'cosmic', 'rubber', 'glitter', 'cursed', 'banana',
  'military', 'origami', 'plasma', 'wooden', 'neon', 'spicy', 'frozen', 'tiny', 'giant', 'disco',
  'vintage', 'toxic', 'royal', 'junkyard', 'arctic', 'candy', 'shadow', 'brass', 'bubbly', 'soggy',
];
const OBJ = [
  'toaster', 'baguette', 'umbrella', 'keyboard', 'plunger', 'sock', 'kettle', 'guitar', 'stapler',
  'duck', 'cactus', 'train', 'piano', 'chainsaw', 'teapot', 'pretzel', 'magnet', 'bowling ball',
  'frying pan', 'cat', 'lamp', 'trumpet', 'waffle', 'vacuum', 'banjo', 'rocket', 'teacup', 'pinecone',
];
const FORM = [
  'cannon', 'blaster', 'launcher', 'shotgun', 'sword', 'hammer', 'bazooka', 'rifle', 'pistol',
  'staff', 'wand', 'minigun', 'sniper', 'axe', 'flamethrower', 'crossbow', 'scepter', 'gauntlet',
];
const REELS = [ADJ, OBJ, FORM];
const STRIP_LEN = 28;
const FALLBACK_CELL = 92;
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export class SlotMachine {
  readonly root = el('div', 'menu-layer slot');
  private readonly panel: HTMLElement;
  private readonly strips: HTMLElement[] = [];
  private readonly reels: HTMLElement[] = [];
  private readonly result: HTMLElement;
  private readonly spinBtn: HTMLButtonElement;
  private readonly lever: HTMLElement;
  private spinning = false;
  private onResult?: (prompt: string) => void;
  private timeouts: number[] = [];
  private audio?: AudioContext;

  constructor(parent: HTMLElement = document.body) {
    const r = this.root;
    r.hidden = true;
    r.dataset.testid = 'slot-machine';
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-label', 'Weapon slot machine');
    r.innerHTML = `
      <div class="slot-bay">
        <div class="slot-bulbs" data-k="bulbs">${'<i></i>'.repeat(14)}</div>
        <div class="slot-panel ui-plate ui-plate--menu">
          <div class="slot-head">
            <span class="slot-title ui-title">Weapon Slot Machine</span>
            <span class="ui-micro">spin to summon a random weapon</span>
          </div>
          <div class="slot-reels" data-k="reels">
            ${REELS.map((_, i) => `<div class="slot-reel" data-reel="${i}"><div class="slot-strip" data-strip="${i}"></div><span class="slot-cap"></span></div>`).join('')}
          </div>
          <div class="slot-result" data-k="result" aria-live="polite">Pull the lever</div>
          <div class="slot-actions">
            <button class="ui-btn ui-btn--primary slot-spin" data-k="spin" data-testid="slot-spin">Spin</button>
            <button class="ui-btn ui-btn--secondary" data-k="close" data-testid="slot-close">Close</button>
          </div>
        </div>
        <div class="slot-lever" data-k="lever" data-testid="slot-lever" role="button" tabindex="0" aria-label="Pull the lever">
          <div class="slot-lever__mount"></div>
          <div class="slot-lever__arm"><div class="slot-lever__knob"></div></div>
        </div>
      </div>`;
    r.querySelectorAll<HTMLElement>('[data-strip]').forEach((n) => this.strips.push(n));
    r.querySelectorAll<HTMLElement>('.slot-reel').forEach((n) => this.reels.push(n));
    this.panel = r.querySelector('.slot-panel') as HTMLElement;
    this.result = r.querySelector('[data-k="result"]') as HTMLElement;
    this.spinBtn = r.querySelector('[data-k="spin"]') as HTMLButtonElement;
    this.lever = r.querySelector('[data-k="lever"]') as HTMLElement;
    (r.querySelector('[data-k="close"]') as HTMLButtonElement).addEventListener('click', () => this.hide());
    this.spinBtn.addEventListener('click', () => this.spin());
    const pull = () => this.spin();
    this.lever.addEventListener('click', pull);
    this.lever.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') pull();
    });
    isolate(r);
    r.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.hide();
      else if (e.key === 'Enter' || e.key === ' ') this.spin();
    });
    parent.append(r);
  }

  get visible() {
    return !this.root.hidden;
  }

  /** show the machine; `onResult` receives the forged prompt once the reels settle */
  show(onResult: (prompt: string) => void) {
    this.onResult = onResult;
    this.reset();
    this.root.hidden = false;
    this.spinBtn.focus();
  }

  hide() {
    this.root.hidden = true;
    this.spinning = false;
    this.cancel();
  }

  private cancel() {
    this.timeouts.forEach((t) => window.clearTimeout(t));
    this.timeouts = [];
  }

  private reset() {
    this.cancel();
    this.spinning = false;
    this.spinBtn.disabled = false;
    this.lever.classList.remove('pulled');
    this.panel.classList.remove('win');
    this.reels.forEach((r) => r.classList.remove('settled', 'clunk'));
    this.result.textContent = 'Pull the lever';
    this.result.classList.remove('pop');
    this.strips.forEach((_, i) => this.fillStrip(i, null));
  }

  /** build a tall random column; `last` (the winner) sits at the bottom so the strip lands on it */
  private fillStrip(i: number, last: string | null) {
    const words: string[] = [];
    for (let k = 0; k < STRIP_LEN; k++) words.push(pick(REELS[i]));
    if (last) words[STRIP_LEN - 1] = last;
    const strip = this.strips[i];
    strip.innerHTML = words.map((w) => `<span>${esc(w)}</span>`).join('');
    strip.style.transition = 'none';
    strip.style.transform = 'translateY(0)';
  }

  spin() {
    if (this.spinning || this.root.hidden) return;
    this.spinning = true;
    this.spinBtn.disabled = true;
    this.panel.classList.remove('win');
    this.result.textContent = 'Spinning…';
    this.result.classList.remove('pop');
    this.lever.classList.add('pulled');
    this.blip(170, 0.06, 0.12);

    const chosen = REELS.map((a) => Math.floor(Math.random() * a.length));
    REELS.forEach((_, i) => this.fillStrip(i, REELS[i][chosen[i]]));
    const cell = this.reels[0]?.getBoundingClientRect().height || FALLBACK_CELL;
    void this.root.offsetHeight; // flush layout so the reset transform applies before the transition

    const done: boolean[] = [false, false, false];
    REELS.forEach((_, i) => {
      const dur = 1250 + i * 420 + Math.random() * 220;
      const strip = this.strips[i];
      strip.style.transition = `transform ${dur}ms cubic-bezier(0.14, 0.9, 0.16, 1)`;
      strip.style.transform = `translateY(-${(STRIP_LEN - 1) * cell}px)`;
      this.tick(dur);
      this.timeouts.push(window.setTimeout(() => this.settle(i, done, chosen), dur + 20));
    });
  }

  /** reel ticks while a strip is spinning (rate tapers out) */
  private tick(dur: number) {
    let t = 0;
    let gap = 70;
    while (t < dur - 120) {
      this.timeouts.push(window.setTimeout(() => this.blip(320 + Math.random() * 60, 0.02, 0.03), t));
      t += gap;
      gap *= 1.18;
    }
  }

  private settle(i: number, done: boolean[], chosen: number[]) {
    this.reels[i].classList.add('settled', 'clunk');
    this.blip(140 + i * 55, 0.08, 0.14);
    this.timeouts.push(window.setTimeout(() => this.reels[i].classList.remove('clunk'), 200));
    done[i] = true;
    if (done.every(Boolean)) this.finish(chosen);
  }

  private finish(chosen: number[]) {
    const prompt = REELS.map((arr, i) => arr[chosen[i]]).join(' ');
    this.lever.classList.remove('pulled');
    this.panel.classList.add('win');
    this.result.textContent = prompt;
    this.result.classList.add('pop');
    this.chord();
    this.spinBtn.disabled = false;
    // brief beat to savour the jackpot, then forge it
    this.timeouts.push(
      window.setTimeout(() => {
        this.spinning = false;
        this.hide();
        this.onResult?.(prompt);
      }, 1000),
    );
  }

  // ------------------------------------------------------------------ audio (tiny WebAudio)
  private ctx(): AudioContext | undefined {
    if (this.audio) return this.audio;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return undefined;
    try {
      this.audio = new Ctx();
    } catch {
      return undefined;
    }
    return this.audio;
  }

  private blip(freq: number, vol: number, dur: number) {
    const ac = this.ctx();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + dur);
  }

  private chord() {
    [523, 659, 784, 1046].forEach((f, i) => window.setTimeout(() => this.blip(f, 0.05, 0.18), i * 70));
  }
}
