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
}

const MAX_PARTICLES = 600;

/** World-space visual effects: tracers, impacts, explosions, stream particles. */
export class Effects {
  private items: Timed[] = [];
  private particles: Particle[] = [];
  private readonly points: THREE.Points;
  private readonly pGeo: THREE.BufferGeometry;
  private readonly pMat: THREE.PointsMaterial;
  private readonly light: THREE.PointLight;
  private lightLife = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    this.pMat = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
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
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    const p: Particle & { color?: THREE.Color } = { pos: pos.clone(), vel: vel.clone(), life, maxLife: life };
    p.color = new THREE.Color(color);
    this.particles.push(p);
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
    const pos = this.pGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.pGeo.getAttribute('color') as THREE.BufferAttribute;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i] as Particle & { color: THREE.Color };
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 4 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const f = p.life / p.maxLife;
      pos.setXYZ(n, p.pos.x, p.pos.y, p.pos.z);
      col.setXYZ(n, p.color.r * f, p.color.g * f, p.color.b * f);
      n++;
    }
    this.pGeo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
