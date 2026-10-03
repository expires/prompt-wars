/**
 * Client crash telemetry. Catches uncaught errors / promise rejections, WebGL context loss, Rapier
 * wasm panics, websocket closes and per-frame exceptions, plus a periodic memory snapshot, and POSTs
 * small JSON reports to the forge service (POST /api/forge/telemetry -> a JSONL log on the VPS; read
 * it with scripts/client-errors.sh).
 *
 * Privacy: only the display name, the first 12 hex chars of the identity, the user agent, the GPU
 * renderer string and the page version are sent. Rate limited (per minute + per session) and deduped.
 *
 * Off in dev builds and automated browsers unless `?telemetry=1`; `?telemetry=0` forces it off.
 *
 * Tab crash detection: a heartbeat (with the latest memory snapshot) is written to localStorage every
 * 10 s and cleared on a clean page hide; if the next page load finds a fresh heartbeat that was never
 * cleared, the previous tab died (OOM / GPU process crash / renderer kill) and a `prevcrash` report
 * carries the last snapshot.
 */
import type * as THREE from 'three';

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const ENDPOINT = '/api/forge/telemetry';
const HB_KEY = 'ai-gaem.hb';
const HB_EVERY_MS = 10_000;
const MEM_EVERY_MS = 120_000;
const FLUSH_EVERY_MS = 4_000;
/** reports per rolling minute / per page session */
const PER_MIN = 12;
const PER_SESSION = 150;
/** same report (kind + message) at most once per this window; repeats are counted */
const DEDUPE_MS = 60_000;

export type Report = Record<string, unknown> & { kind: string };

interface Context {
  name?: () => string | undefined;
  identity?: () => string | undefined;
  screen?: () => string | undefined;
  renderer?: THREE.WebGLRenderer;
  /** extra live fields on every report (map, players, quality…) */
  extra?: () => Record<string, unknown>;
}

const params = new URLSearchParams(location.search);
const forcedOn = params.get('telemetry') === '1';
const forcedOff = params.get('telemetry') === '0';
const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
const automated = typeof navigator !== 'undefined' && (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
export const telemetryEnabled = !forcedOff && (forcedOn || (!env?.DEV && !automated));

const ctx: Context = {};
const queue: Report[] = [];
const seen = new Map<string, { at: number; repeats: number }>();
const sentTimes: number[] = [];
let sessionSent = 0;
let installed = false;
let gpu = '';
const t0 = performance.now();
/** last websocket close seen (any socket) */
export let lastWsClose: { code: number; reason: string; clean: boolean; host: string; at: number } | null = null;
/** listeners for websocket close events (the net layer logs them with its own context) */
const wsCloseListeners: ((c: NonNullable<typeof lastWsClose>) => void)[] = [];

export function onWebSocketClose(cb: (c: NonNullable<typeof lastWsClose>) => void) {
  wsCloseListeners.push(cb);
}

export function setTelemetryContext(c: Partial<Context>) {
  const first = c.renderer && !ctx.renderer;
  Object.assign(ctx, c);
  if (c.renderer) gpu = gpuString(c.renderer);
  if (first && installed) report('session', { msg: 'start', ref: document.referrer ? safeHost(document.referrer) : '' });
}

function safeHost(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
}

/** GPU vendor / renderer via WEBGL_debug_renderer_info (falls back to the masked strings) */
export function gpuString(renderer?: THREE.WebGLRenderer): string {
  try {
    const gl = renderer?.getContext();
    if (!gl) return gpu;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${vendor} | ${name}`.slice(0, 200);
  } catch {
    return gpu;
  }
}

export function currentGpu() {
  return gpu;
}

/** JS heap (Chromium only) + renderer resource counts */
export function memorySnapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pm = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (pm) {
    out.heapMB = Math.round(pm.usedJSHeapSize / 1048576);
    out.heapTotalMB = Math.round(pm.totalJSHeapSize / 1048576);
    out.heapLimitMB = Math.round(pm.jsHeapSizeLimit / 1048576);
  }
  const r = ctx.renderer;
  if (r) {
    out.geo = r.info.memory.geometries;
    out.tex = r.info.memory.textures;
    out.prog = r.info.programs?.length ?? 0;
    out.calls = r.info.render.calls;
    out.tris = r.info.render.triangles;
  }
  out.upS = Math.round((performance.now() - t0) / 1000);
  return out;
}

function base(): Record<string, unknown> {
  const b: Record<string, unknown> = { v: APP_VERSION, upS: Math.round((performance.now() - t0) / 1000) };
  try {
    const name = ctx.name?.();
    if (name) b.name = name.slice(0, 32);
    const id = ctx.identity?.();
    if (id) b.id = id.slice(0, 12);
    const screen = ctx.screen?.();
    if (screen) b.screen = screen;
    Object.assign(b, ctx.extra?.() ?? {});
  } catch {
    /* context getters must never throw out of telemetry */
  }
  return b;
}

/** Queue a report. `heavy` adds UA + GPU + memory (errors); light ones (mem) stay small. */
export function report(kind: string, data: Record<string, unknown> = {}, opts: { heavy?: boolean; flush?: boolean } = {}) {
  if (!telemetryEnabled) return;
  const msg = String(data.msg ?? '').slice(0, 200);
  const key = `${kind}|${msg}`;
  const now = Date.now();
  const prev = seen.get(key);
  if (prev && now - prev.at < DEDUPE_MS) {
    prev.repeats++;
    return;
  }
  const r: Report = { ...base(), kind, ...data };
  if (prev?.repeats) r.repeats = prev.repeats;
  seen.set(key, { at: now, repeats: 0 });
  if (seen.size > 200) seen.delete(seen.keys().next().value!);
  if (opts.heavy !== false && kind !== 'mem') {
    r.ua = navigator.userAgent.slice(0, 300);
    r.gpu = gpu || gpuString(ctx.renderer);
    r.mem = memorySnapshot();
    const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (dm) r.devMem = dm;
    r.dpr = window.devicePixelRatio;
    r.vw = `${window.innerWidth}x${window.innerHeight}`;
  }
  queue.push(r);
  if (queue.length > 40) queue.splice(0, queue.length - 40);
  if (opts.flush) flush();
}

function allowance(): number {
  const now = Date.now();
  while (sentTimes.length && now - sentTimes[0] > 60_000) sentTimes.shift();
  return Math.max(0, Math.min(PER_MIN - sentTimes.length, PER_SESSION - sessionSent));
}

/** Send queued reports (batched). `beacon` = page is going away: use sendBeacon. */
export function flush(beacon = false) {
  if (!telemetryEnabled || !queue.length) return;
  const n = allowance();
  if (n <= 0) {
    // keep only the newest few for later; drop the rest
    if (queue.length > 10) queue.splice(0, queue.length - 10);
    return;
  }
  const batch = queue.splice(0, Math.min(n, 8));
  const now = Date.now();
  for (let i = 0; i < batch.length; i++) sentTimes.push(now);
  sessionSent += batch.length;
  const body = JSON.stringify({ reports: batch });
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
      return;
    }
    void fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < 60_000 }).catch(() => {});
  } catch {
    /* never throw from telemetry */
  }
}

function errInfo(e: unknown): { msg: string; stack?: string; name?: string } {
  if (e instanceof Error) return { msg: `${e.name}: ${e.message}`.slice(0, 500), stack: e.stack?.slice(0, 1800), name: e.name };
  try {
    return { msg: (typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 500) };
  } catch {
    return { msg: String(e).slice(0, 500) };
  }
}

/** Rapier panics surface as WebAssembly.RuntimeError ("unreachable", "memory access out of bounds") */
export function isWasmPanic(e: unknown): boolean {
  const s = e instanceof Error ? `${e.name} ${e.message} ${e.stack ?? ''}` : String(e);
  return (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) || /RuntimeError|unreachable|rapier|wasm/i.test(s);
}

/** Report a caught exception (frame loop, net callbacks…). */
export function reportError(where: string, e: unknown, extra: Record<string, unknown> = {}) {
  const info = errInfo(e);
  report(isWasmPanic(e) ? 'wasm' : 'error', { where, ...info, ...extra }, { flush: true });
}

/** Watch a canvas for WebGL context loss / restore (reports only; the game handles recovery). */
export function watchCanvas(canvas: HTMLCanvasElement) {
  canvas.addEventListener('webglcontextlost', () => report('contextlost', { msg: 'webglcontextlost' }, { flush: true }));
  canvas.addEventListener('webglcontextrestored', () => report('contextrestored', { msg: 'webglcontextrestored' }, { flush: true }));
  canvas.addEventListener('webglcontextcreationerror', (e) =>
    report('contexterror', { msg: (e as WebGLContextEvent).statusMessage || 'webglcontextcreationerror' }, { flush: true }),
  );
}

/** Wrap the global WebSocket so close codes are seen (the SpacetimeDB SDK drops the CloseEvent). */
function patchWebSocket() {
  const Native = window.WebSocket;
  if (!Native || (Native as unknown as { __tm?: boolean }).__tm) return;
  class TrackedWebSocket extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const opened = performance.now();
      this.addEventListener('close', (ev) => {
        let host = '';
        try {
          host = new URL(String(url)).host;
        } catch {
          /* ignore */
        }
        lastWsClose = { code: ev.code, reason: (ev.reason || '').slice(0, 200), clean: ev.wasClean, host, at: Date.now() };
        const info = { ...lastWsClose, openS: Math.round((performance.now() - opened) / 1000) };
        for (const cb of wsCloseListeners) {
          try {
            cb(info);
          } catch {
            /* ignore */
          }
        }
      });
    }
  }
  (TrackedWebSocket as unknown as { __tm: boolean }).__tm = true;
  window.WebSocket = TrackedWebSocket as unknown as typeof WebSocket;
}

/** per-tab id (sessionStorage survives a reload of the same tab, incl. Chrome's "reload crashed tab") */
const TAB_ID = (() => {
  try {
    let id = sessionStorage.getItem('ai-gaem.tab');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('ai-gaem.tab', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();

type Heartbeat = Record<string, unknown> & { at: number };
type Heartbeats = Record<string, Heartbeat>;

function readHeartbeats(): Heartbeats {
  try {
    const raw = localStorage.getItem(HB_KEY);
    const v = raw ? (JSON.parse(raw) as Heartbeats) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function saveHeartbeats(h: Heartbeats) {
  try {
    if (Object.keys(h).length) localStorage.setItem(HB_KEY, JSON.stringify(h));
    else localStorage.removeItem(HB_KEY);
  } catch {
    /* storage unavailable */
  }
}

function writeHeartbeat() {
  const h = readHeartbeats();
  h[TAB_ID] = { at: Date.now(), ...base(), mem: memorySnapshot() };
  saveHeartbeats(h);
}

function clearHeartbeat() {
  const h = readHeartbeats();
  delete h[TAB_ID];
  saveHeartbeats(h);
}

/**
 * Heartbeats left behind by tabs that died: this tab's own (reloaded after a crash) at any age, or
 * another tab's that is stale (> 75 s: hidden tabs' timers may run only once a minute) but recent.
 */
function collectCrashedHeartbeats(): Heartbeat[] {
  const h = readHeartbeats();
  const now = Date.now();
  const out: Heartbeat[] = [];
  for (const [id, hb] of Object.entries(h)) {
    const age = now - (typeof hb?.at === 'number' ? hb.at : 0);
    if (age > 10 * 60_000) delete h[id];
    else if (id === TAB_ID || age > 75_000) {
      out.push(hb);
      delete h[id];
    }
  }
  saveHeartbeats(h);
  return out;
}

/** Install the global handlers (once, as early as possible). */
export function installTelemetry() {
  if (installed) return;
  installed = true;
  patchWebSocket();
  if (!telemetryEnabled) return;

  window.addEventListener('error', (ev) => {
    // resource load errors (img/script) have no `error` and target != window
    if (!(ev instanceof ErrorEvent)) return;
    const info = ev.error ? errInfo(ev.error) : { msg: String(ev.message).slice(0, 500) };
    report(isWasmPanic(ev.error ?? ev.message) ? 'wasm' : 'error', { where: 'window.onerror', ...info, src: `${ev.filename}:${ev.lineno}:${ev.colno}`.slice(-200) }, { flush: true });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const info = errInfo(ev.reason);
    report(isWasmPanic(ev.reason) ? 'wasm' : 'rejection', { where: 'unhandledrejection', ...info });
  });

  // previous tab died without a clean page hide?
  for (const hb of collectCrashedHeartbeats().slice(0, 3)) {
    const { at, ...last } = hb;
    report('prevcrash', { msg: 'previous session ended without pagehide (tab crash / OOM / killed)', agoS: Math.round((Date.now() - at) / 1000), last });
  }
  writeHeartbeat();
  setInterval(writeHeartbeat, HB_EVERY_MS);
  setInterval(() => report('mem', memorySnapshot(), { heavy: false }), MEM_EVERY_MS);
  setInterval(() => flush(), FLUSH_EVERY_MS);
  // a clean exit (reload / close / navigate) clears the heartbeat; bfcache restore re-arms it
  window.addEventListener('pagehide', () => {
    clearHeartbeat();
    flush(true);
  });
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) writeHeartbeat();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  // the session report waits for the renderer (GPU string); boot failures report on their own
}
