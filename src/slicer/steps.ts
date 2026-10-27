import { isAir, type Schematic } from '../schem/types.js';

/**
 * Pure slicer model: every non-air block as exactly one ordered step,
 * grouped into slices perpendicular to a chosen axis. Shulkr-slicer parity
 * lives on top of this; the UI holds no ordering logic.
 */
export type Axis = 'x' | 'y' | 'z';

export interface SlicerStep {
  index: number;
  x: number;
  y: number;
  z: number;
  slice: number; // coord on the chosen axis
  paletteIndex: number;
  block: string;
}

export interface SlicerSlice {
  coord: number;
  /** Index of the first step in this slice. */
  firstStep: number;
  count: number;
}

export interface SlicerModel {
  axis: Axis;
  steps: SlicerStep[];
  slices: SlicerSlice[];
  total: number;
}

/** Remaining axes in deterministic scan order, e.g. 'y' → z then x
 * (matching phase-1 layersToSteps). */
export function secondaryAxes(axis: Axis): [Axis, Axis] {
  switch (axis) {
    case 'x': return ['y', 'z'];
    case 'y': return ['z', 'x'];
    case 'z': return ['x', 'y'];
  }
}

/**
 * Build the model. Deterministic: slices ascend on the axis; within a slice
 * blocks scan row-major over the two secondary axes.
 */
export function buildSlicerModel(schem: Schematic, axis: Axis = 'y'): SlicerModel {
  const size = { x: schem.size.x, y: schem.size.y, z: schem.size.z };
  const [mid, inner] = secondaryAxes(axis);
  const dim = { x: size.x, y: size.y, z: size.z };
  const steps: SlicerStep[] = [];
  const slices: SlicerSlice[] = [];

  for (let s = 0; s < dim[axis]; s++) {
    const firstStep = steps.length;
    for (let m = 0; m < dim[mid]; m++) {
      for (let i = 0; i < dim[inner]; i++) {
        const coord = { x: 0, y: 0, z: 0 };
        coord[axis] = s;
        coord[mid] = m;
        coord[inner] = i;
        const flat = (coord.y * size.z + coord.z) * size.x + coord.x;
        const paletteIndex = schem.blocks[flat]!;
        const block = schem.palette[paletteIndex]!;
        if (isAir(block)) continue;
        steps.push({ index: steps.length, x: coord.x, y: coord.y, z: coord.z, slice: s, paletteIndex, block });
      }
    }
    if (steps.length > firstStep) {
      slices.push({ coord: s, firstStep, count: steps.length - firstStep });
    }
  }

  return { axis, steps, slices, total: steps.length };
}

export interface SlicerState {
  /** 0-based step index, always within 0..model.total-1. */
  step: number;
}

export function initialState(): SlicerState {
  return { step: 0 };
}

export function clampStep(model: SlicerModel, step: number): SlicerState {
  if (model.total === 0) return { step: 0 };
  return { step: Math.min(Math.max(step, 0), model.total - 1) };
}

export function nextStep(model: SlicerModel, state: SlicerState): SlicerState {
  return clampStep(model, state.step + 1);
}

export function prevStep(model: SlicerModel, state: SlicerState): SlicerState {
  return clampStep(model, state.step - 1);
}

export function jumpTo(model: SlicerModel, state: SlicerState, step: number): SlicerState {
  return clampStep(model, step);
}

/** The slice coord a step lives in (steps carry it; slices are a view). */
export function currentStep(model: SlicerModel, state: SlicerState): SlicerStep | undefined {
  return model.total === 0 ? undefined : model.steps[state.step];
}

export function currentSlice(model: SlicerModel, state: SlicerState): SlicerSlice | undefined {
  const step = currentStep(model, state);
  if (!step) return undefined;
  // Slices are sorted by coord and steps are grouped, so the slice holding
  // step.index is found via firstStep <= index.
  let lo = 0;
  let hi = model.slices.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (model.slices[mid]!.firstStep <= step.index) lo = mid;
    else hi = mid - 1;
  }
  return model.slices[lo];
}

/** "stap k van n (laag y=3)" — 1-based k, as displayed. */
export function progressLabel(model: SlicerModel, state: SlicerState): string {
  if (model.total === 0) return 'geen blocks';
  const slice = currentSlice(model, state);
  const axisName = model.axis;
  return `stap ${state.step + 1} van ${model.total} (laag ${axisName}=${slice?.coord})`;
}

/**
 * Slice display semantics. "cumulative" (default, build use) shows
 * everything up to and including the current layer — the build as it
 * stands at that height; "isolate" shows only the current layer.
 */
export type SliceMode = 'cumulative' | 'isolate';

export function sliceVisible(sliceCoord: number, current: number, mode: SliceMode): boolean {
  if (current < 0) return true; // no slice chosen yet: show the whole build
  return mode === 'isolate' ? sliceCoord === current : sliceCoord <= current;
}
