import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const WASM_LOADER = resolve(here, 'src/boot/wasm.ts');

/** build id: short git sha + build time (dev server: 'dev', which disables the version check) */
function buildVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  let sha = 'nogit';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  return `${sha}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
}

/** Build only: dist/version.json ({ version }) for the client's stale-version check. */
function versionFile(version: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'version-file',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version, builtAt: new Date().toISOString() }) + '\n');
    },
  };
}

/**
 * Brotli at max settings (what precompress() writes and Caddy serves), memoised by output file
 * name (content-hashed, plus the length as a guard) so the boot manifest and precompress() share it.
 */
const brCache = new Map<string, Buffer>();
function brotli(fileName: string, buf: Buffer): Buffer {
  const key = `${fileName}:${buf.length}`;
  let out = brCache.get(key);
  if (!out) {
    out = brotliCompressSync(buf, {
      params: {
        [zlib.BROTLI_PARAM_QUALITY]: 11,
        [zlib.BROTLI_PARAM_LGWIN]: 24,
        [zlib.BROTLI_PARAM_SIZE_HINT]: buf.length,
        [zlib.BROTLI_PARAM_MODE]: /\.(wasm|glb)$/.test(fileName) ? zlib.BROTLI_MODE_GENERIC : zlib.BROTLI_MODE_TEXT,
      },
    });
    brCache.set(key, out);
  }
  return out;
}

/**
 * Rapier (non-compat build) ships its wasm as an ESM-integration import
 * (`import * as wasm from "./rapier_wasm3d_bg.wasm"`), which Vite doesn't support. Rewrite that
 * import to fetch the .wasm as a separate, hashed asset and compile it while streaming (with
 * progress for the loading screen) behind a top-level await. Far smaller than the compat build's
 * base64-embedded wasm, and it's cacheable / compileStreaming-friendly.
 */
function rapierWasm(): Plugin {
  return {
    name: 'rapier-wasm',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]@dimforge[\\/]rapier3d[\\/]rapier_wasm3d\.js$/.test(id)) return;
      const from = 'import * as wasm from "./rapier_wasm3d_bg.wasm";';
      if (!code.includes(from)) this.error('rapier-wasm: unexpected rapier_wasm3d.js layout');
      return code.replace(
        from,
        [
          'import * as __bg from "./rapier_wasm3d_bg.js";',
          'import __wasmUrl from "./rapier_wasm3d_bg.wasm?url";',
          `import { instantiateWasm as __instantiate } from ${JSON.stringify(WASM_LOADER)};`,
          'const wasm = (await __instantiate(__wasmUrl, { "./rapier_wasm3d_bg.js": __bg })).exports;',
        ].join('\n'),
      );
    },
  };
}

/**
 * Build only: preload the Rapier chunk + wasm from index.html (they're needed before the game is
 * playable but are only reached via a dynamic import), and give the loading screen the compressed
 * sizes of what it waits for (window.__BOOT_ASSETS) so it can show byte-weighted progress.
 */
function bootManifest(): Plugin {
  return {
    name: 'boot-manifest',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle || !ctx.chunk) return;
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
        const byFile = new Map(chunks.map((c) => [c.fileName, c]));
        const rapier = chunks.find((c) => c.moduleIds.some((m) => /rapier3d[\\/]rapier_wasm3d\.js$/.test(m)));
        const wasm = Object.values(bundle).find((a) => a.type === 'asset' && /rapier_wasm3d_bg.*\.wasm$/.test(a.fileName));
        // initial JS = entry + rapier chunk + their static imports
        const initial = new Set<string>();
        const visit = (f: string) => {
          if (initial.has(f)) return;
          initial.add(f);
          for (const i of byFile.get(f)?.imports ?? []) visit(i);
        };
        visit(ctx.chunk.fileName);
        if (rapier) visit(rapier.fileName);
        const files: Record<string, number> = {};
        for (const f of initial) files[`/${f}`] = brotli(f, Buffer.from(byFile.get(f)!.code)).length;
        const tags: { tag: string; attrs?: Record<string, string | boolean>; children?: string; injectTo: 'head' | 'head-prepend' }[] = [];
        // the wasm (or, over plain HTTP, its .br sibling + the JS brotli decoder chunk; see
        // src/boot/wasm.ts) is preloaded by the inline loader script, which knows the protocol
        let wasmInfo: { url: string; raw: number; br: number } | null = null;
        if (wasm && wasm.type === 'asset') {
          const src = Buffer.from(wasm.source as Uint8Array);
          wasmInfo = { url: `/${wasm.fileName}`, raw: src.length, br: brotli(wasm.fileName, src).length };
        }
        const dec = chunks.find((c) => c.moduleIds.some((m) => /[\\/]brotli[\\/]dec[\\/]decode\.js$/.test(m)));
        const decoder = dec ? { url: `/${dec.fileName}`, br: brotli(dec.fileName, Buffer.from(dec.code)).length } : null;
        for (const f of initial) {
          if (html.includes(`/${f}"`)) continue; // entry / already modulepreloaded by Vite
          tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `/${f}` }, injectTo: 'head' });
        }
        tags.push({
          tag: 'script',
          children: `window.__BOOT_ASSETS=${JSON.stringify({ files, wasm: wasmInfo, decoder })}`,
          injectTo: 'head-prepend',
        });
        return tags;
      },
    },
  };
}

/** Build only: write .br (quality 11) and .gz (level 9) next to every compressible file in dist. */
function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : [p];
        });
      for (const file of walk(outDir)) {
        if (!/\.(js|mjs|css|html|wasm|json|svg|txt|glb|gltf)$/.test(file)) continue;
        const buf = readFileSync(file);
        if (buf.length < 1024) continue;
        const br = brotli(relative(outDir, file).split(sep).join('/'), buf);
        const gz = gzipSync(buf, { level: 9 });
        if (br.length < buf.length) writeFileSync(`${file}.br`, br);
        if (gz.length < buf.length) writeFileSync(`${file}.gz`, gz);
      }
    },
  };
}

/**
 * Dev: /api/forge/* goes to the forge service. Default = the live VPS forge (real generations cost
 * API credits); FORGE_PROXY=http://127.0.0.1:8788 points it at a local (mock) forge, e.g. in e2e.
 * The Origin header is dropped so the forge's same-origin check passes for the proxied request.
 */
const FORGE_PROXY = process.env.FORGE_PROXY ?? 'http://187.7.27.171';
const forgeProxy = {
  '/api/forge': {
    target: FORGE_PROXY,
    changeOrigin: true,
    configure: (proxy: { on(ev: 'proxyReq', cb: (req: { removeHeader(name: string): void }) => void): void }) => {
      proxy.on('proxyReq', (req) => req.removeHeader('origin'));
    },
  },
};

const APP_VERSION = process.argv.includes('build') || process.env.NODE_ENV === 'production' ? buildVersion() : 'dev';

export default defineConfig({
  server: { port: 5173, host: true, proxy: forgeProxy },
  preview: { proxy: forgeProxy },
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [rapierWasm(), bootManifest(), versionFile(APP_VERSION), precompress()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // long-cacheable vendor chunks for what the first frame needs (three core, spacetimedb)
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]build[\\/]/, priority: 5 },
            {
              name: 'vendor',
              test: (id: string) => /[\\/]node_modules[\\/]/.test(id) && !/@dimforge|[\\/]three[\\/]/.test(id),
              tags: ['$initial'],
              priority: 4,
            },
            // the part library (lazy): one chunk, loaded after the game is playable
            {
              name: 'parts',
              test: /[\\/]parts[\\/]src[\\/](gen|lib|registry|assemble|recipes)|partsLibraryImpl|BufferGeometryUtils/,
              priority: 3,
            },
          ],
        },
      },
    },
  },
  // rapier's wasm import is rewritten by rapierWasm(); keep it out of dep pre-bundling
  optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
});
