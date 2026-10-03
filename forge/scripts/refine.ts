// Re-run the readability pass (refineDesign) on saved designs and render before / after sheets.
//   tsx scripts/refine.ts out-prefix (sample1.json [sample2.json ...] | --examples)
//   -> out-prefix-before.png, out-prefix-after.png (each json: { prompt?, design } or a ForgeDesign)
import { readFileSync } from 'node:fs';
import { sanitizeDesign, type ForgeDesign } from '@ai-gaem/shared/forge';
import { refineDesign } from '@ai-gaem/shared/forge/refine';
import { expandDesignMacros } from '@ai-gaem/shared/forge/macros';
import { ALL_EXAMPLES } from '../src/prompt';
import { renderDesignsToPng } from './render';

const [prefix, ...files] = process.argv.slice(2);
if (!prefix || !files.length) {
  console.error('usage: tsx scripts/refine.ts out-prefix (design.json [...] | --examples)');
  process.exit(1);
}
const inputs: { prompt?: string; design?: unknown }[] =
  files[0] === '--examples'
    ? ALL_EXAMPLES.map(([prompt, e]) => ({ prompt, design: expandDesignMacros(e) }))
    : files.map(f => JSON.parse(readFileSync(f, 'utf8')));
const before: ForgeDesign[] = [];
const after: ForgeDesign[] = [];
for (const j of inputs) {
  const d = sanitizeDesign(expandDesignMacros(j.design ?? j)).design;
  const r = refineDesign(d, { prompt: j.prompt ?? '' });
  console.log(`${d.name}: ${r.archetype}\n  ${r.notes.join('\n  ')}`);
  before.push(d);
  after.push(r.design);
}
await renderDesignsToPng(before, `${prefix}-before.png`);
await renderDesignsToPng(after, `${prefix}-after.png`);
console.log(`wrote ${prefix}-before.png / -after.png`);
