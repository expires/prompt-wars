// Reusable weapon card (Borderlands-style): tier band with hatch, name, class chip, pips + rarity
// label, italic flavor text, "Forged by X". Used by the Forge, landing loadout, death screen.
import './card.css';
import { esc } from './dom';
import { flavorFor, pipsHtml, rarityOf, type Rarity, TIER_LABELS, type Tier } from './rarity';
import type { Weapon } from '../weapons/types';

export interface WeaponCardData {
  name: string;
  cls: string;
  rarity: Pick<Rarity, 'tier' | 'label'>;
  flavor?: string;
  forgedBy?: string;
  /** compact stat line, e.g. "24 DMG · 450 RPM · 30 MAG" */
  stats?: string;
}

export function classLabel(cls: string): string {
  return cls.replace(/_/g, ' ');
}

export function cardDataFor(w: Weapon, forgedBy?: string): WeaponCardData {
  const r = rarityOf(w);
  const dmg = w.pellets > 1 ? `${+w.damage.toFixed(1)}×${w.pellets}` : `${+w.damage.toFixed(1)}`;
  const stats =
    w.fireMode === 'melee'
      ? `${dmg} DMG · ${Math.round(w.fireRate * 60)} SWINGS/MIN · ${w.range.toFixed(1)} M REACH`
      : `${dmg} DMG · ${Math.round(w.fireRate * 60)} RPM · ${w.magSize} MAG`;
  return { name: w.name, cls: w.class, rarity: r, flavor: flavorFor(w.name, w.class), forgedBy, stats };
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
      ${d.flavor ? `<p class="wcard-flavor">“${esc(d.flavor)}”</p>` : ''}
      ${d.forgedBy ? `<div class="wcard-by">Forged by <b>${esc(d.forgedBy)}</b></div>` : ''}
    </div>
  </article>`;
}

/** Mount / update a card inside `host`. */
export function renderWeaponCard(host: HTMLElement, d: WeaponCardData | null, opts: { compact?: boolean; testid?: string } = {}) {
  host.innerHTML = d ? weaponCardHtml(d, opts) : `<article class="wcard wcard--empty tier-1"><div class="wcard-body"><h3 class="wcard-name">No weapon yet</h3><p class="wcard-flavor">Forge one or pick a preset.</p></div></article>`;
}
