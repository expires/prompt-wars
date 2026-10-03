// Melee combat rules shared by the client (animation, swing sweep, local estimates), the server
// (validation, damage) and tests. Dependency-free and deterministic (bundled into the module).

import { HIT_ZONE_HEAD, MAX_HEADSHOT_DAMAGE, type Weapon } from './weapon';

export const MELEE_SWINGS = ['slash', 'overhead', 'thrust', 'bash', 'spin'] as const;
export type MeleeSwing = (typeof MELEE_SWINGS)[number];
export const MELEE_WEIGHTS = ['light', 'medium', 'heavy'] as const;
export type MeleeWeight = (typeof MELEE_WEIGHTS)[number];

/**
 * Melee animation / reach metadata (same shape as @ai-gaem/parts templates).
 * `reach` = metres from the hand to the striking tip (template convention, 0.3 - 3).
 * The distance a swing actually hits at (from the eye) is `meleeReach()`.
 */
export interface MeleeMeta {
  swing: MeleeSwing;
  reach: number;
  weight: MeleeWeight;
}

/** stored hand->tip reach bounds */
export const MELEE_META_REACH_MIN = 0.3;
export const MELEE_META_REACH_MAX = 3;
/** eye -> hand: added to the weapon's own reach */
export const MELEE_ARM_REACH = 0.75;
/** effective hit reach bounds (eye -> impact), so tiny objects (drills, kettlebells) still connect */
export const MELEE_REACH_MIN = 1.2;
export const MELEE_REACH_MAX = 3;

/** Total swing animation time per weight class (seconds). */
export const MELEE_SWING_TIME: Record<MeleeWeight, number> = { light: 0.35, medium: 0.55, heavy: 0.9 };

/** Hold time for a full heavy (charged) attack. */
export const MELEE_CHARGE_TIME = 1;
/** Charge below this fraction is a normal swing. */
export const MELEE_MIN_CHARGE = 0.15;
/** Damage multiplier at full charge (linear from 1). */
export const MELEE_CHARGE_DAMAGE = 1.75;
/** Extra reach at full charge (fraction of the effective reach). */
export const MELEE_CHARGE_REACH = 0.25;
/** A charged swing animates this much slower. */
export const MELEE_CHARGE_SLOWDOWN = 1.35;
/** Charged hits never exceed these (unless the plain hit already does). */
export const CHARGED_BODY_CAP = 75;
export const CHARGED_HEAD_CAP = 100;
/** Server: slack (s) on "time since the last swing >= claimed charge time" (network jitter). */
export const MELEE_CHARGE_SLACK = 0.15;
/** Server: tolerance (m) on the eye -> impact distance. */
export const MELEE_REACH_TOLERANCE = 0.4;
/** Server: tolerance (m) between the swing origin and the attacker's eye (+ speed * 0.15 s). */
export const MELEE_ORIGIN_TOLERANCE = 1;
/** Blocking (F / right mouse with shields): incoming melee damage multiplier from the front. */
export const BLOCK_DAMAGE_MULT = 0.4;
/** Front cone (full angle, degrees) a block covers. */
export const BLOCK_CONE_DEG = 120;
/** Movement speed multiplier while blocking. */
export const BLOCK_MOVE_MULT = 0.55;
/** Knockback multiplier at full charge (1 + charge) and its cap (m/s). */
export const MELEE_MAX_KNOCKBACK = 15;
/** Slash combo: the next slash within this window (s) after a swing ends continues the combo. */
export const MELEE_COMBO_WINDOW = 0.45;
export const MELEE_COMBO_LENGTH = 3;

/**
 * Phase boundaries as fractions of the swing: anticipation [0, strikeStart), strike window
 * [strikeStart, strikeEnd] (hits are swept only here), follow-through until followEnd, recovery.
 */
export interface MeleePhases {
  strikeStart: number;
  strikeEnd: number;
  followEnd: number;
}
export const MELEE_PHASES: Record<MeleeSwing, MeleePhases> = {
  slash: { strikeStart: 0.3, strikeEnd: 0.5, followEnd: 0.68 },
  overhead: { strikeStart: 0.4, strikeEnd: 0.56, followEnd: 0.72 },
  thrust: { strikeStart: 0.34, strikeEnd: 0.5, followEnd: 0.64 },
  bash: { strikeStart: 0.28, strikeEnd: 0.44, followEnd: 0.6 },
  spin: { strikeStart: 0.2, strikeEnd: 0.72, followEnd: 0.84 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step: number) => Math.round(v / step) * step;
const fix = (v: number) => Number(v.toFixed(4));

export function isMeleeSwing(v: unknown): v is MeleeSwing {
  return typeof v === 'string' && (MELEE_SWINGS as readonly string[]).includes(v);
}
export function isMeleeWeight(v: unknown): v is MeleeWeight {
  return typeof v === 'string' && (MELEE_WEIGHTS as readonly string[]).includes(v);
}

// Keyword -> swing (checked in this order against name + part ids, whole tokens / prefixes).
const SWING_WORDS: [MeleeSwing, RegExp][] = [
  ['bash', /\b(shield|chair|stool|door|stop ?sign|stopsign|table|lid|bin|trash ?can|buckler|guitar body|tray|suitcase|briefcase|glove|boxing|punch|fist|knuckle)/],
  ['thrust', /\b(spear|pike|lance|trident|bident|naginata|glaive|umbrella|parasol|pitchfork|rapier|plunger|javelin|harpoon|fork|estoc|epee|foil|stake|pole)/],
  ['spin', /\b(scythe|flail|nunchuck|nunchaku|chain|yo ?yo|whip|propeller)/],
  ['overhead', /\b(hammer|sledge|maul|mallet|axe|hatchet|tomahawk|pan|wok|pot|saucepan|skillet|mace|morningstar|club|bat|pickaxe|gavel|wrench|shovel|tenderizer|halberd|cleaver|anvil|kettlebell|brick|log)/],
];

/** Infer melee metadata for a weapon that has none (old rows, LLM output without it). */
export function inferMeleeMeta(w: Pick<Weapon, 'name' | 'parts' | 'damage' | 'fireRate' | 'range'>): MeleeMeta {
  const hay = `${w.name ?? ''} ${(w.parts ?? []).map(p => p.partId).join(' ')}`.toLowerCase().replace(/[-_]+/g, ' ');
  let swing: MeleeSwing = 'slash';
  for (const [s, re] of SWING_WORDS) {
    if (re.test(hay)) {
      swing = s;
      break;
    }
  }
  const interval = 1 / Math.max(0.05, w.fireRate || 1);
  const weight: MeleeWeight = interval >= 0.85 || w.damage >= 60 ? 'heavy' : interval <= 0.5 && w.damage < 40 ? 'light' : 'medium';
  const reach = clamp((w.range || 2.5) - MELEE_ARM_REACH, MELEE_META_REACH_MIN, MELEE_META_REACH_MAX);
  return { swing, reach: fix(round(reach, 0.05)), weight };
}

/** Clean raw melee metadata; missing / invalid fields are inferred from the weapon. */
export function sanitizeMeleeMeta(raw: unknown, w: Pick<Weapon, 'name' | 'parts' | 'damage' | 'fireRate' | 'range'>): MeleeMeta {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const inferred = inferMeleeMeta(w);
  const n = typeof r.reach === 'number' ? r.reach : typeof r.reach === 'string' ? Number(r.reach) : NaN;
  return {
    swing: isMeleeSwing(r.swing) ? r.swing : inferred.swing,
    reach: Number.isFinite(n) ? fix(round(clamp(n, MELEE_META_REACH_MIN, MELEE_META_REACH_MAX), 0.05)) : inferred.reach,
    weight: isMeleeWeight(r.weight) ? r.weight : inferred.weight,
  };
}

/** Metadata for any melee weapon (stored, or inferred). */
export function meleeMetaOf(w: Pick<Weapon, 'name' | 'parts' | 'damage' | 'fireRate' | 'range'> & { melee?: MeleeMeta }): MeleeMeta {
  return w.melee ?? inferMeleeMeta(w);
}

/** Effective hit reach from the eye (m) for a meta reach (hand -> tip). */
export function effectiveReach(metaReach: number): number {
  return clamp(metaReach + MELEE_ARM_REACH, MELEE_REACH_MIN, MELEE_REACH_MAX);
}

/** Hit reach (eye -> impact) of a swing with charge fraction `charge` (0..1). */
export function meleeReach(w: Parameters<typeof meleeMetaOf>[0], charge = 0): number {
  return effectiveReach(meleeMetaOf(w).reach) * (1 + MELEE_CHARGE_REACH * clamp(charge, 0, 1));
}

/** Swing animation length (s). Charged swings are slower; the slash finisher a bit longer. */
export function meleeSwingDuration(weight: MeleeWeight, charge = 0, combo = 0): number {
  let d = MELEE_SWING_TIME[weight];
  if (charge >= MELEE_MIN_CHARGE) d *= MELEE_CHARGE_SLOWDOWN;
  else if (combo === MELEE_COMBO_LENGTH - 1) d *= 1.15;
  return d;
}

/**
 * Swings per second actually allowed: the weapon's fireRate, but never faster than its swing
 * animation (weight). Only ever lowers DPS, so the clampWeapon budget still holds.
 */
export function meleeSwingRate(w: Pick<Weapon, 'fireRate'> & { melee?: MeleeMeta }, meta?: MeleeMeta): number {
  const m = meta ?? w.melee;
  const interval = Math.max(1 / Math.max(0.05, w.fireRate), m ? MELEE_SWING_TIME[m.weight] : 0);
  return 1 / interval;
}

/** Server: the charge actually granted for a claimed `charge`, given the time since the last swing. */
export function grantedCharge(claimed: number, secondsSinceLastSwing: number): number {
  if (!Number.isFinite(claimed) || claimed < MELEE_MIN_CHARGE) return 0;
  const possible = (Math.max(0, secondsSinceLastSwing) + MELEE_CHARGE_SLACK) / MELEE_CHARGE_TIME;
  const g = Math.min(clamp(claimed, 0, 1), possible);
  return g < MELEE_MIN_CHARGE ? 0 : g;
}

/**
 * Damage of a melee hit: body = damage (x charge multiplier); head = body x headshotMultiplier.
 * Plain hits cap the head at MAX_HEADSHOT_DAMAGE (like guns); charged hits are capped at
 * CHARGED_BODY_CAP / CHARGED_HEAD_CAP (never below the plain hit). Blocked hits x BLOCK_DAMAGE_MULT.
 */
export function meleeHitDamage(w: Pick<Weapon, 'damage' | 'headshotMultiplier'>, charge: number, zone: number, blocked = false): number {
  const c = clamp(charge || 0, 0, 1);
  const base = w.damage;
  const hm = clamp(w.headshotMultiplier || 1, 1, 3);
  let dmg: number;
  if (c <= 0) {
    dmg = zone === HIT_ZONE_HEAD ? Math.min(base * hm, Math.max(base, MAX_HEADSHOT_DAMAGE)) : base;
  } else {
    const body = Math.min(base * (1 + (MELEE_CHARGE_DAMAGE - 1) * c), Math.max(base, CHARGED_BODY_CAP));
    dmg = zone === HIT_ZONE_HEAD ? Math.min(body * hm, Math.max(body, CHARGED_HEAD_CAP)) : body;
  }
  return blocked ? dmg * BLOCK_DAMAGE_MULT : dmg;
}

/** Knockback speed (m/s) of a melee hit. */
export function meleeKnockback(w: Pick<Weapon, 'knockback'>, charge: number, weight: MeleeWeight): number {
  const k = w.knockback * (1 + clamp(charge || 0, 0, 1)) * (weight === 'heavy' ? 1.2 : 1);
  return Math.min(MELEE_MAX_KNOCKBACK, k);
}

/** Is the eye -> impact distance within the (charged) reach + tolerance? */
export function isMeleeReachValid(origin: readonly number[], impact: readonly number[], reach: number): boolean {
  const d = Math.hypot(impact[0] - origin[0], impact[1] - origin[1], impact[2] - origin[2]);
  return d <= reach + MELEE_REACH_TOLERANCE;
}

/**
 * Does a block by a victim at `victim` facing `yaw` (0 faces -Z) cover an attack from `attacker`?
 * True when the attacker is inside the front BLOCK_CONE_DEG cone (horizontal).
 */
export function blockCovers(victim: readonly number[], yaw: number, attacker: readonly number[]): boolean {
  const dx = attacker[0] - victim[0];
  const dz = attacker[2] - victim[2];
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return true;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return (dx * fx + dz * fz) / len >= Math.cos(((BLOCK_CONE_DEG / 2) * Math.PI) / 180);
}

// ---------------------------------------------------------------------------
// Swing arcs (camera space: -Z forward, +X right, +Y up)
// ---------------------------------------------------------------------------

export interface ArcSample {
  /** unit direction in camera space */
  dir: [number, number, number];
  /** fraction of the reach this sample sweeps to (thrust lunges, bash is short) */
  reachFrac: number;
  /** swing progress inside the strike window (0..1) */
  u: number;
}

const DEG = Math.PI / 180;

/** azimuth (deg, + = right) / elevation (deg, + = up) / reach fraction at strike progress u (0..1) */
function arcAngles(swing: MeleeSwing, combo: number, u: number, arcDeg: number): [number, number, number] {
  const half = clamp(arcDeg / 2, 25, 75);
  switch (swing) {
    case 'slash': {
      if (combo % MELEE_COMBO_LENGTH === 2) return [-half * 1.15 + 2 * half * 1.15 * u, 2 - 6 * u, 1]; // wide finisher L -> R
      // combo 0: right-high -> left-low; combo 1: left-high -> right-low (alternating)
      const s = combo % MELEE_COMBO_LENGTH === 0 ? -1 : 1;
      return [s * (-half + 2 * half * u), 18 - 34 * u, 1];
    }
    case 'overhead':
      return [4 - 6 * u, 62 - 100 * u, 1];
    case 'thrust':
      // straight lunge with a slight spiral so it covers a small cone around the crosshair
      return [Math.cos(u * 12) * 5 * (1 - u * 0.5), Math.sin(u * 12) * 5 * (1 - u * 0.5) - 2, 0.55 + 0.45 * u];
    case 'bash':
      return [-22 + 44 * u, 4 - 10 * u, 0.85];
    case 'spin':
      // full circle starting at the right, sweeping through the front to the left and behind
      return [180 - 360 * u, -4, 1];
  }
}

/** Direction + reach fraction of the swing at strike progress u (0..1). */
export function meleeArcPoint(swing: MeleeSwing, combo: number, u: number, arcDeg = 90): ArcSample {
  const [az, el, reachFrac] = arcAngles(swing, combo, clamp(u, 0, 1), arcDeg);
  const ca = Math.cos(el * DEG);
  return {
    dir: [Math.sin(az * DEG) * ca, Math.sin(el * DEG), -Math.cos(az * DEG) * ca],
    reachFrac,
    u: clamp(u, 0, 1),
  };
}

/**
 * Samples covering the arc between strike progress u0 (exclusive, unless 0) and u1 (inclusive),
 * spaced at most `maxStepDeg` apart so nothing slips between two rays at full reach
 * (3 deg at 3 m ~= 16 cm, the head radius). Used once per frame during the strike window.
 */
export function sampleMeleeArc(swing: MeleeSwing, combo: number, u0: number, u1: number, arcDeg = 90, maxStepDeg = 3): ArcSample[] {
  const a = clamp(u0, 0, 1);
  const b = clamp(u1, 0, 1);
  if (b < a) return [];
  const p0 = meleeArcPoint(swing, combo, a, arcDeg);
  const p1 = meleeArcPoint(swing, combo, b, arcDeg);
  // angular length of the segment, estimated with a few sub-steps
  let ang = 0;
  let prev = p0.dir;
  for (let i = 1; i <= 8; i++) {
    const d = meleeArcPoint(swing, combo, a + ((b - a) * i) / 8, arcDeg).dir;
    ang += Math.acos(clamp(prev[0] * d[0] + prev[1] * d[1] + prev[2] * d[2], -1, 1)) / DEG;
    prev = d;
  }
  const n = Math.max(1, Math.ceil(ang / maxStepDeg));
  const out: ArcSample[] = [];
  if (a === 0) out.push(p0);
  for (let i = 1; i <= n; i++) out.push(i === n ? p1 : meleeArcPoint(swing, combo, a + ((b - a) * i) / n, arcDeg));
  return out;
}
