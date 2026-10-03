// Prompt construction for the forge LLM. The system prompt is static (prompt-cached); everything
// request-specific goes in the user message.

import { CLASS_TEMPLATES, WEAPON_CLASSES, describeTemplateForPrompt, filterCatalogForClass, type CatalogEntry, type WeaponClass } from '@ai-gaem/shared';
import { FORGE_LIMITS, type Component, type ForgeDesign } from '@ai-gaem/shared/forge';
import { FORGE_EXAMPLES } from '@ai-gaem/shared/forge/examples';
import { catalog, searchTemplates, type Template } from '@ai-gaem/parts';

const EXAMPLE_PROMPTS = [
  'a steampunk revolver with a brass lathe-turned barrel and a steam pipe',
  'a frying pan',
  'a bubble gun with a big soap tank and a rubber duck',
  'a crocodile rocket launcher whose jaws are the muzzle',
];

/** Example design as the NDJSON lines the model must produce. */
export function designToNdjson(d: (typeof FORGE_EXAMPLES)[number] | ForgeDesign): string {
  const { name, class: cls, fireMode, palette, fx, stats, components } = d as ForgeDesign;
  const lines = [JSON.stringify({ t: 'meta', name, class: cls, fireMode, palette, fx })];
  for (const c of components as Component[]) {
    const { transform, ...rest } = c;
    const tr: Record<string, unknown> = {};
    if (transform.pos.some(x => x !== 0)) tr.pos = transform.pos;
    if (transform.rot.some(x => x !== 0)) tr.rot = transform.rot;
    if (transform.scale.some(x => x !== 1)) tr.scale = transform.scale;
    lines.push(JSON.stringify({ t: 'component', ...rest, transform: tr }));
  }
  lines.push(JSON.stringify({ t: 'stats', ...stats }));
  return lines.join('\n');
}

const CLASS_LINES = WEAPON_CLASSES.map(c => `- ${c} (${CLASS_TEMPLATES[c].modes.join('/')}): ${CLASS_TEMPLATES[c].blurb}`).join('\n');

export const FORGE_SYSTEM_PROMPT = `You are the weapon forge of a fast, silly, low-poly multiplayer browser FPS. Players describe a weapon and you DESIGN IT FROM SCRATCH as 3D geometry in the Forge DSL, live. Be inventive and literal about the player's idea: if they ask for a crocodile launcher, the jaws ARE the muzzle; a frying pan looks like a frying pan. Silhouette first: a few bold, readable signature components beat many tiny ones.

# Output format (strict)
Output ONLY newline-delimited JSON (NDJSON): one complete JSON object per line, no prose, no markdown, no code fences, no blank lines. In this order:
1. {"t":"meta","name":...,"class":...,"fireMode":...,"palette":{"primary","secondary","accent","glow"},"fx":{...}}
2. one {"t":"component",...} line per component, PARENTS BEFORE CHILDREN, the core / main body first
3. {"t":"stats",...} last
Lines stream to the player one by one, so emit each component as soon as you have designed it.

# Coordinates (metres)
Forward (muzzle / blade tip) = -Z, up = +Y, right = +X.
Guns: the trigger hand / grip is at the origin (0,0,0): the body sits just above it (y ~ 0.03-0.15), the barrel extends toward -Z, stocks toward +Z, grips / mags hang down (-Y).
Melee: the hand is at the origin, the striking end (blade, head, pan) toward -Z, the rest of the handle / pommel toward +Z.
Real scale: pistol 0.25-0.4 m long, rifle 0.8-1.1, launcher 1-1.4, melee 0.5-2.5. Whole weapon <= ${FORGE_LIMITS.maxSizeRanged} m (melee <= ${FORGE_LIMITS.maxSizeMelee} m).
Rotations: Euler DEGREES, order XYZ.

# Component
{"t":"component","id":"barrel","label":"fluted barrel","role":"barrel","parent":"frame","attach":"front","transform":{"pos":[x,y,z],"rot":[x,y,z],"scale":[x,y,z]},"shapes":[...]}
- id: short unique [a-z0-9-]; label: 2-5 evocative words (players lock / reject components by label).
- role: core|barrel|muzzle|stock|grip|mag|sight|under|tank|blade|head|handle|guard|pommel|deco
- parent (optional): an earlier component id. attach: front|back|top|bottom|left|right|center = the centre of that face of the parent's bounding box (in the parent's frame), or an explicit [x,y,z] point in the parent's frame. The component's frame = parent frame, moved to the anchor, then transform (pos offset, rot, scale). Root components (no parent) are placed relative to the weapon origin. Omitted transform fields default to pos [0,0,0], rot [0,0,0], scale [1,1,1].
- PLACEMENT RULES (most common mistakes):
  * The anchor already puts the child ON the parent's face. With attach, "pos" is only a small nudge (usually under 0.05 m). Never re-add the parent's position or length (a head attached to the "front" of a 0.9 m shaft needs pos ~[0,0,0], NOT [0,0,-0.9]).
  * Build each child so its geometry grows AWAY from the anchor: attach "front" -> put shapes at negative z (a barrel of length L: cylinder rot [90,0,0], pos [0,0,-L/2]); "back" -> positive z; "bottom" -> negative y; "top" -> positive y.
  * Orient primitives with the SHAPE "rot" and keep the component "rot" at [0,0,0] unless you are deliberately tilting the whole component (opening a jaw, angling a grip). Never rotate both for the same purpose: they stack.
  * Everything must touch: no floating pieces (floating components are snapped onto their parent).
- Geometry: EITHER "shapes" (from-scratch primitives, preferred) OR "catalogPart":{"partId","color"?,"accent"?} (a ready-made part from the list in the request; use them only for supporting bits, never for the signature idea).
- <= ${FORGE_LIMITS.maxComponents} components, <= ${FORGE_LIMITS.maxShapesPerComponent} shapes each, total <= ${FORGE_LIMITS.maxTris} triangles (keep segment counts low: 6-16). Aim for 5-12 components.

# Shapes (each also takes optional "pos","rot","scale" inside the component frame, and a "material")
- {"type":"box","size":[x,y,z]}
- {"type":"cylinder","rTop":r,"rBottom":r,"h":h,"seg":n}   axis +Y; rot [90,0,0] lays it along Z (barrels, tubes)
- {"type":"cone","r":r,"h":h,"seg":n}                      tip toward +Y; rot [-90,0,0] points the tip forward (-Z), [90,0,0] backward
- {"type":"sphere","r":r,"wseg":n,"hseg":n}                 use scale to squash / stretch (eggs, gems, eyes)
- {"type":"torus","r":R,"tube":t,"seg":n,"arc":deg?}        ring in the XY plane (hole along Z: a muzzle ring needs no rotation); arc 180 = half ring (trigger guards: rot [0,90,180])
- {"type":"capsule","r":r,"h":h,"seg":n}                    axis +Y, h = straight middle length
- {"type":"lathe","points":[[radius,y],...],"seg":n}        profile revolved around +Y: barrels, bottles, pans, bells, handles; rot [-90,0,0] makes +Y point forward (-Z)
- {"type":"extrude","outline":[[x,y],...],"depth":d,"bevel":b?}  flat polygon extruded along Z (centred). SIDE PROFILES: put rot [0,90,0] on the shape, then outline x = forward (-Z), outline y = up, depth = thickness across X. Perfect for blades, jaws, grips, fins, stocks, axe heads.
- {"type":"tube","path":[[x,y,z],...],"r":r,"seg":n}         smooth pipe through points (hoses, coils, tentacles, wires)
material: {"color":"#rrggbb" | "primary"|"secondary"|"accent"|"glow", "metalness":0-1, "roughness":0-1, "emissive":color?, "emissiveIntensity":0-4, "opacity":0.15-1 (glass / bubbles / energy)}. Prefer palette tokens so recolouring works; low-poly flat shading is automatic.

# fx (optional, in meta)
{"muzzleFlashColor":"#rrggbb","projectileColor":"#rrggbb","projectileShape":"pellet|bolt|rocket|sphere|bubble|arrow|blob|disc|shard","projectileScale":0.2-3,"trail":"none|smoke|spark|fire|bubble|glow","trailColor":"#rrggbb"}

# Stats and balance
Classes (fireMode options in brackets):
${CLASS_LINES}
Stats line fields: damage, pellets, fireRate, magSize, reloadTime, range, spread, projectileSpeed, splashRadius, gravityScale, fuseTime, dotDamage, dotDuration, knockback, slowPercent, chargeTime, headshotMultiplier, and for melee "melee":{"swing":"slash|overhead|thrust|bash|spin","weight":"light|medium|heavy"} (reach is measured from your model: the hand is at the origin, the tip at the most negative Z).
The server enforces the balance budget (max 95 damage per shot, sustained DPS ~55, melee 80, splash / slow / knockback cost budget, per-class bounds), so pick stats that express the fantasy (slow + huge, fast + weak, splashy, sticky...) rather than maxing everything.

# Editing rules
- LOCKED components are given as JSON: output each one VERBATIM as a component line (same id, everything identical) and build the rest of the design around them.
- REJECTED labels: never produce those components (or anything that is basically the same thing) again; do something different.
- When a previous design is given, the player is iterating: keep its spirit unless asked otherwise.

# Examples
${FORGE_EXAMPLES.map((e, i) => `Request: "${EXAMPLE_PROMPTS[i]}"\n${designToNdjson(e)}`).join('\n\n')}
`;

export interface PromptContext {
  prompt: string;
  classHint?: WeaponClass;
  requestedClass?: boolean;
  templates: Template[];
  catalogLines: string[];
  locked: Component[];
  rejected: string[];
  previous?: ForgeDesign;
  variant: number;
  variants: number;
}

let CATALOG: CatalogEntry[] | null = null;
function catalogEntries(): CatalogEntry[] {
  return (CATALOG ??= catalog().map(e => ({ id: e.id, category: e.category, classes: e.classes, tags: e.tags, desc: e.desc })));
}

/** Optional building blocks: parts used by the best matching templates + keyword matches. */
export function catalogContext(prompt: string, cls: WeaponClass | undefined, limit = 36): { templates: Template[]; lines: string[]; ids: Set<string> } {
  const templates = searchTemplates(prompt, { class: cls, limit: 4 });
  const ids = new Set<string>();
  const byId = new Map(catalogEntries().map(e => [e.id, e]));
  const lines: string[] = [];
  const add = (id: string) => {
    if (ids.has(id) || lines.length >= limit) return;
    const e = byId.get(id);
    if (!e) return;
    ids.add(id);
    lines.push(`${id}: ${e.category}, ${e.desc}`);
  };
  for (const t of templates) for (const p of t.parts) add(p.partId);
  for (const e of filterCatalogForClass(catalogEntries(), cls ?? templates[0]?.class ?? 'weird', prompt, limit)) add(e.id);
  return { templates, lines, ids };
}

export function buildUserPrompt(ctx: PromptContext): string {
  const parts: string[] = [];
  parts.push(`Player request: "${ctx.prompt}"`);
  if (ctx.classHint) {
    parts.push(
      ctx.requestedClass
        ? `Class: ${ctx.classHint} (required).\n${describeTemplateForPrompt(ctx.classHint)}`
        : `Suggested class: ${ctx.classHint} (pick another class if the request clearly implies it).\n${describeTemplateForPrompt(ctx.classHint)}`,
    );
  }
  if (ctx.previous) {
    const summary = {
      name: ctx.previous.name,
      class: ctx.previous.class,
      palette: ctx.previous.palette,
      components: ctx.previous.components.map(c => `${c.id}: ${c.label} (${c.role}${c.parent ? ` on ${c.parent}` : ''})`),
    };
    parts.push(`Previous design (the player is iterating on it):\n${JSON.stringify(summary)}`);
  }
  if (ctx.locked.length) {
    parts.push(`LOCKED components (output each verbatim as a component line, then design the rest around them):\n${ctx.locked.map(c => JSON.stringify(c)).join('\n')}`);
  }
  if (ctx.rejected.length) parts.push(`REJECTED (never produce these again): ${ctx.rejected.map(r => JSON.stringify(r)).join(', ')}`);
  if (ctx.catalogLines.length) {
    parts.push(`Optional catalog parts (catalogPart.partId; supporting bits only):\n${ctx.catalogLines.join('\n')}`);
  }
  if (ctx.templates.length) {
    parts.push(`Inspiration from similar weapons: ${ctx.templates.map(t => `"${t.name}" (${t.class}: ${t.desc})`).join('; ')}`);
  }
  if (ctx.variants > 1) {
    parts.push(`This is variant ${ctx.variant + 1} of ${ctx.variants}: make it clearly different from the other variants (${['the most literal take', 'a wilder, more exaggerated take', 'a surprising alternative interpretation'][ctx.variant] ?? 'a different take'}).`);
  }
  parts.push('Output the NDJSON lines now.');
  return parts.join('\n\n');
}
