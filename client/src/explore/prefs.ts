/**
 * CityScape accessibility preferences and save progress (localStorage, every access
 * wrapped: a private window or blocked storage just means defaults and no saved progress).
 * Look sensitivity, invert Y, turn speed and volume stay in the shared `settings` store.
 */
export type WalkSpeed = 'slow' | 'normal' | 'brisk';
export type TextScale = 100 | 125 | 150;
export type SpeechRate = 0.8 | 1 | 1.25;

export interface Prefs {
  /** read discoveries, stories and directions aloud (speech synthesis) */
  narration: boolean;
  speechRate: SpeechRate;
  /** on-screen captions for every sound and spoken line */
  captions: boolean;
  textScale: TextScale;
  /** solid black panels, yellow highlights, thick outlines */
  highContrast: boolean;
  /** no head bob, no pulsing, gentler camera turns while guided */
  calmMotion: boolean;
  walkSpeed: WalkSpeed;
  /**
   * look by holding the button and dragging, instead of the default pointer lock (click once,
   * then the mouse just looks). Opt-in, under a new key so older saves of the old drag default
   * do not stick.
   */
  dragLook: boolean;
  /** tall light columns over places you have not visited yet */
  beacons: boolean;
  /** glowing footprints along the guide's route */
  pathTrail: boolean;
  /** a soft positional ping from the guide's target */
  soundBeacon: boolean;
  /** while auto-walking, turn the camera to face the way you are going */
  autoTurn: boolean;
  /** city sounds: wind, birds, distant bells */
  ambience: boolean;

  // ---- voice
  /** chosen speech voice (voiceURI); '' = the best one on this device */
  voice: string;
  /** say Polish names with a Polish voice when the device has one */
  polishVoice: boolean;

  // ---- blind mode (turning it on switches on narration and the parts below)
  blindMode: boolean;
  /** arrow left / right turn in 45° steps and announce the new heading */
  snapTurn: boolean;
  /** clicks for walls ahead, a thud when you bump into one */
  obstacleCues: boolean;
  /** spoken turn-by-turn directions while the guide is on */
  routeCoach: boolean;
  /** announce places as you enter them and things you can use nearby */
  announceNearby: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  narration: false,
  speechRate: 1,
  captions: true,
  textScale: 100,
  highContrast: false,
  calmMotion: false,
  walkSpeed: 'normal',
  dragLook: false,
  beacons: true,
  pathTrail: true,
  soundBeacon: true,
  autoTurn: true,
  ambience: true,
  voice: '',
  polishVoice: true,
  blindMode: false,
  snapTurn: false,
  obstacleCues: false,
  routeCoach: false,
  announceNearby: false,
};

/** what blind mode switches on (and off again) */
export const BLIND_MODE_PARTS = ['narration', 'soundBeacon', 'autoTurn', 'snapTurn', 'obstacleCues', 'routeCoach', 'announceNearby'] as const;

export const WALK_MULT: Record<WalkSpeed, number> = { slow: 0.6, normal: 1, brisk: 1.35 };

const ENUMS: Partial<Record<keyof Prefs, readonly unknown[]>> = {
  speechRate: [0.8, 1, 1.25],
  textScale: [100, 125, 150],
  walkSpeed: ['slow', 'normal', 'brisk'],
};

const PREFS_KEY = 'cityscape.prefs';
const PROGRESS_KEY = 'cityscape.progress';
/** keys from before the CityScape rename: read once so nobody loses their settings or progress */
const LEGACY_KEYS: Record<string, string> = { [PREFS_KEY]: 'krakow-explorer.prefs', [PROGRESS_KEY]: 'krakow-explorer.progress' };

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key) ?? (LEGACY_KEYS[key] ? localStorage.getItem(LEGACY_KEYS[key]) : null);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep going without saving */
  }
}

class PrefsStore {
  current: Prefs = this.load();
  private listeners: ((p: Prefs) => void)[] = [];

  private load(): Prefs {
    const saved = read<Prefs>(PREFS_KEY) ?? {};
    const out = { ...DEFAULT_PREFS };
    for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
      const v = saved[k];
      if (typeof v !== typeof DEFAULT_PREFS[k]) continue;
      const allowed = ENUMS[k];
      if (allowed && !allowed.includes(v)) continue;
      (out as Record<string, unknown>)[k] = v;
    }
    return out;
  }

  set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    this.current = { ...this.current, [key]: value };
    write(PREFS_KEY, this.current);
    this.listeners.forEach((l) => l(this.current));
  }

  onChange(l: (p: Prefs) => void) {
    this.listeners.push(l);
  }

  /** blind mode on: narration and every audio aid on; off: the aids off again (narration stays) */
  setBlindMode(on: boolean) {
    for (const k of BLIND_MODE_PARTS) if (k !== 'narration' || on) this.set(k, on || (k === 'soundBeacon' || k === 'autoTurn'));
    this.set('blindMode', on);
  }
}

export const prefs = new PrefsStore();

export interface Progress {
  landmarks: string[];
  secrets: string[];
  /** obwarzanki bought (the cart can be visited again) */
  obwarzanki: number;
}

export function loadProgress(): Progress {
  const p = read<Progress>(PROGRESS_KEY);
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  return {
    landmarks: strings(p?.landmarks),
    secrets: strings(p?.secrets),
    obwarzanki: typeof p?.obwarzanki === 'number' && Number.isFinite(p.obwarzanki) ? p.obwarzanki : 0,
  };
}

export function saveProgress(p: Progress) {
  write(PROGRESS_KEY, p);
}

export function clearProgress() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(LEGACY_KEYS[PROGRESS_KEY]);
  } catch {
    /* storage unavailable */
  }
}
