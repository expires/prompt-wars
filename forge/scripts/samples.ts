// Generate sample designs through a forge service (default: the deployed VPS, live model), save
// them to forge/samples/<slug>.json with stream timings, and render a PNG contact sheet.
//   tsx scripts/samples.ts ["prompt" ...]          FORGE_URL=http://127.0.0.1:8787 to use a local one
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NdjsonParser } from '../src/assembler';
import { renderDesignsToPng } from './render';
import type { ForgeDesign, ForgeEvent } from '@ai-gaem/shared/forge';

const FORGE = process.env.FORGE_URL ?? 'http://187.7.27.171';
const out = join(dirname(fileURLToPath(import.meta.url)), '../samples');
const prompts = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'a steampunk crocodile revolver that spits brass gears',
      'a giant squeaky rubber duck war hammer',
      'a sci-fi jellyfish plasma rifle with dangling glowing tentacles',
    ];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

async function run(prompt: string) {
  const t0 = Date.now();
  const res = await fetch(`${FORGE}/api/forge/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const events: (ForgeEvent & { at: number })[] = [];
  const p = new NdjsonParser(o => events.push({ ...(o as unknown as ForgeEvent), at: Date.now() - t0 }));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    p.push(dec.decode(value, { stream: true }));
  }
  p.end();
  const start = events.find(e => e.type === 'start') as Extract<ForgeEvent, { type: 'start' }> | undefined;
  const done = events.find(e => e.type === 'done') as (Extract<ForgeEvent, { type: 'done' }> & { at: number }) | undefined;
  const err = events.find(e => e.type === 'error');
  if (!done) throw new Error(`no design: ${JSON.stringify(err)}`);
  const comps = events.filter(e => e.type === 'component');
  const timing = { meta: events.find(e => e.type === 'meta')?.at, firstComponent: comps[0]?.at, lastComponent: comps.at(-1)?.at, done: done.at };
  console.log(`"${prompt}" -> ${done.design.name} (${done.design.class}), ${done.design.components.length} components, model ${start?.model}; ms ${JSON.stringify(timing)}`);
  if (done.warnings.length) console.log(`  warnings: ${done.warnings.join(' | ')}`);
  writeFileSync(join(out, `${slug(prompt)}.json`), JSON.stringify({ prompt, model: start?.model, timing, warnings: done.warnings, design: done.design }, null, 2));
  return done.design;
}

mkdirSync(out, { recursive: true });
const designs: ForgeDesign[] = [];
for (const prompt of prompts) designs.push(await run(prompt));
const png = join(out, process.env.SAMPLES_PNG ?? 'samples.png');
await renderDesignsToPng(designs, png);
console.log(`wrote ${png}`);
