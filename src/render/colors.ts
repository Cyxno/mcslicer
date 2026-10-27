/**
 * Block-id → color table for the viewer.
 *
 * Extendable: add entries here for better fidelity; anything unknown falls
 * back to a deterministic color derived from the block id, so new blocks
 * never render invisibly.
 */

/** Base table, inspired by vanilla block colors (hex numbers, 0xRRGGBB). */
export const BLOCK_COLORS: Record<string, number> = {
  'minecraft:air': 0x000000,
  'minecraft:stone': 0x7f7f7f,
  'minecraft:cobblestone': 0x8a8a8a,
  'minecraft:deepslate': 0x4b4b52,
  'minecraft:dirt': 0x866043,
  'minecraft:grass_block': 0x7cbd6b,
  'minecraft:sand': 0xdbd3a0,
  'minecraft:gravel': 0x8e8c88,
  'minecraft:oak_planks': 0xb8945f,
  'minecraft:spruce_planks': 0x7a5a35,
  'minecraft:birch_planks': 0xd7cb8d,
  'minecraft:dark_oak_planks': 0x4f3218,
  'minecraft:oak_log': 0x6e5530,
  'minecraft:spruce_log': 0x3b2a17,
  'minecraft:glass': 0xc8e8f0,
  'minecraft:bricks': 0x96604a,
  'minecraft:stone_bricks': 0x7a7a7a,
  'minecraft:obsidian': 0x150c1e,
  'minecraft:white_concrete': 0xe6e9e9,
  'minecraft:black_concrete': 0x0d0f12,
  'minecraft:red_concrete': 0xa12722,
  'minecraft:blue_concrete': 0x2c2e8f,
  'minecraft:green_concrete': 0x546d1b,
  'minecraft:iron_block': 0xd8d8d8,
  'minecraft:gold_block': 0xf9ec4e,
  'minecraft:diamond_block': 0x4aedd9,
  'minecraft:glowstone': 0xf9d49a,
  'minecraft:water': 0x3f76e4,
  'minecraft:lava': 0xd45a12,
};

const FALLBACK_SATURATION = 0.35;
const FALLBACK_LIGHTNESS = 0.55;

/**
 * Deterministic fallback: hash the block id to a stable hue so an unmapped
 * block still gets a distinct, repeatable color.
 */
export function fallbackColor(blockId: string): number {
  let hash = 0;
  for (let i = 0; i < blockId.length; i++) {
    hash = (hash * 31 + blockId.charCodeAt(i)) >>> 0;
  }
  const hue = (hash % 360) / 360;
  // hsl → rgb (s = FALLBACK_SATURATION, l = FALLBACK_LIGHTNESS)
  const q = FALLBACK_LIGHTNESS * (1 + FALLBACK_SATURATION);
  const p = 2 * FALLBACK_LIGHTNESS - q;
  const channel = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const r = Math.round(channel(hue + 1 / 3) * 255);
  const g = Math.round(channel(hue) * 255);
  const b = Math.round(channel(hue - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
}

export function colorForBlock(blockId: string): number {
  return BLOCK_COLORS[blockId] ?? fallbackColor(blockId);
}
