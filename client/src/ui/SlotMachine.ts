import './slot.css';
import { el, isolate } from './dom';

/**
 * Weapon slot machine: three reels spin to adjectives / objects / forms, then the combo is
 * handed to the forge ("molten toaster cannon"). Purely a fun front-end for the existing
 * weapon generator — it never fabricates weapon stats itself.
 */

const ADJ = [
  'molten', 'haunted', 'cozy', 'cyber', 'rusty', 'cosmic', 'rubber', 'glitter', 'cursed', 'banana',
  'military', 'origami', 'plasma', 'wooden', 'neon', 'spicy', 'frozen', 'tiny', 'giant', 'disco',
  'vintage', 'toxic', 'royal', 'junkyard', 'arctic', 'candy', 'shadow', 'brass', 'bubbly', 'cursed',
];
const OBJ = [
  'toaster', 'baguette', 'umbrella', 'keyboard', 'plunger', 'sock', 'kettle', 'guitar', 'stapler',
  'duck', 'cactus', 'train', 'piano', 'chainsaw', 'teapot', 'pretzel', 'magnet', 'bowling ball',
  'frying pan', 'cat', 'lamp', 'trumpet', 'waffle', 'stapler', 'vacuum', 'banjo', 'rocket', 'teacup',
];
const FORM = [
  'cannon', 'blaster', 'launcher', 'shotgun', 'sword', 'hammer', 'bazooka', 'rifle', 'pistol',
  'staff', 'wand', 'minigun', 'sniper', 'axe', 'flamethrower', 'crossbow', 'scepter', 'gauntlet',
];
const REELS = [ADJ, OBJ, FORM];
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export class SlotMachine {
  readonly root = el('div', 'menu-layer slot');
  private readonly words: HTMLElement[] = [];
  private readonly reels: HTMLElement[] = [];
  private readonly result: HTMLElement;
  private readonly spinBtn: HTMLButtonElement;
  private spinning = false;
  private onResult?: (prompt: string) => void;
  private timers: number[] = [];
  private timeouts: number[] = [];

  constructor(parent: HTMLElement = document.body) {
    const r = this.root;
    r.hidden = true;
    r.dataset.testid = 'slot-machine';
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-label', 'Weapon slot machine');
    r.innerHTML = `
      <div class="slot-panel ui-plate ui-plate--menu">
        <div class="slot-head">
          <span class="slot-title ui-title">Weapon Slot Machine</span>
          <span class="ui-micro">spin to summon a random weapon</span>
        </div>
        <div class="slot-reels" data-k="reels">
          ${REELS.map((_, i) => `<div class="slot-reel" data-reel="${i}"><span class="slot-word">—</span></div>`).join('')}
        </div>
        <div class="slot-result" data-k="result" aria-live="polite">Pull the lever</div>
        <div class="slot-actions">
          <button class="ui-btn ui-btn--primary slot-spin" data-k="spin" data-testid="slot-spin">Spin</button>
          <button class="ui-btn ui-btn--secondary" data-k="close" data-testid="slot-close">Close</button>
        </div>
      </div>`;
    r.querySelectorAll<HTMLElement>('.slot-word').forEach((n) => this.words.push(n));
    r.querySelectorAll<HTMLElement>('.slot-reel').forEach((n) => this.reels.push(n));
    this.result = r.querySelector('[data-k="result"]') as HTMLElement;
    this.spinBtn = r.querySelector('[data-k="spin"]') as HTMLButtonElement;
    (r.querySelector('[data-k="close"]') as HTMLButtonElement).addEventListener('click', () => this.hide());
    this.spinBtn.addEventListener('click', () => this.spin());
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

  /** clear any in-flight spin timers so closing mid-spin never forges */
  private cancel() {
    this.timers.forEach((t) => window.clearInterval(t));
    this.timeouts.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    this.timeouts = [];
  }

  private reset() {
    this.cancel();
    this.spinning = false;
    this.spinBtn.disabled = false;
    this.words.forEach((w, i) => (w.textContent = pick(REELS[i])));
    this.reels.forEach((reel) => reel.classList.remove('settled'));
    this.result.textContent = 'Pull the lever';
    this.result.classList.remove('rolling');
  }

  /** spin the reels, then hand the combo to the forge */
  spin() {
    if (this.spinning || this.root.hidden) return;
    this.spinning = true;
    this.spinBtn.disabled = true;
    this.result.textContent = 'Spinning…';
    this.result.classList.add('rolling');

    const chosen = REELS.map((arr) => Math.floor(Math.random() * arr.length));
    const done: boolean[] = [false, false, false];

    const settle = (i: number) => {
      window.clearInterval(this.timers[i]);
      this.words[i].textContent = REELS[i][chosen[i]];
      this.reels[i].classList.add('settled');
      done[i] = true;
      if (done.every(Boolean)) this.finish(chosen);
    };

    REELS.forEach((arr, i) => {
      const stopAt = 650 + i * 420 + Math.random() * 220;
      this.timers[i] = window.setInterval(() => this.words[i].textContent = pick(arr), 55);
      this.timeouts.push(window.setTimeout(() => settle(i), stopAt));
    });
  }

  private finish(chosen: number[]) {
    const prompt = REELS.map((arr, i) => arr[chosen[i]]).join(' ');
    this.result.textContent = prompt;
    this.result.classList.remove('rolling');
    this.spinBtn.disabled = false;
    // brief beat to read the result, then forge it
    this.timeouts.push(
      window.setTimeout(() => {
        this.spinning = false;
        this.hide();
        this.onResult?.(prompt);
      }, 650),
    );
  }
}
