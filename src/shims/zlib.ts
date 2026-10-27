/**
 * Browser alias target for 'zlib' (vite.config resolve.alias).
 *
 * prismarine-nbt pulls in node zlib at module top level, but mcslicer
 * never calls the functions that use it: src/schem/parse.ts gunzips with
 * pako and calls nbt.parseAs() on decompressed bytes, so the zlib code path
 * is unreachable. This stub keeps the bundle clean; if something ever does
 * reach for zlib in the browser it fails loudly here instead of mysteriously.
 */
const zlibStub = new Proxy(
  {},
  {
    get() {
      throw new Error(
        'node zlib is not available in the browser — mcslicer gunzips via pako in src/schem/parse.ts',
      );
    },
  },
);
export default zlibStub;
