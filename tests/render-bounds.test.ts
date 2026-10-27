import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { buildSlicerModel } from '../src/slicer/steps.js';
import { parseSchem } from '../src/schem/parse.js';
import { readFileSync } from 'node:fs';

/**
 * 4d regression: the hover box used the *local* instance translation
 * (block coords) while meshes live in world space via the group transform
 * (scale + recenter) — a box floating outside the model. Assert the exact
 * placement math showSlicer uses: every block center's world position
 * stays inside the model bounds, and the inverse transform round-trips.
 */
function groupFor(size: { x: number; y: number; z: number }): Matrix4 {
  const scale = 16 / Math.max(size.x, size.y, size.z);
  const group = new Matrix4();
  group.makeScale(scale, scale, scale);
  group.setPosition(-(size.x / 2) * scale, 0, -(size.z / 2) * scale);
  return group;
}

describe('mesh placement within model bounds (4d)', () => {
  it('every block center (scaled by the group transform) stays inside the model bounds', async () => {
    const raw = readFileSync('tests/fixtures/phantommarket-f64.schem');
    const schem = await parseSchem(new Uint8Array(raw));
    const model = buildSlicerModel(schem, 'y');
    const group = groupFor(schem.size);
    const scale = 16 / Math.max(schem.size.x, schem.size.y, schem.size.z);
    const halfX = (schem.size.x * scale) / 2;
    const halfZ = (schem.size.z * scale) / 2;
    const inverse = group.clone().invert();
    const p = new Vector3();
    for (const step of model.steps) {
      p.set(step.x + 0.5, step.y + 0.5, step.z + 0.5).applyMatrix4(group);
      expect(p.x).toBeGreaterThanOrEqual(-halfX - 1e-9);
      expect(p.x).toBeLessThanOrEqual(halfX + 1e-9);
      expect(p.z).toBeGreaterThanOrEqual(-halfZ - 1e-9);
      expect(p.z).toBeLessThanOrEqual(halfZ + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      // inverse round-trip: hover/pick coordinates recover the block coord
      const local = p.clone().applyMatrix4(inverse);
      expect(Math.floor(local.x)).toBe(step.x);
      expect(Math.floor(local.y)).toBe(step.y);
      expect(Math.floor(local.z)).toBe(step.z);
    }
  });
});
