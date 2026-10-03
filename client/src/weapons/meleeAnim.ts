import { MELEE_PHASES, type MeleeSwing, type MeleeWeight } from '@ai-gaem/shared';

/**
 * Procedural first-person melee animation: keyframed offsets (metres / radians) applied to the
 * viewmodel pivot, which sits at the hand (melee models have the grip at the origin).
 *
 * Every swing is rest -> anticipation (wind-up extreme at strikeStart) -> fast strike (to the
 * strike extreme at strikeEnd) -> follow-through (overshoot at followEnd) -> recovery (rest).
 * Phase boundaries come from MELEE_PHASES (shared with the hit sweep, so the blade crosses the
 * crosshair while hits are being swept).
 */
export interface VmPose {
  p: [number, number, number];
  r: [number, number, number];
}

const ZERO: VmPose = { p: [0, 0, 0], r: [0, 0, 0] };

/** wind-up, strike extreme, follow-through extreme, optional mid-strike key (blade crossing the crosshair) */
type Keys = [VmPose, VmPose, VmPose, VmPose?];

const K = (p: [number, number, number], r: [number, number, number]): VmPose => ({ p, r });

// camera-space conventions: +x right, +y up, -z forward; rot.z > 0 tilts the blade left,
// rot.x < 0 tips it forward (away from the camera), rot.y > 0 turns the tip left.
const SLASH_RL: Keys = [
  K([0.12, 0.12, 0.05], [0.25, -0.6, -1.1]),
  K([-0.3, 0.04, -0.1], [-0.5, 0.9, 1.3]),
  K([-0.34, 0.03, -0.05], [-0.6, 1.05, 1.45]),
  K([-0.1, 0.02, -0.2], [-1.15, 0.25, 0.15]),
];
const SLASH_LR: Keys = [
  K([-0.24, 0.13, 0.02], [0.25, 0.65, 1.2]),
  K([0.12, 0.03, -0.1], [-0.5, -0.8, -1.35]),
  K([0.15, 0.02, -0.05], [-0.6, -0.95, -1.5]),
  K([-0.06, 0.02, -0.2], [-1.15, -0.1, -0.15]),
];
const SLASH_FINISHER: Keys = [
  K([0.15, 0.04, 0.08], [0.0, -1.0, -1.5]),
  K([-0.34, 0.0, -0.12], [-0.2, 1.2, 1.6]),
  K([-0.4, -0.03, -0.08], [-0.3, 1.4, 1.65]),
  K([-0.1, 0.02, -0.22], [-1.0, 0.15, 1.45]),
];
const OVERHEAD: Keys = [
  K([-0.06, 0.17, 0.08], [0.95, 0.05, 0.15]),
  K([-0.11, -0.05, -0.15], [-1.3, 0.1, 0.05]),
  K([-0.11, -0.12, -0.1], [-1.6, 0.1, 0.0]),
  K([-0.09, 0.08, -0.12], [-0.45, 0.08, 0.1]),
];
const THRUST: Keys = [
  K([-0.02, 0.05, 0.14], [-0.9, 0.12, 0.1]),
  K([-0.07, 0.07, -0.3], [-0.98, 0.12, 0.1]),
  K([-0.07, 0.06, -0.34], [-1.0, 0.12, 0.1]),
];
const BASH: Keys = [
  K([0.02, -0.02, 0.1], [-0.45, 0.35, 0.45]),
  K([-0.13, 0.02, -0.26], [-0.65, 0.55, 0.5]),
  K([-0.14, 0.01, -0.29], [-0.7, 0.58, 0.5]),
];
const SPIN: Keys = [
  K([0.13, 0.0, 0.05], [0.0, -1.15, -1.5]),
  K([-0.36, -0.02, -0.06], [-0.2, 1.8, 1.6]),
  K([-0.3, -0.06, 0.0], [-0.2, 2.25, 1.6]),
];
/** extra key half-way through the spin strike (the blade passes the crosshair) */
const SPIN_MID = K([-0.1, 0.0, -0.17], [-0.25, 0.4, 1.55]);

/**
 * Boxing-glove resting pose: fists held low, near the bottom of the screen (a blade rests
 * shouldered, but a glove should sit low and punch up/forward from there).
 */
export const GLOVE_BASELINE = K([0.0, -0.22, 0.03], [-0.12, 0.1, 0.0]);

export const BLOCK_POSE = K([-0.13, 0.06, -0.04], [-0.15, 0.95, 1.45]);
export const SHIELD_BLOCK_POSE = K([-0.16, 0.02, -0.06], [-1.05, 0.55, 0.0]);
/** melee sprint: weapon shouldered (blade back over the shoulder) */
export const MELEE_SPRINT_POSE = K([0.04, -0.03, 0.08], [0.75, -0.25, -0.45]);

function keysFor(swing: MeleeSwing, combo: number): Keys {
  switch (swing) {
    case 'slash':
      return combo % 3 === 2 ? SLASH_FINISHER : combo % 3 === 1 ? SLASH_LR : SLASH_RL;
    case 'overhead':
      return OVERHEAD;
    case 'thrust':
      return THRUST;
    case 'bash':
      return BASH;
    case 'spin':
      return SPIN;
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
/** fast strike: accelerates into the blow and keeps its speed to the extreme */
const strikeEase = (t: number) => Math.pow(t, 1.6);

function lerpPose(a: VmPose, b: VmPose, t: number, out: VmPose = { p: [0, 0, 0], r: [0, 0, 0] }): VmPose {
  for (let i = 0; i < 3; i++) {
    out.p[i] = a.p[i] + (b.p[i] - a.p[i]) * t;
    out.r[i] = a.r[i] + (b.r[i] - a.r[i]) * t;
  }
  return out;
}

function scalePose(a: VmPose, k: number): VmPose {
  return { p: [a.p[0] * k, a.p[1] * k, a.p[2] * k], r: [a.r[0] * k, a.r[1] * k, a.r[2] * k] };
}

/** amplitude per weight (heavy swings are bigger) */
const AMP: Record<MeleeWeight, number> = { light: 0.85, medium: 1, heavy: 1.12 };

/**
 * Viewmodel offset for a swing at progress u (0..1). Charged swings wind up further.
 */
export function swingPose(swing: MeleeSwing, combo: number, u: number, weight: MeleeWeight, charged: boolean): VmPose {
  const ph = MELEE_PHASES[swing];
  const [wind0, strike, follow, mid0] = keysFor(swing, combo);
  const amp = AMP[weight];
  const wind = scalePose(wind0, amp * (charged ? 1.25 : 1));
  const s = scalePose(strike, amp);
  const f = scalePose(follow, amp);
  if (u <= 0 || u >= 1) return ZERO;
  if (u < ph.strikeStart) return lerpPose(ZERO, wind, smooth(u / ph.strikeStart));
  if (u < ph.strikeEnd) {
    const t = strikeEase((u - ph.strikeStart) / (ph.strikeEnd - ph.strikeStart));
    if (swing === 'spin' || mid0) {
      const mid = scalePose(mid0 ?? SPIN_MID, amp);
      return t < 0.5 ? lerpPose(wind, mid, t * 2) : lerpPose(mid, s, (t - 0.5) * 2);
    }
    return lerpPose(wind, s, t);
  }
  if (u < ph.followEnd) return lerpPose(s, f, easeOut((u - ph.strikeEnd) / (ph.followEnd - ph.strikeEnd)));
  return lerpPose(f, ZERO, smooth((u - ph.followEnd) / (1 - ph.followEnd)));
}

/** Charging a heavy attack: ease into an exaggerated wind-up, trembling as it fills. */
export function chargePose(swing: MeleeSwing, combo: number, charge: number, weight: MeleeWeight, time: number): VmPose {
  const [wind] = keysFor(swing, combo);
  const k = smooth(Math.min(1, charge * 3)) * (1 + 0.3 * charge) * AMP[weight];
  const out = scalePose(wind, k);
  const tremble = charge > 0.6 ? (charge - 0.6) * 0.012 : 0;
  out.p[0] += Math.sin(time * 61) * tremble;
  out.p[1] += Math.sin(time * 53 + 1) * tremble;
  return out;
}

/** blend helper for the viewmodel */
export function blendPose(a: VmPose, b: VmPose, t: number): VmPose {
  return lerpPose(a, b, t);
}

export const REST_POSE = ZERO;
