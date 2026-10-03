/**
 * Keyword / tag / fuzzy retrieval over templates (for LLM few-shot examples + fallback designs).
 * Lazily builds an inverted index on first use.
 */
import { THEMES } from './themes';
import { CLASS_WORDS, STOPWORDS, SYNONYMS } from './vocab';
import type { SearchOpts, Template } from './types';
import { OBJ_INFO } from '../gen/obj';

export function stem(w: string): string {
  w = w.replace(/'s$/, '').replace(/'/g, '');
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 || /\d/.test(w))
    .map(stem);
}

interface Index {
  list: Template[];
  post: Map<string, { idx: number[]; w: number[] }>;
  vocab: string[];
  names: string[];
  core: string[];
  /** words describing each template's core part */
  coreWords: Set<string>[];
}

let INDEX: Index | null = null;
let INDEX_SRC: Template[] | null = null;

const W_NAME = 3;
const W_KW = 2;
const W_TAG = 1;
const W_DESC = 0.6;
const W_PART = 0.8;

function buildIndex(list: Template[]): Index {
  const post = new Map<string, { idx: number[]; w: number[] }>();
  const local = new Map<string, number>();
  const put = (tok: string, w: number) => {
    if (STOPWORDS.has(tok)) return;
    const cur = local.get(tok);
    if (cur === undefined || cur < w) local.set(tok, w);
  };
  const partWords = new Map<string, string[]>();
  const wordsOfPart = (id: string): string[] => {
    let ws = partWords.get(id);
    if (ws) return ws;
    const info = OBJ_INFO.get(id);
    const set = new Set<string>();
    for (const t of id.split('-').slice(1)) if (t.length > 2 && !/^\d+$/.test(t)) set.add(stem(t));
    if (info) {
      for (const t of tokenize(info.spec.noun)) set.add(t);
      for (const s of info.spec.syn) for (const t of tokenize(s)) set.add(t);
    }
    ws = [...set];
    partWords.set(id, ws);
    return ws;
  };
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    local.clear();
    for (const p of t.parts) for (const w of wordsOfPart(p.partId)) put(w, W_PART);
    for (const w of tokenize(t.desc)) put(w, W_DESC);
    for (const tag of t.tags) for (const w of tokenize(tag)) put(w, W_TAG);
    for (const k of t.keywords) for (const w of tokenize(k)) put(w, W_KW);
    for (const w of tokenize(t.name)) put(w, W_NAME);
    for (const [tok, w] of local) {
      let e = post.get(tok);
      if (!e) post.set(tok, (e = { idx: [], w: [] }));
      e.idx.push(i);
      e.w.push(w);
    }
  }
  const cw = new Map<string, Set<string>>();
  return {
    list,
    post,
    vocab: [...post.keys()],
    names: list.map((t) => t.name.toLowerCase()),
    core: list.map((t) => t.parts[0]?.partId ?? ''),
    coreWords: list.map((t) => {
      const id = t.parts[0]?.partId ?? '';
      let set = cw.get(id);
      if (!set) cw.set(id, (set = new Set(wordsOfPart(id))));
      return set;
    }),
  };
}

function index(list: Template[]): Index {
  if (!INDEX || INDEX_SRC !== list) {
    INDEX = buildIndex(list);
    INDEX_SRC = list;
  }
  return INDEX;
}

function editDistanceLE(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return false;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] <= max;
}

const CLASS_TOKEN = new Map<string, string[]>();
for (const [cls, words] of Object.entries(CLASS_WORDS))
  for (const w of words) {
    const toks = tokenize(w);
    if (toks.length !== 1) continue;
    const l = CLASS_TOKEN.get(toks[0]) ?? [];
    l.push(cls);
    CLASS_TOKEN.set(toks[0], l);
  }
const THEME_TOKEN = new Map<string, string[]>();
for (const t of THEMES)
  for (const w of [t.id, ...t.keywords, t.label]) {
    const toks = tokenize(w);
    if (toks.length !== 1) continue;
    const l = THEME_TOKEN.get(toks[0]) ?? [];
    if (!l.includes(t.id)) l.push(t.id);
    THEME_TOKEN.set(toks[0], l);
  }

export interface ScoredTemplate {
  t: Template;
  score: number;
}

/** Score every template against the query; returns sorted results (best first). */
export function scoreTemplates(list: Template[], query: string, opts: SearchOpts = {}): ScoredTemplate[] {
  const ix = index(list);
  const raw = tokenize(query).filter((w) => !STOPWORDS.has(w));
  const limit = opts.limit ?? 8;
  const n = list.length;
  const score = new Float32Array(n);
  const cover = new Uint8Array(n);
  const classBoost: Record<string, number> = {};
  const themeBoost: Record<string, number> = {};

  const addTok = (tok: string, qw: number, slot: number) => {
    const e = ix.post.get(tok);
    if (!e) return false;
    const bit = 1 << Math.min(slot, 7);
    for (let k = 0; k < e.idx.length; k++) {
      const i = e.idx[k];
      score[i] += qw * e.w[k];
      cover[i] |= bit;
    }
    return true;
  };

  raw.forEach((tok, slot) => {
    let hit = addTok(tok, 1, slot);
    for (const syn of SYNONYMS[tok] ?? []) for (const s of tokenize(syn)) if (s !== tok) hit = addTok(s, 0.7, slot) || hit;
    for (const c of CLASS_TOKEN.get(tok) ?? []) classBoost[c] = (classBoost[c] ?? 0) + 2.5;
    for (const th of THEME_TOKEN.get(tok) ?? []) themeBoost[th] = (themeBoost[th] ?? 0) + 2;
    if (!hit && tok.length >= 4) {
      const max = tok.length >= 7 ? 2 : 1;
      let fuzzy = 0;
      for (const v of ix.vocab) {
        if (fuzzy >= 6) break;
        if ((v.length >= 4 && (v.startsWith(tok) || tok.startsWith(v))) || editDistanceLE(tok, v, max)) {
          addTok(v, 0.6, slot);
          fuzzy++;
        }
      }
    }
  });

  // phrase bonus for adjacent query words appearing together in the name
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < raw.length; i++) bigrams.push(`${raw[i]} ${raw[i + 1]}`);

  const out: ScoredTemplate[] = [];
  for (let i = 0; i < n; i++) {
    const t = list[i];
    if (opts.class && t.class !== opts.class) continue;
    if (opts.theme && t.theme !== opts.theme) continue;
    if (opts.melee === true && !t.melee) continue;
    if (opts.melee === false && t.melee) continue;
    let s = score[i];
    if (s <= 0 && !classBoost[t.class] && !themeBoost[t.theme]) continue;
    let c = 0;
    for (let b = cover[i]; b; b &= b - 1) c++;
    s += 1.5 * c * c;
    s += classBoost[t.class] ?? 0;
    s += themeBoost[t.theme] ?? 0;
    if (bigrams.length) {
      const nm = ix.names[i].replace(/[^a-z0-9 ]+/g, ' ');
      const stemmed = tokenize(nm).join(' ');
      for (const bg of bigrams) if (stemmed.includes(bg)) s += 4;
    }
    if (t.curated) s += 0.5;
    // the queried thing IS the weapon body (a frying pan, not a frying-pan muzzle on a rifle)
    const cw = ix.coreWords[i];
    for (const tok of raw) if (cw.has(tok)) s += 2.5;
    // prefer concise names
    s -= 0.04 * ix.names[i].length;
    out.push({ t, score: s });
  }
  out.sort((a, b) => b.score - a.score || (a.t.id < b.t.id ? -1 : 1));
  // diversity: at most 2 results per core part among the top `limit`
  const picked: ScoredTemplate[] = [];
  const perCore = new Map<string, number>();
  const rest: ScoredTemplate[] = [];
  for (const st of out) {
    if (picked.length >= limit) break;
    const core = st.t.parts[0]?.partId ?? '';
    const k = perCore.get(core) ?? 0;
    if (k >= 2) {
      rest.push(st);
      continue;
    }
    perCore.set(core, k + 1);
    picked.push(st);
  }
  for (const st of rest) {
    if (picked.length >= limit) break;
    picked.push(st);
  }
  return picked;
}
