// Landing / first login: callsign + PLAY + loadout card + FORGE + quick pick.
// New players (server needsLoadout) create a character + weapon (or quick-pick) before PLAY deploys.
import './menus.css';
import { el, esc, isolate } from '../dom';
import { icon } from '../icons';
import { cardDataFor, renderWeaponCard } from '../WeaponCard';
import { localIdentity } from '../forgeCredit';
import type { Weapon } from '../../weapons/types';

export interface LandingState {
  callsign: string;
  needsLoadout: boolean;
  weapon: Weapon | null;
  presets: { id: string; cls: string; name: string }[];
  status: string;
  statusKind?: 'ok' | 'off' | 'bad';
  /** the player is alive in the world already (PLAY just resumes) */
  alive: boolean;
  busy?: boolean;
  /** current outfit stats ("HP 120 · Speed −5% · Size L") */
  outfitLine?: string;
}

export interface LandingHandlers {
  onPlay(callsign: string): void;
  onForge(callsign: string): void;
  onQuickPick(presetId: string, cls: string, callsign: string): void;
  /** open the Closet (outfit) */
  onCloset?(callsign: string): void;
}

const QUICK = ['pistol', 'rifle', 'shotgun', 'sniper', 'smg', 'melee'];
const ADJ = ['Rusty', 'Neon', 'Turbo', 'Velvet', 'Feral', 'Cosmic', 'Salty', 'Quantum', 'Grumpy', 'Electric', 'Silent', 'Crispy'];
const NOUN = ['Badger', 'Toaster', 'Falcon', 'Pickle', 'Comet', 'Walrus', 'Gecko', 'Yeti', 'Noodle', 'Raven', 'Cactus', 'Otter'];

export function randomCallsign(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}${n}${Math.floor(Math.random() * 90 + 10)}`;
}

export class Landing {
  readonly root = el('div', 'menu-layer landing');
  private readonly input: HTMLInputElement;
  private readonly play: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly card: HTMLElement;
  private readonly quick: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly forgeBtn: HTMLButtonElement;
  private readonly onlineEl: HTMLElement;
  private onlineN: number | null = null;
  private st: LandingState | null = null;
  handlers?: LandingHandlers;

  constructor(parent: HTMLElement = document.body) {
    const r = this.root;
    r.hidden = true;
    r.dataset.testid = 'landing';
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-label', 'Main menu');
    r.innerHTML = `
      <div class="landing-left">
        <div class="landing-status" data-k="status"><span class="dot"></span><span></span></div>
        <h1 class="landing-logo">Prompt<br><span class="accent">Wars</span></h1>
        <p class="landing-tagline">Prompt a weapon. <b>Win the arena.</b></p>
        <div class="landing-field">
          <label class="ui-micro" for="callsign-input">Callsign</label>
          <div class="landing-callsign">
            <input id="callsign-input" class="ui-input" data-k="input" data-testid="callsign" maxlength="24" autocomplete="off" spellcheck="false">
            <button class="ui-btn ui-btn--secondary landing-dice" data-k="dice" aria-label="Random callsign" title="Random callsign">${icon('dice')}</button>
          </div>
        </div>
        <button class="ui-btn ui-btn--primary ui-btn--lg landing-play" data-k="play" data-testid="landing-play">${icon('play')}<span data-k="playLabel">Play</span></button>
        <p class="landing-hint" data-k="hint"></p>
        <div class="landing-online" data-k="online" data-testid="landing-online" hidden><span class="dot"></span><span><b data-k="onlineN">0</b> online</span></div>
        <div class="landing-controls">
          <span class="ui-kbd"><span>WASD</span></span><span>move · <span class="ui-kbd"><span>Space</span></span> jump · <span class="ui-kbd"><span>Shift</span></span> sprint · <span class="ui-kbd"><span>C</span></span> crouch</span>
          <span class="ui-kbd"><span>Mouse</span></span><span>aim · LMB fire · RMB ADS · <span class="ui-kbd"><span>R</span></span> reload</span>
          <span class="ui-kbd"><span>Esc</span></span><span>menu</span>
        </div>
      </div>
      <div class="landing-right">
        <div class="ui-micro"><span>Loadout</span></div>
        <div data-k="card" data-testid="landing-loadout"></div>
        <button class="ui-btn ui-btn--forge landing-forge" data-k="forge" data-testid="landing-forge"><span class="spark">${icon('spark')}</span><span>Forge weapon</span></button>
        <button class="ui-btn ui-btn--secondary landing-closet" data-k="closet" data-testid="landing-closet">${icon('shield')}<span>Closet</span><span class="ui-micro" data-k="outfitNote"></span></button>
        <div class="landing-quick">
          <span class="ui-micro">Or pick a preset</span>
          <div class="landing-quick-row" data-k="quick"></div>
        </div>
      </div>`;
    const q = <T extends HTMLElement>(k: string) => r.querySelector<T>(`[data-k="${k}"]`)!;
    this.input = q('input');
    this.play = q('play');
    this.hint = q('hint');
    this.card = q('card');
    this.quick = q('quick');
    this.statusEl = q('status');
    this.forgeBtn = q('forge');
    this.onlineEl = q('online');
    isolate(r);
    r.addEventListener('keydown', (e) => e.stopPropagation());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.play.click();
    });
    q('dice').addEventListener('click', () => {
      this.input.value = randomCallsign();
      this.input.focus();
    });
    this.play.addEventListener('click', () => this.handlers?.onPlay(this.callsign()));
    this.forgeBtn.addEventListener('click', () => this.handlers?.onForge(this.callsign()));
    q('closet').addEventListener('click', () => this.handlers?.onCloset?.(this.callsign()));
    this.quick.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]');
      if (b) this.handlers?.onQuickPick(b.dataset.preset!, b.dataset.cls!, this.callsign());
    });
    parent.append(r);
  }

  callsign(): string {
    return this.input.value.trim().slice(0, 24) || this.st?.callsign || randomCallsign();
  }

  get visible() {
    return !this.root.hidden;
  }

  show(s: LandingState) {
    const first = this.root.hidden;
    this.st = s;
    this.root.hidden = false;
    if (first || !this.input.value) this.input.value = s.callsign;
    this.update(s);
    if (first && !s.needsLoadout && !this.input.value) requestAnimationFrame(() => this.input.focus({ preventScroll: true }));
  }

  update(s: LandingState) {
    this.st = s;
    const label = this.root.querySelector('[data-k="playLabel"]')!;
    label.textContent = s.needsLoadout ? 'Play' : s.alive ? 'Resume' : 'Deploy';
    this.play.disabled = !!s.busy;
    this.forgeBtn.disabled = !!s.busy;
    const cb = this.root.querySelector<HTMLButtonElement>('[data-k="closet"]')!;
    cb.disabled = !!s.busy;
    this.root.querySelector('[data-k="outfitNote"]')!.textContent = s.outfitLine ?? '';
    this.hint.innerHTML = s.needsLoadout
      ? '<b>Create a character</b> to start.'
      : `Deploying with <b>${esc(s.weapon?.name ?? 'your weapon')}</b>`;
    renderWeaponCard(this.card, s.weapon ? cardDataFor(s.weapon, s.weapon.owner ? s.callsign : undefined, localIdentity() || undefined) : null);
    const st = this.statusEl;
    st.className = `landing-status ${s.statusKind ?? 'ok'}`;
    st.lastElementChild!.textContent = s.status;
    const presets = QUICK.map((c) => s.presets.find((p) => p.cls === c)).filter(Boolean) as LandingState['presets'];
    this.quick.innerHTML = presets.length
      ? presets.map((p) => `<button class="ui-chip" data-preset="${esc(p.id)}" data-cls="${esc(p.cls)}" data-testid="quick-pick-${esc(p.cls)}" ${s.busy ? 'disabled' : ''}><span>${esc(p.name)}</span></button>`).join('')
      : '<span class="ui-micro">Connecting…</span>';
  }

  /** live "● N online" under PLAY (null = offline / unknown: hidden) */
  setOnline(n: number | null) {
    if (n === this.onlineN) return;
    this.onlineN = n;
    this.onlineEl.hidden = n === null;
    if (n !== null) this.onlineEl.querySelector('[data-k="onlineN"]')!.textContent = String(n);
  }

  hide() {
    this.root.hidden = true;
  }
}
