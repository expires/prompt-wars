/**
 * Player settings, persisted in localStorage (`ai-gaem.settings`). Every read/write is wrapped
 * in try/catch: private windows or blocked storage just fall back to the defaults.
 */
export interface Settings {
  /** mouse sensitivity multiplier (1 = 0.0022 rad per pixel) */
  sensitivity: number;
  /** extra sensitivity multiplier while aiming down sights (on top of the FOV ratio) */
  adsSensitivity: number;
  invertY: boolean;
  /**
   * Raw mouse input: request pointer lock with `unadjustedMovement` (Chromium; no OS pointer
   * acceleration, 1:1 sensor counts). Ignored by Firefox / Safari.
   */
  rawMouseInput: boolean;
  /** horizontal-ish vertical FOV in degrees (camera.fov) */
  fov: number;
  /** keyboard turning (arrow keys / Q-E) speed, degrees per second */
  keyTurnSpeed: number;
  /** true: tap crouch to toggle; false: hold */
  crouchToggle: boolean;
  /** true: tap right mouse to toggle ADS; false: hold */
  adsToggle: boolean;
  /** true: tap Shift to toggle sprint (cancelled when you stop moving forward); false: hold */
  sprintToggle: boolean;
  /**
   * Trackpad mode (laptops / ThinkPads whose touchpad is disabled while keys are held): autorun
   * hints, toggle crouch / sprint / aim, slightly higher sensitivity, arrow / Q E turning.
   */
  trackpadMode: boolean;
  /** gamepad right-stick look speed multiplier (1 = 200 deg/s at full deflection) */
  gamepadSensitivity: number;
  /** gamepad stick deadzone (0..0.5) */
  gamepadDeadzone: number;
  /** gamepad: slow the look down while the crosshair is over an enemy */
  gamepadAimSlowdown: boolean;
  /** camera head bob + landing dip */
  headBob: boolean;
  /** master volume 0..1 */
  volume: number;

  // ---- crosshair (rendered by ui/hud/crosshair.ts) ----
  crosshairPreset: CrosshairPreset;
  /** #RRGGBB */
  crosshairColor: string;
  /** line thickness px (1..6) */
  crosshairThickness: number;
  /** arm length px (2..20) */
  crosshairLength: number;
  /** base gap px (0..20); with dynamic spread on the weapon spread is added */
  crosshairGap: number;
  /** 1px dark outline around every stroke */
  crosshairOutline: boolean;
  /** 0.2..1 */
  crosshairOpacity: number;
  /** centre dot */
  crosshairDot: boolean;
  /** gap follows the weapon's current spread */
  crosshairDynamic: boolean;

  // ---- accessibility ----
  /** enemy highlight colour (kill feed names, damage arcs, death screen): red / purple / yellow */
  enemyColor: EnemyColor;
  /** colour-vision preset: overrides health / kill colours with distinguishable ones */
  colorblind: ColorblindPreset;
  /** auto = follow the OS (prefers-reduced-motion) */
  reducedMotion: ReducedMotionMode;
  /** camera shake multiplier 0..1 (read by the game) */
  screenShake: number;
  /** low-HP / hit vignette multiplier 0..1 */
  vignetteIntensity: number;
  /** UI text size in percent */
  textSize: TextSize;
  /** HUD scale 0.8..1.2 */
  hudScale: number;
  /** ping / FPS readout in the HUD's top-left corner */
  showFps: boolean;
}

export type CrosshairPreset = 'classic' | 'dot' | 'circle' | 't' | 'chevron';
export type EnemyColor = 'red' | 'purple' | 'yellow';
export type ColorblindPreset = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';
export type ReducedMotionMode = 'auto' | 'on' | 'off';
export type TextSize = 100 | 115 | 130;

export const ENEMY_COLORS: Record<EnemyColor, string> = { red: '#FF4655', purple: '#C34BFF', yellow: '#FFE600' };

/** allowed values for the enum-like settings (load() rejects anything else) */
export const SETTING_ENUMS = {
  crosshairPreset: ['classic', 'dot', 'circle', 't', 'chevron'],
  enemyColor: ['red', 'purple', 'yellow'],
  colorblind: ['off', 'protanopia', 'deuteranopia', 'tritanopia'],
  reducedMotion: ['auto', 'on', 'off'],
  textSize: [100, 115, 130],
} as const satisfies Partial<Record<keyof Settings, readonly (string | number)[]>>;

/** numeric ranges (load() clamps into them) */
export const SETTING_RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  crosshairThickness: [1, 6],
  crosshairLength: [2, 20],
  crosshairGap: [0, 20],
  crosshairOpacity: [0.2, 1],
  screenShake: [0, 1],
  vignetteIntensity: [0, 1],
  hudScale: [0.8, 1.2],
};

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  adsSensitivity: 1,
  invertY: false,
  rawMouseInput: true,
  fov: 75,
  keyTurnSpeed: 150,
  crouchToggle: false,
  adsToggle: false,
  sprintToggle: false,
  trackpadMode: false,
  gamepadSensitivity: 1,
  gamepadDeadzone: 0.15,
  gamepadAimSlowdown: true,
  headBob: true,
  volume: 0.6,
  crosshairPreset: 'classic',
  crosshairColor: '#FFFFFF',
  crosshairThickness: 2,
  crosshairLength: 7,
  crosshairGap: 4,
  crosshairOutline: true,
  crosshairOpacity: 1,
  crosshairDot: true,
  crosshairDynamic: true,
  enemyColor: 'red',
  colorblind: 'off',
  reducedMotion: 'auto',
  screenShake: 1,
  vignetteIntensity: 1,
  textSize: 100,
  hudScale: 1,
  showFps: true,
};

/** base radians per mouse pixel at sensitivity 1 */
export const BASE_MOUSE_SENS = 0.0022;

const KEY = 'ai-gaem.settings';
type Listener = (s: Settings) => void;

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = parsed[k];
      if (typeof v !== typeof DEFAULT_SETTINGS[k] || (typeof v === 'number' && !Number.isFinite(v))) continue;
      const allowed = (SETTING_ENUMS as Partial<Record<keyof Settings, readonly unknown[]>>)[k];
      if (allowed && !allowed.includes(v)) continue;
      if (k === 'crosshairColor' && !/^#[0-9a-f]{6}$/i.test(v as string)) continue;
      const range = SETTING_RANGES[k];
      (out as Record<string, unknown>)[k] = range ? Math.min(range[1], Math.max(range[0], v as number)) : v;
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

class SettingsStore {
  current: Settings = load();
  private listeners: Listener[] = [];

  set<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.current = { ...this.current, [key]: value };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.current));
    } catch {
      /* storage unavailable */
    }
    this.listeners.forEach((l) => l(this.current));
  }

  /**
   * Turn trackpad mode on / off. On: toggle crouch / sprint / aim and +25% sensitivity (the
   * previous values are restored when it is turned off again).
   */
  setTrackpadMode(on: boolean) {
    if (on === this.current.trackpadMode) return;
    if (on) {
      this.saved = { crouchToggle: this.current.crouchToggle, sprintToggle: this.current.sprintToggle, adsToggle: this.current.adsToggle, sensitivity: this.current.sensitivity };
      this.set('crouchToggle', true);
      this.set('sprintToggle', true);
      this.set('adsToggle', true);
      this.set('sensitivity', Math.min(4, +(this.current.sensitivity * 1.25).toFixed(2)));
    } else if (this.saved) {
      for (const [k, v] of Object.entries(this.saved)) this.set(k as keyof Settings, v as never);
      this.saved = undefined;
    }
    this.set('trackpadMode', on);
  }

  private saved?: Partial<Settings>;

  reset() {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) this.set(k, DEFAULT_SETTINGS[k]);
  }

  onChange(l: Listener) {
    this.listeners.push(l);
    return () => (this.listeners = this.listeners.filter((x) => x !== l));
  }
}

export const settings = new SettingsStore();
