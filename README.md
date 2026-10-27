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
