// Crosshair renderer shared by the HUD and the Settings crosshair editor's live preview.
// renderCrosshair(host, cfg) builds the markup + CSS vars into `host` (a zero-size, centred box);
// setCrosshairSpread(host, gapPx) only moves the arms (cheap: one CSS var), safe to call per frame.
import './crosshair.css';
import type { CrosshairPreset, Settings } from '../../settings';

export interface CrosshairConfig {
  preset: CrosshairPreset;
  /** #RRGGBB */
  color: string;
  /** stroke thickness px */
  thickness: number;
  /** arm length px */
  length: number;
  /** base gap px */
  gap: number;
  outline: boolean;
  /** 0..1 */
  opacity: number;
  /** centre dot */
  dot: boolean;
  /** gap follows the weapon spread (HUD only) */
  dynamic: boolean;
}

export const CROSSHAIR_PRESETS: { id: CrosshairPreset; label: string }[] = [
  { id: 'classic', label: 'Classic+' },
  { id: 'dot', label: 'Dot' },
  { id: 'circle', label: 'Circle' },
  { id: 't', label: 'T' },
  { id: 'chevron', label: 'Chevron' },
];

export function crosshairFromSettings(s: Settings): CrosshairConfig {
  return {
    preset: s.crosshairPreset,
    color: s.crosshairColor,
    thickness: s.crosshairThickness,
    length: s.crosshairLength,
    gap: s.crosshairGap,
    outline: s.crosshairOutline,
    opacity: s.crosshairOpacity,
    dot: s.crosshairDot,
    dynamic: s.crosshairDynamic,
  };
}

const ARMS: Record<CrosshairPreset, string> = {
  classic: '<i class="xh-arm xh-t"></i><i class="xh-arm xh-b"></i><i class="xh-arm xh-l"></i><i class="xh-arm xh-r"></i>',
  t: '<i class="xh-arm xh-b"></i><i class="xh-arm xh-l"></i><i class="xh-arm xh-r"></i>',
  dot: '<i class="xh-arm xh-big"></i>',
  circle: '<i class="xh-arm xh-ring"></i>',
  chevron: '<i class="xh-arm xh-cl"></i><i class="xh-arm xh-cr"></i>',
};

/** (Re)build the crosshair inside `host`. Keeps any `no-lines` / `no-dot` classes on the host. */
export function renderCrosshair(host: HTMLElement, cfg: CrosshairConfig): void {
  const keep = ['no-lines', 'no-dot'].filter((c) => host.classList.contains(c));
  const th = Math.max(1, Math.round(cfg.thickness));
  host.className = ['xh', `xh--${cfg.preset}`, cfg.outline ? 'xh--outline' : '', cfg.dot ? 'xh--has-dot' : '', ...keep]
    .filter(Boolean)
    .join(' ');
  const st = host.style;
  st.setProperty('--xh-color', cfg.color);
  st.setProperty('--xh-th', `${th}px`);
  // integer offsets keep odd thicknesses pixel-sharp
  st.setProperty('--xh-half', `${Math.floor(th / 2)}px`);
  st.setProperty('--xh-len', `${Math.max(1, Math.round(cfg.length))}px`);
  st.setProperty('--xh-dot', `${th <= 2 ? th : th - 1}px`);
  st.setProperty('--xh-big', `${th + 3}px`);
  st.setProperty('--xh-op', String(Math.max(0, Math.min(1, cfg.opacity))));
  st.setProperty('--gap', `${Math.round(cfg.gap)}px`);
  host.innerHTML = `${ARMS[cfg.preset]}<i class="xh-dot"></i>`;
}

/** move the arms (gap from the crosshair centre, px) */
export function setCrosshairSpread(host: HTMLElement, gapPx: number): void {
  host.style.setProperty('--gap', `${Math.round(Math.max(0, Math.min(80, gapPx)))}px`);
}
