/**
 * Screenshots of the gallery Templates tab: per theme, per class, melee/everyday/curated and search
 * queries -> gallery/screenshots/templates-*.png
 * Usage: tsx scripts/template-shots.ts [only-substring]   (e.g. "q-" for just the queries)
 */
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { THEMES } from '../src/templates/themes';
import { WEAPON_CLASSES } from '../src/types';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../gallery');
const outDir = resolve(root, 'screenshots');
mkdirSync(outDir, { recursive: true });
const only = process.argv[2];

const QUERIES = [
  'frying pan',
  'guitar',
  'umbrella sword',
  'garden hose flamethrower',
  'a frying pan that shoots baguettes',
  "grandma's umbrella sword",
  'rubber duck',
  'steampunk kettle',
  'office stapler smg',
  'chair',
  'keyboard',
  'plunger',
  'baguette',
  'katana',
  'pirate blunderbuss',
  'trumpet',
  'shield',
  'chainsaw',
];

const shots: [string, string][] = [];
for (const t of THEMES) shots.push([`theme-${t.id}`, `ttheme=${t.id}&page=1`]);
for (const c of WEAPON_CLASSES) shots.push([`class-${c}`, `tcls=${c}&page=2`]);
shots.push(['melee', 'tkind=melee&page=3'], ['melee-everyday', 'tcls=melee&tkind=everyday&page=1'], ['everyday', 'tkind=everyday&page=5'], ['curated', 'tkind=curated']);
for (const q of QUERIES) shots.push([`q-${q.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')}`, `tq=${encodeURIComponent(q)}&pageSize=12`]);

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
  for (const [name, q] of shots) {
    if (only && !name.includes(only)) continue;
    const ps = q.includes('pageSize') ? '' : '&pageSize=20';
    await page.goto(`${url}?tab=templates&eager=1${ps}&${q}`);
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 90000 });
    await page.waitForTimeout(300);
    await page.waitForFunction(() => (window as any).__thumbsPending === 0, null, { timeout: 120000 });
    await page.waitForTimeout(200);
    const file = resolve(outDir, `templates-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log('saved', file);
  }
  if (!only || 'random'.includes(only)) {
    await page.goto(`${url}?tab=templates&pageSize=1&random=42`);
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 90000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(outDir, 'templates-random.png') });
    console.log('saved templates-random.png');
  }
} finally {
  await browser.close();
  await server.close();
}
