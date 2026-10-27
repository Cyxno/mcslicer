import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyBlockName } from '../src/schem/legacy-ids.js';
import { parseSchem } from '../src/schem/parse.js';

describe('legacyBlockName — data-driven spot checks (4f)', () => {
  it('the keuring-cases: 20 = glass, 54 = chest', () => {
    expect(legacyBlockName(20, 0)).toBe('minecraft:glass');
    expect(legacyBlockName(54, 0)).toBe('minecraft:chest');
  });

  it('wool colors (id 35, data 0-15)', () => {
    expect(legacyBlockName(35, 0)).toBe('minecraft:white_wool');
    expect(legacyBlockName(35, 3)).toBe('minecraft:light_blue_wool');
    expect(legacyBlockName(35, 7)).toBe('minecraft:gray_wool');
    expect(legacyBlockName(35, 8)).toBe('minecraft:light_gray_wool');
    expect(legacyBlockName(35, 14)).toBe('minecraft:red_wool');
    expect(legacyBlockName(35, 15)).toBe('minecraft:black_wool');
  });

  it('wood species (planks 5, log 17 incl. axis, leaves 18, log2 162)', () => {
    expect(legacyBlockName(5, 0)).toBe('minecraft:oak_planks');
    expect(legacyBlockName(5, 2)).toBe('minecraft:birch_planks');
    expect(legacyBlockName(5, 5)).toBe('minecraft:dark_oak_planks');
    expect(legacyBlockName(17, 0)).toBe('minecraft:oak_log[axis=y]');
    expect(legacyBlockName(17, 1)).toBe('minecraft:spruce_log[axis=y]');
    expect(legacyBlockName(17, 5)).toBe('minecraft:spruce_log[axis=x]'); // axis in bits 2-3
    expect(legacyBlockName(17, 12)).toBe('minecraft:oak_wood'); // bark variant
    expect(legacyBlockName(18, 1)).toBe('minecraft:spruce_leaves');
    expect(legacyBlockName(162, 1)).toBe('minecraft:dark_oak_log[axis=y]');
  });

  it('piston facing (33/29/23): bits 0-2 direction, bit 3 extended', () => {
    expect(legacyBlockName(33, 0)).toBe('minecraft:piston[facing=down,extended=false]');
    expect(legacyBlockName(33, 2)).toBe('minecraft:piston[facing=north,extended=false]');
    expect(legacyBlockName(33, 5 | 8)).toBe('minecraft:piston[facing=east,extended=true]');
    expect(legacyBlockName(29, 3 | 8)).toBe('minecraft:sticky_piston[facing=south,extended=true]');
    expect(legacyBlockName(23, 1)).toBe('minecraft:dispenser[facing=up]');
  });

  it('chest/furnace/ladder wall-facing (2 north, 3 south, 4 west, 5 east)', () => {
    expect(legacyBlockName(54, 2)).toBe('minecraft:chest[facing=north]');
    expect(legacyBlockName(54, 5)).toBe('minecraft:chest[facing=east]');
    expect(legacyBlockName(61, 4)).toBe('minecraft:furnace[facing=west]');
    expect(legacyBlockName(62, 3)).toBe('minecraft:lit_furnace[facing=south]');
    expect(legacyBlockName(146, 2)).toBe('minecraft:trapped_chest[facing=north]');
    expect(legacyBlockName(65, 4)).toBe('minecraft:ladder[facing=west]');
  });

  it('redstone wire: connectivity bits + power', () => {
    expect(legacyBlockName(55, 0)).toBe(
      'minecraft:redstone_wire[north=false,east=false,south=false,west=false,power=0]');
    expect(legacyBlockName(55, 1 | 4)).toBe(
      'minecraft:redstone_wire[north=true,east=false,south=true,west=false,power=0]');
    expect(legacyBlockName(55, (3 << 4) | 2)).toBe(
      'minecraft:redstone_wire[north=false,east=true,south=false,west=false,power=3]');
  });

  it('slabs: type in bits 0-2, top in bit 3; doubles via id 43', () => {
    expect(legacyBlockName(44, 0)).toBe('minecraft:smooth_stone_slab[type=bottom]');
    expect(legacyBlockName(44, 0 | 8)).toBe('minecraft:smooth_stone_slab[type=top]');
    expect(legacyBlockName(44, 2)).toBe('minecraft:oak_slab[type=bottom]');
    expect(legacyBlockName(43, 5)).toBe('minecraft:stone_brick_slab[type=double]');
  });

  it('stairs carry facing + half', () => {
    expect(legacyBlockName(53, 1)).toBe('minecraft:oak_stairs[facing=west,half=bottom]');
    expect(legacyBlockName(67, 2 | 4)).toBe('minecraft:cobblestone_stairs[facing=south,half=top]');
  });

  it('unknown ids AND known ids with unmapped data land on explicit legacy markers', () => {
    expect(legacyBlockName(300, 0)).toBe('legacy:unknown_300');
    expect(legacyBlockName(255, 4)).toBe('legacy:unknown_255_data_4');
    expect(legacyBlockName(63, 0)).toBe('legacy:unknown_63'); // sign: not yet mapped
  });
});

describe('parseSchem legacy branch — palette is fully namespaced (4f)', () => {
  it('no palette entry is numeric/synthetic after translation; unknown ids stay explicit', async () => {
    const { makeLegacyBuffer } = await import('./helpers.js');
    const schem = await parseSchem(makeLegacyBuffer({
      width: 2, height: 1, length: 3,
      blockIds: [20, 54, 35, 33, 1, 125],
      meta: [0, 2, 3, 12, 0, 0],
    }));
    expect(schem.format).toBe('legacy-mcedit');
    for (const entry of schem.palette) {
      // Every entry is either a proper namespaced blockstate or the
      // EXPLICIT unknown marker — never a bare numeric id.
      expect(
        entry.startsWith('minecraft:') || entry.startsWith('legacy:unknown_'),
        `palette entry "${entry}" is neither namespaced nor an explicit unknown marker`,
      ).toBe(true);
      expect(/^\d+$/.test(entry)).toBe(false);
    }
    expect(schem.palette).toContain('minecraft:glass');
    expect(schem.palette).toContain('minecraft:chest[facing=north]');
    expect(schem.palette).toContain('minecraft:light_blue_wool');
    expect(schem.palette).toContain('minecraft:piston[facing=west,extended=true]');
    expect(schem.palette).toContain('legacy:unknown_125'); // unmapped id: explicit, not silent
  });
});

describe('fixture: afk-chicken-farm-31a167dd.schematic (legacy, real user file)', () => {
  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'afk-chicken-farm-31a167dd.schematic');

  it('exists — the real file must be committed with the fix', async () => {
    await expect(readFile(fixturePath)).resolves.toBeInstanceOf(Buffer);
  });

  it('parses with NO numeric palette entries left', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    expect(schem.format).toBe('legacy-mcedit');
    expect(schem.blockCount).toBeGreaterThan(0);
    for (const entry of schem.palette) {
      expect(/^\d+$/.test(entry)).toBe(false);
      expect(entry.startsWith('legacy:')).toBe(false);
    }
  });

  it('the observed ids resolve to glass and chest, not color fallback', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    expect(schem.palette).toContain('minecraft:glass'); // "20"
    expect(schem.palette).toContain('minecraft:chest'); // "54" (any facing)
    expect(schem.palette.some((p) => p.startsWith('minecraft:chest'))).toBe(true);
  });

  it('satisfies layer/step invariants like any other format', async () => {
    const { countNonAir, layersToSteps, schemToLayers } = await import('../src/schem/layers.js');
    const schem = await parseSchem(await readFile(fixturePath));
    const layers = schemToLayers(schem);
    const steps = layersToSteps(layers);
    expect(layers.reduce((s, l) => s + l.count, 0)).toBe(countNonAir(schem));
    expect(steps.length).toBe(countNonAir(schem));
  });
});
