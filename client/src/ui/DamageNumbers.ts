import * as THREE from 'three';

/** a hit within this window of the previous one on the same target adds to its number */
const AGGREGATE_S = 0.3;
const LIFETIME_S = 0.9;

interface Entry {
  el: HTMLElement;
  targetId: string;
  total: number;
  /** time since the last hit was added */
  age: number;
  /** world anchor (last impact), used when the target is gone */
  anchor: THREE.Vector3;
  rise: number;
}

/**
 * Floating damage numbers from server-confirmed hits (hit_event), aggregated per target: hits
 * less than 0.3 s apart add up into one number that floats above the target and fades.
 */
export class DamageNumbers {
  private readonly entries: Entry[] = [];
  private readonly v = new THREE.Vector3();

  constructor(private readonly parent: HTMLElement) {}

  add(targetId: string, damage: number, at: THREE.Vector3, opts: { headshot?: boolean; killed?: boolean } = {}) {
    let e = this.entries.find((x) => x.targetId === targetId && x.age < AGGREGATE_S);
    if (!e) {
      const el = document.createElement('div');
      el.className = 'dmg-num';
      el.dataset.testid = 'dmg-num';
      this.parent.append(el);
      e = { el, targetId, total: 0, age: 0, anchor: at.clone(), rise: 0 };
      this.entries.push(e);
    }
    e.total += damage;
    e.age = 0;
    e.anchor.copy(at);
    e.el.textContent = String(Math.round(e.total));
    if (opts.headshot) e.el.classList.add('headshot');
    if (opts.killed) e.el.classList.add('kill');
  }

  /** `anchorOf(id)` = live world position to float above (e.g. the target's head), if known */
  update(dt: number, camera: THREE.Camera, anchorOf: (id: string) => THREE.Vector3 | undefined) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      e.age += dt;
      e.rise += dt * 0.6;
      if (e.age > LIFETIME_S) {
        e.el.remove();
        this.entries.splice(i, 1);
        continue;
      }
      const live = anchorOf(e.targetId);
      if (live) e.anchor.copy(live);
      this.v.copy(e.anchor).setY(e.anchor.y + 0.35 + e.rise).project(camera);
      const visible = this.v.z < 1;
      e.el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const x = (this.v.x * 0.5 + 0.5) * w;
      const y = (-this.v.y * 0.5 + 0.5) * h;
      e.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      e.el.style.opacity = String(Math.min(1, (LIFETIME_S - e.age) / 0.3));
    }
  }

  /** current numbers (tests) */
  snapshot() {
    return this.entries.map((e) => ({ targetId: e.targetId, total: Math.round(e.total * 100) / 100 }));
  }
}
