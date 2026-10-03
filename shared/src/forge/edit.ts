// Editor operations on a ForgeDesign: lock / unlock / reject / replace / update / add / set and
// reprompt merging (locked components survive verbatim, rejected ones never come back).
// Every operation re-sanitizes, so the result is always a legal design.

import type { Component, ForgeDesign } from './types';
import { descendantsOf, sanitizeDesign, type SanitizeOptions } from './sanitize';

export type DesignEdit =
  | { op: 'lock'; ids: string[] }
  | { op: 'unlock'; ids: string[] }
  /** remove components (+ their unlocked descendants; locked descendants move to the grandparent) */
  | { op: 'reject'; ids: string[] }
  /** swap a component for a new one (keeps the id unless the new one brings its own unique id) */
  | { op: 'replace'; id: string; with: unknown }
  /** shallow-merge fields into a component (label, transform, attach, parent, shapes, catalogPart, role) */
  | { op: 'update'; id: string; set: Record<string, unknown> }
  | { op: 'add'; component: unknown }
  /** design-level fields */
  | { op: 'set'; name?: string; palette?: Record<string, unknown>; fx?: Record<string, unknown>; stats?: Record<string, unknown>; class?: string; fireMode?: string }
  /** merge a freshly generated design over the current one */
  | { op: 'reprompt'; next: unknown; rejected?: string[] };

/** Spec shorthands: {lock: ids}, {unlock: ids}, {reject: ids}, {replace: id, with}, {reprompt: next}. */
export type DesignEditInput =
  | DesignEdit
  | { lock: string[] }
  | { unlock: string[] }
  | { reject: string[] }
  | { replace: string; with: unknown }
  | { reprompt: unknown; rejected?: string[] };

export interface EditResult {
  design: ForgeDesign;
  warnings: string[];
  /** components removed by a reject (labels feed the next generate request's `rejected`) */
  removed: Component[];
}

export function normalizeEdit(e: DesignEditInput): DesignEdit {
  const r = e as Record<string, unknown>;
  if (typeof r.op === 'string') return e as DesignEdit;
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : []);
  if ('lock' in r) return { op: 'lock', ids: ids(r.lock) };
  if ('unlock' in r) return { op: 'unlock', ids: ids(r.unlock) };
  if ('reject' in r) return { op: 'reject', ids: ids(r.reject) };
  if ('replace' in r) return { op: 'replace', id: String(r.replace), with: r.with };
  if ('reprompt' in r) return { op: 'reprompt', next: r.reprompt, rejected: ids(r.rejected) };
  throw new Error('unknown edit');
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** True when a component matches a rejected id / label ("fluted barrel" matches "Fluted Barrel" and "barrel, fluted"). */
export function matchesRejected(c: Pick<Component, 'id' | 'label'>, rejected: readonly string[]): boolean {
  const label = norm(c.label);
  const words = new Set(label.split(' '));
  for (const r of rejected) {
    const n = norm(r);
    if (!n) continue;
    if (c.id === r.trim().toLowerCase() || label === n) return true;
    const rw = n.split(' ');
    if (rw.length > 1 && rw.every(w => words.has(w))) return true;
  }
  return false;
}

/**
 * Merge a newly generated design over `prev`: design-level fields come from `next`; every locked
 * component of `prev` is kept verbatim (replacing a same-id component of `next`, otherwise added);
 * components of `next` matching `rejected` are dropped.
 */
export function mergeReprompt(prev: ForgeDesign, next: unknown, rejected: readonly string[] = [], opts: SanitizeOptions = {}): EditResult {
  const warnings: string[] = [];
  const n = sanitizeDesign(next, opts);
  warnings.push(...n.warnings);
  const locked = prev.components.filter(c => c.locked);
  const lockedIds = new Map(locked.map(c => [c.id, c]));
  const out: Component[] = [];
  const usedLocked = new Set<string>();
  for (const c of n.design.components) {
    const keep = lockedIds.get(c.id);
    if (keep) {
      out.push(clone(keep));
      usedLocked.add(c.id);
      continue;
    }
    if (matchesRejected(c, rejected)) {
      warnings.push(`rejected component "${c.label}" removed`);
      continue;
    }
    out.push(c);
  }
  // locked components the model didn't echo go first (parents before children is fixed by sanitize)
  const missing = locked.filter(c => !usedLocked.has(c.id)).map(clone);
  const merged = sanitizeDesign({ ...n.design, components: [...missing, ...out] }, opts);
  warnings.push(...merged.warnings);
  return { design: merged.design, warnings, removed: [] };
}

export function applyEdit(design: ForgeDesign, input: DesignEditInput, opts: SanitizeOptions = {}): EditResult {
  const edit = normalizeEdit(input);
  const d = clone(design);
  const warnings: string[] = [];
  let removed: Component[] = [];
  const find = (id: string) => d.components.find(c => c.id === id);

  switch (edit.op) {
    case 'lock':
    case 'unlock': {
      for (const id of edit.ids) {
        const c = find(id);
        if (!c) {
          warnings.push(`no component "${id}"`);
          continue;
        }
        if (edit.op === 'lock') c.locked = true;
        else delete c.locked;
      }
      break;
    }
    case 'reject': {
      const kill = new Set<string>();
      for (const id of edit.ids) {
        const c = find(id);
        if (!c) {
          warnings.push(`no component "${id}"`);
          continue;
        }
        kill.add(id);
        for (const desc of descendantsOf(d.components, id)) if (!find(desc)?.locked) kill.add(desc);
      }
      removed = d.components.filter(c => kill.has(c.id));
      const byId = new Map(d.components.map(c => [c.id, c]));
      const survivorParent = (pid: string | undefined): string | undefined => {
        while (pid !== undefined && kill.has(pid)) pid = byId.get(pid)?.parent;
        return pid;
      };
      d.components = d.components.filter(c => !kill.has(c.id));
      for (const c of d.components) {
        if (c.parent !== undefined && kill.has(c.parent)) {
          const p = survivorParent(c.parent);
          if (p === undefined) delete c.parent;
          else c.parent = p;
        }
      }
      break;
    }
    case 'replace': {
      const i = d.components.findIndex(c => c.id === edit.id);
      if (i < 0) {
        warnings.push(`no component "${edit.id}"`);
        break;
      }
      const w = { ...((edit.with && typeof edit.with === 'object' ? edit.with : {}) as Record<string, unknown>) };
      const old = d.components[i];
      if (typeof w.id !== 'string' || !w.id || d.components.some((c, j) => j !== i && c.id === w.id)) w.id = old.id;
      // children of the old component follow the new id
      for (const c of d.components) if (c.parent === old.id) c.parent = w.id as string;
      if (w.parent === undefined && old.parent !== undefined) w.parent = old.parent;
      if (w.attach === undefined && old.attach !== undefined) w.attach = old.attach;
      d.components[i] = w as unknown as Component;
      break;
    }
    case 'update': {
      const i = d.components.findIndex(c => c.id === edit.id);
      if (i < 0) {
        warnings.push(`no component "${edit.id}"`);
        break;
      }
      const cur = d.components[i] as unknown as Record<string, unknown>;
      const set = { ...edit.set };
      delete set.id;
      const next = { ...cur, ...set };
      if ('shapes' in set) delete next.catalogPart;
      if ('catalogPart' in set) delete next.shapes;
      if (set.transform && typeof set.transform === 'object') next.transform = { ...(cur.transform as object), ...(set.transform as object) };
      d.components[i] = next as unknown as Component;
      break;
    }
    case 'add':
      d.components.push(edit.component as Component);
      break;
    case 'set': {
      const r = d as unknown as Record<string, unknown>;
      if (edit.name !== undefined) r.name = edit.name;
      if (edit.class !== undefined) r.class = edit.class;
      if (edit.fireMode !== undefined) r.fireMode = edit.fireMode;
      if (edit.palette) r.palette = { ...d.palette, ...edit.palette };
      if (edit.fx) r.fx = { ...d.fx, ...edit.fx };
      if (edit.stats) r.stats = { ...d.stats, ...edit.stats };
      break;
    }
    case 'reprompt':
      return mergeReprompt(design, edit.next, edit.rejected ?? [], opts);
  }
  const res = sanitizeDesign(d, opts);
  return { design: res.design, warnings: [...warnings, ...res.warnings], removed };
}
