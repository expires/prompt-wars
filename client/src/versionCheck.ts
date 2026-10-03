/**
 * Stale-client guard: /version.json is written by the build (and uploaded with index.html at
 * deploy). Polled every 60 s and on demand (after a reconnect); when the deployed version differs
 * from the running one, `onNew` fires once per new version.
 */
import { APP_VERSION } from './telemetry';

const EVERY_MS = 60_000;
let timer: ReturnType<typeof setInterval> | undefined;
let notified = '';
let handler: ((v: string) => void) | null = null;

export async function checkVersion(): Promise<string | null> {
  if (APP_VERSION === 'dev') return null;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: unknown };
    const v = typeof j.version === 'string' ? j.version : null;
    if (v && v !== APP_VERSION && v !== notified) {
      notified = v;
      handler?.(v);
    }
    return v;
  } catch {
    return null;
  }
}

export function startVersionCheck(onNew: (v: string) => void) {
  handler = onNew;
  if (timer || APP_VERSION === 'dev') return;
  timer = setInterval(() => void checkVersion(), EVERY_MS);
  // tabs left in the background come back to a possibly-new deploy
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkVersion();
  });
}
