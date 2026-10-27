/**
 * Layer-dim semantics (phase 4e, B3) — pure and unit-tested.
 *
 * Cumulative mode replaces the old fixed dim factor with a depth
 * gradient: layers just above the active one stay near-fully visible,
 * deeper layers fade linearly to the floor over FADE_RANGE layers —
 * orientation without the harsh binary cut. Isolate mode keeps the
 * dim-of-rest but the active layer is drawn full (the Viewer adds a
 * subtle emissive lift on top, a visual choice).
 */
import type { SliceMode } from './steps.js';

export const LAYER_FADE_MIN = 0.28;
export const LAYER_FADE_RANGE = 5;

export interface LayerFadeOptions {
  /** Floor the gradient fades towards (the old fixed dim factor). */
  min: number;
  /** How many layers the linear fade spans. */
  range: number;
}

/**
 * Brightness factor for a layer `distance` below the active one
 * (distance <= 0 means the active layer itself or above).
 * Monotonically non-increasing in distance; f(0) = 1 in both modes.
 */
export function layerOpacity(
  distance: number,
  mode: SliceMode,
  opts: LayerFadeOptions = { min: LAYER_FADE_MIN, range: LAYER_FADE_RANGE },
): number {
  if (distance <= 0) return 1;
  if (mode === 'isolate') return opts.min;
  const t = Math.min(Math.max(distance, 0) / opts.range, 1);
  return 1 - (1 - opts.min) * t;
}
