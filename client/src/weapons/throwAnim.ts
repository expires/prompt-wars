import type { VmPose } from './meleeAnim';

/** Total throw animation time (seconds). */
export const THROW_TIME = 0.5;

const ZERO: VmPose = { p: [0, 0, 0], r: [0, 0, 0] };
// wind-up (back/down) -> release (whip forward/down) -> recover
const WINDUP: VmPose = { p: [0.12, -0.1, 0.3], r: [-0.55, 0.25, 0.35] };
const RELEASE: VmPose = { p: [-0.06, 0.08, -0.4], r: [0.7, -0.25, -0.25] };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

function mix(a: VmPose, b: VmPose, t: number): VmPose {
  return {
    p: [lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)],
    r: [lerp(a.r[0], b.r[0], t), lerp(a.r[1], b.r[1], t), lerp(a.r[2], b.r[2], t)],
  };
}

/** First-person throwpose for progress `t` in 0..1 (0 = wind-up start, 1 = recovered). */
export function throwPose(t: number): VmPose {
  const u = Math.max(0, Math.min(1, t));
  if (u < 0.4) return mix(WINDUP, RELEASE, ease(u / 0.4));
  if (u < 0.68) return mix(RELEASE, ZERO, ease((u - 0.4) / 0.28));
  return mix(ZERO, ZERO, (u - 0.68) / 0.32);
}

/** True while the held object should be hidden (the release frame). */
export function throwReleased(t: number): boolean {
  return t > 0.4 && t < 0.68;
}
