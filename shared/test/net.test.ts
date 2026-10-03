import { describe, expect, it } from 'vitest';
import { POSE_FLAG_BLOCK, POSE_FLAG_CROUCH, packPose, packedPoseEqual, unpackPose, type PoseFloats } from '../src';

const pose = (o: Partial<PoseFloats> = {}): PoseFloats => ({
  x: 12.341,
  y: 3.1,
  z: -70.123,
  yaw: 1.234,
  pitch: -0.4,
  vx: 5.55,
  vy: -9.81,
  vz: 0.01,
  flags: POSE_FLAG_CROUCH | POSE_FLAG_BLOCK,
  sendT: 0xfffffff0,
  ...o,
});

describe('compact pose wire format', () => {
  it('round-trips within the quantum (1 cm, 1 cm/s, ~0.006 deg yaw)', () => {
    const p = pose();
    const q = packPose(7, p);
    const u = unpackPose(q);
    expect(q.slot).toBe(7);
    expect(Math.abs(u.x - p.x)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(u.y - p.y)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(u.z - p.z)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(u.vx - p.vx)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(u.vy - p.vy)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(u.yaw - p.yaw)).toBeLessThan(1e-4);
    expect(Math.abs(u.pitch - p.pitch)).toBeLessThan(1e-4);
    expect(u.flags).toBe(p.flags);
    expect(u.sendT).toBe(p.sendT);
  });

  it('fits the column types (i16 / u16 / u8 / u32) and clamps out-of-range values', () => {
    const q = packPose(70000, pose({ x: 1e4, y: -1e4, vx: 999, vz: -999, flags: 0x1ff, sendT: -1 }));
    expect(q.slot).toBe(70000 & 0xffff);
    expect(q.x).toBe(32767);
    expect(q.y).toBe(-32767);
    expect(q.vx).toBe(32767);
    expect(q.vz).toBe(-32767);
    expect(q.flags).toBe(0xff);
    expect(q.sendT).toBe(0xffffffff);
    for (const yaw of [-Math.PI, -0.001, 0, Math.PI - 1e-6, 7, -20]) {
      const y = packPose(1, pose({ yaw })).yaw;
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(0xffff);
      // same direction after the round trip
      const back = unpackPose(packPose(1, pose({ yaw }))).yaw;
      expect(Math.abs(Math.atan2(Math.sin(back - yaw), Math.cos(back - yaw)))).toBeLessThan(1e-4);
      expect(back).toBeGreaterThanOrEqual(-Math.PI);
      expect(back).toBeLessThan(Math.PI);
    }
    expect(Object.is(packPose(1, pose({ x: -0.001 })).x, -0)).toBe(false);
  });

  it('packedPoseEqual: equal after quantization, unequal on any field change', () => {
    const a = packPose(1, pose());
    expect(packedPoseEqual(a, packPose(1, pose({ x: 12.3438 })))).toBe(true);
    expect(packedPoseEqual(a, packPose(1, pose({ x: 12.36 })))).toBe(false);
    expect(packedPoseEqual(a, packPose(1, pose({ sendT: 1 })))).toBe(false);
    expect(packedPoseEqual(a, packPose(1, pose({ flags: 0 })))).toBe(false);
  });
});
