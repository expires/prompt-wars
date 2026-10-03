// Print the component layout of saved designs (debugging the readability pass).
//   tsx scripts/dump.ts [--refine] samples/foo.json [...]
import { readFileSync } from 'node:fs';
import { boxSize, layoutComponents, sanitizeDesign, type ForgeDesign } from '@ai-gaem/shared/forge';
import { refineDesign } from '@ai-gaem/shared/forge/refine';

const args = process.argv.slice(2);
const refine = args[0] === '--refine';
for (const f of refine ? args.slice(1) : args) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  let d: ForgeDesign = j.design ?? j;
  if (refine) d = refineDesign(sanitizeDesign(d).design, { prompt: j.prompt ?? '' }).design;
  console.log(f.split('/').pop(), d.class, JSON.stringify(d.palette));
  const lay = layoutComponents(d.components);
  for (const c of d.components) {
    const e = lay.get(c.id)!;
    const shapes = (c.shapes ?? []).map(s => s.type + (s.type === 'extrude' ? `[${s.outline.length}]` : '')).join(' ');
    console.log(`  ${c.id} ${c.role} p=${c.parent ?? '-'} ${JSON.stringify(c.attach ?? '')} size ${boxSize(e.worldBox).map(v => v.toFixed(3)).join(',')} min ${e.worldBox.min.map(v => v.toFixed(2)).join(',')} ${c.catalogPart ? 'CATALOG' : shapes}`);
  }
}
