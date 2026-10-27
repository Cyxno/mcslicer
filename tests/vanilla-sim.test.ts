import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { AssetsTree } from '../src/textures/atlas.js';
import { normalizeTexturePath, resolveBlockstate } from '../src/textures/atlas.js';
import { buildAssetFiles, treeFromAssetFiles, readJsonAsset } from '../src/textures/assets.js';
import { parseSchem } from '../src/schem/parse.js';

/**
 * Acceptance for the 4a-texture fix: the *real* furnace fixture palette
 * (34 entries, PhantomMarket furnace auto-smelter) must resolve against a
 * vanilla-format assets tree — at least 90% with a texture present.
 *
 * The sim tree below is written in genuine vanilla formats (not shaped to
 * the parser): multipart redstone_wire with OR-conditions and weighted
 * applies, the full lever facing×powered matrix, chest type=left/right
 * variants, wall/hanging sign chains, furnace lit variants.
 */

const T = (name: string): string => normalizeTexturePath(name, 'minecraft');

// Texture stubs: every texture the sim models reference.
const TEXTURES = [
  'block/dirt', 'block/smooth_stone', 'block/grass_block_top', 'block/grass_block_side',
  'block/furnace_front', 'block/furnace_front_on', 'block/furnace_side', 'block/furnace_top',
  'block/hopper_outside', 'block/hopper_top', 'block/hopper_inside',
  'block/chest_front', 'block/chest_side', 'block/chest_top',
  'block/oak_planks', 'block/lever', 'block/lever_on',
  'block/redstone_dust_dot', 'block/redstone_dust_side0', 'block/redstone_dust_side1',
  'block/redstone_torch', 'block/redstone_torch_off', 'block/rail',
].map(T);

const MODEL = (parent: string | null, textures: Record<string, string>) => ({
  ...(parent ? { parent } : {}),
  textures,
});

function simTree(): AssetsTree {
  const t = new Map<string, unknown>();

  const variant = (pairs: [string, string | object][]) => ({
    variants: Object.fromEntries(pairs.map(([k, v]) => [
      k,
      typeof v === 'string' ? { model: v } : v,
    ])),
  });
  const state = (base: string, pairs: [string, string | object][]) =>
    t.set(`minecraft/blockstates/${base}.json`, variant(pairs));
  const model = (name: string, parent: string | null, textures: Record<string, string>) =>
    t.set(`minecraft/models/${name}.json`, MODEL(parent, textures));

  // Vanilla cube chain (cube_bottom_top / cube_all / orientable → cube → block).
  model('block/block', null, {});
  model('block/cube', 'block/block', {
    particle: '#particle', down: '#down', up: '#up',
    north: '#north', east: '#east', south: '#south', west: '#west',
  });
  model('block/cube_all', 'block/cube', { all: '#all', particle: '#all' });
  model('block/cube_column', 'block/cube', { end: '#end', particle: '#end', side: '#side' });
  model('block/cube_bottom_top', 'block/cube', {
    particle: '#top', down: '#bottom', up: '#top',
    north: '#side', east: '#side', south: '#side', west: '#side',
  });
  model('block/orientable', 'block/cube', {
    particle: '#side', north: '#front',
    east: '#side', south: '#side', west: '#side', up: '#side', down: '#side',
  });

  // dirt / smooth_stone
  state('dirt', [['', 'block/dirt']]);
  model('block/dirt', 'block/cube_all', { all: 'block/dirt' });
  state('smooth_stone', [['', { model: 'block/smooth_stone', x: 90, y: 90 }]]);
  model('block/smooth_stone', 'block/cube_all', { all: 'block/smooth_stone' });

  // grass_block
  state('grass_block', [['snowy=false', 'block/grass_block'], ['snowy=true', 'block/grass_block_snow']]);
  model('block/grass_block', 'block/cube_bottom_top', {
    particle: 'block/dirt', bottom: 'block/dirt',
    top: 'block/grass_block_top', side: 'block/grass_block_side',
  });

  // furnace (lit variants)
  const furnaceState: [string, string | object][] = [];
  for (const facing of ['north', 'south', 'east', 'west']) {
    for (const lit of ['true', 'false']) {
      furnaceState.push([`facing=${facing},lit=${lit}`, {
        model: lit === 'true' ? 'block/furnace_on' : 'block/furnace',
        y: { north: 0, east: 90, south: 180, west: 270 }[facing as 'north'],
      }]);
    }
  }
  state('furnace', furnaceState);
  model('block/furnace', 'block/orientable', {
    particle: 'block/furnace_side', front: 'block/furnace_front',
    side: 'block/furnace_side', top: 'block/furnace_top',
  });
  model('block/furnace_on', 'block/orientable', {
    particle: 'block/furnace_side', front: 'block/furnace_front_on',
    side: 'block/furnace_side', top: 'block/furnace_top',
  });

  // hopper
  state('hopper', [
    ['enabled=true,facing=down', 'block/hopper'],
    ['enabled=true,facing=north', { model: 'block/hopper_side', y: 0 }],
    ['enabled=true,facing=south', { model: 'block/hopper_side', y: 180 }],
    ['enabled=true,facing=west', { model: 'block/hopper_side', y: 270 }],
    ['enabled=false,facing=down', 'block/hopper'],
  ]);
  model('block/hopper', 'block/hopper_inside', {
    particle: 'block/hopper_outside', top: 'block/hopper_top', side: 'block/hopper_outside',
  });
  model('block/hopper_inside', null, { inside: 'block/hopper_inside' });
  model('block/hopper_side', 'block/hopper', { side: 'block/hopper_outside' });

  // chest (type=left/right singles)
  const chestState: [string, string | object][] = [];
  for (const facing of ['north', 'south', 'east', 'west']) {
    for (const type of ['left', 'right', 'single']) {
      chestState.push([`facing=${facing},type=${type}`, { model: `block/chest_${type}`, y: { north: 270, south: 90, east: 0, west: 180 }[facing as 'north'] }]);
    }
  }
  state('chest', chestState);
  for (const type of ['left', 'right', 'single']) {
    model(`block/chest_${type}`, 'block/chest', {
      front: 'block/chest_front', side: 'block/chest_side', top: 'block/chest_top',
    });
  }
  model('block/chest', null, { front: 'block/chest_front', left: 'block/chest_side', right: 'block/chest_side', side: 'block/chest_side', top: 'block/chest_top' });

  // lever: full face×facing×powered matrix, vanilla-style
  const leverState: [string, string | object][] = [];
  for (const face of ['floor', 'wall', 'ceiling']) {
    for (const facing of ['north', 'south', 'east', 'west']) {
      for (const powered of ['true', 'false']) {
        const xrot = face === 'floor' ? 0 : face === 'wall' ? 90 : -90;
        leverState.push([`face=${face},facing=${facing},powered=${powered}`, {
          model: powered === 'true' ? 'block/lever_on' : 'block/lever',
          x: xrot === -90 ? 270 : xrot,
          y: { north: 0, south: 180, west: 270, east: 90 }[facing as 'north'],
        }]);
      }
    }
  }
  state('lever', leverState);
  model('block/lever', 'block/block', { particle: 'block/lever', texture: 'block/lever' });
  model('block/lever_on', 'block/block', { particle: 'block/lever_on', texture: 'block/lever_on' });

  // redstone_wire: vanilla multipart — up-parts per direction with weighted
  // applies, side/cross via OR-conditions.
  t.set('minecraft/blockstates/redstone_wire.json', {
    multipart: [
      { when: {}, apply: { model: 'block/redstone_wire_dot' } },
      ...(['north', 'east', 'south', 'west'] as const).flatMap((dir) => [
        { when: { [dir]: 'up' }, apply: [{ model: 'block/redstone_wire_up0' }, { model: 'block/redstone_wire_up1' }] },
        { when: { OR: [{ [dir]: 'side' }, { [dir]: 'none' }] }, apply: { model: 'block/redstone_wire_side0' } },
      ]),
    ],
  });
  model('block/redstone_wire_dot', null, { particle: 'block/redstone_dust_dot', texture: 'block/redstone_dust_dot' });
  for (const m of ['redstone_wire_up0', 'redstone_wire_up1', 'redstone_wire_side0']) {
    model(`block/${m}`, 'block/block', { particle: 'block/redstone_dust_side0', texture: 'block/redstone_dust_side0' });
  }

  // oak_wall_sign / oak_hanging_sign
  const wallSign: [string, string | object][] = [];
  for (const facing of ['north', 'south', 'east', 'west']) {
    wallSign.push([`facing=${facing}`, { model: 'block/oak_wall_sign', y: { north: 0, south: 180, west: 270, east: 90 }[facing as 'north'] }]);
  }
  state('oak_wall_sign', wallSign);
  model('block/oak_wall_sign', 'block/block', { particle: 'block/oak_planks', texture: 'block/oak_planks' });

  const hangSign: [string, string | object][] = [];
  for (const attached of ['true', 'false']) {
    for (let rotation = 0; rotation < 16; rotation++) {
      hangSign.push([`attached=${attached},rotation=${rotation}`, { model: 'block/oak_hanging_sign', y: rotation * 22.5 }]);
    }
  }
  state('oak_hanging_sign', hangSign);
  model('block/oak_hanging_sign', 'block/block', { particle: 'block/oak_planks', texture: 'block/oak_planks' });

  // powered_rail
  const railState: [string, string | object][] = [];
  for (const powered of ['true', 'false']) {
    for (const shape of ['north_south', 'east_west', 'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south']) {
      railState.push([`powered=${powered},shape=${shape}`, {
        model: powered === 'true' ? 'block/powered_rail_on' : 'block/powered_rail',
        y: shape === 'east_west' ? 90 : 0,
      }]);
    }
  }
  state('powered_rail', railState);
  model('block/powered_rail', 'block/block', { particle: 'block/rail', rail: 'block/rail' });
  model('block/powered_rail_on', 'block/block', { particle: 'block/rail', rail: 'block/rail' });

  // redstone_wall_torch
  const torchState: [string, string | object][] = [];
  for (const facing of ['north', 'south', 'east', 'west']) {
    for (const lit of ['true', 'false']) {
      torchState.push([`facing=${facing},lit=${lit}`, {
        model: lit === 'true' ? 'block/redstone_wall_torch_on' : 'block/redstone_wall_torch',
        y: { north: 270, south: 90, west: 180, east: 0 }[facing as 'north'],
      }]);
    }
  }
  state('redstone_wall_torch', torchState);
  model('block/redstone_wall_torch', 'block/block', { particle: 'block/redstone_torch', torch: 'block/redstone_torch' });
  model('block/redstone_wall_torch_on', 'block/block', { particle: 'block/redstone_torch', torch: 'block/redstone_torch_off' });

  for (const path of TEXTURES) t.set(path, {});
  return t;
}

describe('furnace fixture resolves against vanilla-format sim tree', () => {
  it('renders >= 90% of the 34 palette types with a present texture', async () => {
    const bytes = new Uint8Array(
      readFileSync(new URL('./fixtures/phantommarket-f64.schem', import.meta.url)),
    );
    const schem = await parseSchem(bytes);
    const entries = [...new Set(schem.palette.filter((b) => b !== 'minecraft:air'))];
    expect(entries.length).toBe(34);

    const tree = simTree();
    let withTexture = 0;
    const failed: string[] = [];
    for (const entry of entries) {
      const r = resolveBlockstate(entry, tree);
      const present = r && r.texturePath && tree.has(r.texturePath);
      if (present) withTexture++;
      else failed.push(entry);
    }
    expect(failed, `${failed.length} unresolved`).toEqual([]);
    expect(withTexture / entries.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('launcher assets layout (objects/indexes)', () => {
  const hashOf = (s: string): string => {
    // FNV-1a, hex-padded to a fake 40-char sha1 shape; unique per path.
    let h = 0x811c9dc5;
    for (const c of s) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h.toString(16) + s.length.toString(16)).padEnd(40, '0').slice(0, 40);
  };

  function launcherEntries(): [string, Uint8Array][] {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
    const virtuals: Record<string, string> = {
      'minecraft/blockstates/furnace.json': JSON.stringify({
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
    };
    virtuals['minecraft/textures/block/furnace_front.png'] = 'png-bytes';
    virtuals['minecraft/textures/block/furnace_side.png'] = 'png-bytes';
    virtuals['minecraft/textures/block/furnace_top.png'] = 'png-bytes';
    const entries: [string, Uint8Array][] = [];
    const objects: Record<string, { hash: string }> = {};
    for (const [path, content] of Object.entries(virtuals)) {
      const hash = hashOf(path);
      objects[path] = { hash };
      entries.push([`assets/objects/${hash.slice(0, 2)}/${hash}`, enc(content)]);
    }
    entries.push(['assets/indexes/17.json', enc(JSON.stringify({ objects }))]);
    return entries;
  }

  it('resolves virtual paths through the index onto object bytes', () => {
    const files = buildAssetFiles(launcherEntries());
    expect(files.has('minecraft/blockstates/furnace.json')).toBe(true);
    const state = readJsonAsset(files, 'minecraft/blockstates/furnace.json');
    expect(state).not.toBeUndefined();
  });

  it('feeds the full blockstate chain from launcher layout', () => {
    const tree = treeFromAssetFiles(buildAssetFiles(launcherEntries()));
    const r = resolveBlockstate('minecraft:furnace[facing=north,lit=false]', tree);
    expect(r).not.toBeNull();
    expect(r!.texturePath).toBe('minecraft:textures/block/furnace_side.png');
    expect(r!.incomplete).toBe(false);
    expect(r!.faces.nz).toBe('minecraft:textures/block/furnace_front.png');
  });
});
