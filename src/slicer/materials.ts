import type { Schematic } from '../schem/types.js';
import type { Axis } from './steps.js';

export interface MaterialRow {
  block: string;
  /** Total occurrences in the whole schematic. */
  total: number;
  /** Occurrences on the currently visible slice. */
  inSlice: number;
}

export type SortKey = 'total' | 'block' | 'inSlice';
export type SortDir = 'desc' | 'asc';

/**
 * Display name for the material list: the base block type without state
 * properties and without namespace. "minecraft:redstone_wire[east=side,…]"
 * → "redstone_wire". The full blockstate stays available in the info
 * panel after clicking an instance.
 */
export function baseTypeName(block: string): string {
  const bracket = block.indexOf('[');
  const id = bracket === -1 ? block : block.slice(0, bracket);
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

/**
 * Per-type counts: whole schematic plus the currently visible slice.
 * Types with total 0 do not exist by construction; rows are returned
 * unsorted except for a stable base order (palette index).
 */
export function materialTable(schem: Schematic, axis: Axis, sliceCoord: number): MaterialRow[] {
  const totals = new Map<number, number>();
  const inSlice = new Map<number, number>();
  const names = new Map<number, string>();
  for (let i = 0; i < schem.blocks.length; i++) {
    const p = schem.blocks[i]!;
    if (schem.palette[p] === 'minecraft:air') continue;
    totals.set(p, (totals.get(p) ?? 0) + 1);
    if (coordOf(i, schem.size, axis) === sliceCoord) {
      inSlice.set(p, (inSlice.get(p) ?? 0) + 1);
    }
    names.set(p, schem.palette[p]!);
  }
  const rows: MaterialRow[] = [];
  for (const [p, total] of totals) {
    if (total === 0) continue; // 0-waardes verborgen
    rows.push({ block: names.get(p)!, total, inSlice: inSlice.get(p) ?? 0 });
  }
  return rows;
}

function coordOf(flat: number, size: { x: number; y: number; z: number }, axis: Axis): number {
  const y = Math.floor(flat / (size.z * size.x));
  const rem = flat - y * size.z * size.x;
  const z = Math.floor(rem / size.x);
  const x = rem - z * size.x;
  return axis === 'x' ? x : axis === 'y' ? y : z;
}

/** Sort a copy; ties break on block id for determinism. */
export function sortRows(rows: MaterialRow[], key: SortKey, dir: SortDir): MaterialRow[] {
  const mul = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a[key] !== b[key]) return a[key] < b[key] ? -mul : mul;
    return a.block < b.block ? -1 : a.block > b.block ? 1 : 0;
  });
}
