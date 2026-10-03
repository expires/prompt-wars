import type { LocalPose, NetClient, Vec3 } from './NetClient';

/** send interval while moving and someone else is online (20 Hz) */
export const MOVE_SEND_MS = 50;
/** send interval when only the view direction changes (10 Hz) */
const LOOK_SEND_MS = 100;
/** send interval while nobody else is online (2 Hz) */
const ALONE_SEND_MS = 500;
/** horizontal speed (m/s) below which a grounded player counts as standing still */
const IDLE_SPEED = 0.05;
const LOOK_EPS = 0.004;

export interface PoseInput {
  pos: Vec3;
  yaw: number;
  pitch: number;
  crouching: boolean;
  grounded: boolean;
  /** blocking with a melee weapon (replicated in the pose flags) */
  blocking?: boolean;
}

/**
 * When to call update_transform. Driven from the fixed physics step with the step's timestamp
 * (uniformly spaced), so remote interpolation sees an even cadence:
 *
 * - 20 Hz while moving, 10 Hz while only looking around, nothing while idle (no heartbeat);
 * - immediately on discrete changes: start / stop moving, jump / land, crouch, teleport;
 * - alone on the server: 2 Hz plus the final "stopped" pose only.
 *
 * Velocity is the achieved movement over the last step (not the controller's wish velocity), so
 * Hermite interpolation on the receiving side doesn't overshoot when sliding along walls.
 */
export class PoseSender {
  private prevPos: Vec3 | null = null;
  private last?: { pose: LocalPose; t: number; moving: boolean };
  private teleportPending = false;
  private forcePending = false;
  /** calls made (tests / debug) */
  sends = 0;

  constructor(private readonly net: NetClient) {}

  /** the next pose is a discontinuity: remotes should snap */
  markTeleport() {
    this.teleportPending = true;
    this.forcePending = true;
    this.prevPos = null;
  }

  /** send on the next step regardless of the cadence (e.g. aim changed by a test hook) */
  forceNext() {
    this.forcePending = true;
  }

  /** forget the cadence state (death / respawn) */
  reset() {
    this.last = undefined;
    this.prevPos = null;
  }

  /** call after each fixed step; `t` = the step's time (ms), `dt` = step length (s) */
  step(p: PoseInput, t: number, dt: number) {
    const vel: Vec3 = this.prevPos && !this.teleportPending
      ? [(p.pos[0] - this.prevPos[0]) / dt, (p.pos[1] - this.prevPos[1]) / dt, (p.pos[2] - this.prevPos[2]) / dt]
      : [0, 0, 0];
    this.prevPos = [...p.pos];
    const hSpeed = Math.hypot(vel[0], vel[2]);
    // achieved motion only: a flickering grounded flag on a ledge must not cause sends
    const moving = hSpeed > IDLE_SPEED || Math.abs(vel[1]) > IDLE_SPEED;
    if (!moving) {
      vel[0] = vel[1] = vel[2] = 0;
    }
    // strictly increasing sender time (a forced send may share a step with a regular one)
    const sendT = this.last ? Math.max(t, this.last.pose.sendT + 1) : t;
    const pose: LocalPose = { ...p, pos: [...p.pos], vel, teleport: this.teleportPending, sendT };
    const l = this.last;
    const alone = (this.net.othersOnline?.() ?? 1) === 0;

    let send = this.forcePending || !l;
    if (!send && l) {
      const looked = Math.abs(l.pose.yaw - p.yaw) + Math.abs(l.pose.pitch - p.pitch) > LOOK_EPS;
      const since = sendT - l.t;
      const stopped = l.moving && !moving;
      if (alone) {
        send = stopped || (moving && since >= ALONE_SEND_MS - 1) || (looked && since >= ALONE_SEND_MS - 1) || l.pose.crouching !== p.crouching || !!l.pose.blocking !== !!p.blocking;
      } else {
        const discrete = stopped || (!l.moving && moving) || l.pose.crouching !== p.crouching || !!l.pose.blocking !== !!p.blocking || (l.pose.grounded !== p.grounded && (moving || l.moving));
        send = discrete || (moving && since >= MOVE_SEND_MS - 1) || (looked && since >= LOOK_SEND_MS - 1);
      }
    }
    if (!send) return;
    this.net.sendTransform(pose);
    this.sends++;
    this.last = { pose, t: sendT, moving };
    this.teleportPending = false;
    this.forcePending = false;
  }
}
