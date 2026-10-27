import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      // prismarine-nbt requires node zlib at module top level; in the browser
      // mcslicer's parse path never uses it (pako gunzips first). Stub it.
      zlib: fileURLToPath(new URL('./src/shims/zlib.ts', import.meta.url)),
    },
  },
  build: {
    // The demo .schem asset must stay a real, fetchable file (hashed asset
    // URL), never inlined as a data: URL — data:-fetches break in some
    // embedding contexts and give opaque errors.
    assetsInlineLimit: 0,
  },
});
