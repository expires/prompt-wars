// Reusable weapon card (Borderlands-style): tier band with hatch, name, class chip, pips + rarity
// label, italic flavor text, "Forged by X". Used by the Forge, landing loadout, death screen.
import './card.css';
import { esc } from './dom';
import { flavorFor, pipsHtml, rarityOf, type Rarity, TIER_LABELS, type Tier } from './rarity';
import type { Weapon } from '../weapons/types';
import { icon } from './icons';
import { moveSpeedLabel, weaponMoveMultiplier } from '@ai-gaem/shared';
import { forgeCreditFor, weaponPrompt, type ForgeCredit } from './forgeCredit';

export interface WeaponCardData {
  name: string;
  cls: string;
  rarity: Pick<Rarity, 'tier' | 'label'>;
  flavor?: string;
  forgedBy?: string;
  /** compact stat line, e.g. "24 DMG · 450 RPM · 30 MAG" */
  stats?: string;
  /** carry weight label ("+8%" / "−12%") */
  move?: string;
  /** fire / ice / poison / shock */
  element?: string | null;
  /** the prompt it was forged from (shown instead of the flavor text) */
  prompt?: string;
  /** prompt cache credit: replaces the "Forged by" line */
  credit?: ForgeCredit | null;
}

export function classLabel(cls: string): string {
  return cls.replace(/_/g, ' ');
}

/** `holder`: identity hex of whoever carries it (prompt-cache credit; default: the owner) */
export function cardDataFor(w: Weapon, forgedBy?: string, holder?: string): WeaponCardData {
  const credit = forgeCreditFor(w, holder);
  const r = rarityOf(w);
  const dmg = w.pellets > 1 ? `${+w.damage.toFixed(1)}×${w.pellets}` : `${+w.damage.toFixed(1)}`;
  const stats =
    w.fireMode === 'melee'
      ? `${dmg} DMG · ${Math.round(w.fireRate * 60)} SWINGS/MIN · ${w.range.toFixed(1)} M REACH`
      : `${dmg} DMG · ${Math.round(w.fireRate * 60)} RPM · ${w.magSize} MAG`;
  return {
    name: w.name,
    cls: w.class,
    rarity: r,
    flavor: flavorFor(w.name, w.class),
    forgedBy: credit ? undefined : forgedBy,
    prompt: weaponPrompt(w) || undefined,
    credit,
    stats,
    move: moveSpeedLabel(weaponMoveMultiplier(w)),
    element: w.element ?? null,
  };
}

export function weaponCardHtml(d: WeaponCardData, opts: { compact?: boolean; testid?: string } = {}): string {
  const t = d.rarity.tier;
  return `<article class="wcard tier-${t}${opts.compact ? ' wcard--compact' : ''}${t >= 5 ? ' wcard--mythic' : ''}"${opts.testid ? ` data-testid="${opts.testid}"` : ''}>
    <div class="wcard-band ui-hatch">
      <span class="wcard-tier">${pipsHtml(t)}<span>${esc(d.rarity.label || TIER_LABELS[t as Tier])}</span></span>
      <span class="wcard-class">${esc(classLabel(d.cls))}</span>
    </div>
    <div class="wcard-body">
      <h3 class="wcard-name" data-role="name">${esc(d.name)}</h3>
      ${d.stats ? `<div class="wcard-stats">${esc(d.stats)}</div>` : ''}
      ${d.move || d.element ? `<div class="wcard-traits">${d.element ? `<span class="wcard-el wcard-el--${esc(d.element)}" data-testid="card-element">${icon(d.element, 'ui-icon')}${esc(d.element)}</span>` : ''}${d.move && d.move !== '±0%' ? `<span class="wcard-move ${d.move.startsWith('+') ? 'is-fast' : 'is-slow'}" data-testid="card-move">Move speed ${esc(d.move)}</span>` : ''}</div>` : ''}
      ${d.prompt ? `<p class="wcard-flavor wcard-prompt" data-testid="card-prompt">“${esc(d.prompt)}”</p>` : d.flavor ? `<p class="wcard-flavor">“${esc(d.flavor)}”</p>` : ''}
      ${creditHtml(d)}
    </div>
  </article>`;
}

function creditHtml(d: WeaponCardData): string {
  const c = d.credit;
  if (c?.first) return `<div class="wcard-by"><span class="wcard-first" data-testid="card-first-forged">First forged</span> by <b>${esc(c.by)}</b></div>`;
  if (c) return `<div class="wcard-by" data-testid="card-forged-by">Forged by <b>${esc(c.by)}</b> · ${c.uses} ${c.uses === 1 ? 'use' : 'uses'}</div>`;
  return d.forgedBy ? `<div class="wcard-by">Forged by <b>${esc(d.forgedBy)}</b></div>` : '';
}

/** Mount / update a card inside `host`. */
export function renderWeaponCard(host: HTMLElement, d: WeaponCardData | null, opts: { compact?: boolean; testid?: string } = {}) {
  host.innerHTML = d ? weaponCardHtml(d, opts) : `<article class="wcard wcard--empty tier-1"><div class="wcard-body"><h3 class="wcard-name">No weapon yet</h3><p class="wcard-flavor">Forge one or pick a preset.</p></div></article>`;
}
