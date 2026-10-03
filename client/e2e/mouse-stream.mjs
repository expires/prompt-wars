// High-polling-rate mouse simulation, shared by e2e/mouse-input.spec.ts and e2e/measure-mouse.mjs.
//
// Headless browsers can't grant a real pointer lock, so the page's Input is told it is locked and
// synthetic `mousemove` events carrying movementX/Y are dispatched on `document`: they go through
// the game's real listener exactly like a gaming mouse's events would. The stream runs at `hz`
// events per second (in catch-up batches from a timer loop, the way a busy main thread receives a
// 1-8 kHz mouse), with small 0-3 count deltas (micro-adjustments).

/**
 * Runs in the page (pass to page.evaluate). Works on builds with or without the
 * `emulatePointerLock` test hook (falls back to `window.game.input.locked`).
 * @param {{ hz: number; ms: number; seed?: number }} opts
 */
export function streamMouseInPage(opts) {
  const { hz, ms } = opts;
  const g = window.__game;
  const game = window.game;
  const lock = (on) => (g.emulatePointerLock ? g.emulatePointerLock(on) : (game.input.locked = on));
  // no ADS / zoom: sensitivity = BASE (0.0022 rad/count) x setting
  const sensSetting = (() => {
    try {
      return JSON.parse(localStorage.getItem('ai-gaem.settings') || '{}').sensitivity ?? 1;
    } catch {
      return 1;
    }
  })();
  const sens = 0.0022 * sensSetting;
  let seed = opts.seed ?? 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  return new Promise((resolve) => {
    lock(true);
    // let a frame consume anything pending, then start from a clean yaw
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const yaw0 = g.getState().yaw;
        const pitch0 = g.getState().pitch;
        let sumX = 0;
        let sumY = 0;
        let sent = 0;
        let dispatchMs = 0;
        const frameTimes = [];
        let lastFrame = performance.now();
        let running = true;
        let inactiveFrames = 0;
        const onFrame = (t) => {
          if (game && !(game.alive && game.input.locked)) inactiveFrames++;
          frameTimes.push(t - lastFrame);
          lastFrame = t;
          if (running) requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
        const t0 = performance.now();
        const pump = () => {
          const now = performance.now();
          const due = Math.min(Math.floor(((now - t0) / 1000) * hz), Math.floor((ms / 1000) * hz));
          const a = performance.now();
          while (sent < due) {
            const dx = Math.floor(rnd() * 4); // 0..3 counts, mostly to the right
            const dy = Math.floor(rnd() * 3) - 1; // -1..1
            document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true }));
            sumX += dx;
            sumY += dy;
            sent++;
          }
          dispatchMs += performance.now() - a;
          if (now - t0 < ms) setTimeout(pump, 0);
          else finish();
        };
        const finish = () => {
          // two frames so the last batch is applied by frameInput()
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              running = false;
              const s = g.getState();
              lock(false);
              const elapsed = performance.now() - t0;
              const sorted = frameTimes.slice(1).sort((x, y) => x - y);
              const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
              const expectedYaw = yaw0 - sumX * sens;
              const expectedPitch = pitch0 - sumY * sens;
              resolve({
                hz,
                events: sent,
                eventsPerSec: Math.round((sent * 1000) / elapsed),
                sumX,
                sumY,
                yawDelta: s.yaw - yaw0,
                expectedYawDelta: expectedYaw - yaw0,
                yawError: s.yaw - expectedYaw,
                pitchError: s.pitch - expectedPitch,
                // dispatch + listener cost per event (upper bound on the handler cost: includes
                // constructing the synthetic MouseEvent and the browser's dispatch machinery)
                usPerEvent: (dispatchMs * 1000) / Math.max(1, sent),
                fps: Math.round((frameTimes.length * 1000) / elapsed),
                frameMsP50: pct(0.5),
                frameMsP99: pct(0.99),
                frameMsMax: sorted[sorted.length - 1] ?? 0,
                perf: g.perfStats ? g.perfStats() : null,
                // frames where the player was dead / unlocked (look input is discarded then)
                inactiveFrames,
                alive: s.alive,
                screen: s.screen,
              });
            }),
          );
        };
        pump();
      }),
    );
  });
}

/** Runs in the page: wait for the game to be playable offline (alive, ready). */
export function gameReadyInPage() {
  const w = window;
  if (w.__gameError) throw new Error(w.__gameError);
  const s = w.__game?.getState?.();
  return !!s && s.ready && s.alive;
}
