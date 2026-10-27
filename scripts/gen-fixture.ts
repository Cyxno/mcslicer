/**
 * Generates tests/fixtures/demo-huisje.schem — a real Sponge v3 schematic of
 * a small house, used both as a test fixture and as future demo-mode input.
 *
 * Regenerate with: npm run gen:fixture
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';

const W = 20; // x
const H = 10; // y
const L = 20; // z

const AIR = 'minecraft:air';
const STONE = 'minecraft:stone';
const PLANKS = 'minecraft:oak_planks';
const GLASS = 'minecraft:glass';
const DOOR_LOWER = 'minecraft:oak_door[half=lower,facing=south,hinge=left,open=false]';
const DOOR_UPPER = 'minecraft:oak_door[half=upper,facing=south,hinge=left,open=false]';
const ROOF = 'minecraft:spruce_planks';

// Palette indices (Sponge v3 assigns these itself; order is ours to pick)
const paletteEntries = [AIR, STONE, PLANKS, GLASS, DOOR_LOWER, DOOR_UPPER, ROOF];
const P = Object.fromEntries(paletteEntries.map((name, i) => [name, i]));

const blocks = new Uint8Array(W * H * L).fill(P[AIR]!);
const set = (x: number, y: number, z: number, p: number) => {
  if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= L) return;
  blocks[(y * L + z) * W + x] = p;
};

// Floor: stone slab at y=0
for (let x = 0; x < W; x++) for (let z = 0; z < L; z++) set(x, 0, z, P[STONE]!);

// Walls: oak planks, hollow shell y=1..4
for (let y = 1; y <= 4; y++) {
  for (let x = 0; x < W; x++) for (let z = 0; z < L; z++) {
    const edge = x === 0 || x === W - 1 || z === 0 || z === L - 1;
    if (edge) set(x, y, z, P[PLANKS]!);
  }
}

// Windows: glass rows on y=3, every 3rd block on each wall
for (let x = 2; x < W - 2; x += 3) {
  set(x, 3, 0, P[GLASS]!);
  set(x, 3, L - 1, P[GLASS]!);
}
for (let z = 2; z < L - 2; z += 3) {
  set(0, 3, z, P[GLASS]!);
  set(W - 1, 3, z, P[GLASS]!);
}

// Door: front (z=0) center, lower + upper half
const doorX = Math.floor(W / 2);
set(doorX, 1, 0, P[DOOR_LOWER]!);
set(doorX, 2, 0, P[DOOR_UPPER]!);

// Gabled roof: spruce planks stepping in from the walls up to the ridge
let inset = 0;
for (let y = 5; y < H; y++) {
  for (let x = inset; x < W - inset; x++) {
    set(x, y, inset, P[ROOF]!);
    set(x, y, L - 1 - inset, P[ROOF]!);
  }
  for (let z = inset; z < L - inset; z++) {
    set(inset, y, z, P[ROOF]!);
    set(W - 1 - inset, y, z, P[ROOF]!);
  }
  inset++;
}

// Varint-encode BlockData (LEB128, Sponge v3 style)
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
        DataVersion: { type: 'int', value: 3953 }, // 1.20.4
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

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'demo-huisje.schem');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, gzipped);

const nonAir = blocks.filter((v) => paletteEntries[v] !== AIR).length;
console.log(`wrote ${outPath}`);
console.log(`size ${W}x${H}x${L}, ${blocks.length} blocks total, ${nonAir} non-air, ${Buffer.byteLength(gzipped)} bytes gzipped`);
