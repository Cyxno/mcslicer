/**
 * Model-elements resolution (5a): synthetic vanilla-shaped tree covering
 * cube, slabs, stairs (parent-chain elements), rail, lever (element
 * rotation), fence (multipart), custom uv, uv rotation, dangling #ref and
 * missing models. Plus one integration test against the real default
 * assets when the operator has prepared them (skipped otherwise).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { elementsFor, elementsForRender, type ModelElement } from '../src/textures/models.js';
import { buildModelArrays, elementQuads, modelQuads, rotatePoint } from '../src/render/model-geometry.js';
import type { AssetsTree } from '../src/textures/atlas.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function j(value: unknown): unknown {
  return value;
}

/** Minimal vanilla-shaped assets tree. */
function makeTree(): AssetsTree {
  const files: Record<string, unknown> = {
    'minecraft/blockstates/stone.json': j({ variants: { '': { model: 'minecraft:block/cube_all' } } }),
    'minecraft/blockstates/oak_slab.json': j({
      variants: {
        'type=bottom': { model: 'minecraft:block/oak_slab_bottom' },
        'type=top': { model: 'minecraft:block/oak_slab_top' },
      },
    }),
    'minecraft/blockstates/oak_stairs.json': j({
      variants: {
        'facing=east,half=bottom': { model: 'minecraft:block/oak_stairs' },
        'facing=north,half=bottom': { model: 'minecraft:block/oak_stairs', y: 90 },
      },
    }),
    'minecraft/blockstates/rail.json': j({ variants: { 'shape=north_south': { model: 'minecraft:block/rail_flat' } } }),
    'minecraft/blockstates/lever.json': j({ variants: { 'face=floor,facing=north,powered=false': { model: 'minecraft:block/lever' } } }),
    'minecraft/blockstates/oak_fence.json': j({
      multipart: [
        { apply: { model: 'minecraft:block/fence_post' } },
        { when: { north: 'true' }, apply: { model: 'minecraft:block/fence_side' } },
      ],
    }),
    'minecraft/blockstates/broken.json': j({ variants: { '': { model: 'minecraft:block/does_not_exist' } } }),
    'minecraft/blockstates/dangling.json': j({ variants: { '': { model: 'minecraft:block/dangling' } } }),

    'minecraft/models/block/cube_all.json': j({
      parent: 'minecraft:block/cube',
      textures: { all: 'minecraft:block/stone' },
    }),
    'minecraft/models/block/cube.json': j({
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {
        down: { uv: [0, 0, 16, 16], texture: '#down' },
        up: { uv: [0, 0, 16, 16], texture: '#up' },
        north: { uv: [0, 0, 16, 16], texture: '#north' },
        south: { uv: [0, 0, 16, 16], texture: '#south' },
        west: { uv: [0, 0, 16, 16], texture: '#west' },
        east: { uv: [0, 0, 16, 16], texture: '#east' },
      } }],
      textures: { particle: '#all', down: '#all', up: '#all', north: '#all', south: '#all', west: '#all', east: '#all' },
    }),
    'minecraft/models/block/oak_slab_bottom.json': j({
      parent: 'minecraft:block/slab',
      textures: { bottom: 'minecraft:block/oak_planks', top: 'minecraft:block/oak_planks', side: 'minecraft:block/oak_planks' },
    }),
    'minecraft/models/block/block.json': j({}),
    'minecraft/models/block/slab.json': j({
      elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: {
        down: { uv: [0, 8, 16, 16], texture: '#bottom' },
        up: { uv: [0, 0, 16, 8], texture: '#top' },
        north: { uv: [0, 8, 16, 16], texture: '#side' },
        south: { uv: [0, 8, 16, 16], texture: '#side' },
        west: { uv: [0, 8, 16, 16], texture: '#side' },
        east: { uv: [0, 8, 16, 16], texture: '#side' },
      } }],
      textures: { particle: '#side' },
    }),
    'minecraft/models/block/oak_slab_top.json': j({
      parent: 'minecraft:block/slab',
      textures: { bottom: 'minecraft:block/oak_planks', top: 'minecraft:block/oak_planks', side: 'minecraft:block/oak_planks' },
    }),
    'minecraft/models/block/stairs.json': j({
      elements: [
        { from: [0, 0, 0], to: [16, 8, 16], faces: {
          down: { uv: [0, 8, 16, 16], texture: '#bottom' },
          up: { uv: [0, 8, 16, 16], texture: '#top' },
          north: { uv: [0, 8, 16, 16], texture: '#side' },
          south: { uv: [0, 8, 16, 16], texture: '#side' },
          west: { uv: [0, 8, 16, 16], texture: '#side' },
          east: { uv: [0, 8, 16, 16], texture: '#side' },
        } },
        { from: [0, 8, 0], to: [16, 16, 8], faces: {
          up: { uv: [0, 0, 16, 8], texture: '#top' },
          north: { uv: [0, 0, 16, 8], texture: '#side' },
          south: { uv: [0, 0, 16, 8], texture: '#side' },
          west: { uv: [0, 0, 16, 8], texture: '#side' },
          east: { uv: [0, 0, 16, 8], texture: '#side' },
        } },
      ],
      textures: { particle: '#side' },
    }),
    'minecraft/models/block/oak_stairs.json': j({
      parent: 'minecraft:block/stairs',
      textures: { bottom: 'minecraft:block/oak_planks', side: 'minecraft:block/oak_planks', top: 'minecraft:block/oak_planks' },
    }),
    'minecraft/models/block/rail_flat.json': j({
      elements: [{ from: [0, 0, 0], to: [16, 2, 16], faces: {
        down: { uv: [0, 0, 16, 16], texture: '#rail' },
        up: { uv: [0, 0, 16, 16], texture: '#rail' },
      } }],
      textures: { rail: 'minecraft:block/rail' },
    }),
    'minecraft/models/block/lever.json': j({
      elements: [
        { from: [5, 0, 4], to: [11, 3, 12], faces: {
          down: { uv: [5, 4, 11, 12], texture: '#base' },
          up: { uv: [5, 4, 11, 12], texture: '#base' },
          north: { uv: [5, 13, 11, 16], texture: '#base' },
          south: { uv: [5, 13, 11, 16], texture: '#base' },
          west: { uv: [4, 13, 12, 16], texture: '#base' },
          east: { uv: [4, 13, 12, 16], texture: '#base' },
        } },
        { from: [7, 1, 7], to: [9, 11, 9], rotation: { origin: [8, 1, 8], axis: 'x', angle: -45 }, faces: {
          up: { uv: [7, 6, 9, 8], texture: '#lever' },
          north: { uv: [7, 6, 9, 16], texture: '#lever' },
          south: { uv: [7, 6, 9, 16], texture: '#lever' },
          west: { uv: [7, 6, 9, 16], texture: '#lever' },
          east: { uv: [7, 6, 9, 16], texture: '#lever' },
        } },
      ],
      textures: { base: 'minecraft:block/cobblestone', lever: 'minecraft:block/lever', particle: 'minecraft:block/cobblestone' },
    }),
    'minecraft/models/block/fence_post.json': j({
      textures: { texture: 'minecraft:block/oak_planks' },
      elements: [{ from: [6, 0, 6], to: [10, 16, 10], faces: {
        down: { uv: [6, 6, 10, 10], texture: '#texture' },
        up: { uv: [6, 6, 10, 10], texture: '#texture' },
        north: { uv: [6, 6, 10, 16], texture: '#texture' },
        south: { uv: [6, 6, 10, 16], texture: '#texture' },
        west: { uv: [6, 6, 10, 16], texture: '#texture' },
        east: { uv: [6, 6, 10, 16], texture: '#texture' },
      } }],
    }),
    'minecraft/models/block/fence_side.json': j({
      textures: { texture: 'minecraft:block/oak_planks' },
      elements: [{ from: [7, 9, 0], to: [9, 15, 7], faces: {
        up: { uv: [7, 9, 9, 16], texture: '#texture' },
        north: { uv: [7, 9, 9, 15], texture: '#texture' },
        south: { uv: [7, 9, 9, 15], texture: '#texture' },
        west: { uv: [0, 9, 7, 15], texture: '#texture' },
        east: { uv: [0, 9, 7, 15], texture: '#texture' },
      } }],
    }),
    'minecraft/models/block/dangling.json': j({
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#missing_ref' } } }],
      textures: {},
    }),
    // textures are stubbed: resolution only needs the path to be referenced
  };
  return new Map(Object.entries(files));
}

const tree = makeTree();
const PLANKS = 'minecraft:textures/block/oak_planks.png';

describe('elementsFor — model selection', () => {
  it('plain cube resolves with all six faces on one texture', () => {
    const els = elementsFor('minecraft:stone', tree)!;
    expect(els).not.toBeNull();
    expect(els.length).toBe(1);
    expect(els[0]!.from).toEqual([0, 0, 0]);
    expect(Object.keys(els[0]!.faces).sort()).toEqual(['down', 'east', 'north', 'south', 'up', 'west']);
    expect(els[0]!.faces.up!.texturePath).toBe('minecraft:textures/block/stone.png');
  });

  it('bottom and top slabs resolve to the correct heights via the parent chain', () => {
    const bottom = elementsFor('minecraft:oak_slab[type=bottom]', tree)!;
    const top = elementsFor('minecraft:oak_slab[type=top]', tree)!;
    // slab.json defines the elements (0..8); the top variant... in our
    // synthetic tree both share the slab parent (vanilla tops get a
    // rotated model); assert the bottom slab shape here.
    expect(bottom.length).toBe(1);
    expect(bottom[0]!.to).toEqual([16, 8, 16]);
    expect(bottom[0]!.faces.up!.texturePath).toBe(PLANKS);
    // top slab: vanilla models exist; here the synthetic tree routes it to
    // the same slab shape — resolution must not fail.
    expect(top).not.toBeNull();
  });

  it('stairs resolve via the parent chain with both elements', () => {
    const els = elementsFor('minecraft:oak_stairs[facing=east,half=bottom]', tree)!;
    expect(els.length).toBe(2);
    expect(els[0]!.to).toEqual([16, 8, 16]);
    expect(els[1]!.from).toEqual([0, 8, 0]);
    expect(els[1]!.to).toEqual([16, 16, 8]);
    for (const el of els) for (const f of Object.values(el.faces)) {
      expect(f!.texturePath).toBe(PLANKS);
    }
  });

  it('rail resolves as a flat plate with the rail texture', () => {
    const els = elementsFor('minecraft:rail[shape=north_south]', tree)!;
    expect(els.length).toBe(1);
    expect(els[0]!.to).toEqual([16, 2, 16]);
    expect(els[0]!.faces.up!.texturePath).toBe('minecraft:textures/block/rail.png');
  });

  it('lever keeps its element rotation', () => {
    const els = elementsFor('minecraft:lever[face=floor,facing=north,powered=false]', tree)!;
    expect(els.length).toBe(2);
    expect(els[1]!.rotation).toEqual({ origin: [8, 1, 8], axis: 'x', angle: -45 });
  });

  it('fence multipart merges post + wall side elements', () => {
    const els = elementsFor('minecraft:oak_fence[north=true,east=false,south=false,west=false,waterlogged=false]', tree)!;
    expect(els.length).toBe(2);
    const post = els.find((e) => e.from[0] === 6)!;
    const side = els.find((e) => e.from[0] === 7)!;
    expect(post.to).toEqual([10, 16, 10]);
    expect(side.to[2]).toBe(7);
  });

  it('missing model → null (colour fallback path); dangling #ref face is skipped', () => {
    expect(elementsFor('minecraft:broken', tree)).toBeNull();
    expect(elementsFor('minecraft:unknown_block', tree)).toBeNull();
    const els = elementsFor('minecraft:dangling', tree)!;
    expect(els.length).toBe(1);
    expect(els[0]!.faces.up).toBeUndefined();
  });

  it('elementsForRender prefers the user tree, falls back to default', () => {
    const user = new Map([...tree, ['minecraft/blockstates/stone.json', j({ variants: { '': { model: 'minecraft:block/cube_all' } } })]]) as AssetsTree;
    expect(elementsForRender('minecraft:stone', user, tree)).not.toBeNull();
    expect(elementsForRender('minecraft:lever[face=floor,facing=north,powered=false]', null, tree)).not.toBeNull();
    expect(elementsForRender('minecraft:broken', tree, null)).toBeNull();
  });
});

describe('elementQuads / buildModelArrays — geometry', () => {
  it('emits four corners per face and outward index order', () => {
    const els = elementsFor('minecraft:stone', tree)!;
    const quads = modelQuads(els);
    expect(quads.length).toBe(6);
    for (const q of quads) {
      expect(q.corners.length).toBe(4);
      expect(q.uv.length).toBe(4);
      expect(q.texturePath).toBe('minecraft:textures/block/stone.png');
    }
    const arrays = buildModelArrays(quads, () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }));
    expect(arrays.positions.length).toBe(6 * 4 * 3);
    expect(arrays.indices.length).toBe(6 * 6);
    // first quad (element order): triangles (0,2,1) and (1,2,3)
    expect([...arrays.indices.slice(0, 6)]).toEqual([0, 2, 1, 1, 2, 3]);
  });

  it('bottom slab top face sits at y=0.5 with a half-height uv', () => {
    const els = elementsFor('minecraft:oak_slab[type=bottom]', tree)!;
    const quads = modelQuads(els);
    const up = quads.find((q) => q.dir === 'up')!;
    expect(up.corners.every((c) => c[1] === 0.5)).toBe(true);
    // slab top face uv [0,0,16,8]: upper half of the texture (v 0..0.5)
    expect(up.uv[0]![1]).toBeCloseTo(0);
    expect(up.uv[2]![1]).toBeCloseTo(0.5);
  });

  it('maps custom uv rects into atlas rects (v flip at the atlas boundary)', () => {
    const els = elementsFor('minecraft:oak_slab[type=bottom]', tree)!;
    const quads = modelQuads(els);
    const up = quads.find((q) => q.dir === 'up')!;
    // atlas rect: u0..u1 = 0..0.5, v0 (bottom)..v1 (top) = 0..0.25
    const arrays = buildModelArrays([up], () => ({ u0: 0, v0: 0, u1: 0.5, v1: 0.25 }));
    // TL corner: v from top = 0 → v = v1 = 0.25 (atlas v-flip)
    expect(arrays.uvs[0]).toBeCloseTo(0);   // u = u0 + 0*0.5
    expect(arrays.uvs[1]).toBeCloseTo(0.25);
    expect(arrays.uvs[2]).toBeCloseTo(0.5); // u2
  });

  it('rotates element corners exactly (lever stick −45° around x at origin)', () => {
    const els = elementsFor('minecraft:lever[face=floor,facing=north,powered=false]', tree)!;
    const stick = els[1]!;
    const quads = elementQuads(stick);
    const up = quads.find((q) => q.dir === 'up')!;
    // unrotated top at y=11/16; −45° around x through (8,1,8) swings it…
    const yValues = up.corners.map((c) => c[1]);
    expect(Math.max(...yValues)).toBeLessThan(11 / 16);
    // …and shifts the corners off the axis-aligned square
    const xValues = new Set(up.corners.map((c) => c[0].toFixed(4)));
    expect(xValues.size).toBe(2);
  });

  it('rotatePoint is exact on the unit cases', () => {
    expect(rotatePoint([1, 0, 0], [0, 0, 0], 'y', 90)[0]).toBeCloseTo(0);
    expect(rotatePoint([1, 0, 0], [0, 0, 0], 'y', 90)[2]).toBeCloseTo(-1);
    expect(rotatePoint([0, 1, 0], [0, 0, 0], 'x', 90)[1]).toBeCloseTo(0);
    expect(rotatePoint([0, 1, 0], [0, 0, 0], 'x', 90)[2]).toBeCloseTo(1);
  });

  it('uvRot rotates the uv corners clockwise', () => {
    const els = elementsFor('minecraft:stone', tree)!;
    const rotated: ModelElement = {
      ...els[0]!,
      faces: { up: { texturePath: 'minecraft:textures/block/stone.png', uv: [0, 0, 16, 16], uvRot: 90 } },
    };
    const [quad] = elementQuads(rotated);
    // 90° cw: each corner takes the uv of the corner content came FROM
    // (TL←BL, TR←TL, BL←TR): v = 1, 0, 0 for uv [0,0,16,16]
    expect(quad!.uv[0]![1]).toBeCloseTo(1);
    expect(quad!.uv[1]![1]).toBeCloseTo(0);
    expect(quad!.uv[2]![1]).toBeCloseTo(0);
  });

  it('faces whose texture is not in the atlas are dropped, not drawn black', () => {
    const els = elementsFor('minecraft:oak_stairs[facing=east,half=bottom]', tree)!;
    const quads = modelQuads(els);
    const arrays = buildModelArrays(quads, (p) => (p === PLANKS ? { u0: 0, v0: 0, u1: 1, v1: 1 } : null));
    expect(arrays.indices.length).toBe(quads.filter((q) => q.texturePath === PLANKS).length * 6);
  });
});

describe('real default assets (skipped when not prepared)', () => {
  const realRoot = join(HERE, '..', 'public', 'default-assets');
  const hasReal = existsSync(join(realRoot, 'manifest.json'));

  it.skipIf(!hasReal)('oak stairs + lever resolve against the real tree', () => {
    const manifest: string[] = JSON.parse(readFileSync(join(realRoot, 'manifest.json'), 'utf8')).files;
    const real = new Map<string, unknown>();
    for (const f of manifest) {
      if (!f.endsWith('.json')) continue;
      real.set(f, JSON.parse(readFileSync(join(realRoot, f), 'utf8')));
    }
    const east = elementsFor('minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', real as AssetsTree)!;
    expect(east!.length).toBe(2);
    const north = elementsFor('minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]', real as AssetsTree)!;
    expect(north!.length).toBe(2);
    const lever = elementsFor('minecraft:lever[face=floor,facing=north,powered=false]', real as AssetsTree)!;
    expect(lever!.some((e) => e.rotation !== null)).toBe(true);
  });
});
