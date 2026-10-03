// Forge client SDK (not wired into the game yet; for the editor UI).
//
//   const session = new ForgeSession({ onChange: s => render(s) });
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
  type ForgeDesign,
  type ForgeEvent,
  type ForgeGenerateRequest,
} from '@ai-gaem/shared/forge';

/** POST /api/forge/generate and call `onEvent` for every NDJSON event as it arrives. */
export async function streamForge(
  req: ForgeGenerateRequest,
  onEvent: (ev: ForgeEvent) => void,
  opts: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<void> {
  const res = await fetch(`${opts.baseUrl ?? ''}${FORGE_API_PATH}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let msg = `forge HTTP ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line) as ForgeEvent);
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as ForgeEvent);
}

/** A variant while streaming: meta + components arrive first, `design` once done. */
export interface ForgeDraft {
  name: string;
  class: string;
  components: Component[];
  design: ForgeDesign | null;
  warnings: string[];
  error: string | null;
}

export interface ForgeSessionState {
  busy: boolean;
  drafts: ForgeDraft[];
  /** the design being edited (picked variant) */
  design: ForgeDesign | null;
  rejected: string[];
  error: string | null;
}

export class ForgeSession {
  state: ForgeSessionState = { busy: false, drafts: [], design: null, rejected: [], error: null };
  private ac: AbortController | null = null;

  constructor(private opts: { onChange?: (s: ForgeSessionState) => void; playerIdentity?: string; baseUrl?: string } = {}) {}

  get design(): ForgeDesign | null {
    return this.state.design;
  }

  private set(patch: Partial<ForgeSessionState>) {
    this.state = { ...this.state, ...patch };
    this.opts.onChange?.(this.state);
  }

  /** New generation / reprompt. Locked components of the current design are kept verbatim. */
  async generate(prompt: string, o: { variants?: number; class?: string } = {}): Promise<void> {
    this.ac?.abort();
    const ac = (this.ac = new AbortController());
    const prev = this.state.design;
    const drafts: ForgeDraft[] = [];
    this.set({ busy: true, drafts, error: null });
    const draft = (v: number) =>
      (drafts[v] ??= { name: '', class: '', components: [], design: null, warnings: [], error: null });
    try {
      await streamForge(
        {
          prompt,
          class: o.class,
          variants: o.variants ?? 1,
          previous: prev ?? undefined,
          locked: prev?.components.filter(c => c.locked),
          rejected: this.state.rejected,
          playerIdentity: this.opts.playerIdentity,
        },
        ev => {
          if (ev.variant < 0) return;
          const d = draft(ev.variant);
          if (ev.type === 'meta') Object.assign(d, { name: ev.name, class: ev.class });
          else if (ev.type === 'component') d.components = [...d.components, ev.component];
          else if (ev.type === 'done') Object.assign(d, { design: ev.design, warnings: ev.warnings, components: ev.design.components });
          else if (ev.type === 'error') d.error = ev.message;
          this.set({ drafts: [...drafts] });
          // single variant: edit it right away; with several, the UI calls pick(i)
          if (ev.type === 'done' && (o.variants ?? 1) === 1) this.set({ design: ev.design });
        },
        { signal: ac.signal, baseUrl: this.opts.baseUrl },
      );
    } catch (e) {
      if (!ac.signal.aborted) this.set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (this.ac === ac) this.set({ busy: false });
    }
  }

  /** Choose a finished variant to edit. */
  pick(variant: number): void {
    const d = this.state.drafts[variant]?.design;
    if (d) this.set({ design: d });
  }

  edit(e: DesignEditInput): string[] {
    if (!this.state.design) return ['no design'];
    const r = applyEdit(this.state.design, e);
    const rejected = [...this.state.rejected, ...r.removed.map(c => c.label)].slice(-32);
    this.set({ design: r.design, rejected });
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
    this.ac?.abort();
  }
}
