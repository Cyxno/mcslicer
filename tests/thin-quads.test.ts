import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockstateProps, thinQuadFor } from '../src/render/thin-quads.js';
import { parseSchem } from '../src/schem/parse.js';

const phantomPath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'phantommarket-f64.schem');

describe('blockstateProps', () => {
  it('parses palette-state properties, empty without brackets', () => {
    expect(blockstateProps('minecraft:chest[facing=west,type=right,waterlogged=false]')).toEqual({
      facing: 'west', type: 'right', waterlogged: 'false',
    });
    expect(blockstateProps('minecraft:stone')).toEqual({});
  });
});

describe('thinQuadFor — furnace fixture (phantommarket palette)', () => {
  let palette: string[] = [];
  beforeAll(async () => {
    palette = (await parseSchem(await readFile(phantomPath))).palette;
  });

  it('powered_rail east_west lies flat and is rotated a quarter turn', () => {
    const rail = palette.find((p) => p.startsWith('minecraft:powered_rail') && p.includes('east_west'))!;
    const spec = thinQuadFor(rail)!;
    expect(spec.kind).toBe('flat');
    expect(spec.y).toBeCloseTo(1 / 16, 5);
    expect(spec.rotY).toBeCloseTo(Math.PI / 2, 6);
  });

  it('all redstone wires lie flat and unrotated (the cross texture does the shape)', () => {
    const wires = palette.filter((p) => p.startsWith('minecraft:redstone_wire'));
    expect(wires.length).toBeGreaterThan(5);
    for (const w of wires) {
      const spec = thinQuadFor(w)!;
      expect(spec.kind).toBe('flat');
      expect(spec.rotY).toBe(0);
      expect(spec.y).toBeLessThan(0.05);
    }
  });

  it('wall torch on the furnace bench is a vertical plane aimed by facing', () => {
    const torch = palette.find((p) => p.includes('redstone_wall_torch') && p.includes('facing=west'))!;
    const spec = thinQuadFor(torch)!;
    expect(spec.kind).toBe('vertical');
    expect(spec.normal).toEqual({ x: -1, z: 0 });
    expect(spec.offset).toBeGreaterThan(0);
    expect(spec.y).toBeGreaterThan(0.5);
  });

  it('floor lever is flat; solids keep the full cube', () => {
    expect(thinQuadFor('minecraft:lever[face=floor,facing=north,powered=false]')!.kind).toBe('flat');
    expect(thinQuadFor('minecraft:lever[face=ceiling,facing=north,powered=false]')!.y).toBe(0.95);
    expect(thinQuadFor('minecraft:stone')).toBeNull();
    expect(thinQuadFor('minecraft:furnace[facing=north,lit=true]')).toBeNull();
  });

  it('every rail entry in the fixture gets a spec; unknown shapes stay flat', () => {
    for (const p of palette.filter((e) => e.includes('_rail'))) {
      expect(thinQuadFor(p)).not.toBeNull();
    }
    expect(thinQuadFor('minecraft:rail[shape=ascending_north]')!.rotY).toBe(0);
    expect(thinQuadFor('minecraft:rail[shape=ascending_east]')!.rotY).toBeCloseTo(Math.PI / 2, 6);
  });
});
