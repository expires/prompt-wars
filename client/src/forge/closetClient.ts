// Closet client: streams LLM-designed outfits from the forge service (POST /api/forge/outfit,
// NDJSON; same transport, rate limit and cache as weapons) and keeps the editing state
// (lock / reject pieces, body sliders, reprompts).
import {
  OUTFIT_API_PATH,
  applyOutfitEdit,
  sanitizeOutfit,
  type OutfitBody,
  type OutfitDesign,
  type OutfitEdit,
  type OutfitEvent,
  type OutfitGenerateRequest,
  type OutfitPiece,
} from '@ai-gaem/shared';
import type { DesignPalette } from '@ai-gaem/shared';
import { ForgeError, describeForgeError, streamForge } from './forgeClient';

export interface OutfitDraft {
  name: string;
  theme: string;
  body?: OutfitBody;
  skin?: string;
  palette?: DesignPalette;
  pieces: OutfitPiece[];
  outfit: OutfitDesign | null;
  warnings: string[];
  error: string | null;
}

export interface OutfitSessionState {
  busy: boolean;
  /** the streaming draft (null when idle) */
  draft: OutfitDraft | null;
  /** the outfit being edited */
  outfit: OutfitDesign | null;
  rejected: string[];
  error: string | null;
  errorDetail: ForgeError | null;
  mock: boolean;
  /** prompt of the current outfit */
  prompt: string;
}

export interface OutfitSessionOptions {
  onChange?: (s: OutfitSessionState) => void;
  onEvent?: (ev: OutfitEvent) => void;
  playerIdentity?: string;
  baseUrl?: string;
  idleTimeoutMs?: number;
}

/** A streaming draft as a renderable outfit (pieces so far on its body). */
export function draftOutfit(d: OutfitDraft, fallback: OutfitDesign | null): OutfitDesign | null {
  if (d.outfit) return d.outfit;
  if (!d.body && !fallback) return null;
  return sanitizeOutfit({ v: 1, name: d.name || 'Fitting…', theme: d.theme, body: d.body ?? fallback?.body, skin: d.skin ?? fallback?.skin, palette: d.palette ?? fallback?.palette, pieces: d.pieces }).outfit;
}

export class OutfitSession {
  state: OutfitSessionState = { busy: false, draft: null, outfit: null, rejected: [], error: null, errorDetail: null, mock: false, prompt: '' };
  private ac: AbortController | null = null;

  constructor(private opts: OutfitSessionOptions = {}) {}

  get outfit(): OutfitDesign | null {
    return this.state.outfit;
  }

  private set(patch: Partial<OutfitSessionState>) {
    this.state = { ...this.state, ...patch };
    this.opts.onChange?.(this.state);
  }

  seed(outfit: OutfitDesign | null, prompt = '') {
    this.set({ outfit, draft: null, error: null, errorDetail: null, prompt });
  }

  async generate(prompt: string): Promise<void> {
    this.ac?.abort();
    const ac = (this.ac = new AbortController());
    const prev = this.state.outfit;
    const locked = prev?.pieces.filter((p) => p.locked) ?? [];
    const draft: OutfitDraft = { name: '', theme: '', pieces: [], outfit: null, warnings: [], error: null };
    this.set({ busy: true, draft, error: null, errorDetail: null });
    const req: OutfitGenerateRequest = { prompt, previous: prev ?? undefined, locked, rejected: this.state.rejected, playerIdentity: this.opts.playerIdentity };
    try {
      await streamForge(
        req as never,
        (raw) => {
          if (ac.signal.aborted) return;
          const ev = raw as unknown as OutfitEvent;
          if (ev.type === 'start') this.set({ mock: ev.mock });
          else if (ev.type === 'meta') Object.assign(draft, { name: ev.name, theme: ev.theme, body: ev.body, skin: ev.skin, palette: ev.palette });
          else if (ev.type === 'piece') draft.pieces = [...draft.pieces, ev.piece];
          else if (ev.type === 'done') Object.assign(draft, { outfit: ev.outfit, warnings: ev.warnings, pieces: ev.outfit.pieces, name: ev.outfit.name });
          else if (ev.type === 'error') draft.error = ev.message;
          if (ev.type === 'done') this.set({ draft: { ...draft }, outfit: ev.outfit, prompt });
          else this.set({ draft: { ...draft } });
          this.opts.onEvent?.(ev);
        },
        { signal: ac.signal, baseUrl: this.opts.baseUrl, idleTimeoutMs: this.opts.idleTimeoutMs, path: OUTFIT_API_PATH },
      );
      if (!ac.signal.aborted && !draft.outfit) {
        const msg = draft.error ?? 'the closet produced nothing';
        this.set({ error: msg, errorDetail: new ForgeError(msg, 'stream') });
      }
    } catch (e) {
      const fe = e instanceof ForgeError ? e : new ForgeError(e instanceof Error ? e.message : String(e), 'stream');
      if (fe.kind !== 'aborted' && !(ac.signal.aborted && this.ac !== ac)) this.set({ error: describeForgeError(fe), errorDetail: fe });
    } finally {
      if (this.ac === ac) {
        this.ac = null;
        this.set({ busy: false, draft: null });
      }
    }
  }

  edit(e: OutfitEdit) {
    if (!this.state.outfit) return;
    const r = applyOutfitEdit(this.state.outfit, e);
    const rejected = [...this.state.rejected, ...r.removed.map((p) => p.label)].slice(-32);
    this.set({ outfit: r.outfit, rejected });
  }

  lock(ids: string[]) {
    this.edit({ lock: ids });
  }
  unlock(ids: string[]) {
    this.edit({ unlock: ids });
  }
  reject(ids: string[]) {
    this.edit({ reject: ids });
  }

  cancel() {
    const ac = this.ac;
    if (!ac) return;
    ac.abort(new Error('cancelled'));
    this.ac = null;
    this.set({ busy: false, draft: null });
  }
}
