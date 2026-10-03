// Weapon rarity (tier 1-5) + flavor text. Pure + tiny: used by the HUD, menus and the Forge.
//
// Rarity is a simple "creativity" score of a Forge design: component count, share of from-scratch
// (shape) components vs catalog parts, primitive variety, glow / fx flourishes. Presets are Scrap.
import type { ForgeDesign } from '@ai-gaem/shared';
import type { Weapon } from '../weapons/types';

export type Tier = 1 | 2 | 3 | 4 | 5;
export const TIER_LABELS: Record<Tier, string> = { 1: 'Scrap', 2: 'Custom', 3: 'Rare', 4: 'Prototype', 5: 'Mythic' };

export interface Rarity {
  tier: Tier;
  label: string;
  /** 0..1 */
  score: number;
}

export function designScore(d: Pick<ForgeDesign, 'components' | 'fx' | 'palette'>): number {
  const comps = d.components ?? [];
  const n = comps.length;
  if (!n) return 0;
  const scratch = comps.filter((c) => c.shapes && c.shapes.length).length / n;
  const types = new Set<string>();
  let glow = false;
  let shapes = 0;
  for (const c of comps) {
    for (const s of c.shapes ?? []) {
      types.add(s.type);
      shapes++;
      if (s.material?.emissive) glow = true;
    }
  }
  const fx = d.fx ?? {};
  const fxCustom = (fx.trail && fx.trail !== 'none') || (fx.projectileShape && fx.projectileShape !== 'pellet') ? 1 : 0;
  return Math.min(
    1,
    0.32 * Math.min(1, n / 14) +
      0.28 * scratch +
      0.16 * Math.min(1, types.size / 6) +
      0.08 * Math.min(1, shapes / 30) +
      0.08 * (glow ? 1 : 0) +
      0.08 * fxCustom,
  );
}

export function tierForScore(score: number): Tier {
  return score < 0.22 ? 1 : score < 0.42 ? 2 : score < 0.6 ? 3 : score < 0.78 ? 4 : 5;
}

export function rarityOfDesign(d: Pick<ForgeDesign, 'components' | 'fx' | 'palette'>): Rarity {
  const score = designScore(d);
  // anything forged is at least Custom
  const tier = Math.max(2, tierForScore(score)) as Tier;
  return { tier, label: TIER_LABELS[tier], score };
}

export function rarityOf(w: Pick<Weapon, 'design' | 'isPreset' | 'prompt'> | undefined | null): Rarity {
  if (!w) return { tier: 1, label: TIER_LABELS[1], score: 0 };
  if (w.design && w.design.components?.length) return rarityOfDesign(w.design);
  if (w.isPreset || (w.prompt ?? '').startsWith('preset:')) return { tier: 1, label: TIER_LABELS[1], score: 0 };
  return { tier: 2, label: TIER_LABELS[2], score: 0.3 };
}

export function pipsHtml(tier: number): string {
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<i class="${i <= tier ? 'on' : ''}"></i>`;
  return `<span class="ui-pips" aria-hidden="true">${s}</span>`;
}

export function rarityHtml(r: Pick<Rarity, 'tier' | 'label'>): string {
  return `<span class="ui-rarity tier-${r.tier}">${pipsHtml(r.tier)}<span>${r.label}</span></span>`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const FLAVOR_GENERIC = [
  'Point the loud end at the problem.',
  'Assembled from a dream and three spare parts.',
  'Warranty void the moment you pull the trigger.',
  'It looked better on the whiteboard. It works better in the field.',
  'Built in a hurry. Feared at leisure.',
  'The forge said no. We asked again.',
  'Every scratch is a story. Every story ends badly for someone.',
  'Ergonomics were discussed. Briefly.',
];
const FLAVOR_BY_CLASS: Record<string, string[]> = {
  melee: ['Reach out and touch someone.', 'No reload. No mercy. No refunds.', 'Swing first, ask questions never.'],
  sniper: ['Patience, measured in heartbeats.', 'One breath. One click. One less problem.'],
  shotgun: ['Conversation ender at close range.', 'Aim is a suggestion.'],
  rocket_launcher: ['Subtlety was never on the spec sheet.', 'Area of effect: yes.'],
  grenade_launcher: ['Lob it, lean back, enjoy the show.'],
  flamethrower: ['Warm regards, delivered personally.', 'Fire safety is a state of mind.'],
  bubble_gun: ['Bubbles: fun, bouncy, deeply inconvenient.', 'Pop goes the opposition.'],
  blowgun: ['Quiet as a whisper. Rude as a shout.'],
  crossbow: ['Old-school physics, new-school regret.'],
  smg: ['Why hit once when you can hit forty times?'],
  lmg: ['Suppression is a love language.'],
  pistol: ['Small, honest, surprisingly persuasive.'],
  rifle: ['Reliable as a sunrise. Louder, too.'],
};

/** One-line flavor text, deterministic per weapon name (client-side; no extra forge call). */
export function flavorFor(name: string, cls = ''): string {
  const h = hash(`${name}|${cls}`);
  const pool = [...(FLAVOR_BY_CLASS[cls] ?? []), ...FLAVOR_GENERIC];
  const n = name.trim();
  // sometimes riff on the name itself
  if (n && h % 4 === 0) {
    const last = n.split(/\s+/).pop()!;
    const riffs = [`Ask for the ${last} by name.`, `They will remember the ${last}.`, `Nobody expects the ${last}.`];
    return riffs[(h >>> 3) % riffs.length];
  }
  return pool[h % pool.length];
}
