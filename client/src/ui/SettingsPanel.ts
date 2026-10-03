// Tabbed settings area (mounted by the Esc pause menu): CONTROLS / MOUSE·TRACKPAD / GAMEPAD /
// VIDEO / AUDIO. Values persist through settings.ts. docs/ui-spec.md §Menus "Esc pause" + §Accessibility.
//
// Test contract: root data-testid="settings"; every slider is an <input type=range>
// data-testid="setting-<key>" whose value is the setting; every on/off is an
// <input type=checkbox> data-testid="setting-<key>" whose `change` applies it.
import './settings/settings.css';
import { DEFAULT_SETTINGS, SETTING_ENUMS, settings, type Settings } from '../settings';
import { el, esc, isolate } from './dom';
import { icon } from './icons';
import { initUiSettings } from './hud/applyUiSettings';
import { CROSSHAIR_PRESETS, crosshairFromSettings, renderCrosshair } from './hud/crosshair';

export type SettingsTab = 'controls' | 'mouse' | 'gamepad' | 'video' | 'audio';

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type EnumKey = keyof typeof SETTING_ENUMS;

interface SliderSpec {
  key: Exclude<NumKey, 'textSize'>;
  label: string;
  desc?: string;
  min: number;
  max: number;
  step: number;
  /** display multiplier (e.g. 100 for percent) */
  scale?: number;
  decimals?: number;
  unit?: string;
}

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'controls', label: 'Controls', icon: 'keyboard' },
  { id: 'mouse', label: 'Mouse · Trackpad', icon: 'mouse' },
  { id: 'gamepad', label: 'Gamepad', icon: 'gamepad' },
  { id: 'video', label: 'Video', icon: 'video' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
];

const KEYBINDS: [string, string[]][] = [
  ['Move', ['W', 'A', 'S', 'D']],
  ['Jump', ['Space']],
  ['Crouch', ['C', 'Ctrl']],
  ['Sprint', ['Shift']],
  ['Fire · Aim', ['LMB', 'RMB']],
  ['Reload', ['R']],
  ['Block (melee)', ['F']],
  ['Autorun', ['T']],
  ['Turn (no mouse)', ['←', '→', 'Q', 'E']],
  ['Scoreboard', ['Tab']],
  ['Pause', ['Esc']],
  ['Debug info', ['F3']],
  ['Spawn editor', ['F2']],
];

const XH_COLORS: { value: string; label: string }[] = [
  { value: '#FFFFFF', label: 'White' },
  { value: '#FFE600', label: 'Yellow' },
  { value: '#4BE38A', label: 'Green' },
  { value: '#3FD0FF', label: 'Cyan' },
  { value: '#FF3DA5', label: 'Magenta' },
  { value: '#FF4655', label: 'Red' },
];

let uid = 0;

/** Settings area for the pause menu. Values persist to localStorage. */
export class SettingsPanel {
  readonly root = el('div', 'st');
  private readonly tabs = new Map<SettingsTab, { tab: HTMLButtonElement; panel: HTMLElement }>();
  private readonly syncers: (() => void)[] = [];
  private readonly previews: HTMLElement[] = [];
  private current: SettingsTab = 'controls';
  private readonly id = `st${++uid}`;

  constructor() {
    initUiSettings();
    this.root.dataset.testid = 'settings';
    isolate(this.root);
    // keys typed / pressed inside the panel never reach the game bindings (Esc still closes menus)
    for (const ev of ['keydown', 'keyup'] as const)
      this.root.addEventListener(ev, (e) => {
        if ((e as KeyboardEvent).key !== 'Escape') e.stopPropagation();
      });

    const tablist = el('div', 'st-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Settings');
    const body = el('div', 'st-body');
    for (const t of TABS) {
      const tab = el('button', 'st-tab', `<span class="st-tab__in">${icon(t.icon, 'ui-icon')}<span>${esc(t.label)}</span></span>`);
      tab.type = 'button';
      tab.id = `${this.id}-tab-${t.id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `${this.id}-panel-${t.id}`);
      tab.dataset.tab = t.id;
      tab.addEventListener('click', () => this.selectTab(t.id));
      const panel = el('section', 'st-panel');
      panel.id = `${this.id}-panel-${t.id}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = -1;
      tablist.append(tab);
      body.append(panel);
      this.tabs.set(t.id, { tab, panel });
    }
    tablist.addEventListener('keydown', (e) => {
      const ids = TABS.map((t) => t.id);
      let i = ids.indexOf(this.current);
      if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
      else if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = ids.length - 1;
      else return;
      e.preventDefault();
      this.selectTab(ids[i]);
      this.tabs.get(ids[i])!.tab.focus();
    });

    this.buildControls(this.tabs.get('controls')!.panel);
    this.buildMouse(this.tabs.get('mouse')!.panel);
    this.buildGamepad(this.tabs.get('gamepad')!.panel);
    this.buildVideo(this.tabs.get('video')!.panel);
    this.buildAudio(this.tabs.get('audio')!.panel);

    const foot = el('div', 'st-foot');
    foot.append(el('span', 'st-foot__note', `${icon('check', 'ui-icon')}<span>Changes save automatically</span>`));
    const reset = el('button', 'ui-btn ui-btn--secondary ui-btn--sm st-reset', `${icon('reset', 'ui-icon')}<span>Reset to defaults</span>`);
    reset.type = 'button';
    reset.dataset.testid = 'settings-reset';
    reset.addEventListener('click', () => {
      settings.reset();
      this.sync();
    });
    foot.append(reset);

    this.root.append(tablist, body, foot);
    this.selectTab('controls');
    this.sync();
    settings.onChange(() => this.sync());
  }

  selectTab(id: SettingsTab) {
    this.current = id;
    for (const [tid, { tab, panel }] of this.tabs) {
      const on = tid === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle('is-on', on);
      panel.hidden = !on;
    }
  }

  /** refresh every control from the store */
  sync() {
    for (const s of this.syncers) s();
    const cfg = crosshairFromSettings(settings.current);
    for (const p of this.previews) renderCrosshair(p, cfg);
  }

  // ------------------------------------------------------------------ tabs

  private buildControls(p: HTMLElement) {
    this.section(p, 'Movement & actions');
    this.row(p, 'Trackpad mode', 'Autorun on T, toggle crouch / sprint / aim, arrow & Q E turning, +25% sensitivity', this.toggle('trackpadMode', 'Trackpad mode'));
    this.row(p, 'Crouch', 'C / Ctrl', this.toggle('crouchToggle', 'Crouch mode', ['Hold', 'Toggle']));
    this.row(p, 'Sprint', 'Shift — toggle cancels when you stop moving forward', this.toggle('sprintToggle', 'Sprint mode', ['Hold', 'Toggle']));
    this.row(p, 'Aim down sights', 'Right mouse', this.toggle('adsToggle', 'Aim mode', ['Hold', 'Toggle']));
    this.slider(p, { key: 'keyTurnSpeed', label: 'Key turn speed', desc: 'Arrow keys / Q E', min: 30, max: 360, step: 5, unit: '°/s' });

    this.section(p, 'Key bindings');
    const grid = el('div', 'st-binds');
    for (const [action, keys] of KEYBINDS) {
      grid.append(
        el('div', 'st-bind', `<span class="st-bind__a">${esc(action)}</span><span class="st-bind__k">${keys.map((k) => `<span class="ui-kbd"><span>${esc(k)}</span></span>`).join('')}</span>`),
      );
    }
    p.append(grid);
  }

  private buildMouse(p: HTMLElement) {
    this.section(p, 'Mouse');
    this.slider(p, { key: 'sensitivity', label: 'Sensitivity', desc: 'Look speed (hip fire)', min: 0.1, max: 4, step: 0.05, decimals: 2 });
    this.slider(p, { key: 'adsSensitivity', label: 'ADS sensitivity', desc: 'Multiplier while aiming down sights', min: 0.3, max: 2, step: 0.05, decimals: 2, unit: '×' });
    this.row(p, 'Invert Y', 'Mouse up looks down', this.toggle('invertY', 'Invert mouse Y'));

    this.section(p, 'Crosshair');
    p.append(this.crosshairPreview());
    this.row(p, 'Style', null, this.radio('crosshairPreset', 'Crosshair style', CROSSHAIR_PRESETS.map((x) => ({ value: x.id, label: x.label })), 'st-seg--xh'));
    this.row(p, 'Color', null, this.colorPicker());
    this.slider(p, { key: 'crosshairThickness', label: 'Thickness', min: 1, max: 6, step: 1, unit: 'px' });
    this.slider(p, { key: 'crosshairLength', label: 'Length', min: 2, max: 20, step: 1, unit: 'px' });
    this.slider(p, { key: 'crosshairGap', label: 'Gap', min: 0, max: 20, step: 1, unit: 'px' });
    this.slider(p, { key: 'crosshairOpacity', label: 'Opacity', min: 0.2, max: 1, step: 0.05, scale: 100, unit: '%' });
    this.row(p, 'Outline', 'Dark edge for bright scenes', this.toggle('crosshairOutline', 'Crosshair outline'));
    this.row(p, 'Center dot', null, this.toggle('crosshairDot', 'Crosshair center dot'));
    this.row(p, 'Dynamic spread', 'Gap opens with weapon spread', this.toggle('crosshairDynamic', 'Dynamic crosshair spread'));
  }

  private buildGamepad(p: HTMLElement) {
    this.section(p, 'Gamepad');
    this.slider(p, { key: 'gamepadSensitivity', label: 'Look speed', desc: 'Right stick', min: 0.2, max: 3, step: 0.05, decimals: 2, unit: '×' });
    this.slider(p, { key: 'gamepadDeadzone', label: 'Deadzone', desc: 'Ignore small stick movement', min: 0, max: 0.5, step: 0.01, decimals: 2 });
    this.row(p, 'Aim slowdown', 'Slow the look over enemies', this.toggle('gamepadAimSlowdown', 'Gamepad aim slowdown'));
  }

  private buildVideo(p: HTMLElement) {
    this.section(p, 'Display');
    this.slider(p, { key: 'fov', label: 'Field of view', desc: 'Vertical, degrees', min: 60, max: 100, step: 1, unit: '°' });
    this.row(p, 'Head bob', 'Camera sway while moving + landing dip', this.toggle('headBob', 'Head bob'));
    this.row(p, 'Show FPS', 'Ping / FPS in the top-left corner', this.toggle('showFps', 'Show FPS'));

    this.section(p, 'Accessibility');
    this.row(p, 'Enemy color', 'Names, damage indicators, death screen', this.enemySwatches());
    this.row(
      p,
      'Color vision',
      'Swaps health / damage colors for distinguishable ones',
      this.radio('colorblind', 'Color vision preset', [
        { value: 'off', label: 'Off' },
        { value: 'protanopia', label: 'Protan' },
        { value: 'deuteranopia', label: 'Deutan' },
        { value: 'tritanopia', label: 'Tritan' },
      ]),
    );
    this.row(
      p,
      'Reduced motion',
      'Auto follows your system setting',
      this.radio('reducedMotion', 'Reduced motion', [
        { value: 'auto', label: 'Auto' },
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ]),
    );
    this.slider(p, { key: 'screenShake', label: 'Screen shake', min: 0, max: 1, step: 0.05, scale: 100, unit: '%' });
    this.slider(p, { key: 'vignetteIntensity', label: 'Damage vignette', desc: 'Low-health and hit edge glow', min: 0, max: 1, step: 0.05, scale: 100, unit: '%' });
    this.row(
      p,
      'Text size',
      null,
      this.radio('textSize', 'Text size', [
        { value: 100, label: '100%' },
        { value: 115, label: '115%' },
        { value: 130, label: '130%' },
      ]),
    );
    this.slider(p, { key: 'hudScale', label: 'HUD scale', min: 0.8, max: 1.2, step: 0.05, scale: 100, unit: '%' });
  }

  private buildAudio(p: HTMLElement) {
    this.section(p, 'Audio');
    this.slider(p, { key: 'volume', label: 'Master volume', min: 0, max: 1, step: 0.05, scale: 100, unit: '%' });
  }

  // ------------------------------------------------------------------ building blocks

  private section(p: HTMLElement, title: string) {
    p.append(el('h3', 'st-section', `<span>${esc(title)}</span>`));
  }

  private row(p: HTMLElement, label: string, desc: string | null, control: HTMLElement, cls = '') {
    const r = el('div', `st-row${cls ? ` ${cls}` : ''}`);
    const lab = el('div', 'st-row__label', `<span class="st-row__t">${esc(label)}</span>${desc ? `<span class="st-row__d">${esc(desc)}</span>` : ''}`);
    const ctl = el('div', 'st-row__ctl');
    ctl.append(control);
    r.append(lab, ctl);
    p.append(r);
    return r;
  }

  private slider(p: HTMLElement, s: SliderSpec) {
    const scale = s.scale ?? 1;
    const decimals = s.decimals ?? (scale === 1 && s.step < 1 ? 2 : 0);
    const wrap = el('div', 'st-slider');
    const range = el('div', 'st-range');
    const input = el('input', 'st-range__input');
    input.type = 'range';
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.dataset.testid = `setting-${s.key}`;
    input.setAttribute('aria-label', s.label);
    range.append(input, el('i', 'st-range__track'), el('i', 'st-range__fill'), el('i', 'st-range__thumb'));
    const box = el('label', 'st-numbox');
    const num = el('input', 'st-num');
    num.type = 'text';
    num.inputMode = 'decimal';
    num.setAttribute('aria-label', `${s.label} value`);
    num.spellcheck = false;
    box.append(num);
    if (s.unit) box.append(el('span', 'st-numbox__u', esc(s.unit)));
    wrap.append(range, box);

    const fmt = (v: number) => (v * scale).toFixed(decimals);
    const paint = (v: number) => {
      const f = (v - s.min) / (s.max - s.min);
      range.style.setProperty('--p', String(Math.max(0, Math.min(1, f))));
    };
    const commit = (v: number) => {
      const snapped = Math.round((Math.max(s.min, Math.min(s.max, v)) - s.min) / s.step) * s.step + s.min;
      const clean = +snapped.toFixed(6);
      settings.set(s.key, clean);
      return clean;
    };
    input.addEventListener('input', () => {
      const v = commit(Number(input.value));
      paint(v);
      if (document.activeElement !== num) num.value = fmt(v);
    });
    num.addEventListener('focus', () => num.select());
    const fromBox = () => {
      const raw = parseFloat(num.value.replace(',', '.'));
      if (!Number.isFinite(raw)) return (num.value = fmt(settings.current[s.key]));
      const v = commit(raw / scale);
      input.value = String(v);
      paint(v);
      num.value = fmt(v);
    };
    num.addEventListener('change', fromBox);
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        fromBox();
        num.blur();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        num.value = fmt(settings.current[s.key]);
        num.blur();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        commit(settings.current[s.key] + (e.key === 'ArrowUp' ? s.step : -s.step));
        num.value = fmt(settings.current[s.key]);
        num.select();
      }
    });
    this.syncers.push(() => {
      const v = settings.current[s.key] ?? DEFAULT_SETTINGS[s.key];
      if (input.value !== String(v)) input.value = String(v);
      paint(v);
      if (document.activeElement !== num) num.value = fmt(v);
    });
    return this.row(p, s.label, s.desc ?? null, wrap);
  }

  /** two-state segmented control backed by a real checkbox (OFF|ON or HOLD|TOGGLE) */
  private toggle(key: BoolKey, aria: string, labels: [string, string] = ['Off', 'On']) {
    const lab = el('label', 'st-seg st-seg--bool');
    const input = el('input', 'st-seg__input');
    input.type = 'checkbox';
    input.dataset.testid = `setting-${key}`;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', `${aria}: ${labels[0]} / ${labels[1]}`);
    const off = el('span', 'st-seg__opt', `<span>${esc(labels[0])}</span>`);
    const on = el('span', 'st-seg__opt', `<span>${esc(labels[1])}</span>`);
    off.dataset.v = '0';
    on.dataset.v = '1';
    lab.append(input, el('i', 'st-seg__ind'), off, el('span', 'st-seg__gap'), on);
    // clicking the half that's already selected does nothing (label activation is cancelled)
    for (const opt of [off, on])
      opt.addEventListener('click', (e) => {
        if ((opt.dataset.v === '1') === input.checked) e.preventDefault();
      });
    input.addEventListener('keydown', (e) => {
      const want = e.key === 'ArrowRight' ? true : e.key === 'ArrowLeft' ? false : null;
      if (want === null || want === input.checked) return;
      e.preventDefault();
      input.checked = want;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    input.addEventListener('change', () => {
      if (key === 'trackpadMode') {
        settings.setTrackpadMode(input.checked);
        this.sync(); // the preset changed other settings too
      } else settings.set(key, input.checked);
    });
    this.syncers.push(() => {
      input.checked = settings.current[key];
    });
    return lab;
  }

  /** radiogroup of segmented buttons for enum settings */
  private radio<K extends EnumKey>(
    key: K,
    aria: string,
    options: { value: Settings[K]; label: string; html?: string }[],
    cls = '',
  ) {
    const group = el('div', `st-seg st-seg--radio${cls ? ` ${cls}` : ''}`);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', aria);
    group.dataset.testid = `setting-${key}`;
    group.style.setProperty('--n', String(options.length));
    const btns = options.map((o) => {
      const b = el('button', 'st-seg__btn', o.html ?? `<span>${esc(o.label)}</span>`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.value = String(o.value);
      if (o.html) b.setAttribute('aria-label', o.label);
      b.addEventListener('click', () => settings.set(key, o.value as Settings[K]));
      group.append(b);
      return b;
    });
    group.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const i = options.findIndex((o) => o.value === settings.current[key]);
      const n = (i + d + options.length) % options.length;
      settings.set(key, options[n].value as Settings[K]);
      btns[n].focus();
    });
    this.syncers.push(() => {
      const cur = String(settings.current[key]);
      for (const b of btns) {
        const on = b.dataset.value === cur;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        b.classList.toggle('is-on', on);
      }
    });
    return group;
  }

  private enemySwatches() {
    const opts: { value: Settings['enemyColor']; label: string; color: string }[] = [
      { value: 'red', label: 'Red', color: '#FF4655' },
      { value: 'purple', label: 'Purple', color: '#C34BFF' },
      { value: 'yellow', label: 'Yellow', color: '#FFE600' },
    ];
    return this.radio(
      'enemyColor',
      'Enemy color',
      opts.map((o) => ({ value: o.value, label: o.label, html: `<i class="st-sw" style="--sw:${o.color}"></i><span>${o.label}</span>` })),
      'st-seg--swatch',
    );
  }

  private colorPicker() {
    const wrap = el('div', 'st-colors');
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', 'Crosshair color');
    wrap.dataset.testid = 'setting-crosshairColor';
    const btns = XH_COLORS.map((c) => {
      const b = el('button', 'st-color', `<i style="--sw:${c.value}"></i>`);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.label);
      b.title = c.label;
      b.dataset.value = c.value;
      b.addEventListener('click', () => settings.set('crosshairColor', c.value));
      wrap.append(b);
      return b;
    });
    const custom = el('label', 'st-color st-color--custom', `<i></i>${icon('spark', 'ui-icon')}`);
    custom.title = 'Custom color';
    const picker = el('input', 'st-color__picker');
    picker.type = 'color';
    picker.setAttribute('aria-label', 'Custom crosshair color');
    picker.addEventListener('input', () => settings.set('crosshairColor', picker.value.toUpperCase()));
    custom.append(picker);
    wrap.append(custom);
    wrap.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d || !(e.target instanceof HTMLButtonElement)) return;
      e.preventDefault();
      const i = XH_COLORS.findIndex((c) => c.value === settings.current.crosshairColor);
      const n = (Math.max(0, i) + d + XH_COLORS.length) % XH_COLORS.length;
      settings.set('crosshairColor', XH_COLORS[n].value);
      btns[n].focus();
    });
    this.syncers.push(() => {
      const cur = settings.current.crosshairColor.toUpperCase();
      let matched = false;
      for (const b of btns) {
        const on = b.dataset.value === cur;
        matched ||= on;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        b.classList.toggle('is-on', on);
      }
      if (!matched) btns[0].tabIndex = 0;
      custom.classList.toggle('is-on', !matched);
      (custom.firstElementChild as HTMLElement).style.setProperty('--sw', cur);
      picker.value = cur.toLowerCase();
    });
    return wrap;
  }

  private crosshairPreview() {
    const tile = el('div', 'st-xh');
    tile.setAttribute('aria-hidden', 'true');
    for (const bg of ['sky', 'world', 'dark']) {
      const cell = el('div', `st-xh__cell st-xh__cell--${bg}`);
      const host = el('div');
      cell.append(host);
      tile.append(cell);
      this.previews.push(host);
    }
    tile.append(el('span', 'st-xh__lbl', 'Preview'));
    return tile;
  }
}
