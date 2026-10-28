/**
 * Fixed tint table (phase 4b): grayscale vanilla textures get their
 * plains-biome / hardcoded-multiplier color — grass → 0x91BD59, foliage →
 * 0x77AB2F, redstone dust → 0xFF0000, water → 0x3F76E4 (overworld default), Birch/spruce leaves have fixed vanilla colors of their own.
 *
 * Applied as material color multiplier, so it tints the whole block, not
 * just its grayscale faces — documented approximation (README).
 */

const GRASS = 0x91bd59;
const FOLIAGE = 0x77ab2f;
/** Vanilla's hardcoded redstone tint (grayscale dust texture × red). */
const REDSTONE = 0xff0000;
/** Default overworld water colour (water_still is grayscale in the jar). */
const WATER = 0x3f76e4;

export const BIOME_TINTS: Record<string, number> = {
  'minecraft:redstone_wire': REDSTONE,
  'minecraft:water': WATER,
  'minecraft:bubble_column': WATER,
  'minecraft:kelp': WATER,
  'minecraft:seagrass': WATER,
  'minecraft:tall_seagrass': WATER,
  'minecraft:grass_block': GRASS,
  'minecraft:grass': GRASS,
  'minecraft:tall_grass': GRASS,
  'minecraft:fern': GRASS,
  'minecraft:large_fern': GRASS,
  'minecraft:sugar_cane': GRASS,
  'minecraft:oak_leaves': FOLIAGE,
  'minecraft:jungle_leaves': FOLIAGE,
  'minecraft:dark_oak_leaves': FOLIAGE,
  'minecraft:acacia_leaves': FOLIAGE,
  'minecraft:mangrove_leaves': FOLIAGE,
  'minecraft:cherry_leaves': 0xffffff, // not tinted in vanilla
  'minecraft:birch_leaves': 0x80a755,
  'minecraft:spruce_leaves': 0x619961,
  'minecraft:vine': FOLIAGE,
  'minecraft:lily_pad': FOLIAGE,
};

/** Tint for a palette entry (state suffix stripped), or null for none. */
export function tintForBlock(paletteEntry: string): number | null {
  const base = paletteEntry.split('[')[0]!.toLowerCase();
  return BIOME_TINTS[base] ?? null;
}
