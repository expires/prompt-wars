/**
 * Screenshot parts whose id/desc matches each query (gallery parts tab, eager render, sockets on).
 * Usage: tsx scripts/obj-shots.ts frying-pan,baguette [--nosockets]
 * Writes gallery/screenshots/obj-<query>.png
 */
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../gallery');
const outDir = resolve(root, 'screenshots');
mkdirSync(outDir, { recursive: true });
const queries = (process.argv[2] ?? '').split(',').filter(Boolean);
const sockets = !process.argv.includes('--nosockets');

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
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls!.local[0];
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
try {
  for (const q of queries) {
    await page.goto(`${url}?tab=parts&q=${encodeURIComponent(q)}&eager=1${sockets ? '&sockets=1' : ''}`);
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    await page.waitForFunction(() => (window as any).__thumbsPending === 0, null, { timeout: 120000 });
    await page.waitForTimeout(300);
    const file = resolve(outDir, `obj-${q.replace(/[^a-z0-9-]/gi, '_')}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log('saved', file);
  }
} finally {
  await browser.close();
  await server.close();
}
