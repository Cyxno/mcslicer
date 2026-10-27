/** Geometry of a schematic, in blocks. */
export interface SchemSize {
  x: number;
  y: number;
  z: number;
}

/**
 * A parsed Sponge schematic (v2/v3).
 *
 * `blocks` is a flat array of palette indices, length = size.x * size.y * size.z,
 * indexed as (y * size.z + z) * size.x + x (Sponge's yzx order).
 * Air is a normal palette entry; use `isAir` / `AIR_BLOCK` to filter.
 */
export interface Schematic {
  size: SchemSize;
  /** Palette entry i is the block id ("minecraft:stone") of palette index i. */
  palette: string[];
  /** Index in `blocks` has exactly this many entries, always. */
  blockCount: number;
  blocks: Int32Array;
}

export const AIR_BLOCK = 'minecraft:air';

export function isAir(blockId: string): boolean {
  return blockId === AIR_BLOCK;
}

/** Typed error for every failure mode of parsing; callers must never see a raw crash. */
export class SchemParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SchemParseError';
  }
}
