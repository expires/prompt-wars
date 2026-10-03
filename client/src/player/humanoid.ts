import * as THREE from 'three';

/**
 * Simple low-poly humanoid placeholder built from primitives (1.8m tall,
 * origin at the feet, facing -Z). Used for remote players and target dummies.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  /** pitches with aim; children: head + arms */
  readonly upper = new THREE.Group();
  /** attach a weapon model here (right hand, pointing -Z) */
  readonly hand = new THREE.Group();
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly limbMat: THREE.MeshStandardMaterial;
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private walkPhase = 0;

  constructor(color: THREE.ColorRepresentation = 0x3a7bd5) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7 });
    this.limbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b89a, flatShading: true });
    const visor = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // legs pivot at the hip
    const leg = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.9, 0);
      mk(new THREE.BoxGeometry(0.2, 0.88, 0.22), this.limbMat, 0, -0.45, 0, pivot);
      this.root.add(pivot);
      return pivot;
    };
    this.legL = leg(-0.13);
    this.legR = leg(0.13);

    mk(new THREE.BoxGeometry(0.5, 0.6, 0.28), this.bodyMat, 0, 1.2, 0, this.root); // torso

    this.upper.position.set(0, 1.45, 0);
    this.root.add(this.upper);
    mk(new THREE.BoxGeometry(0.28, 0.3, 0.28), skin, 0, 0.22, 0, this.upper); // head
    mk(new THREE.BoxGeometry(0.24, 0.08, 0.02), visor, 0, 0.25, -0.145, this.upper); // visor (shows facing)

    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, 0);
      mk(new THREE.BoxGeometry(0.14, 0.14, 0.55), this.limbMat, 0, -0.08, -0.25, pivot); // arms forward (aiming)
      this.upper.add(pivot);
      return pivot;
    };
    this.armL = arm(-0.3);
    arm(0.3);
    this.hand.position.set(0.22, -0.1, -0.45);
    this.upper.add(this.hand);
  }

  setColor(color: THREE.ColorRepresentation) {
    this.bodyMat.color.set(color);
    this.limbMat.color.set(color).multiplyScalar(0.6);
  }

  /** aim pitch in radians (positive = up) */
  setPitch(pitch: number) {
    this.upper.rotation.x = pitch;
  }

  /** animate legs based on horizontal speed (m/s) */
  animate(dt: number, speed: number) {
    this.walkPhase += dt * speed * 2.2;
    const a = Math.min(1, speed / 5) * 0.6 * Math.sin(this.walkPhase);
    this.legL.rotation.x = a;
    this.legR.rotation.x = -a;
    this.armL.rotation.x = -a * 0.2;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.bodyMat.dispose();
    this.limbMat.dispose();
  }
}
