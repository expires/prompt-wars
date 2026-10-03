// Turns a stream of raw model objects ({t:'meta'|'component'|'stats', ...}) into forge events and
// a final sanitized design. Shared by the LLM streamer and the mock.

import {
  firesProjectiles,
  matchesRejected,
  projectileRejected,
  sanitizeComponent,
  sanitizeProjectile,
  sanitizeDesign,
  FORGE_LIMITS,
  type Component,
  type ForgeDesign,
  type ForgeEvent,
  type ProjectileDesign,
  type SanitizeOptions,
} from '@ai-gaem/shared/forge';
import { normalizeClass, isFireMode, CLASS_TEMPLATES, type FireMode, type WeaponClass } from '@ai-gaem/shared';

export type Emit = (ev: ForgeEvent) => void;

export interface AssemblerOptions extends SanitizeOptions {
  variant: number;
  locked: Component[];
  /** projectile kept verbatim (the model's projectile line is ignored) */
  lockedProjectile?: ProjectileDesign;
  rejected: string[];
  previous?: ForgeDesign;
  classHint?: WeaponClass;
}

/** Incremental NDJSON parser: feed text chunks, get complete JSON objects. Tolerates fences / prose lines. */
export class NdjsonParser {
  private buf = '';
  constructor(private onObject: (o: Record<string, unknown>) => void, private onBadLine?: (line: string) => void) {}
  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      this.line(line);
    }
  }
  end(): void {
    if (this.buf.trim()) this.line(this.buf);
    this.buf = '';
  }
  private line(raw: string): void {
    const line = raw.trim();
    if (!line || line.startsWith('```')) return;
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    if (start < 0 || end <= start) {
      this.onBadLine?.(line);
      return;
    }
    try {
      const o = JSON.parse(line.slice(start, end + 1));
      if (o && typeof o === 'object' && !Array.isArray(o)) this.onObject(o as Record<string, unknown>);
    } catch {
      this.onBadLine?.(line);
    }
  }
}

export class DesignAssembler {
  private meta: Record<string, unknown> | null = null;
  private stats: Record<string, unknown> | null = null;
  private components: Component[] = [];
  private projectile: ProjectileDesign | undefined;
  private ids = new Set<string>();
  private lockedIds: Set<string>;
  private emittedLocked = false;
  readonly warnings: string[] = [];

  constructor(private opts: AssemblerOptions, private emit: Emit) {
    this.lockedIds = new Set(opts.locked.map(c => c.id));
  }

  get componentCount(): number {
    return this.components.length;
  }

  /** Feed one raw object from the model / mock. */
  push(o: Record<string, unknown>): void {
    const t = typeof o.t === 'string' ? o.t : typeof o.type === 'string' ? o.type : o.shapes || o.catalogPart ? 'component' : '';
    if (t === 'meta') this.onMeta(o);
    else if (t === 'component') this.onComponent(o);
    else if (t === 'projectile') this.onProjectile(o);
    else if (t === 'stats') {
      this.ensureMeta();
      const { t: _t, ...rest } = o;
      this.stats = rest;
      const preview = sanitizeDesign({ ...this.metaRaw(), stats: rest, components: [] }, this.opts).design;
      this.emit({ type: 'stats', variant: this.opts.variant, stats: preview.stats });
    }
  }

  private metaRaw(): Record<string, unknown> {
    return this.meta ?? {};
  }

  private onMeta(o: Record<string, unknown>): void {
    if (this.meta) return;
    const { t: _t, ...rest } = o;
    let cls: WeaponClass = normalizeClass(rest.class ?? this.opts.classHint ?? this.opts.previous?.class);
    if (cls === 'weird' && rest.class !== 'weird' && this.opts.classHint) cls = this.opts.classHint;
    const modes = CLASS_TEMPLATES[cls].modes;
    const fireMode: FireMode = isFireMode(rest.fireMode) && modes.includes(rest.fireMode) ? rest.fireMode : modes[0];
    this.meta = { ...rest, class: cls, fireMode };
    const preview = sanitizeDesign({ ...this.meta, components: [] }, this.opts).design;
    this.meta.name = preview.name;
    this.emit({ type: 'meta', variant: this.opts.variant, name: preview.name, class: preview.class, fireMode: preview.fireMode, palette: preview.palette, fx: preview.fx });
    this.emitLocked();
  }

  private ensureMeta(): void {
    if (!this.meta) {
      this.onMeta({
        t: 'meta',
        name: this.opts.previous?.name,
        class: this.opts.previous?.class ?? this.opts.classHint,
        palette: this.opts.previous?.palette,
      });
    }
  }

  private emitLocked(): void {
    if (this.emittedLocked) return;
    this.emittedLocked = true;
    for (const c of this.opts.locked) {
      if (this.ids.has(c.id)) continue;
      this.ids.add(c.id);
      this.components.push(c);
      this.emit({ type: 'component', variant: this.opts.variant, component: c });
    }
    const lp = this.opts.lockedProjectile;
    if (lp && firesProjectiles(this.meta?.fireMode as string)) {
      this.projectile = lp;
      this.emit({ type: 'projectile', variant: this.opts.variant, projectile: lp });
    }
  }

  private onProjectile(o: Record<string, unknown>): void {
    this.ensureMeta();
    if (this.opts.lockedProjectile || this.projectile) return; // locked copy already emitted / one per design
    if (!firesProjectiles(this.meta?.fireMode as string)) {
      this.warnings.push(`projectile ignored (${String(this.meta?.fireMode)} weapons fire none)`);
      return;
    }
    const { t: _t, ...rest } = o;
    const p = sanitizeProjectile(rest, this.warnings);
    if (!p) return;
    delete p.locked;
    if (this.opts.rejected.length && projectileRejected(p, this.opts.rejected)) {
      this.warnings.push(`rejected projectile "${p.label}" skipped`);
      return;
    }
    this.projectile = p;
    this.emit({ type: 'projectile', variant: this.opts.variant, projectile: p });
  }

  private onComponent(o: Record<string, unknown>): void {
    this.ensureMeta();
    const { t: _t, ...rest } = o;
    const id = typeof rest.id === 'string' ? rest.id.trim().toLowerCase() : '';
    if (id && this.lockedIds.has(id)) return; // locked copy already emitted verbatim
    if (this.components.length >= FORGE_LIMITS.maxComponents) {
      this.warnings.push('component limit reached; extra dropped');
      return;
    }
    const c = sanitizeComponent(rest, this.opts, this.warnings);
    if (!c) return;
    if (this.opts.rejected.length && matchesRejected(c, this.opts.rejected)) {
      this.warnings.push(`rejected component "${c.label}" skipped`);
      return;
    }
    // unique id now, so the editor can address streamed components before `done`
    let cid = c.id || c.role;
    if (this.ids.has(cid)) {
      let n = 2;
      while (this.ids.has(`${cid.slice(0, 20)}-${n}`)) n++;
      cid = `${cid.slice(0, 20)}-${n}`;
    }
    c.id = cid;
    if (c.parent !== undefined && !this.ids.has(c.parent)) delete c.parent;
    if (c.parent === undefined) delete c.attach;
    this.ids.add(cid);
    this.components.push(c);
    this.emit({ type: 'component', variant: this.opts.variant, component: c });
  }

  /** Final sanitized design (+ `done` event). */
  finish(): ForgeDesign {
    this.ensureMeta();
    const stats = this.stats ?? this.opts.previous?.stats ?? {};
    const raw = {
      ...this.metaRaw(),
      palette: this.metaRaw().palette ?? this.opts.previous?.palette,
      stats,
      components: this.components,
      projectile: this.projectile,
    };
    if (!this.stats) this.warnings.push('model sent no stats; using defaults');
    const res = sanitizeDesign(raw, this.opts);
    const warnings = [...this.warnings, ...res.warnings];
    this.emit({ type: 'done', variant: this.opts.variant, design: res.design, warnings });
    return res.design;
  }
}

