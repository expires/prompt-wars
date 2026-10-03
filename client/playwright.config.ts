import { chromium, defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Browser binary: PW_CHROMIUM_PATH if set; else Playwright's own chromium if installed
 * (`npx playwright install chromium`); else the newest cached Chrome for Testing build in
 * ~/Library/Caches/ms-playwright (macOS) so tests run offline with an older cached browser.
 */
function chromiumPath(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  try {
    // use the full Chromium build explicitly (works headless without the separate headless-shell download)
    const own = chromium.executablePath();
    if (existsSync(own)) return own;
  } catch {
    /* fall through */
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const exe = join(cache, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    const exeX64 = join(cache, d, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    if (existsSync(exe)) return exe;
    if (existsSync(exeX64)) return exeX64;
  }
  return undefined;
}

// E2E: two browser contexts play against a SpacetimeDB server.
//   E2E_SERVER=local (default)  -> ws://localhost:3000 (start it with `pnpm e2e`, which also publishes)
//   E2E_SERVER=maincloud        -> Maincloud prompt-wars-63xhe (smoke test: `pnpm e2e:maincloud`)
// WebGL runs headless on SwiftShader.
const PORT = Number(process.env.E2E_PORT ?? 5179);

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          executablePath: chromiumPath(),
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // /api/forge/* -> a local mock forge (run.mjs starts it on :8788); never the live one in tests
        command: `FORGE_PROXY=${process.env.FORGE_PROXY ?? 'http://127.0.0.1:8788'} pnpm exec vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
