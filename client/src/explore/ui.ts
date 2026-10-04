import './explore.css';
import mapUrl from './krakow-oldtown.map.png?url';
import { LANDMARKS, MAP_IMAGE, NORTH_OFFSET_DEG, SECRETS } from './data';
import { prefs, type Prefs } from './prefs';
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
  private readonly guideBox = h('div', { class: 'kx-guide kx-box', role: 'group', 'aria-label': 'Guide' });
  private readonly guideName = h('div', { class: 'kx-guide__name' });
  private readonly guideDir = h('div', { class: 'kx-guide__dir' });
  private readonly walkBtn: HTMLButtonElement;
  private readonly prompt: HTMLButtonElement;
  private readonly labels = h('div', { class: 'kx-labels', 'aria-hidden': 'true' });
  private readonly toastEl = h('div', { class: 'kx-toast kx-box', 'aria-hidden': 'true' });
  private readonly hint = h('div', { class: 'kx-hint kx-box', hidden: '' });
  private readonly carry = h('div', { class: 'kx-carry kx-box', hidden: '' }, '🐑 Carrying: the sulfur sheep');
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

    const where = h('div', { class: 'kx-where kx-box' }, h('div', { class: 'kx-where__label' }, 'You are near'), this.whereName, this.progress);
    const tools = h(
      'div',
      { class: 'kx-tools' },
      button(h('span', {}, key('M'), ' ', h('span', { class: 'kx-label-text' }, 'Map')), () => this.open('map'), 'kx-btn', { 'aria-label': 'Map and journal (M)' }),
      button(h('span', {}, key('V'), ' ', h('span', { class: 'kx-label-text' }, 'Where am I?')), () => host.describe(), 'kx-btn', { 'aria-label': 'Describe where I am (V)' }),
      button(h('span', {}, key('H'), ' ', h('span', { class: 'kx-label-text' }, 'Help')), () => this.open('help'), 'kx-btn', { 'aria-label': 'Help and controls (H)' }),
      button(h('span', {}, key('Esc'), ' ', h('span', { class: 'kx-label-text' }, 'Menu')), () => this.open('menu'), 'kx-btn', { 'aria-label': 'Menu (Escape)' }),
    );
    this.walkBtn = button(h('span', {}, key('F'), ' Walk me there'), () => host.toggleWalk(), 'kx-btn kx-btn--primary', { 'aria-pressed': 'false' });
    this.guideBox.append(
      h('div', { class: 'kx-guide__to' }, 'Guide · heading to'),
      this.guideName,
      this.guideDir,
      h(
        'div',
        { class: 'kx-guide__row' },
        this.walkBtn,
        button(h('span', {}, key('G'), ' Next place'), () => host.nextTarget()),
        button('Stop guide', () => host.stopGuide(), 'kx-btn kx-btn--quiet'),
      ),
    );
    this.prompt = button('', () => host.interact(), 'kx-prompt kx-box', { hidden: '' });
    this.hud.append(this.labels, h('div', { class: 'kx-dot' }), this.compass, where, tools, this.guideBox, this.prompt, this.toastEl, this.carry, this.hint);
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
          this.host.readAloud(
            'CityScape. Press B to turn on blind mode: the game talks to you and guides you by sound. Press Enter to start exploring, or Tab to go through the options.',
          );
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
    prefs.onChange((p) => this.applyPrefs(p));
  }

  private applyPrefs(p: Prefs) {
    const root = document.documentElement;
    root.classList.toggle('kx-hc', p.highContrast);
    root.classList.toggle('reduced-motion', p.calmMotion);
    root.style.setProperty('--kx-text', String(p.textScale / 100));
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
    return h('div', { class: 'kx-actions' }, button(this.back ? 'Back' : 'Close', () => this.closeScreen(), 'kx-btn', autofocus ? { 'data-autofocus': '' } : {}));
  }

  private renderTitle(s: HTMLElement) {
    s.append(
      h('h1', {}, 'CityScape'),
      h('p', { class: 'kx-sub' }, `Wander the streets of medieval Kraków at your own pace. Find ${LANDMARKS.length} famous places and ${SECRETS.length} hidden legends. There is no timer and nothing can go wrong.`),
      h('h3', {}, 'Before you start'),
      this.quickToggles(),
      h(
        'div',
        { class: 'kx-actions' },
        button('Start exploring', () => {
          this.host.click();
          this.screen = null;
          this.closedAt = performance.now();
          this.screenEl.hidden = true;
          this.host.start();
        }, 'kx-btn kx-btn--primary', { 'data-autofocus': '' }),
        button('All accessibility options', () => this.open('settings')),
        button('Controls & how to play', () => this.open('help')),
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
    const blind = h('button', { class: 'kx-toggle', type: 'button', 'aria-pressed': String(p.blindMode), 'data-k': 'blind' }, 'Blind mode', h('small', {}, 'Spoken guidance and sound navigation · key B'));
    blind.addEventListener('click', () => {
      this.host.toggleBlindMode();
      this.render('blind');
    });
    wrap.append(
      blind,
      tog('Read aloud', 'Narrate places, stories and directions', p.narration, (v) => {
        prefs.set('narration', v);
        if (v) this.host.readAloud('Narration is on. I will read places and stories aloud.');
      }),
      tog('Captions', 'Subtitles for speech and sounds', p.captions, (v) => prefs.set('captions', v)),
      tog('Large text', 'Bigger words everywhere', p.textScale > 100, (v) => prefs.set('textScale', v ? 150 : 100)),
      tog('High contrast', 'Black panels, bright text', p.highContrast, (v) => prefs.set('highContrast', v)),
      tog('Calm motion', 'No head bob or pulsing', p.calmMotion, (v) => {
        prefs.set('calmMotion', v);
        settings.set('headBob', !v);
      }),
      tog('Slow walking', 'A gentler walking pace', p.walkSpeed === 'slow', (v) => prefs.set('walkSpeed', v ? 'slow' : 'normal')),
    );
    return wrap;
  }

  private renderMenu(s: HTMLElement) {
    s.append(
      h('h2', {}, 'Paused'),
      h('p', { class: 'kx-sub' }, 'Take your time. Kraków will wait.'),
      h(
        'div',
        { class: 'kx-actions' },
        button('Keep exploring', () => this.closeScreen(), 'kx-btn kx-btn--primary', { 'data-autofocus': '' }),
        button('Map & journal', () => this.open('map')),
        button('Accessibility options', () => this.open('settings')),
        button('Controls & help', () => this.open('help')),
      ),
      h('h3', {}, 'Start over'),
      h('p', {}, 'Forget every place and legend you have found and begin again in the Market Square.'),
      h(
        'div',
        { class: 'kx-actions' },
        button('Reset my progress', () => {
          if (window.confirm('Forget everything you have found and start again?')) this.host.resetProgress();
        }),
      ),
    );
  }

  private renderCard(s: HTMLElement) {
    const c = this.card;
    if (!c) return;
    const text = [c.title, c.polish ? `${c.polish}, said ${c.say}.` : '', ...c.paragraphs, c.fact ?? ''].filter(Boolean).join(' ');
    s.append(
      h('div', { class: 'kx-where__label' }, c.kicker),
      h('h2', {}, c.title),
      ...(c.polish ? [h('p', { class: 'kx-polish' }, `${c.polish} · say “${c.say}”`)] : []),
      ...c.paragraphs.map((p) => h('p', {}, p)),
      ...(c.fact ? [h('p', { class: 'kx-fact' }, c.fact)] : []),
      h(
        'div',
        { class: 'kx-actions' },
        button('Continue', () => this.closeScreen(), 'kx-btn kx-btn--primary', { 'data-autofocus': '' }),
        button('Read aloud', () => this.host.readAloud(text)),
      ),
    );
  }

  private renderMap(s: HTMLElement) {
    const j = this.host.journal();
    const doneL = j.landmarks.filter((l) => l.done).length;
    const doneS = j.secrets.filter((x) => x.done).length;
    s.append(h('h2', {}, 'Map & journal'), h('p', { class: 'kx-sub' }, `${doneL} of ${j.landmarks.length} places visited · ${doneS} of ${j.secrets.length} legends found`));

    // ---- map image with numbered pins
    const map = h('div', { class: 'kx-map' });
    const img = h('img', { src: mapUrl, alt: 'Top-down map of medieval Kraków: the walled Old Town with the Market Square in the middle and Wawel Hill to the left.' });
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
        { 'aria-label': `${e.name}${e.done ? ', visited' : ''}. Guide me here.`, title: e.name },
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
    const tabs = h('div', { class: 'kx-tabs', role: 'group', 'aria-label': 'Journal section' });
    const list = h('ul', { class: 'kx-list' });
    const fill = () => {
      list.replaceChildren();
      const items = this.journalTab === 'landmark' ? j.landmarks : j.secrets;
      for (const e of items) list.append(this.journalItem(e));
      for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === this.journalTab));
    };
    for (const [tab, label] of [['landmark', `Places (${doneL}/${j.landmarks.length})`], ['secret', `Legends (${doneS}/${j.secrets.length})`]] as const) {
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
    const li = h('li', { class: `kx-item${e.done ? ' kx-item--done' : ''}` });
    li.append(
      h(
        'div',
        { class: 'kx-item__head' },
        h('span', { class: 'kx-item__num' }, e.kind === 'secret' ? (e.done ? '★' : '☆') : String(e.num)),
        h('span', { class: 'kx-item__name' }, e.kind === 'secret' && !e.done ? 'A hidden legend' : e.name),
        h('span', { class: 'kx-item__state' }, e.done ? (e.kind === 'secret' ? 'Found' : 'Visited') : e.target ? 'Guiding' : ''),
      ),
    );
    if (e.sub) li.append(h('p', { class: 'kx-item__text' }, e.sub));
    li.append(h('p', { class: 'kx-item__text' }, e.kind === 'secret' && !e.done ? `Hint: ${e.text}` : e.text));
    const btns = h('div', { class: 'kx-item__btns' });
    const close = (fn: () => void) => () => {
      fn();
      this.closeAll();
    };
    if (!(e.kind === 'secret' && e.id === 'twardowski')) {
      btns.append(
        button('Guide me', close(() => this.host.guide(e.kind, e.id)), 'kx-btn', { 'aria-label': `Guide me to ${e.done || e.kind === 'landmark' ? e.name : 'this legend'}` }),
        button('Walk me there', close(() => this.host.walk(e.kind, e.id)), 'kx-btn', { 'aria-label': `Walk me automatically to ${e.done || e.kind === 'landmark' ? e.name : 'this legend'}` }),
        button('Go there now', close(() => this.host.travel(e.kind, e.id)), 'kx-btn', { 'aria-label': `Travel instantly to ${e.done || e.kind === 'landmark' ? e.name : 'this legend'}` }),
      );
    }
    if (e.done) btns.append(button('Read aloud', () => this.host.readAloud(`${e.name}. ${e.text}`), 'kx-btn kx-btn--quiet'));
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
    s.append(h('h2', {}, 'Accessibility options'), h('p', { class: 'kx-sub' }, 'Changes apply straight away and are remembered on this device.'));
    const list = h('div', { class: 'kx-settings' });
    const p = prefs.current;
    const row = (name: string, hint: string, control: HTMLElement) =>
      h('div', { class: 'kx-setting' }, h('div', {}, h('span', { class: 'kx-setting__name' }, name), h('small', {}, hint)), control);
    const toggle = (name: string, on: boolean, set: (v: boolean) => void) => {
      const b = h('button', { class: 'kx-btn kx-switch', type: 'button', 'aria-pressed': String(on), 'aria-label': name }, on ? 'On' : 'Off');
      b.addEventListener('click', () => {
        const v = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(v));
        b.textContent = v ? 'On' : 'Off';
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
    const voiceSel = h('select', { class: 'kx-select', 'aria-label': 'Voice' });
    voiceSel.append(h('option', { value: '' }, 'Best available'));
    for (const o of v.options) {
      const opt = h('option', { value: o.uri }, o.label);
      if (o.uri === p.voice) opt.setAttribute('selected', '');
      voiceSel.append(opt);
    }
    voiceSel.addEventListener('change', () => {
      prefs.set('voice', voiceSel.value);
      this.host.readAloud('Witaj w Krakowie! This is how I sound.');
    });
    const blindBtn = toggle('Blind mode', p.blindMode, () => {
      this.host.toggleBlindMode();
      this.render('blind-setting');
    });
    blindBtn.dataset.k = 'blind-setting';
    list.append(
      h('h3', {}, 'Blind mode'),
      row(
        'Blind mode',
        'Turns on reading aloud, the sound beacon and everything below. Key B, any time.',
        blindBtn,
      ),
      row('Snap turning', 'Left / right arrows turn 45° and say which way you face. Q says it again.', toggle('Snap turning', p.snapTurn, (x) => prefs.set('snapTurn', x))),
      row('Wall sonar', 'Clicks from walls ahead as you walk, faster when close, and a thud when you bump into one.', toggle('Wall sonar', p.obstacleCues, (x) => prefs.set('obstacleCues', x))),
      row('Spoken directions', '“In 6 metres, turn left” while the guide is on.', toggle('Spoken directions', p.routeCoach, (x) => prefs.set('routeCoach', x))),
      row('Announce surroundings', 'Say the place you walk into and anything you can use.', toggle('Announce surroundings', p.announceNearby, (x) => prefs.set('announceNearby', x))),
      h('h3', {}, 'Voice'),
      row('Voice', 'The best voice on this device is chosen for you.', voiceSel),
      row(
        'Polish names in a Polish voice',
        v.polish ? 'Sukiennice, hejnał… said properly.' : 'No Polish voice on this device, so names are spelled out the English way.',
        toggle('Polish names in a Polish voice', p.polishVoice, (x) => prefs.set('polishVoice', x)),
      ),
      row('Try it', '', button('Test voice', () => this.host.readAloud('Witaj w Krakowie! Welcome to Rynek Główny. Listen for the hejnał from Kościół Mariacki.'))),
      ...(v.basic
        ? [
            h(
              'p',
              { class: 'kx-note' },
              'Tip: this device only has basic voices. For a much more natural voice, use Microsoft Edge (its “Natural” voices), Chrome (Google voices), or on a Mac add a Premium voice in System Settings › Accessibility › Spoken Content › System voice › Manage voices.',
            ),
          ]
        : []),
      h('h3', {}, 'Hearing & reading'),
      row('Read aloud', 'Speak discoveries, stories and directions.', toggle('Read aloud', p.narration, (v) => prefs.set('narration', v))),
      row('Speech speed', 'How fast the narrator talks.', seg('Speech speed', [[0.8, 'Slower'], [1, 'Normal'], [1.25, 'Faster']], p.speechRate, (v) => prefs.set('speechRate', v))),
      row('Captions', 'Subtitles for speech and important sounds.', toggle('Captions', p.captions, (v) => prefs.set('captions', v))),
      row('Text size', 'Size of all words on screen.', seg('Text size', [[100, 'Normal'], [125, 'Large'], [150, 'Largest']], p.textScale, (v) => prefs.set('textScale', v))),
      row('High contrast', 'Solid black panels with bright text.', toggle('High contrast', p.highContrast, (v) => prefs.set('highContrast', v))),
      h('h3', {}, 'Moving & looking'),
      row('Walking speed', 'Hold Shift to go a little faster.', seg('Walking speed', [['slow', 'Slow'], ['normal', 'Normal'], ['brisk', 'Brisk']], p.walkSpeed, (v) => prefs.set('walkSpeed', v))),
      row('Turning speed', 'Arrow keys and the gamepad stick.', range('Turning speed', 40, 240, 10, settings.current.keyTurnSpeed, (v) => settings.set('keyTurnSpeed', v))),
      row('Look sensitivity', 'Mouse and touch dragging.', range('Look sensitivity', 0.2, 3, 0.1, settings.current.sensitivity, (v) => settings.set('sensitivity', v))),
      row('Invert up / down look', '', toggle('Invert up and down look', settings.current.invertY, (v) => settings.set('invertY', v))),
      row('Drag to look', 'Off (default): click the view once, then just move the mouse to look; Esc frees the pointer. On: hold the button and drag to look.', toggle('Drag to look', p.dragLook, (v) => prefs.set('dragLook', v))),
      row('Calm motion', 'No head bob, pulsing or flashing.', toggle('Calm motion', p.calmMotion, (v) => {
        prefs.set('calmMotion', v);
        settings.set('headBob', !v);
      })),
      row('Auto-turn camera', 'When the guide walks you, face the way you are going.', toggle('Auto-turn camera', p.autoTurn, (v) => prefs.set('autoTurn', v))),
      h('h3', {}, 'Finding your way'),
      row('Light beacons & labels', 'Columns of light and name tags over places.', toggle('Light beacons and labels', p.beacons, (v) => prefs.set('beacons', v))),
      row('Guide footprints', 'A glowing trail to where the guide is heading.', toggle('Guide footprints', p.pathTrail, (v) => prefs.set('pathTrail', v))),
      row('Sound beacon', 'A soft ping from the guide’s target. Follow it by ear.', toggle('Sound beacon', p.soundBeacon, (v) => prefs.set('soundBeacon', v))),
      h('h3', {}, 'Sound'),
      row('Volume', '', range('Volume', 0, 1, 0.05, settings.current.volume, (v) => settings.set('volume', v))),
      row('City sounds', 'Wind and birdsong.', toggle('City sounds', p.ambience, (v) => prefs.set('ambience', v))),
    );
    s.append(list, this.closeRow());
  }

  private renderHelp(s: HTMLElement) {
    const dl = (rows: [string, string][]) => {
      const d = h('dl', { class: 'kx-keys' });
      for (const [k, v] of rows) d.append(h('dt', {}, ...k.split(' / ').flatMap((x, i) => (i ? [' / ', key(x)] : [key(x)]))), h('dd', {}, v));
      return d;
    };
    s.append(
      h('h2', {}, 'How to play'),
      h('p', {}, 'Walk around Kraków and find its famous places. A light beacon marks every place you have not visited yet. Walk close to one to discover it, then press E to hear its story.'),
      h('p', {}, 'Twelve legends are hidden around the city too. The journal gives you a hint for each one.'),
      h('p', {}, 'Lost? The guide always points to a place. Press F and it will walk you there by itself, or open the map and choose “Go there now”.'),
      h('h3', {}, 'Playing without sight'),
      h('p', {}, 'Press B for blind mode. The arrow keys walk and turn in 45° steps, and the game says which way you face. A soft ping comes from where the guide is heading: walk towards it, or press F and the guide walks you there. Walls click as you get close. Press V to hear what is around you.'),
      h('h3', {}, 'Keyboard'),
      dl([
        ['W / ↑', 'Walk forward'],
        ['S / ↓', 'Walk backward'],
        ['A / D', 'Step left / right'],
        ['← / →', 'Turn left / right'],
        ['PgUp / PgDn', 'Look up / down'],
        ['Home', 'Look straight ahead'],
        ['Shift', 'Walk faster (hold)'],
        ['T', 'Keep walking forward (T again or W / S stops)'],
        ['Space', 'Jump'],
        ['E / Enter', 'Interact · learn about the place you are at'],
        ['F', 'Walk me there (the guide walks for you)'],
        ['G', 'Guide me to the next place'],
        ['L', 'Look towards the guide’s target'],
        ['V', 'Where am I? (describes what is around you)'],
        ['R', 'Repeat the last thing said'],
        ['M / J', 'Map & journal'],
        ['B', 'Blind mode on / off'],
        ['Q', 'Which way am I facing, and what is ahead?'],
        ['Esc', 'Free the mouse · menu'],
      ]),
      h('h3', {}, 'Mouse, touch & gamepad'),
      dl([
        ['Mouse', 'Click the view once, then move the mouse to look around (no button to hold). Esc frees the pointer'],
        ['Drag', 'Touch: drag with a finger on the right side of the screen to look around'],
        ['Stick', 'Touch: the left side of the screen is a joystick'],
        ['A', 'Gamepad: jump · X: interact · B: walk me there · Start: menu · sticks: move and look'],
      ]),
      this.closeRow(),
    );
  }

  private renderDone(s: HTMLElement) {
    s.append(
      h('h2', {}, 'Gratulacje! You explored Kraków'),
      h('p', {}, 'You found every place and every legend, from the hejnał of St Mary’s to the dragon under Wawel.'),
      h('p', {}, 'The real Kraków is waiting too: all of these places still stand, and the dragon really does breathe fire.'),
      h('div', { class: 'kx-actions' }, button('Keep wandering', () => this.closeScreen(), 'kx-btn kx-btn--primary', { 'data-autofocus': '' }), button('Open the journal', () => this.open('map'))),
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
    this.progress.replaceChildren('Places ', h('b', {}, `${places}/${placesTotal}`), ' · Legends ', h('b', {}, `${legends}/${legendsTotal}`));
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
    this.walkBtn.replaceChildren(key('F'), g.walking ? ' Stop walking' : ' Walk me there');
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
