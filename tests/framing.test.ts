import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchem } from '../src/schem/parse.js';
import { buildSlicerModel } from '../src/slicer/steps.js';
import { blockCenterLocal, localToWorld, modelMatrix } from '../src/render/transform.js';
import { framingForStep } from '../src/render/framing.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo-huisje.schem');

describe('framingForStep — 4e C', () => {
  it('frames the world-space center of the given block', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const model = buildSlicerModel(schem, 'y');
    for (const step of [model.steps[0]!, model.steps[model.steps.length - 1]!]) {
      const f = framingForStep(step, schem.size);
      const expected = localToWorld(modelMatrix(schem.size), blockCenterLocal(step));
      expect(f.x).toBeCloseTo(expected.x, 12);
      expect(f.y).toBeCloseTo(expected.y, 12);
      expect(f.z).toBeCloseTo(expected.z, 12);
    }
  });

  it('a block at the model center on x/z frames near the y axis', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const s = 16 / Math.max(schem.size.x, schem.size.y, schem.size.z);
    const step = { x: Math.floor(schem.size.x / 2), y: 1, z: Math.floor(schem.size.z / 2) };
    const f = framingForStep(step, schem.size);
    // Even-sized models have no block exactly on the axis: the frame sits
    // half a block off in world units, nothing more.
    expect(Math.abs(f.x)).toBeCloseTo(s / 2, 12);
    expect(Math.abs(f.z)).toBeCloseTo(s / 2, 12);
    expect(f.y).toBeGreaterThan(0);
  });
});
