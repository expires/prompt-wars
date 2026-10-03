import * as THREE from 'three';

/**
 * Definition of a breakable, dynamic prop. `half` is the box collider half-extent (metres) and
 * the mesh is authored around the body origin (the collider centre), so `pos` is the body centre.
 */
export interface PropDef {
  kind: string;
  half: [number, number, number];
  /** kg — used to derive the collider density from the box volume */
  mass: number;
  /** damage needed to break it */
  hp: number;
  /** fragments spawned when it breaks */
  fragments: number;
  color: number;
  build(): THREE.Object3D;
}

function chair(): THREE.Object3D {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.85, flatShading: true });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), wood);
  seat.position.y = 0;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.07), wood);
  back.position.set(0, 0.3, -0.22);
  g.add(seat, back);
  for (const [lx, lz] of [
    [-0.22, -0.22],
    [0.22, -0.22],
    [-0.22, 0.22],
    [0.22, 0.22],
  ]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), wood);
    leg.position.set(lx, -0.29, lz);
    g.add(leg);
  }
  return g;
}

function crate(): THREE.Object3D {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0x9a7040, roughness: 0.9, flatShading: true }));
  g.add(box);
  return g;
}

function cone(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.7, 12), new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7 }));
  body.position.y = 0.05;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
  base.position.y = -0.33;
  g.add(body, base);
  return g;
}

function bottle(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 10), new THREE.MeshStandardMaterial({ color: 0x2a8a3a, roughness: 0.35 }));
  g.add(body);
  return g;
}

export const PROP_DEFS: Record<string, PropDef> = {
  chair: { kind: 'chair', half: [0.28, 0.55, 0.28], mass: 10, hp: 55, fragments: 6, color: 0x9a6a3a, build: chair },
  crate: { kind: 'crate', half: [0.4, 0.4, 0.4], mass: 28, hp: 120, fragments: 8, color: 0x9a7040, build: crate },
  cone: { kind: 'cone', half: [0.26, 0.37, 0.26], mass: 4, hp: 26, fragments: 4, color: 0xff6a1a, build: cone },
  bottle: { kind: 'bottle', half: [0.12, 0.25, 0.12], mass: 1.5, hp: 12, fragments: 3, color: 0x2a8a3a, build: bottle },
};

export interface PropSpawn {
  kind: keyof typeof PROP_DEFS;
  pos: [number, number, number];
  yaw?: number;
}

/** Scattered breakables for the procedural test map (floor at y=0). */
export const TEST_MAP_PROPS: PropSpawn[] = [
  { kind: 'chair', pos: [-4, 0.55, -4], yaw: 0.6 },
  { kind: 'chair', pos: [4.5, 0.55, -6], yaw: 1.4 },
  { kind: 'chair', pos: [-8, 0.55, 6], yaw: -0.5 },
  { kind: 'chair', pos: [9, 0.55, 8], yaw: 2.1 },
  { kind: 'chair', pos: [0.5, 0.55, 12], yaw: 0.2 },
  { kind: 'chair', pos: [-14, 0.55, -2], yaw: 3.0 },
  { kind: 'crate', pos: [-2, 0.4, 8], yaw: 0.3 },
  { kind: 'crate', pos: [13, 0.4, -10], yaw: 1.1 },
  { kind: 'cone', pos: [-6, 0.37, -14], yaw: 0 },
  { kind: 'cone', pos: [7, 0.37, 14], yaw: 0 },
  { kind: 'cone', pos: [-12, 0.37, 12], yaw: 0 },
  { kind: 'bottle', pos: [2, 0.25, -2], yaw: 0 },
  { kind: 'bottle', pos: [-3, 0.25, -1.5], yaw: 0 },
];
