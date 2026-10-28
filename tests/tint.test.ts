import { describe, expect, it } from 'vitest';
import { BIOME_TINTS, tintForBlock } from '../src/textures/tint.js';

describe('biome tint table (fixed plains values)', () => {
  it('maps grass and foliage families, state suffix stripped', () => {
    expect(tintForBlock('minecraft:grass_block[snowy=false]')).toBe(0x91bd59);
    expect(tintForBlock('minecraft:grass_block')).toBe(0x91bd59);
    expect(tintForBlock('minecraft:oak_leaves')).toBe(0x77ab2f);
    expect(tintForBlock('minecraft:birch_leaves')).toBe(0x80a755);
    expect(tintForBlock('minecraft:spruce_leaves')).toBe(0x619961);
    expect(tintForBlock('minecraft:cherry_leaves')).toBe(0xffffff);
  });

  it('tints grayscale non-biome textures: redstone dust red, water blue', () => {
    // redstone_wire renders grayscale in the jar; vanilla multiplies a
    // hardcoded red. Without this the dust renders black/white.
    expect(tintForBlock('minecraft:redstone_wire[east=none,north=side,south=side,west=up]')).toBe(0xff0000);
    expect(tintForBlock('minecraft:water[level=0]')).toBe(0x3f76e4);
    expect(tintForBlock('minecraft:bubble_column')).toBe(0x3f76e4);
  });

  it('returns null for untinted blocks and unknown ids', () => {
    expect(tintForBlock('minecraft:stone')).toBeNull();
    expect(tintForBlock('minecraft:furnace[facing=north,lit=true]')).toBeNull();
    expect(tintForBlock('')).toBeNull();
  });

  it('is explicit: every table entry is reachable via tintForBlock', () => {
    for (const [id, tint] of Object.entries(BIOME_TINTS)) {
      expect(tintForBlock(id)).toBe(tint);
    }
  });
});
