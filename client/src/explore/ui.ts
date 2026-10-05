import './explore.css';
import mapUrl from './krakow-oldtown.map.png?url';
import { LANDMARKS, MAP_IMAGE, NORTH_OFFSET_DEG, SECRETS } from './data';
import { prefs, type Prefs } from './prefs';
import { tx } from './i18n';
import { settings } from '../settings';

export type Kind = 'landmark' | 'secret';

export interface JournalEntry {
  kind: Kind;
  id: string;
  num: number;
  name: string;
  /** Polish name (landmarks) */
  sub?: string;
  done: boolean;
  /** found: the story; not found: the hint */
  text: string;
  x: number;
  z: number;
  target: boolean;
}

export interface CardContent {
  kicker: string;
  title: string;
  polish?: string;
  say?: string;
  paragraphs: string[];
  fact?: string;
}

export interface GuideInfo {
  name: string;
  direction: string;
  walking: boolean;
}

export interface LabelInfo {
  x: number;
  y: number;
  name: string;
  dist: string;
  target: boolean;
  done: boolean;
}

/** what the UI asks of the game */
export interface UiHost {
  start(): void;
  resume(): void;
  guide(kind: Kind, id: string): void;
  walk(kind: Kind, id: string): void;
  travel(kind: Kind, id: string): void;
  toggleWalk(): void;
  nextTarget(): void;
  stopGuide(): void;
  interact(): void;
  describe(): void;
  resetProgress(): void;
  journal(): { landmarks: JournalEntry[]; secrets: JournalEntry[]; me: { x: number; z: number; heading: number } };
  /** read text aloud now, even with narration off (the "Read aloud" buttons) */
  readAloud(text: string): void;
  click(): void;
  /** blind mode on / off (with a spoken confirmation) */
  toggleBlindMode(): void;
  /** a screen opened (free the mouse pointer) */
  screenOpened(): void;
  voices(): { options: { uri: string; label: string }[]; basic: boolean; polish: boolean };
}

type Screen = 'title' | 'menu' | 'map' | 'card' | 'settings' | 'help' | 'done';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

function button(label: string | Node, onClick: () => void, cls = 'kx-btn', attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button', ...attrs }, label);
  b.addEventListener('click', onClick);
  return b;
}

function key(k: string): HTMLElement {
  return h('span', { class: 'kx-key', 'aria-hidden': 'true' }, k);
}

/**
 * The explorer's DOM: HUD (compass, where-am-I, progress, guide panel, interaction prompt, world
 * labels, toasts) and the modal screens (title, menu, map & journal, info cards, settings, help).
 * Every control is a real <button> with a text label, reachable by Tab, with a visible focus ring.
 */
export class ExploreUi {
  readonly hud = h('div', { class: 'kx-hud', hidden: '' });
  private readonly compass = h('div', { class: 'kx-compass kx-box', 'aria-hidden': 'true' });
  private readonly whereName = h('div', { class: 'kx-where__name' }, 'Kraków');
  private readonly progress = h('div', { class: 'kx-where__progress' });
  private readonly guideBox = h('div', { class: 'kx-guide kx-box', role: 'group' });
  private readonly whereBox = h('div', { class: 'kx-where kx-box' });
  private readonly tools = h('div', { class: 'kx-tools' });
  private readonly guideName = h('div', { class: 'kx-guide__name' });
  private readonly guideDir = h('div', { class: 'kx-guide__dir' });
  private walkBtn!: HTMLButtonElement;
  private readonly prompt: HTMLButtonElement;
  private readonly labels = h('div', { class: 'kx-labels', 'aria-hidden': 'true' });
  private readonly toastEl = h('div', { class: 'kx-toast kx-box', 'aria-hidden': 'true' });
  private readonly hint = h('div', { class: 'kx-hint kx-box', hidden: '' });
  private readonly carry = h('div', { class: 'kx-carry kx-box', hidden: '' });
  private readonly fadeEl = h('div', { class: 'kx-fade' });
  private readonly screenEl = h('div', { class: 'kx-screen', hidden: '', role: 'dialog', 'aria-modal': 'true' });
  private screen: Screen | null = null;
  private introSpoken = false;
  /** performance.now() when a screen last closed (the closing key is not a game action) */
  closedAt = 0;
  private back: Screen | null = null;
  private card: CardContent | null = null;
  private toastTimer = 0;
  private compassMarks: { el: HTMLElement; bearing: number }[] = [];
  private placeMarks: HTMLElement[] = [];
  private targetMark = h('div', { class: 'kx-compass__mark kx-compass__mark--target' }, '▼');
  private labelPool: HTMLElement[] = [];
  private journalTab: Kind = 'landmark';
  private last = { where: '', progress: '', prompt: '', guide: '' };

  constructor(private readonly host: UiHost) {
    document.body.classList.add('kx');
    // compass letters every 45°
    COMPASS.forEach((name, i) => {
      const el = h('div', { class: `kx-compass__mark${i % 2 === 0 ? ' kx-compass__mark--major' : ''}${i === 0 ? ' kx-compass__mark--n' : ''}` }, name);
      this.compass.append(el);
      this.compassMarks.push({ el, bearing: i * 45 });
    });
    this.compass.append(this.targetMark);

    this.buildChrome();
    this.prompt = button('', () => host.interact(), 'kx-prompt kx-box', { hidden: '' });
    this.hud.append(this.labels, h('div', { class: 'kx-dot' }), this.compass, this.whereBox, this.tools, this.guideBox, this.prompt, this.toastEl, this.carry, this.hint);
    document.body.append(this.hud, this.screenEl, this.fadeEl);

    // Escape / Back inside screens
    window.addEventListener('keydown', (e) => {
      if (this.screen === 'title' && !e.repeat) {
        if (e.code === 'KeyB') {
          e.preventDefault();
          this.host.toggleBlindMode();
          // keep focus on Start, so "B, then Enter" starts the game (Enter must not untoggle it)
          this.render();
          return;
        }
        // speech needs a key press first: the first one (Tab and Enter belong to screen readers / Start) speaks the intro
        if (!this.introSpoken && !['Tab', 'Enter', 'NumpadEnter', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
          this.introSpoken = true;
          this.host.readAloud(tx().intro);
        }
      }
      if (!this.screen) {
        if (e.code === 'Escape' && !this.hud.hidden) {
          e.preventDefault();
          this.open('menu');
        }
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        this.closeScreen();
      } else if ((e.code === 'KeyM' && this.screen === 'map') || (e.code === 'KeyH' && this.screen === 'help')) {
        e.preventDefault();
        this.closeScreen();
      }
    });
    // HUD buttons give focus back to the game (so Space / Enter do not press them again)
    this.hud.addEventListener('click', () => (document.activeElement as HTMLElement | null)?.blur?.());
    this.applyPrefs(prefs.current);
    let lang = prefs.current.lang;
    prefs.onChange((p) => {
      this.applyPrefs(p);
      if (p.lang !== lang) {
        // language switch: rebuild the HUD text and the open screen
        lang = p.lang;
        this.buildChrome();
        this.last = { where: '', progress: '', prompt: '', guide: '' };
        if (this.screen) this.render();
      }
    });
  }

  /** the HUD's fixed text: where-am-I label, tool buttons, guide panel, carry badge */
  private buildChrome() {
    const t = tx();
    const host = this.host;
    this.whereBox.replaceChildren(h('div', { class: 'kx-where__label' }, t.nearLabel), this.whereName, this.progress);
    this.tools.replaceChildren(
      button(h('span', {}, key('M'), ' ', h('span', { class: 'kx-label-text' }, t.map)), () => this.open('map'), 'kx-btn', { 'aria-label': t.mapAria }),
      button(h('span', {}, key('V'), ' ', h('span', { class: 'kx-label-text' }, t.whereAmI)), () => host.describe(), 'kx-btn', { 'aria-label': t.whereAria }),
      button(h('span', {}, key('H'), ' ', h('span', { class: 'kx-label-text' }, t.help)), () => this.open('help'), 'kx-btn', { 'aria-label': t.helpAria }),
      button(h('span', {}, key('Esc'), ' ', h('span', { class: 'kx-label-text' }, t.menu)), () => this.open('menu'), 'kx-btn', { 'aria-label': t.menuAria }),
    );
    this.walkBtn = button(h('span', {}, key('F'), ` ${t.walkMe}`), () => host.toggleWalk(), 'kx-btn kx-btn--primary', { 'aria-pressed': 'false' });
    this.guideBox.setAttribute('aria-label', t.guideGroup);
    this.guideBox.replaceChildren(
      h('div', { class: 'kx-guide__to' }, t.guideTo),
      this.guideName,
      this.guideDir,
      h('div', { class: 'kx-guide__row' }, this.walkBtn, button(h('span', {}, key('G'), ` ${t.nextPlace}`), () => host.nextTarget()), button(t.stopGuide, () => host.stopGuide(), 'kx-btn kx-btn--quiet')),
    );
    this.carry.textContent = t.carrying;
  }

  private applyPrefs(p: Prefs) {
    const root = document.documentElement;
    root.classList.toggle('kx-hc', p.highContrast);
    root.classList.toggle('reduced-motion', p.calmMotion);
    root.style.setProperty('--kx-text', String(p.textScale / 100));
    root.style.setProperty('--kx-on', JSON.stringify(tx().on));
    root.style.setProperty('--kx-off', JSON.stringify(tx().off));
    root.lang = p.lang;
  }

  // ------------------------------------------------------------------ screens

  /** a modal screen is up (the game holds movement) */
  get blocking() {
    return this.screen !== null;
  }

  get current() {
    return this.screen;
  }

  open(s: Screen) {
    if (this.screen && this.screen !== s && s !== 'title') this.back = this.screen === 'card' ? this.back : this.screen;
    this.screen = s;
    this.host.screenOpened();
    this.render();
  }

  showCard(c: CardContent) {
    this.card = c;
    this.open('card');
  }

  closeScreen() {
    const s = this.screen;
    if (s === 'title') return; // the title needs an explicit "Start"
    const back = this.back;
    this.back = null;
    if (back && back !== s && (s === 'settings' || s === 'help' || s === 'map') && back !== 'card') {
      this.screen = back;
      this.render();
      return;
    }
    this.screen = null;
    this.closedAt = performance.now();
    this.screenEl.hidden = true;
    this.screenEl.replaceChildren();
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.host.resume();
  }

  /** draw the current screen; `keep` = data-k of the control to focus afterwards */
  private render(keep?: string) {
    const el = this.screenEl;
    el.hidden = false;
    el.className = `kx-screen${this.screen === 'title' ? ' kx-screen--title' : ''}`;
    el.replaceChildren();
    const sheet = h('div', { class: 'kx-sheet' });
    el.append(sheet);
    switch (this.screen) {
      case 'title':
        this.renderTitle(sheet);
        break;
      case 'menu':
        this.renderMenu(sheet);
        break;
      case 'map':
        sheet.classList.add('kx-sheet--wide');
        this.renderMap(sheet);
        break;
      case 'card':
        this.renderCard(sheet);
        break;
      case 'settings':
        this.renderSettings(sheet);
        break;
      case 'help':
        this.renderHelp(sheet);
        break;
      case 'done':
        this.renderDone(sheet);
        break;
    }
    const heading = sheet.querySelector('h1, h2') as HTMLElement | null;
    if (heading) {
      heading.tabIndex = -1;
      el.setAttribute('aria-label', heading.textContent ?? '');
    }
    // focus the main action (or the heading) so keyboard and screen reader users land inside
    const first = (keep && sheet.querySelector<HTMLElement>(`[data-k="${keep}"]`)) || sheet.querySelector<HTMLElement>('[data-autofocus]') || heading;
    requestAnimationFrame(() => first?.focus());
  }

  private closeRow(autofocus = true): HTMLElement {
    return h('div', { class: 'kx-actions' }, button(this.back ? tx().back : tx().close, () => this.closeScreen(), 'kx-btn', autofocus ? { 'data-autofocus': '' } : {}));
  }

  private renderTitle(s: HTMLElement) {
    s.append(
      h('h1', {}, 'CityScape'),
      h('p', { class: 'kx-sub' }, tx().tagline(LANDMARKS.length, SECRETS.length)),
      h('h3', {}, tx().beforeStart),
      this.quickToggles(),
      h(
        'div',
        { class: 'kx-actions' },
        button(tx().start, () => {
          this.host.click();
          this.screen = null;
          this.closedAt = performance.now();
          this.screenEl.hidden = true;
          this.host.start();
        }, 'kx-btn kx-btn--primary', { 'data-autofocus': '' }),
        button(tx().allOptions, () => this.open('settings')),
        button(tx().controlsHow, () => this.open('help')),
      ),
    );
  }

  private quickToggles(): HTMLElement {
    const wrap = h('div', { class: 'kx-quick' });
    const p = prefs.current;
    const tog = (label: string, hint: string, on: boolean, set: (v: boolean) => void, k = label) => {
      const b = h('button', { class: 'kx-toggle', type: 'button', 'aria-pressed': String(on), 'data-k': k }, label, h('small', {}, hint));
      b.addEventListener('click', () => {
        const v = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(v));
        set(v);
        this.host.click();
      });
      return b;
    };
    const q = tx().quick;
    const blind = h('button', { class: 'kx-toggle', type: 'button', 'aria-pressed': String(p.blindMode), 'data-k': 'blind' }, q.blind[0], h('small', {}, q.blind[1]));
    // language: a plain button (not a toggle): it names the other language, in that language
    const langBtn = h('button', { class: 'kx-toggle kx-toggle--lang', type: 'button', 'data-k': 'lang', lang: p.lang === 'pl' ? 'en' : 'pl' }, q.lang[0], h('small', {}, q.lang[1]));
    langBtn.addEventListener('click', () => {
      prefs.set('lang', p.lang === 'pl' ? 'en' : 'pl');
      prefs.set('voice', '');
      this.host.click();
      this.render('lang');
    });
    blind.addEventListener('click', () => {
      this.host.toggleBlindMode();
      this.render('blind');
    });
    wrap.append(
      blind,
      tog(q.read[0], q.read[1], p.narration, (v) => {
        prefs.set('narration', v);
        if (v) this.host.readAloud(tx().narrationOn);
      }),
      tog(q.captions[0], q.captions[1], p.captions, (v) => prefs.set('captions', v)),
      tog(q.large[0], q.large[1], p.textScale > 100, (v) => prefs.set('textScale', v ? 150 : 100)),
      tog(q.contrast[0], q.contrast[1], p.highContrast, (v) => prefs.set('highContrast', v)),
      tog(q.calm[0], q.calm[1], p.calmMotion, (v) => {
        prefs.set('calmMotion', v);
        settings.set('headBob', !v);
      }),
      tog(q.slow[0], q.slow[1], p.walkSpeed === 'slow', (v) => prefs.set('walkSpeed', v ? 'slow' : 'normal')),
      langBtn,
    );
    return wrap;
  }

  private renderMenu(s: HTMLElement) {
    s.append(
      h('h2', {}, tx().paused),
      h('p', { class: 'kx-sub' }, tx().pausedSub),
      h(
        'div',
        { class: 'kx-actions' },
        button(tx().keepExploring, () => this.closeScreen(), 'kx-btn kx-btn--primary', { 'data-autofocus': '' }),
        button(tx().mapJournal, () => this.open('map')),
        button(tx().accessibility, () => this.open('settings')),
        button(tx().controlsHelp, () => this.open('help')),
      ),
      h('h3', {}, tx().startOver),
      h('p', {}, tx().startOverText),
      h(
        'div',
        { class: 'kx-actions' },
        button(tx().reset, () => {
          if (window.confirm(tx().resetConfirm)) this.host.resetProgress();
        }),
      ),
    );
  }

  private renderCard(s: HTMLElement) {
    const c = this.card;
    if (!c) return;
    const text = [c.title, c.polish ? tx().sayItSpoken(c.polish, c.say ?? '') : '', ...c.paragraphs, c.fact ?? ''].filter(Boolean).join(' ');
    s.append(
      h('div', { class: 'kx-where__label' }, c.kicker),
      h('h2', {}, c.title),
      ...(c.polish ? [h('p', { class: 'kx-polish' }, tx().sayIt(c.polish, c.say ?? ''))] : []),
      ...c.paragraphs.map((p) => h('p', {}, p)),
      ...(c.fact ? [h('p', { class: 'kx-fact' }, c.fact)] : []),
      h(
        'div',
        { class: 'kx-actions' },
        button(tx().cont, () => this.closeScreen(), 'kx-btn kx-btn--primary', { 'data-autofocus': '' }),
        button(tx().readAloud, () => this.host.readAloud(text)),
      ),
    );
  }

  private renderMap(s: HTMLElement) {
    const j = this.host.journal();
    const doneL = j.landmarks.filter((l) => l.done).length;
    const doneS = j.secrets.filter((x) => x.done).length;
    const t = tx();
    s.append(h('h2', {}, t.mapJournal), h('p', { class: 'kx-sub' }, t.mapSummary(doneL, j.landmarks.length, doneS, j.secrets.length)));

    // ---- map image with numbered pins
    const map = h('div', { class: 'kx-map' });
    const img = h('img', { src: mapUrl, alt: t.mapAlt });
    map.append(img);
    const pct = (x: number, z: number) => ({
      left: `${((x - MAP_IMAGE.minX) / (MAP_IMAGE.maxX - MAP_IMAGE.minX)) * 100}%`,
      top: `${((z - MAP_IMAGE.minZ) / (MAP_IMAGE.maxZ - MAP_IMAGE.minZ)) * 100}%`,
    });
    for (const e of [...j.landmarks, ...j.secrets.filter((x) => x.done && x.x !== 0)]) {
      const pin = button(
        e.kind === 'secret' ? '★' : String(e.num),
        () => {
          this.host.guide(e.kind, e.id);
          this.closeAll();
        },
        `kx-map__pin${e.done ? ' kx-map__pin--done' : ''}${e.target ? ' kx-map__pin--target' : ''}${e.kind === 'secret' ? ' kx-map__pin--secret' : ''}`,
        { 'aria-label': t.pinAria(e.name, e.done), title: e.name },
      );
      Object.assign(pin.style, pct(e.x, e.z));
      map.append(pin);
    }
    const me = h('div', { class: 'kx-map__me', 'aria-hidden': 'true' });
    Object.assign(me.style, pct(j.me.x, j.me.z));
    // heading 0° = north; north on this map points right, tilted up by the model's skew
    me.style.transform = `rotate(${j.me.heading + 90 - NORTH_OFFSET_DEG}deg)`;
    map.append(me);
    const north = h('div', { class: 'kx-map__north kx-box', 'aria-hidden': 'true' }, 'N ', h('span', { style: `display:inline-block;transform:rotate(${90 - NORTH_OFFSET_DEG}deg)` }, '⬆'));
    map.append(north);

    // ---- journal list
    const side = h('div', {});
    const tabs = h('div', { class: 'kx-tabs', role: 'group', 'aria-label': t.journalSection });
    const list = h('ul', { class: 'kx-list' });
    const fill = () => {
      list.replaceChildren();
      const items = this.journalTab === 'landmark' ? j.landmarks : j.secrets;
      for (const e of items) list.append(this.journalItem(e));
      for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === this.journalTab));
    };
    for (const [tab, label] of [['landmark', t.placesTab(doneL, j.landmarks.length)], ['secret', t.legendsTab(doneS, j.secrets.length)]] as const) {
      const b = button(label, () => {
        this.journalTab = tab;
        fill();
      }, 'kx-btn', { 'data-tab': tab });
      tabs.append(b);
    }
    side.append(tabs, list);
    fill();

    side.classList.add('kx-journal__side');
    const grid = h('div', { class: 'kx-journal' }, map, side);
    s.append(this.closeRow(false), grid);
  }

  private journalItem(e: JournalEntry): HTMLElement {
    const t = tx();
    const li = h('li', { class: `kx-item${e.done ? ' kx-item--done' : ''}` });
    li.append(
      h(
        'div',
        { class: 'kx-item__head' },
        h('span', { class: 'kx-item__num' }, e.kind === 'secret' ? (e.done ? '★' : '☆') : String(e.num)),
        h('span', { class: 'kx-item__name' }, e.kind === 'secret' && !e.done ? t.hiddenLegend : e.name),
        h('span', { class: 'kx-item__state' }, e.done ? (e.kind === 'secret' ? t.found : t.visited) : e.target ? t.guiding : ''),
      ),
    );
    if (e.sub) li.append(h('p', { class: 'kx-item__text' }, e.sub));
    li.append(h('p', { class: 'kx-item__text' }, e.kind === 'secret' && !e.done ? `${t.hint}${e.text}` : e.text));
    const btns = h('div', { class: 'kx-item__btns' });
    const close = (fn: () => void) => () => {
      fn();
      this.closeAll();
    };
    if (!(e.kind === 'secret' && e.id === 'twardowski')) {
      btns.append(
        button(t.guideMe, close(() => this.host.guide(e.kind, e.id)), 'kx-btn', { 'aria-label': t.guideMeAria(e.done || e.kind === 'landmark' ? e.name : t.hiddenLegendLower) }),
        button(t.walkMe, close(() => this.host.walk(e.kind, e.id)), 'kx-btn', { 'aria-label': t.walkAria(e.done || e.kind === 'landmark' ? e.name : t.hiddenLegendLower) }),
        button(t.goNow, close(() => this.host.travel(e.kind, e.id)), 'kx-btn', { 'aria-label': t.goAria(e.done || e.kind === 'landmark' ? e.name : t.hiddenLegendLower) }),
      );
    }
    if (e.done) btns.append(button(t.readAloud, () => this.host.readAloud(`${e.name}. ${e.text}`), 'kx-btn kx-btn--quiet'));
    li.append(btns);
    return li;
  }

  private closeAll() {
    this.back = null;
    this.screen = null;
    this.closedAt = performance.now();
    this.screenEl.hidden = true;
    this.screenEl.replaceChildren();
    this.host.resume();
  }

  private renderSettings(s: HTMLElement) {
    const t = tx();
    const st = t.set;
    s.append(h('h2', {}, t.accessibility), h('p', { class: 'kx-sub' }, t.settingsSub));
    const list = h('div', { class: 'kx-settings' });
    const p = prefs.current;
    const row = (name: string, hint: string, control: HTMLElement) =>
      h('div', { class: 'kx-setting' }, h('div', {}, h('span', { class: 'kx-setting__name' }, name), h('small', {}, hint)), control);
    const toggle = (name: string, on: boolean, set: (v: boolean) => void) => {
      const b = h('button', { class: 'kx-btn kx-switch', type: 'button', 'aria-pressed': String(on), 'aria-label': name }, on ? t.on : t.off);
      b.addEventListener('click', () => {
        const v = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(v));
        b.textContent = v ? t.on : t.off;
        set(v);
        this.host.click();
      });
      return b;
    };
    const seg = <T extends string | number>(name: string, options: [T, string][], value: T, set: (v: T) => void) => {
      const wrap = h('div', { class: 'kx-seg', role: 'group', 'aria-label': name });
      for (const [v, label] of options) {
        const b = h('button', { type: 'button', 'aria-pressed': String(v === value) }, label);
        b.addEventListener('click', () => {
          for (const o of wrap.querySelectorAll('button')) o.setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-pressed', 'true');
          set(v);
          this.host.click();
        });
        wrap.append(b);
      }
      return wrap;
    };
    const range = (name: string, min: number, max: number, step: number, value: number, set: (v: number) => void) => {
      const r = h('input', { class: 'kx-range', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': name });
      r.addEventListener('input', () => set(Number(r.value)));
      return r;
    };
    const v = this.host.voices();
    const voiceSel = h('select', { class: 'kx-select', 'aria-label': st.voice[0] });
    voiceSel.append(h('option', { value: '' }, st.bestVoice));
    for (const o of v.options) {
      const opt = h('option', { value: o.uri }, o.label);
      if (o.uri === p.voice) opt.setAttribute('selected', '');
      voiceSel.append(opt);
    }
    voiceSel.addEventListener('change', () => {
      prefs.set('voice', voiceSel.value);
      this.host.readAloud(st.voiceChanged);
    });
    const blindBtn = toggle(st.blind[0], p.blindMode, () => {
      this.host.toggleBlindMode();
      this.render('blind-setting');
    });
    blindBtn.dataset.k = 'blind-setting';
    const langSeg = seg(st.language[0], [['pl', 'Polski'], ['en', 'English']], p.lang, (x) => {
      prefs.set('lang', x);
      prefs.set('voice', '');
    });
    const tog = (pair: string[], on: boolean, set: (x: boolean) => void) => row(pair[0], pair[1], toggle(pair[0], on, set));
    list.append(
      h('h3', {}, t.sec.blind),
      row(st.blind[0], st.blind[1], blindBtn),
      tog(st.snap, p.snapTurn, (x) => prefs.set('snapTurn', x)),
      tog(st.sonar, p.obstacleCues, (x) => prefs.set('obstacleCues', x)),
      tog(st.coach, p.routeCoach, (x) => prefs.set('routeCoach', x)),
      tog(st.announce, p.announceNearby, (x) => prefs.set('announceNearby', x)),
      h('h3', {}, t.sec.voice),
      row(st.language[0], st.language[1], langSeg),
      row(st.voice[0], st.voice[1], voiceSel),
      ...(p.lang === 'en' ? [row(st.polishVoice[0], v.polish ? st.polishVoice[1] : st.polishVoiceNone, toggle(st.polishVoice[0], p.polishVoice, (x) => prefs.set('polishVoice', x)))] : []),
      row(st.tryIt, '', button(st.test, () => this.host.readAloud(st.testLine))),
      ...(v.basic ? [h('p', { class: 'kx-note' }, st.basicTip)] : []),
      h('h3', {}, t.sec.hearing),
      tog(st.read, p.narration, (x) => prefs.set('narration', x)),
      row(st.rate[0], st.rate[1], seg(st.rate[0], [[0.8, st.rates[0]], [1, st.rates[1]], [1.25, st.rates[2]]], p.speechRate, (x) => prefs.set('speechRate', x))),
      tog(st.captions, p.captions, (x) => prefs.set('captions', x)),
      row(st.text[0], st.text[1], seg(st.text[0], [[100, st.texts[0]], [125, st.texts[1]], [150, st.texts[2]]], p.textScale, (x) => prefs.set('textScale', x))),
      tog(st.contrast, p.highContrast, (x) => prefs.set('highContrast', x)),
      h('h3', {}, t.sec.moving),
      row(st.walk[0], st.walk[1], seg(st.walk[0], [['slow', st.walks[0]], ['normal', st.walks[1]], ['brisk', st.walks[2]]], p.walkSpeed, (x) => prefs.set('walkSpeed', x))),
      row(st.turn[0], st.turn[1], range(st.turn[0], 40, 240, 10, settings.current.keyTurnSpeed, (x) => settings.set('keyTurnSpeed', x))),
      row(st.sens[0], st.sens[1], range(st.sens[0], 0.2, 3, 0.1, settings.current.sensitivity, (x) => settings.set('sensitivity', x))),
      tog(st.invert, settings.current.invertY, (x) => settings.set('invertY', x)),
      tog(st.drag, p.dragLook, (x) => prefs.set('dragLook', x)),
      tog(st.calm, p.calmMotion, (x) => {
        prefs.set('calmMotion', x);
        settings.set('headBob', !x);
      }),
      tog(st.autoTurn, p.autoTurn, (x) => prefs.set('autoTurn', x)),
      h('h3', {}, t.sec.way),
      tog(st.beacons, p.beacons, (x) => prefs.set('beacons', x)),
      tog(st.trail, p.pathTrail, (x) => prefs.set('pathTrail', x)),
      tog(st.ping, p.soundBeacon, (x) => prefs.set('soundBeacon', x)),
      h('h3', {}, t.sec.sound),
      row(st.volume[0], st.volume[1], range(st.volume[0], 0, 1, 0.05, settings.current.volume, (x) => settings.set('volume', x))),
      tog(st.ambience, p.ambience, (x) => prefs.set('ambience', x)),
    );
    s.append(list, this.closeRow());
  }

  private renderHelp(s: HTMLElement) {
    const dl = (rows: [string, string][]) => {
      const d = h('dl', { class: 'kx-keys' });
      for (const [k, v] of rows) d.append(h('dt', {}, ...k.split(' / ').flatMap((x, i) => (i ? [' / ', key(x)] : [key(x)]))), h('dd', {}, v));
      return d;
    };
    const t = tx();
    s.append(
      h('h2', {}, t.howTitle),
      ...t.how.map((x) => h('p', {}, x)),
      h('h3', {}, t.blindTitle),
      h('p', {}, t.blindHelp),
      h('h3', {}, t.keyboard),
      dl(t.keys),
      h('h3', {}, t.otherInput),
      dl(t.otherKeys),
      this.closeRow(),
    );
  }

  private renderDone(s: HTMLElement) {
    const t = tx();
    s.append(
      h('h2', {}, t.doneTitle),
      h('p', {}, t.done1),
      h('p', {}, t.done2),
      h('div', { class: 'kx-actions' }, button(t.keepWandering, () => this.closeScreen(), 'kx-btn kx-btn--primary', { 'data-autofocus': '' }), button(t.openJournal, () => this.open('map'))),
    );
  }

  // ------------------------------------------------------------------ HUD

  setHudVisible(on: boolean) {
    this.hud.hidden = !on;
  }

  setWhere(name: string) {
    if (name === this.last.where) return;
    this.last.where = name;
    this.whereName.textContent = name;
  }

  setProgress(places: number, placesTotal: number, legends: number, legendsTotal: number) {
    const k = `${places}/${placesTotal}/${legends}/${legendsTotal}`;
    if (k === this.last.progress) return;
    this.last.progress = k;
    const t = tx();
    this.progress.replaceChildren(`${t.places} `, h('b', {}, `${places}/${placesTotal}`), ` · ${t.legends} `, h('b', {}, `${legends}/${legendsTotal}`));
  }

  setPrompt(text: string | null) {
    if ((text ?? '') === this.last.prompt) return;
    this.last.prompt = text ?? '';
    this.prompt.hidden = !text;
    if (text) this.prompt.replaceChildren(key('E'), text);
  }

  setGuide(g: GuideInfo | null) {
    const k = g ? `${g.name}|${g.direction}|${g.walking}` : '';
    if (k === this.last.guide) return;
    this.last.guide = k;
    this.guideBox.hidden = !g;
    if (!g) return;
    this.guideName.textContent = g.name;
    this.guideDir.textContent = g.direction;
    this.walkBtn.setAttribute('aria-pressed', String(g.walking));
    this.walkBtn.replaceChildren(key('F'), ` ${g.walking ? tx().stopWalking : tx().walkMe}`);
  }

  setHint(text: string | null) {
    if ((text ?? '') === (this.hint.textContent ?? '') && this.hint.hidden === !text) return;
    this.hint.hidden = !text;
    this.hint.textContent = text ?? '';
  }

  setCarrying(on: boolean) {
    this.carry.hidden = !on;
  }

  /** heading and bearings in compass degrees (0 = north); places: undiscovered landmarks */
  setCompass(heading: number, target: number | null, places: number[]) {
    const span = 100;
    const place = (el: HTMLElement, bearing: number) => {
      const rel = ((bearing - heading + 540) % 360) - 180;
      el.hidden = Math.abs(rel) > span;
      if (!el.hidden) el.style.left = `${50 + (rel / span) * 50}%`;
    };
    for (const m of this.compassMarks) place(m.el, m.bearing);
    this.targetMark.hidden = target === null;
    if (target !== null) place(this.targetMark, target);
    while (this.placeMarks.length < places.length) {
      const el = h('div', { class: 'kx-compass__mark kx-compass__mark--place' }, '◆');
      this.compass.append(el);
      this.placeMarks.push(el);
    }
    this.placeMarks.forEach((el, i) => {
      if (i < places.length) place(el, places[i]);
      else el.hidden = true;
    });
  }

  setLabels(list: LabelInfo[]) {
    // nudge overlapping tags upwards (nearest first keeps its place)
    const placed: { x: number; y: number }[] = [];
    for (const l of list) {
      for (let guard = 0; guard < 6 && placed.some((p) => Math.abs(p.x - l.x) < 170 && Math.abs(p.y - l.y) < 30); guard++) l.y -= 32;
      placed.push({ x: l.x, y: l.y });
    }
    while (this.labelPool.length < list.length) {
      const el = h('div', { class: 'kx-label' });
      this.labels.append(el);
      this.labelPool.push(el);
    }
    this.labelPool.forEach((el, i) => {
      const l = list[i];
      el.hidden = !l;
      if (!l) return;
      el.style.left = `${l.x}px`;
      el.style.top = `${l.y}px`;
      el.className = `kx-label${l.target ? ' kx-label--target' : ''}${l.done ? ' kx-label--done' : ''}`;
      const text = `${l.name}\u0000${l.dist}`;
      if (el.dataset.text !== text) {
        el.dataset.text = text;
        el.replaceChildren(l.name, h('small', {}, l.dist));
      }
    });
  }

  toast(kicker: string, title: string, sub = '') {
    const t = this.toastEl;
    t.replaceChildren(h('div', { class: 'kx-toast__kicker' }, kicker), h('div', { class: 'kx-toast__title' }, title), ...(sub ? [h('div', { class: 'kx-toast__sub' }, sub)] : []));
    t.classList.add('is-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('is-on'), 4200);
  }

  /** fade to black, run `mid`, fade back (instant with calm motion) */
  async fade(mid: () => void) {
    const calm = prefs.current.calmMotion;
    this.fadeEl.classList.add('is-on');
    await new Promise((r) => setTimeout(r, calm ? 0 : 320));
    mid();
    await new Promise((r) => setTimeout(r, calm ? 0 : 120));
    this.fadeEl.classList.remove('is-on');
  }
}
