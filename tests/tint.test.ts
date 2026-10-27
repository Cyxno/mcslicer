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
