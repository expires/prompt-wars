import { SPOKEN_POLISH } from './data';
import { prefs } from './prefs';

export interface SayOptions {
  /** interrupt what is being spoken (direct answers to the player: "where am I?") */
  interrupt?: boolean;
  /** caption display time (ms); default scales with length */
  ms?: number;
  /** caption only, never spoken aloud (sound descriptions like "[bells ring]") */
  soundOnly?: boolean;
}

export interface VoiceOption {
  uri: string;
  label: string;
  score: number;
}

/**
 * How natural a system voice tends to sound. Neural / "Natural" / Premium / Enhanced voices are
 * far better than the default compact ones; macOS novelty voices are skipped entirely.
 */
function voiceScore(v: SpeechSynthesisVoice): number {
  const n = v.name;
  if (/espeak|compact|fred|albert|bad news|bells|boing|bubbles|cellos|whisper|zarvox|trinoids|jester|organ|superstar|wobble|hysterical|deranged|bahh|good news|junior|ralph|kathy|princess|grandma|grandpa|rocko|shelley|eddy|flo|reed|sandy/i.test(n)) return -100;
  let s = 0;
  if (/natural|neural/i.test(n)) s += 60;
  if (/online/i.test(n)) s += 20;
  if (/premium/i.test(n)) s += 55;
  if (/enhanced/i.test(n)) s += 45;
  if (/google/i.test(n)) s += 30;
  if (/siri/i.test(n)) s += 40;
  if (/samantha|daniel|serena|karen|moira|tessa|ava|allison|susan|kate|oliver|sonia|ryan|libby|jenny|aria|guy|zosia|paulina|marek|zofia/i.test(n)) s += 12;
  if (v.lang === 'en-GB') s += 8;
  else if (/^en-(US|IE|AU|CA|NZ)/.test(v.lang)) s += 5;
  return s;
}

/** sentences, keeping their punctuation (each is spoken as its own utterance: natural pauses) */
function sentences(text: string): string[] {
  return (text.match(/[^.!?…]+(?:[.!?…]+["”’)\]]*|$)\s*/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const POLISH_RE = new RegExp(`(${SPOKEN_POLISH.map(([w]) => escapeRe(w)).join('|')})`, 'g');
const RESPELL = new Map(SPOKEN_POLISH.map(([w, r]) => [w, r.replace(/-/g, '')]));

/**
 * One voice for everything the game tells the player:
 * - an ARIA live region, so screen readers announce it
 * - speech synthesis when narration is on (best voice on the device, sentence by sentence,
 *   Polish names in a Polish voice when there is one)
 * - on-screen captions when captions are on (sounds are captioned too)
 */
export class Narrator {
  private readonly live: HTMLElement;
  private readonly liveUrgent: HTMLElement;
  private readonly captions: HTMLElement;
  private english: SpeechSynthesisVoice[] = [];
  private polish: SpeechSynthesisVoice | null = null;
  private polishAll: SpeechSynthesisVoice[] = [];
  /** the last spoken line (R repeats it) */
  last = '';

  constructor(parent: HTMLElement) {
    this.live = mk('div', 'sr-only');
    this.live.setAttribute('aria-live', 'polite');
    this.liveUrgent = mk('div', 'sr-only');
    this.liveUrgent.setAttribute('aria-live', 'assertive');
    this.captions = mk('div', 'kx-captions');
    this.captions.setAttribute('aria-hidden', 'true');
    parent.append(this.live, this.liveUrgent, this.captions);

    const load = () => {
      const voices = window.speechSynthesis?.getVoices() ?? [];
      this.english = voices.filter((v) => v.lang.startsWith('en') && voiceScore(v) > -100).sort((a, b) => voiceScore(b) - voiceScore(a));
      this.polishAll = voices.filter((v) => /^pl/i.test(v.lang) && voiceScore(v) > -100).sort((a, b) => voiceScore(b) - voiceScore(a));
      this.polish = this.polishAll[0] ?? null;
    };
    load();
    window.speechSynthesis?.addEventListener?.('voiceschanged', load);
    prefs.onChange((p) => {
      if (!p.narration) this.stop();
    });
  }

  get canSpeak(): boolean {
    return typeof window.speechSynthesis !== 'undefined';
  }

  /** voices for the current language, best first (the settings picker) */
  voiceOptions(): VoiceOption[] {
    return this.pool().map((v) => ({ uri: v.voiceURI, label: `${v.name} (${v.lang})`, score: voiceScore(v) }));
  }

  private pool(): SpeechSynthesisVoice[] {
    return prefs.current.lang === 'pl' ? this.polishAll : this.english;
  }

  /** the voice in use sounds robotic: the settings screen suggests installing a better one */
  get voiceIsBasic(): boolean {
    const v = this.voice();
    return !v || voiceScore(v) < 30;
  }

  get hasPolishVoice(): boolean {
    return !!this.polish;
  }

  private voice(): SpeechSynthesisVoice | null {
    const want = prefs.current.voice;
    const pool = this.pool();
    return (want && pool.find((v) => v.voiceURI === want)) || pool[0] || null;
  }

  say(text: string, opts: SayOptions = {}) {
    const p = prefs.current;
    if (!opts.soundOnly) {
      this.last = text;
      const region = opts.interrupt ? this.liveUrgent : this.live;
      // re-setting identical text is not announced: clear first
      region.textContent = '';
      requestAnimationFrame(() => (region.textContent = text));
      if (p.narration) this.speak(text, opts.interrupt);
    }
    if (p.captions) this.caption(text, opts.ms, !!opts.soundOnly);
  }

  /** speak the last line again */
  repeat() {
    if (this.last) this.say(this.last, { interrupt: true });
  }

  /** speak now, even with narration off (the "Read aloud" buttons, the voice test) */
  speakNow(text: string) {
    this.speak(text, true);
  }

  stop() {
    window.speechSynthesis?.cancel();
  }

  private speak(text: string, interrupt = false) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (interrupt) synth.cancel();
    if (prefs.current.lang === 'pl') {
      // Polish: one Polish voice for everything
      const v = this.voice();
      for (const sentence of sentences(text)) this.utter(sentence, v, v?.lang ?? 'pl-PL');
      synth.resume();
      return;
    }
    const en = this.voice();
    const pl = prefs.current.polishVoice ? this.polish : null;
    for (const sentence of sentences(text)) {
      // split around Polish names: a Polish voice says them properly; else an English respelling
      const parts = sentence.split(POLISH_RE).filter((x) => x.trim());
      if (pl) {
        for (const part of parts) {
          const isPl = RESPELL.has(part);
          this.utter(part, isPl ? pl : en, isPl ? 'pl-PL' : (en?.lang ?? 'en-GB'));
        }
      } else {
        this.utter(parts.map((x) => RESPELL.get(x) ?? x).join(''), en, en?.lang ?? 'en-GB');
      }
    }
    // Chrome sometimes stalls a long queue until poked
    synth.resume();
  }

  private utter(text: string, voice: SpeechSynthesisVoice | null, lang: string) {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = lang;
    u.rate = prefs.current.speechRate;
    window.speechSynthesis.speak(u);
  }

  private caption(text: string, ms?: number, sound = false) {
    const line = mk('p', sound ? 'kx-caption kx-caption--sound' : 'kx-caption');
    line.textContent = text;
    this.captions.append(line);
    while (this.captions.childElementCount > 3) this.captions.firstElementChild?.remove();
    const life = ms ?? Math.min(14000, 3500 + text.length * 55);
    setTimeout(() => {
      line.classList.add('is-leaving');
      setTimeout(() => line.remove(), 400);
    }, life);
  }
}

function mk(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
