/**
 * Fetch + instantiate a .wasm, reporting download progress to the loading screen (window.__boot,
 * defined inline in index.html). Used by the Rapier wasm shim (see vite.config.ts).
 *
 * Browsers only send `Accept-Encoding: br` over HTTPS, so over plain HTTP the server would fall
 * back to gzip (~1.18 MB for Rapier vs ~0.85 MB brotli). On HTTP we therefore fetch the build's
 * precompressed `.wasm.br` sibling as raw bytes and decode it with a small JS brotli decoder
 * (~60 KB, ~40 ms to decode). Over HTTPS (or in dev) the wasm is fetched normally and compiled
 * while streaming.
 */
type BootUi = { wasm?(fraction: number): void };
type BootAssets = { wasm?: { url: string; raw: number; br: number } | null };

export async function instantiateWasm(url: string, imports: WebAssembly.Imports): Promise<WebAssembly.Instance> {
  const w = window as Window & { __boot?: BootUi; __BOOT_ASSETS?: BootAssets };
  const info = w.__BOOT_ASSETS?.wasm;
  const progress = (f: number) => w.__boot?.wasm?.(Math.min(1, f));
  if (useBrotliSibling(info, url)) {
    try {
      return await instantiateFromBrotli(url, info!, imports, progress);
    } catch (err) {
      console.warn('[wasm] brotli path failed, falling back to a plain fetch', err);
    }
  }
  return instantiateStreamingWithProgress(url, imports, info?.raw ?? 0, progress);
}

function useBrotliSibling(info: BootAssets['wasm'], url: string): boolean {
  return !import.meta.env.DEV && location.protocol === 'http:' && !!info && info.br > 0 && url === info.url;
}

async function instantiateFromBrotli(
  url: string,
  info: NonNullable<BootAssets['wasm']>,
  imports: WebAssembly.Imports,
  progress: (f: number) => void,
): Promise<WebAssembly.Instance> {
  // decoder chunk and compressed bytes download in parallel (both are preloaded by index.html)
  const decoder = import('brotli/decompress.js').then((m) => (m.default ?? m) as (buf: Uint8Array, outSize?: number) => Uint8Array);
  const res = await fetch(`${url}.br`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length')) || info.br;
  const bytes = await readAll(res, (n) => progress(n / len));
  // some servers (e.g. `vite preview`) label a .br file Content-Encoding: br, so the browser has
  // already decoded it: check for the wasm magic number before decoding ourselves
  const isWasm = bytes[0] === 0 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
  // the output size must be given: the decoder only infers the first meta-block's size
  const wasm = isWasm ? bytes : (await decoder)(bytes, info.raw);
  if (wasm.length !== info.raw) throw new Error(`decoded ${wasm.length} bytes, expected ${info.raw}`);
  return (await WebAssembly.instantiate(wasm as Uint8Array<ArrayBuffer>, imports)).instance;
}

async function readAll(res: Response, onBytes: (n: number) => void): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.byteLength;
    onBytes(n);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

async function instantiateStreamingWithProgress(
  url: string,
  imports: WebAssembly.Imports,
  rawSize: number,
  progress: (f: number) => void,
): Promise<WebAssembly.Instance> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: HTTP ${res.status}`);
  let body: Response = res;
  if (res.body && rawSize > 0 && typeof TransformStream !== 'undefined') {
    // bytes read here are decoded bytes: compare against the uncompressed size
    let loaded = 0;
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          loaded += chunk.byteLength;
          progress(loaded / rawSize);
          ctl.enqueue(chunk);
        },
      }),
    );
    body = new Response(counted, { headers: { 'Content-Type': 'application/wasm' } });
  }
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      return (await WebAssembly.instantiateStreaming(body, imports)).instance;
    } catch (err) {
      console.warn('[wasm] streaming compile failed, retrying from bytes', err);
      // if the stream was consumed, refetch (normally an HTTP cache hit)
      const buf = body.bodyUsed ? await (await fetch(url)).arrayBuffer() : await body.arrayBuffer();
      return (await WebAssembly.instantiate(buf, imports)).instance;
    }
  }
  return (await WebAssembly.instantiate(await body.arrayBuffer(), imports)).instance;
}
