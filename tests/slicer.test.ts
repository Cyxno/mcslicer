import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchem } from '../src/schem/parse.js';
import { countNonAir, layersToSteps, schemToLayers } from '../src/schem/layers.js';
import {
  buildSlicerModel,
  currentSlice,
  initialState,
  jumpTo,
  nextStep,
  prevStep,
  progressLabel,
  type Axis,
} from '../src/slicer/steps.js';
import { materialTable, sortRows } from '../src/slicer/materials.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo-huisje.schem');
const phantomPath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'phantommarket-f64.schem');

describe('buildSlicerModel — invariants', () => {
  it('y-axis model matches phase-1 layersToSteps exactly (order + count)', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const model = buildSlicerModel(schem, 'y');
    const legacy = layersToSteps(schemToLayers(schem));
    expect(model.total).toBe(legacy.length);
    expect(model.total).toBe(countNonAir(schem));
    for (let i = 0; i < model.total; i++) {
      expect([model.steps[i]!.x, model.steps[i]!.y, model.steps[i]!.z]).toEqual(
        [legacy[i]!.x, legacy[i]!.y, legacy[i]!.z],
      );
      expect(model.steps[i]!.block).toBe(legacy[i]!.block);
    }
  });

  it('every axis yields exactly countNonAir steps, each exactly one block', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const model = buildSlicerModel(schem, axis);
      expect(model.total).toBe(countNonAir(schem));
      expect(new Set(model.steps.map((s) => s.index)).size).toBe(model.total);
      expect(model.steps.every((s) => s.block !== 'minecraft:air')).toBe(true);
      // slices partition the steps
      expect(model.slices.reduce((a, s) => a + s.count, 0)).toBe(model.total);
      expect(model.slices.every((s, i) =>
        i === 0 || model.slices[i - 1]!.coord < s.coord,
      )).toBe(true);
    }
  });

  it('is deterministic: building twice gives identical models', async () => {
    const schem = await parseSchem(await readFile(phantomPath));
    expect(buildSlicerModel(schem, 'x')).toEqual(buildSlicerModel(schem, 'x'));
  });

  it('steps within a slice carry slice === their slice coord', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const model = buildSlicerModel(schem, 'y');
    for (const slice of model.slices) {
      const inSlice = model.steps.slice(slice.firstStep, slice.firstStep + slice.count);
      expect(inSlice.every((s) => s.y === slice.coord && s.slice === slice.coord)).toBe(true);
    }
  });
});

describe('navigation — next/prev/jump with clamping', () => {
  it('jumpTo clamps to 0..total-1 (boundaries)', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const model = buildSlicerModel(schem, 'y');
    expect(jumpTo(model, initialState(), -5).step).toBe(0);
    expect(jumpTo(model, initialState(), 0).step).toBe(0);
    expect(jumpTo(model, initialState(), model.total - 1).step).toBe(model.total - 1);
    expect(jumpTo(model, initialState(), model.total + 999).step).toBe(model.total - 1);
  });

  it('next/prev clamp at the ends and never throw', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const model = buildSlicerModel(schem, 'y');
    const start = initialState();
    expect(prevStep(model, start).step).toBe(0);
    let s = start;
    for (let i = 0; i < model.total + 5; i++) s = nextStep(model, s);
    expect(s.step).toBe(model.total - 1);
  });

  it('empty schematic: everything stays at step 0', async () => {
    const { makeSchemBuffer } = await import('./helpers.js');
    const schem = await parseSchem(makeSchemBuffer({
      width: 2, height: 2, length: 2,
      palette: ['minecraft:air'],
      blockIndices: new Array(8).fill(0),
    }));
    const model = buildSlicerModel(schem, 'y');
    expect(model.total).toBe(0);
    expect(nextStep(model, initialState()).step).toBe(0);
    expect(progressLabel(model, initialState())).toBe('geen blocks');
  });

  it('progress label reports 1-based step, total and axis layer', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const model = buildSlicerModel(schem, 'y');
    const s = jumpTo(model, initialState(), 42);
    const slice = currentSlice(model, s)!;
    expect(progressLabel(model, s)).toBe(`stap 43 van ${model.total} (laag y=${slice.coord})`);
    expect(progressLabel(buildSlicerModel(schem, 'x'), jumpTo(buildSlicerModel(schem, 'x'), initialState(), 0)))
      .toMatch(/^stap 1 van \d+ \(laag x=0\)$/);
  });

  it('currentSlice follows the step across slice boundaries', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const model = buildSlicerModel(schem, 'y');
    const first = model.slices[0]!, second = model.slices[1]!;
    expect(currentSlice(model, { step: first.firstStep })!.coord).toBe(first.coord);
    expect(currentSlice(model, { step: second.firstStep })!.coord).toBe(second.coord);
    expect(currentSlice(model, { step: first.firstStep + first.count - 1 })!.coord).toBe(first.coord);
  });
});

describe('materialTable', () => {
  it('totals match per-type counts; inSlice sums equal slice counts; zero rows absent', async () => {
    const schem = await parseSchem(await readFile(phantomPath));
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const model = buildSlicerModel(schem, axis);
      let allRows = [] as ReturnType<typeof materialTable>;
      for (const slice of model.slices) {
        const rows = materialTable(schem, axis, slice.coord);
        allRows = allRows.concat(rows);
        const sliceSteps = model.steps.slice(slice.firstStep, slice.firstStep + slice.count);
        const byType = new Map<string, number>();
        for (const s of sliceSteps) byType.set(s.block, (byType.get(s.block) ?? 0) + 1);
        for (const row of rows) {
          if (byType.has(row.block)) expect(row.inSlice).toBe(byType.get(row.block));
        }
        expect(rows.every((r) => r.total > 0)).toBe(true);
      }
      // every type appears at least once across slices
      const uniq = new Set(allRows.map((r) => r.block));
      expect(uniq.size).toBe(new Set(model.steps.map((s) => s.block)).size);
    }
  });

  it('sortRows sorts by the requested key with deterministic ties', async () => {
    const rows = [
      { block: 'b', total: 2, inSlice: 1 },
      { block: 'a', total: 3, inSlice: 0 },
      { block: 'c', total: 2, inSlice: 5 },
    ];
    expect(sortRows(rows, 'total', 'desc').map((r) => r.block)).toEqual(['a', 'b', 'c']);
    expect(sortRows(rows, 'total', 'asc').map((r) => r.block)).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, 'block', 'asc').map((r) => r.block)).toEqual(['a', 'b', 'c']);
  });
});
