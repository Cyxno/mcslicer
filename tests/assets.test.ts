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

/** Build a minimal zip (stored or deflate-raw entries) in the test. */
async function makeZip(entries: [string, Uint8Array][]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v: number): Uint8Array =>
    new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);

  for (const [name, bytes] of entries) {
    let data = bytes;
    let method = 0;
    if ('CompressionStream' in globalThis && bytes.length > 0) {
      // deflate-raw when the platform supports it (exercises method 8).
      const stream = new Blob([bytes.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
      method = 8;
    }
    const nameBytes = new TextEncoder().encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    local.set(u32(0x04034b50), 0);
    local.set(u16(method), 8);
    local.set(u32(data.length), 18);
    local.set(u16(nameBytes.length), 26);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    const centralName = new Uint8Array(46 + nameBytes.length);
    centralName.set(u32(0x02014b50), 0);
    centralName.set(u16(method), 10);
    centralName.set(u32(data.length), 20);
    centralName.set(u16(nameBytes.length), 28);
    centralName.set(u32(offset), 42);
    centralName.set(nameBytes, 46);
    central.push(centralName);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  eocd.set(u32(0x06054b50), 0);
  eocd.set(u16(entries.length), 10);
  eocd.set(u32(centralSize), 12);
  eocd.set(u32(offset), 16);
  const all = [...chunks, ...central, eocd];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of all) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

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
