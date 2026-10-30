import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Deploy base is configurable so the same tree serves at a subpath
// (cyxno.eu/mcslicer/) while local dev/preview stays at '/':
//   VITE_BASE=/mcslicer/ npm run build
const rawBase = process.env.VITE_BASE?.trim() || '/';
const base = rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+|\/+$/g, '')}/`;

export default defineConfig({
  base,
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
    // The heavy three.js chunk loads lazily (dynamic import at idle), so a
    // large raw size there does not affect the first paint — allow it.
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        // Stable vendor chunks: three (viewer), the nbt parser chain
        // (prismarine-nbt + protodef + the Buffer polyfill) and pako are
        // cacheable independently of app code churn.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/')) return 'three';
          if (id.includes('/pako/')) return 'pako';
          if (
            id.includes('/prismarine-nbt/') ||
            id.includes('/protodef') ||
            id.includes('/buffer/')
          ) {
            return 'nbt';
          }
          return undefined;
        },
      },
      onwarn(warning, warn) {
        // Reviewed third-party noise, never our code: protodef compiles its
        // readers/writers with eval (its own design), protodef-validator
        // imports node 'assert' which Vite externalizes for the browser.
        // Warnings from app code still surface.
        if (warning.code === 'EVAL' && warning.id?.includes('/protodef/')) return;
        if (warning.code === 'PLUGIN_WARNING' && warning.message.includes('"assert" has been externalized')) return;
        warn(warning);
      },
    },
  },
});
