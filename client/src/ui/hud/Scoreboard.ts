// Hold-Tab scoreboard: 960u wide, centred, top 140u.
import { el, esc } from '../dom';
import { icon } from '../icons';

export interface ScoreRow {
  id: string;
  name: string;
  weapon: string;
  tier: number;
  kills: number;
  deaths: number;
  /** 0..100, null = no hits yet */
  hsPct: number | null;
  ping: number | null;
  you: boolean;
  alive: boolean;
  /** weapon prompt (tooltip) */
  prompt?: string;
}

export class Scoreboard {
  readonly root = el('div', 'hud-sb');
  private readonly body = el('div', 'hud-sb__body');
  private readonly count = el('span', 'hud-sb__count');
  private readonly foot = el('div', 'hud-sb__foot');
  private lastKey = '';

  constructor() {
    this.root.dataset.testid = 'scoreboard';
    this.root.hidden = true;
    const head = el(
      'div',
      'hud-sb__top',
      `<div class="hud-sb__title">${icon('crosshair', 'ui-icon')}<span>Scoreboard</span></div>`,
    );
    head.append(this.count);
    const cols = el(
      'div',
      'hud-sb__row hud-sb__row--head',
      '<span>#</span><span>Player</span><span>Weapon</span><span class="r">K</span><span class="r">D</span><span class="r">HS%</span><span class="r">MS</span>',
    );
    this.root.append(head, cols, this.body, this.foot);
  }

  setRows(rows: ScoreRow[], footer: string) {
    const key = JSON.stringify(rows) + footer;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.count.textContent = `${rows.length} ${rows.length === 1 ? 'player' : 'players'}`;
    this.foot.textContent = footer;
    this.body.innerHTML = rows.length
      ? rows
          .map((r, i) => {
            const tier = Math.max(1, Math.min(5, Math.round(r.tier || 1)));
            const ping = r.ping == null ? '—' : String(Math.round(r.ping));
            const pingCls = r.ping == null ? '' : r.ping > 150 ? ' is-bad' : r.ping > 80 ? ' is-warn' : '';
            const hs = r.hsPct == null ? '—' : `${Math.round(r.hsPct)}`;
            return (
              `<div class="hud-sb__row${r.you ? ' is-you' : ''}${r.alive ? '' : ' is-dead'}">` +
              `<span class="hud-sb__rank ui-num">${i + 1}</span>` +
              `<span class="hud-sb__name">${r.alive ? '' : icon('skull', 'ui-icon hud-sb__dead')}<span class="hud-sb__nm">${esc(r.name)}</span>${r.you ? '<span class="hud-sb__you">You</span>' : ''}</span>` +
              `<span class="hud-sb__wpn tier-${tier}"${r.prompt ? ` title="${esc(`“${r.prompt}”`)}"` : ''}><i class="hud-sb__dia" aria-hidden="true"></i><span class="hud-sb__wn">${esc(r.weapon)}</span></span>` +
              `<span class="r ui-num hud-sb__k">${r.kills}</span>` +
              `<span class="r ui-num hud-sb__d">${r.deaths}</span>` +
              `<span class="r ui-num hud-sb__hs">${hs}</span>` +
              `<span class="r ui-num hud-sb__ping${pingCls}">${ping}</span>` +
              `</div>`
            );
          })
          .join('')
      : '<div class="hud-sb__empty">Waiting for players…</div>';
  }
}
