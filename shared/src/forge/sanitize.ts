// sanitizeDesign: turns anything (LLM output, client JSON, garbage) into a legal ForgeDesign.
// Deterministic and dependency-free (runs inside the SpacetimeDB module). Idempotent:
// sanitizeDesign(sanitizeDesign(x).design).design deep-equals sanitizeDesign(x).design.

import { clampWeapon, NUMERIC_STATS } from '../balance';
import type { Weapon, WeaponPart } from '../weapon';
import {
  ANCHORS,
  COMPONENT_ROLES,
  FORGE_DSL_VERSION,
  FORGE_LIMITS as L,
  PALETTE_TOKENS,
  PROJECTILE_SHAPES,
  SHAPE_TYPES,
  TRAILS,
  type Anchor,
  type CatalogPartRef,
  type Component,
  type ComponentRole,
  type DesignFx,
  type DesignPalette,
  type DesignStats,
  type ForgeDesign,
  type Shape,
  type ShapeMaterial,
  type Transform,
  type V2,
  type V3,
} from './types';
import { boxSize, designBox, designTrisEstimate, isEmptyBox, layoutComponents, shapeTris, transformBox, type Box3 } from './math';

export interface SanitizeOptions {
  /** Known catalog part ids; catalogPart components with other ids are dropped. Omit to accept any well-formed id. */
  knownPartIds?: ReadonlySet<string>;
  maxTris?: number;
}

export interface SanitizeResult {
  design: ForgeDesign;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** 4 decimals: stable under re-sanitizing */
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

function numIn(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = num(v);
  return fix(clamp(n ?? dflt, lo, hi));
}

function intIn(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = num(v);
  return Math.round(clamp(n ?? dflt, lo, hi));
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function v3(v: unknown, lo: number, hi: number, dflt: V3): V3 {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const x = fix(clamp(v, lo, hi));
    return [x, x, x];
  }
  if (!Array.isArray(v)) return [...dflt] as V3;
  return [0, 1, 2].map(i => numIn(v[i], lo, hi, dflt[i])) as V3;
}

function rot3(v: unknown): V3 {
  const r = v3(v, -1e6, 1e6, [0, 0, 0]);
  // normalise to (-180, 180]
  return r.map(a => {
    let x = a % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return fix(x);
  }) as V3;
}

const HEX6 = /^#?([0-9a-fA-F]{6})$/;
const HEX3 = /^#?([0-9a-fA-F]{3})$/;

/** '#rrggbb' or undefined */
export function sanitizeHex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  let m = HEX6.exec(s);
  if (m) return `#${m[1].toLowerCase()}`;
  m = HEX3.exec(s);
  if (m) return `#${m[1].split('').map(c => c + c).join('').toLowerCase()}`;
  return undefined;
}

function colorRef(v: unknown, dflt: string): string {
  if (typeof v === 'string') {
    const t = v.trim().replace(/^\$/, '').toLowerCase();
    if ((PALETTE_TOKENS as readonly string[]).includes(t)) return t;
  }
  return sanitizeHex(v) ?? dflt;
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Own-property lookup ('__proto__' / 'constructor' never match). */
function ownGet<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function pick<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return (list as readonly string[]).includes(s) ? (s as T) : undefined;
}

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

const D = (v: unknown, dflt: number) => numIn(v, L.minDim, L.maxDim, dflt);
const C = (v: unknown, dflt = 0) => numIn(v, -L.maxCoord, L.maxCoord, dflt);

function sanitizeMaterial(raw: unknown): ShapeMaterial {
  const r = obj(raw) ?? (typeof raw === 'string' ? { color: raw } : {});
  const m: ShapeMaterial = { color: colorRef(r.color, 'primary') };
  const metal = num(r.metalness);
  if (metal !== undefined) m.metalness = fix(clamp(metal, 0, 1));
  const rough = num(r.roughness);
  if (rough !== undefined) m.roughness = fix(clamp(rough, 0, 1));
  if (r.emissive !== undefined && r.emissive !== null && r.emissive !== false) {
    const e = colorRef(r.emissive, '');
    if (e && e !== '#000000') {
      m.emissive = e;
      m.emissiveIntensity = numIn(r.emissiveIntensity, 0, 4, 1);
    }
  }
  const op = num(r.opacity);
  if (op !== undefined && op < 1) m.opacity = fix(clamp(op, 0.15, 1));
  if (r.flatShading === false) m.flatShading = false;
  return m;
}

function points2(raw: unknown, max: number): V2[] {
  if (!Array.isArray(raw)) return [];
  const out: V2[] = [];
  for (const p of raw) {
    if (out.length >= max) break;
    if (!Array.isArray(p)) continue;
    const x = num(p[0]);
    const y = num(p[1]);
    if (x === undefined || y === undefined) continue;
    out.push([C(x), C(y)]);
  }
  return out;
}

function points3(raw: unknown, max: number): V3[] {
  if (!Array.isArray(raw)) return [];
  const out: V3[] = [];
  for (const p of raw) {
    if (out.length >= max) break;
    if (!Array.isArray(p)) continue;
    const xs = [num(p[0]), num(p[1]), num(p[2])];
    if (xs.some(x => x === undefined)) continue;
    out.push(xs.map(x => C(x)) as V3);
  }
  return out;
}

/** Signed area of a 2D polygon (shoelace). */
function area2(pts: V2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

const SHAPE_ALIASES: Record<string, Shape['type']> = {
  cube: 'box', cuboid: 'box', ball: 'sphere', ring: 'torus', donut: 'torus', pill: 'capsule',
  cyl: 'cylinder', tubeline: 'tube', pipe: 'tube', revolve: 'lathe', prism: 'extrude',
};

export function sanitizeShape(raw: unknown): Shape | null {
  const r = obj(raw);
  if (!r) return null;
  const tRaw = typeof r.type === 'string' ? r.type.trim().toLowerCase() : '';
  const type = (SHAPE_TYPES as readonly string[]).includes(tRaw) ? (tRaw as Shape['type']) : ownGet(SHAPE_ALIASES, tRaw);
  if (!type) return null;
  const base = {
    pos: v3(r.pos, -L.maxCoord, L.maxCoord, [0, 0, 0]),
    rot: rot3(r.rot),
    scale: v3(r.scale, L.minScale, L.maxScale, [1, 1, 1]),
    material: sanitizeMaterial(r.material ?? r.color),
  };
  const seg = (v: unknown, lo: number, hi: number, d: number) => intIn(v, lo, hi, d);
  let s: Shape;
  switch (type) {
    case 'box':
      s = { type, size: v3(r.size, L.minDim, L.maxDim, [0.1, 0.1, 0.1]), ...base };
      break;
    case 'cylinder': {
      const rr = num(r.r);
      s = {
        type,
        rTop: numIn(r.rTop ?? rr, 0, L.maxDim / 2, 0.05),
        rBottom: numIn(r.rBottom ?? rr, 0, L.maxDim / 2, 0.05),
        h: D(r.h, 0.2),
        seg: seg(r.seg, 3, 32, 12),
        ...base,
      };
      if (s.rTop === 0 && s.rBottom === 0) s.rTop = s.rBottom = L.minDim;
      break;
    }
    case 'cone':
      s = { type, r: numIn(r.r, L.minDim, L.maxDim / 2, 0.05), h: D(r.h, 0.2), seg: seg(r.seg, 3, 32, 12), ...base };
      break;
    case 'sphere':
      s = {
        type,
        r: numIn(r.r, L.minDim, L.maxDim / 2, 0.05),
        wseg: seg(r.wseg, 4, 24, 12),
        hseg: seg(r.hseg, 3, 16, 8),
        ...base,
      };
      break;
    case 'torus': {
      const R = numIn(r.r, L.minDim, L.maxDim / 2, 0.08);
      s = {
        type,
        r: R,
        tube: numIn(r.tube, L.minDim, Math.max(L.minDim, R), Math.min(R, 0.02)),
        seg: seg(r.seg, 6, 32, 16),
        ...base,
      };
      const arc = num(r.arc);
      if (arc !== undefined && arc < 360) s.arc = fix(clamp(arc, 10, 360));
      break;
    }
    case 'capsule':
      s = { type, r: numIn(r.r, L.minDim, L.maxDim / 2, 0.04), h: numIn(r.h, 0, L.maxDim, 0.15), seg: seg(r.seg, 4, 24, 8), ...base };
      break;
    case 'lathe': {
      const pts = points2(r.points, L.maxLathePoints).map(([pr, py]) => [fix(Math.abs(pr)), py] as V2);
      if (pts.length < 2) return null;
      s = { type, points: pts, seg: seg(r.seg, 3, 32, 12), ...base };
      break;
    }
    case 'extrude': {
      let pts = points2(r.outline ?? r.points, L.maxOutlinePoints);
      // drop consecutive duplicates
      pts = pts.filter((p, i) => {
        const q = pts[(i + pts.length - 1) % pts.length];
        return i === 0 ? !(pts.length > 1 && q[0] === p[0] && q[1] === p[1]) : !(q[0] === p[0] && q[1] === p[1]);
      });
      if (pts.length < 3 || Math.abs(area2(pts)) < 1e-6) return null;
      s = { type, outline: pts, depth: D(r.depth, 0.05), ...base };
      const bev = num(r.bevel);
      if (bev !== undefined && bev > 0) s.bevel = fix(clamp(bev, 0.001, L.maxBevel));
      break;
    }
    case 'tube': {
      const pts = points3(r.path ?? r.points, L.maxTubePoints);
      if (pts.length < 2) return null;
      s = { type, path: pts, r: numIn(r.r, L.minDim, 0.3, 0.02), seg: seg(r.seg, 3, 16, 6), ...base };
      break;
    }
  }
  // omit identity transforms (compact, and keeps re-sanitizing stable)
  if (s.pos!.every(x => x === 0)) delete s.pos;
  if (s.rot!.every(x => x === 0)) delete s.rot;
  if (s.scale!.every(x => x === 1)) delete s.scale;
  return s;
}

// ---------------------------------------------------------------------------
// components
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z0-9_-]{1,24}$/;

function cleanId(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return ID_RE.test(s) ? s : '';
}

const ROLE_ALIASES: Record<string, ComponentRole> = {
  body: 'core', frame: 'core', receiver: 'core', chassis: 'core', magazine: 'mag', ammo: 'mag', scope: 'sight',
  underbarrel: 'under', nozzle: 'muzzle', hilt: 'handle', shaft: 'handle', crossguard: 'guard', decoration: 'deco',
  trim: 'deco', launcher: 'barrel', canister: 'tank', bow: 'core', limb: 'deco', jaw: 'muzzle',
};

function sanitizeAnchor(v: unknown): Anchor | undefined {
  const a = pick(v, ANCHORS);
  if (a) return a === 'center' ? undefined : a;
  if (Array.isArray(v)) return v3(v, -L.maxCoord, L.maxCoord, [0, 0, 0]);
  return undefined;
}

function sanitizeTransform(raw: unknown): Transform {
  const r = obj(raw) ?? {};
  return {
    pos: v3(r.pos ?? r.position, -L.maxCoord, L.maxCoord, [0, 0, 0]),
    rot: rot3(r.rot ?? r.rotation),
    scale: v3(r.scale, L.minScale, L.maxScale, [1, 1, 1]),
  };
}

const PART_ID_RE = /^[A-Za-z0-9_.:\-/]{1,80}$/;

/**
 * Clean one component (ids / parents are fixed up by sanitizeDesign). Returns null when it has no
 * usable geometry. Used by the forge service to stream components as they arrive.
 */
export function sanitizeComponent(raw: unknown, opts: SanitizeOptions = {}, warnings: string[] = []): Component | null {
  const r = obj(raw);
  if (!r) return null;
  const label = cleanText(r.label ?? r.name, L.maxLabelLength) || 'part';
  const roleRaw = typeof r.role === 'string' ? r.role.trim().toLowerCase() : '';
  const role: ComponentRole = (COMPONENT_ROLES as readonly string[]).includes(roleRaw)
    ? (roleRaw as ComponentRole)
    : (ownGet(ROLE_ALIASES, roleRaw) ?? 'deco');
  const c: Component = { id: cleanId(r.id), label, role, transform: sanitizeTransform(r.transform ?? r) };
  const parent = cleanId(r.parent);
  if (parent) c.parent = parent;
  const attach = sanitizeAnchor(r.attach);
  if (attach) c.attach = attach;

  const cp = obj(r.catalogPart);
  const shapesRaw = Array.isArray(r.shapes) ? r.shapes : undefined;
  if (shapesRaw && shapesRaw.length) {
    const shapes: Shape[] = [];
    for (const s of shapesRaw) {
      if (shapes.length >= L.maxShapesPerComponent) {
        warnings.push(`"${label}": more than ${L.maxShapesPerComponent} shapes, extra dropped`);
        break;
      }
      const ok = sanitizeShape(s);
      if (ok) shapes.push(ok);
      else warnings.push(`"${label}": invalid shape dropped`);
    }
    if (shapes.length) c.shapes = shapes;
  }
  if (!c.shapes && cp) {
    const partId = typeof cp.partId === 'string' ? cp.partId.trim() : '';
    if (!PART_ID_RE.test(partId) || (opts.knownPartIds && !opts.knownPartIds.has(partId))) {
      warnings.push(`"${label}": unknown catalog part "${String(cp.partId).slice(0, 60)}" dropped`);
      return null;
    }
    const ref: CatalogPartRef = { partId };
    const col = sanitizeHex(cp.color);
    if (col) ref.color = col;
    const acc = sanitizeHex(cp.accent);
    if (acc) ref.accent = acc;
    c.catalogPart = ref;
  }
  if (!c.shapes && !c.catalogPart) {
    warnings.push(`"${label}": no geometry, dropped`);
    return null;
  }
  if (r.locked === true) c.locked = true;
  return c;
}

/**
 * Unique ids, valid parents, no cycles, parents before children (stable otherwise).
 * Mutates the components in place; returns the new order.
 */
export function fixHierarchy(list: Component[], warnings: string[] = []): Component[] {
  const used = new Set<string>();
  for (const c of list) {
    let id = c.id || cleanId(c.label) || c.role;
    if (used.has(id) || !ID_RE.test(id)) {
      const base = (id || c.role).slice(0, 20);
      let n = 2;
      while (used.has(`${base}-${n}`)) n++;
      id = `${base}-${n}`;
    }
    c.id = id;
    used.add(id);
  }
  const byId = new Map(list.map(c => [c.id, c]));
  for (const c of list) {
    if (c.parent !== undefined && (!byId.has(c.parent) || c.parent === c.id)) {
      if (c.parent !== c.id) warnings.push(`"${c.label}": unknown parent "${c.parent}" removed`);
      delete c.parent;
    }
  }
  // break cycles: walk up from each node; if we revisit a node, cut that node's parent link
  for (const c of list) {
    const seen = new Set<string>();
    let cur: Component | undefined = c;
    while (cur && cur.parent !== undefined) {
      if (seen.has(cur.id)) {
        warnings.push(`parent cycle at "${cur.id}" broken`);
        delete cur.parent;
        break;
      }
      seen.add(cur.id);
      cur = byId.get(cur.parent);
    }
  }
  for (const c of list) if (c.parent === undefined) delete c.attach;
  // stable topological order
  const out: Component[] = [];
  const placed = new Set<string>();
  const visit = (c: Component) => {
    if (placed.has(c.id)) return;
    if (c.parent !== undefined) visit(byId.get(c.parent)!);
    placed.add(c.id);
    out.push(c);
  };
  for (const c of list) visit(c);
  return out;
}

/** Descendants of `id` (not including it). */
export function descendantsOf(list: readonly Component[], id: string): Set<string> {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of list) {
      if (c.parent !== undefined && (c.parent === id || out.has(c.parent)) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

const SEG_FLOORS: Record<string, [string, number][]> = {
  cylinder: [['seg', 5]],
  cone: [['seg', 5]],
  sphere: [['wseg', 6], ['hseg', 4]],
  torus: [['seg', 8]],
  capsule: [['seg', 5]],
  lathe: [['seg', 5]],
  tube: [['seg', 4]],
};

/** Reduce segment counts, then drop non-locked deco components (from the end), until under budget. */
function enforceTriBudget(list: Component[], maxTris: number, warnings: string[]): Component[] {
  let tris = designTrisEstimate(list);
  if (tris <= maxTris) return list;
  warnings.push(`~${tris} triangles is over the ${maxTris} budget; simplified`);
  for (let pass = 0; pass < 4 && tris > maxTris; pass++) {
    const k = Math.max(0.35, Math.sqrt(maxTris / tris));
    for (const c of list) {
      for (const s of c.shapes ?? []) {
        for (const [key, floor] of SEG_FLOORS[s.type] ?? []) {
          const rec = s as unknown as Record<string, number>;
          const cur = rec[key];
          if (typeof cur === 'number') rec[key] = Math.max(floor, Math.floor(cur * k));
        }
      }
    }
    tris = designTrisEstimate(list);
  }
  // still over: drop components (deco first, never locked, never the first root)
  for (const roleFirst of [true, false]) {
    for (let i = list.length - 1; i > 0 && tris > maxTris; i--) {
      const c = list[i];
      if (c.locked || (roleFirst && c.role !== 'deco')) continue;
      const kill = descendantsOf(list, c.id);
      kill.add(c.id);
      if (list.some(x => kill.has(x.id) && x.locked)) continue;
      warnings.push(`"${c.label}" dropped (triangle budget)`);
      list = list.filter(x => !kill.has(x.id));
      tris = designTrisEstimate(list);
      i = Math.min(i, list.length);
    }
  }
  // last resort: trim shapes of the heaviest component
  while (designTrisEstimate(list) > maxTris) {
    let heavy: Component | undefined;
    let best = 0;
    for (const c of list) {
      if (!c.shapes || c.shapes.length < 2) continue;
      const n = c.shapes.reduce((a, s) => a + shapeTris(s), 0);
      if (n > best) {
        best = n;
        heavy = c;
      }
    }
    if (!heavy) break;
    heavy.shapes!.pop();
  }
  return list;
}

/** Per-axis gap vector moving box `a` to touch box `b` (0 on axes where they overlap). */
function gapToTouch(a: Box3, b: Box3): V3 {
  const out: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (a.min[i] > b.max[i]) out[i] = b.max[i] - a.min[i];
    else if (a.max[i] < b.min[i]) out[i] = b.min[i] - a.max[i];
  }
  return out;
}

const SNAP_TOLERANCE = 0.01;

/**
 * Pull floating components back onto what they belong to (LLMs often add the parent's offset on
 * top of an anchor): a child whose box doesn't touch its parent's box (in the parent frame) is
 * moved until it does; a root that doesn't touch the main body (first component) likewise.
 * Locked components are never moved. Mutates in place.
 */
export function snapFloating(list: Component[], warnings: string[] = []): boolean {
  let changed = false;
  if (list.length < 2) return changed;
  // children: in the parent frame (children are moved before their own children are visited)
  const layout = () => layoutComponents(list);
  let lay = layout();
  const byId = new Map(list.map(c => [c.id, c]));
  for (const c of list) {
    // catalog parts only have a nominal box here (the real one needs THREE): never snap against them
    if (c.locked || c.catalogPart) continue;
    const target = c.parent !== undefined ? byId.get(c.parent) : list[0];
    if (!target || target.catalogPart) continue;
    const e = lay.get(c.id)!;
    let gap: V3;
    if (c.parent !== undefined) {
      const parentBox = lay.get(c.parent)!.localBox;
      if (isEmptyBox(parentBox) || isEmptyBox(e.localBox)) continue;
      gap = gapToTouch(transformBox(e.localBox, e.local), parentBox);
    } else {
      if (c === list[0]) continue;
      const main = lay.get(list[0].id)!;
      if (isEmptyBox(main.worldBox) || isEmptyBox(e.worldBox)) continue;
      gap = gapToTouch(e.worldBox, main.worldBox);
    }
    if (Math.hypot(...gap) <= SNAP_TOLERANCE) continue;
    // c.transform.pos is in the parent frame (or weapon frame for roots), same frame as `gap`
    const before = c.transform.pos.join();
    c.transform.pos = c.transform.pos.map((v, i) => fix(clamp(v + gap[i], -L.maxCoord, L.maxCoord))) as V3;
    if (c.transform.pos.join() === before) continue;
    changed = true;
    warnings.push(`"${c.label}" was floating ${Math.hypot(...gap).toFixed(2)} m away; snapped on`);
    lay = layout();
  }
  return changed;
}

// ---------------------------------------------------------------------------
// design
// ---------------------------------------------------------------------------

const DEFAULT_PALETTE: DesignPalette = { primary: '#3a3f47', secondary: '#8a8f99', accent: '#ff7a1a', glow: '#66e0ff' };

function sanitizePalette(raw: unknown, legacy: unknown): DesignPalette {
  const r = obj(raw) ?? obj(legacy) ?? {};
  return {
    primary: sanitizeHex(r.primary) ?? DEFAULT_PALETTE.primary,
    secondary: sanitizeHex(r.secondary) ?? DEFAULT_PALETTE.secondary,
    accent: sanitizeHex(r.accent) ?? DEFAULT_PALETTE.accent,
    glow: sanitizeHex(r.glow ?? r.emissive) ?? DEFAULT_PALETTE.glow,
  };
}

function sanitizeFx(raw: unknown): DesignFx {
  const r = obj(raw) ?? {};
  const fx: DesignFx = {};
  const mf = sanitizeHex(r.muzzleFlashColor);
  if (mf) fx.muzzleFlashColor = mf;
  const pc = sanitizeHex(r.projectileColor);
  if (pc) fx.projectileColor = pc;
  const ps = pick(r.projectileShape, PROJECTILE_SHAPES);
  if (ps) fx.projectileShape = ps;
  const sc = num(r.projectileScale);
  if (sc !== undefined) fx.projectileScale = fix(clamp(sc, 0.2, 3));
  const tr = pick(r.trail, TRAILS);
  if (tr) fx.trail = tr;
  const tc = sanitizeHex(r.trailColor);
  if (tc) fx.trailColor = tc;
  return fx;
}

/** Catalog-part components as legacy WeaponParts (for the `Weapon.parts` field old clients render). */
export function legacyPartsOf(design: Pick<ForgeDesign, 'components'>): WeaponPart[] {
  const out: WeaponPart[] = [];
  for (const c of design.components) {
    if (!c.catalogPart) continue;
    const p: WeaponPart = { partId: c.catalogPart.partId };
    if (c.catalogPart.color) p.color = c.catalogPart.color;
    if (c.catalogPart.accent) p.accent = c.catalogPart.accent;
    out.push(p);
  }
  return out;
}

/** The balanced Weapon (stats + legacy parts + colours) for a sanitized design. */
export function designToWeapon(design: ForgeDesign): Weapon {
  return clampWeapon({
    ...design.stats,
    name: design.name,
    class: design.class,
    fireMode: design.fireMode,
    parts: legacyPartsOf(design),
    colors: { primary: design.palette.primary, secondary: design.palette.secondary, accent: design.palette.accent },
  });
}

export function sanitizeDesign(input: unknown, opts: SanitizeOptions = {}): SanitizeResult {
  const warnings: string[] = [];
  const raw = obj(input) ?? {};
  if (!obj(input)) warnings.push('design is not an object');
  const maxTris = opts.maxTris ?? L.maxTris;

  // --- components
  const compsRaw = Array.isArray(raw.components) ? raw.components : [];
  let comps: Component[] = [];
  for (const cr of compsRaw) {
    if (comps.length >= L.maxComponents) {
      warnings.push(`more than ${L.maxComponents} components; extra dropped`);
      break;
    }
    const c = sanitizeComponent(cr, opts, warnings);
    if (c) comps.push(c);
  }
  comps = fixHierarchy(comps, warnings);
  comps = enforceTriBudget(comps, maxTris, warnings);

  // --- stats (balance budget via clampWeapon)
  const statsRaw = obj(raw.stats) ?? raw;
  const palette = sanitizePalette(raw.palette, raw.colors);
  const fx = sanitizeFx(raw.fx);
  const name = cleanText(raw.name, L.maxNameLength);

  // melee: derive the hand -> tip reach from the model (tip toward -Z) unless explicitly given
  let meleeRaw = obj(statsRaw.melee) ?? obj(raw.melee);

  const w = clampWeapon({
    ...statsRaw,
    name: name || undefined,
    class: raw.class ?? statsRaw.class,
    fireMode: raw.fireMode ?? statsRaw.fireMode,
    melee: meleeRaw,
    parts: legacyPartsOf({ components: comps }),
  });

  // --- size clamp: longest side of the whole weapon. Scale the roots (children follow); if the
  // scale floor stops that (absurd nesting), drop the outermost unlocked components.
  const maxSize = w.fireMode === 'melee' ? L.maxSizeMelee : L.maxSizeRanged;
  const longestOf = (list: Component[]) => {
    const b = designBox(layoutComponents(list));
    return isEmptyBox(b) ? 0 : Math.max(...boxSize(b));
  };
  const clampSize = (): boolean => {
  let longest = longestOf(comps);
  if (longest <= maxSize + 1e-6) return false;
  {
    warnings.push(`weapon is ${longest.toFixed(2)} m long; scaled down to ${maxSize} m`);
    for (let pass = 0; pass < 3 && longest > maxSize + 1e-6; pass++) {
      const f = (maxSize * 0.995) / longest;
      for (const c of comps) {
        if (c.parent !== undefined) continue;
        c.transform.pos = c.transform.pos.map(x => fix(x * f)) as V3;
        c.transform.scale = c.transform.scale.map(x => fix(clamp(x * f, L.minScale, L.maxScale))) as V3;
      }
      longest = longestOf(comps);
    }
    while (longest > maxSize + 1e-6 && comps.length > 1) {
      const layout2 = layoutComponents(comps);
      let worst: Component | undefined;
      let far = -1;
      for (const c of comps) {
        if (c.locked || c === comps[0]) continue;
        const e = layout2.get(c.id)!;
        const d = Math.max(...e.worldBox.min.map(Math.abs), ...e.worldBox.max.map(Math.abs));
        if (d > far) {
          far = d;
          worst = c;
        }
      }
      if (!worst) break;
      const kill = descendantsOf(comps, worst.id);
      kill.add(worst.id);
      warnings.push(`"${worst.label}" dropped (outside the size limit)`);
      comps = comps.filter(c => !kill.has(c.id));
      longest = longestOf(comps);
    }
  }
  return true;
  };
  // snapping and scaling interact (scale floors break uniform scaling): repeat until stable
  for (let round = 0; round < 4; round++) {
    const snapped = snapFloating(comps, warnings);
    const scaled = clampSize();
    if (!snapped && !scaled) break;
  }

  let melee = w.melee;
  if (melee && comps.length && !(meleeRaw && num(meleeRaw.reach) !== undefined)) {
    const b2 = designBox(layoutComponents(comps));
    if (!isEmptyBox(b2) && b2.min[2] < 0) {
      meleeRaw = { ...melee, reach: Math.max(-b2.min[2], 0.3) };
      const w2 = clampWeapon({ ...w, melee: meleeRaw });
      melee = w2.melee;
      w.range = w2.range;
    }
  }

  const stats = {} as DesignStats;
  for (const k of NUMERIC_STATS) stats[k] = w[k];
  if (melee) stats.melee = melee;

  const design: ForgeDesign = {
    v: FORGE_DSL_VERSION,
    name: w.name,
    class: w.class,
    fireMode: w.fireMode,
    stats,
    palette,
    fx,
    components: comps,
  };
  if (!comps.length) warnings.push('design has no components');
  return { design, warnings };
}
