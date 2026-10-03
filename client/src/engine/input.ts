/** Keyboard + mouse state with pointer lock. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = false;
  private mouseClicked = false;
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
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || e.button !== 0) return;
      this.mouseDown = true;
      this.mouseClicked = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.mouseDown = false;
        this.keys.clear();
      }
      this.lockListeners.forEach((cb) => cb(this.locked));
    });
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

  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.mouseClicked = false;
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
