/**
 * Gamepad (standard mapping) polled once per frame:
 *   left stick move, right stick look, RT fire, LT aim / heavy attack, A jump, B crouch,
 *   X reload, L3 sprint, RB block, Start menu.
 * Sticks use a radial deadzone; look additionally uses a response curve (fine aim near the
 * centre, fast turns at full deflection).
 */
export interface PadState {
  connected: boolean;
  /** left stick after deadzone: x right, y forward (+ = push up) */
  move: [number, number];
  /** right stick after deadzone + curve: x right, y up */
  look: [number, number];
  fire: boolean;
  ads: boolean;
  block: boolean;
  crouch: boolean;
  jumpPressed: boolean;
  crouchPressed: boolean;
  reloadPressed: boolean;
  sprintPressed: boolean;
  startPressed: boolean;
  /** any input this frame (buttons or sticks past the deadzone) */
  active: boolean;
}

export const emptyPad = (): PadState => ({
  connected: false,
  move: [0, 0],
  look: [0, 0],
  fire: false,
  ads: false,
  block: false,
  crouch: false,
  jumpPressed: false,
  crouchPressed: false,
  reloadPressed: false,
  sprintPressed: false,
  startPressed: false,
  active: false,
});

const LOOK_CURVE = 1.8;
const TRIGGER = 0.35;

/** radial deadzone, rescaled to 0..1 past it, with an optional response exponent */
export function applyDeadzone(x: number, y: number, dz: number, curve = 1): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag <= dz || mag === 0) return [0, 0];
  const m = Math.min(1, (mag - dz) / (1 - dz));
  const k = Math.pow(m, curve) / mag;
  return [x * k, y * k];
}

export class GamepadPoller {
  state: PadState = emptyPad();
  private prev = new Map<number, boolean>();

  poll(deadzone: number): PadState {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected && p.mapping === 'standard') ?? [...pads].find((p) => p && p.connected);
    if (!gp) {
      this.state = emptyPad();
      return this.state;
    }
    const b = (i: number) => {
      const btn = gp.buttons[i];
      return !!btn && (btn.pressed || btn.value > TRIGGER);
    };
    const edge = (i: number) => {
      const now = b(i);
      const was = this.prev.get(i) ?? false;
      this.prev.set(i, now);
      return now && !was;
    };
    const ax = (i: number) => gp.axes[i] ?? 0;
    const move = applyDeadzone(ax(0), -ax(1), deadzone);
    const look = applyDeadzone(ax(2), -ax(3), deadzone, LOOK_CURVE);
    const s: PadState = {
      connected: true,
      move,
      look,
      fire: b(7),
      ads: b(6),
      block: b(5),
      crouch: b(1),
      jumpPressed: edge(0),
      crouchPressed: edge(1),
      reloadPressed: edge(2),
      sprintPressed: edge(10),
      startPressed: edge(9),
      active: false,
    };
    // keep the remaining edges' history fresh
    for (const i of [3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15]) edge(i);
    s.active = gp.buttons.some((x) => x.pressed) || move[0] !== 0 || move[1] !== 0 || look[0] !== 0 || look[1] !== 0;
    this.state = s;
    return s;
  }
}
