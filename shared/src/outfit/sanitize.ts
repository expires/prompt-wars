// sanitizeOutfit: turns anything (LLM output, client JSON, garbage) into a legal OutfitDesign.
// Deterministic, dependency-free, idempotent (sanitizeOutfit(sanitizeOutfit(x).outfit).outfit
// deep-equals sanitizeOutfit(x).outfit). Pieces are fitted to their socket ("armour hugs the
// body"): oversized pieces are scaled down, far-off pieces pulled in, floating pieces snapped onto
// the body segment they belong to.

import { sanitizeHex, sanitizeShape } from '../forge/sanitize';
import { boxSize, composeAffine, emptyBox, isEmptyBox, shapeBox, shapeTris, transformBox, unionBox, type Box3 } from '../forge/math';
import type { DesignPalette, Shape, Transform, V3 } from '../forge/types';
import { clampBody } from './balance';
import { OUTFIT_DSL_VERSION, OUTFIT_LIMITS as L, SOCKETS, SOCKET_INFO, type OutfitDesign, type OutfitPiece, type SocketName } from './types';

export interface OutfitSanitizeResult {
  outfit: OutfitDesign;
  warnings: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fix = (v: number) => {
  const r = Number(v.toFixed(4));
  return r === 0 ? 0 : r;
};

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function v3(v: unknown, lo: number, hi: number, dflt: V3): V3 {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const x = fix(clamp(v, lo, hi));
    return [x, x, x];
  }
  if (!Array.isArray(v)) return [...dflt] as V3;
  return [0, 1, 2].map(i => fix(clamp(num(v[i]) ?? dflt[i], lo, hi))) as V3;
}

function rot3(v: unknown): V3 {
  return v3(v, -1e6, 1e6, [0, 0, 0]).map(a => {
    let x = a % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return fix(x);
  }) as V3;
}

const ID_RE = /^[a-z0-9_-]{1,24}$/;
function cleanId(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return ID_RE.test(s) ? s : '';
}

const SOCKET_ALIASES: Record<string, SocketName> = {
  helmet: 'head', hat: 'head', hair: 'head', crown: 'head', hood: 'head', skull: 'head',
  visor: 'face', mask: 'face', eyes: 'face', goggles: 'face', mouth: 'face', beard: 'face', nose: 'face',
  chest: 'torso', body: 'torso', vest: 'torso', chestplate: 'torso', breastplate: 'torso', neck: 'torso', collar: 'torso', shirt: 'torso', coat: 'torso',
  cape: 'back', backpack: 'back', jetpack: 'back', wings: 'back', cloak: 'back', quiver: 'back',
  waist: 'belt', hips: 'belt', pelvis: 'belt', skirt: 'belt', tail: 'belt',
  pauldronl: 'shoulderL', pauldronr: 'shoulderR', leftshoulder: 'shoulderL', rightshoulder: 'shoulderR',
  leftarm: 'armL', rightarm: 'armR', forearml: 'armL', forearmr: 'armR', bracerl: 'armL', bracerr: 'armR',
  lefthand: 'handL', righthand: 'handR', glovel: 'handL', glover: 'handR',
  leftthigh: 'thighL', rightthigh: 'thighR', leftleg: 'thighL', rightleg: 'thighR', legl: 'thighL', legr: 'thighR',
  leftshin: 'shinL', rightshin: 'shinR', kneel: 'shinL', kneer: 'shinR',
  leftfoot: 'footL', rightfoot: 'footR', bootl: 'footL', bootr: 'footR',
  shoulder: 'shoulderL', shoulders: 'shoulderL', arm: 'armL', arms: 'armL', hand: 'handL', hands: 'handL', gloves: 'handL',
  thigh: 'thighL', leg: 'thighL', legs: 'thighL', shin: 'shinL', shins: 'shinL', foot: 'footL', feet: 'footL', boots: 'footL',
};

/** socket name from free text ("left_shoulder", "shoulder-r", "Helmet") */
export function parseSocket(v: unknown): SocketName | undefined {
  if (typeof v !== 'string') return undefined;
  const exact = (SOCKETS as readonly string[]).find(s => s.toLowerCase() === v.trim().toLowerCase());
  if (exact) return exact as SocketName;
  let k = v.trim().toLowerCase().replace(/[^a-z]/g, '');
  // "shoulder_left" / "left-shoulder" / "shoulderl"
  k = k.replace(/^(.*)left$/, 'left$1').replace(/^(.*)right$/, 'right$1');
  const direct = (SOCKETS as readonly string[]).find(s => s.toLowerCase() === k);
  if (direct) return direct as SocketName;
  if (Object.prototype.hasOwnProperty.call(SOCKET_ALIASES, k)) return SOCKET_ALIASES[k];
  const m = /^(left|right)(.+)$/.exec(k);
  if (m) {
    const base = Object.prototype.hasOwnProperty.call(SOCKET_ALIASES, m[2]) ? SOCKET_ALIASES[m[2]] : undefined;
    if (base && SOCKET_INFO[base].mirror) return (base.replace(/[LR]$/, '') + (m[1] === 'left' ? 'L' : 'R')) as SocketName;
  }
  return undefined;
}

export const DEFAULT_OUTFIT_PALETTE: DesignPalette = { primary: '#4a5a6e', secondary: '#2f3a48', accent: '#ffb020', glow: '#66e0ff' };
export const DEFAULT_SKIN = '#e0b89a';

function sanitizePalette(raw: unknown): DesignPalette {
  const r = obj(raw) ?? {};
  return {
    primary: sanitizeHex(r.primary) ?? DEFAULT_OUTFIT_PALETTE.primary,
    secondary: sanitizeHex(r.secondary) ?? DEFAULT_OUTFIT_PALETTE.secondary,
    accent: sanitizeHex(r.accent) ?? DEFAULT_OUTFIT_PALETTE.accent,
    glow: sanitizeHex(r.glow ?? r.emissive) ?? DEFAULT_OUTFIT_PALETTE.glow,
  };
}

/** piece offset bound (the socket fit pulls the piece's *box* within reach) */
const POS_MAX = 4;

function sanitizePieceTransform(raw: unknown): Transform {
  const r = obj(raw) ?? {};
  return {
    pos: v3(r.pos ?? r.position ?? r.offset, -POS_MAX, POS_MAX, [0, 0, 0]),
    rot: rot3(r.rot ?? r.rotation),
    scale: v3(r.scale, 0.05, 3, [1, 1, 1]),
  };
}

/** Clean one piece (ids are made unique / pieces fitted by sanitizeOutfit). Null without geometry. */
export function sanitizePiece(raw: unknown, warnings: string[] = []): OutfitPiece | null {
  const r = obj(raw);
  if (!r) return null;
  const label = cleanText(r.label ?? r.name, L.maxLabelLength) || 'piece';
  const socket = parseSocket(r.socket ?? r.slot ?? r.attach ?? r.bone);
  if (!socket) {
    warnings.push(`"${label}": unknown socket "${String(r.socket).slice(0, 24)}", dropped`);
    return null;
  }
  const info = SOCKET_INFO[socket];
  const shapes: Shape[] = [];
  for (const s of Array.isArray(r.shapes) ? r.shapes : []) {
    if (shapes.length >= L.maxShapesPerPiece) {
      warnings.push(`"${label}": more than ${L.maxShapesPerPiece} shapes, extra dropped`);
      break;
    }
    const ok = sanitizeShape(s);
    if (ok) shapes.push(ok);
  }
  if (!shapes.length) {
    warnings.push(`"${label}": no geometry, dropped`);
    return null;
  }
  const p: OutfitPiece = { id: cleanId(r.id), label, socket, transform: sanitizePieceTransform(r.transform ?? r), shapes };
  if (r.mirror === true && info.mirror) p.mirror = true;
  if (r.locked === true) p.locked = true;
  return p;
}

/** Bounding box of a piece in its socket frame (transform applied). */
export function pieceBox(p: Pick<OutfitPiece, 'shapes' | 'transform'>): Box3 {
  let b = emptyBox();
  for (const s of p.shapes) b = unionBox(b, shapeBox(s));
  if (isEmptyBox(b)) return b;
  return transformBox(b, composeAffine(p.transform.pos, p.transform.rot, p.transform.scale));
}

export function pieceTris(p: Pick<OutfitPiece, 'shapes' | 'mirror'>): number {
  let n = 0;
  for (const s of p.shapes) n += shapeTris(s);
  return p.mirror ? n * 2 : n;
}

export function outfitTris(pieces: readonly Pick<OutfitPiece, 'shapes' | 'mirror'>[]): number {
  return pieces.reduce((a, p) => a + pieceTris(p), 0);
}

/** how close (m) a piece must come to its body segment */
const HUG_GAP = 0.03;

/**
 * Fit a piece to its socket (mutates): longest side <= socket maxSize, centre within reach,
 * and within HUG_GAP of the body segment box. Locked pieces are fitted too (they were legal
 * when locked, so this is a no-op for them).
 */
export function fitPiece(p: OutfitPiece, warnings: string[] = []): void {
  const info = SOCKET_INFO[p.socket];
  let box = pieceBox(p);
  if (isEmptyBox(box)) return;
  const size = Math.max(...boxSize(box));
  if (size > info.maxSize * 1.002) {
    const f = (info.maxSize * 0.995) / size;
    p.transform.scale = p.transform.scale.map(s => fix(clamp(s * f, 0.05, 3))) as V3;
    warnings.push(`"${p.label}" too big for the ${p.socket}; scaled to ${Math.round(f * 100)}%`);
    box = pieceBox(p);
  }
  // centre within reach
  const pos = [...p.transform.pos] as V3;
  for (let i = 0; i < 3; i++) {
    const c = (box.min[i] + box.max[i]) / 2;
    if (c > info.reach) pos[i] -= c - info.reach;
    else if (c < -info.reach) pos[i] += -info.reach - c;
  }
  // hug: touch the segment box (inflated by HUG_GAP)
  const tmp = { ...p, transform: { ...p.transform, pos } };
  box = pieceBox(tmp);
  const h = info.half;
  for (let i = 0; i < 3; i++) {
    const lo = -h[i] - HUG_GAP;
    const hi = h[i] + HUG_GAP;
    if (box.min[i] > hi) pos[i] -= box.min[i] - hi;
    else if (box.max[i] < lo) pos[i] += lo - box.max[i];
  }
  const next = pos.map(v => fix(clamp(v, -POS_MAX, POS_MAX))) as V3;
  if (next.join() !== p.transform.pos.join()) {
    const d = Math.hypot(next[0] - p.transform.pos[0], next[1] - p.transform.pos[1], next[2] - p.transform.pos[2]);
    if (d > 0.01) warnings.push(`"${p.label}" was ${d.toFixed(2)} m off the ${p.socket}; snapped on`);
    p.transform.pos = next;
  }
}

export function sanitizeOutfit(input: unknown): OutfitSanitizeResult {
  const warnings: string[] = [];
  const r = obj(input) ?? {};
  const pieces: OutfitPiece[] = [];
  const used = new Set<string>();
  const raw = Array.isArray(r.pieces) ? r.pieces : [];
  for (const pr of raw) {
    if (pieces.length >= L.maxPieces) {
      warnings.push(`more than ${L.maxPieces} pieces; extra dropped`);
      break;
    }
    const p = sanitizePiece(pr, warnings);
    if (!p) continue;
    let id = p.id || p.socket.toLowerCase();
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${id.slice(0, 20)}-${n}`)) n++;
      id = `${id.slice(0, 20)}-${n}`;
    }
    p.id = id;
    used.add(id);
    fitPiece(p, warnings);
    pieces.push(p);
  }
  // triangle budget: drop unlocked pieces from the end until it fits
  let tris = outfitTris(pieces);
  for (let i = pieces.length - 1; i >= 0 && tris > L.maxTris; i--) {
    if (pieces[i].locked) continue;
    tris -= pieceTris(pieces[i]);
    warnings.push(`"${pieces[i].label}" dropped (over the ${L.maxTris} triangle budget)`);
    pieces.splice(i, 1);
  }
  for (let i = pieces.length - 1; i >= 0 && tris > L.maxTris; i--) {
    tris -= pieceTris(pieces[i]);
    pieces.splice(i, 1);
  }
  const outfit: OutfitDesign = {
    v: OUTFIT_DSL_VERSION,
    name: cleanText(r.name, L.maxNameLength) || 'Recruit',
    theme: cleanText(r.theme, L.maxThemeLength),
    body: clampBody(r.body),
    skin: sanitizeHex(r.skin) ?? DEFAULT_SKIN,
    palette: sanitizePalette(r.palette),
    pieces,
  };
  return { outfit, warnings };
}

// ---------------------------------------------------------------------------
// editing (Closet: keep / lock / reject, body sliders, reprompt merge)
// ---------------------------------------------------------------------------

const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** True when a piece matches a rejected id / label. */
export function pieceRejected(p: Pick<OutfitPiece, 'id' | 'label'>, rejected: readonly string[]): boolean {
  const label = normText(p.label);
  const words = new Set(label.split(' '));
  for (const r of rejected) {
    const n = normText(r);
    if (!n) continue;
    if (p.id === r.trim().toLowerCase() || label === n) return true;
    const rw = n.split(' ');
    if (rw.length > 1 && rw.every(w => words.has(w))) return true;
  }
  return false;
}

export interface OutfitEdit {
  lock?: string[];
  unlock?: string[];
  reject?: string[];
  body?: Partial<OutfitDesign['body']>;
  palette?: Partial<DesignPalette>;
  skin?: string;
  name?: string;
}

export function applyOutfitEdit(o: OutfitDesign, e: OutfitEdit): { outfit: OutfitDesign; removed: OutfitPiece[] } {
  const next: OutfitDesign = JSON.parse(JSON.stringify(o));
  const has = (list: string[] | undefined, id: string) => !!list && list.includes(id);
  const removed: OutfitPiece[] = [];
  next.pieces = next.pieces.filter(p => {
    if (has(e.reject, p.id)) {
      removed.push(p);
      return false;
    }
    if (has(e.lock, p.id)) p.locked = true;
    if (has(e.unlock, p.id)) delete p.locked;
    return true;
  });
  if (e.body) next.body = { ...next.body, ...e.body };
  if (e.palette) next.palette = { ...next.palette, ...e.palette };
  if (e.skin) next.skin = e.skin;
  if (e.name) next.name = e.name;
  return { outfit: sanitizeOutfit(next).outfit, removed };
}

/** Stored form: editor state (locked) stripped, re-sanitized. */
export function outfitForStorage(o: unknown): OutfitDesign {
  const { outfit } = sanitizeOutfit(o);
  for (const p of outfit.pieces) delete p.locked;
  return outfit;
}
