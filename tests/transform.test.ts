import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { parseSchem } from '../src/schem/parse.js';
import { buildSlicerModel } from '../src/slicer/steps.js';
import {
  blockCenterLocal,
  fitScale,
  gridSpan,
  localToWorld,
  modelMatrix,
  worldToBlock,
} from '../src/render/transform.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo-huisje.schem');

describe('modelMatrix / fitScale — Deel A', () => {
  it('fitScale matches the scale baked into the showSlicer group matrix', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const m = modelMatrix(schem.size);
    // The matrix is a pure uniform scale + translation: its scale equals
    // the fit scale the Viewer uses for framing.
    expect(m.elements[0]!).toBe(fitScale(schem.size));
    expect(m.elements[5]!).toBe(fitScale(schem.size));
    expect(m.elements[10]!).toBe(fitScale(schem.size));
    // Uniform: one block occupies exactly fitScale world units.
    const one = localToWorld(m, new Vector3(1, 0, 0)).distanceTo(localToWorld(m, new Vector3(0, 0, 0)));
    expect(one).toBeCloseTo(fitScale(schem.size), 12);
  });

  it('centers the model on x/z with its base on y=0', () => {
    const m = modelMatrix({ x: 10, y: 4, z: 6 });
    const c = localToWorld(m, new Vector3(5, 0, 3)); // model center at ground level
    expect(c.x).toBeCloseTo(0, 12);
    expect(c.y).toBeCloseTo(0, 12);
    expect(c.z).toBeCloseTo(0, 12);
  });
});

describe('worldToBlock roundtrip — Deel A', () => {
  it('world -> local -> world roundtrips on 3 fixture block centers', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const model = buildSlicerModel(schem, 'y');
    const m = modelMatrix(schem.size);
    const picks = [0, Math.floor(model.steps.length / 2), model.steps.length - 1];
    for (const i of picks) {
      const step = model.steps[i]!;
      const center = blockCenterLocal(step);
      const world = localToWorld(m, center);
      const back = worldToBlock(m, world);
      expect(back).toEqual({ x: step.x, y: step.y, z: step.z });
    }
  });

  it('a 1x1x1 local box covers exactly one block at any scale (old bug: 1.04 world units)', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const m = modelMatrix(schem.size);
    const s = fitScale(schem.size);
    // The old world-space hover box (1.04 world units) covered
    // 1.04/s blocks — off by the model-dependent fit scale. A local
    // 1x1x1 box covers exactly 1 block, at every scale.
    const cornerA = localToWorld(m, new Vector3(0, 0, 0));
    const cornerB = localToWorld(m, new Vector3(1, 1, 1));
    expect((cornerB.x - cornerA.x) / s).toBeCloseTo(1, 12);
    expect((cornerB.y - cornerA.y) / s).toBeCloseTo(1, 12);
    expect((cornerB.z - cornerA.z) / s).toBeCloseTo(1, 12);
  });
});

describe('gridSpan — Deel D', () => {
  it('snaps to whole cells and extends one cell past the model', () => {
    expect(gridSpan(20, 20)).toBe(40); // 20 -> 3 cells (24) + 2*8
    expect(gridSpan(17, 3)).toBe(40);
    expect(gridSpan(1, 1)).toBe(24);
    expect(gridSpan(64, 64)).toBe(80);
    expect(gridSpan(5, 5, 4)).toBe(16); // custom cell size
  });
});
