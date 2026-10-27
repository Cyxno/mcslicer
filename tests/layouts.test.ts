import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';
import { parseSchem } from '../src/schem/parse.js';
import { SchemParseError } from '../src/schem/types.js';
import { countNonAir, layersToSteps, schemToLayers } from '../src/schem/layers.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Build an MCEdit-legacy (v1) buffer: Blocks + nibble-packed Data at root. */
function makeLegacyBuffer(opts: {
  width: number; height: number; length: number;
  blockIds: number[];
  meta?: number[]; // 4-bit per block
  gzip?: boolean;
  nestUnderSchematic?: boolean;
}): Buffer {
  const { width, height, length } = opts;
  const volume = width * height * length;
  const data: number[] = [];
  for (let i = 0; i < volume; i += 2) {
    const lo = opts.meta ? opts.meta[i]! : 0;
    const hi = opts.meta && i + 1 < volume ? opts.meta[i + 1]! : 0;
    data.push((hi << 4) | lo);
  }
  const fields: Record<string, { type: string; value: unknown }> = {
    Width: { type: 'short', value: width },
    Height: { type: 'short', value: height },
    Length: { type: 'short', value: length },
    Materials: { type: 'string', value: 'Alpha' },
    Blocks: { type: 'byteArray', value: opts.blockIds },
    Data: { type: 'byteArray', value: data },
  };
  const rootValue = opts.nestUnderSchematic === false
    ? fields
    : { Schematic: { type: 'compound', name: 'Schematic', value: fields } };
  const root = { type: 'compound', name: 'Schematic', value: rootValue } as never;
  const raw = nbt.writeUncompressed(root, 'big');
  return opts.gzip === false ? Buffer.from(raw) : gzipSync(raw);
}

describe('layout dispatch — legacy v1 (Blocks + Data)', () => {
  it('parses a classic MCEdit .schematic with nested Schematic compound', async () => {
    const schem = await parseSchem(makeLegacyBuffer({
      width: 2, height: 1, length: 2,
      blockIds: [0, 1, 1, 4],
      meta: [0, 0, 3, 0],
    }));
    expect(schem.size).toEqual({ x: 2, y: 1, z: 2 });
    expect(schem.blockCount).toBe(4);
    expect(schem.palette).toContain('minecraft:air');
    expect(schem.palette).toContain('legacy:1[data=0]');
    expect(schem.palette).toContain('legacy:4[data=0]'); // index 3 → high nibble of Data[1]
    expect(countNonAir(schem)).toBe(3);
  });

  it('parses root-level fields (root named "Schematic", no child compound)', async () => {
    const schem = await parseSchem(makeLegacyBuffer({
      width: 1, height: 1, length: 1,
      blockIds: [17],
      meta: [2],
      nestUnderSchematic: false,
    }));
    expect(schem.blockCount).toBe(1);
    expect(schem.palette).toEqual(['legacy:17[data=2]']);
  });

  it('rejects truncated legacy Blocks with the real problem named', async () => {
    const buf = makeLegacyBuffer({ width: 4, height: 4, length: 4, blockIds: [0, 1, 2] });
    await expect(parseSchem(buf)).rejects.toThrow(/Blocks truncated/);
  });
});

describe('layout dispatch — error naming (regressions)', () => {
  it('unrecognized root names the REAL missing fields, not "missing field Schematic"', async () => {
    // NBT root without Schematic child and without size fields.
    const root = { type: 'compound', name: 'SomethingElse', value: { Foo: { type: 'int', value: 1 } } } as never;
    const buf = gzipSync(nbt.writeUncompressed(root, 'big'));
    const err = await parseSchem(buf).catch((e) => e);
    expect(err).toBeInstanceOf(SchemParseError);
    expect(err.message).toMatch(/unrecognized schematic layout/);
    expect(err.message).toMatch(/missing Width, Height, Length/);
    expect(err.message).not.toMatch(/^missing field "Schematic"$/);
  });

  it('palette layout without BlockData names the missing field', async () => {
    const root = {
      type: 'compound', name: '',
      value: {
        Schematic: {
          type: 'compound', name: 'Schematic',
          value: {
            Version: { type: 'int', value: 3 },
            Width: { type: 'short', value: 1 },
            Height: { type: 'short', value: 1 },
            Length: { type: 'short', value: 1 },
            Palette: { type: 'compound', name: 'Palette', value: { 'minecraft:air': { type: 'int', value: 0 } } },
          },
        },
      },
    } as never;
    const buf = gzipSync(nbt.writeUncompressed(root, 'big'));
    await expect(parseSchem(buf)).rejects.toThrow(/no block layout.*BlockData/);
  });

  it('dispatches on field presence: Version 2 + Palette layout is accepted (v2 hybrid)', async () => {
    // Same shape as the phantommarket fixture but tiny.
    const root = {
      type: 'compound', name: '',
      value: {
        Schematic: {
          type: 'compound', name: 'Schematic',
          value: {
            Version: { type: 'int', value: 2 },
            DataVersion: { type: 'int', value: 4325 },
            Width: { type: 'short', value: 1 },
            Height: { type: 'short', value: 1 },
            Length: { type: 'short', value: 1 },
            Palette: {
              type: 'compound', name: 'Palette',
              value: { 'minecraft:air': { type: 'int', value: 0 }, 'minecraft:stone': { type: 'int', value: 1 } },
            },
            PaletteMax: { type: 'int', value: 2 },
            BlockData: { type: 'byteArray', value: [1] },
            BlockEntities: { type: 'list', value: { type: 'compound', value: [] } },
          },
        },
      },
    } as never;
    const schem = await parseSchem(gzipSync(nbt.writeUncompressed(root, 'big')));
    expect(schem.blockCount).toBe(1);
    expect(schem.palette).toEqual(['minecraft:air', 'minecraft:stone']);
  });

  it('still rejects Version 99', async () => {
    const root = {
      type: 'compound', name: '',
      value: {
        Schematic: {
          type: 'compound', name: 'Schematic',
          value: {
            Version: { type: 'int', value: 99 },
            Width: { type: 'short', value: 1 },
            Height: { type: 'short', value: 1 },
            Length: { type: 'short', value: 1 },
            Palette: { type: 'compound', name: 'Palette', value: { 'minecraft:air': { type: 'int', value: 0 } } },
            BlockData: { type: 'byteArray', value: [0] },
          },
        },
      },
    } as never;
    await expect(parseSchem(gzipSync(nbt.writeUncompressed(root, 'big')))).rejects.toThrow(/Version 99/);
  });
});

describe('fixture: phantommarket-f64.schem (v2 hybrid, third-party shape)', () => {
  const fixturePath = join(fixtures, 'phantommarket-f64.schem');

  it('parses: 42x10x13, 5460 blocks, 35 palette entries', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    expect(schem.size).toEqual({ x: 42, y: 10, z: 13 });
    expect(schem.blockCount).toBe(5460);
    expect(schem.palette.length).toBe(35);
  });

  it('satisfies all layer/step invariants', async () => {
    const schem = await parseSchem(await readFile(fixturePath));
    const layers = schemToLayers(schem);
    const steps = layersToSteps(layers);
    const nonAir = countNonAir(schem);
    expect(layers.reduce((s, l) => s + l.count, 0)).toBe(nonAir);
    expect(steps.length).toBe(nonAir);
    expect(steps.every((s) => s.block !== 'minecraft:air')).toBe(true);
    expect(nonAir).toBeGreaterThan(0);
  });

  it('goes through schemToSceneData cleanly', async () => {
    const { schemToSceneData } = await import('../src/render/scene.js');
    const schem = await parseSchem(await readFile(fixturePath));
    const scene = schemToSceneData(schem);
    expect(scene.length).toBeGreaterThan(5);
    expect(scene.reduce((s, t) => s + t.count, 0)).toBe(countNonAir(schem));
  });
});
