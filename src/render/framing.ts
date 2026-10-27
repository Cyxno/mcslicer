/**
 * Step framing (phase 4e, part C) — pure and unit-tested.
 *
 * "Volg stap": when stepping, the camera target glides to a framing of
 * the current step. The framing itself is just the block center in world
 * space; existing zoom and orbit orientation are preserved by the Viewer
 * (it shifts camera and target by the same delta and animates the glide —
 * a visual choice, verified in the browser).
 */
import type { Schematic } from '../schem/types.js';
import { blockCenterLocal, localToWorld, modelMatrix } from './transform.js';

/** World-space point the camera should center on for this step. */
export function framingForStep(
  step: { x: number; y: number; z: number },
  bounds: Schematic['size'],
): { x: number; y: number; z: number } {
  const world = localToWorld(modelMatrix(bounds), blockCenterLocal(step));
  return { x: world.x, y: world.y, z: world.z };
}
