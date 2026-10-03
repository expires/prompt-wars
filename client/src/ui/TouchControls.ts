// Phone / tablet controls: floating left joystick (move), right-side drag (look), FIRE / AIM /
// JUMP / CROUCH / RELOAD buttons and a MENU button (pause menu: settings, weapon forge, leave).
// Pointer Events only; feeds Input (merged into the pad state + mouse look deltas) each frame.
import './touch.css';
import { el } from './dom';
import { icon } from './icons';

/** touch-look: mouse-delta units per CSS pixel dragged (sensitivity setting still applies) */
const LOOK_GAIN = 1.8;
/** joystick travel radius (px) */
const STICK_R = 56;

export interface TouchFrame {
  /** x right, y forward, -1..1 */
  move: [number, number];
  fire: boolean;
  ads: boolean;
  /** crouch latch (CROUCH is a toggle on touch) */
  crouch: boolean;
  jumpPressed: boolean;
  crouchPressed: boolean;
  reloadPressed: boolean;
}

/** touch-first device (or `?touch=1` to force the controls on, e.g. desktop testing) */
export function touchDevice(): boolean {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}

export class TouchControls {
  readonly root = el('div', 'touch');
  /** called with look deltas (px * gain) */
  onLook?: (dx: number, dy: number) => void;
  /** MENU button */
  onMenu?: () => void;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private stickId = -1;
  private stickOrigin = { x: 0, y: 0 };
  private move: [number, number] = [0, 0];
  /** pointers dragging the look area (or the FIRE button, which also aims) */
  private readonly lookPtrs = new Map<number, { x: number; y: number }>();
  private firePtr = -1;
  private aimOn = false;
  private crouchOn = false;
  private jumpEdge = false;
  private crouchEdge = false;
  private reloadEdge = false;
  private shown = false;
  /** a pointer currently pressing FIRE etc. (tests / state) */
  readonly btn: Record<string, HTMLButtonElement> = {};

  constructor(parent: HTMLElement = document.body) {
    const r = this.root;
    r.dataset.testid = 'touch-controls';
    r.hidden = true;
    r.innerHTML = `
      <div class="touch-look" data-k="look"></div>
      <div class="touch-move" data-k="move" data-testid="touch-stick-zone">
        <div class="touch-stick" data-k="base" hidden><i data-k="knob"></i></div>
        <span class="touch-move__hint">Move</span>
      </div>
      <button class="touch-btn touch-btn--menu" data-b="menu" data-testid="touch-menu" aria-label="Menu">${icon('gear')}</button>
      <button class="touch-btn touch-btn--fire" data-b="fire" data-testid="touch-fire" aria-label="Fire">${icon('crosshair')}<span>Fire</span></button>
      <button class="touch-btn touch-btn--aim" data-b="aim" data-testid="touch-aim" aria-label="Aim">${icon('eye')}<span>Aim</span></button>
      <button class="touch-btn touch-btn--jump" data-b="jump" data-testid="touch-jump" aria-label="Jump"><span>Jump</span></button>
      <button class="touch-btn touch-btn--crouch" data-b="crouch" data-testid="touch-crouch" aria-label="Crouch"><span>Crouch</span></button>
      <button class="touch-btn touch-btn--reload" data-b="reload" data-testid="touch-reload" aria-label="Reload">${icon('rotate')}</button>`;
    const q = (k: string) => r.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    this.stickBase = q('base');
    this.stickKnob = q('knob');
    for (const b of r.querySelectorAll<HTMLButtonElement>('[data-b]')) this.btn[b.dataset.b!] = b;

    // never let touches scroll / zoom / long-press-select the page or reach the canvas listeners
    r.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const ev of ['click', 'mousedown', 'wheel'] as const) r.addEventListener(ev, (e) => e.stopPropagation());

    // ---- joystick (floating: appears where the thumb lands)
    const zone = q('move');
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      const s = this.stickBase.style;
      s.left = `${e.clientX}px`;
      s.top = `${e.clientY}px`;
      this.stickBase.hidden = false;
      this.setStick(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      this.setStick(e.clientX - this.stickOrigin.x, e.clientY - this.stickOrigin.y);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.stickBase.hidden = true;
      this.move = [0, 0];
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    // ---- look (right side drag; FIRE drags look too)
    const look = q('look');
    const startLook = (e: PointerEvent, target: HTMLElement) => {
      e.preventDefault();
      target.setPointerCapture(e.pointerId);
      this.lookPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const moveLook = (e: PointerEvent) => {
      const p = this.lookPtrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (dx || dy) this.onLook?.(dx * LOOK_GAIN, dy * LOOK_GAIN);
    };
    const endLook = (e: PointerEvent) => this.lookPtrs.delete(e.pointerId);
    look.addEventListener('pointerdown', (e) => startLook(e, look));
    look.addEventListener('pointermove', moveLook);
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    // ---- buttons
    const fire = this.btn.fire;
    fire.addEventListener('pointerdown', (e) => {
      startLook(e, fire);
      this.firePtr = e.pointerId;
      fire.classList.add('is-down');
    });
    fire.addEventListener('pointermove', moveLook);
    const endFire = (e: PointerEvent) => {
      endLook(e);
      if (e.pointerId !== this.firePtr) return;
      this.firePtr = -1;
      fire.classList.remove('is-down');
    };
    fire.addEventListener('pointerup', endFire);
    fire.addEventListener('pointercancel', endFire);

    const tap = (name: string, fn: () => void) =>
      this.btn[name].addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
        const b = this.btn[name];
        b.classList.add('is-down');
        setTimeout(() => b.classList.remove('is-down'), 120);
      });
    tap('jump', () => (this.jumpEdge = true));
    tap('reload', () => (this.reloadEdge = true));
    tap('crouch', () => {
      this.crouchOn = !this.crouchOn;
      this.crouchEdge = true;
      this.btn.crouch.classList.toggle('is-on', this.crouchOn);
    });
    tap('aim', () => {
      this.aimOn = !this.aimOn;
      this.btn.aim.classList.toggle('is-on', this.aimOn);
    });
    tap('menu', () => this.onMenu?.());

    parent.append(r);
  }

  private setStick(dx: number, dy: number) {
    const d = Math.hypot(dx, dy);
    const k = d > STICK_R ? STICK_R / d : 1;
    const x = dx * k;
    const y = dy * k;
    this.stickKnob.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    // small radial deadzone, then linear to full deflection
    const m = Math.min(1, d / STICK_R);
    const dz = 0.12;
    const s = m <= dz ? 0 : (m - dz) / (1 - dz) / m;
    this.move = [(x / STICK_R) * s, (-y / STICK_R) * s];
  }

  get visible() {
    return this.shown;
  }

  /** show while playing (alive, no menu); hiding releases everything */
  setVisible(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.root.hidden = !on;
    if (!on) this.release();
  }

  private release() {
    this.stickId = -1;
    this.stickBase.hidden = true;
    this.move = [0, 0];
    this.lookPtrs.clear();
    this.firePtr = -1;
    this.btn.fire.classList.remove('is-down');
    this.aimOn = false;
    this.btn.aim.classList.remove('is-on');
  }

  /** this frame's state; clears the one-shot presses */
  frame(): TouchFrame {
    const f: TouchFrame = {
      move: [this.move[0], this.move[1]],
      fire: this.firePtr !== -1,
      ads: this.aimOn,
      crouch: this.crouchOn,
      jumpPressed: this.jumpEdge,
      crouchPressed: this.crouchEdge,
      reloadPressed: this.reloadEdge,
    };
    this.jumpEdge = this.crouchEdge = this.reloadEdge = false;
    return f;
  }
}
