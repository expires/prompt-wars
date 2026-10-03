/**
 * Small top-centre status banners above everything (menus included): "Reconnecting…",
 * "Graphics reset…", "New version — Reload", "Something went wrong — Reload". One element per key,
 * so independent states can stack; `hide(key)` removes one.
 */
const STYLE = `
.status-banners { position: fixed; top: max(10px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  z-index: 2000; display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none;
  width: min(560px, calc(100vw - 32px)); }
.status-banner { pointer-events: auto; display: flex; align-items: center; gap: 12px; padding: 8px 14px;
  background: var(--ink-800, #141821); color: var(--fg, #f5f3ee); border: 1px solid var(--line-strong, rgba(255,255,255,.18));
  font: 600 14px/1.3 var(--font-label, system-ui, sans-serif); letter-spacing: .02em; box-shadow: 0 4px 18px rgba(0,0,0,.45);
  clip-path: var(--clip-cut, none); max-width: 100%; }
.status-banner[data-tone="warn"] { border-color: var(--accent, #ffd23f); }
.status-banner[data-tone="error"] { border-color: var(--hp-lo, #ff4655); }
.status-banner__spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent;
  animation: status-spin .8s linear infinite; flex: none; opacity: .8; }
.status-banner__text { flex: 1; min-width: 0; }
.status-banner button { font: 700 13px/1 var(--font-label, system-ui, sans-serif); letter-spacing: .04em; text-transform: uppercase;
  padding: 7px 12px; border: 0; cursor: pointer; background: var(--accent, #ffd23f); color: var(--accent-ink, #1a1400); flex: none; }
.status-banner button.secondary { background: transparent; color: var(--fg-dim, #a9b0be); }
@keyframes status-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .status-banner__spin { animation: none; } }
`;

export interface BannerOpts {
  tone?: 'info' | 'warn' | 'error';
  spinner?: boolean;
  action?: { label: string; onClick: () => void };
  dismissible?: boolean;
}

let root: HTMLElement | null = null;
const banners = new Map<string, HTMLElement>();

function ensureRoot(): HTMLElement {
  if (root) return root;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  root = document.createElement('div');
  root.className = 'status-banners';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  document.body.append(root);
  return root;
}

export function showBanner(key: string, text: string, opts: BannerOpts = {}) {
  const parent = ensureRoot();
  let el = banners.get(key);
  if (!el) {
    el = document.createElement('div');
    el.className = 'status-banner';
    el.dataset.key = key;
    el.dataset.testid = `banner-${key}`;
    parent.append(el);
    banners.set(key, el);
  }
  el.dataset.tone = opts.tone ?? 'info';
  el.replaceChildren();
  if (opts.spinner) {
    const s = document.createElement('span');
    s.className = 'status-banner__spin';
    el.append(s);
  }
  const t = document.createElement('span');
  t.className = 'status-banner__text';
  t.textContent = text;
  el.append(t);
  if (opts.action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opts.action.label;
    b.addEventListener('click', opts.action.onClick);
    el.append(b);
  }
  if (opts.dismissible) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'secondary';
    b.textContent = 'Later';
    b.addEventListener('click', () => hideBanner(key));
    el.append(b);
  }
}

export function hideBanner(key: string) {
  banners.get(key)?.remove();
  banners.delete(key);
}

export function bannerVisible(key: string) {
  return banners.has(key);
}
