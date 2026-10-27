/** Geometry of a schematic, in blocks. */
export interface SchemSize {
  x: number;
  y: number;
  z: number;
}

/** Which parse branch produced the schematic; shown in the status bar. */
export type SchemFormat = 'sponge-v3' | 'sponge-v2' | 'legacy-mcedit';

/**
 * A parsed schematic (Sponge v2/v3 or legacy MCEdit .schematic).
 *
 * `blocks` is a flat array of palette indices, length = size.x * size.y * size.z,
 * indexed as (y * size.z + z) * size.x + x (Sponge's yzx order).
 * Air is a normal palette entry; use `isAir` / `AIR_BLOCK` to filter.
 * Legacy palettes are translated to namespaced strings at parse time.
 */
export interface Schematic {
  size: SchemSize;
  /** Palette entry i is the block id ("minecraft:stone") of palette index i. */
  palette: string[];
  /** Index in `blocks` has exactly this many entries, always. */
  blockCount: number;
  blocks: Int32Array;
  /** Parse branch used (palette layout vs legacy Blocks+Data). */
  format: SchemFormat;
}

/** Human label for the status bar; makes the active parse branch visible. */
export const FORMAT_LABELS: Record<SchemFormat, string> = {
  'sponge-v3': 'Sponge .schem v3',
  'sponge-v2': 'Sponge .schem v2',
  'legacy-mcedit': 'legacy .schematic (MCEdit)',
};

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
