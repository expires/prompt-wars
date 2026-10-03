// Toast stack (top-centre, y = 96u): max 2 visible, newest on top, left tick + icon by type.
import { el, esc } from '../dom';
import { icon } from '../icons';

export type ToastType = 'info' | 'success' | 'warn' | 'error' | 'forge';
export interface ToastOpts {
  /** lifetime, default 4000 */
  ms?: number;
  type?: ToastType;
  action?: { label: string; onClick: () => void };
}

const ICONS: Record<ToastType, string> = { info: 'info', success: 'check', warn: 'warning', error: 'x', forge: 'spark' };
const MAX = 2;

interface Entry {
  el: HTMLElement;
  timer: number;
}

export class Toasts {
  readonly root = el('div', 'hud-toasts');
  private readonly entries: Entry[] = [];

  constructor() {
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('role', 'status');
    for (const ev of ['click', 'mousedown', 'pointerdown'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
  }

  /** `html` is trusted markup (callers escape user text) */
  show(html: string, opts: ToastOpts = {}) {
    const type = opts.type ?? 'info';
    const t = el('div', `hud-toast hud-toast--${type}`);
    t.innerHTML = `<span class="hud-toast__ico">${icon(ICONS[type], 'ui-icon hud-toast__svg')}</span><span class="hud-toast__msg">${html}</span>`;
    if (opts.action) {
      const b = el('button', 'ui-btn ui-btn--primary ui-btn--sm hud-toast__btn', `<span>${esc(opts.action.label)}</span>`);
      b.type = 'button';
      const action = opts.action;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        action.onClick();
        this.dismiss(t);
      });
      t.append(b);
    }
    // only the newest toast carries the test ids (Playwright strict mode)
    for (const e of this.entries) {
      e.el.removeAttribute('data-testid');
      e.el.querySelector('[data-testid="toast-action"]')?.removeAttribute('data-testid');
    }
    t.dataset.testid = 'toast';
    t.querySelector('button')?.setAttribute('data-testid', 'toast-action');
    this.root.prepend(t);
    const entry: Entry = { el: t, timer: window.setTimeout(() => this.dismiss(t), opts.ms ?? 4000) };
    this.entries.unshift(entry);
    while (this.entries.length > MAX) this.dismiss(this.entries[this.entries.length - 1].el, true);
  }

  dismiss(t: HTMLElement, instant = false) {
    const i = this.entries.findIndex((e) => e.el === t);
    if (i < 0) return;
    clearTimeout(this.entries[i].timer);
    this.entries.splice(i, 1);
    if (instant) return t.remove();
    t.classList.add('is-out');
    window.setTimeout(() => t.remove(), 160);
  }

  get visible() {
    return this.entries.length > 0;
  }
}
