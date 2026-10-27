import { gzipSync, gunzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';

/** Build a minimal valid Sponge v3 .schem byte buffer for tests. */
export function makeSchemBuffer(opts: {
  width: number;
  height: number;
  length: number;
  palette: string[];
  /** palette index per block, in yzx order; length must be width*height*length */
  blockIndices: number[];
  gzip?: boolean;
  version?: number;
}): Buffer {
  const blockData: number[] = [];
  for (const v of opts.blockIndices) {
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
          Version: { type: 'int', value: opts.version ?? 3 },
          DataVersion: { type: 'int', value: 3953 },
          Width: { type: 'short', value: opts.width },
          Height: { type: 'short', value: opts.height },
          Length: { type: 'short', value: opts.length },
          Palette: {
            type: 'compound',
            name: 'Palette',
            value: Object.fromEntries(
              opts.palette.map((name, i) => [name, { type: 'int', value: i }]),
            ),
          },
          PaletteMax: { type: 'int', value: opts.palette.length },
          BlockData: { type: 'byteArray', value: blockData },
        },
      },
    },
  } as const;

  const raw = nbt.writeUncompressed(root as never, 'big');
  return opts.gzip === false ? Buffer.from(raw) : gzipSync(raw);
}

/** Convenience: build a tiny 2x1x2 schem with stone/air mix. */
export function tinySchem(): Buffer {
  // palette: 0 = air, 1 = stone, 2 = oak_planks
  return makeSchemBuffer({
    width: 2,
    height: 1,
    length: 2,
    palette: ['minecraft:air', 'minecraft:stone', 'minecraft:oak_planks'],
    blockIndices: [0, 1, 1, 2],
  });
}

export function rawNbtSchem(): Buffer {
  return makeSchemBuffer({
    width: 1,
    height: 1,
    length: 1,
    palette: ['minecraft:air'],
    blockIndices: [0],
    gzip: false,
  });
}

export function isGzipped(buf: Buffer): boolean {
  try {
    gunzipSync(buf);
    return true;
  } catch {
    return false;
  }
}

/** Build an MCEdit-legacy (v1) buffer: Blocks + nibble-packed Data at root. */
export function makeLegacyBuffer(opts: {
  width: number; height: number; length: number;
  blockIds: number[];
  meta?: number[]; // 4-bit per block
  gzip?: boolean;
  nestUnderSchematic?: boolean;
}): Buffer {
  const { width, height, length } = opts;
  const volume = width * height * length;
  const data: number[] = [];
  for (let i = 0; i < volume; i += 2) {
    const lo = opts.meta ? opts.meta[i]! : 0;
    const hi = opts.meta && i + 1 < volume ? opts.meta[i + 1]! : 0;
    const packed = ((hi << 4) | lo) & 0xff; data.push(packed >= 128 ? packed - 256 : packed);
  }
  const fields: Record<string, { type: string; value: unknown }> = {
    Width: { type: 'short', value: width },
    Height: { type: 'short', value: height },
    Length: { type: 'short', value: length },
    Materials: { type: 'string', value: 'Alpha' },
    Blocks: { type: 'byteArray', value: opts.blockIds },
    Data: { type: 'byteArray', value: data },
  };
  const rootValue = opts.nestUnderSchematic === false
    ? fields
    : { Schematic: { type: 'compound', name: 'Schematic', value: fields } };
  const root = { type: 'compound', name: 'Schematic', value: rootValue } as never;
  const raw = nbt.writeUncompressed(root, 'big');
  return opts.gzip === false ? Buffer.from(raw) : gzipSync(raw);
}
