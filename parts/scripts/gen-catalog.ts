/** Writes parts/catalog.json: compact {id, category, classes, tags, desc, attach} list for LLM prompts. */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog } from '../src/registry';
import { CATEGORIES, WEAPON_CLASSES } from '../src/types';

const here = dirname(fileURLToPath(import.meta.url));
const entries = catalog();
const counts: Record<string, number> = {};
for (const e of entries) counts[e.category] = (counts[e.category] ?? 0) + 1;
const out = {
  version: 1,
  generated: new Date().toISOString(),
  count: entries.length,
  conventions: {
    units: 'meters',
    forward: '-Z',
    up: '+Y',
    assembly:
      'First part is the core (attach ""). Each next part plugs into a free socket named by its `attach` on already-placed parts (most recent first).',
    categories: CATEGORIES,
    classes: WEAPON_CLASSES,
  },
  counts,
  parts: entries,
};
const file = resolve(here, '../catalog.json');
writeFileSync(file, JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`wrote ${entries.length} parts to ${file}`);
console.log(counts);
