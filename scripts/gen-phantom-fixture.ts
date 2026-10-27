/**
 * Regenerates tests/fixtures/phantommarket-f64.schem as a RECONSTRUCTION of
 * the real third-party file (Sloimay MCSchematic output, "Super Easy 64 f"):
 * Version 2 header with the v3 palette layout ("v2 hybrid"), 42x10x13,
 * 35-entry palette, 5460 one-byte varints, BlockEntities (sign + chest).
 *
 * The real file now IS the fixture (replaced 2026-10-27, sha1-verified);
this generator remains only as a synthetic shape reference.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';

const W = 42;
const H = 10;
const L = 13;
const VOLUME = W * H * L; // 5460

// 35 palette entries: air + a market-stall-ish mix.
const palette = [
  'minecraft:air',
  'minecraft:smooth_stone',
  'minecraft:oak_planks',
  'minecraft:dark_oak_planks',
  'minecraft:stone_bricks',
  'minecraft:glass',
  'minecraft:glass_pane',
  'minecraft:oak_slab',
  'minecraft:stone_brick_slab',
  'minecraft:oak_stairs[ facing=east ]',
  'minecraft:oak_stairs[ facing=west ]',
  'minecraft:oak_fence',
  'minecraft:lantern',
  'minecraft:chest[ facing=south ]',
  'minecraft:oak_sign[ rotation=8 ]',
  'minecraft:white_carpet',
  'minecraft:red_carpet',
  'minecraft:barrel[ facing=up ]',
  'minecraft:hay_block[ axis=y ]',
  'minecraft:hay_block[ axis=x ]',
  'minecraft:quartz_pillar[ axis=y ]',
  'minecraft:quartz_block',
  'minecraft:polished_andesite',
  'minecraft:crimson_planks',
  'minecraft:warped_planks',
  'minecraft:bookshelf',
  'minecraft:crafting_table',
  'minecraft:furnace[ facing=north ]',
  'minecraft:iron_bars',
  'minecraft:chain[ axis=y ]',
  'minecraft:item_frame[ facing=up ]',
  'minecraft:flower_pot',
  'minecraft:granite',
  'minecraft:diorite',
  'minecraft:coal_block',
];

const blocks = new Uint8Array(VOLUME);
const set = (x: number, y: number, z: number, p: number): void => {
  blocks[(y * L + z) * W + x] = p;
};
for (let x = 0; x < W; x++) for (let z = 0; z < L; z++) set(x, 0, z, 1); // floor
for (let x = 0; x < W; x++) for (let z = 0; z < L; z++) if (x % 6 === 0 || z % 4 === 0) set(x, 1, z, 2);
for (let x = 0; x < W; x += 6) for (let y = 1; y <= 3; y++) for (let z = 0; z < L; z += 4) set(x, y, z, 11); // fence posts
for (let x = 2; x < W - 2; x += 3) { set(x, 4, 0, 5); set(x, 4, L - 1, 5); } // glass
set(4, 1, 2, 13); set(20, 1, 6, 14); set(30, 1, 9, 17); // chest / sign / barrel
for (let i = 0; i < VOLUME; i++) if (blocks[i] === 0) blocks[i] = i % 7 === 0 ? 12 : 0; // some lanterns

const blockData: number[] = [];
for (const v of blocks) blockData.push(v); // all indices < 128 → 1-byte varints → exactly VOLUME bytes

const root = {
  type: 'compound',
  name: '',
  value: {
    Schematic: {
      type: 'compound',
      name: 'Schematic',
      value: {
        Version: { type: 'int', value: 2 },
        DataVersion: { type: 'int', value: 4325 },
        Width: { type: 'short', value: W },
        Height: { type: 'short', value: H },
        Length: { type: 'short', value: L },
        Palette: {
          type: 'compound',
          name: 'Palette',
          value: Object.fromEntries(palette.map((name, i) => [name, { type: 'int', value: i }])),
        },
        PaletteMax: { type: 'int', value: palette.length },
        BlockData: { type: 'byteArray', value: blockData },
        BlockEntities: {
          type: 'list',
          value: {
            type: 'compound',
            value: [
              {
                Id: { type: 'string', value: 'minecraft:sign' },
                Pos: { type: 'intArray', value: [20, 1, 6] },
              },
              {
                Id: { type: 'string', value: 'minecraft:chest' },
                Pos: { type: 'intArray', value: [4, 1, 2] },
              },
            ],
          },
        },
      },
    },
  },
} as const;

const uncompressed = nbt.writeUncompressed(root as never, 'big');
const gzipped = gzipSync(Buffer.from(uncompressed));

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'phantommarket-f64.schem');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, gzipped);
console.log(`wrote ${outPath} (${Buffer.byteLength(gzipped)} bytes gzipped, ${VOLUME} blocks, ${palette.length} palette entries, BlockData ${blockData.length} bytes)`);
