import { describe, expect, it } from 'vitest';
import { atlasReportLine, chooseSource, resolveForRender, resolveSourceOrder, sourceLabel, sourceStatusLine } from '../src/textures/sources.js';
import { createRemoteSource, pendingPaths, treeFromRemote } from '../src/textures/remote.js';
import { resolveBlockstate } from '../src/textures/atlas.js';
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('source order (user > default > kleur)', () => {
  it('orders available sources only', () => {
    expect(resolveSourceOrder(true, true)).toEqual(['user', 'default']);
    expect(resolveSourceOrder(false, true)).toEqual(['default']);
    expect(resolveSourceOrder(true, false)).toEqual(['user']);
    expect(resolveSourceOrder(false, false)).toEqual([]);
  });

  it('chooses per type: first usable wins, else fallback', () => {
    expect(chooseSource(true, true)).toBe('user');
    expect(chooseSource(false, true)).toBe('default');
    expect(chooseSource(false, false)).toBe('fallback');
    // user beats default even when default would also work
    expect(chooseSource(true, false)).toBe('user');
  });

  it('status line reports per source and kleurmodus explicitly', () => {
    expect(sourceStatusLine({ user: 2, default: 30, fallback: 2 }))
      .toBe('2 types (eigen assets), 30 types (default assets), 2 kleur-fallback');
    expect(sourceStatusLine({ user: 0, default: 34, fallback: 0 }))
      .toBe('34 types (default assets)');
    expect(sourceStatusLine({ user: 0, default: 0, fallback: 0 }))
      .toBe('kleurmodus (geen textures beschikbaar)');
  });

  it('labels are stable', () => {
    expect(sourceLabel('user')).toBe('eigen assets');
    expect(sourceLabel('default')).toBe('default assets');
    expect(sourceLabel('fallback')).toBe('kleur-fallback');
  });
});

describe('remote default source', () => {
  const FILES: Record<string, string> = {
    "minecraft/blockstates/furnace.json": JSON.stringify({
      variants: { 'facing=north,lit=false': { model: 'block/furnace' } },
    }),
    'minecraft/models/block/furnace.json': JSON.stringify({
      parent: 'block/orientable',
      textures: { front: 'block/furnace_front', side: 'block/furnace_side', top: 'block/furnace_top' },
    }),
    'minecraft/models/block/orientable.json': JSON.stringify({
      parent: 'block/cube',
      textures: { particle: '#side', north: '#front', east: '#side', south: '#side', west: '#side', up: '#side', down: '#side' },
    }),
    'minecraft/models/block/cube.json': JSON.stringify({
      textures: { particle: '#particle', down: '#down', up: '#up', north: '#north', east: '#east', south: '#south', west: '#west' },
    }),
    'minecraft/textures/block/furnace_front.png': 'png-front',
    'minecraft/textures/block/furnace_side.png': 'png-side',
    'minecraft/textures/block/furnace_top.png': 'png-top',
  };

  function makeSource() {
    const fetched: string[] = [];
    const source = createRemoteSource(Object.keys(FILES), async (p) => {
      fetched.push(p);
      const content = FILES[p];
      return content === undefined ? undefined : enc(content);
    });
    return { source, fetched };
  }

  it('lazily fetches only pending paths and caches them', async () => {
    const { source, fetched } = makeSource();
    const wanted = Object.keys(FILES);
    expect(pendingPaths(source, wanted)).toHaveLength(wanted.length);
    await source.ensure(wanted);
    expect(fetched).toHaveLength(wanted.length);
    expect(source.cached()).toBe(wanted.length);
    // second pass: nothing pending, nothing fetched
    expect(pendingPaths(source, wanted)).toHaveLength(0);
    await source.ensure(wanted);
    expect(fetched).toHaveLength(wanted.length);
  });

  it('ignores paths outside the manifest and broken JSON', async () => {
    const { source, fetched } = makeSource();
    await source.ensure(['not-in-manifest.json', "minecraft/blockstates/furnace.json"]);
    expect(fetched).toEqual(["minecraft/blockstates/furnace.json"]);
    expect(source.json("minecraft/blockstates/furnace.json")).toEqual({ variants: { "facing=north,lit=false": { model: "block/furnace" } } });
    expect(source.has("minecraft:textures/block/unknown.png")).toBe(false);
  });

  it('feeds the blockstate resolver via the tree view (colon texture keys)', async () => {
    const { source } = makeSource();
    await source.ensure(Object.keys(FILES));
    const tree = treeFromRemote(source);
    const r = resolveBlockstate('minecraft:furnace[facing=north,lit=false]', tree);
    expect(r).not.toBeNull();
    expect(r!.incomplete).toBe(false);
    expect(r!.texturePath).toBe('minecraft:textures/block/furnace_side.png');
    expect(r!.faces.nz).toBe('minecraft:textures/block/furnace_front.png');
  });

  it('missing files load as undefined without breaking the cache', async () => {
    const source = createRemoteSource(['minecraft/missing.json'], async () => undefined);
    await source.ensure(['minecraft/missing.json']);
    expect(source.getBytes('minecraft/missing.json')).toBeUndefined();
    expect(source.cached()).toBe(0);
    expect(treeFromRemote(source).size).toBe(0);
  });
});

describe('resolveForRender (4d: status en meshes zelfde bronvolgorde)', () => {
  const user = new Map(Object.entries({
    'minecraft/blockstates/stone.json': { variants: { '': { model: 'block/stone' } } },
    'minecraft/models/block/stone.json': { textures: { all: 'block/stone' } },
    'minecraft:textures/block/stone.png': {},
  }));
  const def = new Map(Object.entries({
    'minecraft/blockstates/stone.json': { variants: { '': { model: 'block/stone' } } },
    'minecraft/models/block/stone.json': { textures: { all: 'block/otherstone' } },
    'minecraft:textures/block/otherstone.png': {},
  }));

  it('user wint van default', () => {
    const r = resolveForRender('minecraft:stone', user, def);
    expect(r?.texturePath).toBe('minecraft:textures/block/stone.png');
  });

  it('default vangt op wanneer user niet resolveert (de 4d-bug)', () => {
    const r = resolveForRender('minecraft:stone', null, def);
    expect(r?.texturePath).toBe('minecraft:textures/block/otherstone.png');
  });

  it('null wanneer geen enkele bron compleet resolveert', () => {
    expect(resolveForRender('minecraft:stone', null, null)).toBeNull();
    expect(resolveForRender('minecraft:cactus', user, def)).toBeNull();
  });

  it('atlasReportLine: geen split = render pending', () => {
    expect(atlasReportLine(null, 34)).toBe('34 types resolvet, render pending');
    expect(atlasReportLine('34 types (default assets)', 34)).toBe('34 types (default assets)');
  });
});
