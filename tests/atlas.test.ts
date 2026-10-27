import { describe, expect, it } from 'vitest';
import type { AssetsTree } from '../src/textures/atlas.js';
import { normalizeTexturePath, parsePaletteEntry, resolveBlockstate } from '../src/textures/atlas.js';
import { boxFaceUVs } from '../src/textures/faces.js';
import { BLOCK_COLORS, colorForBlock, fallbackColor } from '../src/render/colors.js';

/**
 * Minimal fake assets tree, shaped like minecraft.jar/assets. Includes:
 * - hopper: multi-property variants (enabled × facing)
 * - grass_block: two-state variants + parent chain with "#ref" textures
 *   (cube_bottom_top → cube), exercising parent merge and ref resolution
 * - a stripped hopper_top model that is present as texture but whose model
 *   chain is broken (missing parent) → resolver must return null
 */
const FIXTURE: AssetsTree = new Map<string, unknown>([
  [
    'minecraft/blockstates/hopper.json',
    {
      variants: {
        'enabled=true,facing=down': { model: 'block/hopper' },
        'enabled=true,facing=north': { model: 'block/hopper_side' },
        'enabled=true,facing=east': { model: 'block/hopper_side', y: 90 },
        'enabled=false,facing=down': { model: 'block/hopper' },
      },
    },
  ],
  [
    'minecraft/models/block/hopper.json',
    {
      parent: 'block/hopper_inside',
      textures: { particle: 'block/hopper_outside', top: 'block/hopper_top', side: 'block/hopper_outside' },
    },
  ],
  ['minecraft/models/block/hopper_inside.json', { textures: { inside: 'block/hopper_inside' } }],
  [
    'minecraft/models/block/hopper_side.json',
    { parent: 'block/hopper', textures: { side: 'block/hopper_side' } },
  ],
  [
    'minecraft/blockstates/grass_block.json',
    {
      variants: {
        'snowy=false': { model: 'block/grass_block' },
        'snowy=true': { model: 'block/grass_block_snow' },
      },
    },
  ],
  [
    'minecraft/models/block/grass_block.json',
    {
      parent: 'block/cube_bottom_top',
      textures: {
        particle: 'block/dirt',
        bottom: 'block/dirt',
        top: 'block/grass_block_top',
        side: 'block/grass_block_side',
      },
    },
  ],
  [
    'minecraft/models/block/grass_block_snow.json',
    { parent: 'block/cube_bottom_top', textures: { particle: 'block/snow', top: 'block/snow', side: 'block/grass_block_snow_side', bottom: 'block/dirt' } },
  ],
  [
    // Vanilla chain: cube_bottom_top maps #refs per face onto cube's keys.
    'minecraft/models/block/cube_bottom_top.json',
    {
      parent: 'block/cube',
      textures: {
        particle: '#top',
        down: '#bottom',
        up: '#top',
        north: '#side',
        east: '#side',
        south: '#side',
        west: '#side',
      },
    },
  ],
  [
    'minecraft/models/block/cube.json',
    {
      textures: {
        particle: '#particle',
        down: '#down',
        up: '#up',
        north: '#north',
        east: '#east',
        south: '#south',
        west: '#west',
      },
    },
  ],
  [
    'minecraft/blockstates/broken.json',
    { variants: { '': { model: 'block/broken_model' } } },
  ],
  [
    'minecraft/models/block/broken_model.json',
    { parent: 'block/does_not_exist', textures: { all: 'block/broken' } },
  ],
  [
    'minecraft/blockstates/dangling.json',
    { variants: { '': { model: 'block/dangling' } } },
  ],
  [
    'minecraft/models/block/dangling.json',
    { textures: { all: '#missing', particle: 'block/dirt' } },
  ],
]);

// Textures that "exist" as PNGs in the fake tree.
const PRESENT = [
  'block/hopper_outside',
  'block/hopper_top',
  'block/hopper_inside',
  'block/hopper_side',
  'block/dirt',
  'block/snow',
].map((p) => normalizeTexturePath(p, 'minecraft'));
// grass_block textures are deliberately absent → incomplete=true path.

function treeWithTextures(): AssetsTree {
  return new Map<string, unknown>([...FIXTURE, ...PRESENT.map((p): [string, unknown] => [p, {}])]);
}

describe('parsePaletteEntry', () => {
  it('splits base id and state properties', () => {
    expect(parsePaletteEntry('hopper[enabled=true,facing=north]')).toEqual({
      namespace: 'minecraft',
      base: 'hopper',
      props: { enabled: 'true', facing: 'north' },
    });
  });
  it('defaults the namespace and tolerates a missing bracket', () => {
    expect(parsePaletteEntry('minecraft:stone')).toEqual({
      namespace: 'minecraft',
      base: 'stone',
      props: {},
    });
  });
});

describe('resolveBlockstate', () => {
  it('grass_block[snowy=false] resolves its top face to grass_block_top (exact)', () => {
    const r = resolveBlockstate('grass_block[snowy=false]', FIXTURE);
    expect(r).not.toBeNull();
    // The spec-critical exact assert: snowy=false → the top face samples
    // grass_block_top.
    expect(r!.faces.py).toBe('minecraft:textures/block/grass_block_top.png');
    // The primary texture follows key priority: side beats top.
    expect(r!.texturePath).toBe('minecraft:textures/block/grass_block_side.png');
    expect(r!.uvHint).toBe('side');
  });

  it('grass_block[snowy=true] resolves to the snowy model instead', () => {
    const r = resolveBlockstate('grass_block[snowy=true]', FIXTURE);
    expect(r!.faces.py).toBe('minecraft:textures/block/snow.png');
    expect(r!.faces.px).toBe('minecraft:textures/block/grass_block_snow_side.png');
  });
  it('matches multi-property variants exactly (hopper facing=north)', () => {
    const r = resolveBlockstate('hopper[enabled=true,facing=north]', treeWithTextures());
    expect(r!.texturePath).toBe('minecraft:textures/block/hopper_side.png');
    expect(r!.faces.nz).toBe('minecraft:textures/block/hopper_side.png');
    expect(r!.faces.py).toBe('minecraft:textures/block/hopper_top.png');
    expect(r!.incomplete).toBe(false);
  });

  it('falls back to the down variant when only some props are keyed', () => {
    const r = resolveBlockstate('hopper[enabled=true,facing=down,extra=noise]', treeWithTextures());
    // The base hopper model (side = hopper_outside), not the side variant.
    expect(r!.faces.nz).toBe('minecraft:textures/block/hopper_outside.png');
    expect(r!.faces.py).toBe('minecraft:textures/block/hopper_top.png');
  });

  it('flags incomplete when a resolved texture is absent from the tree', () => {
    const r = resolveBlockstate('grass_block[snowy=false]', treeWithTextures());
    // The path is still resolved; only membership in the atlas is missing.
    expect(r!.faces.py).toBe('minecraft:textures/block/grass_block_top.png');
    expect(r!.incomplete).toBe(true); // grass_block_side.png absent
    const full = resolveBlockstate('hopper[enabled=true,facing=north]', treeWithTextures());
    expect(full!.incomplete).toBe(false);
  });

  it('resolves #refs through the parent chain', () => {
    // hopper has no explicit "down"/"bottom"; nothing dangles, all faces
    // resolve via side/top keys.
    const r = resolveBlockstate('hopper[enabled=false,facing=down]', treeWithTextures());
    expect(r!.faces.px).toBe('minecraft:textures/block/hopper_outside.png');
  });

  it('returns null for missing blockstate; missing parent is terminal, not fatal', () => {
    expect(resolveBlockstate('minecraft:not_a_block', FIXTURE)).toBeNull();
    // parent block/does_not_exist has no file: chain ends there, but the
    // model's own textures still resolve (mirrors vanilla builtin/* parents).
    const r = resolveBlockstate('minecraft:broken', FIXTURE);
    expect(r).not.toBeNull();
    expect(r!.texturePath).toBe('minecraft:textures/block/broken.png');
  });

  it('ignores dangling #refs and uses a lower-priority key instead', () => {
    const r = resolveBlockstate('minecraft:dangling', treeWithTextures());
    expect(r!.texturePath).toBe('minecraft:textures/block/dirt.png');
    // "#missing" resolves to "" so 'all' is skipped; particle wins.
    expect(r!.uvHint).toBe('particle');
  });
});

describe('boxFaceUVs', () => {
  const rect = { u0: 0, v0: 0.75, u1: 0.0625, v1: 0.8125 };

  it('maps every face into its rect and stays inside [0,1]', () => {
    const uv = boxFaceUVs(
      { px: rect, nx: rect, py: rect, ny: rect, pz: rect, nz: rect },
      null,
    )!;
    expect(uv.length).toBe(48);
    for (let i = 0; i < uv.length; i++) {
      expect(uv[i]!).toBeGreaterThanOrEqual(0);
      expect(uv[i]!).toBeLessThanOrEqual(1);
    }
    // First face, first corner = (u0, v1): uv (0,1) maps to the rect's
    // v1 edge (rects are stored in texture space, flipY handled by three).
    expect(uv[0]).toBeCloseTo(rect.u0);
    expect(uv[1]).toBeCloseTo(rect.v1);
  });

  it('falls back per face and returns null when nothing resolves', () => {
    const uv = boxFaceUVs({ py: rect }, rect);
    expect(uv).not.toBeNull();
    // px face fell back to the primary rect.
    expect(uv![0]).toBeCloseTo(rect.u0);
    expect(boxFaceUVs({ px: null, nx: null, py: null, ny: null, pz: null, nz: null }, null)).toBeNull();
  });
});

describe('fallback colors (texture-less types)', () => {
  it('fallbackColor is deterministic and explicit for unmapped ids', () => {
    expect(fallbackColor('minecraft:weird_thing')).toBe(fallbackColor('minecraft:weird_thing'));
    expect(fallbackColor('a')).not.toBe(fallbackColor('b'));
    expect(colorForBlock('minecraft:weird_thing')).toBe(fallbackColor('minecraft:weird_thing'));
  });

  it('table entries win over the fallback', () => {
    for (const [id, color] of Object.entries(BLOCK_COLORS)) {
      expect(colorForBlock(id)).toBe(color);
    }
  });
});

describe('planAtlas (loader layout)', () => {
  it('is deterministic, square, power-of-two and big enough', async () => {
    const { planAtlas } = await import('../src/textures/loader.js');
    for (let n = 1; n <= 300; n++) {
      const plan = planAtlas(n, 16);
      expect(plan.size).toBeGreaterThanOrEqual(n > 0 ? 16 : 16);
      expect(Math.log2(plan.size) % 1).toBe(0);
      expect(plan.cols * plan.rows).toBeGreaterThanOrEqual(n);
      expect(plan.cols).toBeLessThanOrEqual(plan.rows + 1);
    }
    expect(planAtlas(1, 16)).toMatchObject({ cols: 1, rows: 1, size: 16, cell: 16 });
    expect(planAtlas(64, 16)).toMatchObject({ cols: 8, rows: 8, size: 128, cell: 16 });
  });
});
