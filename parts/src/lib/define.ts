import type { PartDef, Socket, Vec3 } from '../types';
import { Kit } from './kit';

export interface Spec {
  id: string;
  category: string;
  classes: string[];
  tags: string[];
  desc: string;
  attach: string;
  sockets?: Record<string, Socket>;
  /** default colors used when opts.color/accent omitted */
  color?: string;
  accent?: string;
  draw: (k: Kit) => void;
}

const STYLE_COLORS: [string, string, string][] = [
  ['silly', '#ffb347', '#ff4f9a'],
  ['toy', '#ff7a30', '#2ec4f1'],
  ['scifi', '#e3e7ee', '#19d3ff'],
  ['steampunk', '#7a4a28', '#c99a2e'],
  ['medieval', '#a7adb6', '#6e4424'],
  ['organic', '#6f8f3a', '#d9c27a'],
  ['wood', '#8a5a32', '#3a3a40'],
];

function defaultColors(spec: Spec): [string, string] {
  if (spec.color && spec.accent) return [spec.color, spec.accent];
  let c = '#3e434c';
  let a = '#d4a843';
  for (const [tag, cc, aa] of STYLE_COLORS) {
    if (spec.tags.includes(tag)) {
      c = cc;
      a = aa;
      break;
    }
  }
  if (spec.category === 'blade' && !spec.tags.includes('silly') && !spec.tags.includes('toy')) c = '#c9ced6';
  return [spec.color ?? c, spec.accent ?? a];
}

export function part(spec: Spec): PartDef {
  const [c, a] = defaultColors(spec);
  return {
    id: spec.id,
    category: spec.category,
    classes: spec.classes,
    tags: spec.tags,
    desc: spec.desc,
    attach: spec.attach,
    sockets: spec.sockets ?? {},
    build(opts = {}) {
      const k = new Kit();
      spec.draw(k);
      const obj = k.toObject(opts, c, a, spec.id);
      obj.userData.partId = spec.id;
      obj.userData.category = spec.category;
      return obj;
    },
  };
}

/** Socket helper. */
export const S = (pos: Vec3, dir?: Vec3): Socket => (dir ? { pos, dir } : { pos });

/** Format a number for ids: 0.35 -> '35'. */
export const n2 = (v: number) => String(Math.round(v * 100));

export const uniq = <T>(a: T[]) => [...new Set(a)];
