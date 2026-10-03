// Render designs to a PNG contact sheet with Playwright (cached chromium).
//   tsx scripts/render.ts out.png design1.json [design2.json ...]
//   (each json may be a ForgeDesign or { design }); also exported as renderDesignsToPng().
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeDesign, type ForgeDesign } from '@ai-gaem/shared/forge';

const here = dirname(fileURLToPath(import.meta.url));

export async function renderDesignsToPng(designs: ForgeDesign[], outPng: string, cell = 420): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'forge-render-'));
  await build({
    entryPoints: [join(here, 'render/entry.ts')],
    bundle: true,
    format: 'iife',
    outfile: join(dir, 'bundle.js'),
    logLevel: 'warning',
  });
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><body style="margin:0;background:#111"><script src="bundle.js"></script></body></html>`);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: cell * 2, height: cell * designs.length } });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`file://${join(dir, 'index.html')}`);
    await page.evaluate(([d, c]) => window.renderDesigns(d as ForgeDesign[], c as number), [designs, cell] as const);
    await page.waitForFunction(() => window.renderDone === true, null, { timeout: 30_000 });
    if (errors.length) throw new Error(errors.join('\n'));
    await page.screenshot({ path: outPng, fullPage: true });
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, ...files] = process.argv.slice(2);
  if (!out || !files.length) {
    console.error('usage: tsx scripts/render.ts out.png (design.json [...] | --examples)');
    process.exit(1);
  }
  const designs = files[0] === '--examples'
    ? (await import('@ai-gaem/shared/forge/examples')).FORGE_EXAMPLES.map(e => {
        const r = sanitizeDesign(e);
        if (r.warnings.length) console.log(e.name, r.warnings);
        return r.design;
      })
    : files.map(f => {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return sanitizeDesign(j.design ?? j).design;
  });
  await renderDesignsToPng(designs, out);
  console.log(`wrote ${out}`);
}
