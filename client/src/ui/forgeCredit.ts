// "First forged by X" / "Forged by X · N uses" for weapon cards, from the prompt cache
// (forged_prompt). The net layer registers its lookup once; cards call forgeCreditFor().
import { normalizePrompt } from '@ai-gaem/shared';
import type { ForgedInfo } from '../net/NetClient';
import type { Weapon } from '../weapons/types';

export interface ForgeCredit {
  /** the holder is the first forger of this prompt, holding the original design */
  first: boolean;
  by: string;
  uses: number;
}

let lookup: ((norm: string) => ForgedInfo | undefined) | null = null;
let localId = '';

/** local player's identity hex (default holder for loadout cards) */
export function setLocalIdentity(id: string) {
  localId = id;
}
export function localIdentity(): string {
  return localId;
}

export function setForgedLookup(fn: ((norm: string) => ForgedInfo | undefined) | null) {
  lookup = fn;
}

/** user prompt of a weapon (presets / remix seeds have none) */
export function weaponPrompt(w: Pick<Weapon, 'prompt'> | null | undefined): string {
  const p = w?.prompt?.trim() ?? '';
  return p && !p.startsWith('preset:') ? p : '';
}

/** `holder`: identity hex of whoever carries it (default: the weapon's owner). */
export function forgeCreditFor(w: Weapon | null | undefined, holder?: string): ForgeCredit | null {
  const p = weaponPrompt(w);
  if (!w || !p || !lookup) return null;
  const f = lookup(normalizePrompt(p));
  if (!f) return null;
  const who = holder ?? w.owner;
  return { first: f.designId === w.id && !!who && who === f.firstBy, by: f.firstName, uses: f.uses };
}

export function creditFromInfo(f: ForgedInfo, holder?: string): ForgeCredit {
  return { first: !!holder && holder === f.firstBy, by: f.firstName, uses: f.uses };
}
