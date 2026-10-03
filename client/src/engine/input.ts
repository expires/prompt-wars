import { GamepadPoller, emptyPad, type PadState } from './gamepad';
import { settings } from '../settings';
import type { TouchFrame } from '../ui/TouchControls';

/** Keyboard + mouse state with pointer lock, plus a polled gamepad. */
export class Input {
  private readonly poller = new GamepadPoller();
  /** this frame's gamepad state (see pollGamepad) */
  pad: PadState = emptyPad();
  /** playing with the gamepad without pointer lock (Start / A on the pause screen) */
  padPlaying = false;
  /** playing with the on-screen touch controls (phones / tablets: no pointer lock) */
  touchPlaying = false;
  /** touch controls source (merged into `pad` every poll while touchPlaying) */
  touch: { frame(): TouchFrame } | null = null;
  /** event timestamp (performance.now() clock) of the last mouse movement while locked (trackpad hint heuristic) */
  lastMouseMoveAt = 0;
  /** total mousemove events received while locked (F3 overlay derives events/s from it) */
  mouseEvents = 0;
  /** true when the current pointer lock delivers raw, unaccelerated deltas (Chromium unadjustedMovement) */
  rawMouse = false;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = false;
  /** right mouse button held (ADS) */
  rightDown = false;
  private mouseClicked = false;
  private rightClicked = false;
  locked = false;
  /** when true, game keys are ignored (e.g. typing into a text box) */
  suspended = false;
  private lockListeners: ((locked: boolean) => void)[] = [];

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.suspended || isTyping(e)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'F2', 'Tab'].includes(e.code) || (this.locked && e.code.startsWith('Arrow'))) e.preventDefault();
      // crouch on Ctrl: swallow browser shortcuts (Ctrl+S/D/F...) while playing. Ctrl+W can't be blocked
      // outside fullscreen, which is why C is the primary crouch key.
      if (this.locked && (e.ctrlKey || e.metaKey) && e.code !== 'KeyW') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.rightDown = false;
    });
    // Mouse look: the handler only accumulates. Gaming mice poll at 1-8 kHz, so this runs thousands
    // of times a second; it must stay O(1) with no allocation, no DOM access and no filtering /
    // rounding (every delta counts). The deltas are applied once per rendered frame in
    // PlayerController.frameInput(). Passive: never calls preventDefault.
    document.addEventListener(
      'mousemove',
      (e) => {
        if (!this.locked) return;
        const dx = e.movementX;
        const dy = e.movementY;
        this.mouseDX += dx;
        this.mouseDY += dy;
        this.mouseEvents++;
        if (dx || dy) this.lastMouseMoveAt = e.timeStamp;
      },
      { passive: true },
    );
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseClicked = true;
      } else if (e.button === 2) {
        this.rightDown = true;
        this.rightClicked = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.rawMouse = false;
        this.mouseDown = false;
        this.rightDown = false;
        this.keys.clear();
      }
      this.lockListeners.forEach((cb) => cb(this.locked));
    });
  }

  /** poll the gamepad once per frame (before reading `pad`) */
  pollGamepad(deadzone: number): PadState {
    this.pad = this.poller.poll(deadzone);
    if (this.touch) {
      // always drain the touch presses (no stale jump when play resumes)
      const t = this.touch.frame();
      if (this.touchPlaying) mergeTouch(this.pad, t);
    }
    return this.pad;
  }

  /** touch-drag look: accumulated like mouse movement (applied once per frame) */
  addLook(dx: number, dy: number) {
    if (!this.touchPlaying) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** player input is live: pointer locked, or playing on a gamepad */
  get active() {
    return this.locked || this.padPlaying || this.touchPlaying;
  }

  /** any of the movement keys held */
  movementKeysHeld() {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space']) if (this.keys.has(k)) return true;
    return false;
  }

  /**
   * Resolves true once the pointer is locked, false if the browser refused. With the raw mouse
   * input setting on, asks for `unadjustedMovement` first (Chromium: raw sensor counts, no OS
   * pointer acceleration); a browser / OS that doesn't support it (NotSupportedError) gets a plain
   * lock instead. Firefox and Safari ignore the option.
   */
  async requestLock(): Promise<boolean> {
    if (settings.current.rawMouseInput) {
      const r = await this.lockOnce(true);
      if (r !== 'unsupported') return r === 'ok';
    }
    return (await this.lockOnce(false)) === 'ok';
  }

  private lockOnce(unadjusted: boolean): Promise<'ok' | 'fail' | 'unsupported'> {
    return new Promise((resolve) => {
      let done = false;
      let promised = false;
      const finish = (r: 'ok' | 'fail' | 'unsupported') => {
        if (done) return;
        done = true;
        document.removeEventListener('pointerlockerror', onErr);
        if (r === 'ok') this.rawMouse = unadjusted && promised;
        resolve(r);
      };
      const onErr = () => {
        // promise-returning browsers report through the promise (the error event can arrive late)
        if (!promised) finish('fail');
      };
      document.addEventListener('pointerlockerror', onErr);
      const kind = (err: unknown) => ((err as { name?: string } | null)?.name === 'NotSupportedError' ? 'unsupported' : 'fail');
      try {
        const req = this.element.requestPointerLock as (opts?: { unadjustedMovement?: boolean }) => Promise<void> | undefined;
        const p = unadjusted ? req.call(this.element, { unadjustedMovement: true }) : req.call(this.element);
        if (p && typeof p.then === 'function') {
          promised = true;
          p.then(
            () => finish('ok'),
            (err: unknown) => finish(kind(err)),
          );
        }
      } catch (err) {
        finish(kind(err));
      }
      // older browsers (no promise): judge by pointerLockElement shortly after; a promise that
      // never settles gets the same check a little later
      setTimeout(() => finish(document.pointerLockElement === this.element ? 'ok' : 'fail'), promised ? 1500 : 400);
    });
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  onLockChange(cb: (locked: boolean) => void) {
    this.lockListeners.push(cb);
  }

  isDown(code: string) {
    return this.keys.has(code);
  }

  /** true once per key press; call endFrame() each frame */
  wasPressed(code: string) {
    return this.pressed.has(code);
  }

  wasClicked() {
    return this.mouseClicked;
  }

  wasRightClicked() {
    return this.rightClicked;
  }

  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.mouseClicked = false;
    this.rightClicked = false;
  }
}

/** fold the touch controls into the gamepad state (a real pad keeps priority on the sticks) */
function mergeTouch(pad: PadState, t: TouchFrame) {
  if (pad.move[0] === 0 && pad.move[1] === 0) pad.move = t.move;
  pad.fire ||= t.fire;
  pad.ads ||= t.ads;
  pad.crouch ||= t.crouch;
  pad.jumpPressed ||= t.jumpPressed;
  pad.crouchPressed ||= t.crouchPressed;
  pad.reloadPressed ||= t.reloadPressed;
  if (t.fire || t.jumpPressed || t.move[0] !== 0 || t.move[1] !== 0) pad.active = true;
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
