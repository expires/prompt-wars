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
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  adsSensitivity: 1,
  invertY: false,
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
      if (typeof v === typeof DEFAULT_SETTINGS[k] && (typeof v !== 'number' || Number.isFinite(v))) {
        (out as Record<string, unknown>)[k] = v;
      }
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
