/**
 * Build order (phase 4g, part A) — pure and DOM-free.
 *
 * The slicer's scan order (layer by layer, row-major) is a viewing order,
 * not a build order: a wall torch mid-layer would come "too early" only in
 * the sense that it needs its wall first. orderBlocks turns the scan list
 * into a placement order with two rules:
 *
 *   a. support-first — a block with a solid block directly below is placed
 *      after that block; blocks that do not stand on the block below
 *      (torches, rails, redstone wire, …) are placed after their attach
 *      anchor instead. The attach table below is the extension point.
 *   b. layer-by-layer from the bottom — the candidate order is the yzx
 *      scan, so dependencies almost always point backwards already.
 *   c. deterministic tie-break — whenever the dependency graph allows a
 *      choice, the earliest scan-position candidate wins (pure
 *      lexicographic (y, z, x)).
 *
 * Blocks whose support is air or outside the build (overhangs, floating
 * solids — the portal-beam scenario) carry no dependency and keep their
 * scan position: a guide may show a floating beam, it just may never show
 * a block before the thing it stands on.
 */

export interface BuildBlock {
  x: number;
  y: number;
  z: number;
  paletteIndex: number;
  block: string;
}

/**
 * Attach semantics per base type: 'below' = must stand on the block under
 * it (default for everything not listed); 'attach' = mounted on any
 * face-adjacent block (wall, floor or ceiling), so its anchor may be a
 * side neighbour or even a block ABOVE it (hanging torch under a beam).
 * Extend this table; do not special-case types at call sites.
 */
export const ATTACH_RULES: ReadonlySet<string> = new Set([
  'torch',
  'redstone_torch',
  'soul_torch',
  'wall_torch',
  'redstone_wall_torch',
  'soul_wall_torch',
  'rail',
  'powered_rail',
  'detector_rail',
  'activator_rail',
  'redstone_wire',
  'lever',
  'tripwire_hook',
  'ladder',
  'item_frame',
  'glow_item_frame',
]);

/** Base type of a palette entry: "minecraft:oak_stairs[facing=north]" → "oak_stairs". */
export function baseTypeName(entry: string): string {
  const noNamespace = entry.startsWith('minecraft:') ? entry.slice('minecraft:'.length) : entry;
  return noNamespace.split('[')[0]!;
}

/** How this block must be supported when built. */
export function supportKind(entry: string): 'below' | 'attach' {
  return ATTACH_RULES.has(baseTypeName(entry)) ? 'attach' : 'below';
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Raster direction within each layer. Bottom-up building is fixed; these
 * only flip the scan order inside a layer (P2). */
export interface BuildDirection {
  dirX: 1 | -1;
  dirZ: 1 | -1;
}

export const DEFAULT_DIRECTION: BuildDirection = { dirX: 1, dirZ: 1 };

/**
 * Order blocks for building. Input order is irrelevant (it is re-sorted);
 * the output contains exactly the input blocks, once each, in placement
 * order. Deterministic: same input → same output, always. The direction
 * only re-orders the candidate scan within a layer — the dependency rules
 * (support-first) apply identically in every direction, so the result is a
 * raster order, NOT a claim of physical optimality for every block.
 */
export function orderBlocks(
  blocks: readonly BuildBlock[],
  direction: BuildDirection = DEFAULT_DIRECTION,
): BuildBlock[] {
  // Candidate order: layer-by-layer from the bottom, then lexicographic
  // along the chosen raster direction.
  const scan = [...blocks].sort(
    (a, b) =>
      a.y - b.y ||
      (a.z - b.z) * direction.dirZ ||
      (a.x - b.x) * direction.dirX,
  );
  const scanIndex = new Map<string, number>();
  scan.forEach((b, i) => scanIndex.set(key(b.x, b.y, b.z), i));
  const at = (x: number, y: number, z: number): BuildBlock | undefined => {
    const i = scanIndex.get(key(x, y, z));
    return i === undefined ? undefined : scan[i];
  };

  // Dependencies. Edges always point from a scan-earlier anchor to the
  // dependent block:
  //  - 'below' kinds: the block underneath (scan-earlier by construction).
  //  - 'attach' kinds: their scan-earliest non-air face neighbour — picking
  //    exactly one (the earliest) keeps the graph acyclic even for chains
  //    of mutual neighbours such as a redstone wire trail.
  const deps = new Map<number, Set<number>>(); // dependent -> anchors
  const dependents = new Map<number, Set<number>>(); // anchor -> dependents
  const addEdge = (from: number, to: number): void => {
    if (!deps.get(to)!.has(from)) {
      deps.get(to)!.add(from);
      if (!dependents.has(from)) dependents.set(from, new Set());
      dependents.get(from)!.add(to);
    }
  };
  scan.forEach((b, i) => deps.set(i, new Set()));
  scan.forEach((b, i) => {
    if (supportKind(b.block) === 'below') {
      const under = at(b.x, b.y - 1, b.z);
      // A solid never stands ON an attach block (torch under a beam): such
      // an edge would be a cycle in the graph and a fiction in the guide.
      if (under && supportKind(under.block) === 'below') {
        addEdge(scanIndex.get(key(under.x, under.y, under.z))!, i);
      }
    } else {
      let anchor: number | null = null;
      for (const [dx, dy, dz] of NEIGHBORS) {
        const n = at(b.x + dx, b.y + dy, b.z + dz);
        if (!n) continue;
        const ni = scanIndex.get(key(n.x, n.y, n.z))!;
        if (anchor === null || ni < anchor) anchor = ni;
      }
      if (anchor !== null) addEdge(anchor, i);
    }
  });

  // Kahn's algorithm; among the ready nodes always the scan-earliest wins
  // (rule c). A cycle is impossible by construction (every edge points to
  // a scan-later node), but the tail-guard keeps the invariant "every block
  // exactly once" absolute even under a future rule change.
  const remainingDeps = scan.map((_, i) => deps.get(i)!.size);
  const ready: number[] = [];
  for (let i = 0; i < scan.length; i++) {
    if (remainingDeps[i] === 0) ready.push(i);
  }
  const ordered: BuildBlock[] = [];
  const placed = new Array<boolean>(scan.length).fill(false);
  while (ready.length > 0) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) {
      if (ready[i]! < ready[best]!) best = i;
    }
    const i = ready.splice(best, 1)[0]!;
    placed[i] = true;
    ordered.push(scan[i]!);
    for (const d of dependents.get(i) ?? []) {
      if (--remainingDeps[d]! === 0) ready.push(d);
    }
  }
  for (let i = 0; i < scan.length; i++) {
    if (!placed[i]) ordered.push(scan[i]!);
  }
  return ordered;
}

/**
 * Face adjacency in block coordinates (Manhattan distance exactly 1).
 */
export function faceAdjacent(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) === 1;
}
