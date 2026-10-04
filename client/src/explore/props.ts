import * as THREE from 'three';

/**
 * Procedural props for the explorer, built from primitives (no model files): landmark beacons,
 * the guide's footprint trail, and the Kraków curiosities (dragon, pigeons, Lajkonik...).
 * Each `make*` returns an Object3D whose origin sits on the ground.
 */

const std = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** soft round glow (for sprites / particles) */
function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ beacons

/** fades a light column out towards its top */
function columnTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

export class Beacon {
  readonly root = new THREE.Group();
  private readonly column: THREE.Mesh;
  private readonly gem: THREE.Mesh;
  private readonly colMat: THREE.MeshBasicMaterial;
  private t = Math.random() * 10;

  constructor(top: THREE.Vector3, groundY: number) {
    const height = Math.max(30, top.y - groundY + 25);
    this.colMat = new THREE.MeshBasicMaterial({
      color: 0xffc94a,
      map: columnTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, height, 16, 1, true), this.colMat);
    this.column.position.set(top.x, groundY + height / 2, top.z);
    this.gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.4),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, fog: false }),
    );
    this.gem.position.set(top.x, top.y + 4, top.z);
    this.root.add(this.column, this.gem);
    this.root.renderOrder = 2;
  }

  /** target = the guide is heading here (brighter, blue-white), calm = no pulsing */
  update(dt: number, target: boolean, calm: boolean) {
    this.t += dt;
    const pulse = calm ? 0 : Math.sin(this.t * 2.4) * 0.5 + 0.5;
    this.colMat.color.setHex(target ? 0x8fe3ff : 0xffc94a);
    this.colMat.opacity = target ? 0.65 + 0.25 * pulse : 0.4;
    this.gem.rotation.y += dt * (calm ? 0.3 : 1.2);
    this.gem.position.y += calm ? 0 : Math.sin(this.t * 1.6) * 0.004;
    (this.gem.material as THREE.MeshBasicMaterial).color.setHex(target ? 0xbff0ff : 0xffe08a);
  }
}

// ------------------------------------------------------------------ guide trail

const TRAIL_MAX = 160;
const TRAIL_SPACING = 1.6;

/** glowing footprints along the guide's route; a brighter wave runs towards the target */
export class Trail {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private t = 0;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

  constructor() {
    const geo = new THREE.CircleGeometry(0.28, 16).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, TRAIL_MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /** lay dots along a polyline starting at the player (points are [x, y, z] on the floor) */
  set(points: [number, number, number][] | null) {
    let n = 0;
    if (points && points.length > 1) {
      let carry = TRAIL_SPACING * 0.75;
      for (let i = 0; i < points.length - 1 && n < TRAIL_MAX; i++) {
        const [ax, ay, az] = points[i];
        const [bx, by, bz] = points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        let s = carry;
        while (s < len && n < TRAIL_MAX) {
          const k = s / len;
          this.m.makeTranslation(ax + (bx - ax) * k, ay + (by - ay) * k + 0.06, az + (bz - az) * k);
          this.mesh.setMatrixAt(n++, this.m);
          s += TRAIL_SPACING;
        }
        carry = s - len;
      }
    }
    this.count = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, calm: boolean) {
    this.t += dt;
    for (let i = 0; i < this.count; i++) {
      const wave = calm ? 0.5 : Math.max(0, Math.sin(i * 0.35 - this.t * 4)) ** 4;
      const fade = 1 - i / TRAIL_MAX;
      this.c.setRGB(0.45 + 0.55 * wave, 0.85 + 0.15 * wave, 1).multiplyScalar(0.55 + 0.45 * fade);
      this.mesh.setColorAt(i, this.c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the Wawel dragon

export class Dragon {
  readonly root = new THREE.Group();
  /** fire comes out of here (world position updated each frame) */
  readonly mouth = new THREE.Object3D();
  private readonly body = new THREE.Group();
  private readonly fire: THREE.Points;
  private readonly firePos: Float32Array;
  private readonly fireVel: Float32Array;
  private readonly fireLife: Float32Array;
  private readonly smoke: THREE.Points;
  private readonly smokePos: Float32Array;
  private readonly smokeVel: Float32Array;
  private readonly smokeLife: Float32Array;
  private breathing = 0;
  private t = 0;
  /** 1 = present, 0 = burst (legends come back) */
  presence = 1;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor() {
    const bronze = std(0x3e6a4a, { metalness: 0.55, roughness: 0.38 });
    const dark = std(0x2a4a35, { metalness: 0.5, roughness: 0.45 });
    const b = this.body;
    // body + belly
    const torso = mesh(new THREE.SphereGeometry(1.4, 20, 14), bronze, 0, 2.2, 0);
    torso.scale.set(1.5, 1, 1);
    b.add(torso);
    // legs
    for (const [x, z] of [[1, 0.8], [1, -0.8], [-1.1, 0.8], [-1.1, -0.8]]) {
      const leg = mesh(new THREE.CylinderGeometry(0.28, 0.38, 1.6, 10), dark, x, 0.8, z);
      leg.rotation.z = x > 0 ? -0.15 : 0.15;
      b.add(leg, mesh(new THREE.SphereGeometry(0.42, 10, 8), dark, x * 1.08, 0.12, z));
    }
    // neck: a chain of spheres curving up and forward (+x)
    for (let i = 0; i < 6; i++) {
      const k = i / 5;
      b.add(mesh(new THREE.SphereGeometry(0.62 - 0.18 * k, 12, 10), bronze, 1.8 + k * 1.3, 2.8 + k * 2.4, 0));
    }
    // head + snout + horns + eyes
    const head = new THREE.Group();
    head.position.set(3.4, 5.4, 0);
    head.rotation.z = -0.35;
    head.add(mesh(new THREE.BoxGeometry(1.2, 0.8, 0.9), bronze));
    const snout = mesh(new THREE.BoxGeometry(1.1, 0.5, 0.7), bronze, 0.95, -0.12, 0);
    head.add(snout);
    for (const z of [-0.3, 0.3]) {
      const horn = mesh(new THREE.ConeGeometry(0.13, 0.9, 8), dark, -0.35, 0.7, z);
      horn.rotation.z = 0.6;
      head.add(horn, mesh(new THREE.SphereGeometry(0.1, 8, 6), std(0xffb020, { emissive: 0xff8000, emissiveIntensity: 1.2 }), 0.35, 0.18, z * 1.5));
    }
    this.mouth.position.set(1.6, -0.15, 0);
    head.add(this.mouth);
    b.add(head);
    // spikes along the back
    for (let i = 0; i < 7; i++) {
      const spike = mesh(new THREE.ConeGeometry(0.18, 0.6, 6), dark, 1.4 - i * 0.55, 3.35 - Math.abs(i - 2) * 0.08, 0);
      b.add(spike);
    }
    // tail: tapering cones curling back (-x)
    for (let i = 0; i < 8; i++) {
      const k = i / 7;
      const seg = mesh(new THREE.SphereGeometry(0.55 - 0.45 * k, 10, 8), bronze, -2 - k * 3.2, 1.9 - k * 1.5 + Math.sin(k * 3) * 0.3, Math.sin(k * 4) * 0.8);
      b.add(seg);
    }
    // wings: two triangles fanned up
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1.8, 2.8, 0, 1.2, 2.2, 0, 0, 0, 0, -1.8, 2.8, 0, -2.6, 0.6, 0], 3));
    wingGeo.computeVertexNormals();
    const wingMat = std(0x2f5a3c, { metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const w = mesh(wingGeo, wingMat, 0.2, 3, s * 0.9);
      w.rotation.x = s * -0.5;
      w.scale.set(1.3, 1.3, 1.3);
      b.add(w);
    }
    this.root.add(b);

    // fire + smoke particles
    const N = 90;
    this.firePos = new Float32Array(N * 3);
    this.fireVel = new Float32Array(N * 3);
    this.fireLife = new Float32Array(N);
    const fireGeo = new THREE.BufferGeometry();
    fireGeo.setAttribute('position', new THREE.BufferAttribute(this.firePos, 3));
    this.fire = new THREE.Points(
      fireGeo,
      new THREE.PointsMaterial({
        size: 1.2,
        map: glowTexture('rgba(255,210,120,1)', 'rgba(255,70,0,0)'),
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.fire.frustumCulled = false;
    const S = 40;
    this.smokePos = new Float32Array(S * 3);
    this.smokeVel = new Float32Array(S * 3);
    this.smokeLife = new Float32Array(S);
    const smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    this.smoke = new THREE.Points(
      smokeGeo,
      new THREE.PointsMaterial({ size: 3, map: glowTexture('rgba(200,200,200,0.7)', 'rgba(120,120,120,0)'), transparent: true, depthWrite: false }),
    );
    this.smoke.frustumCulled = false;
    for (let i = 0; i < N; i++) this.firePos[i * 3 + 1] = -1e4;
    for (let i = 0; i < S; i++) this.smokePos[i * 3 + 1] = -1e4;
  }

  /** particles live in world space: add these to the scene, not to `root` */
  get effects(): THREE.Object3D[] {
    return [this.fire, this.smoke];
  }

  breathe(seconds = 1.6) {
    this.breathing = seconds;
  }

  /** a puff of smoke at the dragon (the burst) */
  puff() {
    const c = this.root.getWorldPosition(this.tmp);
    for (let i = 0; i < this.smokeLife.length; i++) {
      this.smokePos.set([c.x + (Math.random() - 0.5) * 3, c.y + 2 + Math.random() * 2, c.z + (Math.random() - 0.5) * 3], i * 3);
      this.smokeVel.set([(Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6], i * 3);
      this.smokeLife[i] = 1.5 + Math.random() * 1.5;
    }
  }

  update(dt: number) {
    this.t += dt;
    // idle: slow breathing sway
    this.body.position.y = Math.sin(this.t * 1.3) * 0.05;
    this.body.scale.setScalar(Math.max(0.001, this.presence));
    this.root.updateMatrixWorld(true);
    // emit fire
    if (this.breathing > 0 && this.presence > 0.9) {
      this.breathing -= dt;
      const m = this.mouth.getWorldPosition(this.tmp);
      this.dir.set(1, -0.25, 0).applyQuaternion(this.root.quaternion).normalize();
      const n = this.fireLife.length;
      for (let k = 0, emitted = 0; k < n && emitted < 3; k++) {
        if (this.fireLife[k] > 0) continue;
        emitted++;
        this.firePos.set([m.x, m.y, m.z], k * 3);
        const sp = 9 + Math.random() * 4;
        this.fireVel.set([this.dir.x * sp + (Math.random() - 0.5) * 2, this.dir.y * sp + Math.random() * 1.5, this.dir.z * sp + (Math.random() - 0.5) * 2], k * 3);
        this.fireLife[k] = 0.55 + Math.random() * 0.25;
      }
    }
    step(this.firePos, this.fireVel, this.fireLife, dt, 1.2);
    step(this.smokePos, this.smokeVel, this.smokeLife, dt, -0.5);
    this.fire.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.position.needsUpdate = true;
  }
}

/** integrate particles; dead ones are parked far below the world */
function step(pos: Float32Array, vel: Float32Array, life: Float32Array, dt: number, lift: number) {
  for (let i = 0; i < life.length; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    if (life[i] <= 0) {
      pos[i * 3 + 1] = -1e4;
      continue;
    }
    vel[i * 3 + 1] += lift * dt;
    pos[i * 3] += vel[i * 3] * dt;
    pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
  }
}

// ------------------------------------------------------------------ pigeons

interface Bird {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  phase: number;
}

/** a flock pecking at the cobbles; they burst into the air when you walk through them */
export class Pigeons {
  readonly mesh: THREE.InstancedMesh;
  private readonly birds: Bird[] = [];
  private flying = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly e = new THREE.Euler();

  constructor(center: THREE.Vector3, count = 26) {
    // one merged pigeon: body, head, tail
    const body = new THREE.SphereGeometry(0.13, 10, 8).scale(1.6, 1, 1);
    const head = new THREE.SphereGeometry(0.075, 8, 6).translate(0.2, 0.1, 0);
    const tail = new THREE.ConeGeometry(0.07, 0.2, 6).rotateZ(Math.PI / 2).translate(-0.27, 0.02, 0);
    const geo = mergeGeos([body, head, tail]);
    this.mesh = new THREE.InstancedMesh(geo, std(0x8a8f9a, { roughness: 0.9 }), count);
    this.mesh.castShadow = true;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 3.2;
      const home = new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.14, center.z + Math.sin(a) * r);
      this.birds.push({ home, pos: home.clone(), vel: new THREE.Vector3(), yaw: Math.random() * 6.3, phase: Math.random() * 10 });
    }
  }

  get airborne() {
    return this.flying > 0;
  }

  scatter(from: THREE.Vector3) {
    if (this.flying > 0) return;
    this.flying = 9;
    for (const b of this.birds) {
      const away = b.pos.clone().sub(from).setY(0).normalize();
      b.vel.set(away.x * (4 + Math.random() * 3), 5 + Math.random() * 3, away.z * (4 + Math.random() * 3));
    }
  }

  update(dt: number) {
    this.flying = Math.max(0, this.flying - dt);
    this.birds.forEach((b, i) => {
      b.phase += dt;
      if (this.flying > 3) {
        b.vel.y -= 2 * dt;
        b.pos.addScaledVector(b.vel, dt);
        b.yaw = Math.atan2(-b.vel.z, b.vel.x);
        this.s.set(1, 0.6 + Math.abs(Math.sin(b.phase * 28)) * 0.6, 1);
      } else if (this.flying > 0 || b.pos.distanceToSquared(b.home) > 0.01) {
        // glide home
        const k = 1 - Math.exp(-dt * 1.4);
        b.pos.lerp(b.home, k);
        this.s.set(1, 1, 1);
      } else {
        // peck about
        b.pos.y = b.home.y + Math.max(0, Math.sin(b.phase * 3.1)) * 0.015;
        if (Math.random() < dt * 0.3) b.yaw += (Math.random() - 0.5) * 2;
        this.s.set(1, 1, 1);
      }
      const peck = this.flying <= 0 ? Math.max(0, Math.sin(b.phase * 5)) * 0.5 : 0;
      this.q.setFromEuler(this.e.set(0, b.yaw, -peck));
      this.m.compose(b.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.attributes.position.array as Float32Array));
    nor.push(...(ng.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

// ------------------------------------------------------------------ small curiosities

/** the knife on a chain: origin at the ceiling hook */
export function makeKnife(chainLength: number): THREE.Group {
  const g = new THREE.Group();
  const iron = std(0x6b6e74, { metalness: 0.8, roughness: 0.35 });
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, chainLength, 6), iron, 0, -chainLength / 2, 0));
  const knife = new THREE.Group();
  knife.position.y = -chainLength;
  // blade: a long tapered wedge pointing down
  const blade = mesh(new THREE.CylinderGeometry(0.09, 0.005, 0.85, 4, 1), std(0xb9bcc2, { metalness: 0.9, roughness: 0.25 }), 0, -0.62, 0);
  blade.scale.set(1, 1, 0.18);
  knife.add(blade, mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 8), std(0x4a2e1a), 0, -0.05, 0), mesh(new THREE.BoxGeometry(0.24, 0.04, 0.06), iron, 0, -0.2, 0));
  g.add(knife);
  return g;
}

/** the Lajkonik: a bearded "Tatar" rider in a hobby-horse costume */
export function makeLajkonik(): THREE.Group {
  const g = new THREE.Group();
  const robe = std(0xb3262e, { roughness: 0.6 });
  const gold = std(0xe2b33c, { metalness: 0.6, roughness: 0.35 });
  const white = std(0xf1ece2);
  // the "horse": a skirt around the rider's waist + head and tail
  g.add(mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.7, 20), white, 0, 0.75, 0));
  const neck = mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 10), white, 0.85, 1.25, 0);
  neck.rotation.z = -0.5;
  g.add(neck, mesh(new THREE.BoxGeometry(0.5, 0.26, 0.24), white, 1.15, 1.6, 0));
  g.add(mesh(new THREE.ConeGeometry(0.12, 0.7, 8), std(0x3a2a1c), -0.95, 0.9, 0));
  // jewelled trim
  g.add(mesh(new THREE.TorusGeometry(0.88, 0.04, 6, 32).rotateX(Math.PI / 2), gold, 0, 1.08, 0));
  // rider
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.9, 12), robe, 0, 1.45, 0));
  g.add(mesh(new THREE.SphereGeometry(0.2, 12, 10), std(0xe7b996), 0, 2.08, 0));
  g.add(mesh(new THREE.ConeGeometry(0.16, 0.32, 10), std(0x5a3a22), 0.1, 1.9, 0)); // beard
  g.add(mesh(new THREE.ConeGeometry(0.24, 0.6, 12), gold, 0, 2.5, 0)); // tall pointed hat
  g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0xff3040), 0, 2.82, 0));
  // mace
  const mace = new THREE.Group();
  mace.position.set(0.3, 1.6, 0.35);
  mace.rotation.z = -0.9;
  mace.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), std(0x4a2e1a), 0, 0.35, 0), mesh(new THREE.SphereGeometry(0.1, 10, 8), gold, 0, 0.72, 0));
  mace.name = 'mace';
  g.add(mace);
  return g;
}

/** a blue obwarzanek cart with rings stacked on poles */
export function makeCart(): THREE.Group {
  const g = new THREE.Group();
  const blue = std(0x2f6bd0, { roughness: 0.5 });
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.7, 0.8), blue, 0, 0.75, 0));
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.5, 0.8), std(0xd8ecff, { transparent: true, opacity: 0.35, roughness: 0.1 }), 0, 1.35, 0));
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.05, 0.9), blue, 0, 1.62, 0));
  for (const x of [-0.55, 0.55]) g.add(mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 16), std(0x222222), x, 0.3, 0.45));
  const bread = std(0xc98a3d, { roughness: 0.8 });
  const ring = new THREE.TorusGeometry(0.14, 0.05, 8, 18);
  for (let p = 0; p < 3; p++) {
    for (let i = 0; i < 4; i++) {
      const r = mesh(ring, bread, -0.45 + p * 0.45, 1.18 + i * 0.07, 0);
      r.rotation.x = Math.PI / 2;
      g.add(r);
    }
  }
  return g;
}

export function makeSheep(): THREE.Group {
  const g = new THREE.Group();
  const wool = std(0xf3f0e8, { roughness: 1 });
  for (const [x, y, z, r] of [[0, 0.75, 0, 0.45], [0.3, 0.8, 0.12, 0.33], [-0.3, 0.8, -0.1, 0.35], [0.05, 0.98, 0, 0.32], [-0.15, 0.7, 0.2, 0.3]]) {
    g.add(mesh(new THREE.SphereGeometry(r, 12, 10), wool, x, y, z));
  }
  const black = std(0x1d1d1d);
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.26, 0.22), black, 0.62, 0.92, 0));
  for (const [x, z] of [[0.3, 0.18], [0.3, -0.18], [-0.3, 0.18], [-0.3, -0.18]]) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), black, x, 0.25, z));
  return g;
}

/** "dragon bones" hanging on chains from a wooden frame */
export function makeBones(): THREE.Group {
  const g = new THREE.Group();
  const wood = std(0x5b3d24);
  for (const x of [-1.3, 1.3]) g.add(mesh(new THREE.BoxGeometry(0.2, 3.6, 0.2), wood, x, 1.8, 0));
  g.add(mesh(new THREE.BoxGeometry(2.9, 0.22, 0.22), wood, 0, 3.6, 0));
  const bone = std(0xe4dcc5, { roughness: 0.9 });
  const chain = std(0x555555, { metalness: 0.7 });
  // a long rib
  const rib = mesh(new THREE.TorusGeometry(1, 0.08, 8, 20, Math.PI * 0.8), bone, -0.6, 1.9, 0);
  rib.rotation.z = Math.PI * 0.6;
  g.add(rib, mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 4), chain, -0.6, 3.25, 0));
  // a thigh bone with knobbly ends
  const thigh = new THREE.Group();
  thigh.position.set(0.7, 2.3, 0);
  thigh.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 8), bone), mesh(new THREE.SphereGeometry(0.2, 10, 8), bone, 0, 0.72, 0), mesh(new THREE.SphereGeometry(0.22, 10, 8), bone, 0, -0.72, 0));
  g.add(thigh, mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), chain, 0.7, 3.3, 0));
  return g;
}

/** a bronze bell on a wooden frame; `swing(t)` rocks it */
export function makeBell(): THREE.Group {
  const g = new THREE.Group();
  const wood = std(0x5b3d24);
  for (const x of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.2, 3.2, 0.2), wood, x, 1.6, 0));
  g.add(mesh(new THREE.BoxGeometry(2.3, 0.22, 0.25), wood, 0, 3.15, 0));
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const k = i / 12;
    pts.push(new THREE.Vector2(0.18 + 0.55 * k ** 2.2 + 0.1 * k, -k * 1.1));
  }
  const bell = new THREE.Group();
  bell.name = 'bell';
  bell.position.y = 3;
  bell.add(mesh(new THREE.LatheGeometry(pts, 32), std(0xa67c3a, { metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide })));
  bell.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), std(0x5a4a33, { metalness: 0.8 }), 0, -1.05, 0));
  g.add(bell);
  return g;
}

/** Copernicus's armillary sphere on a stone pedestal; spin it via the `rings` child */
export function makeArmillary(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 1, 12), std(0xb8b2a4), 0, 0.5, 0));
  const brass = std(0xc9a14a, { metalness: 0.85, roughness: 0.3 });
  const rings = new THREE.Group();
  rings.name = 'rings';
  rings.position.y = 1.65;
  for (let i = 0; i < 4; i++) {
    const r = mesh(new THREE.TorusGeometry(0.55 - i * 0.04, 0.02, 6, 40), brass);
    r.rotation.set(i * 0.7, i * 1.1, i * 0.4);
    rings.add(r);
  }
  rings.add(mesh(new THREE.SphereGeometry(0.12, 16, 12), std(0xffc93c, { emissive: 0xff9a00, emissiveIntensity: 0.9 })));
  g.add(rings);
  return g;
}

/** a soft glow on a wall (the chakra stone) */
export function makeGlow(color: number, size: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  s.scale.setScalar(size);
  return s;
}

/** the Pope's Window: a warmly lit window frame with a little papal-yellow drape */
export function makeWindow(): THREE.Group {
  const g = new THREE.Group();
  const frame = std(0xf2ead8);
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.12, 0.15), frame, 0, 0.95, 0), mesh(new THREE.BoxGeometry(1.4, 0.12, 0.15), frame, 0, -0.95, 0));
  g.add(mesh(new THREE.BoxGeometry(0.12, 2, 0.15), frame, -0.65, 0, 0), mesh(new THREE.BoxGeometry(0.12, 2, 0.15), frame, 0.65, 0, 0));
  g.add(mesh(new THREE.PlaneGeometry(1.2, 1.8), new THREE.MeshBasicMaterial({ color: 0xffd98a }), 0, 0, -0.02));
  const drape = mesh(new THREE.PlaneGeometry(1.1, 0.5), std(0xf5c400, { side: THREE.DoubleSide }), 0, -1.2, 0.09);
  drape.rotation.x = -0.15;
  g.add(drape);
  return g;
}

// ------------------------------------------------------------------ sky

/** the moon (with Master Twardowski, once you have spotted him), kept at sky distance */
export function makeMoon(): { sprite: THREE.Sprite; showTwardowski(on: boolean): void } {
  const draw = (figure: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 100, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,245,1)');
    grad.addColorStop(1, 'rgba(255,255,245,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#f7f4e8';
    g.beginPath();
    g.arc(128, 128, 100, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(160,160,170,0.35)';
    for (const [x, y, r] of [[95, 100, 22], [160, 150, 28], [120, 170, 14], [170, 90, 12], [80, 160, 10]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    if (figure) {
      // a tiny waving figure in a long coat, and his spider on a thread
      g.fillStyle = '#2b2b38';
      g.strokeStyle = '#2b2b38';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(128, 96, 7, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(120, 104);
      g.lineTo(136, 104);
      g.lineTo(142, 140);
      g.lineTo(114, 140);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(134, 108);
      g.lineTo(150, 88);
      g.stroke();
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(175, 120);
      g.lineTo(175, 200);
      g.stroke();
      g.beginPath();
      g.arc(175, 204, 4, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const plain = draw(false);
  const withFigure = draw(true);
  const mat = new THREE.SpriteMaterial({ map: plain, transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(60);
  sprite.renderOrder = -1;
  return {
    sprite,
    showTwardowski(on: boolean) {
      mat.map = on ? withFigure : plain;
      mat.needsUpdate = true;
    },
  };
}
