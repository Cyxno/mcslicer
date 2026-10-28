/**
 * Generates tests/fixtures/texture-test.schem — a small Sponge v3 schematic
 * that packs one of every visually tricky block: grayscale-tinted textures
 * (redstone wire, grass, water), flat types (rail, lever, torch) and plain
 * cubes. Used for visual texture acceptance, loaded via ?file=texture-test.schem.
 *
 * Regenerate with: npx tsx scripts/gen-texture-fixture.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';

const W = 9;
const H = 3;
const L = 9;

const AIR = 'minecraft:air';
const GRASS = 'minecraft:grass_block[snowy=false]';
const REDSTONE = 'minecraft:redstone_wire[east=side,north=none,south=side,west=none,power=15]';
const TORCH = 'minecraft:redstone_torch[lit=true]';
const RAIL = 'minecraft:rail[shape=north_south]';
const WATER = 'minecraft:water[level=0]';
const LEVER = 'minecraft:lever[face=floor,facing=north,powered=false]';
const STAIRS_N = 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]';
const STAIRS_E = 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]';
const STAIRS_WT = 'minecraft:oak_stairs[facing=west,half=top,shape=straight,waterlogged=false]';
const SLAB_B = 'minecraft:oak_slab[type=bottom,waterlogged=false]';
const SLAB_T = 'minecraft:oak_slab[type=top,waterlogged=false]';
const FENCE = 'minecraft:oak_fence[north=true,east=true,south=false,west=false,waterlogged=false]';

const paletteEntries = [AIR, GRASS, REDSTONE, TORCH, RAIL, WATER, LEVER, STAIRS_N, STAIRS_E, STAIRS_WT, SLAB_B, SLAB_T, FENCE];
const P = Object.fromEntries(paletteEntries.map((name, i) => [name, i]));

const blocks = new Uint8Array(W * H * L).fill(P[AIR]!);
const set = (x: number, y: number, z: number, p: number) => {
  if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= L) return;
  blocks[(y * L + z) * W + x] = p;
};

// grass floor
for (let x = 0; x < W; x++) for (let z = 0; z < L; z++) set(x, 0, z, P[GRASS]!);

// redstone trail across the middle row
for (let x = 1; x <= 4; x++) set(x, 1, 4, P[REDSTONE]!);
set(5, 1, 4, P[TORCH]!);

// rails + lever + water corner
for (let z = 1; z <= 3; z++) set(7, 1, z, P[RAIL]!);
set(1, 1, 1, P[LEVER]!);
set(7, 1, 6, P[WATER]!);
set(8, 1, 6, P[WATER]!);
set(7, 1, 7, P[WATER]!);

// model-geometry showcase (5a): stairs in three orientations, slabs, fence
set(1, 1, 7, P[STAIRS_N]!);
set(2, 1, 7, P[STAIRS_E]!);
set(1, 2, 7, P[STAIRS_WT]!); // upside-down stairs floating on the lower one
set(3, 1, 7, P[SLAB_B]!);
set(4, 1, 7, P[SLAB_T]!);
set(5, 1, 7, P[FENCE]!);
set(5, 1, 6, P[FENCE.replace('east=true', 'east=false').replace('north=true', 'north=false').replace('south=false', 'south=true')]!);

const blockData: number[] = [];
for (const v of blocks) {
  let value = v;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    blockData.push(byte >= 128 ? byte - 256 : byte);
  } while (value !== 0);
}

const root = {
  type: 'compound',
  name: '',
  value: {
    Schematic: {
      type: 'compound',
      name: 'Schematic',
      value: {
        Version: { type: 'int', value: 3 },
        DataVersion: { type: 'int', value: 3953 },
        Width: { type: 'short', value: W },
        Height: { type: 'short', value: H },
        Length: { type: 'short', value: L },
        Offset: { type: 'intArray', value: [0, 0, 0] },
        Palette: {
          type: 'compound',
          name: 'Palette',
          value: Object.fromEntries(
            paletteEntries.map((name) => [name, { type: 'int', value: P[name]! }]),
          ),
        },
        PaletteMax: { type: 'int', value: paletteEntries.length },
        BlockData: { type: 'byteArray', value: blockData },
      },
    },
  },
} as const;

const uncompressed = nbt.writeUncompressed(root as never, 'big');
const gzipped = gzipSync(Buffer.from(uncompressed));

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'texture-test.schem');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, gzipped);
console.log('wrote', outPath);
