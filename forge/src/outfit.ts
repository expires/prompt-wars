// Closet: LLM-designed outfits (body proportions + armour pieces on body sockets), streamed as
// NDJSON like weapons. Prompt, assembler (raw model lines -> outfit events + sanitized outfit) and
// the offline mock generator.

import {
  BODY_LIMITS,
  OUTFIT_LIMITS,
  SOCKETS,
  SOCKET_INFO,
  bodyStats,
  censorText,
  clampBody,
  fitPiece,
  pieceRejected,
  sanitizeOutfit,
  sanitizePiece,
  type OutfitBody,
  type OutfitDesign,
  type OutfitEvent,
  type OutfitPiece,
} from '@ai-gaem/shared';
import { expandMacros } from '@ai-gaem/shared/forge/macros';
import { OUTFIT_EXAMPLES, OUTFIT_PRESETS } from '@ai-gaem/shared/outfit/examples';
import { mulberry32 } from './mock';

export type OutfitEmit = (ev: OutfitEvent) => void;

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

/** Example outfit as the NDJSON lines the model must produce. */
export function outfitToNdjson(o: OutfitDesign): string {
  const lines = [JSON.stringify({ t: 'meta', name: o.name, theme: o.theme, body: o.body, skin: o.skin, palette: o.palette })];
  for (const p of o.pieces) {
    const { transform, locked: _l, ...rest } = p;
    const tr: Record<string, unknown> = {};
    if (transform.pos.some(x => x !== 0)) tr.pos = transform.pos;
    if (transform.rot.some(x => x !== 0)) tr.rot = transform.rot;
    if (transform.scale.some(x => x !== 1)) tr.scale = transform.scale;
    lines.push(JSON.stringify({ t: 'piece', ...rest, ...(Object.keys(tr).length ? { transform: tr } : {}) }));
  }
  return lines.join('\n');
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export const OUTFIT_SYSTEM_PROMPT = `You are the Closet of "Prompt Wars", a fast low-poly arena FPS. Players describe a character look in a few words; you design their body proportions and armour / clothing as pieces built from 3D primitives, attached to sockets of a procedural humanoid. Pieces stream to the player one by one, so write each piece as soon as you have designed it.

# Look
- REALISTIC BY DEFAULT: soldiers, knights, astronauts, ninjas, police look like the real thing (real materials, believable kit: plate carriers, pouches, helmets with brims, visors, boots, gloves, belts). Whimsical requests (mascots, food, animals, toys, "made of X") go wild with the same build quality.
- Silhouette first: helmet / head, torso, shoulders, back piece, boots; then detail shapes inside those pieces (straps, rivets, lights, stripes).
- Pieces HUG the body: a chest plate is a little bigger than the torso box (0.50 x 0.60 x 0.28), a helmet a little bigger than the head cube (0.28 x 0.30 x 0.28). Never float things away from the body. Capes / backpacks sit on the back surface.
- The head is a CUBE: anything worn on it must enclose its corners (helmet / hood sphere r >= 0.23, cylinder r >= 0.2, box >= 0.3 wide; hats = a box crown >= 0.3 wide on top). Face pieces (visors, masks, goggles) sit in FRONT of the helmet: z -0.06 .. -0.12 when a helmet is worn.
- Keep the hands thin (the right hand holds the weapon) and never cover the face front with big opaque blocks unless it is a visor / mask.
- Value contrast 60/30/10: primary = main suit / armour, secondary = undersuit / straps, accent = small saturated details. No near-black (#000-#222) on big parts.
- Materials (PBR): polished steel {"color":"#c9ced6","metalness":0.9,"roughness":0.28}, painted armour {"metalness":0.6,"roughness":0.45}, fabric {"metalness":0,"roughness":0.85}, leather {"color":"#5a3d26","roughness":0.7}, rubber {"color":"#2e3034","roughness":0.9}, glass visor {"opacity":0.45}, gold visor {"color":"#d9a520","metalness":1,"roughness":0.12}. Emissive (glow) on small lights / eyes only. Round parts: "flatShading": false.

# Body (gameplay!)
"body": {"size":${BODY_LIMITS.size[0]}-${BODY_LIMITS.size[1]},"build":${BODY_LIMITS.build[0]}-${BODY_LIMITS.build[1]},"head":${BODY_LIMITS.head[0]}-${BODY_LIMITS.head[1]},"limbs":${BODY_LIMITS.limbs[0]}-${BODY_LIMITS.limbs[1]}} (1 = standard 1.8 m soldier).
Bigger = more max HP but a bigger hitbox and slower; smaller = less HP, faster, harder to hit. size = height, build = bulk / width, head = head size, limbs = arm length. Use 1/1/1/1 unless the request implies otherwise (tiny / small / scout / kid / goblin -> size 0.8-0.9; big / tank / giant / heavy / juggernaut -> size 1.05-1.08 and build 1.2-1.3; mascots / chibi -> head 1.15-1.2).

# Output format (strict)
Output ONLY newline-delimited JSON (NDJSON): one JSON object per line, no prose, no markdown, no code fences.
1. {"t":"meta","name":...,"theme":...,"body":{...},"skin":"#rrggbb","palette":{"primary","secondary","accent","glow"}}
2. one {"t":"piece",...} line per piece (5-14 pieces), biggest / most defining first.

# Piece
{"t":"piece","id":"helm","label":"great helm","socket":"head","mirror":false,"transform":{"pos":[x,y,z],"rot":[x,y,z],"scale":[x,y,z]},"shapes":[...]}
- id: short unique [a-z0-9-]; label: 2-4 words (players keep / lock / reject pieces by label).
- socket: where it sits. The piece frame origin is the socket point; metres for the standard body; forward (the way the character faces) = -Z, up = +Y, the character's right = +X. Sockets:
${SOCKETS.filter(s => !s.endsWith('R')).map(s => `  * ${s}${SOCKET_INFO[s].mirror ? ` (+ ${SOCKET_INFO[s].mirror})` : ''}: ${SOCKET_INFO[s].hint}; piece <= ${SOCKET_INFO[s].maxSize} m`).join('\n')}
- "mirror": true on a left socket (shoulderL, armL, handL, thighL, shinL, footL) also places a mirrored copy on the right: use it for every symmetric pair (design the LEFT one; outward is -X).
- transform is optional (defaults pos [0,0,0], rot [0,0,0], scale [1,1,1]); prefer placing the shapes with their own "pos".
- <= ${OUTFIT_LIMITS.maxPieces} pieces, <= ${OUTFIT_LIMITS.maxShapesPerPiece} shapes each, whole outfit <= ${OUTFIT_LIMITS.maxTris} triangles (mirrored pieces count twice): spheres / cylinders with 10-16 segments.

# Shapes (each takes optional "pos","rot","scale" in the piece frame and a "material")
- {"type":"box","size":[x,y,z]}   also macro {"type":"bevelbox","size":[x,y,z],"bevel":0.01} (chamfered: armour plates read better)
- {"type":"cylinder","rTop":r,"rBottom":r,"h":h,"seg":n}   axis +Y (rot [90,0,0] lays it along Z: arm bracers)
- {"type":"cone","r":r,"h":h,"seg":n}   tip +Y
- {"type":"sphere","r":r,"wseg":n,"hseg":n}   scale to squash (helmet domes [1,0.8,1.05], pauldrons [1.1,0.7,1.1])
- {"type":"torus","r":R,"tube":t,"seg":n,"arc":deg?}   ring in the XY plane (rot [90,0,0] = horizontal ring: collars, belts, headbands)
- {"type":"capsule","r":r,"h":h,"seg":n}   axis +Y
- {"type":"lathe","points":[[radius,y],...],"seg":n}   revolved profile around +Y (helmets, hats, bells)
- {"type":"extrude","outline":[[x,y],...],"depth":d,"bevel":b?}   flat polygon extruded along Z (emblems, fins, wings, plates)
- {"type":"tube","path":[[x,y,z],...],"r":r}   smooth pipe (hoses, cables, straps)
material: {"color":"#rrggbb"|"primary"|"secondary"|"accent"|"glow","metalness":0-1,"roughness":0-1,"emissive":color?,"emissiveIntensity":0-4,"opacity":0.15-1,"flatShading":false?}. Prefer palette tokens.

# Iterating
- LOCKED pieces: output each verbatim as a piece line, design the rest around them.
- REJECTED labels: never produce those pieces (or the same thing) again.
- A previous outfit means the player is iterating: keep its spirit and body unless asked otherwise.

# Examples (format + quality reference only: never reuse their names or palettes)
${OUTFIT_EXAMPLES.map(([p, o]) => `Request: "${p}"\n${outfitToNdjson(o)}`).join('\n\n')}
`;

export interface OutfitPromptContext {
  prompt: string;
  locked: OutfitPiece[];
  rejected: string[];
  previous?: OutfitDesign;
  variant: number;
  variants: number;
}

export function buildOutfitUserPrompt(ctx: OutfitPromptContext): string {
  const parts: string[] = [`Player request: "${ctx.prompt}"`];
  if (ctx.previous) {
    const p = ctx.previous;
    parts.push(`Previous outfit (the player is iterating on it):\n${JSON.stringify({ name: p.name, theme: p.theme, body: p.body, palette: p.palette, pieces: p.pieces.map(x => `${x.id}: ${x.label} (${x.socket}${x.mirror ? ', mirrored' : ''})`) })}`);
  }
  if (ctx.locked.length) parts.push(`LOCKED pieces (output each verbatim as a piece line):\n${ctx.locked.map(c => JSON.stringify(c)).join('\n')}`);
  if (ctx.rejected.length) parts.push(`REJECTED (never produce these again): ${ctx.rejected.map(r => JSON.stringify(r)).join(', ')}`);
  if (ctx.variants > 1) parts.push(`This is variant ${ctx.variant + 1} of ${ctx.variants}: make it clearly different (${['the most literal take', 'a bolder take', 'a surprising alternative'][ctx.variant] ?? 'a different take'}).`);
  parts.push('Output the NDJSON lines now.');
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// assembler
// ---------------------------------------------------------------------------

export interface OutfitAssemblerOptions {
  variant: number;
  locked: OutfitPiece[];
  rejected: string[];
  previous?: OutfitDesign;
}

export class OutfitAssembler {
  private meta: Record<string, unknown> | null = null;
  private pieces: OutfitPiece[] = [];
  private ids = new Set<string>();
  private lockedIds: Set<string>;
  readonly warnings: string[] = [];

  constructor(private opts: OutfitAssemblerOptions, private emit: OutfitEmit) {
    this.lockedIds = new Set(opts.locked.map(p => p.id));
  }

  get pieceCount(): number {
    return this.pieces.length;
  }

  push(o: Record<string, unknown>): void {
    const t = typeof o.t === 'string' ? o.t : typeof o.type === 'string' ? o.type : o.shapes ? 'piece' : '';
    if (t === 'meta') this.onMeta(o);
    else if (t === 'piece' || t === 'component') this.onPiece(o);
  }

  private onMeta(o: Record<string, unknown>): void {
    if (this.meta) return;
    const { t: _t, ...rest } = o;
    const prev = this.opts.previous;
    const preview = sanitizeOutfit({ ...rest, body: rest.body ?? prev?.body, palette: rest.palette ?? prev?.palette, pieces: [] }).outfit;
    preview.name = censorText(preview.name);
    preview.theme = censorText(preview.theme);
    this.meta = { name: preview.name, theme: preview.theme, body: preview.body, skin: preview.skin, palette: preview.palette };
    this.emit({ type: 'meta', variant: this.opts.variant, name: preview.name, theme: preview.theme, body: preview.body, skin: preview.skin, palette: preview.palette });
    for (const p of this.opts.locked) {
      if (this.ids.has(p.id)) continue;
      this.ids.add(p.id);
      this.pieces.push(p);
      this.emit({ type: 'piece', variant: this.opts.variant, piece: p });
    }
  }

  private ensureMeta(): void {
    if (!this.meta) this.onMeta({ t: 'meta', name: this.opts.previous?.name, theme: this.opts.previous?.theme, body: this.opts.previous?.body, skin: this.opts.previous?.skin, palette: this.opts.previous?.palette });
  }

  private onPiece(o: Record<string, unknown>): void {
    this.ensureMeta();
    const { t: _t, ...rest } = o;
    const id = typeof rest.id === 'string' ? rest.id.trim().toLowerCase() : '';
    if (id && this.lockedIds.has(id)) return;
    if (this.pieces.length >= OUTFIT_LIMITS.maxPieces) {
      this.warnings.push('piece limit reached; extra dropped');
      return;
    }
    const p = sanitizePiece(expandMacros(rest), this.warnings);
    if (!p) return;
    p.label = censorText(p.label);
    delete p.locked;
    if (this.opts.rejected.length && pieceRejected(p, this.opts.rejected)) {
      this.warnings.push(`rejected piece "${p.label}" skipped`);
      return;
    }
    let pid = p.id || p.socket.toLowerCase();
    if (this.ids.has(pid)) {
      let n = 2;
      while (this.ids.has(`${pid.slice(0, 20)}-${n}`)) n++;
      pid = `${pid.slice(0, 20)}-${n}`;
    }
    p.id = pid;
    fitPiece(p, this.warnings);
    this.ids.add(pid);
    this.pieces.push(p);
    this.emit({ type: 'piece', variant: this.opts.variant, piece: p });
  }

  finish(): OutfitDesign {
    this.ensureMeta();
    const res = sanitizeOutfit({ v: 1, ...this.meta, pieces: this.pieces });
    const outfit = res.outfit;
    outfit.name = censorText(outfit.name);
    const warnings = [...this.warnings, ...res.warnings];
    this.emit({ type: 'done', variant: this.opts.variant, outfit, warnings });
    return outfit;
  }
}

// ---------------------------------------------------------------------------
// offline mock: closest hand-built outfit, body from size words, shuffled palette
// ---------------------------------------------------------------------------

const ALL_OUTFITS: [string, OutfitDesign][] = [
  ...OUTFIT_EXAMPLES.map(([p, o]): [string, OutfitDesign] => [p, o]),
  ...OUTFIT_PRESETS.map((o): [string, OutfitDesign] => [`${o.name} ${o.theme}`, o]),
];

const KEYWORDS: [RegExp, string][] = [
  [/knight|plate|medieval|paladin|templar|crusader|armou?r/i, 'Knight Errant'],
  [/astronaut|space|nasa|cosmo|moon|mars/i, 'Moonwalker'],
  [/ninja|assassin|shinobi|rogue|thief|stealth/i, 'Shadow Ninja'],
  [/banana|fruit|mascot|costume|food|hot ?dog|pickle/i, 'Top Banana'],
  [/riot|cop|police|swat|security|guard/i, 'Riot Control'],
  [/robot|mech|android|cyborg|droid|machine|bot\b/i, 'Unit 7'],
  [/scout|runner|recon|light|small|tiny|fast/i, 'Scout'],
  [/tank|heavy|juggernaut|giant|huge|big|brute/i, 'Tank'],
  [/soldier|army|military|marine|infantry|commando/i, 'Soldier'],
];

/** body hints from the prompt (size words) applied over the base outfit's body */
export function bodyFromPrompt(prompt: string, base: OutfitBody): OutfitBody {
  const b = { ...base };
  if (/\b(tiny|mini|smol|kid|goblin|gnome|halfling|hobbit)\b/i.test(prompt)) Object.assign(b, { size: 0.8, build: 0.88 });
  else if (/\b(small|little|short|slim|scout|nimble)\b/i.test(prompt)) Object.assign(b, { size: 0.88, build: 0.92 });
  if (/\b(giant|huge|massive|juggernaut|colossal)\b/i.test(prompt)) Object.assign(b, { size: 1.08, build: 1.3 });
  else if (/\b(big|large|heavy|tank|bulky|tall|brute|chunky)\b/i.test(prompt)) Object.assign(b, { size: 1.06, build: 1.18 });
  if (/\b(chibi|bobblehead|big head)\b/i.test(prompt)) b.head = 1.2;
  return clampBody(b);
}

function pickBase(prompt: string, rand: () => number): OutfitDesign {
  for (const [re, name] of KEYWORDS) if (re.test(prompt)) return ALL_OUTFITS.find(([, o]) => o.name === name)![1];
  return ALL_OUTFITS[Math.floor(rand() * ALL_OUTFITS.length) % ALL_OUTFITS.length][1];
}

const hsl = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const COLOR_WORDS: [RegExp, number][] = [
  [/\bred|crimson|scarlet\b/i, 0], [/\borange\b/i, 0.07], [/\b(yellow|gold)\b/i, 0.14], [/\bgreen|olive|lime\b/i, 0.3],
  [/\bteal|cyan\b/i, 0.48], [/\bblue|navy\b/i, 0.6], [/\bpurple|violet\b/i, 0.75], [/\bpink|magenta\b/i, 0.88],
];

export async function generateOutfitMock(
  opts: { signal: AbortSignal; delayMs: number; seed?: number },
  ctx: OutfitPromptContext,
  asm: OutfitAssembler,
): Promise<void> {
  let h = 0;
  for (const c of ctx.prompt) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  const rand = mulberry32((opts.seed ?? h) + ctx.variant * 7919);
  const base = ctx.previous ?? pickBase(ctx.prompt, rand);
  const wait = () =>
    new Promise<void>((res, rej) => {
      if (opts.signal.aborted) return rej(new Error('aborted'));
      setTimeout(res, opts.delayMs);
    });
  const named = COLOR_WORDS.find(([re]) => re.test(ctx.prompt));
  const palette = { ...base.palette };
  // a named colour becomes the accent (a "knight with a red cape" stays steel); variants /
  // reprompts reroll the suit colour
  if (named) palette.accent = hsl(named[1], 0.75, 0.5);
  if (ctx.variant > 0 || (ctx.previous && !named)) {
    const hue = rand();
    palette.primary = hsl(hue, 0.4, 0.4 + rand() * 0.12);
    palette.secondary = hsl(hue + 0.05, 0.2, 0.26);
  }
  const keyword = KEYWORDS.some(([re]) => re.test(ctx.prompt));
  const words = ctx.prompt.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(w => w.length > 2).slice(0, 2);
  const title = keyword || !words.length ? base.name : words.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  asm.push({ t: 'meta', name: ctx.variant ? `${title} Mk${ctx.variant + 1}` : title, theme: base.theme, body: bodyFromPrompt(ctx.prompt, base.body), skin: base.skin, palette });
  await wait();
  for (const p of base.pieces) {
    if (ctx.rejected.length && pieceRejected(p, ctx.rejected)) continue;
    asm.push({ t: 'piece', ...JSON.parse(JSON.stringify(p)) });
    await wait();
  }
}

/** summary line for logs */
export function outfitLogLine(o: OutfitDesign): string {
  const st = bodyStats(o.body);
  return `${o.name} (${o.pieces.length} pieces, size ${r2(o.body.size)}, HP ${st.maxHp})`;
}
