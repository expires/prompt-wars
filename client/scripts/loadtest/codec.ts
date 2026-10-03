// Pose wire format adapter for the load test.
//   packed (current): reducer args are floats; the server publishes quantized rows to `pose`.
//   f32 (legacy, pre-coalescing modules): rows in `player_pose` with f32 columns.
export interface Pose {
  x: number; y: number; z: number; yaw: number; pitch: number;
  vx: number; vy: number; vz: number; flags: number; sendT: number;
}
export type PoseFields = Record<string, number>;
export const encodePose = (p: Pose) => p;
/** only slot + sendT are needed for the measurements (identical in both formats) */
export const decodePose = (r: PoseFields) => ({ slot: r.slot, sendT: r.sendT });
