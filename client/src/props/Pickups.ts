import * as THREE from 'three';
import { PICKUP_RESPAWN_SECONDS, PICKUP_TOUCH_RADIUS, healAmount, pickupInReach, type MapPickup } from '@ai-gaem/shared';
import type { NetClient, NetPickup, PickupTakenEvent } from '../net';

/** don't re-send take_pickup for the same pack more often than this while standing on it */
const RETRY_MS = 900;
/** pack hover height above its anchor and bob amplitude (m) */
const HOVER = 0.55;
const BOB = 0.07;
const TIMER_SEGMENTS = 64;

interface View {
  id: number;
  kind: string;
  pos: THREE.Vector3;
  available: boolean;
  /** ms since epoch */
  respawnAt: number;
  /** respawn delay of the last pickup (ms), for the timer ring */
  delayMs: number;
  group: THREE.Group;
  pack: THREE.Group;
  ring: THREE.Mesh;
  glow: THREE.Mesh;
  timer: THREE.Mesh;
  /** 0..1 pop-in after (re)appearing */
  pop: number;
  lastTry: number;
}

let shared: {
  box: THREE.BoxGeometry;
  boxMat: THREE.MeshStandardMaterial;
  ring: THREE.RingGeometry;
  ringMat: THREE.MeshBasicMaterial;
  glow: THREE.CircleGeometry;
  glowMat: THREE.MeshBasicMaterial;
  timerMat: THREE.MeshBasicMaterial;
} | null = null;

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function assets() {
  if (shared) return shared;
  // white case, green rim, red cross: reads as "health" from any side
  const face = canvasTexture(128, (g, s) => {
    g.fillStyle = '#f4f6f4';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#22c55e';
    g.lineWidth = 12;
    g.strokeRect(6, 6, s - 12, s - 12);
    g.fillStyle = '#e11d2a';
    const w = s * 0.2;
    const l = s * 0.6;
    g.fillRect((s - w) / 2, (s - l) / 2, w, l);
    g.fillRect((s - l) / 2, (s - w) / 2, l, w);
  });
  const glowTex = canvasTexture(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(90,255,150,0.9)');
    r.addColorStop(0.5, 'rgba(60,230,120,0.35)');
    r.addColorStop(1, 'rgba(40,200,100,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } as const;
  shared = {
    box: new THREE.BoxGeometry(0.46, 0.32, 0.46),
    // emissive so it stays readable under the dim magenta stage wash (no extra light)
    boxMat: new THREE.MeshStandardMaterial({ map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.45, roughness: 0.45, metalness: 0 }),
    ring: new THREE.RingGeometry(0.58, 0.72, 48, 1),
    ringMat: new THREE.MeshBasicMaterial({ color: 0x3dff8a, opacity: 0.6, ...additive }),
    glow: new THREE.CircleGeometry(0.9, 32),
    glowMat: new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffffff, opacity: 0.7, ...additive }),
    timerMat: new THREE.MeshBasicMaterial({ color: 0xd8ffe6, opacity: 0.55, ...additive }),
  };
  return shared;
}

export interface PickupFeedback {
  e: PickupTakenEvent;
  /** taken by the local player */
  local: boolean;
}

/**
 * Health packs: one small mesh group each (spinning, bobbing case + additive floor ring / glow,
 * no lights). Networked: rows come from the server (`pickup`), overlapping the local player
 * calls take_pickup once (debounced) and the server decides. Offline: simulated locally with the
 * map's MapDef.pickups and the same rules (heal only when hurt, respawn after 60 s).
 */
export class PickupSystem {
  private readonly views = new Map<number, View>();
  private readonly root = new THREE.Group();
  private t = 0;
  /** feedback events handled (tests) */
  taken = 0;
  /** someone took a pickup (local: heal feedback; remote: just a sound) */
  onTaken?: (f: PickupFeedback) => void;
  /** offline only: apply a heal to the local player */
  onLocalHeal?: (amount: number) => void;
  private readonly offs: (() => void)[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly net: NetClient,
    /** offline: the map's pickups (ignored when networked) */
    localDefs: readonly MapPickup[],
    private readonly enabled: boolean,
  ) {
    this.root.name = 'pickups';
    scene.add(this.root);
    if (!enabled) return;
    if (net.authoritative) {
      const sync = (list: NetPickup[]) => this.sync(list);
      const off = net.onPickupsChanged?.(sync);
      if (off) this.offs.push(off);
      if (net.pickups) sync(net.pickups());
      const off2 = net.onPickupTaken?.((e) => this.feedback(e));
      if (off2) this.offs.push(off2);
    } else {
      this.sync(localDefs.map((d, i) => ({ id: i + 1, kind: d.kind, pos: [d.x, d.y, d.z], available: true, respawnAt: 0 })));
    }
  }

  private feedback(e: PickupTakenEvent) {
    this.taken++;
    this.onTaken?.({ e, local: e.who === this.net.localId });
  }

  private sync(list: NetPickup[]) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let v = this.views.get(p.id);
      if (!v) {
        v = this.create(p);
        this.views.set(p.id, v);
      }
      v.pos.set(...p.pos);
      v.group.position.copy(v.pos);
      if (p.available && !v.available) v.pop = 0;
      if (!p.available && v.available && p.respawnAt > 0) v.delayMs = Math.max(1000, p.respawnAt - Date.now());
      v.available = p.available;
      v.respawnAt = p.respawnAt;
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.root.remove(v.group);
      this.views.delete(id);
    }
  }

  private create(p: NetPickup): View {
    const a = assets();
    const group = new THREE.Group();
    group.name = `pickup-${p.id}`;
    const pack = new THREE.Group();
    const box = new THREE.Mesh(a.box, a.boxMat);
    box.castShadow = false;
    pack.add(box);
    pack.position.y = HOVER;
    const glow = new THREE.Mesh(a.glow, a.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.015;
    const ring = new THREE.Mesh(a.ring, a.ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    // respawn timer: an arc that fills up (drawRange over the ring's theta segments)
    const timerGeo = new THREE.RingGeometry(0.76, 0.84, TIMER_SEGMENTS, 1, Math.PI / 2, Math.PI * 2);
    const timer = new THREE.Mesh(timerGeo, a.timerMat);
    timer.rotation.x = -Math.PI / 2;
    timer.position.y = 0.025;
    timer.visible = false;
    group.add(glow, ring, timer, pack);
    group.position.set(...p.pos);
    this.root.add(group);
    return {
      id: p.id,
      kind: p.kind,
      pos: new THREE.Vector3(...p.pos),
      available: p.available,
      respawnAt: p.respawnAt,
      delayMs: PICKUP_RESPAWN_SECONDS * 1000,
      group,
      pack,
      ring,
      glow,
      timer,
      pop: 1,
      lastTry: -Infinity,
    };
  }

  /** animate, and collect a pack the local player stands on (only when it would heal) */
  update(dt: number, local: { feet: THREE.Vector3; hp: number; alive: boolean; maxHp?: number }) {
    if (!this.enabled || this.views.size === 0) return;
    this.t += dt;
    const now = performance.now();
    const wall = Date.now();
    for (const v of this.views.values()) {
      // offline respawn
      if (!this.net.authoritative && !v.available && wall >= v.respawnAt) {
        v.available = true;
        v.respawnAt = 0;
        v.pop = 0;
      }
      const ringMat = v.ring.material as THREE.MeshBasicMaterial;
      if (v.available) {
        v.pop = Math.min(1, v.pop + dt / 0.35);
        const s = v.pop < 1 ? 1 - (1 - v.pop) ** 3 : 1;
        v.pack.visible = true;
        v.pack.scale.setScalar(Math.max(0.001, s));
        v.pack.rotation.y = this.t * 1.3 + v.id;
        v.pack.position.y = HOVER + Math.sin(this.t * 2.2 + v.id) * BOB;
        v.glow.visible = true;
        ringMat.opacity = 0.45 + 0.2 * Math.sin(this.t * 3 + v.id);
        v.timer.visible = false;
      } else {
        v.pack.visible = false;
        v.glow.visible = false;
        ringMat.opacity = 0.14;
        // faint arc showing how far along the respawn is
        const left = Math.max(0, v.respawnAt - wall);
        const frac = v.respawnAt > 0 ? THREE.MathUtils.clamp(1 - left / Math.max(1, v.delayMs), 0, 1) : 0;
        v.timer.visible = frac > 0.01;
        v.timer.geometry.setDrawRange(0, 6 * Math.round(frac * TIMER_SEGMENTS));
      }

      if (!v.available || !local.alive) continue;
      if (!pickupInReach(local.feet, v.pos, PICKUP_TOUCH_RADIUS)) continue;
      const amount = v.kind === 'health' ? healAmount(local.hp, local.maxHp) : 0;
      if (amount <= 0 || now - v.lastTry < RETRY_MS) continue;
      v.lastTry = now;
      if (this.net.authoritative) {
        this.net.takePickup?.(v.id);
      } else {
        v.available = false;
        v.pack.visible = false;
        v.glow.visible = false;
        v.delayMs = PICKUP_RESPAWN_SECONDS * 1000;
        v.respawnAt = wall + v.delayMs;
        this.onLocalHeal?.(amount);
        this.feedback({ who: this.net.localId, id: v.id, kind: v.kind, amount, pos: [v.pos.x, v.pos.y, v.pos.z] });
      }
    }
  }

  /** state for tests / debugging */
  snapshot() {
    return [...this.views.values()].map((v) => ({
      id: v.id,
      kind: v.kind,
      pos: [v.pos.x, v.pos.y, v.pos.z] as [number, number, number],
      available: v.available,
      visible: v.pack.visible,
      respawnAt: v.respawnAt,
    }));
  }

  dispose() {
    this.offs.forEach((f) => f());
    this.root.removeFromParent();
  }
}
