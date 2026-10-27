import { parsePaletteEntry } from '../textures/atlas.js';

/**
 * Pure mapping logic behind raycast picking (phase 4b): from a palette
 * entry + instance position + build-wide total to the fields the info
 * panel shows. The raycasting itself is browser-side and visually
 * verified; everything decided here is unit-tested.
 */

export interface BlockInfo {
  /** Short display name, namespace and state stripped. */
  name: string;
  /** Full palette entry verbatim ("minecraft:furnace[facing=north,…]"). */
  id: string;
  /** State properties in palette-string order. */
  props: [string, string][];
  /** Block position in schematic coordinates. */
  x: number;
  y: number;
  z: number;
  /** Occurrences of this type in the whole build. */
  total: number;
}

export function blockInfo(
  paletteEntry: string,
  pos: { x: number; y: number; z: number },
  total: number,
): BlockInfo {
  const { base, props } = parsePaletteEntry(paletteEntry);
  return {
    name: base,
    id: paletteEntry,
    props: Object.entries(props),
    x: pos.x,
    y: pos.y,
    z: pos.z,
    total,
  };
}

/** Toggle a value in a set-copy; returns whether it is now present. */
export function toggleValue<T>(set: ReadonlySet<T>, value: T): { next: Set<T>; present: boolean } {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return { next, present: next.has(value) };
}

/**
 * Pointer event (client CSS pixels) → normalized device coordinates
 * [-1, 1] for Raycaster.setFromCamera. `dpr` is the renderer pixelRatio:
 * event and rect both live in CSS pixels, so the drawingbuffer scale
 * cancels — the explicit parameter documents and tests that invariance
 * (dpr != 1 must give identical NDC, never an offset).
 */
export function pointerToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  dpr = 1,
): { x: number; y: number } {
  // Compute in drawingbuffer pixels (client * dpr) so DPR-independence is
  // explicit rather than accidental.
  const px = (clientX - rect.left) * dpr;
  const py = (clientY - rect.top) * dpr;
  const w = Math.max(rect.width * dpr, 1);
  const h = Math.max(rect.height * dpr, 1);
  return { x: (px / w) * 2 - 1, y: -(py / h) * 2 + 1 };
}

/** Flat block index → schematic coordinates (Sponge yzx order). */
export function flatToCoords(
  flat: number,
  size: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const y = Math.floor(flat / (size.z * size.x));
  const rem = flat - y * size.z * size.x;
  const z = Math.floor(rem / size.x);
  const x = rem - z * size.x;
  return { x, y, z };
}
