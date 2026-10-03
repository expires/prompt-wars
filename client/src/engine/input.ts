import { GamepadPoller, emptyPad, type PadState } from './gamepad';

/** Keyboard + mouse state with pointer lock, plus a polled gamepad. */
export class Input {
  private readonly poller = new GamepadPoller();
  /** this frame's gamepad state (see pollGamepad) */
  pad: PadState = emptyPad();
  /** playing with the gamepad without pointer lock (Start / A on the pause screen) */
  padPlaying = false;
  /** performance.now() of the last mouse movement while locked (trackpad hint heuristic) */
  lastMouseMoveAt = 0;
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
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
      if (e.movementX || e.movementY) this.lastMouseMoveAt = performance.now();
    });
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
    return this.pad;
  }

  /** player input is live: pointer locked, or playing on a gamepad */
  get active() {
    return this.locked || this.padPlaying;
  }

  /** any of the movement keys held */
  movementKeysHeld() {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space']) if (this.keys.has(k)) return true;
    return false;
  }

  requestLock() {
    const p = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
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

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
