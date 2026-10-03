/**
 * Boots the gallery with Vite, opens it in headless Chromium (playwright) and saves
 * screenshots of a few category pages and the recipes tab to gallery/screenshots/.
 * Usage: pnpm --filter @ai-gaem/parts shots [cat1,cat2,...]
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../gallery');
const outDir = resolve(root, 'screenshots');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls!.local[0];
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
// Fall back to any already-downloaded headless shell if the pinned one is missing.
function findShell(): string | undefined {
  const base = resolve(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base).filter((x) => x.startsWith('chromium_headless_shell')).sort().reverse()) {
    const p = resolve(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(p)) return p;
  }
  return undefined;
}
let executablePath: string | undefined;
try {
  if (!existsSync(chromium.executablePath())) executablePath = findShell();
} catch {
  executablePath = findShell();
}
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));

const cats = (process.argv[2] ?? 'core,barrel,muzzle,stock,grip,magazine,sight,underbarrel,tank,launcher,crossbow,blade,head,guard,pommel,deco').split(',');
const extra = process.argv.slice(3);

async function shot(query: string, file: string, fullPage = false) {
  await page.goto(`${url}?${query}&eager=1`);
  await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await page.waitForFunction(() => (window as any).__thumbsPending === 0, null, { timeout: 120000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, file), fullPage });
  console.log('saved', file);
  // optional: viewport-sized chunks for close inspection
  const cropDir = process.env.CROPS;
  if (cropDir && fullPage) {
    mkdirSync(cropDir, { recursive: true });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 50, i = 0; y < h; y += 900, i++)
      await page.screenshot({ path: resolve(cropDir, file.replace('.png', `-${i}.png`)), fullPage: true, clip: { x: 0, y, width: 1600, height: Math.min(900, h - y) } });
  }
}

for (const c of cats) await shot(`tab=parts&cat=${c}`, `parts-${c}.png`, true);
await shot('tab=recipes&still=1', 'recipes.png', true);
for (const v of extra) await shot(`tab=parts&view=${encodeURIComponent(v)}`, `view-${v.replace(/[^a-z0-9-]/gi, '_')}.png`);

await browser.close();
await server.close();
