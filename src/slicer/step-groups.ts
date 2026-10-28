/**
 * Step groups (phase 4g, part B) — pure and DOM-free.
 *
 * The build guide groups the ordered blocks into steps: a step is a run of
 * face-adjacent blocks in build order, capped at `cap` blocks so a step
 * stays graspable. Grouping is greedy along the order and therefore
 * monotone: the concatenation of all groups is exactly the input order.
 */
import { baseTypeName, type BuildBlock } from './build-order.js';

/** Group caps offered in the UI; 'per-block' is one block per step. */
export type CapOption = 4 | 8 | 12 | 24 | 'per-block';
export const CAP_OPTIONS: readonly CapOption[] = [4, 8, 12, 24, 'per-block'];
export const DEFAULT_CAP: CapOption = 12;

export interface StepGroup {
  index: number;
  /** Index of the group's first block in the build order. */
  first: number;
  count: number;
  /** Bounding box in block coordinates (inclusive). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function capOf(opts: { cap?: CapOption } | undefined): number {
  const cap = opts?.cap ?? DEFAULT_CAP;
  return cap === 'per-block' ? 1 : cap;
}

function key(b: { x: number; y: number; z: number }): string {
  return `${b.x},${b.y},${b.z}`;
}

function hasNeighbourIn(b: { x: number; y: number; z: number }, cells: Set<string>): boolean {
  return cells.has(`${b.x + 1},${b.y},${b.z}`) ||
    cells.has(`${b.x - 1},${b.y},${b.z}`) ||
    cells.has(`${b.x},${b.y + 1},${b.z}`) ||
    cells.has(`${b.x},${b.y - 1},${b.z}`) ||
    cells.has(`${b.x},${b.y},${b.z + 1}`) ||
    cells.has(`${b.x},${b.y},${b.z - 1}`);
}

export function groupSteps(
  blocks: readonly BuildBlock[],
  opts: { cap?: CapOption } = {},
): StepGroup[] {
  const cap = capOf(opts);
  const groups: StepGroup[] = [];
  let cur: StepGroup | null = null;
  let cells: Set<string> = new Set();

  const open = (i: number, b: BuildBlock): void => {
    cur = {
      index: groups.length,
      first: i,
      count: 1,
      minX: b.x, maxX: b.x,
      minY: b.y, maxY: b.y,
      minZ: b.z, maxZ: b.z,
    };
    cells = new Set([key(b)]);
  };
  const extend = (b: BuildBlock): void => {
    cur = {
      ...cur!,
      count: cur!.count + 1,
      minX: Math.min(cur!.minX, b.x),
      maxX: Math.max(cur!.maxX, b.x),
      minY: Math.min(cur!.minY, b.y),
      maxY: Math.max(cur!.maxY, b.y),
      minZ: Math.min(cur!.minZ, b.z),
      maxZ: Math.max(cur!.maxZ, b.z),
    };
    cells.add(key(b));
  };

  blocks.forEach((b, i) => {
    if (cur === null) {
      open(i, b);
      return;
    }
    const full = cur.count >= cap;
    const adjacent = hasNeighbourIn(b, cells);
    if (!adjacent || full) {
      groups.push(cur);
      open(i, b);
    } else {
      extend(b);
    }
  });
  if (cur !== null) groups.push(cur);
  return groups;
}

/**
 * Sprong-indicator (phase 4h, part D): how far the next group is from the
 * current one. Distance is euclidean between bounding-box centres; `jump`
 * is true when it exceeds `threshold` (default 6 blocks) — the step card
 * then shows "springt +N (Δx,Δy,Δz)".
 */
export const JUMP_THRESHOLD = 6;

export interface JumpInfo {
  jump: boolean;
  /** Distance between the two group centres, in blocks. */
  distance: number;
  dx: number;
  dy: number;
  dz: number;
}

export function jumpInfo(
  current: StepGroup,
  next: StepGroup,
  threshold: number = JUMP_THRESHOLD,
): JumpInfo {
  const dx = (next.minX + next.maxX - current.minX - current.maxX) / 2;
  const dy = (next.minY + next.maxY - current.minY - current.maxY) / 2;
  const dz = (next.minZ + next.maxZ - current.minZ - current.maxZ) / 2;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { jump: distance > threshold, distance, dx, dy, dz };
}

/**
 * Layer-wise jump inside the guide (PgUp/PgDn/Shift+scroll in guide mode):
 * index of the FIRST group on the next/previous distinct layer (minY),
 * clamped at the ends. Pure; tested in step-groups.test.ts.
 */
export function layerJumpIndex(
  groups: readonly StepGroup[],
  current: number,
  delta: number,
): number {
  if (groups.length === 0) return 0;
  const cur = Math.min(Math.max(current, 0), groups.length - 1);
  const y = groups[cur]!.minY;
  if (delta > 0) {
    for (let i = cur + 1; i < groups.length; i++) {
      if (groups[i]!.minY !== y) return i;
    }
    return groups.length - 1;
  }
  if (delta < 0) {
    let i = cur - 1;
    while (i >= 0 && groups[i]!.minY === y) i--;
    if (i < 0) return 0;
    const ny = groups[i]!.minY;
    while (i > 0 && groups[i - 1]!.minY === ny) i--;
    return i;
  }
  return cur;
}

/** Ingredients for the step card: "M× <type> — laag y=Y — pos (x1..x2, z1..z2)". */
export interface StepCard {
  count: number;
  /** Base type names in the group with counts, most frequent first. */
  types: Array<{ name: string; count: number }>;
  y: number;
  x1: number;
  x2: number;
  z1: number;
  z2: number;
}

export function stepCard(group: StepGroup, blocks: readonly BuildBlock[]): StepCard {
  const counts = new Map<string, number>();
  for (let i = group.first; i < group.first + group.count; i++) {
    const name = baseTypeName(blocks[i]!.block);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const types = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    count: group.count,
    types,
    y: group.minY,
    x1: group.minX,
    x2: group.maxX,
    z1: group.minZ,
    z2: group.maxZ,
  };
}
