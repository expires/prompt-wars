import './menus.css';
import { el, esc, isolate } from '../dom';

/** Modal confirm (real buttons, Esc = cancel, Enter = confirm). Resolves true when confirmed. */
export function confirmDialog(o: { title: string; body: string; yes: string; no?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const root = el('div', 'menu-layer confirm');
    root.dataset.testid = 'confirm-dialog';
    root.innerHTML = `<div class="confirm-box ui-plate--menu" role="alertdialog" aria-modal="true" aria-labelledby="confirm-t">
      <h2 class="ui-title" id="confirm-t">${esc(o.title)}</h2>
      <p>${esc(o.body)}</p>
      <div class="confirm-actions">
        <button class="ui-btn ui-btn--secondary" data-testid="confirm-no">${esc(o.no ?? 'Cancel')}</button>
        <button class="ui-btn ${o.danger ? 'ui-btn--danger' : 'ui-btn--primary'}" data-testid="confirm-yes">${esc(o.yes)}</button>
      </div>
    </div>`;
    isolate(root);
    const done = (v: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        done(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    root.querySelector('[data-testid=confirm-no]')!.addEventListener('click', () => done(false));
    root.querySelector('[data-testid=confirm-yes]')!.addEventListener('click', () => done(true));
    root.addEventListener('click', (e) => {
      if (e.target === root) done(false);
    });
    document.body.append(root);
    root.querySelector<HTMLButtonElement>('[data-testid=confirm-yes]')!.focus();
  });
}
