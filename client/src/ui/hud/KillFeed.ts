// Kill feed (top-right): max 5 rows, 6 s life, newest on top.
import { el, esc } from '../dom';
import { icon } from '../icons';

export interface KillOpts {
  /** killer weapon rarity tier 1..5 (chip border colour) */
  tier?: number;
  melee?: boolean;
  /** involves the local player (accent row); default killerIsYou || victimIsYou */
  mine?: boolean;
  killerIsYou?: boolean;
  victimIsYou?: boolean;
  /** element of the killing blow (fire / ice / poison / shock) */
  element?: string | null;
}

const MAX = 5;
const LIFE_MS = 6000;

export class KillFeed {
  readonly root = el('div', 'hud-kf');

  constructor() {
    this.root.dataset.testid = 'killfeed';
  }

  add(killer: string, weapon: string, victim: string, headshot = false, opts: KillOpts = {}) {
    const tier = Math.max(1, Math.min(5, Math.round(opts.tier ?? 1)));
    const mine = opts.mine ?? (!!opts.killerIsYou || !!opts.victimIsYou);
    const glyph = headshot
      ? `<span class="kf-glyph kf-glyph--hs" data-testid="kf-headshot" title="Headshot">${icon('headshot', 'ui-icon')}<span class="sr-only">headshot</span></span>`
      : opts.melee
        ? `<span class="kf-glyph kf-glyph--melee" title="Melee">${icon('melee', 'ui-icon')}</span>`
        : '';
    const elementGlyph = opts.element
      ? `<span class="kf-glyph kf-glyph--el kf-el--${esc(opts.element)}" data-testid="kf-element-${esc(opts.element)}" title="${esc(opts.element)}">${icon(opts.element, 'ui-icon')}<span class="sr-only">${esc(opts.element)}</span></span>`
      : '';
    const row = el(
      'div',
      `kf-row${mine ? ' is-mine' : ''}`,
      `<span class="kf-name kf-killer${opts.killerIsYou ? ' is-you' : ''}">${esc(killer)}</span>` +
        `<span class="kf-chip tier-${tier}"><span class="kf-chip__in">${icon(opts.melee ? 'blade' : 'ammo', 'ui-icon')}<span class="kf-chip__name">${esc(weapon)}</span></span></span>` +
        elementGlyph +
        glyph +
        `<span class="kf-name kf-victim${opts.victimIsYou ? ' is-you' : ''}">${esc(victim)}</span>`,
    );
    this.root.prepend(row);
    while (this.root.children.length > MAX) this.root.lastElementChild?.remove();
    window.setTimeout(() => {
      row.classList.add('is-out');
      window.setTimeout(() => row.remove(), 240);
    }, LIFE_MS);
  }
}
