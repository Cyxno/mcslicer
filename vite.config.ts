import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // The demo .schem asset must stay a real, fetchable file (hashed asset
    // URL), never inlined as a data: URL — data:-fetches break in some
    // embedding contexts and give opaque errors.
    assetsInlineLimit: 0,
  },
});
