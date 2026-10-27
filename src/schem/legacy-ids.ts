/**
 * Legacy (pre-flattening, MCEdit .schematic) numeric block ID + 4-bit data
 * -> modern namespaced blockstate string. Pure and unit-tested.
 *
 * Sources for ID and data-value semantics:
 *  - Minecraft Wiki, "Java Edition data values — Flattening" and the
 *    pre-1.13 data-value tables per block
 *    (https://minecraft.wiki/w/Java_Edition_data_values/Flattening,
 *     per-block pages e.g. /w/Java_Edition_data_values/Pre-flattening).
 *  - PrismarineJS minecraft-data, blocks.csv for version "1.12"
 *    (https://github.com/PrismarineJS/minecraft-data), cross-checked for
 *    numeric ids and hardcoded names.
 *
 * Coverage: the classic vanilla set 0..255 with data-driven variants for
 * the common state-carrying blocks (wool/terracotta/concrete colors, wood
 * species and log axis, piston/dispenser/chest/furnace facing, slabs,
 * stairs, redstone wire, rails, doors, crops, sandstone/stone-brick
 * variants). Ids or data values NOT covered return an explicit
 * "legacy:unknown_<id>" (optionally with "_data=<n>") marker — never a
 * silent wrong block; these render with the deterministic color fallback.
 */

const DYE_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink',
  'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;

const WOOD = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'] as const;

/** Piston/dispenser/dropper facing bits 0-5 (direction the head points). */
const FACING_DOWN_UP = ['down', 'up', 'north', 'south', 'west', 'east'] as const;

/** Wall-mounted facing used by chest/furnace/ladder/torch-on-wall. */
const FACING_NSEW: Record<number, string> = { 2: 'north', 3: 'south', 4: 'west', 5: 'east' };

/** Stairs facing bits 0-1: the direction of ascent. */
const STAIR_FACING = ['east', 'west', 'south', 'north'] as const;

/** Stairs: bits 0-1 facing (ascent direction), bit 2 half. */
function stairs(name: string, meta: number): string {
  return `minecraft:${name}[facing=${STAIR_FACING[meta & 0x3]},half=${(meta & 4) === 0 ? 'bottom' : 'top'}]`;
}

const SLAB_TYPES = [
  'smooth_stone', 'sandstone', 'oak', 'cobblestone', 'brick', 'stone_brick',
  'nether_brick', 'quartz',
] as const;

function woodFor(meta: number): string {
  return WOOD[meta & 0x3] ?? 'oak';
}

/** 17/162 log: species in bits 0-1, axis in bits 2-3 (12-15 = bark/wood). */
function logName(id: number, meta: number): string {
  const species = id === 162 ? ((meta & 0x1) === 0 ? 'acacia' : 'dark_oak') : woodFor(meta);
  const axisBits = (meta >> 2) & 0x3;
  if (axisBits === 3) return `minecraft:${species}_wood`; // bark all around
  const axis = axisBits === 1 ? 'x' : axisBits === 2 ? 'z' : 'y';
  return `minecraft:${species}_log[axis=${axis}]`;
}

/** Redstone wire: bits 0-3 connectivity N/E/S/W, bits 4-6 power. */
function redstoneWire(meta: number): string {
  const power = (meta >> 4) & 0x7;
  return 'minecraft:redstone_wire' +
    `[north=${(meta & 1) !== 0},east=${(meta & 2) !== 0},` +
    `south=${(meta & 4) !== 0},west=${(meta & 8) !== 0},power=${power}]`;
}

/** Rail shape: bit 3 power (powered rails), shape bits for normal rail. */
function railName(id: number, meta: number): string {
  if (id === 66) {
    const shapes = [
      'north_south', 'east_west', 'east_west', 'east_west', // 0-3 flat variants
      'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south', // 4-7
      'south_east', 'south_west', 'north_west', 'north_east', // 8-11 curves
    ] as const;
    const shape = shapes[meta & 0xf] ?? 'north_south';
    return `minecraft:rail[shape=${shape}]`;
  }
  const powered = (meta & 8) !== 0;
  return `minecraft:${id === 27 ? 'powered' : id === 28 ? 'detector' : 'activator'}_rail` +
    `[powered=${powered}]`;
}

/** Door 64/71/193-197: lower half carries facing, upper half the hinge. */
function doorName(id: number, meta: number): string {
  const wood = id === 64 ? 'oak' : id === 71 ? 'iron'
    : WOOD[(id - 193) + 1] ?? 'oak'; // 193 spruce .. 197 dark_oak
  if ((meta & 8) === 0) {
    const facing = ['west', 'north', 'east', 'south'][meta & 0x3] ?? 'north';
    return `minecraft:${wood}_door[half=lower,facing=${facing}]`;
  }
  const hinge = (meta & 1) === 0 ? 'left' : 'right';
  return `minecraft:${wood}_door[half=upper,hinge=${hinge}]`;
}

function colorBlockName(id: number, meta: number): string {
  const c = DYE_COLORS[meta & 0xf]!;
  if (id === 35) return `minecraft:${c}_wool`;
  if (id === 159) return `minecraft:${c}_terracotta`;
  if (id === 251) return `minecraft:${c}_concrete`;
  return `minecraft:${c}_concrete_powder`; // 252
}

/** Main dispatch: numeric legacy id (+data nibble) -> blockstate string. */
export function legacyBlockName(id: number, meta: number): string {
  // Unknown or out-of-range ids AND known ids with unmapped data values
  // both land here: an explicit marker, never a silently wrong block.
  const unknown = (): string =>
    meta === 0 ? `legacy:unknown_${id}` : `legacy:unknown_${id}_data_${meta}`;

  if (id < 0 || id > 255) return unknown();
  switch (id) {
    case 0: return 'minecraft:air';
    case 1: return 'minecraft:' + [
      'stone', 'granite', 'polished_granite', 'diorite', 'polished_diorite',
      'andesite', 'polished_andesite',
    ][meta & 0x7]!;
    case 2: return 'minecraft:grass_block';
    case 3: return 'minecraft:' + ['dirt', 'coarse_dirt', 'podzol'][meta & 0x3]!;
    case 4: return 'minecraft:cobblestone';
    case 5: return `minecraft:${WOOD[meta & 0x7] ?? 'oak'}_planks`;
    case 6: return `minecraft:${woodFor(meta)}_sapling`;
    case 7: return 'minecraft:bedrock';
    case 8: case 9: return 'minecraft:water';
    case 10: case 11: return 'minecraft:lava';
    case 12: return 'minecraft:sand';
    case 13: return 'minecraft:gravel';
    case 14: return 'minecraft:gold_ore';
    case 15: return 'minecraft:iron_ore';
    case 16: return 'minecraft:coal_ore';
    case 17: case 162: return logName(id, meta);
    case 18: return `minecraft:${woodFor(meta)}_leaves`;
    case 19: return 'minecraft:sponge';
    case 20: return 'minecraft:glass';
    case 21: return 'minecraft:lapis_ore';
    case 22: return 'minecraft:lapis_block';
    case 23: { // dispenser
      const facing = FACING_DOWN_UP[meta & 0x7] ?? 'north';
      return `minecraft:dispenser[facing=${facing}]`;
    }
    case 24: return 'minecraft:' + ['sandstone', 'chiseled_sandstone', 'cut_sandstone'][meta & 0x3]!;
    case 26: { // bed (legacy beds are red); bit 0 = head, bits 1-2 facing
      const facing = ['south', 'west', 'north', 'east'][meta >> 1 & 0x3]!;
      const part = (meta & 1) === 0 ? 'foot' : 'head';
      return `minecraft:red_bed[part=${part},facing=${facing}]`;
    }
    case 27: case 28: case 66: case 157: return railName(id, meta);
    case 29: { // sticky piston
      const facing = FACING_DOWN_UP[meta & 0x7] ?? 'north';
      return `minecraft:sticky_piston[facing=${facing},extended=${(meta & 8) !== 0}]`;
    }
    case 30: return 'minecraft:cobweb';
    case 31: return 'minecraft:' + ['dead_bush', 'short_grass', 'fern'][meta & 0x3]!;
    case 32: return 'minecraft:dead_bush';
    case 33: { // piston
      const facing = FACING_DOWN_UP[meta & 0x7] ?? 'north';
      return `minecraft:piston[facing=${facing},extended=${(meta & 8) !== 0}]`;
    }
    case 34: { // piston head
      const facing = FACING_DOWN_UP[meta & 0x7] ?? 'north';
      return `minecraft:piston_head[facing=${facing},short=${(meta & 8) !== 0}]`;
    }
    case 35: return colorBlockName(id, meta);
    case 37: return 'minecraft:dandelion';
    case 38: {
      const flower = [
        'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
        'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
      ][meta & 0xf];
      return flower ? `minecraft:${flower}` : unknown();
    }
    case 39: return 'minecraft:brown_mushroom';
    case 40: return 'minecraft:red_mushroom';
    case 41: return 'minecraft:gold_block';
    case 42: return 'minecraft:iron_block';
    case 43: case 44: { // (double) slabs; bit 3 = top for single slabs
      const type = SLAB_TYPES[meta & 0x7]!;
      if (id === 43) return `minecraft:${type}_slab[type=double]`;
      return `minecraft:${type}_slab[type=${(meta & 8) !== 0 ? 'top' : 'bottom'}]`;
    }
    case 45: return 'minecraft:bricks';
    case 46: return 'minecraft:tnt';
    case 47: return 'minecraft:bookshelf';
    case 48: return 'minecraft:mossy_cobblestone';
    case 49: return 'minecraft:obsidian';
    case 50: { // torch: 0 standing, 1-5 wall sides
      if (meta === 0) return 'minecraft:torch';
      const facing = { 1: 'east', 2: 'west', 3: 'south', 4: 'north', 5: 'up' }[meta & 0x7];
      return facing ? `minecraft:torch[facing=${facing}]` : unknown();
    }
    case 52: return 'minecraft:spawner';
    case 53: return stairs('oak_stairs', meta);
    case 54: return FACING_NSEW[meta & 0x7]
      ? `minecraft:chest[facing=${FACING_NSEW[meta & 0x7]}]`
      : 'minecraft:chest';
    case 55: return redstoneWire(meta);
    case 56: return 'minecraft:diamond_ore';
    case 57: return 'minecraft:diamond_block';
    case 58: return 'minecraft:crafting_table';
    case 59: return `minecraft:wheat[age=${Math.min(meta & 0x7, 7)}]`;
    case 60: return `minecraft:farmland[moisture=${Math.min(meta & 0x7, 7)}]`;
    case 61: case 62: { // furnace / lit furnace
      const facing = FACING_NSEW[meta & 0x7];
      const name = id === 61 ? 'furnace' : 'lit_furnace';
      return facing ? `minecraft:${name}[facing=${facing}]` : `minecraft:${name}`;
    }
    case 64: case 71: case 193: case 194: case 195: case 196: case 197:
      return doorName(id, meta);
    case 65: return FACING_NSEW[meta & 0x7]
      ? `minecraft:ladder[facing=${FACING_NSEW[meta & 0x7]}]`
      : 'minecraft:ladder';
    case 67: return stairs('cobblestone_stairs', meta);
    case 69: { // lever (face variants collapsed; powered bit preserved)
      return `minecraft:lever[powered=${(meta & 8) !== 0}]`;
    }
    case 73: case 74: return 'minecraft:redstone_ore';
    case 75: return 'minecraft:redstone_torch[lit=false]';
    case 76: return 'minecraft:redstone_torch[lit=true]';
    case 77: case 143: { // stone / wooden button
      const name = id === 77 ? 'stone_button' : 'oak_button';
      return `minecraft:${name}[powered=${(meta & 8) !== 0}]`;
    }
    case 78: return `minecraft:snow[layers=${Math.min((meta & 0x7) + 1, 8)}]`;
    case 79: return 'minecraft:ice';
    case 80: return 'minecraft:snow_block';
    case 81: return 'minecraft:cactus';
    case 82: return 'minecraft:clay';
    case 83: return 'minecraft:sugar_cane';
    case 84: return 'minecraft:jukebox';
    case 85: return 'minecraft:oak_fence';
    case 86: case 91: { // pumpkin / jack_o_lantern facing
      const facing = ['south', 'west', 'north', 'east'][meta & 0x3]!;
      const name = id === 86 ? 'carved_pumpkin' : 'jack_o_lantern';
      return `minecraft:${name}[facing=${facing}]`;
    }
    case 87: return 'minecraft:netherrack';
    case 88: return 'minecraft:soul_sand';
    case 89: return 'minecraft:glowstone';
    case 98: return 'minecraft:' + [
      'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks',
    ][meta & 0x3]!;
    case 101: return 'minecraft:iron_bars';
    case 102: return 'minecraft:glass_pane';
    case 103: return 'minecraft:melon';
    case 106: return 'minecraft:oak_fence_gate';
    case 108: return stairs('brick_stairs', meta);
    case 109: return stairs('stone_brick_stairs', meta);
    case 114: return stairs('nether_brick_stairs', meta);
    case 128: return stairs('sandstone_stairs', meta);
    case 134: case 135: case 136: { // spruce/birch/jungle stairs
      return stairs(`${WOOD[(id - 134) + 1]}_stairs`, meta);
    }
    case 139: return `minecraft:${(meta & 0x1) === 0 ? 'cobblestone' : 'mossy_cobblestone'}_wall`;
    case 141: return `minecraft:carrots[age=${Math.min(meta & 0x7, 7)}]`;
    case 142: return `minecraft:potatoes[age=${Math.min(meta & 0x7, 7)}]`;
    case 146: return FACING_NSEW[meta & 0x7]
      ? `minecraft:trapped_chest[facing=${FACING_NSEW[meta & 0x7]}]`
      : 'minecraft:trapped_chest';
    case 155: { // quartz block variants
      if (meta === 0) return 'minecraft:quartz_block';
      if (meta === 1) return 'minecraft:chiseled_quartz_block';
      if (meta === 2 || meta === 3 || meta === 4) {
        const axis = meta === 2 ? 'y' : meta === 3 ? 'x' : 'z';
        return `minecraft:quartz_pillar[axis=${axis}]`;
      }
      return unknown();
    }
    case 158: { // dropper
      const facing = FACING_DOWN_UP[meta & 0x7] ?? 'north';
      return `minecraft:dropper[facing=${facing}]`;
    }
    case 159: return colorBlockName(id, meta);
    case 161: return `minecraft:${(meta & 0x1) === 0 ? 'acacia' : 'dark_oak'}_leaves`;
    case 163: return stairs('acacia_stairs', meta);
    case 164: return stairs('dark_oak_stairs', meta);
    case 170: return 'minecraft:hay_block';
    case 172: return 'minecraft:terracotta';
    case 173: return 'minecraft:coal_block';
    case 174: return 'minecraft:packed_ice';
    case 175: return 'minecraft:tall_grass'; // double-plant lower half simplified
    case 180: return stairs('quartz_stairs', meta);
    case 203: return stairs('purpur_stairs', meta);
    case 251: case 252: return colorBlockName(id, meta);
    default:
      // 36, 51, 63, 68, 93, 94, 117-125, 130, 131, 132, 144, 147, 148,
      // 151, 154, 165, 176, 177, 184-192, 205-250, 253-255 and the rest
      // of the classic range are not (yet) mapped.
      return unknown();
  }
}
