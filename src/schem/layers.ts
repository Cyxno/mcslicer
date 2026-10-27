import { isAir, type Schematic } from './types.js';

/** All non-air blocks on one horizontal slice (fixed y), bottom-up ordering. */
export interface SchemLayer {
  y: number;
  cells: Array<{
    x: number;
    z: number;
    paletteIndex: number;
    block: string;
  }>;
  /** cells.length — kept as an explicit field so layer sums are trivially checkable. */
  count: number;
}

/** Exactly one block to place, in deterministic build order. */
export interface SchemStep {
  index: number;
  x: number;
  y: number;
  z: number;
  paletteIndex: number;
  block: string;
}

/**
 * Split a schematic into horizontal layers, bottom-up, containing only
 * non-air blocks.
 *
 * Invariant: sum(l => l.count) === number of non-air blocks in `schem`, exactly.
 */
export function schemToLayers(schem: Schematic): SchemLayer[] {
  const layers: SchemLayer[] = [];
  for (let y = 0; y < schem.size.y; y++) {
    const cells: SchemLayer['cells'] = [];
    for (let z = 0; z < schem.size.z; z++) {
      for (let x = 0; x < schem.size.x; x++) {
        const i = (y * schem.size.z + z) * schem.size.x + x;
        const paletteIndex = schem.blocks[i]!;
        const block = schem.palette[paletteIndex]!;
        if (!isAir(block)) {
          cells.push({ x, z, paletteIndex, block });
        }
      }
    }
    if (cells.length > 0) {
      layers.push({ y, cells, count: cells.length });
    }
  }
  return layers;
}

/**
 * Flatten layers into build steps: exactly one step per non-air block, layer
 * by layer bottom-up, row-major within a layer.
 *
 * Invariant: steps.length === total non-air blocks === sum of layer counts,
 * and each step appears exactly once.
 */
export function layersToSteps(layers: SchemLayer[]): SchemStep[] {
  const steps: SchemStep[] = [];
  for (const layer of layers) {
    for (const cell of layer.cells) {
      steps.push({
        index: steps.length,
        x: cell.x,
        y: layer.y,
        z: cell.z,
        paletteIndex: cell.paletteIndex,
        block: cell.block,
      });
    }
  }
  return steps;
}

export function countNonAir(schem: Schematic): number {
  let n = 0;
  for (let i = 0; i < schem.blocks.length; i++) {
    if (!isAir(schem.palette[schem.blocks[i]!]!)) n++;
  }
  return n;
}
