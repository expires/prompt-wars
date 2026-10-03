import * as THREE from 'three';

interface Timed {
  obj: THREE.Object3D;
  life: number;
  maxLife: number;
  update?: (t: number, dt: number) => void;
  dispose?: () => void;
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
  /** gravity (m/s²) */
  g: number;
}

const MAX_PARTICLES = 600;
const MAX_BIG_PARTICLES = 400;

/** one additive point cloud (fixed point size) */
class ParticleLayer {
  readonly particles: Particle[] = [];
  private readonly geo = new THREE.BufferGeometry();
  readonly points: THREE.Points;

  constructor(scene: THREE.Scene, private readonly max: number, size: number) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    const mat = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, color: THREE.ColorRepresentation, g: number) {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push({ pos: pos.clone(), vel: vel.clone(), life, maxLife: life, color: new THREE.Color(color), g });
  }

  update(dt: number) {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.geo.getAttribute('color') as THREE.BufferAttribute;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.g * dt;
      p.pos.addScaledVector(p.vel, dt);
      const f = p.life / p.maxLife;
      pos.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
      col.setXYZ(n, p.color.r * f, p.color.g * f, p.color.b * f);
      n++;
    }
    this.geo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}

/** World-space visual effects: tracers, impacts, explosions, stream particles, status flames / frost. */
export class Effects {
  private items: Timed[] = [];
  private readonly small: ParticleLayer;
  /** bigger particles: burning flames / frost flakes on players */
  private readonly big: ParticleLayer;
  private readonly light: THREE.PointLight;
  private lightLife = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.small = new ParticleLayer(scene, MAX_PARTICLES, 0.15);
    this.big = new ParticleLayer(scene, MAX_BIG_PARTICLES, 0.3);
    this.light = new THREE.PointLight(0xffc070, 0, 8, 2);
    scene.add(this.light);
  }

  private add(t: Timed) {
    this.scene.add(t.obj);
    this.items.push(t);
  }

  muzzleLight(pos: THREE.Vector3, color = 0xffc070) {
    this.light.position.copy(pos);
    this.light.color.set(color);
    this.light.intensity = 6;
    this.lightLife = 0.05;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation = 0xffe9a0) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    this.add({
      obj: line,
      life: 0.08,
      maxLife: 0.08,
      update: (t) => (mat.opacity = 0.9 * t),
      dispose: () => {
        geo.dispose();
        mat.dispose();
      },
    });
  }

  impact(pos: THREE.Vector3, normal?: THREE.Vector3, color = 0xffd080) {
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4);
      if (normal) v.addScaledVector(normal, 2);
      this.emit(pos, v, 0.25, color);
    }
  }

  /**
   * Stylized (blood-free) melee impact: a comic "pow" star that pops and fades, plus a burst of
   * bright sparks. Bigger for heavier weapons.
   */
  meleeImpact(pos: THREE.Vector3, color: THREE.ColorRepresentation = 0xffffff, weight: 'light' | 'medium' | 'heavy' = 'medium') {
    const size = weight === 'heavy' ? 0.75 : weight === 'light' ? 0.4 : 0.55;
    const mat = new THREE.SpriteMaterial({ map: starTexture(), color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(pos);
    sp.renderOrder = 5;
    mat.rotation = Math.random() * Math.PI;
    this.add({
      obj: sp,
      life: 0.22,
      maxLife: 0.22,
      update: (t) => {
        const k = 1 - t; // 0 -> 1
        sp.scale.setScalar(size * (0.4 + 0.9 * Math.sqrt(k)));
        mat.opacity = t;
      },
      dispose: () => mat.dispose(),
    });
    const n = weight === 'heavy' ? 18 : 12;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 4);
      this.emit(pos, v, 0.3 + Math.random() * 0.15, i % 3 === 0 ? 0xffe060 : color);
    }
  }

  explosion(pos: THREE.Vector3, radius: number) {
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8030, transparent: true, opacity: 0.8, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    this.add({
      obj: m,
      life: 0.35,
      maxLife: 0.35,
      update: (t) => {
        m.scale.setScalar(Math.max(0.01, radius * (1 - t * t)));
        mat.opacity = 0.8 * t;
      },
      dispose: () => {
        geo.dispose();
        mat.dispose();
      },
    });
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(radius * 3 * Math.random());
      this.emit(pos, v, 0.6, Math.random() < 0.5 ? 0xff6020 : 0x555555);
    }
    this.muzzleLight(pos, 0xff8030);
    this.light.intensity = 30;
    this.light.distance = radius * 4;
    this.lightLife = 0.15;
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, color: THREE.ColorRepresentation) {
    this.small.emit(pos, vel, life, color, 4);
  }

  /** big particle with its own gravity (negative = buoyant, e.g. flames) */
  emitBig(pos: THREE.Vector3, vel: THREE.Vector3, life: number, color: THREE.ColorRepresentation, gravity = 4) {
    this.big.emit(pos, vel, life, color, gravity);
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.obj);
        it.dispose?.();
        this.items.splice(i, 1);
      } else it.update?.(it.life / it.maxLife, dt);
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      if (this.lightLife <= 0) {
        this.light.intensity = 0;
        this.light.distance = 8;
      }
    }
    this.small.update(dt);
    this.big.update(dt);
  }
}

let starTex: THREE.CanvasTexture | undefined;
/** cartoon impact star (white, tinted by the sprite colour) */
function starTexture(): THREE.CanvasTexture {
  if (starTex) return starTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  g.beginPath();
  const spikes = 9;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? 22 + (i % 4) * 4 : 60;
    const a = (i / (spikes * 2)) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.stroke();
  starTex = new THREE.CanvasTexture(c);
  starTex.colorSpace = THREE.SRGBColorSpace;
  return starTex;
}
