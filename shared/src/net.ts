// SpacetimeDB connection defaults. Override in the client with VITE_SPACETIMEDB_HOST /
// VITE_SPACETIMEDB_DB_NAME (e.g. ws://localhost:3000 for a local `spacetime start`).
export const SPACETIME_MAINCLOUD_URI = 'wss://maincloud.spacetimedb.com';
export const SPACETIME_LOCAL_URI = 'ws://localhost:3000';
export const SPACETIME_DB_NAME = 'prompt-wars-63xhe';

/**
 * Spawn points (feet position + yaw facing the arena centre) for the procedural TEST MAP
 * (client/src/map/testMap.ts). The server seeds `spawn_point` with these.
 * Yaw convention: 0 faces -Z, yaw = atan2(dirX, dirZ) of the *backward* vector, i.e. facing
 * the centre from (x, z) is atan2(x, z).
 */
export const TEST_MAP_SPAWN_POINTS: readonly { x: number; y: number; z: number; yaw: number }[] = (
  [
    [0, 0.1, 8],
    [-12, 0.1, -8],
    [14, 0.1, 6],
    [20, 3.1, -16],
    [-20, 2.1, 15],
    [8, 0.1, -24],
    [-25, 0.1, 25],
    [25, 0.1, 25],
  ] as const
).map(([x, y, z]) => ({ x, y, z, yaw: Math.atan2(x, z) }));

// ---------------------------------------------------------------------------
// Pose netcode: rates + compact wire format (public `pose` table)
// ---------------------------------------------------------------------------

/** Pose send rate (Hz) while moving with someone nearby. */
export const POSE_SEND_HZ = 60;
/** Reduced rate: nobody near the sender, or a crowded server (see POSE_CROWD_THRESHOLD). */
export const POSE_SEND_HZ_REDUCED = 30;
/** With more than this many other players online everyone sends at POSE_SEND_HZ_REDUCED. */
export const POSE_CROWD_THRESHOLD = 24;
/** Senders with no other living player within this distance (m) use POSE_SEND_HZ_REDUCED. */
export const POSE_NEAR_DISTANCE = 60;
/**
 * Server-side coalescing: update_transform only writes the sender's private `pose_state` row; a
 * one-shot flush (scheduled by the first update after the previous flush, POSE_FLUSH_MS later)
 * copies every changed pose into the public `pose` table in ONE transaction. Subscribers get one
 * message per flush instead of one per sender (N x Hz messages/s instead of N^2 x Hz).
 */
export const POSE_FLUSH_MS = 15;

/** position quantum: 1 cm (i16 => +-327.67 m; maps are < 80 m from the origin) */
export const POSE_POS_SCALE = 100;
/** velocity quantum: 1 cm/s (i16 => +-327.67 m/s) */
export const POSE_VEL_SCALE = 100;
const TAU = Math.PI * 2;
/** yaw: u16 over a full turn (0.0055 deg) */
const YAW_SCALE = 65536 / TAU;
/** pitch: i16 over [-pi, pi] */
const PITCH_SCALE = 32767 / Math.PI;

/** A pose in floats (the reducer arguments / private pose_state / client-side snapshot). */
export interface PoseFloats {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vy: number;
  vz: number;
  /** POSE_FLAG_* */
  flags: number;
  /** sender's clock (ms, u32, wraps) */
  sendT: number;
}

/**
 * One row of the public `pose` table: 23 bytes BSATN (the old f32 `player_pose` row was 41).
 * Updates go out as delete + insert, so every update costs subscribers 2 rows.
 */
export interface PackedPose {
  /** u16 */
  slot: number;
  /** cm, i16 */
  x: number;
  y: number;
  z: number;
  /** u16, 0..65535 = 0..2pi */
  yaw: number;
  /** i16, +-32767 = +-pi */
  pitch: number;
  /** cm/s, i16 */
  vx: number;
  vy: number;
  vz: number;
  /** POSE_FLAG_* (u8) */
  flags: number;
  /** u32 */
  sendT: number;
}

const q16 = (v: number, scale: number) => {
  const q = Math.round(v * scale);
  return q > 32767 ? 32767 : q < -32767 ? -32767 : q || 0;
};

/** Quantize a float pose for the public table. */
export function packPose(slot: number, p: PoseFloats): PackedPose {
  let yaw = p.yaw % TAU;
  if (yaw < 0) yaw += TAU;
  return {
    slot: slot & 0xffff,
    x: q16(p.x, POSE_POS_SCALE),
    y: q16(p.y, POSE_POS_SCALE),
    z: q16(p.z, POSE_POS_SCALE),
    yaw: Math.round(yaw * YAW_SCALE) & 0xffff,
    pitch: q16(p.pitch, PITCH_SCALE),
    vx: q16(p.vx, POSE_VEL_SCALE),
    vy: q16(p.vy, POSE_VEL_SCALE),
    vz: q16(p.vz, POSE_VEL_SCALE),
    flags: p.flags & 0xff,
    sendT: p.sendT >>> 0,
  };
}

/** Floats from a public `pose` row. Yaw comes back in [-pi, pi). */
export function unpackPose(r: PackedPose): PoseFloats {
  let yaw = r.yaw / YAW_SCALE;
  if (yaw >= Math.PI) yaw -= TAU;
  return {
    x: r.x / POSE_POS_SCALE,
    y: r.y / POSE_POS_SCALE,
    z: r.z / POSE_POS_SCALE,
    yaw,
    pitch: r.pitch / PITCH_SCALE,
    vx: r.vx / POSE_VEL_SCALE,
    vy: r.vy / POSE_VEL_SCALE,
    vz: r.vz / POSE_VEL_SCALE,
    flags: r.flags,
    sendT: r.sendT,
  };
}

export function packedPoseEqual(a: PackedPose, b: PackedPose): boolean {
  return (
    a.sendT === b.sendT && a.flags === b.flags && a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw &&
    a.pitch === b.pitch && a.vx === b.vx && a.vy === b.vy && a.vz === b.vz
  );
}
