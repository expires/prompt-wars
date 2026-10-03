import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d';
import type { PhysicsContext } from '../engine/physics';
import { TEST_MAP_SPAWN_POINTS } from '@ai-gaem/shared';
import type { GameMap, Vec3 } from './types';

/**
 * Procedural TEST MAP used until the venue scan exists.
 * Every piece is an (optionally rotated) box: the visual mesh and the Rapier
 * cuboid collider are built from the same definition so they always match.
 *
 * Layout (60x60m arena, +Y up):
 *  - perimeter walls 5m tall
 *  - mezzanine at y=3 (NE quadrant) reached by a 15-step staircase (0.2m risers)
 *  - raised block at y=2 (SW) reached by an ~18deg ramp; a 50deg wedge (too steep)
 *  - crates for cover
 */
interface BoxDef {
  size: Vec3;
  pos: Vec3; // center
  rotZ?: number;
  rotX?: number;
  color: number;
  /** skip shadows for huge pieces */
  noCast?: boolean;
}

const HALF = 30;
const WALL_H = 5;
const MEZZ_Y = 3;
const STEP_H = 0.2;
const STEP_D = 0.3;

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7d8590';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#6c737d';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  g.strokeStyle = '#5a6068';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 8;
  return t;
}

function buildDefs(): BoxDef[] {
  const defs: BoxDef[] = [];
  // floor (top at y=0)
  defs.push({ size: [HALF * 2, 1, HALF * 2], pos: [0, -0.5, 0], color: 0xffffff, noCast: true });
  // perimeter walls
  const t = 1;
  defs.push({ size: [HALF * 2 + t * 2, WALL_H, t], pos: [0, WALL_H / 2, -HALF - t / 2], color: 0xb8a990 });
  defs.push({ size: [HALF * 2 + t * 2, WALL_H, t], pos: [0, WALL_H / 2, HALF + t / 2], color: 0xb8a990 });
  defs.push({ size: [t, WALL_H, HALF * 2], pos: [-HALF - t / 2, WALL_H / 2, 0], color: 0xa89a82 });
  defs.push({ size: [t, WALL_H, HALF * 2], pos: [HALF + t / 2, WALL_H / 2, 0], color: 0xa89a82 });

  // ---- mezzanine (x 10..29, z -29..-10), deck top at MEZZ_Y ----
  const mx0 = 10, mx1 = HALF - 1, mz0 = -HALF + 1, mz1 = -10;
  const deckT = 0.3;
  defs.push({
    size: [mx1 - mx0, deckT, mz1 - mz0],
    pos: [(mx0 + mx1) / 2, MEZZ_Y - deckT / 2, (mz0 + mz1) / 2],
    color: 0x8a6a4a,
  });
  // pillars
  for (const [px, pz] of [[mx0 + 0.4, mz1 - 0.4], [mx1 - 0.4, mz1 - 0.4], [mx0 + 0.4, mz0 + 0.4], [(mx0 + mx1) / 2, mz1 - 0.4]]) {
    defs.push({ size: [0.5, MEZZ_Y - deckT, 0.5], pos: [px, (MEZZ_Y - deckT) / 2, pz], color: 0x666a70 });
  }
  // railings (low walls) along the open edges, leaving a gap where the stairs arrive
  const railH = 1;
  defs.push({ size: [mx1 - mx0, railH, 0.15], pos: [(mx0 + mx1) / 2, MEZZ_Y + railH / 2, mz1 - 0.075], color: 0x5a4a3a });
  // west rail split around the stair landing (z -14.5..-11.5)
  defs.push({ size: [0.15, railH, -14.5 - mz0], pos: [mx0 + 0.075, MEZZ_Y + railH / 2, (mz0 - 14.5) / 2], color: 0x5a4a3a });
  defs.push({ size: [0.15, railH, mz1 - -11.5], pos: [mx0 + 0.075, MEZZ_Y + railH / 2, (-11.5 + mz1) / 2], color: 0x5a4a3a });
  // a crate on the mezzanine
  defs.push({ size: [1.2, 1.2, 1.2], pos: [20, MEZZ_Y + 0.6, -20], color: 0x9a7040 });

  // ---- staircase: solid steps rising toward +x, ending flush with the deck at x=mx0 ----
  const steps = Math.round(MEZZ_Y / STEP_H); // 15
  const sx0 = mx0 - steps * STEP_D;
  const sz0 = -14.5, sz1 = -11.5;
  for (let i = 0; i < steps; i++) {
    const top = (i + 1) * STEP_H;
    defs.push({
      size: [STEP_D, top, sz1 - sz0],
      pos: [sx0 + (i + 0.5) * STEP_D, top / 2, (sz0 + sz1) / 2],
      color: i % 2 ? 0x9a9ea6 : 0x8a8e96,
    });
  }

  // ---- raised block (SW) reached by a ramp ----
  const bH = 2;
  const bx0 = -HALF + 1, bx1 = -14, bz0 = 8, bz1 = 22;
  defs.push({ size: [bx1 - bx0, bH, bz1 - bz0], pos: [(bx0 + bx1) / 2, bH / 2, (bz0 + bz1) / 2], color: 0x7a8a6a });
  // ramp: from (x=-8, y=0) up to (x=bx1, y=bH), width 4 (z 12..16)
  {
    const run = 6, rise = bH, th = 0.3;
    const theta = Math.atan2(rise, run);
    const len = Math.hypot(run, rise) + 0.2;
    const midX = bx1 + run / 2, midY = rise / 2;
    // ramp rises toward -x => rotate by -theta about Z; offset center down along its normal
    const nx = Math.sin(theta), ny = Math.cos(theta);
    defs.push({ size: [len, th, 4], pos: [midX - (nx * th) / 2, midY - (ny * th) / 2, 14], rotZ: -theta, color: 0xa08060 });
  }
  // too-steep wedge (50deg) against the block's south face, to test max slope
  {
    const theta = (50 * Math.PI) / 180, th = 0.3, rise = bH, run = rise / Math.tan(theta);
    const len = Math.hypot(run, rise);
    const nz = Math.sin(theta), ny = Math.cos(theta);
    // rises toward +z (toward block face at z=bz0) => rotate about X by -theta
    defs.push({
      size: [3, th, len],
      pos: [-22, rise / 2 - (ny * th) / 2, bz0 - run / 2 + (nz * th) / 2],
      rotX: -theta,
      color: 0xc05050,
    });
  }

  // ---- cover crates ----
  const crates: [number, number, number, number][] = [
    // x, z, size, height
    [0, 0, 2, 1.2],
    [-5, -6, 1.5, 1.5],
    [6, 5, 1.2, 1.2],
    [-10, -15, 3, 2.5],
    [12, 12, 2, 1],
    [18, 2, 1.5, 3],
    [-3, 14, 4, 1.2],
    [3, -18, 2.5, 1.8],
    [-18, -2, 1.2, 1.2],
    [24, 18, 2, 2],
    [-24, -22, 2, 1.5],
  ];
  for (const [x, z, s, h] of crates) defs.push({ size: [s, h, s], pos: [x, h / 2, z], color: 0x9a7040 });
  // a low step-up crate (0.35m) and a too-high ledge (0.6m) to test autostep
  defs.push({ size: [2, 0.35, 2], pos: [-6, 0.175, 4], color: 0x6080a0 });
  defs.push({ size: [2, 0.6, 2], pos: [-9, 0.3, 4], color: 0xa06080 });
  return defs;
}

/** feet positions; shared with the server's spawn_point seeding (@ai-gaem/shared TEST_MAP_SPAWN_POINTS) */
export const TEST_MAP_SPAWNS: Vec3[] = TEST_MAP_SPAWN_POINTS.map((p) => [p.x, p.y, p.z] as Vec3);

export function createTestMap(physics: PhysicsContext, scene: THREE.Scene): GameMap {
  const { RAPIER, world } = physics;
  const root = new THREE.Group();
  root.name = 'testMap';
  const colliders: RAPIER.Collider[] = [];
  const mats = new Map<number, THREE.Material>();
  const floorTex = checkerTexture();
  floorTex.repeat.set(HALF, HALF);

  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const d of buildDefs()) {
    const geo = new THREE.BoxGeometry(...d.size);
    let mat = mats.get(d.color);
    if (!mat) {
      mat = d.noCast
        ? new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 })
        : new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.8, flatShading: true });
      mats.set(d.color, mat);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...d.pos);
    e.set(d.rotX ?? 0, 0, d.rotZ ?? 0);
    mesh.quaternion.setFromEuler(e);
    mesh.castShadow = !d.noCast;
    mesh.receiveShadow = true;
    root.add(mesh);

    q.setFromEuler(e);
    const desc = RAPIER.ColliderDesc.cuboid(d.size[0] / 2, d.size[1] / 2, d.size[2] / 2)
      .setTranslation(...d.pos)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    colliders.push(world.createCollider(desc));
  }
  scene.add(root);

  return {
    id: 'testmap',
    root,
    colliders,
    spawns: TEST_MAP_SPAWNS,
    killY: -30,
    dispose() {
      scene.remove(root);
      colliders.forEach((c) => world.removeCollider(c, false));
    },
  };
}
