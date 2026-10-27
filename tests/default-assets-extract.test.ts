/**
 * Regression test: the real vanilla 1.20.5 asset tree must resolve the
 * phantommarket-f64 palette to textures. The fixture extract under
 * tests/fixtures/default-assets-extract/ is the minimal subset of
 * public/default-assets/ needed by those palette entries (blockstates,
 * full parent chains, textures) — regenerate with the prepare script plus
 * wantedPathsForPalette if the palette grows.
 *
 * This guards the bugs this chain had: namespaced model refs
 * ("minecraft:block/furnace"), object texture values
 * ({ "line": { "sprite": … } }), pipe alternation in multipart "when"
 * ("side|up"), and models never being fetched by the ensure loop.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRemoteSource, treeFromRemote, pendingPaths, wantedPathsForPalette, type RemoteSource } from '../src/textures/remote.js';
import { resolveBlockstate } from '../src/textures/atlas.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACT = join(HERE, 'fixtures', 'default-assets-extract');

const PALETTE = [
  'minecraft:grass_block[snowy=false]',
  'minecraft:lever[face=wall,facing=west,powered=true]',
  'minecraft:oak_wall_sign[facing=west,waterlogged=false]',
  'minecraft:dirt',
  'minecraft:smooth_stone',
  'minecraft:oak_hanging_sign[attached=true,rotation=4,waterlogged=false]',
  'minecraft:redstone_wire[east=side,north=none,power=14,south=up,west=none]',
  'minecraft:redstone_wire[east=side,north=up,power=12,south=none,west=none]',
  'minecraft:redstone_wire[east=none,north=side,power=15,south=up,west=none]',
  'minecraft:redstone_wire[east=none,north=up,power=13,south=side,west=none]',
  'minecraft:redstone_wire[east=none,north=side,power=15,south=side,west=none]',
  'minecraft:redstone_wire[east=none,north=side,power=14,south=side,west=none]',
  'minecraft:redstone_wire[east=none,north=side,power=9,south=side,west=none]',
  'minecraft:redstone_wire[east=none,north=side,power=8,south=side,west=none]',
  'minecraft:redstone_wire[east=side,north=none,power=12,south=none,west=side]',
  'minecraft:redstone_wire[east=side,north=none,power=10,south=none,west=side]',
  'minecraft:redstone_wire[east=none,north=none,power=11,south=up,west=side]',
  'minecraft:redstone_wire[east=none,north=up,power=9,south=none,west=side]',
  'minecraft:redstone_wire[east=up,north=none,power=13,south=none,west=side]',
  'minecraft:redstone_wire[east=up,north=none,power=11,south=none,west=side]',
  'minecraft:chest[facing=west,type=right,waterlogged=false]',
  'minecraft:chest[facing=west,type=left,waterlogged=false]',
  'minecraft:powered_rail[powered=true,shape=east_west,waterlogged=false]',
  'minecraft:hopper[enabled=true,facing=down]',
  'minecraft:hopper[enabled=true,facing=west]',
  'minecraft:hopper[enabled=true,facing=south]',
  'minecraft:hopper[enabled=true,facing=north]',
  'minecraft:furnace[facing=north,lit=true]',
  'minecraft:furnace[facing=south,lit=true]',
  'minecraft:furnace[facing=north,lit=false]',
  'minecraft:furnace[facing=south,lit=false]',
  'minecraft:redstone_wall_torch[facing=west,lit=true]',
];

async function extractSource(): Promise<RemoteSource> {
  const manifest = JSON.parse(
    readFileSync(join(EXTRACT, 'manifest.json'), 'utf8'),
  ) as { files: string[] };
  const source = createRemoteSource(manifest.files, async (p) => readFileSync(join(EXTRACT, p)));
  // Same warm loop the viewer runs: blockstates -> models -> parents -> textures.
  for (let pass = 0; pass < 8; pass++) {
    const wanted = wantedPathsForPalette(source, PALETTE);
    if (pendingPaths(source, wanted).length === 0) break;
    await source.ensure(wanted);
  }
  return source;
}

describe('default-assets extract (real 1.20.5 tree)', () => {
  it('resolves >= 90% of the palette to a present texture', async () => {
    const source = await extractSource();
    let resolved = 0;
    const failures: string[] = [];
    for (const entry of PALETTE) {
      const r = resolveBlockstate(entry, treeFromRemote(source));
      const usable = !!r && !r.incomplete && !!r.texturePath && source.has(r.texturePath);
      if (usable) resolved++;
      else failures.push(entry);
    }
    expect(failures, 'unresolved entries').toEqual([]);
    expect(resolved / PALETTE.length).toBeGreaterThanOrEqual(0.9);
  });

  it('namespaced model refs resolve (minecraft:block/furnace)', async () => {
    const source = await extractSource();
    const r = resolveBlockstate('minecraft:furnace[facing=north,lit=false]', treeFromRemote(source));
    expect(r).not.toBeNull();
    expect(r!.texturePath).toBe('minecraft:textures/block/furnace_side.png');
    expect(r!.faces.nz).toBe('minecraft:textures/block/furnace_front.png');
  });

  it('pipe alternation in multipart when matches ("side|up")', async () => {
    const source = await extractSource();
    const tree = treeFromRemote(source);
    // Only "side" connections: matches only via the pipe-form conditions.
    const r = resolveBlockstate(
      'minecraft:redstone_wire[east=none,north=side,power=9,south=side,west=none]',
      tree,
    );
    expect(r).not.toBeNull();
    expect(r!.texturePath).toBe('minecraft:textures/block/redstone_dust_dot.png');
  });

  it('object sprite values resolve ({ "line": { sprite } })', async () => {
    const source = await extractSource();
    const r = resolveBlockstate(
      'minecraft:redstone_wire[east=none,north=up,power=9,south=none,west=side]',
      treeFromRemote(source),
    );
    expect(r).not.toBeNull();
    expect(r!.texturePath).toBe('minecraft:textures/block/redstone_dust_dot.png');
  });
});
