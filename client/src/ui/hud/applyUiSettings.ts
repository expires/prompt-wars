// Applies the accessibility / UI settings to the document: CSS custom properties on <html>
// (--enemy, --hp-*, --kill, --hud-scale, --text-scale, --vignette-intensity) and the
// `reduced-motion` class. Idempotent; initUiSettings() applies once and re-applies on change.
import { ENEMY_COLORS, settings, type ColorblindPreset, type Settings } from '../../settings';

interface Palette {
  hpHi?: string;
  hpMid?: string;
  hpLo?: string;
  kill?: string;
  crit?: string;
  /** enemy colour used while the enemy-colour option is left at the default (red) */
  enemy?: string;
}

/**
 * Colour-vision presets. Red/green deficits (protan / deutan): health goes blue → yellow → orange,
 * kills / low-HP orange-magenta, enemies purple. Tritan (blue/yellow): health green → pink → red,
 * headshots shift away from amber toward a warm pink-orange.
 */
const COLORBLIND: Record<ColorblindPreset, Palette> = {
  off: {},
  protanopia: { hpHi: '#3FA9FF', hpMid: '#FFD23F', hpLo: '#FF8A1F', kill: '#FF8A1F', enemy: '#C34BFF' },
  deuteranopia: { hpHi: '#3FA9FF', hpMid: '#FFD23F', hpLo: '#FF7A1A', kill: '#FF7A1A', enemy: '#C34BFF' },
  tritanopia: { hpHi: '#4BE38A', hpMid: '#FF8FC7', hpLo: '#FF4655', crit: '#FF6F91', enemy: '#FF4655' },
};

let osReduced: MediaQueryList | null = null;

export function reducedMotionActive(s: Settings = settings.current): boolean {
  if (s.reducedMotion === 'on') return true;
  if (s.reducedMotion === 'off') return false;
  return !!osReduced?.matches;
}

export function applyUiSettings(s: Settings = settings.current): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const st = root.style;
  const pal = COLORBLIND[s.colorblind] ?? {};
  const enemy = s.enemyColor === 'red' && pal.enemy ? pal.enemy : ENEMY_COLORS[s.enemyColor];
  st.setProperty('--enemy', enemy);
  const set = (prop: string, v: string | undefined) => (v ? st.setProperty(prop, v) : st.removeProperty(prop));
  set('--hp-hi', pal.hpHi);
  set('--hp-mid', pal.hpMid);
  set('--hp-lo', pal.hpLo);
  set('--kill', pal.kill);
  set('--crit', pal.crit);
  st.setProperty('--hud-scale', String(s.hudScale));
  st.setProperty('--text-scale', String(s.textSize / 100));
  st.setProperty('--vignette-intensity', String(s.vignetteIntensity));
  root.classList.toggle('reduced-motion', reducedMotionActive(s));
  root.dataset.colorblind = s.colorblind;
}

let installed = false;

/** apply now + on every settings change / OS reduced-motion change (safe to call repeatedly) */
export function initUiSettings(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    osReduced = matchMedia('(prefers-reduced-motion: reduce)');
    osReduced.addEventListener('change', () => applyUiSettings());
  } catch {
    osReduced = null;
  }
  applyUiSettings();
  settings.onChange((s) => applyUiSettings(s));
}
