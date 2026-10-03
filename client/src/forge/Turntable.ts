// Forge 3D preview: its own canvas + WebGL renderer. Turntable (auto-spin 20°/s, drag to rotate,
// wheel zoom .6–1.6, reset), contact shadow + rotating forge-tick ring, per-component highlight /
// dim / ghost (rejected) / lock glyphs, and the streaming "materialize" clip-plane sweep.
import * as THREE from 'three';
import { buildDesign, disposeDesignObject } from '@ai-gaem/shared/forge/build';
import type { ForgeDesign } from '@ai-gaem/shared';
import { icon } from '../ui/icons';
import { reducedMotion } from '../ui/dom';

export type Mark = 'keep' | 'lock' | 'reject';

const ACCENT = new THREE.Color('#ffd23f');
const FORGE = new THREE.Color('#ff3da5');
const REJECT = new THREE.Color('#ff4655');
const SPIN = (20 * Math.PI) / 180;
const SWEEP_MS = 400;

interface BaseMat {
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

interface CompInfo {
  id: string;
  group: THREE.Object3D;
  meshes: THREE.Mesh[];
}

function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTexture(): THREE.CanvasTexture {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.translate(s / 2, s / 2);
  g.strokeStyle = 'rgba(255,61,165,0.55)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, s * 0.44, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const long = i % 6 === 0;
    g.strokeStyle = long ? 'rgba(255,210,63,0.75)' : 'rgba(255,61,165,0.45)';
    g.lineWidth = long ? 4 : 2;
    g.beginPath();
    g.moveTo(Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4);
    g.lineTo(Math.cos(a) * s * (long ? 0.36 : 0.38), Math.sin(a) * s * (long ? 0.36 : 0.38));
    g.stroke();
  }
  // gap arcs (cut-corner motif)
  g.strokeStyle = 'rgba(123,92,255,0.5)';
  g.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(0, 0, s * 0.47, i * (Math.PI / 2) + 0.15, i * (Math.PI / 2) + 0.9);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Turntable {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  /** spins (yaw) + tilts (pitch) */
  private readonly spinner = new THREE.Group();
  /** centres the model on the origin */
  private readonly pivot = new THREE.Group();
  private model: THREE.Group | null = null;
  private fade: { obj: THREE.Group; t: number } | null = null;
  private comps = new Map<string, CompInfo>();
  private readonly ring: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly sweepPlane: THREE.Mesh;
  private readonly glyphLayer: HTMLElement;
  private glyphs = new Map<string, HTMLElement>();
  private marks = new Map<string, Mark>();
  private hl: string | null = null;
  private sweeps = new Map<string, number>();
  private hoverCb: ((id: string | null) => void) | null = null;

  private yaw = -0.6;
  private pitch = 0.18;
  private zoom = 1;
  private radius = 0.6;
  private dist = 2;
  private distGoal = 2;
  private target = new THREE.Vector3();
  private targetGoal = new THREE.Vector3();
  private dragging = false;
  private lastInteract = -1e9;
  private lastX = 0;
  private lastY = 0;
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private readonly ray = new THREE.Raycaster();
  private readonly ro: ResizeObserver;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'forge-canvas';
    this.canvas.setAttribute('aria-label', 'Weapon preview: drag to rotate, scroll to zoom');
    host.append(this.canvas);
    this.glyphLayer = document.createElement('div');
    this.glyphLayer.className = 'forge-glyphs';
    host.append(this.glyphLayer);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x000000, 0);

    const hemi = new THREE.HemisphereLight(0xe8ecff, 0x2a2140, 1.4);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 2.5);
    const rim = new THREE.DirectionalLight(0xff7ac8, 1.6);
    rim.position.set(-3, 1.5, -2);
    const fill = new THREE.DirectionalLight(0x9db4ff, 0.8);
    fill.position.set(-2, -1, 3);
    this.scene.add(hemi, key, rim, fill, this.spinner);
    this.spinner.add(this.pivot);

    const shadowMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.7)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = -2;
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = -1;
    this.scene.add(this.shadow, this.ring);

    const sweepMat = new THREE.MeshBasicMaterial({ color: FORGE, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.sweepPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sweepMat);
    this.sweepPlane.rotation.x = -Math.PI / 2;
    this.sweepPlane.visible = false;
    this.scene.add(this.sweepPlane);

    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  onHover(cb: (id: string | null) => void) {
    this.hoverCb = cb;
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.lastInteract = performance.now();
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        this.yaw += (e.clientX - this.lastX) * 0.01;
        this.pitch = Math.max(-0.5, Math.min(0.7, this.pitch + (e.clientY - this.lastY) * 0.006));
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.lastInteract = performance.now();
        return;
      }
      const id = this.pick(e);
      if (id !== this.hl) this.hoverCb?.(id);
    });
    const up = (e: PointerEvent) => {
      this.dragging = false;
      this.lastInteract = performance.now();
      c.classList.remove('dragging');
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => {
      if (!this.dragging && this.hl) this.hoverCb?.(null);
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(0.6, Math.min(1.6, this.zoom * Math.exp(-e.deltaY * 0.0012)));
        this.lastInteract = performance.now();
      },
      { passive: false },
    );
  }

  private pick(e: PointerEvent): string | null {
    if (!this.model) return null;
    const r = this.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(p, this.camera);
    const hits = this.ray.intersectObject(this.model, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o !== this.model) {
        const id = o.userData?.componentId as string | undefined;
        if (id) return id;
        o = o.parent;
      }
    }
    return null;
  }

  resetView() {
    this.yaw = -0.6;
    this.pitch = 0.18;
    this.zoom = 1;
    this.lastInteract = -1e9;
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Show a design (null = empty). `materialize`: component ids that just arrived (clip-plane sweep).
   * `crossfade`: fade the previous model out (variant hover preview).
   */
  setDesign(design: ForgeDesign | null, opts: { materialize?: string[]; crossfade?: boolean; keepFrame?: boolean } = {}) {
    if (this.model) {
      if (opts.crossfade && !reducedMotion()) {
        if (this.fade) this.disposeModel(this.fade.obj);
        this.fade = { obj: this.model, t: 0 };
        this.cloneForFade(this.model);
      } else this.disposeModel(this.model);
    }
    this.model = null;
    this.comps.clear();
    if (!design || !design.components.length) {
      this.syncGlyphs();
      return;
    }
    let group: THREE.Group;
    try {
      group = buildDesign(design);
    } catch (err) {
      console.warn('[forge] preview build failed', err);
      return;
    }
    const ud = group.userData as { components?: Map<string, THREE.Object3D> };
    for (const [id, g] of ud.components ?? []) {
      const meshes: THREE.Mesh[] = [];
      // the component's own content is its first child; nested children are other components
      const content = g.children[0];
      content?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.userData.base = {
          color: mat.color.clone(),
          emissive: mat.emissive.clone(),
          emissiveIntensity: mat.emissiveIntensity,
          opacity: mat.opacity,
          transparent: mat.transparent,
          depthWrite: mat.depthWrite,
        } satisfies BaseMat;
        m.material = mat;
        meshes.push(m);
      });
      this.comps.set(id, { id, group: g, meshes });
    }
    for (const id of opts.materialize ?? []) if (!reducedMotion()) this.sweeps.set(id, performance.now());
    this.model = group;
    this.pivot.add(group);
    this.frameModel(!opts.keepFrame);
    this.applyLooks();
    this.syncGlyphs();
  }

  private cloneForFade(obj: THREE.Group) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.Material).clone();
      mat.transparent = true;
      m.material = mat;
    });
  }

  private disposeModel(obj: THREE.Group) {
    obj.removeFromParent();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.Material).dispose();
    });
    disposeDesignObject(obj);
  }

  /** centre the model in the pivot and pick a camera distance for its size */
  private frameModel(snap: boolean) {
    if (!this.model) return;
    this.model.position.set(0, 0, 0);
    const rot = this.spinner.rotation.clone();
    this.spinner.rotation.set(0, 0, 0);
    this.spinner.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(this.model);
    this.spinner.rotation.copy(rot);
    this.spinner.updateMatrixWorld(true);
    if (bb.isEmpty()) return;
    const c = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    this.model.position.set(-c.x, -c.y, -c.z);
    this.radius = Math.max(0.15, size.length() / 2);
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspectFix = Math.max(1, 1.25 / Math.max(0.5, this.camera.aspect));
    this.distGoal = (this.radius / Math.sin(fov / 2)) * 0.82 * aspectFix;
    if (snap) this.dist = this.distGoal;
    const floor = -size.y / 2 - 0.02;
    this.shadow.position.y = floor;
    this.ring.position.y = floor - 0.001;
    const s = Math.max(size.x, size.z) * 1.35 + 0.2;
    this.shadow.scale.set(s, s, 1);
    this.ring.scale.set(s * 1.25, s * 1.25, 1);
  }

  setMarks(marks: Map<string, Mark>) {
    this.marks = new Map(marks);
    this.applyLooks();
    this.syncGlyphs();
  }

  highlight(id: string | null) {
    if (id === this.hl) return;
    this.hl = id;
    this.applyLooks();
    const c = id ? this.comps.get(id) : undefined;
    if (c && this.model) {
      this.model.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(c.group.children[0] ?? c.group);
      const p = bb.getCenter(new THREE.Vector3());
      // into spinner space (the spinner rotates; aim at the part's current position)
      this.targetGoal.copy(p).multiplyScalar(0.6);
    } else this.targetGoal.set(0, 0, 0);
  }

  private applyLooks() {
    for (const c of this.comps.values()) {
      const mark = this.marks.get(c.id);
      const isHl = this.hl === c.id;
      const dim = this.hl !== null && !isHl;
      for (const m of c.meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        const base = mat.userData.base as BaseMat;
        mat.color.copy(base.color);
        mat.emissive.copy(base.emissive);
        mat.emissiveIntensity = base.emissiveIntensity;
        mat.opacity = base.opacity;
        mat.transparent = base.transparent;
        mat.depthWrite = base.depthWrite;
        mat.wireframe = false;
        if (mark === 'reject') {
          mat.wireframe = true;
          mat.color.copy(REJECT);
          mat.emissive.copy(REJECT);
          mat.emissiveIntensity = 0.5;
          mat.transparent = true;
          mat.opacity = 0.3;
          mat.depthWrite = false;
        } else if (isHl) {
          mat.emissive.copy(ACCENT);
          mat.emissiveIntensity = 0.35;
        } else if (dim) {
          mat.color.multiplyScalar(0.5);
          mat.emissiveIntensity *= 0.5;
        }
        mat.needsUpdate = true;
      }
    }
  }

  private syncGlyphs() {
    const want = new Set<string>();
    for (const [id, m] of this.marks) if (m === 'lock' && this.comps.has(id)) want.add(id);
    for (const [id, el] of this.glyphs) if (!want.has(id)) (el.remove(), this.glyphs.delete(id));
    for (const id of want) {
      if (this.glyphs.has(id)) continue;
      const el = document.createElement('div');
      el.className = 'forge-lock-glyph';
      el.innerHTML = icon('lock', 'ui-icon ui-icon--sm');
      this.glyphLayer.append(el);
      this.glyphs.set(id, el);
    }
  }

  /** PNG data URL of a design (variant tiles) */
  thumbnail(design: ForgeDesign, w = 176, h = 96): string {
    const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe8ecff, 0x2a2140, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 2.5);
    const rim = new THREE.DirectionalLight(0xff7ac8, 1.4);
    rim.position.set(-3, 1.5, -2);
    scene.add(key, rim);
    let g: THREE.Group;
    try {
      g = buildDesign(design);
    } catch {
      return '';
    }
    const bb = new THREE.Box3().setFromObject(g);
    const c = bb.getCenter(new THREE.Vector3());
    g.position.sub(c);
    const holder = new THREE.Group();
    holder.add(g);
    holder.rotation.set(0.12, -Math.PI / 2 + 0.35, 0);
    scene.add(holder);
    const cam = new THREE.PerspectiveCamera(28, w / h, 0.01, 50);
    const r = Math.max(0.15, bb.getSize(new THREE.Vector3()).length() / 2);
    cam.position.set(0, 0, (r / Math.sin((28 * Math.PI) / 360)) * 0.62);
    cam.lookAt(0, 0, 0);
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(scene, cam);
    const px = new Uint8Array(w * 2 * h * 2 * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, px);
    this.renderer.setRenderTarget(prevTarget);
    rt.dispose();
    disposeDesignObject(g);
    const cv = document.createElement('canvas');
    cv.width = w * 2;
    cv.height = h * 2;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w * 2, h * 2);
    // flip Y
    const row = w * 2 * 4;
    for (let y = 0; y < h * 2; y++) img.data.set(px.subarray((h * 2 - 1 - y) * row, (h * 2 - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.canvas.isConnected || this.host.clientWidth === 0) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const rm = reducedMotion();
    const idle = now - this.lastInteract > 3000;
    if (!rm && !this.dragging && idle && this.hl === null) this.yaw += SPIN * dt;
    this.spinner.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.ring.rotation.z += dt * (rm ? 0 : 0.12);

    const k = 1 - Math.exp(-dt / 0.1); // ~300 ms ease
    this.dist += (this.distGoal - this.dist) * k;
    this.target.lerp(this.targetGoal, k);
    const hlZoom = this.hl ? 0.85 : 1;
    const d = this.dist * this.zoom * hlZoom;
    this.camera.position.set(this.target.x, this.target.y + d * 0.12, this.target.z + d);
    this.camera.lookAt(this.target);

    // materialize sweeps (bottom -> top clip plane with a forge-coloured edge)
    this.sweepPlane.visible = false;
    for (const [id, t0] of this.sweeps) {
      const c = this.comps.get(id);
      const u = (now - t0) / SWEEP_MS;
      if (!c || u >= 1) {
        if (c) for (const m of c.meshes) ((m.material as THREE.Material).clippingPlanes = null);
        this.sweeps.delete(id);
        if (c) this.applyLooks();
        continue;
      }
      this.spinner.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(c.group.children[0] ?? c.group);
      if (bb.isEmpty()) continue;
      const y = bb.min.y + (bb.max.y - bb.min.y) * u;
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), y);
      for (const m of c.meshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.clippingPlanes = [plane];
        mat.emissive.copy(FORGE);
        mat.emissiveIntensity = 0.9 * (1 - u);
      }
      const sz = bb.getSize(new THREE.Vector3());
      this.sweepPlane.visible = true;
      this.sweepPlane.position.set((bb.min.x + bb.max.x) / 2, y, (bb.min.z + bb.max.z) / 2);
      this.sweepPlane.scale.set(Math.max(0.05, sz.x * 1.15), Math.max(0.05, sz.z * 1.15), 1);
      (this.sweepPlane.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.2));
    }

    // crossfade out the previous model
    if (this.fade) {
      this.fade.t += dt / 0.2;
      const o = Math.max(0, 1 - this.fade.t);
      if (!this.fade.obj.parent) this.pivot.add(this.fade.obj);
      this.fade.obj.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).opacity = o;
      });
      if (this.fade.t >= 1) {
        this.disposeModel(this.fade.obj);
        this.fade = null;
      }
    }

    this.renderer.render(this.scene, this.camera);

    // lock glyph overlay positions
    if (this.glyphs.size) {
      const w = this.host.clientWidth;
      const h = this.host.clientHeight;
      for (const [id, el] of this.glyphs) {
        const c = this.comps.get(id);
        if (!c) continue;
        const bb = new THREE.Box3().setFromObject(c.group.children[0] ?? c.group);
        const p = bb.getCenter(new THREE.Vector3());
        p.y = bb.max.y;
        p.project(this.camera);
        el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -120%)`;
      }
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    if (this.model) this.disposeModel(this.model);
    if (this.fade) this.disposeModel(this.fade.obj);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.glyphLayer.remove();
  }
}
