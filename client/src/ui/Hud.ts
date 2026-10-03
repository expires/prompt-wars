import './hud.css';
import { SettingsPanel } from './SettingsPanel';

export interface DeathScreenHandlers {
  onKeepLoadout(): void;
  onGenerateWeapon(prompt: string): void | Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Plain-DOM HUD overlay. */
export class Hud {
  private readonly root = el('div', 'hud');
  private readonly hpValue: HTMLElement;
  private readonly hpBar: HTMLElement;
  private readonly ammoValue: HTMLElement;
  private readonly reloadEl: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly killfeed = el('div', 'panel killfeed');
  private readonly hitmarker = el('div', 'hitmarker');
  private readonly crosshair = el('div', 'crosshair');
  private readonly scope = el('div', 'scope');
  private crossGap = -1;
  private readonly vignette = el('div', 'damage-vignette');
  private readonly debugEl = el('div', 'panel debug');
  private readonly spawnEditorEl = el('div', 'panel spawn-editor');
  private readonly clickOverlay: HTMLElement;
  private readonly deathOverlay: HTMLElement;
  private readonly promptInput: HTMLInputElement;
  private readonly genBtn: HTMLButtonElement;
  private readonly keepBtn: HTMLButtonElement;
  private readonly deathMsg: HTMLElement;
  private readonly genStatus = el('div', 'gen-status');
  private readonly scoreboard = el('div', 'panel scoreboard');
  private keepLabel = 'Keep loadout';
  private hitTimer = 0;
  private dmgTimer = 0;
  /** test hook: keep the hitmarker on screen (screenshots) */
  holdHitmarker = false;
  readonly settingsPanel: SettingsPanel;
  deathHandlers?: DeathScreenHandlers;

  constructor(parent: HTMLElement = document.body) {
    // dynamic crosshair: four lines whose gap follows the current weapon spread
    this.crosshair.innerHTML = `<i class="l t"></i><i class="l b"></i><i class="l lft"></i><i class="l r"></i><i class="dot"></i>`;
    this.crosshair.dataset.testid = 'crosshair';
    this.hitmarker.innerHTML = `<svg width="30" height="30" viewBox="0 0 30 30" stroke="currentColor" stroke-width="2.5"><path d="M4 4l7 7M26 4l-7 7M4 26l7-7M26 26l-7-7"/></svg>`;
    this.hitmarker.dataset.testid = 'hitmarker';
    this.scope.innerHTML = `<div class="scope-ring"></div><div class="scope-h"></div><div class="scope-v"></div>`;
    this.scope.hidden = true;
    this.root.append(this.scope, this.crosshair, this.hitmarker, this.vignette);
    this.setCrosshairGap(6);

    const hp = el('div', 'panel hp');
    hp.append(el('div', 'label', 'HEALTH'));
    this.hpValue = el('div', 'value', '100');
    const bar = el('div', 'bar');
    this.hpBar = el('div');
    this.hpBar.style.width = '100%';
    bar.append(this.hpBar);
    hp.append(this.hpValue, bar);

    const ammo = el('div', 'panel ammo');
    this.weaponName = el('div', 'weapon-name', '—');
    this.ammoValue = el('div', 'value', '0');
    this.reloadEl = el('div', 'reloading');
    ammo.append(this.weaponName, el('div', 'label', 'AMMO'), this.ammoValue, this.reloadEl);

    this.spawnEditorEl.hidden = true;
    this.debugEl.hidden = true;
    this.scoreboard.hidden = true;
    this.scoreboard.dataset.testid = 'scoreboard';
    this.killfeed.dataset.testid = 'killfeed';
    this.hpValue.dataset.testid = 'hp';
    this.weaponName.dataset.testid = 'weapon-name';
    this.root.append(hp, ammo, this.killfeed, this.debugEl, this.spawnEditorEl, this.scoreboard);

    // click-to-play
    this.clickOverlay = el('div', 'overlay click');
    this.clickOverlay.innerHTML = `
      <h1>AI GAEM</h1>
      <p>Click to play</p>
      <div class="controls">
        <kbd>WASD</kbd><span>move</span>
        <kbd>Shift</kbd><span>sprint (forward)</span>
        <kbd>C / Ctrl</kbd><span>crouch (hold, or toggle in settings)</span>
        <kbd>Space</kbd><span>jump</span>
        <kbd>Mouse</kbd><span>look / fire</span>
        <kbd>Right mouse</kbd><span>aim down sights</span>
        <kbd>Arrows / Q E</kbd><span>turn (trackpad fallback)</span>
        <kbd>R</kbd><span>reload</span>
        <kbd>1-6</kbd><span>debug: swap sample weapon</span>
        <kbd>K</kbd><span>debug: die</span>
        <kbd>F2</kbd><span>spawn editor (P = save spawn)</span>
        <kbd>F3</kbd><span>debug info</span>
        <kbd>Esc</kbd><span>release mouse / settings</span>
      </div>`;
    this.settingsPanel = new SettingsPanel();
    this.clickOverlay.append(this.settingsPanel.root);

    // death screen
    this.deathOverlay = el('div', 'overlay death');
    this.deathOverlay.hidden = true;
    this.deathMsg = el('p', '', '');
    this.keepBtn = el('button', 'btn', 'Keep loadout') as HTMLButtonElement;
    this.promptInput = el('input', 'prompt-input') as HTMLInputElement;
    this.promptInput.placeholder = 'Describe a new weapon… e.g. "banana-powered sniper"';
    this.promptInput.maxLength = 200;
    this.genBtn = el('button', 'btn primary', 'Generate new weapon') as HTMLButtonElement;
    const row = el('div', 'row');
    row.append(this.keepBtn, this.genBtn);
    this.deathOverlay.dataset.testid = 'death-screen';
    this.keepBtn.dataset.testid = 'keep-loadout';
    this.genBtn.dataset.testid = 'generate-weapon';
    this.promptInput.dataset.testid = 'weapon-prompt';
    this.genStatus.dataset.testid = 'gen-status';
    this.deathOverlay.append(el('h1', '', 'YOU DIED'), this.deathMsg, this.promptInput, row, this.genStatus);
    this.keepBtn.addEventListener('click', () => this.deathHandlers?.onKeepLoadout());
    const gen = async () => {
      if (!this.deathHandlers) return;
      this.setGenerating(true);
      try {
        await this.deathHandlers.onGenerateWeapon(this.promptInput.value);
      } finally {
        this.setGenerating(false);
      }
    };
    this.genBtn.addEventListener('click', gen);
    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') gen();
      e.stopPropagation();
    });

    parent.append(this.root, this.clickOverlay, this.deathOverlay);
  }

  onClickToPlay(cb: () => void) {
    this.clickOverlay.addEventListener('click', cb);
  }

  showClickToPlay(show: boolean) {
    this.clickOverlay.hidden = !show;
  }

  showDeath(show: boolean, message = '') {
    this.deathOverlay.hidden = !show;
    this.deathMsg.textContent = message;
    if (show) {
      this.clickOverlay.hidden = true;
      this.promptInput.value = '';
      this.setGenStatus(null);
      this.setGenerating(false);
    }
  }

  setDeathMessage(text: string) {
    this.deathMsg.textContent = text;
  }

  /** seconds until respawn is allowed (0 = ready); shown on the Keep loadout button */
  setRespawnCountdown(seconds: number) {
    const label = seconds > 0 ? `Keep loadout (${Math.ceil(seconds)})` : 'Keep loadout';
    if (label !== this.keepLabel) {
      this.keepLabel = label;
      if (!this.genBtn.disabled) this.keepBtn.textContent = label;
    }
  }

  /** death-screen status line: generating / generated weapon summary / error */
  setGenStatus(html: string | null, error = false) {
    this.genStatus.innerHTML = html ?? '';
    this.genStatus.classList.toggle('error', error);
  }

  setScoreboard(text: string | null, ok = true) {
    this.scoreboard.hidden = text === null;
    if (text !== null) {
      this.scoreboard.textContent = text;
      this.scoreboard.classList.toggle('net-bad', !ok);
    }
  }

  get deathVisible() {
    return !this.deathOverlay.hidden;
  }

  setGenerating(on: boolean, label = 'Generating…') {
    this.genBtn.disabled = on;
    this.keepBtn.disabled = on;
    this.promptInput.disabled = on;
    this.genBtn.textContent = on ? label : 'Generate new weapon';
    if (!on) this.keepBtn.textContent = this.keepLabel;
  }

  setHealth(hp: number, max = 100) {
    const v = Math.max(0, Math.round(hp));
    this.hpValue.textContent = String(v);
    const f = Math.max(0, Math.min(1, hp / max));
    this.hpBar.style.width = `${f * 100}%`;
    this.hpBar.style.background = f > 0.5 ? 'var(--hud-ok)' : f > 0.25 ? 'var(--hud-accent)' : 'var(--hud-danger)';
  }

  setAmmo(ammo: number, mag: number, reloading: boolean) {
    this.ammoValue.innerHTML = Number.isFinite(ammo) ? `${ammo} <small>/ ${mag}</small>` : '∞';
    this.reloadEl.textContent = reloading ? 'RELOADING…' : '';
  }

  setWeaponName(name: string) {
    this.weaponName.textContent = name;
  }

  hitMarker(kill = false, headshot = false) {
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.classList.toggle('headshot', headshot);
    this.hitmarker.classList.remove('show');
    void this.hitmarker.offsetWidth; // restart the pop animation
    this.hitmarker.classList.add('show');
    this.hitTimer = kill ? 0.35 : headshot ? 0.3 : 0.14;
  }

  /** crosshair arm gap in px (from the weapon's current spread); hidden while aiming */
  setCrosshairGap(px: number) {
    const g = Math.round(Math.min(80, Math.max(3, px)));
    if (g === this.crossGap) return;
    this.crossGap = g;
    this.crosshair.style.setProperty('--gap', `${g}px`);
  }

  setCrosshairVisible(lines: boolean, dot = true) {
    this.crosshair.classList.toggle('no-lines', !lines);
    this.crosshair.classList.toggle('no-dot', !dot);
  }

  showScope(on: boolean) {
    this.scope.hidden = !on;
  }

  damageFlash() {
    this.vignette.classList.add('show');
    this.dmgTimer = 0.15;
  }

  addKill(killer: string, weapon: string, victim: string, headshot = false) {
    const hs = headshot
      ? `<span class="hs" data-testid="kf-headshot" title="headshot"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="7" r="4.5"/><path d="M5.5 13.5h5M8 0.5v3M8 10.5v3M0.5 7h3M12.5 7h3"/></svg></span>`
      : '';
    const e = el('div', 'entry', `<b>${esc(killer)}</b><i>[${esc(weapon)}]</i>${hs}${esc(victim)}`);
    this.killfeed.prepend(e);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild?.remove();
    setTimeout(() => e.remove(), 6000);
  }

  setDebug(text: string | null) {
    this.debugEl.hidden = text === null;
    if (text !== null) this.debugEl.textContent = text;
  }

  setSpawnEditor(text: string | null) {
    this.spawnEditorEl.hidden = text === null;
    if (text !== null) this.spawnEditorEl.textContent = text;
  }

  update(dt: number) {
    if (!this.holdHitmarker && this.hitTimer > 0 && (this.hitTimer -= dt) <= 0) this.hitmarker.classList.remove('show');
    if (this.dmgTimer > 0 && (this.dmgTimer -= dt) <= 0) this.vignette.classList.remove('show');
  }
}
