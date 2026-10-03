/**
 * Compact (dictionary-coded) JSON form of the templates, written to parts/templates.json.
 *
 * {
 *   format: 'ai-gaem-templates', version, count,
 *   dict: { parts, colors, tags, kw, themes, classes, fire, swing, weight, socket },
 *   rows: [ [id, name, classI, fireI, themeI, desc, tagIs[], kwIs[], parts[], stats, melee, curated], ... ]
 * }
 *  parts[]: [partI, colorI|-1, accentI|-1, scale|-1, socketI|-1]  (trailing -1s omitted)
 *  stats:   [damage, fireRate, range, spread, magSize, projectileSpeed, splash] as 0..3 (0 = unset)
 *  melee:   [swingI, reachCm, weightI] or 0
 * decodeTemplates(json) restores the full Template objects.
 */
import type { RecipePart, WeaponClass } from '../types';
import type { FireMode, MeleeWeight, StatHints, Swing, Template } from './types';

type Row = [string, string, number, number, number, string, number[], number[], (number | string)[][], number[], number[] | 0, 0 | 1];

export interface EncodedTemplates {
  format: 'ai-gaem-templates';
  version: number;
  count: number;
  dict: Record<'parts' | 'colors' | 'tags' | 'kw' | 'themes' | 'classes' | 'fire' | 'swing' | 'weight' | 'socket', string[]>;
  rows: Row[];
}

const LV = ['', 'low', 'med', 'high'];
const SP = ['', 'slow', 'med', 'fast'];
const RG = ['', 'short', 'med', 'long'];
const MS = ['', 'small', 'med', 'large'];

class Dict {
  list: string[] = [];
  private m = new Map<string, number>();
  id(s: string): number {
    let i = this.m.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.m.set(s, i);
    }
    return i;
  }
}

export function encodeTemplates(list: Template[], version = 1): EncodedTemplates {
  const d = {
    parts: new Dict(),
    colors: new Dict(),
    tags: new Dict(),
    kw: new Dict(),
    themes: new Dict(),
    classes: new Dict(),
    fire: new Dict(),
    swing: new Dict(),
    weight: new Dict(),
    socket: new Dict(),
  };
  const rows: Row[] = list.map((t) => {
    const parts = t.parts.map((p) => {
      const a: (number | string)[] = [d.parts.id(p.partId), p.color ? d.colors.id(p.color) : -1, p.accent ? d.colors.id(p.accent) : -1, p.scale ?? -1, p.socket ? d.socket.id(p.socket) : -1];
      while (a.length > 1 && a[a.length - 1] === -1) a.pop();
      return a;
    });
    const s = t.statHints ?? {};
    const stats = [LV.indexOf(s.damage ?? ''), SP.indexOf(s.fireRate ?? ''), RG.indexOf(s.range ?? ''), LV.indexOf(s.spread ?? ''), MS.indexOf(s.magSize ?? ''), SP.indexOf(s.projectileSpeed ?? ''), s.splash ? 1 : 0];
    const melee: number[] | 0 = t.melee ? [d.swing.id(t.melee.swing), Math.round(t.melee.reach * 100), d.weight.id(t.melee.weight)] : 0;
    return [
      t.id,
      t.name,
      d.classes.id(t.class),
      d.fire.id(t.fireMode),
      d.themes.id(t.theme),
      t.desc,
      t.tags.map((x) => d.tags.id(x)),
      t.keywords.map((x) => d.kw.id(x)),
      parts,
      stats,
      melee,
      t.curated ? 1 : 0,
    ];
  });
  const dict = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.list])) as EncodedTemplates['dict'];
  return { format: 'ai-gaem-templates', version, count: rows.length, dict, rows };
}

export function decodeTemplates(enc: EncodedTemplates): Template[] {
  const D = enc.dict;
  return enc.rows.map((r) => {
    const [id, name, ci, fi, ti, desc, tags, kws, parts, st, ml, cur] = r;
    const rp: RecipePart[] = parts.map((a) => {
      const p: RecipePart = { partId: D.parts[a[0] as number] };
      if (a.length > 1 && (a[1] as number) >= 0) p.color = D.colors[a[1] as number];
      if (a.length > 2 && (a[2] as number) >= 0) p.accent = D.colors[a[2] as number];
      if (a.length > 3 && (a[3] as number) >= 0) p.scale = a[3] as number;
      if (a.length > 4 && (a[4] as number) >= 0) p.socket = D.socket[a[4] as number];
      return p;
    });
    const s: StatHints = {};
    if (st[0]) s.damage = LV[st[0]] as StatHints['damage'];
    if (st[1]) s.fireRate = SP[st[1]] as StatHints['fireRate'];
    if (st[2]) s.range = RG[st[2]] as StatHints['range'];
    if (st[3]) s.spread = LV[st[3]] as StatHints['spread'];
    if (st[4]) s.magSize = MS[st[4]] as StatHints['magSize'];
    if (st[5]) s.projectileSpeed = SP[st[5]] as StatHints['projectileSpeed'];
    if (st[6]) s.splash = true;
    const t: Template = {
      id,
      name,
      class: D.classes[ci] as WeaponClass,
      fireMode: D.fire[fi] as FireMode,
      tags: tags.map((i) => D.tags[i]),
      theme: D.themes[ti],
      desc,
      keywords: kws.map((i) => D.kw[i]),
      parts: rp,
      statHints: s,
    };
    if (ml) t.melee = { swing: D.swing[ml[0]] as Swing, reach: ml[1] / 100, weight: D.weight[ml[2]] as MeleeWeight };
    if (cur) t.curated = true;
    return t;
  });
}
