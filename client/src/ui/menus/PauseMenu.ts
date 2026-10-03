// Esc pause menu: left rail (RESUME · REDEPLOY · WEAPON FORGE · SETTINGS · LEAVE) + right area
// (loadout summary, or the tabbed settings panel).
import './menus.css';
import { el, esc, isolate } from '../dom';
import { icon } from '../icons';
import { cardDataFor, renderWeaponCard } from '../WeaponCard';
import type { SettingsPanel } from '../SettingsPanel';
import type { Weapon } from '../../weapons/types';

export interface PauseHandlers {
  onResume(): void;
  onRedeploy(): void;
  onForge(): void;
  onLeave(): void;
}

export class PauseMenu {
  readonly root = el('div', 'menu-layer pause');
  private readonly summary: HTMLElement;
  private readonly settingsHost: HTMLElement;
  private readonly card: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly settingsBtn: HTMLButtonElement;
  handlers?: PauseHandlers;

  constructor(
    readonly settings: SettingsPanel,
    parent: HTMLElement = document.body,
  ) {
    const r = this.root;
    r.hidden = true;
    r.dataset.testid = 'pause-menu';
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-label', 'Pause menu');
    r.innerHTML = `
      <nav class="pause-rail" aria-label="Pause">
        <h1 class="pause-title">Paused</h1>
        <p class="pause-sub" data-k="sub"></p>
        <button class="pause-item primary" data-k="resume" data-testid="pause-resume">${icon('play')}<span class="grow">Resume</span><span class="ui-kbd"><span>Esc</span></span></button>
        <button class="pause-item" data-k="redeploy" data-testid="pause-redeploy">${icon('redeploy')}<span class="grow">Redeploy</span><span class="note">change loadout</span></button>
        <button class="pause-item pause-item--forge" data-k="forge" data-testid="pause-forge">${icon('spark')}<span class="grow">Weapon Forge</span><span class="note">next deploy</span></button>
        <button class="pause-item" data-k="settings" data-testid="pause-settings" aria-expanded="false">${icon('gear')}<span class="grow">Settings</span>${icon('chevron', 'ui-icon ui-icon--sm')}</button>
        <div class="pause-spacer"></div>
        <button class="pause-item leave" data-k="leave" data-testid="pause-leave">${icon('exit')}<span class="grow">Leave</span></button>
      </nav>
      <section class="pause-main">
        <div class="pause-summary" data-k="summary">
          <span class="ui-micro">Current loadout</span>
          <div data-k="card"></div>
        </div>
        <div class="pause-settings" data-k="settingsHost" hidden></div>
      </section>`;
    const q = <T extends HTMLElement>(k: string) => r.querySelector<T>(`[data-k="${k}"]`)!;
    this.summary = q('summary');
    this.settingsHost = q('settingsHost');
    this.card = q('card');
    this.sub = q('sub');
    this.settingsBtn = q('settings');
    this.settingsHost.append(settings.root);
    isolate(r);
    r.addEventListener('keydown', (e) => e.stopPropagation());
    q('resume').addEventListener('click', () => this.handlers?.onResume());
    q('redeploy').addEventListener('click', () => this.handlers?.onRedeploy());
    q('forge').addEventListener('click', () => this.handlers?.onForge());
    q('leave').addEventListener('click', () => this.handlers?.onLeave());
    this.settingsBtn.addEventListener('click', () => this.showSettings(!!this.settingsHost.hidden));
    // keyboard / gamepad style navigation in the rail
    r.querySelector('.pause-rail')!.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== 'ArrowDown' && ke.key !== 'ArrowUp') return;
      const items = [...r.querySelectorAll<HTMLButtonElement>('.pause-item')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const n = items[(i + (ke.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      n?.focus();
      ke.preventDefault();
    });
    parent.append(r);
  }

  get visible() {
    return !this.root.hidden;
  }

  showSettings(on: boolean) {
    this.settingsHost.hidden = !on;
    this.summary.hidden = on;
    this.settingsBtn.setAttribute('aria-current', String(on));
    this.settingsBtn.setAttribute('aria-expanded', String(on));
    if (on) this.settings.sync();
  }

  show(info: { weapon: Weapon | null; callsign: string; hp: number; kills: number; deaths: number; online: boolean }) {
    const first = this.root.hidden;
    this.root.hidden = false;
    renderWeaponCard(this.card, info.weapon ? cardDataFor(info.weapon, info.weapon.owner ? info.callsign : undefined) : null);
    this.sub.innerHTML = `<span>${esc(info.callsign)}</span><span>·</span><span>${info.kills} K / ${info.deaths} D</span>${info.online ? '' : '<span>· offline</span>'}`;
    if (first) {
      this.showSettings(false);
      requestAnimationFrame(() => this.root.querySelector<HTMLButtonElement>('[data-k="resume"]')?.focus({ preventScroll: true }));
    }
  }

  hide() {
    this.root.hidden = true;
  }
}
