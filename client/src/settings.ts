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

  reset() {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) this.set(k, DEFAULT_SETTINGS[k]);
  }

  onChange(l: Listener) {
    this.listeners.push(l);
    return () => (this.listeners = this.listeners.filter((x) => x !== l));
  }
}

export const settings = new SettingsStore();
