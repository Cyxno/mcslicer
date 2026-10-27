/**
 * Browser shims for node globals that prismarine-nbt/protodef rely on.
 *
 * The inventory (checked 2026-10): protodef and prismarine-nbt reference the
 * *global* Buffer only (they never import the buffer module directly), and
 * the only other node builtin they touch is zlib inside parse()/parseAs()'s
 * auto-gunzip — which src/schem/parse.ts bypasses by gunzipping with pako
 * first. So the complete shim surface is exactly this one global.
 *
 * This module must be imported BEFORE anything that pulls in
 * prismarine-nbt (see src/main.ts import order).
 */
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}
