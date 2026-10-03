// Where sockets / bones sit on the procedural humanoid for given body proportions. Pure (no THREE):
// the client Humanoid, the outfit builder and the sanitizer all use these numbers, so armour,
// body meshes and hitboxes agree.
//
// Bone-local frames are in "standard body" units; the overall `size` is applied once, as a uniform
// scale of the whole character (root). build / head / limbs stretch individual sockets.

import type { BoneName, OutfitBody, SocketName } from './types';
import type { V3 } from '../forge/types';

export interface SocketFrame {
  bone: BoneName;
  /** socket origin in the bone frame */
  pos: V3;
  /** socket frame stretch (girth) */
  scale: V3;
}

/** Bone joint offsets (child relative to parent) for a body. */
export interface BoneLayout {
  /** hips above the feet (standing) */
  hipsY: number;
  /** upper body (shoulder line, pitches with aim) above the hips */
  upperY: number;
  /** arm pivots: +-x on the upper body */
  armX: number;
  /** thigh pivots: +-x on the hips */
  thighX: number;
  /** knee below the hip */
  kneeY: number;
  /** girth multiplier of the arms */
  armGirth: number;
}

export function boneLayout(b: OutfitBody): BoneLayout {
  return { hipsY: 0.9, upperY: 0.55, armX: 0.3 * b.build, thighX: 0.13 * b.build, kneeY: -0.45, armGirth: (1 + b.build) / 2 };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function socketFrame(socket: SocketName, b: OutfitBody): SocketFrame {
  const L = boneLayout(b);
  const g = L.armGirth;
  const h = b.head;
  const w = b.build;
  const l = b.limbs;
  const side = socket.endsWith('L') ? -1 : 1;
  let f: SocketFrame;
  switch (socket) {
    case 'head': f = { bone: 'upper', pos: [0, 0.06 + 0.15 * h, 0], scale: [h, h, h] }; break;
    case 'face': f = { bone: 'upper', pos: [0, 0.06 + 0.18 * h, -0.14 * h], scale: [h, h, h] }; break;
    case 'torso': f = { bone: 'hips', pos: [0, 0.3, 0], scale: [w, 1, w] }; break;
    case 'back': f = { bone: 'hips', pos: [0, 0.35, 0.14 * w], scale: [w, 1, w] }; break;
    case 'belt': f = { bone: 'hips', pos: [0, 0.02, 0], scale: [w, 1, w] }; break;
    case 'shoulderL':
    case 'shoulderR': f = { bone: 'upper', pos: [side * L.armX, 0.03, 0], scale: [g, g, g] }; break;
    case 'armL':
    case 'armR': f = { bone: socket === 'armL' ? 'armL' : 'armR', pos: [0, -0.08, -0.25 * l], scale: [g, g, l] }; break;
    case 'handL':
    case 'handR': f = { bone: socket === 'handL' ? 'armL' : 'armR', pos: [0, -0.08, -0.5 * l], scale: [g, g, g] }; break;
    case 'thighL':
    case 'thighR': f = { bone: socket === 'thighL' ? 'thighL' : 'thighR', pos: [0, -0.225, 0], scale: [w, 1, w] }; break;
    case 'shinL':
    case 'shinR': f = { bone: socket === 'shinL' ? 'shinL' : 'shinR', pos: [0, -0.215, 0], scale: [w, 1, w] }; break;
    case 'footL':
    case 'footR': f = { bone: socket === 'footL' ? 'shinL' : 'shinR', pos: [0, -0.4, -0.05], scale: [w, 1, w] }; break;
  }
  return { bone: f.bone, pos: f.pos.map(r4) as V3, scale: f.scale.map(r4) as V3 };
}
