// Tiny DOM helpers shared by the UI modules.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** stop clicks / keys inside an overlay from reaching the game (pointer lock, key bindings) */
export function isolate(root: HTMLElement) {
  for (const ev of ['click', 'mousedown', 'pointerdown', 'wheel'] as const) root.addEventListener(ev, (e) => e.stopPropagation());
}

export function reducedMotion(): boolean {
  return document.documentElement.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
}
