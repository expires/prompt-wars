#!/usr/bin/env node
// Frame cost of `tauron-remake` at several viewpoints.
//   pnpm --filter client exec vite --port 5181 &   then:
//   node e2e/tauron-remake-gpu-perf.mjs [baseUrl] [--swiftshader] [--out file.json]
// Default: headless Chrome on the host GPU (Metal via ANGLE), vsync + frame-rate limit off.
// Per view: rAF rate over 3 s (whole game loop), median GPU-synced render time of the scene alone
// (renderer.render + 1-px readPixels to wait for the GPU), draw calls + triangles of one frame.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const swift = args.includes('--swiftshader');
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const base = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') ?? 'http://localhost:5181';
const browser = await chromium.launch({
  headless: true,
  args: swift
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await browser.newPage({ viewport: swift ? { width: 1280, height: 720 } : { width: 1920, height: 1080 } });
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
  ['floor → jumbotron', [19, 0.05, 1.8], [0, 14, -1]],
  ['under A tiers (south)', [6, 0.05, -21.5], [-14, 3.5, -24]],
  ['desk rows west', [-12.7, 0.05, -8], [-30, 1, -14]],
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
          window.__game.lookAt(l[0], l[1], l[2]);
          const ren = window.game.rc.renderer;
          const ctx = ren.getContext();
          const px = new Uint8Array(4);
          const times = [];
          for (let i = 0; i < 25; i++) {
            const s = performance.now();
            ren.render(window.game.rc.scene, window.game.rc.camera);
            ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
            times.push(performance.now() - s);
          }
          times.sort((a, b) => a - b);
          ren.info.reset();
          ren.render(window.game.rc.scene, window.game.rc.camera);
          res({ fps: ((n - 1) * 1000) / (t - t0), renderMs: times[Math.floor(times.length / 2)], calls: ren.info.render.calls, tris: ren.info.render.triangles });
        };
        setTimeout(() => requestAnimationFrame(tick), 600);
      }),
    [f, l],
  );
  out.push({ view: name, fps: Math.round(r.fps), frameMs: +(1000 / r.fps).toFixed(2), renderMs: +r.renderMs.toFixed(2), calls: r.calls, tris: r.tris });
}
console.log('GPU:', gl);
console.log(logs.find((l) => l.includes('[map] tauron-remake')));
console.table(out);
if (outFile) writeFileSync(outFile, JSON.stringify({ gpu: gl, map: logs.find((l) => l.includes('[map] tauron-remake')), views: out }, null, 2));
await browser.close();
