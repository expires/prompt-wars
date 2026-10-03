// Death screen: "ELIMINATED BY" + killer weapon card (remix this) | YOUR NEXT LIFE: keep loadout
// (countdown ring), quick forge prompt + chips, open forge.
import './menus.css';
import { el, esc, isolate } from '../dom';
import { icon } from '../icons';
import { cardDataFor, renderWeaponCard } from '../WeaponCard';
import { weaponPrompt } from '../forgeCredit';
import type { Weapon } from '../../weapons/types';

export interface DeathInfo {
  killerName?: string;
  /** killer identity hex (prompt-cache credit on their card) */
  killerId?: string;
  killerIsYou?: boolean;
  killerWeapon?: Weapon | null;
  headshot?: boolean;
  damage?: number;
  distance?: number;
  /** Esc-menu redeploy (no killer) */
  redeploy?: boolean;
  yourWeapon?: Weapon | null;
  message?: string;
}

export interface DeathHandlers {
  onKeepLoadout(): void;
  onQuickForge(prompt: string): void | Promise<void>;
  onOpenForge(prompt: string): void;
  onRemix(weapon: Weapon): void;
  /** open the weapon slot machine */
  onOpenSlot(): void;
}

const CHIPS = ['cactus shotgun', 'noodle sword', 'retro ray gun', 'bubble launcher', 'toaster cannon'];
const RING_C = 2 * Math.PI * 28;

export class DeathScreen {
  readonly root = el('div', 'menu-layer death');
  private readonly $: Record<string, HTMLElement> = {};
  private readonly input: HTMLInputElement;
  private readonly keep: HTMLButtonElement;
  private readonly quick: HTMLButtonElement;
  private total = 3;
  private keepLabel = '';
  private busy = false;
  private info: DeathInfo = {};
  handlers?: DeathHandlers;

  constructor(parent: HTMLElement = document.body) {
    const r = this.root;
    r.hidden = true;
    r.dataset.testid = 'death-screen';
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-label', 'Eliminated');
    r.innerHTML = `
      <header class="death-head">
        <div class="death-who">
          <span class="death-by" data-k="by">Eliminated by</span>
          <h1 class="death-killer" data-k="killer" data-testid="death-killer"></h1>
          <div class="death-quote" data-k="quote" data-testid="death-prompt" hidden></div>
          <div class="death-detail" data-k="detail"></div>
        </div>
        <div class="death-ring" data-k="ring" aria-label="Respawn timer">
          <svg viewBox="0 0 64 64" aria-hidden="true"><circle class="track" cx="32" cy="32" r="28"/><circle class="fill" data-k="ringFill" cx="32" cy="32" r="28" stroke-dasharray="${RING_C}" stroke-dashoffset="0"/></svg>
          <span class="num" data-k="ringNum">3</span>
        </div>
      </header>
      <section class="death-left" data-k="left">
        <span class="ui-micro" data-k="leftLabel">Their weapon</span>
        <div class="death-cardwrap" data-k="card" data-testid="killer-card"></div>
        <button class="ui-btn ui-btn--forge ui-btn--sm death-remix" data-k="remix" data-testid="remix-killer"><span class="spark">${icon('spark', 'ui-icon ui-icon--sm')}</span><span>Remix</span></button>
      </section>
      <section class="death-right">
        <h2 class="ui-title">Respawn</h2>
        <button class="ui-btn ui-btn--primary death-keep" data-k="keep" data-testid="keep-loadout"><span data-k="keepLabel">Keep loadout</span><span class="wname" data-k="keepName"></span></button>
        <div class="death-or">or forge a new one</div>
        <input class="ui-input death-prompt" data-k="input" data-testid="weapon-prompt" maxlength="200" placeholder="Describe a weapon" autocomplete="off">
        <div class="death-chips" data-k="chips">${CHIPS.map((c) => `<button class="ui-chip" data-chip="${esc(c)}"><span>${esc(c)}</span></button>`).join('')}</div>
        <div class="death-actions">
          <button class="ui-btn ui-btn--forge" data-k="quick" data-testid="generate-weapon"><span class="spark">${icon('spark', 'ui-icon ui-icon--sm')}</span><span data-k="quickLabel">Quick forge</span></button>
          <button class="ui-btn ui-btn--secondary" data-k="open" data-testid="death-open-forge"><span>Open forge</span>${icon('chevron', 'ui-icon ui-icon--sm')}</button>
          <button class="ui-btn ui-btn--secondary" data-k="slot" data-testid="death-slot">Slot machine</button>
        </div>
        <div class="death-status" data-k="status" data-testid="gen-status" aria-live="polite"></div>
      </section>`;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.$[n.dataset.k!] = n));
    this.input = this.$.input as HTMLInputElement;
    this.keep = this.$.keep as HTMLButtonElement;
    this.quick = this.$.quick as HTMLButtonElement;
    isolate(r);
    r.addEventListener('keydown', (e) => e.stopPropagation());
    this.keep.addEventListener('click', () => this.handlers?.onKeepLoadout());
    const gen = async () => {
      if (!this.handlers || this.busy) return;
      await this.handlers.onQuickForge(this.input.value);
    };
    this.quick.addEventListener('click', () => void gen());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void gen();
    });
    this.$.open.addEventListener('click', () => this.handlers?.onOpenForge(this.input.value));
    this.$.slot.addEventListener('click', () => this.handlers?.onOpenSlot());
    this.$.remix.addEventListener('click', () => {
      if (this.info.killerWeapon) this.handlers?.onRemix(this.info.killerWeapon);
    });
    this.$.chips.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-chip]');
      if (!c) return;
      this.input.value = c.dataset.chip!;
      this.input.focus();
    });
    parent.append(r);
  }

  get visible() {
    return !this.root.hidden;
  }

  show(info: DeathInfo) {
    this.info = info;
    const wasHidden = this.root.hidden;
    this.root.hidden = false;
    if (wasHidden) {
      this.input.value = '';
      this.setStatus(null);
      this.setBusy(false);
    }
    this.update(info);
  }

  /** refresh the killer details (the kill event can arrive after the death) */
  update(info: DeathInfo) {
    this.info = { ...this.info, ...info };
    const i = this.info;
    const $ = this.$;
    $.by.textContent = i.redeploy ? 'Redeploying' : i.killerName ? 'Eliminated by' : 'Eliminated';
    $.killer.textContent = i.redeploy ? 'Change loadout' : (i.killerName ?? i.message ?? 'You died');
    $.killer.classList.toggle('self', !!i.redeploy || !!i.killerIsYou || !i.killerName);
    const bits: string[] = [];
    if (i.headshot) bits.push(`<span class="hs">${icon('headshot', 'ui-icon ui-icon--sm')}Headshot</span>`);
    if (i.killerWeapon && !i.redeploy) bits.push(`<span>${esc(i.killerWeapon.name)}</span>`);
    if (i.damage) bits.push(`<span>${Math.round(i.damage)} dmg</span>`);
    if (i.distance) bits.push(`<span>${Math.round(i.distance)} m</span>`);
    if (i.redeploy) bits.push('<span>Pick a weapon</span>');
    $.detail.innerHTML = bits.join('<span>·</span>');
    const kw = i.redeploy ? null : i.killerWeapon;
    // the killer's original prompt: Killed by NAME · "a baguette that fires angry bees"
    const kp = kw && !i.killerIsYou ? weaponPrompt(kw) : '';
    $.quote.hidden = !kp;
    $.quote.textContent = kp ? `“${kp}”` : '';
    $.left.hidden = false;
    $.leftLabel.textContent = kw ? 'Their weapon' : 'Your weapon';
    const shownW = kw ?? i.yourWeapon ?? null;
    renderWeaponCard($.card, shownW ? cardDataFor(shownW, undefined, kw ? i.killerId : undefined) : null, { testid: kw ? 'killer-weapon-card' : 'your-weapon-card' });
    $.remix.hidden = !kw;
    $.keepName.textContent = i.yourWeapon?.name ?? '';
  }

  /** seconds until respawn is allowed (0 = ready) */
  setCountdown(seconds: number, total = 3) {
    this.total = Math.max(this.total, total);
    const s = Math.max(0, seconds);
    const f = this.total > 0 ? s / this.total : 0;
    (this.$.ringFill as unknown as SVGCircleElement).style.strokeDashoffset = String(RING_C * (1 - f));
    this.$.ringNum.textContent = s > 0 ? String(Math.ceil(s)) : '✓';
    this.$.ring.classList.toggle('ready', s <= 0);
    const label = s > 0 ? `Keep loadout (${Math.ceil(s)})` : 'Keep loadout';
    if (label !== this.keepLabel) {
      this.keepLabel = label;
      if (!this.busy) this.$.keepLabel.textContent = label;
    }
  }

  setBusy(on: boolean, label = 'Forging…') {
    this.busy = on;
    this.keep.disabled = on;
    this.quick.disabled = on;
    this.input.disabled = on;
    (this.$.open as HTMLButtonElement).disabled = on;
    (this.$.slot as HTMLButtonElement).disabled = on;
    this.$.quickLabel.textContent = on ? label : 'Quick forge';
    if (!on) this.$.keepLabel.textContent = this.keepLabel || 'Keep loadout';
    else if (label.startsWith('Respawn')) this.$.keepLabel.textContent = label;
  }

  setStatus(html: string | null, error = false) {
    this.$.status.innerHTML = html ?? '';
    this.$.status.classList.toggle('error', error);
  }

  hide() {
    this.root.hidden = true;
  }
}
