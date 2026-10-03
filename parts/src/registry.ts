/** Central part registry. Generators enumerate curated parameter combos into PartDefs. */
import type { CatalogEntry, PartDef } from './types';
import { coreParts } from './gen/core';
import { barrelParts } from './gen/barrel';
import { muzzleParts } from './gen/muzzle';
import { stockParts } from './gen/stock';
import { gripParts } from './gen/grip';
import { magazineParts } from './gen/magazine';
import { sightParts } from './gen/sight';
import { underbarrelParts } from './gen/underbarrel';
import { tankParts } from './gen/tank';
import { launcherParts } from './gen/launcher';
import { crossbowParts } from './gen/crossbow';
import { bladeParts } from './gen/blade';
import { headParts } from './gen/head';
import { guardParts } from './gen/guard';
import { pommelParts } from './gen/pommel';
import { decoParts } from './gen/deco';

export const PARTS: PartDef[] = [
  ...coreParts(),
  ...barrelParts(),
  ...muzzleParts(),
  ...stockParts(),
  ...gripParts(),
  ...magazineParts(),
  ...sightParts(),
  ...underbarrelParts(),
  ...tankParts(),
  ...launcherParts(),
  ...crossbowParts(),
  ...bladeParts(),
  ...headParts(),
  ...guardParts(),
  ...pommelParts(),
  ...decoParts(),
];

const byId = new Map<string, PartDef>();
for (const p of PARTS) byId.set(p.id, p);

export function getPart(id: string): PartDef | undefined {
  return byId.get(id);
}

/** Register extra parts at runtime (later registrations override same id). */
export function registerParts(parts: PartDef[]): void {
  for (const p of parts) {
    if (!byId.has(p.id)) PARTS.push(p);
    else PARTS[PARTS.findIndex((q) => q.id === p.id)] = p;
    byId.set(p.id, p);
  }
}

export function toCatalogEntry(p: PartDef): CatalogEntry {
  return { id: p.id, category: p.category, classes: p.classes, tags: p.tags, desc: p.desc, attach: p.attach };
}

/** Compact catalog (ids + metadata, no geometry) for LLM prompts. */
export function catalog(): CatalogEntry[] {
  return PARTS.map(toCatalogEntry);
}

/**
 * Parts suited to a weapon class. Deco is universal; 'weird' weapons get everything
 * tagged weird/silly/toy plus their own list.
 */
export function catalogForClass(cls: string, opts: { categories?: string[] } = {}): CatalogEntry[] {
  return PARTS.filter((p) => {
    if (opts.categories && !opts.categories.includes(p.category)) return false;
    return p.classes.includes(cls) || p.category === 'deco';
  }).map(toCatalogEntry);
}

export function partsByCategory(): Record<string, PartDef[]> {
  const out: Record<string, PartDef[]> = {};
  for (const p of PARTS) (out[p.category] ??= []).push(p);
  return out;
}

export const registry = { PARTS, getPart, registerParts, catalog, catalogForClass, partsByCategory };
