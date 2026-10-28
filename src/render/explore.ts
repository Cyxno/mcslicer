/**
 * Explore-mode parameters (phase 4h, part F) — pure and unit-tested.
 *
 * Movement speed and field of view scale with the model size so a 8-block
 * hut and a 200-block market both fly comfortably: slow enough for the
 * hut, fast enough to cross the market in a few seconds.
 */

export interface ExploreParams {
  /** Movement speed in blocks per second (at 1× sprint factor). */
  moveSpeed: number;
  /** Perspective field of view, degrees. */
  fov: number;
}

/**
 * Diagonal in blocks → explore parameters. Monotone in size, clamped so
 * tiny models stay navigable and huge ones don't get uncontrollable.
 */
export function exploreParams(size: { x: number; y: number; z: number }): ExploreParams {
  const diag = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
  const moveSpeed = Math.min(Math.max(diag / 6, 1.5), 60);
  return { moveSpeed, fov: 70 };
}
