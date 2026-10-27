import { colorForBlock } from './colors.js';
import { isAir, type Schematic } from '../schem/types.js';

/**
 * Pure, renderer-agnostic scene description: one entry per non-air block
 * type, holding the center positions of every instance of that type.
 *
 * No three.js imports — this is fully unit-testable. The viewer maps each
 * entry onto an InstancedMesh.
 */
export interface SceneBlockType {
  block: string;
  paletteIndex: number;
  /** Number of instances === positions.length / 3. */
  count: number;
  /** 0xRRGGBB viewer color for this type. */
  color: number;
  /** xyz triples, block centers: (x + 0.5, y + 0.5, z + 0.5). */
  positions: Float32Array;
}

/**
 * Group a parsed schematic's non-air blocks by type. Order follows palette
 * index order; air is skipped.
 */
export function schemToSceneData(schem: Schematic): SceneBlockType[] {
  const byType = new Map<number, number[]>();
  for (let i = 0; i < schem.blocks.length; i++) {
    const paletteIndex = schem.blocks[i]!;
    const block = schem.palette[paletteIndex]!;
    if (isAir(block)) continue;
    let positions = byType.get(paletteIndex);
    if (!positions) {
      positions = [];
      byType.set(paletteIndex, positions);
    }
    const sizeX = schem.size.x;
    const sizeZ = schem.size.z;
    const y = Math.floor(i / (sizeZ * sizeX));
    const rem = i - y * sizeZ * sizeX;
    const z = Math.floor(rem / sizeX);
    const x = rem - z * sizeX;
    positions.push(x + 0.5, y + 0.5, z + 0.5);
  }

  const out: SceneBlockType[] = [];
  for (const [paletteIndex, coords] of byType) {
    out.push({
      block: schem.palette[paletteIndex]!,
      paletteIndex,
      count: coords.length / 3,
      color: colorForBlock(schem.palette[paletteIndex]!),
      positions: new Float32Array(coords),
    });
  }
  return out;
}
