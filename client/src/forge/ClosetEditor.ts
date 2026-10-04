// Closet (full screen; lazily loaded chunk): the Forge's sister editor for outfits. Same layout
// classes, streaming, keep / lock / reject + reforge and turntable as the Weapon Forge.
//
//   const ed = openClosetEditor({ mode: 'first', presets, onEquip: (outfit, prompt, presetId) => ..., onSkip, onClose });
//
// Size is gameplay (HP / hitbox / speed, computed by the server from the body); pieces are cosmetic.
import './forge.css';
import * as THREE from 'three';
import {
  BODY_LIMITS,
  DEFAULT_BODY,
  bodyStats,
  bodyStatsLine,
  outfitTris,
  standHeight,
  OUTFIT_LIMITS,
  type OutfitBody,
  type OutfitDesign,
  type OutfitEvent,
  type OutfitPiece,
} from '@ai-gaem/shared';
import { buildOutfitPieces } from '@ai-gaem/shared/outfit/build';
import { OutfitSession, draftOutfit, type OutfitSessionState } from './closetClient';
import { Turntable, type Mark } from './Turntable';
import { Humanoid } from '../player/humanoid';
import { el, esc, reducedMotion } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { brandText } from './brand';

export interface ClosetPreset {
  /** outfit row id ('0' = default body) */
  id: string;
  name: string;
  outfit: OutfitDesign | null;
}

export interface ClosetEditorOptions {
  mode: 'first' | 'death' | 'pause';
  playerIdentity?: string;
  baseUrl?: string;
  /** quick picks (Scout / Soldier / Tank) */
  presets: ClosetPreset[];
  /** start from the outfit the player wears */
  seed?: { outfit: OutfitDesign | null; presetId?: string };
  equipLabel?: string;
  /** first login step indicator (e.g. "Step 1/2 · Character") */
  step?: string;
  /** wear it: `presetId` when it is an unchanged preset (equip by id), else register */
  onEquip(outfit: OutfitDesign | null, prompt: string, presetId?: string): Promise<void>;
  /** optional Skip button in the header */
  onSkip?(): void;
  onClose(): void;
  parent?: HTMLElement;
}

export interface ClosetEditorHandle {
  readonly root: HTMLElement;
  close(): void;
  readonly session: OutfitSession;
}

const STARTERS = ['medieval knight', 'astronaut', 'banana suit', 'small fast ninja', 'riot cop', 'giant retro robot'];
const MODIFIERS = ['make it bigger', 'make it smaller', 'add a cape', 'more armour', 'gold trim', 'glowing visor', 'make it sillier', 'red and black'];
const SOCKET_ICON: Record<string, IconName> = { head: 'head', face: 'eye', torso: 'shield', back: 'tank', belt: 'mag', shoulderL: 'shield', shoulderR: 'shield' };
const SIZE_LABEL: Record<keyof OutfitBody, string> = { size: 'Height', build: 'Bulk', head: 'Head', limbs: 'Arms' };

export function openClosetEditor(opts: ClosetEditorOptions): ClosetEditorHandle {
  return new ClosetEditor(opts);
}

class ClosetEditor implements ClosetEditorHandle {
  readonly root = el('div', 'forge closet ui-hatch');
  readonly session: OutfitSession;
  private readonly turntable: Turntable;
  private readonly $ = {} as Record<string, HTMLElement>;
  private readonly prompt: HTMLTextAreaElement;
  private marks = new Map<string, Mark>();
  private shownKey = '';
  private shownCount = 0;
  private presetId: string | undefined;
  /** the preset outfit as picked (unchanged -> equip by id) */
  private presetBase: string | null = null;
  private equipping = false;
  private equipError: string | null = null;
  private closed = false;
  private lastPrompt = '';
  private prev: OutfitDesign | null = null;
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(private readonly opts: ClosetEditorOptions) {
    this.session = new OutfitSession({ onChange: (s) => this.render(s), onEvent: (ev) => this.onEvent(ev), playerIdentity: opts.playerIdentity, baseUrl: opts.baseUrl });
    const r = this.root;
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-modal', 'true');
    r.setAttribute('aria-label', 'Closet');
    r.dataset.testid = 'closet-editor';
    r.dataset.mode = opts.mode;
    r.innerHTML = `
      <header class="forge-head">
        <div class="forge-brand"><span class="forge-brand-mark">${icon('shield', 'ui-icon')}</span>${brandText('Closet', opts.step)}</div>
        <div class="forge-titlebar">
          <h1 class="forge-name" data-testid="closet-name" data-k="name"></h1>
          <div class="forge-tier closet-line" data-k="line" data-testid="closet-statsline"></div>
        </div>
        <div class="forge-head-actions">
          ${opts.onSkip ? `<button class="ui-btn ui-btn--secondary ui-btn--sm" data-k="skip" data-testid="closet-skip"><span>Skip</span></button>` : ''}
          <button class="ui-btn ui-btn--secondary ui-btn--sm" data-k="close" data-testid="closet-close">${icon('x', 'ui-icon ui-icon--sm')}<span>Close</span><span class="ui-kbd"><span>Esc</span></span></button>
        </div>
      </header>
      <section class="forge-comps" aria-label="Pieces">
        <div class="forge-sec-head"><span class="ui-micro">Pieces</span><span class="forge-count" data-k="count" data-testid="closet-count"></span></div>
        <div class="forge-comp-list" data-k="list" role="list"></div>
        <div class="forge-comps-foot">
          <button class="forge-link" data-k="lockAll">${icon('lock', 'ui-icon ui-icon--sm')} Lock all</button>
          <button class="forge-link" data-k="clearMarks">${icon('reset', 'ui-icon ui-icon--sm')} Clear marks</button>
        </div>
      </section>
      <section class="forge-stage" data-k="stage">
        <div class="forge-empty" data-k="empty">
          <div class="forge-empty-mark">${icon('shield', 'ui-icon ui-icon--lg')}</div>
          <div class="forge-empty-title">Describe a look</div>
          <div class="forge-empty-sub">Size sets HP, hitbox and speed. Armour is cosmetic.</div>
        </div>
        <div class="forge-status" data-k="status" data-testid="closet-status" aria-live="polite"></div>
        <div class="forge-stage-tools">
          <span class="ui-micro">drag rotate · scroll zoom</span>
          <button class="forge-iconbtn" data-k="reset" aria-label="Reset view">${icon('rotate', 'ui-icon ui-icon--sm')}</button>
        </div>
      </section>
      <aside class="forge-side" aria-label="Body">
        <div class="forge-stats closet-body" data-k="body"></div>
      </aside>
      <section class="forge-variants closet-presets" aria-label="Presets">
        <div class="forge-sec-head"><span class="ui-micro">Quick pick</span></div>
        <div class="forge-variant-tiles" data-k="presets" role="radiogroup" aria-label="Presets"></div>
      </section>
      <section class="forge-prompt">
        <div class="forge-prompt-row">
          <label class="forge-textarea-wrap">
            <span class="forge-prompt-mark">${icon('spark')}</span>
            <textarea rows="2" maxlength="400" data-k="prompt" data-testid="closet-prompt" aria-label="Describe your look" placeholder="Describe a look, e.g. “banana suit”"></textarea>
          </label>
          <button class="ui-btn ui-btn--forge forge-reforge" data-k="reforge" data-testid="closet-reforge">
            <span class="forge-reforge-main"><span class="spark">${icon('spark', 'ui-icon ui-icon--sm')}</span><span data-k="reforgeLabel">Tailor</span></span>
            <span class="forge-reforge-sub" data-k="reforgeSub"></span>
          </button>
          <button class="ui-btn ui-btn--primary forge-equip" data-k="equip" data-testid="closet-equip" disabled><span data-k="equipLabel"></span>${icon('play', 'ui-icon ui-icon--sm')}</button>
        </div>
        <div class="forge-chips" data-k="chips"></div>
        <div class="forge-error" data-k="error" data-testid="closet-error" hidden></div>
      </section>`;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.$[n.dataset.k!] = n));
    this.prompt = this.$.prompt as HTMLTextAreaElement;
    (opts.parent ?? document.body).append(r);
    this.turntable = new Turntable(this.$.stage);
    // a whole character, head to toe (weapons are framed tighter)
    this.turntable.fit = 0.92;
    this.$.stage.prepend(this.turntable.canvas);
    this.turntable.onHover((id) => this.setHover(id));
    this.bind();
    this.renderChips();
    this.renderPresets();
    const seed = opts.seed;
    if (seed?.outfit) {
      this.presetId = seed.presetId;
      this.presetBase = seed.presetId ? JSON.stringify(seed.outfit) : null;
      this.session.seed(stripLocks(seed.outfit));
    } else if (seed && seed.presetId === '0') {
      this.presetId = '0';
      this.render(this.session.state);
    } else this.render(this.session.state);
    requestAnimationFrame(() => this.prompt.focus({ preventScroll: true }));
    window.addEventListener('keydown', this.onKey, true);
    if (!reducedMotion()) r.classList.add('enter');
  }

  // ------------------------------------------------------------------ wiring

  private bind() {
    const $ = this.$;
    for (const ev of ['click', 'mousedown', 'pointerdown', 'wheel', 'keydown', 'keyup'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    $.close.addEventListener('click', () => this.close());
    $.skip?.addEventListener('click', () => {
      const cb = this.opts.onSkip;
      this.close();
      cb?.();
    });
    $.reset.addEventListener('click', () => this.turntable.resetView());
    $.reforge.addEventListener('click', () => {
      if (this.session.state.busy) this.session.cancel();
      else void this.reforge();
    });
    $.equip.addEventListener('click', () => void this.equip());
    $.lockAll.addEventListener('click', () => {
      const o = this.session.outfit;
      if (!o) return;
      for (const p of o.pieces) this.marks.set(p.id, 'lock');
      this.session.lock(o.pieces.map((p) => p.id));
    });
    $.clearMarks.addEventListener('click', () => {
      const o = this.session.outfit;
      this.marks.clear();
      const locked = o?.pieces.filter((p) => p.locked).map((p) => p.id) ?? [];
      if (locked.length) this.session.unlock(locked);
      else this.render(this.session.state);
    });
    this.prompt.addEventListener('input', () => this.renderReforge(this.session.state));
    this.prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this.session.state.busy) void this.reforge();
      }
    });
    $.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mark]');
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (card && btn) this.toggleMark(card.dataset.id!, btn.dataset.mark as Mark);
    });
    $.list.addEventListener('mouseover', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (card) this.setHover(card.dataset.id!);
    });
    $.list.addEventListener('mouseleave', () => this.setHover(null));
    $.presets.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]');
      if (!t || this.session.state.busy) return;
      const p = this.opts.presets.find((x) => x.id === t.dataset.preset);
      if (!p) return;
      this.presetId = p.id;
      this.presetBase = p.outfit ? JSON.stringify(p.outfit) : null;
      this.marks.clear();
      this.session.seed(p.outfit ? stripLocks(p.outfit) : null, p.outfit ? `preset:${p.name.toLowerCase()}` : '');
      this.renderPresets();
      if (!p.outfit) this.render(this.session.state);
    });
    $.body.addEventListener('input', (e) => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-body]');
      if (!inp || !this.session.outfit) return;
      this.session.edit({ body: { [inp.dataset.body!]: Number(inp.value) } as Partial<OutfitBody> });
    });
    $.chips.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-chip]');
      if (!c) return;
      const text = c.dataset.chip!;
      const cur = this.prompt.value.trim();
      this.prompt.value = !this.session.outfit || !cur ? text : `${cur.replace(/[,.]$/, '')}, ${text}`;
      this.prompt.focus();
      this.renderReforge(this.session.state);
    });
    $.error.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-retry]')) void this.reforge();
      if ((e.target as HTMLElement).closest('[data-dismiss]')) {
        this.equipError = null;
        this.render(this.session.state);
      }
    });
  }

  private handleKey(e: KeyboardEvent) {
    if (this.closed) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.session.state.busy) this.session.cancel();
      else this.close();
      return;
    }
    e.stopImmediatePropagation();
  }

  private toggleMark(id: string, mark: Mark) {
    const cur = this.marks.get(id);
    const next = cur === mark ? undefined : mark;
    if (next) this.marks.set(id, next);
    else this.marks.delete(id);
    if (next === 'lock') this.session.lock([id]);
    else if (cur === 'lock') this.session.unlock([id]);
    else this.render(this.session.state);
  }

  private hoverId: string | null = null;
  private setHover(id: string | null) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.turntable.highlight(id);
    this.$.list.querySelectorAll<HTMLElement>('[data-id]').forEach((c) => c.classList.toggle('hover', c.dataset.id === id));
  }

  // ------------------------------------------------------------------ actions

  private async reforge() {
    if (this.session.state.busy) return;
    const o = this.session.outfit;
    let prompt = this.prompt.value.trim();
    if (!prompt && !o) {
      this.prompt.focus();
      this.root.classList.remove('shake');
      void this.root.offsetWidth;
      this.root.classList.add('shake');
      return;
    }
    this.equipError = null;
    if (o) {
      const rej = [...this.marks].filter(([, m]) => m === 'reject').map(([id]) => id).filter((id) => o.pieces.some((p) => p.id === id));
      if (rej.length) this.session.reject(rej);
      const keep = (this.session.outfit?.pieces ?? []).filter((p) => this.marks.get(p.id) === 'keep').map((p) => p.label);
      if (!prompt) prompt = 'same look, reroll the unmarked pieces';
      if (keep.length) prompt += ` (keep these pieces as they are: ${keep.join(', ')})`;
    }
    for (const [id, m] of [...this.marks]) if (m !== 'lock') this.marks.delete(id);
    this.lastPrompt = prompt;
    this.prev = this.session.outfit;
    this.presetId = undefined;
    this.presetBase = null;
    this.shownKey = '';
    this.shownCount = 0;
    this.renderPresets();
    await this.session.generate(prompt);
  }

  private async equip() {
    const s = this.session.state;
    if (s.busy || this.equipping) return;
    const o = s.outfit;
    if (!o && this.presetId !== '0') return;
    this.equipping = true;
    this.equipError = null;
    this.render(s);
    try {
      const unchangedPreset = this.presetId && (this.presetId === '0' || (o && this.presetBase === JSON.stringify(stripLocks(o)))) ? this.presetId : undefined;
      await this.opts.onEquip(o, s.prompt || this.lastPrompt || o?.name || 'default', unchangedPreset);
      this.close();
    } catch (err) {
      this.equipError = `Couldn’t equip: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.equipping = false;
      if (!this.closed) this.render(this.session.state);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.session.cancel();
    window.removeEventListener('keydown', this.onKey, true);
    this.root.classList.add('leave');
    const done = () => {
      this.turntable.dispose();
      this.root.remove();
    };
    if (reducedMotion()) done();
    else setTimeout(done, 160);
    this.opts.onClose();
  }

  private onEvent(ev: OutfitEvent) {
    if (ev.type === 'done') this.renderChips();
  }

  // ------------------------------------------------------------------ render

  /** outfit shown: streaming draft > edited outfit; null + presetId '0' = default body */
  private shown(s: OutfitSessionState): { outfit: OutfitDesign | null; streaming: boolean } {
    if (s.busy && s.draft) return { outfit: draftOutfit(s.draft, this.prev), streaming: true };
    return { outfit: s.outfit, streaming: false };
  }

  private render(s: OutfitSessionState) {
    if (this.closed) return;
    const o = s.outfit;
    if (o) {
      for (const p of o.pieces) if (p.locked) this.marks.set(p.id, 'lock');
      for (const [id, m] of [...this.marks]) if (m === 'lock' && !o.pieces.find((p) => p.id === id)?.locked) this.marks.delete(id);
    }
    const { outfit, streaming } = this.shown(s);
    const showDefault = !outfit && this.presetId === '0';
    this.root.classList.toggle('busy', s.busy);
    this.root.classList.toggle('has-design', !!outfit || showDefault);
    const name = outfit?.name ?? (showDefault ? 'Default' : s.busy ? 'Tailoring…' : this.opts.mode === 'first' ? 'Pick your look' : 'New look');
    this.$.name.textContent = name;
    const st = bodyStats(outfit?.body ?? DEFAULT_BODY);
    this.$.line.innerHTML = outfit || showDefault ? `<span>${esc(bodyStatsLine(st))}</span>` : '<span>—</span>';
    this.renderList(s, outfit, streaming);
    this.renderPreview(s, outfit, showDefault, streaming);
    this.renderBody(outfit, showDefault, streaming);
    this.renderReforge(s);
    this.renderStatus(s, outfit, streaming);
    this.renderError(s);
  }

  private renderList(s: OutfitSessionState, outfit: OutfitDesign | null, streaming: boolean) {
    const list = this.$.list;
    const pieces = outfit?.pieces ?? [];
    const editable = !streaming && !!s.outfit;
    const existing = new Map<string, HTMLElement>();
    list.querySelectorAll<HTMLElement>('[data-id]').forEach((n) => existing.set(n.dataset.id!, n));
    list.querySelectorAll('.forge-skel, .forge-list-empty').forEach((n) => n.remove());
    const keep = new Set<string>();
    pieces.forEach((p, i) => {
      keep.add(p.id);
      let card = existing.get(p.id);
      const mark = this.marks.get(p.id);
      if (!card) {
        card = el('div', 'forge-comp');
        card.dataset.id = p.id;
        card.dataset.testid = 'closet-piece';
        card.setAttribute('role', 'listitem');
        card.tabIndex = 0;
        if (!reducedMotion()) card.classList.add('in');
      }
      card.dataset.mark = mark ?? '';
      card.classList.toggle('readonly', !editable);
      const sig = `${p.label}|${p.socket}|${p.mirror}|${mark ?? ''}|${editable}`;
      if (card.dataset.sig !== sig) {
        card.dataset.sig = sig;
        card.innerHTML = `
          <span class="forge-comp-icon">${icon(SOCKET_ICON[p.socket] ?? 'deco')}</span>
          <span class="forge-comp-text">
            <span class="ui-micro">${esc(socketLabel(p))}${mark === 'lock' ? ` · ${icon('lock', 'ui-icon forge-inline-icon')} locked` : ''}</span>
            <span class="forge-comp-label">${esc(p.label)}</span>
            <span class="forge-comp-desc">${p.shapes.length} shape${p.shapes.length === 1 ? '' : 's'}${p.mirror ? ' · pair' : ''}</span>
          </span>
          <span class="forge-comp-ctrl" role="group" aria-label="Mark ${esc(p.label)}">
            ${(['keep', 'lock', 'reject'] as Mark[])
              .map((m) => `<button data-mark="${m}" data-testid="piece-${m}" class="m-${m}" aria-pressed="${mark === m}" title="${m.toUpperCase()}" ${editable ? '' : 'disabled'}>${icon(m === 'keep' ? 'check' : m === 'lock' ? 'lock' : 'x', 'ui-icon ui-icon--sm')}<span>${m}</span></button>`)
              .join('')}
          </span>`;
      }
      card.classList.toggle('hover', this.hoverId === p.id);
      if (list.children[i] !== card) list.insertBefore(card, list.children[i] ?? null);
    });
    for (const [id, n] of existing) if (!keep.has(id)) n.remove();
    if (s.busy && !s.draft?.outfit) {
      const n = Math.max(0, Math.max(5, this.prev?.pieces.length ?? 0) - pieces.length);
      for (let i = 0; i < n; i++) list.append(el('div', 'forge-comp forge-skel', '<span class="sk-icon"></span><span class="sk-lines"><i></i><i></i><i></i></span>'));
    }
    if (!pieces.length && !s.busy) list.append(el('div', 'forge-list-empty', this.presetId === '0' ? 'Default body: no armour.' : 'Pieces appear here.'));
    this.$.count.textContent = pieces.length ? `${pieces.length}` : '';
  }

  private renderPreview(s: OutfitSessionState, outfit: OutfitDesign | null, showDefault: boolean, streaming: boolean) {
    const key = outfit ? `${JSON.stringify(outfit.body)}|${outfit.skin}|${JSON.stringify(outfit.palette)}|${outfit.pieces.map((p) => p.id + (p.locked ? 'L' : '')).join(',')}` : showDefault ? 'default' : '';
    if (key !== this.shownKey) {
      const fresh = streaming && outfit && outfit.pieces.length > this.shownCount ? outfit.pieces.slice(this.shownCount).map((p) => p.id) : [];
      const built = outfit || showDefault ? buildMannequin(outfit) : null;
      this.turntable.setObject(built?.root ?? null, built?.parts ?? new Map(), { materialize: fresh, keepFrame: streaming && this.shownCount > 0 });
      this.shownKey = key;
      this.shownCount = outfit?.pieces.length ?? 0;
    }
    this.turntable.setMarks(this.marks);
    this.$.empty.hidden = !!outfit || showDefault || s.busy;
    this.$.stage.classList.toggle('forging', s.busy);
  }

  private renderBody(outfit: OutfitDesign | null, showDefault: boolean, streaming: boolean) {
    const host = this.$.body;
    if (!outfit && !showDefault) {
      host.innerHTML = `<div class="forge-stats-empty ui-micro">Body stats appear here</div>`;
      return;
    }
    const body = outfit?.body ?? DEFAULT_BODY;
    const st = bodyStats(body);
    const pct = Math.round((st.speedMult - 1) * 100);
    const tris = outfit ? outfitTris(outfit.pieces) : 0;
    const sliders = (Object.keys(SIZE_LABEL) as (keyof OutfitBody)[])
      .map((k) => {
        const [lo, hi] = BODY_LIMITS[k];
        return `<label class="closet-slider"><span class="forge-stat-label">${SIZE_LABEL[k]}</span><input type="range" min="${lo}" max="${hi}" step="0.01" value="${body[k]}" data-body="${k}" data-testid="closet-${k}" ${outfit && !streaming ? '' : 'disabled'}><span class="ui-num">${body[k].toFixed(2)}</span></label>`;
      })
      .join('');
    const existing = host.querySelector<HTMLInputElement>('input:focus');
    if (existing && host.dataset.outfit === (outfit?.name ?? '')) {
      // dragging a slider: update numbers in place (don't steal the pointer)
      host.querySelectorAll<HTMLElement>('[data-v]').forEach((n) => {
        const k = n.dataset.v!;
        n.textContent = k === 'hp' ? String(st.maxHp) : k === 'speed' ? `${pct > 0 ? '+' : ''}${pct === 0 ? '±0' : pct}%` : k === 'size' ? st.sizeClass : `${standHeight(st).toFixed(2)} m`;
      });
      host.querySelectorAll<HTMLInputElement>('input[data-body]').forEach((i) => {
        const k = i.dataset.body as keyof OutfitBody;
        (i.nextElementSibling as HTMLElement).textContent = body[k].toFixed(2);
      });
      return;
    }
    host.dataset.outfit = outfit?.name ?? '';
    host.innerHTML = `
      <div class="forge-sec-head"><span class="ui-micro">Body</span><span class="ui-micro">size = gameplay</span></div>
      <div class="closet-bignums">
        <div><span class="ui-micro">Max HP</span><span class="ui-num" data-v="hp" data-testid="closet-hp">${st.maxHp}</span></div>
        <div><span class="ui-micro">Speed</span><span class="ui-num" data-v="speed" data-testid="closet-speed">${pct > 0 ? '+' : ''}${pct === 0 ? '±0' : pct}%</span></div>
        <div><span class="ui-micro">Size</span><span class="ui-num" data-v="size" data-testid="closet-size">${st.sizeClass}</span></div>
        <div><span class="ui-micro">Height</span><span class="ui-num" data-v="height">${standHeight(st).toFixed(2)} m</span></div>
      </div>
      ${sliders}
      <div class="forge-ttk"><span class="ui-micro">Hitbox</span><span class="closet-note">scales with size</span></div>
      <div class="forge-ttk"><span class="ui-micro">Armour</span><span class="closet-note">cosmetic · ${tris}/${OUTFIT_LIMITS.maxTris} tris</span></div>`;
  }

  private renderPresets() {
    this.$.presets.innerHTML = this.opts.presets
      .map((p) => {
        const st = bodyStats(p.outfit?.body ?? DEFAULT_BODY);
        const sel = this.presetId === p.id;
        return `<button class="forge-tile closet-tile ${sel ? 'sel' : ''}" data-preset="${esc(p.id)}" data-testid="closet-preset" role="radio" aria-checked="${sel}">
          <span class="forge-tile-meta">
            <span class="forge-tile-name">${esc(p.name)}</span>
            <span class="forge-tile-diff">${esc(bodyStatsLine(st))}</span>
          </span>
        </button>`;
      })
      .join('');
  }

  private renderReforge(s: OutfitSessionState) {
    const o = s.outfit;
    if (s.busy) {
      this.$.reforgeLabel.textContent = 'Cancel';
      this.$.reforgeSub.textContent = 'stop';
      this.$.reforge.classList.add('cancel');
    } else {
      this.$.reforge.classList.remove('cancel');
      this.$.reforgeLabel.textContent = o ? 'Retailor' : 'Tailor';
      if (o) {
        let lock = 0;
        let rej = 0;
        let keep = 0;
        for (const p of o.pieces) {
          const m = this.marks.get(p.id);
          if (m === 'lock') lock++;
          else if (m === 'reject') rej++;
          else if (m === 'keep') keep++;
        }
        this.$.reforgeSub.textContent = `keep ${keep} · locked ${lock} · reroll ${o.pieces.length - keep - lock - rej}${rej ? ` · reject ${rej}` : ''}`;
      } else this.$.reforgeSub.textContent = 'from scratch';
    }
    const equip = this.$.equip as HTMLButtonElement;
    equip.disabled = (!o && this.presetId !== '0') || s.busy || this.equipping;
    this.$.equipLabel.textContent = this.equipping ? 'Equipping…' : (this.opts.equipLabel ?? 'Wear');
  }

  private renderStatus(s: OutfitSessionState, outfit: OutfitDesign | null, streaming: boolean) {
    const st = this.$.status;
    if (s.busy) {
      const n = outfit?.pieces.length ?? 0;
      const last = outfit?.pieces[n - 1]?.label;
      st.innerHTML = `<span class="forge-pulse"></span>TAILORING · ${last ? `${esc(last)} (${n})` : s.draft?.name ? esc(s.draft.name) : 'starting'}…`;
      st.hidden = false;
    } else if (outfit && !streaming && this.lastPrompt && !this.equipping) {
      st.innerHTML = `${icon('check', 'ui-icon ui-icon--sm')}<span>READY · ${outfit.pieces.length} pieces${s.mock ? ' · mock' : ''}</span>`;
      st.hidden = false;
    } else st.hidden = true;
  }

  private renderError(s: OutfitSessionState) {
    const e = this.$.error;
    const msg = this.equipError ?? s.error;
    if (!msg) {
      e.hidden = true;
      return;
    }
    const rate = s.errorDetail?.kind === 'rate';
    e.hidden = false;
    e.className = `forge-error${rate ? ' rate' : ''}`;
    e.innerHTML = `${icon(rate ? 'clock' : 'warning', 'ui-icon ui-icon--sm')}<span>${esc(msg)}</span>${!this.equipError && !rate ? '<button data-retry class="ui-chip"><span>Retry</span></button>' : ''}${this.equipError ? '<button data-dismiss class="ui-chip"><span>Dismiss</span></button>' : ''}`;
  }

  private renderChips() {
    const list = this.session.outfit ? MODIFIERS : STARTERS;
    this.$.chips.innerHTML = list.slice(0, 6).map((c) => `<button class="ui-chip" data-chip="${esc(c)}"><span>${esc(c)}</span></button>`).join('');
  }
}

function stripLocks(o: OutfitDesign): OutfitDesign {
  return { ...o, pieces: o.pieces.map(({ locked: _l, ...p }) => p) };
}

function socketLabel(p: OutfitPiece): string {
  const base = p.socket.replace(/[LR]$/, '');
  const side = p.mirror ? 'pair' : p.socket.endsWith('L') ? 'left' : p.socket.endsWith('R') ? 'right' : '';
  return side ? `${base} · ${side}` : base;
}

/** editor mannequin: humanoid with the body / look applied and unmerged pieces on its bones */
export function buildMannequin(outfit: OutfitDesign | null): { root: THREE.Group; parts: Map<string, THREE.Object3D[]> } {
  const h = new Humanoid(outfit?.palette.primary ?? 0x3a7bd5);
  const parts = new Map<string, THREE.Object3D[]>();
  if (outfit) {
    h.setBody(outfit.body);
    h.setLook({ suit: outfit.palette.primary, limbs: outfit.palette.secondary, skin: outfit.skin });
    const built = buildOutfitPieces(outfit);
    for (const { bone, group } of built.perBone) {
      h.bones[bone].add(group);
      const id = group.userData.componentId as string;
      const list = parts.get(id) ?? [];
      // the piece's own socket group first (highlight / glyph anchor)
      if (built.components.get(id) === group) list.unshift(group);
      else list.push(group);
      parts.set(id, list);
    }
    if (outfit.pieces.some((p) => p.socket === 'head' || p.socket === 'face')) h.attachOutfit({}, { hideVisor: true });
  }
  h.setCrouch(0);
  h.animate(0, 0);
  // slightly lowered arms read better on the turntable than the aiming pose
  h.setPitch(-0.25);
  // characters face -Z; the turntable camera looks from +Z: turn it to face the viewer
  h.root.rotation.y = Math.PI;
  const root = new THREE.Group();
  root.add(h.root);
  return { root, parts };
}
