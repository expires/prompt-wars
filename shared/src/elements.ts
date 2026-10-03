// Elemental weapon effects + carry-weight movement. Shared by clampWeapon (budget), the server
// (applies effects on hit), the client (movement, visuals) and the forge (DSL / prompt).
// Dependency-free and deterministic: bundled into the SpacetimeDB module.

import type { WeaponClass, FireMode } from './weapon';
import type { MeleeWeight } from './melee';

export const ELEMENTS = ['fire', 'ice', 'poison', 'shock'] as const;
export type Element = (typeof ELEMENTS)[number];

/** Wire codes (player.dotElement / player.slowElement / hit_event.element); 0 = none. */
export const ELEMENT_CODE: Record<Element, number> = { fire: 1, ice: 2, poison: 3, shock: 4 };

export function elementFromCode(code: number | undefined | null): Element | null {
  switch (code) {
    case 1:
      return 'fire';
    case 2:
      return 'ice';
    case 3:
      return 'poison';
    case 4:
      return 'shock';
    default:
      return null;
  }
}

export function elementCode(e: Element | null | undefined): number {
  return e ? ELEMENT_CODE[e] : 0;
}

/**
 * Default effect per element. A weapon with an element but no own DoT / slow gets these values
 * (then the normal clampWeapon budget applies: DoT counts toward DPS, slow toward utility).
 * - fire:   burn DoT, 4 dps for 3 s (refreshes, never stacks)
 * - poison: longer, weaker DoT (2.5 dps for 6 s)
 * - ice:    35 % slow for 1.5 s, consecutive hits stack (+half each) up to 60 %
 * - shock:  brief heavy slow (60 % for 0.4 s)
 */
export const ELEMENT_EFFECTS = {
  fire: { dotDamage: 12, dotDuration: 3 },
  poison: { dotDamage: 15, dotDuration: 6 },
  ice: { slowPercent: 35, slowDuration: 1.5, stackMax: 60, stackFraction: 0.5 },
  shock: { slowPercent: 60, slowDuration: 0.4 },
} as const;

/** Default slow duration (non-elemental slows, e.g. bubbles). Same as SLOW_DURATION in weapon.ts. */
const PLAIN_SLOW_DURATION = 1.5;

/** Seconds a slow from a weapon of this element lasts. */
export function slowDurationFor(element: Element | null | undefined): number {
  if (element === 'shock') return ELEMENT_EFFECTS.shock.slowDuration;
  if (element === 'ice') return ELEMENT_EFFECTS.ice.slowDuration;
  return PLAIN_SLOW_DURATION;
}

/**
 * Slow percent after a hit. Ice stacks onto an active ice chill (+stackFraction of the hit's
 * slow per hit, capped at stackMax); everything else refreshes (the stronger of the active slow
 * and the hit's slow while active, else the hit's slow).
 */
export function stackedSlow(
  element: Element | null | undefined,
  hitSlow: number,
  active: { percent: number; element: Element | null } | null,
): number {
  if (hitSlow <= 0) return active ? active.percent : 0;
  if (element === 'ice' && active && active.element === 'ice' && active.percent > 0) {
    return Math.min(ELEMENT_EFFECTS.ice.stackMax, Math.max(hitSlow, active.percent + hitSlow * ELEMENT_EFFECTS.ice.stackFraction));
  }
  return Math.min(60, hitSlow);
}

/** Parse an element value: an Element, null (explicitly none) or undefined (not specified). */
export function sanitizeElement(v: unknown): Element | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === false) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (s === '' || s === 'none' || s === 'null' || s === 'neutral') return null;
  if ((ELEMENTS as readonly string[]).includes(s)) return s as Element;
  // loose synonyms (LLM output)
  return inferElementFromText(s) ?? undefined;
}

const FIRE_RE = /flame|fire|lava|inferno|burn|blaze|magma|napalm|torch|scorch|ember|pyro|molten|incendiar|hellfire|dragon ?breath/i;
const ICE_RE = /\bice|icy|frost|freez|snow|glacier|cryo|frozen|blizzard|chill|arctic|polar/i;
const POISON_RE = /poison|venom|toxic|toxin|viper|acid|plague|cobra|snake|serpent|nerve/i;
const SHOCK_RE = /shock|tesla|lightning|thunder|electr|volt|\bzap|taser|arc ?caster|static/i;

/** Element named in free text (weapon name, template tags / description), or null. */
export function inferElementFromText(text: string): Element | null {
  if (!text) return null;
  if (FIRE_RE.test(text)) return 'fire';
  if (ICE_RE.test(text)) return 'ice';
  if (POISON_RE.test(text)) return 'poison';
  if (SHOCK_RE.test(text)) return 'shock';
  return null;
}

/** Element for a weapon that doesn't specify one: from its name, else its class (flamethrower = fire, blowgun = poison). */
export function inferElement(name: string, cls: WeaponClass, hasDot: boolean): Element | null {
  const byName = inferElementFromText(name);
  if (byName) return byName;
  if (cls === 'flamethrower') return 'fire';
  if (cls === 'blowgun' && hasDot) return 'poison';
  return null;
}

// ---------------------------------------------------------------------------
// Carry weight (movement speed multiplier)
// ---------------------------------------------------------------------------

export const MOVE_MULT_MIN = 0.85;
export const MOVE_MULT_MAX = 1.12;
/** a given moveSpeedMult may differ from the derived one by at most this much */
export const MOVE_MULT_BELOW = 0.05;
export const MOVE_MULT_ABOVE = 0.02;
/** budget: each +1 % of movement speed costs 0.5 % of effective DPS (slower weapons get nothing back) */
export const MOVE_BUDGET_WEIGHT = 0.5;

const CLASS_CARRY: Record<WeaponClass, number> = {
  pistol: 1.08,
  smg: 1.06,
  blowgun: 1.07,
  bubble_gun: 1.03,
  rifle: 1.0,
  shotgun: 1.0,
  crossbow: 1.0,
  weird: 1.0,
  throwable: 1.04,
  sniper: 0.92,
  lmg: 0.92,
  rocket_launcher: 0.88,
  grenade_launcher: 0.88,
  flamethrower: 0.88,
  melee: 1.05,
};

const MELEE_CARRY: Record<MeleeWeight, number> = { light: 1.1, medium: 1.05, heavy: 0.97 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface CarryInput {
  class: WeaponClass;
  fireMode: FireMode;
  /** melee weight class (melee only) */
  meleeWeight?: MeleeWeight;
  magSize: number;
  /** number of legacy parts (a rough size proxy for non-forge weapons) */
  partCount: number;
}

/**
 * Movement multiplier from what you carry: class base (melee by weight), huge magazines and
 * part-heavy builds a little slower. Only uses fields clampWeapon never rescales (idempotent).
 */
export function carryMultiplier(w: CarryInput): number {
  let m = w.fireMode === 'melee' || w.class === 'melee' ? MELEE_CARRY[w.meleeWeight ?? 'medium'] : CLASS_CARRY[w.class];
  if (w.fireMode !== 'melee' && w.magSize > 60) m -= Math.min(0.03, (w.magSize - 60) * 0.0003);
  if (w.partCount > 12) m -= Math.min(0.03, (w.partCount - 12) * 0.004);
  return r3(clamp(m, MOVE_MULT_MIN, MOVE_MULT_MAX));
}

/** Allowed window for a given moveSpeedMult around the derived one. */
export function clampMoveMult(given: number | undefined, derived: number): number {
  if (given === undefined || !Number.isFinite(given)) return derived;
  const lo = Math.max(MOVE_MULT_MIN, derived - MOVE_MULT_BELOW);
  const hi = Math.min(MOVE_MULT_MAX, derived + MOVE_MULT_ABOVE);
  return r3(clamp(given, lo, hi));
}

/**
 * Extra penalty (0..0.05) for a big Forge design: longest side beyond 1.4 m (ranged) / 2 m
 * (melee) and more than 12 components.
 */
export function designBulkPenalty(longestSide: number, components: number, melee: boolean): number {
  const free = melee ? 2 : 1.4;
  const size = Math.min(0.035, Math.max(0, longestSide - free) * 0.035);
  const count = Math.min(0.02, Math.max(0, components - 12) * 0.002);
  return r3(Math.min(MOVE_MULT_BELOW, size + count));
}

/** Budget factor for movement speed (>= 1; only faster-than-normal movement costs DPS). */
export function moveBudgetFactor(moveSpeedMult: number | undefined): number {
  return 1 + MOVE_BUDGET_WEIGHT * Math.max(0, (moveSpeedMult ?? 1) - 1);
}

/** "+8%" / "−12%" / "±0%" label for a multiplier. */
export function moveSpeedLabel(mult: number | undefined): string {
  const p = Math.round(((mult ?? 1) - 1) * 100);
  return p > 0 ? `+${p}%` : p < 0 ? `−${-p}%` : '±0%';
}

/** Movement multiplier of a weapon (stored value, or derived for weapons that predate it). */
export function weaponMoveMultiplier(w: {
  moveSpeedMult?: number;
  class: WeaponClass;
  fireMode: FireMode;
  magSize: number;
  parts?: unknown[];
  melee?: { weight: MeleeWeight };
}): number {
  if (typeof w.moveSpeedMult === 'number' && Number.isFinite(w.moveSpeedMult)) return clamp(w.moveSpeedMult, MOVE_MULT_MIN, MOVE_MULT_MAX);
  return carryMultiplier({ class: w.class, fireMode: w.fireMode, meleeWeight: w.melee?.weight, magSize: w.magSize, partCount: w.parts?.length ?? 0 });
}
