import { describe, expect, it } from 'vitest';
import { exploreParams } from '../src/render/explore.js';

describe('exploreParams', () => {
  it('scales speed with model size and keeps a wide fov', () => {
    const hut = exploreParams({ x: 8, y: 6, z: 8 });
    const market = exploreParams({ x: 42, y: 10, z: 13 });
    const huge = exploreParams({ x: 200, y: 40, z: 200 });
    expect(hut.moveSpeed).toBeGreaterThan(0);
    expect(market.moveSpeed).toBeGreaterThan(hut.moveSpeed);
    expect(huge.moveSpeed).toBeGreaterThan(market.moveSpeed);
    expect(hut.fov).toBe(70);
  });

  it('is clamped both ways and deterministic', () => {
    expect(exploreParams({ x: 1, y: 1, z: 1 }).moveSpeed).toBe(1.5);
    expect(exploreParams({ x: 10000, y: 10, z: 10000 }).moveSpeed).toBe(60);
    expect(exploreParams({ x: 42, y: 10, z: 13 })).toEqual(exploreParams({ x: 42, y: 10, z: 13 }));
  });

  it('is monotone in each axis', () => {
    const base = exploreParams({ x: 10, y: 10, z: 10 }).moveSpeed;
    expect(exploreParams({ x: 11, y: 10, z: 10 }).moveSpeed).toBeGreaterThan(base);
    expect(exploreParams({ x: 10, y: 11, z: 10 }).moveSpeed).toBeGreaterThan(base);
    expect(exploreParams({ x: 10, y: 10, z: 11 }).moveSpeed).toBeGreaterThan(base);
  });
});
