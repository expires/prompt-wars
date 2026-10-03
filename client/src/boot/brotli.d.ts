// brotli (foliojs) ships no types; only its pure-JS decoder is used (src/boot/wasm.ts)
declare module 'brotli/decompress.js' {
  const decompress: (buf: Uint8Array, outSize?: number) => Uint8Array;
  export default decompress;
}
