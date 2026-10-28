import { describe, expect, it } from 'vitest';
import {
  CAP_OPTIONS,
  DEFAULT_CAP,
  JUMP_THRESHOLD,
  ROW_CAP,
  groupSteps,
  jumpInfo,
  layerJumpIndex,
  stepCard,
} from '../src/slicer/step-groups.js';
import type { BuildBlock } from '../src/slicer/build-order.js';

function b(x: number, y: number, z: number, block = 'minecraft:stone'): BuildBlock {
  return { x, y, z, paletteIndex: 1, block };
}

describe('groupSteps — invariants', () => {
  it('default cap is 12; offered caps are 4/8/12/24/row/per-block', () => {
    expect(DEFAULT_CAP).toBe(12);
    expect(CAP_OPTIONS).toEqual([4, 8, 12, 24, 'row', 'per-block']);
  });

  it('sum of group counts equals the total; groups tile the order monotonically', () => {
    const blocks: BuildBlock[] = [];
    for (let i = 0; i < 50; i++) blocks.push(b(i % 10, Math.floor(i / 10), 0)); // 10x5 floor
    for (const cap of CAP_OPTIONS) {
      const groups = groupSteps(blocks, { cap });
      expect(groups.reduce((a, g) => a + g.count, 0)).toBe(blocks.length);
      let cursor = 0;
      for (const g of groups) {
        expect(g.first).toBe(cursor);
        expect(g.index).toBe(groups.indexOf(g));
        cursor += g.count;
        const limit = cap === 'per-block' ? 1 : cap === 'row' ? ROW_CAP : cap;
        expect(g.count).toBeLessThanOrEqual(limit);
      }
      expect(cursor).toBe(blocks.length);
    }
  });

  it('a solid connected run forms one group (up to the cap)', () => {
    const blocks = [b(0, 0, 0), b(1, 0, 0), b(2, 0, 0), b(2, 1, 0)];
    const groups = groupSteps(blocks, { cap: 12 });
    expect(groups.length).toBe(1);
    expect(groups[0]!.count).toBe(4);
  });

  it('a spatial gap closes the group even under the cap', () => {
    const blocks = [b(0, 0, 0), b(1, 0, 0), b(5, 0, 0), b(6, 0, 0)];
    const groups = groupSteps(blocks, { cap: 12 });
    expect(groups.map((g) => g.count)).toEqual([2, 2]);
    expect(groups[1]!.first).toBe(2);
  });

  it('is monotone in the cap: smaller caps never merge more', () => {
    const blocks: BuildBlock[] = [];
    for (let x = 0; x < 30; x++) blocks.push(b(x, 0, 0));
    const g24 = groupSteps(blocks, { cap: 24 });
    const g12 = groupSteps(blocks, { cap: 12 });
    const g4 = groupSteps(blocks, { cap: 4 });
    expect(g24.length).toBeLessThanOrEqual(g12.length);
    expect(g12.length).toBeLessThanOrEqual(g4.length);
    expect(groupSteps(blocks, { cap: 'per-block' }).length).toBe(blocks.length);
  });

  it('is deterministic', () => {
    const blocks = [b(0, 0, 0), b(0, 1, 0), b(3, 3, 3)];
    expect(groupSteps(blocks)).toEqual(groupSteps(blocks));
  });

  it('bounding boxes are tight around their members', () => {
    const blocks = [b(0, 0, 0), b(1, 0, 0), b(1, 1, 0), b(1, 1, 1)];
    const [g] = groupSteps(blocks);
    expect(g).toMatchObject({ minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1, count: 4 });
  });
});

describe('jumpInfo', () => {
  const groups = groupSteps([b(0, 0, 0), b(1, 0, 0), b(20, 5, 8), b(21, 5, 8)]);
  it('adjacent continuation does not jump', () => {
    const info = jumpInfo(groups[0]!, groups[1]!);
    expect(info.jump).toBe(true); // centres are 19.x blocks apart
    expect(info.distance).toBeGreaterThan(JUMP_THRESHOLD);
    expect(info.dx).toBe(20);
  });
  it('a close next group stays under the threshold', () => {
    const two = groupSteps([b(0, 0, 0), b(2, 0, 0)]); // gap of 1 block, distance 2
    const info = jumpInfo(two[0]!, two[1]!);
    expect(info.jump).toBe(false);
    expect(info.distance).toBe(2);
  });
  it('threshold of 6 is respected exactly', () => {
    const two = groupSteps([b(0, 0, 0), b(6, 0, 0)]); // centre distance 6
    expect(jumpInfo(two[0]!, two[1]!).jump).toBe(false);
    const three = groupSteps([b(0, 0, 0), b(7, 0, 0)]); // 7 > 6
    expect(jumpInfo(three[0]!, three[1]!).jump).toBe(true);
  });
});

describe('stepCard', () => {
  it('counts types and reports the bbox footprint', () => {
    const blocks = [
      b(0, 0, 0),
      b(1, 0, 0, 'minecraft:oak_planks'),
      b(1, 0, 1, 'minecraft:oak_planks'),
    ];
    const groups = groupSteps(blocks);
    // (1,0,1) is face-adjacent to (1,0,0): one connected group of 3.
    expect(groups.map((g) => g.count)).toEqual([3]);
    const card = stepCard(groups[0]!, blocks);
    expect(card.count).toBe(3);
    expect(card.types).toEqual([{ name: 'oak_planks', count: 2 }, { name: 'stone', count: 1 }]);
    expect(card).toMatchObject({ y: 0, x1: 0, x2: 1, z1: 0, z2: 1 });
  });
});

describe('per-block granularity', () => {
  it('cap per-block gives exactly one group per block, each count 1', () => {
    const blocks = [b(0, 0, 0), b(1, 0, 0), b(1, 0, 1), b(5, 2, 2)];
    const groups = groupSteps(blocks, { cap: 'per-block' });
    expect(groups.length).toBe(4);
    for (const g of groups) expect(g.count).toBe(1);
    expect(groups.map((g) => g.first)).toEqual([0, 1, 2, 3]);
  });
});

describe('layerJumpIndex — guide layer-wise jumps', () => {
  // six mutually non-adjacent blocks -> six groups:
  // y=0 indices 0,1; y=3 indices 2,3,4; y=7 index 5
  const groups = groupSteps([
    b(0, 0, 0), b(3, 0, 0),
    b(0, 3, 0), b(3, 3, 0), b(6, 3, 0),
    b(1, 7, 1),
  ]);
  it('moves to the first group of the next distinct layer', () => {
    expect(layerJumpIndex(groups, 0, +1)).toBe(2);
    expect(layerJumpIndex(groups, 3, +1)).toBe(5);
  });
  it('moves to the first group of the previous distinct layer', () => {
    expect(layerJumpIndex(groups, 2, -1)).toBe(0);
    expect(layerJumpIndex(groups, 5, -1)).toBe(2);
  });
  it('clamps at both ends', () => {
    expect(layerJumpIndex(groups, 5, +1)).toBe(5);
    expect(layerJumpIndex(groups, 0, -1)).toBe(0);
  });
  it('stays put on delta 0 and clamps out-of-range current', () => {
    expect(layerJumpIndex(groups, 2, 0)).toBe(2);
    expect(layerJumpIndex(groups, 99, +1)).toBe(5);
    expect(layerJumpIndex([], 0, +1)).toBe(0);
  });
});

describe("groupSteps cap 'row' — rij voor rij", () => {
  it('groups one raster row (same y and z) per step', () => {
    const blocks = [b(0, 0, 0), b(1, 0, 0), b(2, 0, 0), b(0, 0, 1), b(1, 0, 1)];
    const groups = groupSteps(blocks, { cap: 'row' });
    expect(groups.map((g) => g.count)).toEqual([3, 2]);
    expect(groups[0]).toMatchObject({ minY: 0, minZ: 0, maxX: 2 });
    expect(groups[1]).toMatchObject({ minZ: 1 });
  });

  it('moves to the next row across a layer boundary (gap rows are skipped naturally)', () => {
    const blocks = [
      b(0, 0, 0),
      b(0, 2, 0), // layer y=1 is empty
      b(0, 3, 5),
    ];
    const groups = groupSteps(blocks, { cap: 'row' });
    expect(groups.length).toBe(3);
    expect(groups.map((g) => g.minY)).toEqual([0, 2, 3]);
  });

  it('splits a very long row at ROW_CAP', () => {
    const blocks: BuildBlock[] = [];
    for (let x = 0; x < ROW_CAP + 10; x++) blocks.push(b(x, 0, 0));
    const groups = groupSteps(blocks, { cap: 'row' });
    expect(groups.length).toBe(2);
    expect(groups[0]!.count).toBe(ROW_CAP);
    expect(groups[1]!.count).toBe(10);
    expect(groups[1]!.first).toBe(ROW_CAP);
  });

  it('counts each block exactly once across rows and layers', () => {
    const blocks: BuildBlock[] = [];
    for (let y = 0; y < 4; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 7; x++) {
      if ((x + z + y) % 5 === 0) continue; // irregular holes
      blocks.push(b(x, y, z));
    }
    const groups = groupSteps(blocks, { cap: 'row' });
    expect(groups.reduce((a, g) => a + g.count, 0)).toBe(blocks.length);
    // monotone tiling
    let cursor = 0;
    for (const g of groups) {
      expect(g.first).toBe(cursor);
      cursor += g.count;
    }
    expect(cursor).toBe(blocks.length);
  });
});
