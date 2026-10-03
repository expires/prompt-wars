// Inline SVG icon set (24x24, stroke 2, square caps) — docs/ui-spec.md "Icons".
// icon('lock') -> '<svg ...>' string (decorative: aria-hidden). Headshot != skull at 16px.

const P: Record<string, string> = {
  // HUD
  health: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  ammo: '<path d="M7 21V9l2-5 2 5v12zM13 21V9l2-5 2 5v12z"/>',
  headshot: '<path d="M12 3l9 9-9 9-9-9z"/><circle cx="12" cy="12" r="2.5"/>',
  skull: '<path d="M5 11a7 7 0 0 1 14 0v4l-2 1v4H7v-4l-2-1z"/><path d="M9 12h.01M15 12h.01M10 20v-2M14 20v-2"/>',
  melee: '<path d="M4 20l5-5M7 17l-3-3M14.5 4.5L20 4l-.5 5.5L10 19l-5-5z"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  fire: '<path d="M12 22c-4 0-7-3-7-7 0-4 3-6 4-10 2 2 3 4 3 6 1-1 2-2 2-4 2 2 5 5 5 8 0 4-3 7-7 7z"/><path d="M12 22c-1.7 0-3-1.3-3-3 0-1.7 1.5-2.5 3-5 1.5 2.5 3 3.3 3 5 0 1.7-1.3 3-3 3z"/>',
  ice: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9 4l3 3 3-3M9 20l3-3 3 3M3 10.5l4-.5-1.5-3.7M21 13.5l-4 .5 1.5 3.7M3 13.5l4 .5-1.5 3.7M21 10.5l-4-.5 1.5-3.7"/>',
  poison: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/><path d="M9.5 14h.01M14.5 14h.01M10 17.5h4"/>',
  shock: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  speed: '<path d="M3 12h7M5 8h6M5 16h6"/><path d="M13 5l7 7-7 7"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01"/>',
  // actions
  check: '<path d="M4 12l5 5L20 6"/>',
  x: '<path d="M5 5l14 14M19 5L5 19"/>',
  lock: '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  spark: '<path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  redeploy: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 2v5h-5M6 22v-5h5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  exit: '<path d="M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10"/>',
  dice: '<rect x="3" y="3" width="18" height="18"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  reset: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
  warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  compare: '<path d="M4 6h10M4 12h16M4 18h7"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  // settings tabs
  keyboard: '<rect x="2" y="6" width="20" height="12"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  gamepad: '<path d="M6 8h12l3 9-3 2-3-3H9l-3 3-3-2z"/><path d="M8 11v3M6.5 12.5h3M15 12h.01M17 14h.01"/>',
  video: '<rect x="2" y="5" width="20" height="13"/><path d="M8 21h8"/>',
  audio: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  // component roles
  core: '<rect x="5" y="8" width="14" height="8"/><path d="M9 8V5h6v3"/>',
  barrel: '<path d="M2 10h16v4H2zM18 9h4v6h-4"/>',
  muzzle: '<path d="M3 9h8l4-3v12l-4-3H3z"/><path d="M18 8l3-2M18 12h4M18 16l3 2"/>',
  stock: '<path d="M3 9h10l8 3v5l-8-2H3z"/>',
  grip: '<path d="M8 4h8v5l-2 11H9L8 9z"/>',
  mag: '<path d="M8 3h7l2 18H10z"/><path d="M9 8h7"/>',
  sight: '<circle cx="12" cy="12" r="6"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  under: '<path d="M3 7h18M7 7v6h10V7M10 13v5h4v-5"/>',
  tank: '<rect x="7" y="4" width="10" height="16" rx="5"/><path d="M7 10h10"/>',
  blade: '<path d="M4 20l3-3M7 17L19 5l1 4-9 11z"/>',
  head: '<path d="M10 3h8v8h-8zM14 11v10"/>',
  handle: '<path d="M12 2v20M9 6h6M9 18h6"/>',
  guard: '<path d="M3 12h18M12 8v8"/>',
  pommel: '<circle cx="12" cy="15" r="5"/><path d="M12 2v8"/>',
  deco: '<path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/>',
  projectile: '<path d="M14 4h6v6l-9 9-6-6z"/><path d="M5 19l-2 2M8 16l-3 3"/>',
};

export type IconName = keyof typeof P | string;

export function icon(name: IconName, cls = 'ui-icon'): string {
  const body = P[name] ?? P.deco;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${body}</svg>`;
}
