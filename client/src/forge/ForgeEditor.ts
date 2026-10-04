// Weapon Forge editor (full screen; lazily loaded chunk). docs/ui-spec.md §"Weapon Forge editor".
//
//   const ed = openForgeEditor({ mode: 'first', playerName, onEquip: (design, prompt) => ..., onClose });
//
// Live streaming from the forge service (ForgeSession): skeleton cards, components appear one by
// one (card fade-in + clip-plane materialize in the 3D preview), stats / budget update live, rarity
// reveal + name type-in when done. KEEP / LOCK / REJECT per component, variants, reprompt + EQUIP.
import './forge.css';
import { designToWeapon, moveSpeedLabel, PROJECTILE_ID, type Component, type ForgeDesign, type ForgeEvent } from '@ai-gaem/shared';
import { ForgeSession, type ForgeCacheLookup, type ForgeDraft, type ForgeOrigin, type ForgeSessionState } from './forgeClient';
import { creditFromInfo } from '../ui/forgeCredit';
import { Turntable, type Mark } from './Turntable';
import { budgetOf, elementBlurb, statRows, ttk, weaponFromStats } from './forgeStats';
import { el, esc, reducedMotion } from '../ui/dom';
import { icon } from '../ui/icons';
import { brandText } from './brand';
import { flavorFor, pipsHtml, rarityOfDesign, TIER_LABELS, type Tier } from '../ui/rarity';
import { renderWeaponCard, type WeaponCardData } from '../ui/WeaponCard';
import type { Weapon } from '../weapons/types';

export interface ForgeEditorOptions {
  /** where it was opened from (copy + close behaviour) */
  mode: 'first' | 'death' | 'pause' | 'remix';
  playerName: string;
  playerIdentity?: string;
  /** start from this design (remix / current loadout) and / or prompt */
  seed?: { design?: ForgeDesign | null; prompt?: string; autostart?: boolean; title?: string };
  /** label of the equip button (e.g. "EQUIP & DEPLOY") */
  equipLabel?: string;
  /** first login step indicator (e.g. "Step 2/2 · Weapon") */
  step?: string;
  /** register the design + deploy; reject to show an error. `origin`: prompt cache provenance */
  onEquip(design: ForgeDesign, prompt: string, origin?: ForgeOrigin | null): Promise<void>;
  /** prompt cache (forged_prompt) */
  cacheLookup?: ForgeCacheLookup;
  onClose(): void;
  baseUrl?: string;
  parent?: HTMLElement;
}

export interface ForgeEditorHandle {
  readonly root: HTMLElement;
  close(): void;
  /** test / debug access */
  readonly session: ForgeSession;
}

const LETTERS = ['A', 'B', 'C'];
const STARTERS = [
  'banana sniper rifle',
  'steampunk crocodile revolver',
  'jellyfish plasma rifle',
  'rubber duck war hammer',
  'disco ball flail',
  'seashell blunderbuss',
];
const MODIFIERS_GUN = ['make it chrome', 'more glow', 'add a scope', 'faster fire', 'harder hits', 'make it sillier', 'add a drum magazine', 'gold and black palette'];
const MODIFIERS_MELEE = ['longer reach', 'make it chrome', 'add glowing runes', 'heavier swing', 'make it sillier', 'add spikes', 'gold and black palette'];
const PLACEHOLDERS = [
  'Describe a weapon, e.g. “cactus shotgun”',
  'Describe a weapon, e.g. “ice-cream mace”',
  'Describe a weapon, e.g. “retro ray gun”',
];

const COMPONENT_DESC = (c: Component): string => {
  if (c.catalogPart) return `catalog part · ${c.catalogPart.partId.replace(/[_:]/g, ' ')}`;
  const shapes = c.shapes ?? [];
  const types = [...new Set(shapes.map((s) => s.type))];
  return `${shapes.length} shape${shapes.length === 1 ? '' : 's'} · ${types.slice(0, 3).join(', ')}${types.length > 3 ? '…' : ''} · from scratch`;
};

/** A card in the parts list: a component, or the projectile (id PROJECTILE_ID). */
interface Entry {
  id: string;
  label: string;
  role: string;
  desc: string;
  locked: boolean;
}

function entriesOf(d: ForgeDesign | null): Entry[] {
  if (!d) return [];
  const out: Entry[] = d.components.map((c) => ({ id: c.id, label: c.label, role: c.role, desc: COMPONENT_DESC(c), locked: !!c.locked }));
  const p = d.projectile;
  if (p) {
    const n = p.shapes.length;
    out.push({ id: PROJECTILE_ID, label: p.label, role: 'projectile', desc: `${n} shape${n === 1 ? '' : 's'} · ${p.spin ? 'spins' : p.wobble ? 'wobbles' : 'flies straight'}`, locked: !!p.locked });
  }
  return out;
}

function partialDesign(d: ForgeDraft, fallback: ForgeDesign | null): ForgeDesign | null {
  if (d.design) return d.design;
  if (!d.components.length) return null;
  const w = weaponFromStats(d.stats ?? {}, d.class || fallback?.class || 'weird', d.fireMode || fallback?.fireMode || 'hitscan', d.name);
  return {
    v: 1,
    name: d.name || 'Forging…',
    class: w.class,
    fireMode: w.fireMode,
    stats: { ...(d.stats ?? {}), ...pickStats(w) },
    palette: d.palette ?? fallback?.palette ?? { primary: '#3a3f4b', secondary: '#20242c', accent: '#ffd23f', glow: '#ff3da5' },
    fx: d.fx ?? {},
    components: d.components,
    ...(d.projectile ? { projectile: d.projectile } : {}),
  };
}

function pickStats(w: Weapon) {
  const { name: _n, class: _c, fireMode: _f, parts: _p, colors: _co, id: _i, design: _d, ...rest } = w as Weapon & Record<string, unknown>;
  return rest as unknown as ForgeDesign['stats'];
}

export function openForgeEditor(opts: ForgeEditorOptions): ForgeEditorHandle {
  return new ForgeEditor(opts);
}

class ForgeEditor implements ForgeEditorHandle {
  readonly root = el('div', 'forge ui-hatch');
  readonly session: ForgeSession;
  private readonly turntable: Turntable;
  private readonly $ = {} as Record<string, HTMLElement>;
  private readonly prompt: HTMLTextAreaElement;
  private marks = new Map<string, Mark>();
  private variantCount = 1;
  private viewIdx = 0;
  private hoverVariant: number | null = null;
  private shownKey = '';
  private shownCount = 0;
  private shownProjectile = false;
  private lastPrompt = '';
  private hoverId: string | null = null;
  private focusIdx = 0;
  private equipping = false;
  private equipError: string | null = null;
  private thumbs = new Map<string, string>();
  private typed: { full: string; n: number; timer: number } | null = null;
  private phTimer = 0;
  private closed = false;
  private prevDesign: ForgeDesign | null = null;
  private wasBusy = false;
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(private readonly opts: ForgeEditorOptions) {
    this.session = new ForgeSession({
      onChange: (s) => this.render(s),
      onEvent: (ev) => this.onEvent(ev),
      playerIdentity: opts.playerIdentity,
      baseUrl: opts.baseUrl,
      cacheLookup: opts.cacheLookup,
    });
    const r = this.root;
    r.setAttribute('role', 'dialog');
    r.setAttribute('aria-modal', 'true');
    r.setAttribute('aria-label', 'Weapon Forge');
    r.dataset.testid = 'forge-editor';
    r.dataset.mode = opts.mode;
    r.innerHTML = `
      <header class="forge-head">
        <div class="forge-brand"><span class="forge-brand-mark">${icon('spark', 'ui-icon')}</span>${brandText('Weapon Forge', opts.step)}</div>
        <div class="forge-titlebar">
          <h1 class="forge-name" data-testid="forge-name" data-k="name"></h1>
          <div class="forge-tier" data-k="tier"></div>
        </div>
        <div class="forge-head-actions">
          <button class="forge-iconbtn" data-k="help" aria-label="Help" aria-expanded="false">${icon('help')}</button>
          <button class="ui-btn ui-btn--secondary ui-btn--sm" data-k="close" data-testid="forge-close">${icon('x', 'ui-icon ui-icon--sm')}<span>Close</span><span class="ui-kbd"><span>Esc</span></span></button>
        </div>
        <div class="forge-help" data-k="helpPop" hidden>
          <div><span class="ui-kbd"><span>1</span></span> keep · <span class="ui-kbd"><span>2</span></span> lock · <span class="ui-kbd"><span>3</span></span> reject the focused part</div>
          <div><span class="ui-kbd"><span>↑</span></span><span class="ui-kbd"><span>↓</span></span> move between parts</div>
          <div><span class="ui-kbd"><span>⌘/Ctrl</span></span> + <span class="ui-kbd"><span>Enter</span></span> reforge · <span class="ui-kbd"><span>Esc</span></span> cancel / close</div>
          <div class="forge-help-dim">Lock: exact. Keep: similar. Reject: removed.</div>
        </div>
      </header>
      <section class="forge-comps" aria-label="Components">
        <div class="forge-sec-head"><span class="ui-micro">Components</span><span class="forge-count" data-k="count" data-testid="forge-count"></span></div>
        <div class="forge-comp-list" data-k="list" role="list"></div>
        <div class="forge-comps-foot">
          <button class="forge-link" data-k="lockAll">${icon('lock', 'ui-icon ui-icon--sm')} Lock all</button>
          <button class="forge-link" data-k="clearMarks">${icon('reset', 'ui-icon ui-icon--sm')} Clear marks</button>
        </div>
      </section>
      <section class="forge-stage" data-k="stage">
        <div class="forge-stage-frame" data-k="frame"></div>
        <div class="forge-empty" data-k="empty">
          <div class="forge-empty-mark">${icon('spark', 'ui-icon ui-icon--lg')}</div>
          <div class="forge-empty-title">Describe a weapon</div>
          <div class="forge-empty-sub">Then keep, lock or reject parts and reforge.</div>
        </div>
        <div class="forge-status" data-k="status" data-testid="forge-status" aria-live="polite"></div>
        <div class="forge-stage-tools">
          <span class="ui-micro">drag rotate · scroll zoom</span>
          <button class="forge-iconbtn" data-k="reset" aria-label="Reset view">${icon('rotate', 'ui-icon ui-icon--sm')}</button>
        </div>
        <div class="forge-reveal" data-k="reveal"></div>
      </section>
      <aside class="forge-side" aria-label="Stats">
        <div class="forge-card" data-k="card"></div>
        <div class="forge-stats" data-k="stats"></div>
      </aside>
      <section class="forge-variants" aria-label="Variants">
        <div class="forge-sec-head"><span class="ui-micro">Variants</span></div>
        <div class="forge-variant-tiles" data-k="tiles" role="radiogroup" aria-label="Variants"></div>
        <button class="ui-btn ui-btn--secondary ui-btn--sm forge-compare" data-k="compare" data-testid="forge-compare" disabled>${icon('compare', 'ui-icon ui-icon--sm')}<span>Compare</span></button>
      </section>
      <section class="forge-prompt">
        <div class="forge-prompt-row">
          <label class="forge-textarea-wrap">
            <span class="forge-prompt-mark">${icon('spark')}</span>
            <textarea rows="2" maxlength="400" data-k="prompt" data-testid="forge-prompt" aria-label="Describe your weapon"></textarea>
          </label>
          <div class="forge-count-seg" role="radiogroup" aria-label="Number of variants" data-k="varSeg">
            ${[1, 2, 3].map((n) => `<button role="radio" data-n="${n}" data-testid="forge-variants-${n}" aria-checked="${n === 1}">×${n}</button>`).join('')}
          </div>
          <button class="ui-btn ui-btn--forge forge-reforge" data-k="reforge" data-testid="forge-reforge">
            <span class="forge-reforge-main"><span class="spark">${icon('spark', 'ui-icon ui-icon--sm')}</span><span data-k="reforgeLabel">Forge</span><span class="ui-kbd"><span>⌘⏎</span></span></span>
            <span class="forge-reforge-sub" data-k="reforgeSub"></span>
          </button>
          <button class="ui-btn ui-btn--primary forge-equip" data-k="equip" data-testid="forge-equip" disabled><span data-k="equipLabel"></span>${icon('play', 'ui-icon ui-icon--sm')}</button>
        </div>
        <div class="forge-chips" data-k="chips"></div>
        <div class="forge-error" data-k="error" data-testid="forge-error" hidden></div>
      </section>
      <div class="forge-modal" data-k="modal" hidden></div>`;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.$[n.dataset.k!] = n));
    this.prompt = this.$.prompt as HTMLTextAreaElement;
    (opts.parent ?? document.body).append(r);

    this.turntable = new Turntable(this.$.stage);
    this.$.stage.prepend(this.turntable.canvas);
    this.turntable.onHover((id) => this.setHover(id, 'mesh'));

    this.bind();
    this.renderChips();
    this.rotatePlaceholder();

    const seed = opts.seed;
    if (seed?.prompt) this.prompt.value = seed.prompt;
    if (seed?.design) {
      const d: ForgeDesign = { ...seed.design, components: seed.design.components.map(({ locked: _l, ...c }) => c) };
      if (d.projectile) {
        const { locked: _pl, ...projectile } = d.projectile;
        d.projectile = projectile;
      }
      this.session.seed(d);
    } else this.render(this.session.state);
    if (seed?.autostart && (seed.prompt || seed.design)) void this.reforge();
    requestAnimationFrame(() => this.prompt.focus({ preventScroll: true }));
    window.addEventListener('keydown', this.onKey, true);
    if (!reducedMotion()) r.classList.add('enter');
  }

  // ------------------------------------------------------------------ wiring

  private bind() {
    const $ = this.$;
    // the game must not see clicks / keys inside the editor
    for (const ev of ['click', 'mousedown', 'pointerdown', 'wheel', 'keydown', 'keyup'] as const) this.root.addEventListener(ev, (e) => e.stopPropagation());
    $.close.addEventListener('click', () => this.close());
    $.help.addEventListener('click', () => {
      const open = $.helpPop.hidden;
      $.helpPop.hidden = !open;
      $.help.setAttribute('aria-expanded', String(open));
    });
    $.reset.addEventListener('click', () => this.turntable.resetView());
    $.reforge.addEventListener('click', () => {
      if (this.session.state.busy) this.session.cancel();
      else void this.reforge();
    });
    $.equip.addEventListener('click', () => void this.equip());
    $.lockAll.addEventListener('click', () => {
      const d = this.session.design;
      if (!d) return;
      const ids = entriesOf(d).map((e) => e.id);
      for (const id of ids) this.marks.set(id, 'lock');
      this.session.lock(ids);
    });
    $.clearMarks.addEventListener('click', () => {
      const d = this.session.design;
      this.marks.clear();
      if (d) {
        const locked = entriesOf(d).filter((e) => e.locked).map((e) => e.id);
        if (locked.length) this.session.unlock(locked);
        else this.render(this.session.state);
      }
    });
    $.varSeg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.variantCount = Number(b.dataset.n);
      $.varSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      this.renderReforge(this.session.state);
    });
    $.compare.addEventListener('click', () => this.openCompare());
    this.prompt.addEventListener('input', () => this.renderReforge(this.session.state));
    this.prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!this.session.state.busy) void this.reforge();
      } else if (e.key === 'Enter' && !e.shiftKey && !this.session.design) {
        e.preventDefault();
        if (!this.session.state.busy) void this.reforge();
      }
    });
    $.list.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mark]');
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!card) return;
      const id = card.dataset.id!;
      if (btn) this.toggleMark(id, btn.dataset.mark as Mark);
    });
    $.list.addEventListener('mouseover', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (card) this.setHover(card.dataset.id!, 'card');
    });
    $.list.addEventListener('mouseleave', () => this.setHover(null, 'card'));
    $.list.addEventListener('focusin', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!card) return;
      this.focusIdx = Number(card.dataset.idx ?? 0);
      this.setHover(card.dataset.id!, 'card');
    });
    $.tiles.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
      if (!t) return;
      const v = Number(t.dataset.v);
      this.viewIdx = v;
      this.session.pick(v);
      this.hoverVariant = null;
      this.render(this.session.state);
    });
    $.tiles.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
      const v = t ? Number(t.dataset.v) : null;
      if (v !== this.hoverVariant) {
        this.hoverVariant = v;
        this.renderPreview(this.session.state, { crossfade: true });
      }
    });
    $.tiles.addEventListener('mouseleave', () => {
      if (this.hoverVariant === null) return;
      this.hoverVariant = null;
      this.renderPreview(this.session.state, { crossfade: true });
    });
    $.chips.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-chip]');
      if (!c) return;
      const text = c.dataset.chip!;
      if (!this.session.design) this.prompt.value = text;
      else {
        const cur = this.prompt.value.trim();
        this.prompt.value = cur ? `${cur.replace(/[,.]$/, '')}, ${text}` : text;
      }
      this.prompt.focus();
      this.renderReforge(this.session.state);
    });
    $.error.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-retry]')) void this.reforge(true);
      if ((e.target as HTMLElement).closest('[data-dismiss]')) {
        this.equipError = null;
        this.render(this.session.state);
      }
    });
    $.modal.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === $.modal || t.closest('[data-close]')) $.modal.hidden = true;
      const pick = t.closest<HTMLElement>('[data-pick]');
      if (pick) {
        const v = Number(pick.dataset.pick);
        this.viewIdx = v;
        this.session.pick(v);
        $.modal.hidden = true;
      }
    });
  }

  private handleKey(e: KeyboardEvent) {
    if (this.closed) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!this.$.modal.hidden) this.$.modal.hidden = true;
      else if (!this.$.helpPop.hidden) this.$.help.click();
      else if (this.session.state.busy) this.session.cancel();
      else this.close();
      return;
    }
    // swallow game bindings while open
    e.stopImmediatePropagation();
    const inText = (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'INPUT';
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !inText) {
      e.preventDefault();
      if (!this.session.state.busy) void this.reforge();
      return;
    }
    if (inText) return;
    const d = this.session.design;
    if (!d) return;
    const comps = entriesOf(d);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.focusIdx = Math.max(0, Math.min(comps.length - 1, this.focusIdx + (e.key === 'ArrowDown' ? 1 : -1)));
      this.$.list.querySelector<HTMLElement>(`[data-idx="${this.focusIdx}"]`)?.focus();
      return;
    }
    const map: Record<string, Mark> = { '1': 'keep', '2': 'lock', '3': 'reject' };
    if (map[e.key] && comps[this.focusIdx]) {
      e.preventDefault();
      this.toggleMark(comps[this.focusIdx].id, map[e.key]);
    }
  }

  private toggleMark(id: string, mark: Mark) {
    const cur = this.marks.get(id);
    const next = cur === mark ? undefined : mark;
    const wasLocked = cur === 'lock';
    if (next) this.marks.set(id, next);
    else this.marks.delete(id);
    // LOCK is real editor state (kept verbatim by the next reprompt)
    if (next === 'lock') this.session.lock([id]);
    else if (wasLocked) this.session.unlock([id]);
    else this.render(this.session.state);
  }

  private setHover(id: string | null, from: 'card' | 'mesh') {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.turntable.highlight(id);
    this.$.list.querySelectorAll<HTMLElement>('[data-id]').forEach((c) => c.classList.toggle('hover', c.dataset.id === id));
    if (from === 'mesh' && id) this.$.list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  // ------------------------------------------------------------------ actions

  private async reforge(retry = false) {
    const s = this.session.state;
    if (s.busy) return;
    const d = this.session.design;
    let text = this.prompt.value.trim();
    if (retry && this.lastPrompt) text = this.lastPrompt;
    if (!text && !d) {
      this.prompt.focus();
      this.root.classList.remove('shake');
      void this.root.offsetWidth;
      this.root.classList.add('shake');
      return;
    }
    this.equipError = null;
    let prompt = text;
    if (d && !retry) {
      // rejected parts: removed now (their labels go to the request's `rejected`)
      const ids = new Set(entriesOf(d).map((e) => e.id));
      const rej = [...this.marks].filter(([, m]) => m === 'reject').map(([id]) => id).filter((id) => ids.has(id));
      if (rej.length) this.session.reject(rej);
      const cur = this.session.design!;
      const keep = entriesOf(cur).filter((e) => this.marks.get(e.id) === 'keep').map((e) => (e.id === PROJECTILE_ID ? `projectile ${e.label}` : e.label));
      if (!prompt) prompt = 'same weapon, reroll the unmarked parts';
      if (keep.length) prompt += ` (keep these parts as they are: ${keep.join(', ')})`;
    }
    this.lastPrompt = prompt;
    this.prevDesign = this.session.design;
    this.viewIdx = 0;
    this.hoverVariant = null;
    this.shownKey = '';
    this.shownCount = 0;
    this.shownProjectile = false;
    this.thumbs.clear();
    // marks survive only as locks (in the design); keep / reject are spent
    for (const [id, m] of [...this.marks]) if (m !== 'lock') this.marks.delete(id);
    await this.session.generate(prompt, { variants: this.variantCount });
  }

  private async equip() {
    const d = this.session.design;
    if (!d || this.session.state.busy || this.equipping) return;
    this.equipping = true;
    this.equipError = null;
    this.render(this.session.state);
    try {
      const origin = this.session.state.origin;
      await this.opts.onEquip(d, origin?.prompt || this.lastPrompt || this.prompt.value.trim() || d.name, origin);
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
    clearInterval(this.phTimer);
    if (this.typed) clearInterval(this.typed.timer);
    this.root.classList.add('leave');
    const done = () => {
      this.turntable.dispose();
      this.root.remove();
    };
    if (reducedMotion()) done();
    else setTimeout(done, 160);
    this.opts.onClose();
  }

  // ------------------------------------------------------------------ events

  private onEvent(ev: ForgeEvent) {
    if (ev.type === 'done' && ev.variant === this.viewIdx) this.reveal(ev.design);
  }

  private reveal(design: ForgeDesign) {
    const r = rarityOfDesign(design);
    const fr = this.$.reveal;
    fr.className = `forge-reveal tier-${r.tier}${r.tier >= 4 ? ' sheen' : ''}`;
    if (!reducedMotion()) {
      void fr.offsetWidth;
      fr.classList.add('go');
    }
    // name types in 25 ms / char
    if (this.typed) clearInterval(this.typed.timer);
    if (reducedMotion()) {
      this.typed = null;
      return;
    }
    const t = { full: design.name, n: 0, timer: 0 };
    t.timer = window.setInterval(() => {
      t.n++;
      this.$.name.textContent = t.full.slice(0, t.n);
      if (t.n >= t.full.length) {
        clearInterval(t.timer);
        this.typed = null;
      }
    }, 25);
    this.typed = t;
  }

  // ------------------------------------------------------------------ render

  /** the design shown in the preview / stats: hovered variant > streaming draft > picked design */
  private shown(s: ForgeSessionState): { design: ForgeDesign | null; draft: ForgeDraft | null } {
    if (this.hoverVariant !== null) {
      const d = s.drafts[this.hoverVariant];
      if (d) return { design: partialDesign(d, s.design), draft: d };
    }
    if (s.busy || (s.drafts.length && !s.design)) {
      const d = s.drafts[this.viewIdx] ?? s.drafts[0];
      if (d) return { design: partialDesign(d, this.prevDesign), draft: d };
      return { design: null, draft: null };
    }
    return { design: s.design, draft: null };
  }

  private render(s: ForgeSessionState) {
    if (this.closed) return;
    // design changed underneath (lock flags): marks follow the design's locked flags
    const d = s.design;
    if (d) {
      const ents = entriesOf(d);
      for (const e of ents) if (e.locked) this.marks.set(e.id, 'lock');
      for (const [id, m] of [...this.marks]) if (m === 'lock' && !ents.find((e) => e.id === id)?.locked) this.marks.delete(id);
    }
    const { design, draft } = this.shown(s);
    this.root.classList.toggle('busy', s.busy);
    this.root.classList.toggle('has-design', !!design);
    this.renderHeader(s, design, draft);
    this.renderList(s, design, draft);
    this.renderPreview(s);
    this.renderStats(s, design, draft);
    this.renderVariants(s);
    this.renderReforge(s);
    this.renderStatus(s, draft);
    this.renderError(s);
    if (this.wasBusy && !s.busy) this.renderChips();
    this.wasBusy = s.busy;
  }

  private renderHeader(s: ForgeSessionState, design: ForgeDesign | null, draft: ForgeDraft | null) {
    const name = design?.name ?? draft?.name ?? (s.busy ? 'Forging…' : (this.opts.seed?.title ?? (this.opts.mode === 'first' ? 'Forge your first weapon' : 'New weapon')));
    if (!this.typed) this.$.name.textContent = name;
    else this.typed.full = name;
    const done = !!design && !draft;
    if (done || (draft && draft.design)) {
      const r = rarityOfDesign(design!);
      this.$.tier.className = `forge-tier tier-${r.tier}`;
      this.$.tier.innerHTML = `${pipsHtml(r.tier)}<span>${esc(r.label)}</span>`;
    } else {
      this.$.tier.className = 'forge-tier pending';
      this.$.tier.innerHTML = `${pipsHtml(0)}<span>${s.busy ? 'Forging' : '—'}</span>`;
    }
  }

  private renderList(s: ForgeSessionState, design: ForgeDesign | null, draft: ForgeDraft | null) {
    const comps = entriesOf(design);
    const list = this.$.list;
    const editable = !draft && !!s.design;
    const skeletons = s.busy && !draft?.design ? Math.max(0, Math.max(5, this.prevDesign?.components.length ?? 0) - comps.length) : 0;
    // keyed reconcile: existing cards are updated in place (new ones animate in)
    const existing = new Map<string, HTMLElement>();
    list.querySelectorAll<HTMLElement>('[data-id]').forEach((n) => existing.set(n.dataset.id!, n));
    list.querySelectorAll('.forge-skel').forEach((n) => n.remove());
    const keep = new Set<string>();
    comps.forEach((c, i) => {
      keep.add(c.id);
      let card = existing.get(c.id);
      const mark = this.marks.get(c.id);
      if (!card) {
        card = el('div', 'forge-comp');
        card.dataset.id = c.id;
        card.dataset.testid = c.id === PROJECTILE_ID ? 'forge-projectile' : 'forge-comp';
        card.setAttribute('role', 'listitem');
        card.tabIndex = 0;
        if (!reducedMotion()) card.classList.add('in');
      }
      card.dataset.idx = String(i);
      card.dataset.mark = mark ?? '';
      card.classList.toggle('readonly', !editable);
      const sig = `${c.label}|${c.role}|${c.desc}|${mark ?? ''}|${editable}`;
      if (card.dataset.sig !== sig) {
        card.dataset.sig = sig;
        card.innerHTML = `
          <span class="forge-comp-icon">${icon(c.role)}</span>
          <span class="forge-comp-text">
            <span class="ui-micro">${esc(c.role)}${mark === 'lock' ? ` · ${icon('lock', 'ui-icon forge-inline-icon')} locked` : ''}</span>
            <span class="forge-comp-label">${esc(c.label)}</span>
            <span class="forge-comp-desc">${esc(c.desc)}</span>
          </span>
          <span class="forge-comp-ctrl" role="group" aria-label="Mark ${esc(c.label)}">
            ${(['keep', 'lock', 'reject'] as Mark[])
              .map(
                (m) =>
                  `<button data-mark="${m}" data-testid="comp-${m}" class="m-${m}" aria-pressed="${mark === m}" title="${m.toUpperCase()} (${m === 'keep' ? 1 : m === 'lock' ? 2 : 3})" ${editable ? '' : 'disabled'}>${icon(m === 'keep' ? 'check' : m === 'lock' ? 'lock' : 'x', 'ui-icon ui-icon--sm')}<span>${m}</span></button>`,
              )
              .join('')}
          </span>`;
      }
      card.classList.toggle('hover', this.hoverId === c.id);
      if (list.children[i] !== card) list.insertBefore(card, list.children[i] ?? null);
    });
    for (const [id, n] of existing) if (!keep.has(id)) n.remove();
    for (let i = 0; i < skeletons; i++) {
      const sk = el('div', 'forge-comp forge-skel', '<span class="sk-icon"></span><span class="sk-lines"><i></i><i></i><i></i></span>');
      list.append(sk);
    }
    if (!comps.length && !skeletons) {
      if (!list.querySelector('.forge-list-empty')) list.append(el('div', 'forge-list-empty', 'Parts appear here.'));
    } else list.querySelector('.forge-list-empty')?.remove();
    this.$.count.textContent = comps.length ? (s.busy && !draft?.design ? `${comps.length}` : `${comps.length}/${comps.length}`) : '';
  }

  private renderPreview(s: ForgeSessionState, o: { crossfade?: boolean } = {}) {
    const { design } = this.shown(s);
    const key = design ? `${design.name}|${design.components.map((c) => c.id + (c.locked ? 'L' : '')).join(',')}|${design.projectile ? `${design.projectile.label}${design.projectile.locked ? 'L' : ''}` : ''}|${this.hoverVariant ?? this.viewIdx}|${s.picked}` : '';
    if (key !== this.shownKey) {
      const prevCount = this.shownCount;
      const comps = design?.components ?? [];
      // materialize the components that just arrived while streaming
      const fresh = s.busy && comps.length > prevCount && !o.crossfade ? comps.slice(prevCount).map((c) => c.id) : [];
      if (s.busy && design?.projectile && !this.shownProjectile && !o.crossfade) fresh.push(PROJECTILE_ID);
      this.turntable.setDesign(design, { materialize: fresh, crossfade: o.crossfade, keepFrame: s.busy && prevCount > 0 });
      this.shownKey = key;
      this.shownCount = comps.length;
      this.shownProjectile = !!design?.projectile;
    }
    this.turntable.setMarks(this.marks);
    this.$.empty.hidden = !!design || s.busy;
    this.$.stage.classList.toggle('forging', s.busy);
  }

  private renderStats(_s: ForgeSessionState, design: ForgeDesign | null, draft: ForgeDraft | null) {
    if (!design) {
      renderWeaponCard(this.$.card, null);
      this.$.stats.innerHTML = `<div class="forge-stats-empty ui-micro">Stats appear here</div>`;
      return;
    }
    const raw = draft?.stats ?? design.stats;
    const w = weaponFromStats(raw, design.class, design.fireMode, design.name);
    const r = rarityOfDesign(design);
    const card: WeaponCardData = {
      name: design.name,
      cls: design.class,
      rarity: draft && !draft.design ? { tier: Math.max(1, r.tier - 0) as Tier, label: TIER_LABELS[r.tier] } : r,
      flavor: flavorFor(design.name, design.class),
      forgedBy: this.opts.playerName,
      credit: !draft && _s.origin?.cached && _s.design === design ? creditFromInfo(_s.origin.cached, this.opts.playerIdentity) : null,
      prompt: !draft && _s.design === design ? _s.origin?.prompt : undefined,
      move: moveSpeedLabel(w.moveSpeedMult),
      element: w.element ?? null,
    };
    renderWeaponCard(this.$.card, card, { testid: 'forge-card' });
    const ref = this.prevDesign && this.prevDesign !== design ? designToWeapon(this.prevDesign) : null;
    const rows = statRows(w, ref);
    const t = ttk(w);
    const budget = budgetOf(raw, design.class, design.fireMode);
    const move = moveSpeedLabel(w.moveSpeedMult);
    const segs = (row: (typeof rows)[number]) => {
      const on = Math.round(row.norm * 8);
      const tick = Math.min(7, Math.floor(row.avg * 8));
      let h = '';
      for (let i = 0; i < 8; i++) h += `<i class="${i < on ? 'on' : ''}${i === tick ? ' avg' : ''}"></i>`;
      return h;
    };
    const bseg = Math.min(10, Math.ceil(Math.min(1.2, budget.usage) * 10 - 1e-6));
    let bh = '';
    for (let i = 0; i < 10; i++) bh += `<i class="${i < bseg ? 'on' : ''} b${i}"></i>`;
    const over = budget.usage > 1.005 || budget.nerfs.length > 0;
    this.$.stats.innerHTML = `
      <div class="forge-sec-head"><span class="ui-micro">Stats</span><span class="ui-micro forge-vs"><i class="avg-key"></i> class avg</span></div>
      ${rows
        .map(
          (row) => `<div class="forge-stat ${row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : ''}" data-stat="${row.key}">
            <span class="forge-stat-label">${esc(row.label)}</span>
            <span class="forge-stat-bar">${segs(row)}</span>
            <span class="forge-stat-val ui-num">${esc(row.value)}</span>
            <span class="forge-stat-delta" aria-label="${row.delta > 0 ? 'better' : row.delta < 0 ? 'worse' : 'same'}">${row.delta > 0 ? '▲' : row.delta < 0 ? '▼' : '–'}</span>
          </div>`,
        )
        .join('')}
      <div class="forge-ttk"><span class="ui-micro">TTK @100 HP</span><span class="ui-num" data-testid="forge-ttk">${t === null ? '—' : t < 0.05 ? '0.00 s' : `${t.toFixed(2)} s`}</span></div>
      <div class="forge-ttk forge-move ${move.startsWith('+') ? 'up' : move.startsWith('−') ? 'down' : ''}"><span class="ui-micro">Move speed</span><span class="ui-num" data-testid="forge-move">${esc(move)}</span></div>
      ${w.element ? `<div class="forge-ttk forge-element forge-el--${esc(w.element)}"><span class="ui-micro">Element</span><span class="ui-num" data-testid="forge-element">${icon(w.element, 'ui-icon ui-icon--sm')} ${esc(elementBlurb(w))}</span></div>` : ''}
      <div class="forge-budget ${over ? 'over' : ''}">
        <div class="forge-budget-head"><span class="ui-micro">Balance budget</span><span class="ui-num">${Math.round(budget.usage * 100)}%</span></div>
        <div class="forge-budget-bar">${bh}</div>
        ${over ? `<div class="forge-nerf" data-testid="forge-nerf">${icon('warning', 'ui-icon ui-icon--sm')}<span>Over budget, nerfed${budget.nerfs.length ? `: ${esc(budget.nerfs.join(' · '))}` : ''}</span></div>` : ''}
      </div>`;
  }

  private renderVariants(s: ForgeSessionState) {
    const drafts = s.drafts;
    const host = this.$.tiles;
    this.root.classList.toggle('has-variants', drafts.length > 1);
    if (drafts.length <= 1) {
      host.innerHTML = `<div class="forge-variants-hint">${icon('compare', 'ui-icon ui-icon--sm')}<span>Pick <b>×2</b> or <b>×3</b> for variants</span></div>`;
      (this.$.compare as HTMLButtonElement).disabled = true;
      return;
    }
    const base = s.design ? designToWeapon(s.design) : null;
    host.innerHTML = drafts
      .map((d, i) => {
        const done = !!d.design;
        const r = done ? rarityOfDesign(d.design!) : null;
        let thumb = '';
        if (done) {
          const k = `${i}|${d.design!.name}|${d.design!.components.length}`;
          if (!this.thumbs.has(k)) this.thumbs.set(k, this.turntable.thumbnail(d.design!));
          thumb = this.thumbs.get(k)!;
        }
        let diff = '';
        if (done && base && s.picked !== i) diff = biggestDiff(designToWeapon(d.design!), base);
        else if (done) diff = `${d.design!.components.length} parts`;
        const sel = s.picked === i;
        return `<button class="forge-tile ${r ? `tier-${r.tier}` : ''} ${sel ? 'sel' : ''} ${done ? '' : 'loading'} ${d.error ? 'err' : ''}" data-v="${i}" data-testid="forge-variant-${LETTERS[i]}" role="radio" aria-checked="${sel}" ${done ? '' : 'disabled'}>
          <span class="forge-tile-thumb">${thumb ? `<img alt="" src="${thumb}">` : `<span class="forge-tile-spin"></span>`}</span>
          <span class="forge-tile-meta">
            <span class="forge-tile-letter">${LETTERS[i]}</span>
            <span class="forge-tile-name">${esc(d.name || (d.error ? 'Failed' : 'Forging…'))}</span>
            ${r ? pipsHtml(r.tier) : `<span class="ui-micro">${d.error ? 'error' : `${d.components.length} parts`}</span>`}
            <span class="forge-tile-diff">${esc(diff)}</span>
          </span>
        </button>`;
      })
      .join('');
    (this.$.compare as HTMLButtonElement).disabled = drafts.filter((d) => d.design).length < 2;
  }

  private renderReforge(s: ForgeSessionState) {
    const d = s.design;
    const label = this.$.reforgeLabel;
    const sub = this.$.reforgeSub;
    this.root.querySelector('.forge-reforge .ui-kbd')?.toggleAttribute('hidden', s.busy);
    if (s.busy) {
      label.textContent = 'Cancel';
      sub.textContent = 'stop';
      this.$.reforge.classList.add('cancel');
    } else {
      this.$.reforge.classList.remove('cancel');
      label.textContent = d ? 'Reforge' : 'Forge';
      if (d) {
        let keep = 0;
        let lock = 0;
        let rej = 0;
        const ents = entriesOf(d);
        for (const c of ents) {
          const m = this.marks.get(c.id);
          if (m === 'keep') keep++;
          else if (m === 'lock') lock++;
          else if (m === 'reject') rej++;
        }
        const reroll = ents.length - keep - lock - rej;
        sub.textContent = `keep ${keep} · locked ${lock} · reroll ${reroll}${rej ? ` · reject ${rej}` : ''}`;
      } else sub.textContent = this.variantCount > 1 ? `${this.variantCount} variants` : 'from scratch';
    }
    const equip = this.$.equip as HTMLButtonElement;
    equip.disabled = !d || s.busy || this.equipping;
    this.$.equipLabel.textContent = this.equipping ? 'Equipping…' : (this.opts.equipLabel ?? 'Equip');
  }

  private renderStatus(s: ForgeSessionState, draft: ForgeDraft | null) {
    const st = this.$.status;
    if (s.busy) {
      const n = draft?.components.length ?? 0;
      const last = draft?.components[n - 1]?.label;
      st.innerHTML = `<span class="forge-pulse"></span>FORGING · ${last ? `${esc(last)} (${n})` : draft?.name ? esc(draft.name) : s.drafts.length > 1 ? `${s.drafts.length} variants` : 'starting'}…`;
      st.hidden = false;
    } else if (s.design && s.drafts.length && !this.equipping) {
      st.innerHTML = `${icon('check', 'ui-icon ui-icon--sm')}<span>${s.origin?.cached ? 'CACHED · instant' : 'FORGED'} · ${s.design.components.length} parts${s.mock && !s.origin?.cached ? ' · mock forge' : ''}</span>`;
      st.hidden = false;
    } else st.hidden = true;
  }

  private renderError(s: ForgeSessionState) {
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
    const d = this.session.design;
    const list = d ? (d.fireMode === 'melee' ? MODIFIERS_MELEE : MODIFIERS_GUN) : STARTERS;
    // a stable but varied subset of 6
    const seed = (d?.name ?? '').length;
    const out: string[] = [];
    for (let i = 0; i < list.length * 2 && out.length < Math.min(6, list.length); i++) {
      const c = list[(seed + i * 5) % list.length];
      if (!out.includes(c)) out.push(c);
    }
    this.$.chips.innerHTML = `<span class="ui-micro forge-chips-label">${d ? 'Try' : 'Ideas'}</span>${out.map((c) => `<button class="ui-chip" data-chip="${esc(c)}"><span>${d ? '+ ' : ''}${esc(c)}</span></button>`).join('')}`;
  }

  private rotatePlaceholder() {
    let i = 0;
    const set = () => {
      this.prompt.placeholder = this.session.design ? 'What to change? e.g. “add a scope”' : PLACEHOLDERS[i++ % PLACEHOLDERS.length];
    };
    set();
    this.phTimer = window.setInterval(set, 4000);
  }

  private openCompare() {
    const s = this.session.state;
    const ds = s.drafts.map((d, i) => ({ d: d.design, i })).filter((x) => x.d) as { d: ForgeDesign; i: number }[];
    if (ds.length < 2) return;
    const ws = ds.map((x) => designToWeapon(x.d));
    const keys: { label: string; get: (w: Weapon) => number; fmt: (v: number) => string; invert?: boolean }[] = [
      { label: 'DMG', get: (w) => w.damage * w.pellets, fmt: (v) => v.toFixed(1) },
      { label: 'RPM', get: (w) => w.fireRate * 60, fmt: (v) => `${Math.round(v)}` },
      { label: 'Range', get: (w) => w.range, fmt: (v) => `${v.toFixed(0)} m` },
      { label: 'Mag', get: (w) => w.magSize, fmt: (v) => `${v}` },
      { label: 'Reload', get: (w) => w.reloadTime, fmt: (v) => `${v.toFixed(1)} s`, invert: true },
      { label: 'TTK', get: (w) => ttk(w) ?? 99, fmt: (v) => `${v.toFixed(2)} s`, invert: true },
    ];
    const cards = ds
      .map((x) => {
        const host = el('div');
        renderWeaponCard(host, { name: x.d.name, cls: x.d.class, rarity: rarityOfDesign(x.d), flavor: flavorFor(x.d.name, x.d.class) }, { compact: true });
        return `<div class="forge-cmp-col">${host.innerHTML}<button class="ui-btn ui-btn--secondary ui-btn--sm" data-pick="${x.i}">Pick ${LETTERS[x.i]}</button></div>`;
      })
      .join('');
    const table = keys
      .map((k) => {
        const vals = ws.map(k.get);
        const best = k.invert ? Math.min(...vals) : Math.max(...vals);
        return `<tr><th>${k.label}</th>${vals.map((v) => `<td class="${v === best ? 'best' : ''}">${k.fmt(v)}</td>`).join('')}</tr>`;
      })
      .join('');
    this.$.modal.innerHTML = `<div class="forge-modal-box ui-plate--menu" role="dialog" aria-label="Compare variants">
      <div class="forge-modal-head"><span class="ui-title">Compare</span><button class="forge-iconbtn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="forge-cmp-cards" style="--n:${ds.length}">${cards}</div>
      <table class="forge-cmp-table"><thead><tr><th></th>${ds.map((x) => `<th>${LETTERS[x.i]}</th>`).join('')}</tr></thead><tbody>${table}</tbody></table>
    </div>`;
    this.$.modal.hidden = false;
  }
}

function biggestDiff(a: Weapon, b: Weapon): string {
  const cands: [string, number, number][] = [
    ['DMG', a.damage * a.pellets, b.damage * b.pellets],
    ['RPM', a.fireRate, b.fireRate],
    ['RANGE', a.range, b.range],
    ['MAG', a.magSize, b.magSize],
  ];
  let best = '';
  let mag = 0;
  for (const [k, x, y] of cands) {
    if (!y) continue;
    const d = (x - y) / y;
    if (Math.abs(d) > Math.abs(mag)) {
      mag = d;
      best = k;
    }
  }
  if (!best || Math.abs(mag) < 0.02) return 'similar stats';
  return `${mag > 0 ? '+' : '−'}${Math.round(Math.abs(mag) * 100)}% ${best}`;
}

