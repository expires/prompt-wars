import { DEFAULT_SETTINGS, settings, type Settings } from '../settings';

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const SLIDERS: { key: NumKey; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'sensitivity', label: 'Mouse sensitivity', min: 0.1, max: 4, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'adsSensitivity', label: 'ADS sensitivity', min: 0.3, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}x` },
  { key: 'fov', label: 'Field of view', min: 60, max: 100, step: 1, fmt: (v) => `${v}°` },
  { key: 'keyTurnSpeed', label: 'Key turn speed (arrows / Q E)', min: 30, max: 360, step: 5, fmt: (v) => `${v}°/s` },
  { key: 'volume', label: 'Volume', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];

const TOGGLES: { key: BoolKey; label: string }[] = [
  { key: 'crouchToggle', label: 'Toggle crouch (instead of hold)' },
  { key: 'adsToggle', label: 'Toggle aim (instead of hold)' },
  { key: 'invertY', label: 'Invert mouse Y' },
  { key: 'headBob', label: 'Head bob' },
];

/** Small settings panel shown in the pause (Esc) overlay. Values persist to localStorage. */
export class SettingsPanel {
  readonly root = document.createElement('details');
  private readonly inputs = new Map<keyof Settings, { input: HTMLInputElement; val?: HTMLElement }>();

  constructor() {
    this.root.className = 'settings';
    this.root.dataset.testid = 'settings';
    // clicks inside the panel must not start the game (the overlay requests pointer lock)
    for (const ev of ['click', 'mousedown', 'pointerdown'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    const summary = document.createElement('summary');
    summary.textContent = 'SETTINGS';
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const s of SLIDERS) {
      const label = document.createElement('label');
      label.textContent = s.label;
      const val = document.createElement('span');
      val.className = 'val';
      label.append(val);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.dataset.testid = `setting-${s.key}`;
      input.addEventListener('input', () => {
        settings.set(s.key, Number(input.value));
        val.textContent = s.fmt(Number(input.value));
      });
      grid.append(label, input);
      this.inputs.set(s.key, { input, val });
    }
    for (const t of TOGGLES) {
      const label = document.createElement('label');
      label.textContent = t.label;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.testid = `setting-${t.key}`;
      input.addEventListener('change', () => settings.set(t.key, input.checked));
      grid.append(label, input);
      this.inputs.set(t.key, { input });
    }
    const reset = document.createElement('button');
    reset.className = 'btn';
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => {
      settings.reset();
      this.sync();
    });
    this.root.append(summary, grid, reset);
    this.sync();
  }

  /** refresh inputs from the store */
  sync() {
    const cur = settings.current;
    for (const s of SLIDERS) {
      const e = this.inputs.get(s.key)!;
      e.input.value = String(cur[s.key] ?? DEFAULT_SETTINGS[s.key]);
      e.val!.textContent = s.fmt(cur[s.key]);
    }
    for (const t of TOGGLES) this.inputs.get(t.key)!.input.checked = cur[t.key];
  }
}
