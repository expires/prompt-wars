// Damage direction indicators: 60° wedges on an r=180u ring around the screen centre, one per
// attacker (merged), max 4, fading over 900 ms.
import { el } from '../dom';

const LIFE = 0.9;
const MAX = 4;
const SVG =
  '<svg viewBox="-200 -200 400 400" aria-hidden="true">' +
  '<path class="da-ol" d="M-90 -155.88A180 180 0 0 1 90 -155.88"/>' +
  '<path class="da-c" d="M-90 -155.88A180 180 0 0 1 90 -155.88"/>' +
  '<path class="da-hi" d="M-46.6 -173.9A180 180 0 0 1 46.6 -173.9"/>' +
  '</svg>';

interface Arc {
  id: string;
  el: HTMLElement;
  life: number;
}

export class DamageArcs {
  readonly root = el('div', 'hud-arcs');
  private readonly arcs: Arc[] = [];

  /** angle: attacker direction relative to view forward (0 = front, +PI/2 = right) */
  add(attackerId: string, angleRad: number) {
    let a = this.arcs.find((x) => x.id === attackerId);
    if (!a) {
      if (this.arcs.length >= MAX) this.arcs.shift()?.el.remove();
      a = { id: attackerId, el: el('div', 'hud-arc', SVG), life: LIFE };
      this.root.append(a.el);
      this.arcs.push(a);
    }
    a.life = LIFE;
    a.el.style.transform = `rotate(${((angleRad * 180) / Math.PI).toFixed(1)}deg)`;
    a.el.style.opacity = '1';
    a.el.classList.remove('is-hit');
    void a.el.offsetWidth;
    a.el.classList.add('is-hit');
  }

  update(dt: number) {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= dt;
      if (a.life <= 0) {
        a.el.remove();
        this.arcs.splice(i, 1);
        continue;
      }
      const f = a.life / LIFE;
      a.el.style.opacity = (f < 0.6 ? f / 0.6 : 1).toFixed(3);
    }
  }

  clear() {
    for (const a of this.arcs) a.el.remove();
    this.arcs.length = 0;
  }
}
