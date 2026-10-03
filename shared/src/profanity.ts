// Compact profanity filter (English + Polish basics) for player names, prompts and weapon names.
// Pure, no deps: bundled into the SpacetimeDB module, the forge service and the client.
//
// Matching is per word (Scunthorpe-safe: "scunthorpe", "assassin", "cocktail" pass), after a 1:1
// character fold (lowercase, Polish diacritics, leetspeak 0/1/3/4/5/7/@/$/!), so the censored
// output keeps the original string's length and positions. Repeated letters ("fuuuck") collapse.

/** Whole words only. */
const EXACT = new Set([
  // en
  'ass', 'asses', 'arse', 'asshole', 'assholes', 'arsehole', 'bastard', 'bastards', 'bitch', 'bitches', 'bitchy',
  'bollocks', 'cock', 'cocks', 'cocksucker', 'cum', 'cunt', 'cunts', 'dick', 'dicks', 'dickhead', 'dildo', 'fag',
  'fags', 'faggot', 'faggots', 'jizz', 'kys', 'motherfucker', 'motherfuckers', 'nazi', 'nigga', 'niggas', 'nigger',
  'niggers', 'porn', 'pussy', 'pussies', 'rape', 'raped', 'rapist', 'retard', 'retarded', 'retards', 'slut', 'sluts',
  'twat', 'twats', 'wank', 'wanker', 'whore', 'whores', 'shit', 'shits', 'shitty', 'shithead', 'shitheads', 'shitter', 'shitting', 'bullshit', 'shite', 'tits', 'titties', 'hitler', 'fuk', 'fuking', 'fukin', 'niggaz', 'niggah',
  // pl
  'cipa', 'cipy', 'cipe', 'cipie', 'cwel', 'cwele', 'cwelu', 'dupek', 'kutas', 'kutasa', 'kutasy', 'pizda', 'pizdy',
  'pizde', 'pizdzie', 'suka', 'szmato',
]);

/** Word prefixes (fucking, kurwami, chujowy...). */
const STEMS = ['fuck', 'cunt', 'kurw', 'chuj', 'huj', 'pierdol', 'pierdal', 'jeb', 'pizd', 'dziwk', 'skurw', 'kutas', 'cwel', 'motherfuck'];

/** Polish verb prefixes before a stem (wyjebac, spierdalaj, zajebisty, odpierdol). */
const PL_PREFIX = ['', 'wy', 'za', 'od', 'po', 's', 'prze', 'roz', 'na', 'do', 'u', 'w', 'ob', 'pod', 'przy', 'z'];
const PL_STEMS = ['jeb', 'pierdol', 'pierdal', 'kurw', 'chuj'];

const FOLD: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i',
};

/** 1:1 fold (same length as the input, so match indices map back onto the original). */
function fold(text: string): string {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const f = FOLD[lower] ?? (lower.length === 1 ? lower : ch);
    // keep 1 UTF-16 unit per input unit
    out += ch.length === 2 ? `${f.length === 1 ? f : '_'}_` : f.length === 1 ? f : '_';
  }
  return out;
}

const collapse = (w: string, max: number) => w.replace(/(.)\1+/g, (m, c: string) => c.repeat(Math.min(m.length, max)));

function badWord(w: string): boolean {
  if (w.length < 3) return false;
  for (const v of new Set([w, collapse(w, 2), collapse(w, 1)])) {
    if (EXACT.has(v)) return true;
    if (STEMS.some(s => v.startsWith(s))) return true;
    for (const p of PL_PREFIX) {
      if (p && !v.startsWith(p)) continue;
      const rest = v.slice(p.length);
      if (PL_STEMS.some(s => rest.startsWith(s))) return true;
    }
  }
  return false;
}

/** [start, end) spans of offending words in `text`. */
function badSpans(text: string): [number, number][] {
  const f = fold(text);
  const out: [number, number][] = [];
  const re = /[a-z]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(f))) if (badWord(m[0])) out.push([m.index, m.index + m[0].length]);
  return out;
}

export function containsProfanity(text: string): boolean {
  return badSpans(text).length > 0;
}

/** Offending words replaced by asterisks (same length; everything else untouched). */
export function censorText(text: string): string {
  const spans = badSpans(text);
  if (!spans.length) return text;
  let out = '';
  let i = 0;
  for (const [a, b] of spans) {
    out += text.slice(i, a) + '*'.repeat(b - a);
    i = b;
  }
  return out + text.slice(i);
}
