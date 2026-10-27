import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchem } from '../src/schem/parse.js';
import { countNonAir } from '../src/schem/layers.js';
import { schemToSceneData } from '../src/render/scene.js';
import { colorForBlock, fallbackColor } from '../src/render/colors.js';
import { makeSchemBuffer, tinySchem } from './helpers.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo-huisje.schem');

function tallyByPalette(schem: Awaited<ReturnType<typeof parseSchem>>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const idx of schem.blocks) {
    if (schem.palette[idx] === 'minecraft:air') continue;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  return counts;
}

describe('schemToSceneData — invariants', () => {
  it('per-type totals match parse output exactly', async () => {
    const schem = await parseSchem(tinySchem());
    const scene = schemToSceneData(schem);
    const expected = tallyByPalette(schem);

    expect(scene.length).toBe(expected.size);
    for (const type of scene) {
      expect(type.count).toBe(expected.get(type.paletteIndex));
      expect(type.positions.length).toBe(type.count * 3);
    }
  });

  it('sum of type counts === non-air blocks', async () => {
    const schem = await parseSchem(tinySchem());
    const scene = schemToSceneData(schem);
    expect(scene.reduce((s, t) => s + t.count, 0)).toBe(countNonAir(schem));
  });

  it('positions are block centers within schematic bounds; air excluded', async () => {
    const schem = await parseSchem(tinySchem()); // 2x1x2, blocks [air, stone, stone, planks]
    const scene = schemToSceneData(schem);
    for (const t of scene) {
      expect(t.block).not.toBe('minecraft:air');
      for (let i = 0; i < t.count; i++) {
        const x = t.positions[i * 3]!;
        const y = t.positions[i * 3 + 1]!;
        const z = t.positions[i * 3 + 2]!;
        expect(x).toBeGreaterThanOrEqual(0.5);
        expect(x).toBeLessThanOrEqual(schem.size.x - 0.5);
        expect(y).toBeGreaterThanOrEqual(0.5);
        expect(z).toBeGreaterThanOrEqual(0.5);
        expect(z).toBeLessThanOrEqual(schem.size.z - 0.5);
      }
    }
    const stone = scene.find((t) => t.block === 'minecraft:stone')!;
    expect(stone.count).toBe(2);
  });

  it('colors come from the color table, deterministic fallback for unknown ids', () => {
    expect(colorForBlock('minecraft:stone')).toBe(0x7f7f7f);
    expect(colorForBlock('minecraft:totally_unknown')).toBe(fallbackColor('minecraft:totally_unknown'));
    expect(fallbackColor('a')).toBe(fallbackColor('a'));
    expect(fallbackColor('a')).not.toBe(fallbackColor('b'));
  });

  it('scales: a ~343k-block schematic parses and converts correctly', async () => {
    const N = 70; // 70^3 = 343000 blocks
    const palette = [
      'minecraft:air',
      'minecraft:stone',
      'minecraft:oak_planks',
      'minecraft:glass',
      'minecraft:bricks',
      'minecraft:sand',
      'minecraft:gravel',
      'minecraft:obsidian',
      'minecraft:white_concrete',
      'minecraft:red_concrete',
    ];
    const volume = N * N * N;
    const indices = new Array<number>(volume);
    for (let i = 0; i < volume; i++) {
      indices[i] = i % palette.length; // ~10% air, spread over 9 types
    }
    const bytes = makeSchemBuffer({ width: N, height: N, length: N, palette, blockIndices: indices });
    const schem = await parseSchem(bytes);
    expect(schem.blockCount).toBe(volume);

    const scene = schemToSceneData(schem);
    const expected = tallyByPalette(schem);
    expect(scene.length).toBe(expected.size);
    expect(scene.reduce((s, t) => s + t.count, 0)).toBe(countNonAir(schem));
    for (const t of scene) {
      expect(t.count).toBe(expected.get(t.paletteIndex));
      expect(t.positions.length).toBe(t.count * 3);
    }
  }, 30_000);

  it('smoke: demo-huisje fixture converts with plausible scene data', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const scene = schemToSceneData(schem);
    expect(scene.length).toBeGreaterThanOrEqual(5);
    const planks = scene.find((t) => t.block === 'minecraft:oak_planks')!;
    expect(planks.count).toBeGreaterThan(100);
    expect(planks.positions[0]).toBeTypeOf('number');
  });
});
