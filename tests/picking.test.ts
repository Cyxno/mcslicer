import { describe, expect, it } from 'vitest';
import { blockInfo, flatToCoords, pointerToNdc, toggleValue } from '../src/render/picking.js';

describe('blockInfo', () => {
  it('splits name, properties, position and total', () => {
    const info = blockInfo('minecraft:furnace[facing=north,lit=true]', { x: 3, y: 5, z: 2 }, 64);
    expect(info).toEqual({
      name: 'furnace',
      id: 'minecraft:furnace[facing=north,lit=true]',
      props: [
        ['facing', 'north'],
        ['lit', 'true'],
      ],
      x: 3,
      y: 5,
      z: 2,
      total: 64,
    });
  });

  it('handles blocks without state properties', () => {
    const info = blockInfo('minecraft:smooth_stone', { x: 0, y: 0, z: 0 }, 1);
    expect(info.name).toBe('smooth_stone');
    expect(info.props).toEqual([]);
  });
});

describe('toggleValue', () => {
  it('adds and removes without mutating the input set', () => {
    const base = new Set([1, 2]);
    const added = toggleValue(base, 3);
    expect(added.present).toBe(true);
    expect(added.next.has(3)).toBe(true);
    expect(base.has(3)).toBe(false);
    const removed = toggleValue(base, 2);
    expect(removed.present).toBe(false);
    expect(base.has(2)).toBe(true);
  });
});

describe('flatToCoords', () => {
  it('round-trips Sponge yzx order', () => {
    const size = { x: 4, y: 3, z: 5 };
    for (let y = 0; y < size.y; y++) {
      for (let z = 0; z < size.z; z++) {
        for (let x = 0; x < size.x; x++) {
          const flat = (y * size.z + z) * size.x + x;
          expect(flatToCoords(flat, size)).toEqual({ x, y, z });
        }
      }
    }
  });
});

describe('pointerToNdc', () => {
  const rect = { left: 100, top: 50, width: 800, height: 600 };

  it('maps corners to ±1', () => {
    expect(pointerToNdc(100, 50, rect, 1)).toEqual({ x: -1, y: 1 }); // top-left
    expect(pointerToNdc(900, 650, rect, 1)).toEqual({ x: 1, y: -1 }); // bottom-right
    expect(pointerToNdc(500, 350, rect, 1)).toEqual({ x: 0, y: 0 }); // center
  });

  it('is DPR-invariant (dpr 1, 1.5, 2 give identical NDC)', () => {
    const client = { x: 617.3, y: 211.7 };
    const base = pointerToNdc(client.x, client.y, rect, 1);
    for (const dpr of [1.5, 2, 3]) {
      const scaled = pointerToNdc(client.x, client.y, rect, dpr);
      expect(scaled.x).toBeCloseTo(base.x, 12);
      expect(scaled.y).toBeCloseTo(base.y, 12);
    }
  });

  it('clamps nothing but stays in range for in-canvas points', () => {
    const ndc = pointerToNdc(150, 100, rect, 2);
    expect(ndc.x).toBeGreaterThan(-1);
    expect(ndc.x).toBeLessThan(1);
    expect(ndc.y).toBeGreaterThan(-1);
    expect(ndc.y).toBeLessThan(1);
  });
});
