import { describe, expect, it } from 'vitest';
import {
  AssetError,
  assetFilesFromZip,
  buildAssetFiles,
  normalizeAssetPath,
  parseZipDirectory,
  readJsonAsset,
  treeFromAssetFiles,
} from '../src/textures/assets.js';

import { makeZip } from './helpers-zip.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

//const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('normalizeAssetPath', () => {
  it('strips everything before the assets/ root', () => {
    expect(normalizeAssetPath('C:/Users/x/.minecraft/assets/minecraft/textures/block/stone.png'))
      .toBe('minecraft/textures/block/stone.png');
    expect(normalizeAssetPath('pack/assets/minecraft/blockstates/hopper.json'))
      .toBe('minecraft/blockstates/hopper.json');
    expect(normalizeAssetPath('assets/README.md')).toBe('readme.md');
  });
  it('rejects paths without an assets/ root', () => {
    expect(normalizeAssetPath('mods/some.jar')).toBeNull();
    expect(normalizeAssetPath('assets/')).toBeNull();
  });
});

describe('buildAssetFiles', () => {
  it('is case-insensitive and exposes sorted paths', () => {
    const files = buildAssetFiles([
      ['x/Assets/Minecraft/BlockStates/STONE.json', enc('{}')],
      ['x/assets/minecraft/models/block/a.json', enc('{}')],
    ]);
    expect(files.has('MINECRAFT/BLOCKSTATES/stone.json')).toBe(true);
    expect(files.paths()).toEqual(['minecraft/blockstates/stone.json', 'minecraft/models/block/a.json']);
  });
  it('parses JSON via readJsonAsset and tolerates broken JSON', () => {
    const files = buildAssetFiles([
      ['assets/minecraft/good.json', enc('{"a":1}')],
      ['assets/minecraft/bad.json', enc('{nope')],
      ['assets/minecraft/data.bin', enc('{"a":1}')],
    ]);
    expect(readJsonAsset(files, 'minecraft/good.json')).toEqual({ a: 1 });
    expect(readJsonAsset(files, 'minecraft/bad.json')).toBeUndefined();
    expect(readJsonAsset(files, 'minecraft/data.bin')).toBeUndefined();
    expect(treeFromAssetFiles(files).has('minecraft/good.json')).toBe(true);
  });
});

describe('zip reading', () => {
  it('round-trips entries through parseZipDirectory/readZipEntry', async () => {
    const bytes = await makeZip([
      ['assets/minecraft/a.json', enc('{"x":1}')],
      ['assets/minecraft/deep/b.json', enc('{"y":"z"}')],
    ]);
    const dir = parseZipDirectory(bytes);
    expect([...dir.keys()].sort()).toEqual(['assets/minecraft/a.json', 'assets/minecraft/deep/b.json']);
    const files = await assetFilesFromZip(bytes);
    expect(readJsonAsset(files, 'minecraft/a.json')).toEqual({ x: 1 });
    expect(readJsonAsset(files, 'minecraft/deep/b.json')).toEqual({ y: 'z' });
  });

  it('throws a typed error on non-zip input', async () => {
    expect(() => parseZipDirectory(enc('definitely not a zip'))).toThrow(AssetError);
  });

  it('the full zip path feeds the blockstate resolver', async () => {
    const zip = await makeZip([
      [
        'assets/minecraft/blockstates/test_block.json',
        enc(JSON.stringify({ variants: { '': { model: 'block/test_block' } } })),
      ],
      [
        'assets/minecraft/models/block/test_block.json',
        enc(JSON.stringify({ textures: { all: 'block/test_all' } })),
      ],
    ]);
    const files = await assetFilesFromZip(zip);
    const { resolveBlockstate } = await import('../src/textures/atlas.js');
    const r = resolveBlockstate('minecraft:test_block', treeFromAssetFiles(files));
    expect(r!.texturePath).toBe('minecraft:textures/block/test_all.png');
  });
});
