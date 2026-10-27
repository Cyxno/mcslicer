# mcslicer

Self-hosted, **client-side** Minecraft schematic viewer + slicer, aiming for Shulkr-level UX.

Parse and rendering run entirely in the browser: **schematic files are never uploaded** — they are read with the browser's File API, decompressed and rendered locally.

## End goal

- Open a `.schem` (Sponge v2/v3) by dropping it on the page.
- Inspect it in 3D with orbit controls.
- **Slicer mode**: step through the build layer by layer, one block per step — like Shulkr's build-along view.
- Later: textures from user-supplied assets (resource packs), so no copyrighted textures ship with the app.

## Non-goals per phase

| Phase | Delivers | Explicitly not |
|---|---|---|
| 1 (current) | Parser, layer/step engine, tests, CI | Any UI, any rendering |
| 2 | 3D viewer with orbit controls | Slicer mode |
| 3 | Slicer mode (layers → steps) | Custom textures |
| 4 | User-supplied texture assets | Server-side processing (never) |

## Status

- [x] **Phase 1 — parser core** (no UI, by design)
  - Sponge v2/v3 NBT parsing (`src/schem/parse.ts`), pure async function, no DOM imports
  - Layer/step engine (`src/schem/layers.ts`): `schemToLayers()` and `layersToSteps()`
  - Invariants, enforced by tests: `sum(layer counts) === total non-air blocks` (exact), every step === exactly one block
  - Corrupt/truncated input always yields a typed `SchemParseError`, never a crash
  - Fixture `tests/fixtures/demo-huisje.schem` (20×10×20 house: walls, windows, door, gabled roof)
- [x] **Phase 2 — 3D viewer** (drag-drop a `.schem` or use the demo button; one InstancedMesh per block type, orthographic orbit camera, colors from `src/render/colors.ts`, unknown blocks get a deterministic fallback color)
- [ ] Phase 3 — slicer mode
- [ ] Phase 4 — user textures

## Node globals in the browser (polyfills)

The parser uses `prismarine-nbt`, which expects a node environment. The
audited runtime surface in the browser bundle is:

| Global / builtin | Who needs it | How it is provided |
|---|---|---|
| `globalThis.Buffer` | protodef + prismarine-nbt use the *global* Buffer everywhere (no `require('buffer')`) | npm `buffer` polyfill, assigned in `src/schem/nodeShims.ts` |
| `zlib` (gzip path of `parse()`/`parseAs()`) | prismarine-nbt's auto-gunzip | **bypassed**: `src/schem/parse.ts` detects gzip magic and gunzips with pako (pure JS), then calls `parseAs(decompressed, 'big')` so zlib is never reached; `zlib` is aliased to a throwing stub (`src/shims/zlib.ts`) via `vite.config.ts` |

Nothing else is polyfilled on purpose — protodef/prismarine-nbt touch no
other node builtins at runtime (`fs`/`crypto`/`assert` only appear in their
bench/sample/test files, which are not bundled).

**Before you import a second node-flavored library:** extend
`src/schem/nodeShims.ts` (global assignment) and, for `require`d builtins,
add a stub/alias in `vite.config.ts`. `tests/source-hygiene.test.ts` fails
CI if browser code starts using `require()` or node builtins directly, and
that test is also where to add new forbidden patterns.

The `Buffer` shim must be imported **before** anything that loads
prismarine-nbt — `src/main.ts` does this as its first import (ESM evaluates
imports in declaration order).

## Supported schematic formats

Dispatch is on **field presence, not the Version number** — real-world
writers exist that emit a Version 2 header with the v3 palette layout
("v2 hybrid"), and MCEdit-era files put their fields on the NBT root
instead of a `Schematic` child compound.

| Layout | Recognized by | Notes |
|---|---|---|
| Sponge v3 | `Palette` + `BlockData` | varint palette indices, yzx order |
| Sponge v2 (palette or "hybrid") | `Palette` + `BlockData` (any Version tag) | same decode as v3; `Version` is not used to decide |
| Sponge v2 legacy / v1 (MCEdit) | `Blocks` (+ optional nibble-packed `Data`) | numeric ids; decoded as synthetic ids `minecraft:air` (id 0) and `legacy:<id>[data=<meta>]` — no id→name mapping is shipped |
| Either container | root-level fields or a `Schematic` child compound | accepted interchangeably |

`BlockEntities` (signs, chests, …) and any other extra fields are ignored,
never fatal. `Version`, `DataVersion` are optional; a `Version` outside
1–3 is rejected. Air (`minecraft:air`, or legacy id 0) is optional in the
palette. Unknown files fail with a `SchemParseError` that names the real
missing field(s), e.g. `missing both "Palette"+"BlockData" (Sponge v2/v3)
and "Blocks" (legacy v1)`.

**Known gap:** legacy numeric ids are not mapped to modern block names —
the viewer will show generic `legacy:*` colors until a mapping table
(arranged or contributed) is added.

## Development

```bash
npm install
npm test          # vitest
npm run lint      # eslint
npm run build     # tsc + vite build
npm run gen:fixture   # regenerate tests/fixtures/demo-huisje.schem
```

### Regenerating the fixture

The demo house is generated, not hand-made, so it can be tweaked and rebuilt deterministically:

```bash
npm run gen:fixture
```

Edit `scripts/gen-fixture.ts` to change the house (size, materials, roof shape), then run the command and commit the regenerated `.schem` together with your change. Tests validate the fixture against all invariants, so a broken fixture fails CI.

## License

[MIT](LICENSE)
