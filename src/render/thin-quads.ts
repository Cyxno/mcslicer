/**
 * Thin-quad mapping (phase 4h, part E) — pure and unit-tested.
 *
 * A full cube is the wrong shape for known-flat types (the "black hoppers"
 * violation): rails, redstone wire, torches and levers render as a thin
 * flat slab or a two-sided vertical plane at the right height and
 * orientation, read from the palette blockstate string. This is a
 * voorproefje on 4i (full model geometry), not a replacement: every type
 * not listed here keeps rendering as a full cube.
 *
 * All heights are in blocks; yaw 0 means "along the z axis" (north-south),
 * matching Minecraft's shape names.
 */

export interface ThinQuadSpec {
  kind: 'flat' | 'vertical';
  /** Centre height of the quad inside the block, in blocks. */
  y: number;
  /** flat: yaw in radians (0 = along z, π/2 = along x). */
  rotY: number;
  /** vertical: horizontal direction the quad faces (unit vector). */
  normal: { x: number; z: number };
  /** vertical: offset from the block centre towards the wall, in blocks. */
  offset: number;
}

/** Parse "minecraft:x[a=1,b=2]" → { a: "1", b: "2" }. */
export function blockstateProps(entry: string): Record<string, string> {
  const i = entry.indexOf('[');
  if (i < 0) return {};
  const body = entry.slice(i + 1, entry.endsWith(']') ? -1 : undefined);
  const props: Record<string, string> = {};
  for (const pair of body.split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) props[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return props;
}

function baseName(entry: string): string {
  const noNs = entry.startsWith('minecraft:') ? entry.slice('minecraft:'.length) : entry;
  return noNs.split('[')[0]!;
}

const HALF_PI = Math.PI / 2;

/** Rail slope shapes get their horizontal yaw only (voorproefje: no tilt). */
const RAIL_SHAPE_YAW: Record<string, number> = {
  north_south: 0,
  east_west: HALF_PI,
  ascending_north: 0,
  ascending_south: 0,
  ascending_east: HALF_PI,
  ascending_west: HALF_PI,
};

/** Facing (the direction a wall-mounted thing points) → its plane normal. */
const FACING_NORMAL: Record<string, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 },
  east: { x: 1, z: 0 },
};

const FLAT = (y: number, rotY = 0): ThinQuadSpec => ({ kind: 'flat', y, rotY, normal: { x: 0, z: 1 }, offset: 0 });

/**
 * Thin-quad spec for a palette entry, or null when the type renders as a
 * full cube. Pure: entry string in, geometry intent out.
 */
export function thinQuadFor(entry: string): ThinQuadSpec | null {
  const base = baseName(entry);
  const props = blockstateProps(entry);
  if (base === 'rail' || base.endsWith('_rail')) {
    const yaw = RAIL_SHAPE_YAW[props.shape ?? 'north_south'];
    if (yaw === undefined) return FLAT(1 / 16, 0); // unknown shape: flat, unrotated
    return FLAT(1 / 16, yaw);
  }
  if (base === 'redstone_wire') return FLAT(1 / 32);
  if (base === 'torch' || base === 'redstone_torch' || base === 'soul_torch') {
    // Standing torch: one two-sided vertical cross through the block centre.
    return { kind: 'vertical', y: 0.5, rotY: 0, normal: { x: 1, z: 0 }, offset: 0 };
  }
  if (base === 'wall_torch' || base === 'redstone_wall_torch' || base === 'soul_wall_torch') {
    const normal = FACING_NORMAL[props.facing ?? 'north'] ?? FACING_NORMAL.north!;
    return { kind: 'vertical', y: 0.6, rotY: 0, normal, offset: 0.28 };
  }
  if (base === 'lever') {
    const face = props.face ?? 'floor';
    if (face === 'ceiling') return FLAT(0.95);
    if (face === 'wall') {
      const normal = FACING_NORMAL[props.facing ?? 'north'] ?? FACING_NORMAL.north!;
      return { kind: 'vertical', y: 0.5, rotY: 0, normal, offset: 0.35 };
    }
    return FLAT(0.05);
  }
  return null;
}
