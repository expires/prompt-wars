// In-game HUD ("Arcade Tactical", docs/ui-spec.md §HUD). Plain DOM, sized in --u units
// (1920×1080 reference, anchored to a centred 16:9 frame); the crosshair is in real px.
import './hud.css';
import { settings } from '../settings';
import { el, esc } from './dom';
import { icon } from './icons';
import { pipsHtml } from './rarity';
import { initUiSettings } from './hud/applyUiSettings';
import { crosshairFromSettings, renderCrosshair, setCrosshairSpread, type CrosshairConfig } from './hud/crosshair';
import { DamageArcs } from './hud/DamageArcs';
import { KillFeed, type KillOpts } from './hud/KillFeed';
import { Scoreboard, type ScoreRow } from './hud/Scoreboard';
import { Toasts, type ToastOpts } from './hud/Toasts';

export { esc } from './dom';
export type { KillOpts } from './hud/KillFeed';
export type { ScoreRow } from './hud/Scoreboard';
export type { ToastOpts, ToastType } from './hud/Toasts';

export interface HudWeaponInfo {
  name: string;
  tier: 1 | 2 | 3 | 4 | 5;
  tierLabel: string;
  /** melee weapon: current swing type (SLASH / THRUST / OVERHEAD / BASH …) */
  melee?: { swing: string } | null;
  /** carry-weight movement label ("+8%", "−12%"); omitted / "±0%" hides it */
  move?: string;
  /** weapon element (fire / ice / poison / shock) */
  element?: string | null;
}

/** Elemental status effects on the local player (HUD chips + screen vignettes). */
export interface HudElementStatus {
  burning: boolean;
  chilled: boolean;
  poisoned: boolean;
  shocked: boolean;
  /** active slow percent (shown on the chilled / shocked chip) */
  slowPercent: number;
}

initUiSettings();

const STATUS_DELAY = 0.15;

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const HITMARKER_SVG = (() => {
  // 4 diagonal ticks (normal), longer ticks (headshot / kill), diamond glyph (headshot)
  const ticks = (a: number, b: number) =>
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]
      .map(([sx, sy]) => `M${32 + sx * a} ${32 + sy * a}L${32 + sx * b} ${32 + sy * b}`)
      .join('');
  const n = ticks(6, 12);
  const h = ticks(6, 17);
  const d = 'M32 7l4 4-4 4-4-4z';
  return (
    `<svg viewBox="0 0 64 64" aria-hidden="true">` +
    `<g class="hm-n"><path class="hm-ol" d="${n}"/><path class="hm-c" d="${n}"/></g>` +
    `<g class="hm-h"><path class="hm-ol" d="${h}"/><path class="hm-c" d="${h}"/></g>` +
    `<g class="hm-d"><path class="hm-ol" d="${d}"/><path class="hm-c hm-fill" d="${d}"/></g>` +
    `</svg>`
  );
})();

const KILL_SVG =
  `<svg viewBox="0 0 44 44" aria-hidden="true">` +
  `<path class="kx-ol" d="M6 6L38 38M38 6L6 38"/><path class="kx-c" d="M6 6L38 38M38 6L6 38"/></svg>`;

/** Plain-DOM HUD overlay. */
export class Hud {
  private readonly root = el('div', 'hud');
  private readonly frame = el('div', 'hud-frame');
  private readonly center = el('div', 'hud-center');
  /** container for floating damage numbers */
  readonly numbersLayer = el('div', 'hud-dmg-layer');
  /** test hook: keep the hitmarker on screen (screenshots) */
  holdHitmarker = false;
  /** test / screenshot hook: show the scoreboard without holding Tab */
  forceScoreboard = false;

  // health
  private readonly hpPlate: HTMLElement;
  private readonly hpValue: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpTrail: HTMLElement;
  private readonly hpMax: HTMLElement;
  private hp = -1;
  private hpFrac = 1;
  // ammo
  private readonly ammoPlate: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly rarityChip: HTMLElement;
  private readonly magEl: HTMLElement;
  private readonly resEl: HTMLElement;
  private readonly ammoState: HTMLElement;
  private readonly swingEl: HTMLElement;
  private readonly reloadProg: HTMLElement;
  private ammoKey = '';
  private weaponKey = '';
  private meleeSwing: string | null = null;
  private lastAmmo: [number, number, boolean] = [0, 0, false];
  // crosshair + hit feedback
  private readonly crosshair = el('div');
  private xhCfg: CrosshairConfig;
  private xhKey = '';
  private spreadPx = 0;
  private readonly hitmarker = el('div', 'hud-hm');
  private readonly killX = el('div', 'hud-kx');
  private hitTimer = 0;
  private killTimer = 0;
  private readonly chargeEl = el('div', 'hud-charge');
  private readonly chargeFill: HTMLElement;
  private chargeFull = false;
  private readonly statusEl = el('div', 'hud-status');
  private statusPending = '';
  private statusShown = '';
  private statusAge = 0;
  private readonly scope = el('div', 'hud-scope');
  // damage
  private readonly arcs = new DamageArcs();
  private readonly hitFlash = el('div', 'hud-hitflash');
  /** screen-edge vignettes for elemental status (orange flames / frost) */
  private readonly burnFx = el('div', 'hud-burn');
  private readonly chillFx = el('div', 'hud-chill');
  private readonly poisonFx = el('div', 'hud-poison');
  /** status chips above the health plate (BURNING / CHILLED −35% ...) */
  private readonly fxChips = el('div', 'hud-fx');
  private fxKey = '';
  private moveEl!: HTMLElement;
  private elementEl!: HTMLElement;
  private readonly lowHp = el('div', 'hud-lowhp');
  // corners
  private readonly netEl = el('div', 'hud-net');
  private netKey = '';
  private readonly debugEl = el('div', 'hud-debug');
  private readonly spawnEditorEl = el('div', 'hud-spawned');
  private readonly killfeed = new KillFeed();
  private readonly scoreboard = new Scoreboard();
  private readonly toasts = new Toasts();
  private warningEl?: HTMLElement;
  private tabHeld = false;
  private visible = true;

  constructor(parent: HTMLElement = document.body) {
    // ---- centre: crosshair, hit / kill markers, charge, status
    this.crosshair.dataset.testid = 'crosshair';
    this.xhCfg = crosshairFromSettings(settings.current);
    this.applyCrosshair();
    this.hitmarker.innerHTML = HITMARKER_SVG;
    this.hitmarker.dataset.testid = 'hitmarker';
    this.killX.innerHTML = `<i class="hud-kx__ring"></i>${KILL_SVG}<span class="hud-kx__head">${icon('headshot', 'ui-icon')}</span>`;
    this.killX.dataset.testid = 'kill-confirm';
    this.chargeEl.innerHTML = '<div class="hud-charge__bar"><i class="hud-charge__fill"></i></div><span class="hud-charge__lbl">Release</span>';
    this.chargeFill = this.chargeEl.querySelector('.hud-charge__fill')!;
    this.chargeEl.hidden = true;
    this.chargeEl.dataset.testid = 'charge-meter';
    this.statusEl.dataset.testid = 'status-line';
    this.statusEl.hidden = true;
    this.center.append(this.arcs.root, this.crosshair, this.killX, this.hitmarker, this.chargeEl, this.statusEl);

    // ---- full-screen layers
    this.scope.innerHTML = '<div class="hud-scope__ring"></div><div class="hud-scope__h"></div><div class="hud-scope__v"></div>';
    this.scope.hidden = true;
    this.lowHp.innerHTML = '<i></i>';

    // ---- health (bottom-left)
    const health = el('div', 'hud-health');
    health.innerHTML =
      `<div class="hud-plate hud-health__plate">` +
      `<i class="hud-tick"></i>` +
      `<div class="hud-health__num ui-num" data-testid="hp">100</div>` +
      `<div class="hud-health__side">` +
      `<div class="hud-health__label">${icon('health', 'ui-icon hud-health__ico')}<span class="hud-micro">Health</span><span class="hud-health__max">/ 100</span></div>` +
      `<div class="hud-hpbar"><i class="hud-hpbar__track"></i><i class="hud-hpbar__trail"></i><i class="hud-hpbar__fill"></i></div>` +
      `</div></div>`;
    this.hpPlate = health.querySelector('.hud-health__plate')!;
    this.hpValue = health.querySelector('[data-testid=hp]')!;
    this.hpFill = health.querySelector('.hud-hpbar__fill')!;
    this.hpTrail = health.querySelector('.hud-hpbar__trail')!;
    this.hpMax = health.querySelector('.hud-health__max')!;
    this.fxChips.dataset.testid = 'status-effects';
    health.prepend(this.fxChips);
    this.burnFx.dataset.testid = 'fx-burning';
    this.chillFx.dataset.testid = 'fx-chilled';
    this.burnFx.innerHTML = '<i></i>';
    this.chillFx.innerHTML = '<i></i>';

    // ---- ammo (bottom-right)
    const ammo = el('div', 'hud-ammo');
    ammo.innerHTML =
      `<div class="hud-plate hud-ammo__plate">` +
      `<i class="hud-tick hud-tick--r"></i>` +
      `<div class="hud-ammo__top"><span class="hud-ammo__el" data-testid="hud-element" hidden></span><span class="hud-ammo__move" data-testid="hud-move" hidden></span><span class="hud-ammo__rar tier-1"></span><span class="hud-ammo__name" data-testid="weapon-name">—</span></div>` +
      `<div class="hud-ammo__main">` +
      `<div class="hud-ammo__state"></div>` +
      `<div class="hud-ammo__count"><span class="hud-ammo__mag ui-num">0</span><i class="hud-ammo__div"></i><span class="hud-ammo__res ui-num">0</span></div>` +
      `<div class="hud-ammo__melee">${icon('blade', 'ui-icon hud-ammo__mico')}<span class="hud-ammo__swing ui-num">Melee</span></div>` +
      `</div>` +
      `<i class="hud-ammo__prog"></i>` +
      `</div>`;
    this.ammoPlate = ammo.querySelector('.hud-ammo__plate')!;
    this.weaponName = ammo.querySelector('[data-testid=weapon-name]')!;
    this.moveEl = ammo.querySelector('[data-testid=hud-move]')!;
    this.elementEl = ammo.querySelector('[data-testid=hud-element]')!;
    this.rarityChip = ammo.querySelector('.hud-ammo__rar')!;
    this.magEl = ammo.querySelector('.hud-ammo__mag')!;
    this.resEl = ammo.querySelector('.hud-ammo__res')!;
    this.ammoState = ammo.querySelector('.hud-ammo__state')!;
    this.swingEl = ammo.querySelector('.hud-ammo__swing')!;
    this.reloadProg = ammo.querySelector('.hud-ammo__prog')!;

    this.debugEl.hidden = true;
    this.spawnEditorEl.hidden = true;
    this.netEl.hidden = true;
    const topLeft = el('div', 'hud-tl');
    topLeft.append(this.netEl, this.debugEl);

    this.frame.append(health, ammo, topLeft, this.killfeed.root, this.scoreboard.root, this.spawnEditorEl);
    this.root.append(this.scope, this.lowHp, this.burnFx, this.chillFx, this.poisonFx, this.hitFlash, this.numbersLayer, this.center, this.frame);
    parent.append(this.root, this.toasts.root);

    this.setHealth(100);
    this.setCrosshairGap(0);

    settings.onChange((s) => {
      const cfg = crosshairFromSettings(s);
      this.xhCfg = cfg;
      this.applyCrosshair();
      this.updateLowHp();
      if (!s.showFps) this.netKey = '';
    });

    // hold Tab: scoreboard (capture so the browser never moves focus while playing)
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Tab' || !this.visible || isEditable(e.target)) return;
        e.preventDefault();
        if (!this.tabHeld) {
          this.tabHeld = true;
          this.refreshScoreboard();
        }
      },
      true,
    );
    window.addEventListener(
      'keyup',
      (e) => {
        if (e.code !== 'Tab' || !this.tabHeld) return;
        this.tabHeld = false;
        this.refreshScoreboard();
      },
      true,
    );
    window.addEventListener('blur', () => {
      this.tabHeld = false;
      this.refreshScoreboard();
    });
  }

  // ------------------------------------------------------------------ health

  setHealth(hp: number, max = 100) {
    const v = Math.max(0, Math.round(hp));
    const f = Math.max(0, Math.min(1, hp / (max || 100)));
    if (v === this.hp && f === this.hpFrac) return;
    const prevFrac = this.hpFrac;
    this.hp = v;
    this.hpFrac = f;
    this.hpValue.textContent = String(v);
    this.hpMax.textContent = `/ ${Math.round(max)}`;
    const pct = f * 100;
    const band = pct > 60 ? 'hi' : pct >= 30 ? 'mid' : 'lo';
    this.hpPlate.dataset.band = band;
    this.hpPlate.classList.toggle('is-low', band === 'lo' && v > 0);
    // snap the fill to whole-ish values; trail lingers 300 ms then drains over 400 ms
    this.hpFill.style.transform = `scaleX(${f.toFixed(4)})`;
    if (f < prevFrac) {
      this.hpTrail.style.transition = 'transform 400ms var(--ease-out) 300ms';
    } else {
      this.hpTrail.style.transition = 'none';
    }
    this.hpTrail.style.transform = `scaleX(${f.toFixed(4)})`;
    this.updateLowHp();
  }

  private updateLowHp() {
    const hp = this.hp < 0 ? 100 : this.hpFrac * 100;
    const alive = this.hp > 0;
    const k = alive ? Math.max(0, Math.min(1, (40 - hp) / 40)) * 0.8 * settings.current.vignetteIntensity : 0;
    this.lowHp.style.opacity = k.toFixed(3);
    this.lowHp.classList.toggle('is-beat', alive && hp < 20);
  }

  // ------------------------------------------------------------------ weapon / ammo

  setWeaponName(name: string) {
    if (this.weaponName.textContent !== name) this.weaponName.textContent = name;
  }

  setWeapon(info: HudWeaponInfo) {
    const key = `${info.name}|${info.tier}|${info.tierLabel}|${info.melee?.swing ?? ''}|${!!info.melee}|${info.move ?? ''}|${info.element ?? ''}`;
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    this.setWeaponName(info.name);
    const move = info.move && info.move !== '±0%' ? info.move : '';
    this.moveEl.hidden = !move;
    if (move) {
      this.moveEl.className = `hud-ammo__move ${move.startsWith('+') ? 'is-fast' : 'is-slow'}`;
      this.moveEl.innerHTML = `${icon('speed', 'ui-icon')}<span>${esc(move)}</span>`;
      this.moveEl.title = `Move speed ${move}`;
    }
    this.elementEl.hidden = !info.element;
    if (info.element) {
      this.elementEl.className = `hud-ammo__el kf-el--${esc(info.element)}`;
      this.elementEl.innerHTML = icon(info.element, 'ui-icon');
      this.elementEl.title = info.element;
    }
    const tier = Math.max(1, Math.min(5, info.tier));
    this.rarityChip.className = `hud-ammo__rar tier-${tier}`;
    this.rarityChip.innerHTML = `<span class="hud-ammo__rar-in">${pipsHtml(tier)}<span>${esc(info.tierLabel)}</span></span>`;
    this.meleeSwing = info.melee ? info.melee.swing || 'Melee' : null;
    this.renderAmmo();
  }

  setAmmo(ammo: number, mag: number, reloading: boolean) {
    this.lastAmmo = [ammo, mag, reloading];
    this.renderAmmo();
  }

  private renderAmmo() {
    const [ammo, mag, reloading] = this.lastAmmo;
    const melee = this.meleeSwing !== null || !Number.isFinite(ammo);
    const empty = !melee && ammo <= 0;
    const low = !melee && !empty && mag > 0 && ammo <= mag * 0.25;
    const key = `${melee}|${melee ? (this.meleeSwing ?? 'Melee') : `${ammo}/${mag}`}|${reloading}`;
    if (key === this.ammoKey) return;
    this.ammoKey = key;
    const p = this.ammoPlate.classList;
    p.toggle('is-melee', melee);
    p.toggle('is-empty', empty && !reloading);
    p.toggle('is-low', low && !reloading);
    p.toggle('is-reloading', reloading && !melee);
    if (melee) {
      this.swingEl.textContent = this.meleeSwing ?? 'Melee';
      this.ammoState.innerHTML = `<span class="hud-hint"><span class="hud-hint__t">Block</span><span class="ui-kbd"><span>F</span></span></span>`;
      return;
    }
    this.magEl.textContent = String(Math.max(0, Math.floor(ammo)));
    this.resEl.textContent = String(Math.max(0, Math.floor(mag)));
    this.ammoState.innerHTML = reloading
      ? `<span class="hud-ammo__reloading">${icon('rotate', 'ui-icon')}<span>Reloading</span></span>`
      : empty
        ? `<span class="hud-ammo__chip">${icon('warning', 'ui-icon')}<span>Reload</span><span class="ui-kbd"><span>R</span></span></span>`
        : low
          ? `<span class="hud-ammo__lowtxt">${icon('ammo', 'ui-icon')}<span>Low ammo</span></span>`
          : `<span class="hud-ammo__ico">${icon('ammo', 'ui-icon')}</span>`;
  }

  /** 0..1 while reloading, null = hide the progress line */
  setReloadProgress(f: number | null) {
    if (f === null) {
      this.reloadProg.style.opacity = '0';
      return;
    }
    this.reloadProg.style.opacity = '1';
    this.reloadProg.style.transform = `scaleX(${Math.max(0, Math.min(1, f)).toFixed(3)})`;
  }

  // ------------------------------------------------------------------ crosshair / hits

  private applyCrosshair() {
    const key = JSON.stringify(this.xhCfg);
    if (key === this.xhKey) return;
    this.xhKey = key;
    renderCrosshair(this.crosshair, this.xhCfg);
    this.crosshair.classList.add('hud-xh');
    this.applySpread();
  }

  private applySpread() {
    setCrosshairSpread(this.crosshair, this.xhCfg.gap + (this.xhCfg.dynamic ? this.spreadPx : 0));
  }

  /** weapon spread in px added to the configured gap (when dynamic spread is on) */
  setCrosshairGap(px: number) {
    const g = Math.round(Math.max(0, Math.min(80, px)));
    if (g === this.spreadPx) return;
    this.spreadPx = g;
    if (this.xhCfg.dynamic) this.applySpread();
  }

  setCrosshairVisible(lines: boolean, dot = true) {
    this.crosshair.classList.toggle('no-lines', !lines);
    this.crosshair.classList.toggle('no-dot', !dot);
  }

  hitMarker(kill = false, headshot = false) {
    const c = this.hitmarker.classList;
    c.toggle('kill', kill);
    c.toggle('headshot', headshot);
    c.remove('show');
    void this.hitmarker.offsetWidth; // restart the pop animation
    c.add('show');
    this.hitTimer = kill ? 0.3 : headshot ? 0.22 : 0.1;
  }

  /** server-confirmed kill: X + expanding ring over the crosshair */
  killConfirm(headshot = false) {
    this.killX.classList.toggle('headshot', headshot);
    this.killX.classList.remove('show');
    void this.killX.offsetWidth;
    this.killX.classList.add('show');
    this.killTimer = 0.6;
  }

  get killConfirmVisible() {
    return this.killX.classList.contains('show');
  }

  showScope(on: boolean) {
    this.scope.hidden = !on;
  }

  /** heavy-attack charge 0..1 (hidden at 0) */
  setCharge(f: number) {
    const on = f > 0;
    if (this.chargeEl.hidden === on) this.chargeEl.hidden = !on;
    if (!on) return;
    this.chargeFill.style.transform = `scaleX(${Math.min(1, f).toFixed(3)})`;
    const full = f >= 1;
    if (full !== this.chargeFull) {
      this.chargeFull = full;
      this.chargeEl.classList.toggle('is-full', full);
    }
  }

  /** micro pill under the crosshair (SPRINTING / CROUCHED / AUTORUN / BLOCKING); shown once stable 150 ms */
  setStatus(text: string) {
    if (text === this.statusPending) return;
    this.statusPending = text;
    this.statusAge = 0;
    if (!text) this.showStatus('');
  }

  private showStatus(text: string) {
    if (text === this.statusShown) return;
    this.statusShown = text;
    this.statusEl.textContent = text;
    this.statusEl.hidden = !text;
  }

  // ------------------------------------------------------------------ damage

  damageFlash() {
    const s = this.hitFlash.style;
    s.setProperty('--vi', String(settings.current.vignetteIntensity));
    this.hitFlash.classList.remove('is-on');
    void this.hitFlash.offsetWidth;
    this.hitFlash.classList.add('is-on');
  }

  /** elemental status on the local player: chips above the health plate + screen vignettes */
  setElementStatus(st: HudElementStatus) {
    const slow = Math.round(st.slowPercent);
    const key = `${st.burning}|${st.chilled}|${st.poisoned}|${st.shocked}|${slow}`;
    if (key === this.fxKey) return;
    this.fxKey = key;
    this.burnFx.classList.toggle('is-on', st.burning);
    this.chillFx.classList.toggle('is-on', st.chilled);
    this.poisonFx.classList.toggle('is-on', st.poisoned);
    const chip = (kind: string, label: string, extra = '') =>
      `<span class="hud-fx__chip hud-fx--${kind}" data-testid="status-${kind}">${icon(kind, 'ui-icon')}<span>${label}</span>${extra ? `<b class="ui-num">${extra}</b>` : ''}</span>`;
    const chips: string[] = [];
    if (st.burning) chips.push(chip('fire', 'Burning'));
    if (st.poisoned) chips.push(chip('poison', 'Poisoned'));
    if (st.chilled) chips.push(chip('ice', 'Chilled', slow > 0 ? `−${slow}%` : ''));
    if (st.shocked) chips.push(chip('shock', 'Shocked', slow > 0 ? `−${slow}%` : ''));
    this.fxChips.innerHTML = chips.join('');
  }

  /** attacker direction relative to view forward: 0 = front, +PI/2 = right */
  damageFrom(attackerId: string, angleRad: number) {
    this.arcs.add(attackerId, angleRad);
  }

  // ------------------------------------------------------------------ feed / scoreboard / toasts

  addKill(killer: string, weapon: string, victim: string, headshot = false, opts: KillOpts = {}) {
    this.killfeed.add(killer, weapon, victim, headshot, opts);
  }

  setScoreboardRows(rows: ScoreRow[], footer: string) {
    this.scoreboard.setRows(rows, footer);
  }

  get scoreboardVisible() {
    return !this.scoreboard.root.hidden;
  }

  private refreshScoreboard() {
    const on = this.visible && (this.tabHeld || this.forceScoreboard);
    if (this.scoreboard.root.hidden === on) this.scoreboard.root.hidden = !on;
  }

  /** top-left "23 MS · 144 FPS" (ping null = offline: omitted) */
  setNetMicro(pingMs: number | null, fps: number) {
    const showFps = settings.current.showFps;
    const ping = pingMs == null ? null : Math.round(pingMs);
    const f = Math.round(fps);
    const key = `${ping}|${showFps ? f : ''}`;
    if (key === this.netKey) return;
    this.netKey = key;
    const parts: string[] = [];
    if (ping !== null) {
      const cls = ping > 150 ? ' is-bad' : ping > 80 ? ' is-warn' : '';
      parts.push(`<span class="hud-net__ping${cls}">${ping} ms</span>`);
    }
    if (showFps) parts.push(`<span>${f} fps</span>`);
    this.netEl.hidden = parts.length === 0;
    this.netEl.innerHTML = parts.join('<span class="hud-net__sep">·</span>');
  }

  toast(html: string, opts: ToastOpts = {}) {
    this.toasts.show(html, opts);
  }

  get toastVisible() {
    return this.toasts.visible;
  }

  // ------------------------------------------------------------------ debug / misc

  setDebug(text: string | null) {
    this.debugEl.hidden = text === null;
    if (text !== null && this.debugEl.textContent !== text) this.debugEl.textContent = text;
  }

  setSpawnEditor(text: string | null) {
    this.spawnEditorEl.hidden = text === null;
    if (text !== null) this.spawnEditorEl.textContent = text;
  }

  /** persistent banner (e.g. the venue map failed to load and we play the test map) */
  showWarning(text: string) {
    if (!this.warningEl) {
      this.warningEl = el('div', 'hud-warning');
      this.warningEl.setAttribute('role', 'alert');
      document.body.append(this.warningEl);
    }
    this.warningEl.innerHTML = `${icon('warning', 'ui-icon')}<span>${esc(text)}</span>`;
  }

  /** hide the whole HUD (menus / forge open / dead); toasts stay */
  setVisible(on: boolean) {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle('is-hidden', !on);
    if (!on) {
      this.tabHeld = false;
      this.arcs.clear();
    }
    this.refreshScoreboard();
  }

  update(dt: number) {
    if (!this.holdHitmarker && this.hitTimer > 0 && (this.hitTimer -= dt) <= 0) this.hitmarker.classList.remove('show');
    if (!this.holdHitmarker && this.killTimer > 0 && (this.killTimer -= dt) <= 0) this.killX.classList.remove('show');
    if (this.statusPending !== this.statusShown) {
      this.statusAge += dt;
      if (this.statusAge >= STATUS_DELAY) this.showStatus(this.statusPending);
    }
    this.arcs.update(dt);
    this.refreshScoreboard();
  }
}
