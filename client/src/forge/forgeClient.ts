// Forge client SDK: streams LLM-designed weapons from the forge service (POST /api/forge/generate,
// NDJSON) and keeps the editing session state (variants, lock / reject, reprompts).
//
//   const session = new ForgeSession({ onChange: s => render(s), onEvent: ev => animate(ev) });
//   await session.generate('a crocodile rocket launcher', { variants: 2 });
//   session.pick(1); session.lock(['jaw-top']); session.reject(['tail']);
//   await session.generate('make it chrome');              // reprompt: locked kept, rejected avoided
//   conn.reducers.registerDesign({ designJson: JSON.stringify(session.design), prompt });
//
// Rendering: import { buildDesign } from '@ai-gaem/shared/forge/build' (THREE.Group, origin = grip).
import {
  FORGE_API_PATH,
  applyEdit,
  type Component,
  type DesignEditInput,
  type DesignFx,
  type DesignPalette,
  type DesignStats,
  type FireMode,
  type ForgeDesign,
  type ForgeEvent,
  type ForgeGenerateRequest,
  type ProjectileDesign,
  normalizePrompt,
  projectileRejectKey,
} from '@ai-gaem/shared';
import type { ForgedInfo } from '../net/NetClient';

/** Where the session's current design came from (prompt cache / "First forged"). */
export interface ForgeOrigin {
  prompt: string;
  /** normalizePrompt(prompt) */
  norm: string;
  /** forged straight from the prompt: no previous design, locks or rejects (cache-worthy) */
  fresh: boolean;
  /** reused from the prompt cache (forged_prompt): equip with use_forged, no new weapon row */
  cached?: ForgedInfo;
}

/** Prompt cache lookup: the first design forged from a normalized prompt, if any. */
export type ForgeCacheLookup = (norm: string) => Promise<{ design: ForgeDesign; info: ForgedInfo } | null>;

export type ForgeErrorKind = 'rate' | 'http' | 'network' | 'timeout' | 'stream' | 'aborted';

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly kind: ForgeErrorKind,
    readonly status = 0,
    /** seconds (rate limit) */
    readonly retryAfter = 0,
  ) {
    super(message);
  }
}

/** Human-friendly one-liner for an error from the forge. */
export function describeForgeError(e: unknown): string {
  if (e instanceof ForgeError) {
    if (e.kind === 'rate') {
      const m = Math.floor(e.retryAfter / 60);
      const s = e.retryAfter % 60;
      const wait = e.retryAfter > 0 ? ` Try again in ${m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`}.` : '';
      return `Forge limit reached (100 per 10 min).${wait}`;
    }
    if (e.kind === 'timeout') return 'Forge timed out. Try again.';
    if (e.kind === 'network') return 'Can’t reach the forge. Check your connection.';
    if (e.kind === 'aborted') return 'Cancelled.';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export interface StreamOptions {
  signal?: AbortSignal;
  baseUrl?: string;
  /** abort when no bytes arrive for this long (ms) */
  idleTimeoutMs?: number;
}

/** POST /api/forge/generate and call `onEvent` for every NDJSON event as it arrives. */
export async function streamForge(req: ForgeGenerateRequest, onEvent: (ev: ForgeEvent) => void, opts: StreamOptions = {}): Promise<void> {
  const ac = new AbortController();
  const outer = opts.signal;
  const onOuter = () => ac.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) ac.abort(outer.reason);
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const idle = opts.idleTimeoutMs ?? 60_000;
  const bump = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      ac.abort(new Error('timeout'));
    }, idle);
  };
  bump();
  try {
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl ?? ''}${FORGE_API_PATH}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: ac.signal,
      });
    } catch (e) {
      if (timedOut) throw new ForgeError('forge timeout', 'timeout');
      if (ac.signal.aborted) throw new ForgeError('cancelled', 'aborted');
      throw new ForgeError(e instanceof Error ? e.message : String(e), 'network');
    }
    if (!res.ok || !res.body) {
      let msg = `forge HTTP ${res.status}`;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* not json */
      }
      if (res.status === 429) throw new ForgeError(msg, 'rate', 429, Number(res.headers.get('retry-after') ?? 0) || 0);
      // proxies answer 502/503/504 when the service is down
      throw new ForgeError(msg, res.status >= 502 && res.status <= 504 ? 'network' : 'http', res.status);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const parse = (line: string) => {
      try {
        onEvent(JSON.parse(line) as ForgeEvent);
      } catch (e) {
        if (e instanceof SyntaxError) throw new ForgeError('Bad response from the forge. Try again.', 'stream');
        throw e;
      }
    };
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        if (timedOut) throw new ForgeError('forge timeout', 'timeout');
        if (ac.signal.aborted) throw new ForgeError('cancelled', 'aborted');
        throw new ForgeError('Lost connection to the forge.', 'network');
      }
      if (chunk.done) break;
      bump();
      buf += dec.decode(chunk.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) parse(line);
      }
    }
    if (buf.trim()) parse(buf.trim());
  } finally {
    clearTimeout(idleTimer);
    outer?.removeEventListener('abort', onOuter);
  }
}

/** A variant while streaming: meta + components arrive first, `design` once done. */
export interface ForgeDraft {
  name: string;
  class: string;
  fireMode?: FireMode;
  palette?: DesignPalette;
  fx?: DesignFx;
  stats?: DesignStats;
  components: Component[];
  projectile?: ProjectileDesign;
  design: ForgeDesign | null;
  warnings: string[];
  error: string | null;
}

export interface ForgeSessionState {
  busy: boolean;
  drafts: ForgeDraft[];
  /** the design being edited (picked variant) */
  design: ForgeDesign | null;
  /** index of the picked draft (-1 = none / seeded design) */
  picked: number;
  rejected: string[];
  error: string | null;
  errorDetail: ForgeError | null;
  /** service answered in mock mode */
  mock: boolean;
  /** provenance of `design` (null for seeded / edited-away designs) */
  origin: ForgeOrigin | null;
}

export interface ForgeSessionOptions {
  onChange?: (s: ForgeSessionState) => void;
  /** raw events (after the state was updated) */
  onEvent?: (ev: ForgeEvent) => void;
  playerIdentity?: string;
  baseUrl?: string;
  idleTimeoutMs?: number;
  /** prompt cache (plain prompts: no locks / rejects, one variant) */
  cacheLookup?: ForgeCacheLookup;
}

export class ForgeSession {
  state: ForgeSessionState = { busy: false, drafts: [], design: null, picked: -1, rejected: [], error: null, errorDetail: null, mock: false, origin: null };
  private ac: AbortController | null = null;

  constructor(private opts: ForgeSessionOptions = {}) {}

  get design(): ForgeDesign | null {
    return this.state.design;
  }

  private set(patch: Partial<ForgeSessionState>) {
    this.state = { ...this.state, ...patch };
    this.opts.onChange?.(this.state);
  }

  /** start editing an existing design (remix / current loadout) */
  seed(design: ForgeDesign | null) {
    this.set({ design, drafts: [], picked: -1, error: null, errorDetail: null, origin: null });
  }

  /** New generation / reprompt. Locked components of the current design are kept verbatim. */
  async generate(prompt: string, o: { variants?: number; class?: string } = {}): Promise<void> {
    this.ac?.abort();
    const ac = (this.ac = new AbortController());
    const prev = this.state.design;
    const variants = Math.max(1, Math.min(3, o.variants ?? 1));
    const drafts: ForgeDraft[] = [];
    const locked = prev?.components.filter((c) => c.locked) ?? [];
    const marked = locked.length > 0 || !!prev?.projectile?.locked || this.state.rejected.length > 0;
    const norm = normalizePrompt(prompt);
    const origin: ForgeOrigin = { prompt, norm, fresh: !prev && !marked };
    this.set({ busy: true, drafts, error: null, errorDetail: null, picked: -1 });
    // prompt cache: same prompt, nothing kept / rejected, one variant -> the first forge, instantly
    if (norm && !marked && variants === 1 && !o.class && this.opts.cacheLookup) {
      const hit = await this.opts.cacheLookup(norm).catch(() => null);
      if (ac.signal.aborted) return;
      if (hit) {
        const d = hit.design;
        drafts[0] = { name: d.name, class: d.class, fireMode: d.fireMode, palette: d.palette, fx: d.fx, stats: d.stats, components: d.components, projectile: d.projectile, design: d, warnings: [], error: null };
        this.ac = null;
        this.set({ busy: false, drafts: [...drafts], design: d, picked: 0, origin: { ...origin, fresh: false, cached: hit.info } });
        this.opts.onEvent?.({ type: 'done', variant: 0, design: d, warnings: [] });
        return;
      }
    }
    const draft = (v: number) => (drafts[v] ??= { name: '', class: '', components: [], design: null, warnings: [], error: null });
    try {
      await streamForge(
        {
          prompt,
          class: o.class,
          variants,
          previous: prev ?? undefined,
          locked,
          lockedProjectile: prev?.projectile?.locked ? prev.projectile : undefined,
          rejected: this.state.rejected,
          playerIdentity: this.opts.playerIdentity,
        },
        (ev) => {
          if (ac.signal.aborted) return;
          if (ev.type === 'start') {
            this.set({ mock: ev.mock });
            for (let i = 0; i < ev.variants; i++) draft(i);
            this.set({ drafts: [...drafts] });
            this.opts.onEvent?.(ev);
            return;
          }
          if (ev.variant < 0) {
            this.opts.onEvent?.(ev);
            return;
          }
          const d = draft(ev.variant);
          if (ev.type === 'meta') Object.assign(d, { name: ev.name, class: ev.class, fireMode: ev.fireMode, palette: ev.palette, fx: ev.fx });
          else if (ev.type === 'component') d.components = [...d.components, ev.component];
          else if (ev.type === 'projectile') d.projectile = ev.projectile;
          else if (ev.type === 'stats') d.stats = ev.stats;
          else if (ev.type === 'done')
            Object.assign(d, { design: ev.design, warnings: ev.warnings, components: ev.design.components, projectile: ev.design.projectile, stats: ev.design.stats, name: ev.design.name, class: ev.design.class });
          else if (ev.type === 'error') d.error = ev.message;
          drafts[ev.variant] = { ...d };
          this.set({ drafts: [...drafts] });
          // single variant: edit it right away; with several, the first finished one is picked
          // (the UI can pick another)
          if (ev.type === 'done' && (variants === 1 || this.state.picked < 0)) this.set({ design: ev.design, picked: ev.variant, origin });
          this.opts.onEvent?.(ev);
        },
        { signal: ac.signal, baseUrl: this.opts.baseUrl, idleTimeoutMs: this.opts.idleTimeoutMs },
      );
      if (!ac.signal.aborted && drafts.length && drafts.every((d) => !d.design)) {
        const msg = drafts.find((d) => d.error)?.error ?? 'the forge produced nothing';
        this.set({ error: msg, errorDetail: new ForgeError(msg, 'stream') });
      }
    } catch (e) {
      const fe = e instanceof ForgeError ? e : new ForgeError(e instanceof Error ? e.message : String(e), 'stream');
      if (fe.kind !== 'aborted' && !(ac.signal.aborted && this.ac !== ac)) this.set({ error: describeForgeError(fe), errorDetail: fe });
    } finally {
      if (this.ac === ac) {
        this.ac = null;
        this.set({ busy: false });
      }
    }
  }

  /** Choose a finished variant to edit. */
  pick(variant: number): void {
    const d = this.state.drafts[variant]?.design;
    if (d) this.set({ design: d, picked: variant, origin: this.state.origin ? { ...this.state.origin, cached: undefined } : null });
  }

  edit(e: DesignEditInput): string[] {
    if (!this.state.design) return ['no design'];
    const r = applyEdit(this.state.design, e);
    const rejected = [...this.state.rejected, ...r.removed.map((c) => c.label), ...(r.removedProjectile ? [projectileRejectKey(r.removedProjectile.label)] : [])].slice(-32);
    // removing parts makes it a different weapon (no longer the prompt's plain forge)
    const changed = r.removed.length > 0 || !!r.removedProjectile;
    const origin = changed && this.state.origin ? { ...this.state.origin, fresh: false, cached: undefined } : this.state.origin;
    this.set({ design: r.design, rejected, origin });
    return r.warnings;
  }

  lock(ids: string[]) {
    return this.edit({ lock: ids });
  }
  unlock(ids: string[]) {
    return this.edit({ unlock: ids });
  }
  reject(ids: string[]) {
    return this.edit({ reject: ids });
  }

  cancel(): void {
    const ac = this.ac;
    if (!ac) return;
    ac.abort(new Error('cancelled'));
    this.ac = null;
    this.set({ busy: false });
  }
}
