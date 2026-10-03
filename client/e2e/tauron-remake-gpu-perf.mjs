#!/usr/bin/env node
// Real-GPU frame rate for `tauron-remake` (headless Chrome on the host GPU, not SwiftShader).
//   pnpm --filter client exec vite --port 5181 &   then:   node e2e/tauron-remake-gpu-perf.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5181';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-webgpu', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
page.on('console', (m) => logs.push(m.text()));
await page.goto(`${base}/?offline=1&e2e=1&map=tauron-remake`);
await page.waitForFunction(() => window.__game?.getState?.().ready, null, { timeout: 120_000 });
await page.waitForTimeout(2000);
const gl = await page.evaluate(() => {
  const r = window.game.rc.renderer.getContext();
  const ext = r.getExtension('WEBGL_debug_renderer_info');
  return ext ? r.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const views = [
  ['floor east → bowl', [30, 0.05, 0], [-30, 6, 0]],
  ['tier C overview', [-60, 22, -30], [5, 2, 5]],
  ['concourse', [0, 9.5, 46], [20, 10.5, 46]],
];
const out = [];
for (const [name, f, l] of views) {
  const r = await page.evaluate(
    ([f, l]) =>
      new Promise((res) => {
        window.__game.teleport(f[0], f[1], f[2]);
        window.__game.lookAt(l[0], l[1], l[2]);
        let n = 0;
        let t0 = 0;
        const tick = (t) => {
          if (!t0) t0 = t;
          n++;
          if (t - t0 < 3000) return requestAnimationFrame(tick);
          const ren = window.game.rc.renderer;
          ren.info.reset();
          ren.render(window.game.rc.scene, window.game.rc.camera);
          res({ fps: ((n - 1) * 1000) / (t - t0), calls: ren.info.render.calls, tris: ren.info.render.triangles });
        };
        setTimeout(() => requestAnimationFrame(tick), 500);
      }),
    [f, l],
  );
  out.push({ view: name, ...r, fps: Math.round(r.fps) });
}
console.log('GPU:', gl);
console.log(logs.find((l) => l.includes('[map] tauron-remake')));
console.table(out);
await browser.close();
