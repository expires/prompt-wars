/** Writes parts/templates.json (dictionary-coded, see src/templates/codec.ts). */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allTemplates, encodeTemplates, templateStats, TEMPLATE_VERSION } from '../src/templates';

const here = dirname(fileURLToPath(import.meta.url));
const t0 = performance.now();
const list = allTemplates();
const ms = performance.now() - t0;
const enc = encodeTemplates(list, TEMPLATE_VERSION);
const json = JSON.stringify(enc);
const file = resolve(here, '../templates.json');
writeFileSync(file, json + '\n');
const gz = gzipSync(json, { level: 9 });

console.log(`generated ${list.length} templates in ${ms.toFixed(0)} ms`);
console.log(`wrote ${file}: ${(json.length / 1024 / 1024).toFixed(2)} MB (gzip ${(gz.length / 1024).toFixed(0)} KB)`);
console.log(JSON.stringify(templateStats(), null, 1));
