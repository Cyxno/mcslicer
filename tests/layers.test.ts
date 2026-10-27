import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchem } from '../src/schem/parse.js';
import { countNonAir, layersToSteps, schemToLayers } from '../src/schem/layers.js';
import { makeSchemBuffer, tinySchem } from './helpers.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo-huisje.schem');

describe('schemToLayers / layersToSteps — invariants', () => {
  it('sum(layer.count) === non-air blocks, exactly', async () => {
    const schem = await parseSchem(tinySchem());
    const layers = schemToLayers(schem);
    expect(layers.reduce((s, l) => s + l.count, 0)).toBe(countNonAir(schem));
  });

  it('every step is exactly one block; total steps === non-air', async () => {
    const schem = await parseSchem(tinySchem());
    const layers = schemToLayers(schem);
    const steps = layersToSteps(layers);
    expect(steps.length).toBe(countNonAir(schem));
    for (const step of steps) {
      expect(step.block).not.toBe('minecraft:air');
    }
  });

  it('no air and no duplicate coordinates across steps', async () => {
    const schem = await parseSchem(tinySchem());
    const steps = layersToSteps(schemToLayers(schem));
    const seen = new Set(steps.map((s) => `${s.x},${s.y},${s.z}`));
    expect(seen.size).toBe(steps.length);
  });

  it('steps are ordered bottom-up (y non-decreasing), row-major within a layer', async () => {
    const schem = await parseSchem(tinySchem());
    const steps = layersToSteps(schemToLayers(schem));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.y).toBeGreaterThanOrEqual(steps[i - 1]!.y);
      if (steps[i]!.y === steps[i - 1]!.y) {
        const prev = steps[i - 1]!;
        const cur = steps[i]!;
        expect(cur.z * 1000 + cur.x).toBeGreaterThan(prev.z * 1000 + prev.x);
      }
    }
  });

  it('step indices are sequential from 0', async () => {
    const schem = await parseSchem(tinySchem());
    const steps = layersToSteps(schemToLayers(schem));
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i));
  });

  it('a fully-air schematic produces zero layers and zero steps', async () => {
    const schem = await parseSchem(makeSchemBuffer({
      width: 2, height: 2, length: 2,
      palette: ['minecraft:air'],
      blockIndices: new Array(8).fill(0),
    }));
    const layers = schemToLayers(schem);
    expect(layers).toEqual([]);
    expect(layersToSteps(layers)).toEqual([]);
  });
});

describe('fixture: demo-huisje.schem', () => {
  it('parses and satisfies all layer/step invariants', async () => {
    const bytes = await readFile(fixturePath);
    const schem = await parseSchem(bytes);
    expect(schem.size).toEqual({ x: 20, y: 10, z: 20 });

    const layers = schemToLayers(schem);
    const steps = layersToSteps(layers);
    const nonAir = countNonAir(schem);

    expect(layers.length).toBeGreaterThan(0);
    expect(layers.reduce((s, l) => s + l.count, 0)).toBe(nonAir);
    expect(steps.length).toBe(nonAir);
    expect(steps.every((s) => s.block !== 'minecraft:air')).toBe(true);
  });

  it('contains the expected building blocks', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    for (const id of [
      'minecraft:air',
      'minecraft:stone',
      'minecraft:oak_planks',
      'minecraft:glass',
      'minecraft:oak_door[half=lower,facing=south,hinge=left,open=false]',
      'minecraft:spruce_planks',
    ]) {
      expect(schem.palette).toContain(id);
    }
  });
});
