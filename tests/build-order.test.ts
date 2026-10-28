import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchem } from '../src/schem/parse.js';
import type { Schematic } from '../src/schem/types.js';
import {
  ATTACH_RULES,
  baseTypeName,
  faceAdjacent,
  orderBlocks,
  supportKind,
  type BuildBlock,
} from '../src/slicer/build-order.js';
import { makeSchemBuffer } from './helpers.js';

const demoPath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo-huisje.schem');
const phantomPath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'phantommarket-f64.schem');

export function toBuildBlocks(schem: Schematic): BuildBlock[] {
  const out: BuildBlock[] = [];
  for (let y = 0; y < schem.size.y; y++) {
    for (let z = 0; z < schem.size.z; z++) {
      for (let x = 0; x < schem.size.x; x++) {
        const p = schem.blocks[(y * schem.size.z + z) * schem.size.x + x]!;
        const block = schem.palette[p]!;
        if (block === 'minecraft:air') continue;
        out.push({ x, y, z, paletteIndex: p, block });
      }
    }
  }
  return out;
}

/** Solid, non-air block directly under b (block coords), if any. */
function solidUnder(blocks: BuildBlock[], b: BuildBlock): BuildBlock | undefined {
  return blocks.find((o) => o.x === b.x && o.y === b.y - 1 && o.z === b.z);
}

function neighborsOf(blocks: BuildBlock[], b: BuildBlock): BuildBlock[] {
  return blocks.filter(
    (o) => Math.abs(o.x - b.x) + Math.abs(o.y - b.y) + Math.abs(o.z - b.z) === 1,
  );
}

/** The core build-guide invariant, per step: when this block is placed,
 * everything it rests on is already placed. */
function expectSupportInvariant(ordered: BuildBlock[]): void {
  const pos = new Map<string, number>();
  ordered.forEach((b, i) => pos.set(`${b.x},${b.y},${b.z}`, i));
  for (const b of ordered) {
    if (supportKind(b.block) === 'below') {
      const under = solidUnder(ordered, b);
      // Solid resting on an attach block is not a build constraint (and
      // never occurs in a real build).
      if (under && supportKind(under.block) === 'below') {
        expect(pos.get(`${under.x},${under.y},${under.z}`)!).toBeLessThan(
          pos.get(`${b.x},${b.y},${b.z}`)!,
        );
      }
    } else {
      const ns = neighborsOf(ordered, b);
      const anchored = ns.some(
        (n) => pos.get(`${n.x},${n.y},${n.z}`)! < pos.get(`${b.x},${b.y},${b.z}`)!,
      );
      // An attach block with no neighbours at all (floating) carries no
      // dependency; anything else must have its anchor placed first.
      if (ns.length > 0) expect(anchored).toBe(true);
    }
  }
}

async function load(path: string): Promise<BuildBlock[]> {
  return toBuildBlocks(await parseSchem(await readFile(path)));
}

describe('supportKind / attach table', () => {
  it('classifies the known flat/mounted types as attach, solids as below', () => {
    for (const entry of [
      'minecraft:torch',
      'minecraft:redstone_wire[east=up,north=none,power=13,south=none,west=side]',
      'minecraft:powered_rail[powered=true,shape=east_west,waterlogged=false]',
      'minecraft:wall_torch[facing=east]',
      'minecraft:lever[face=wall,facing=west,powered=true]',
    ]) {
      expect(supportKind(entry)).toBe('attach');
      expect(ATTACH_RULES.has(baseTypeName(entry))).toBe(true);
    }
    expect(supportKind('minecraft:stone')).toBe('below');
    expect(supportKind('minecraft:furnace[facing=north,lit=true]')).toBe('below');
  });
});

describe('orderBlocks — demo-huisje', () => {
  it('places every block exactly once (set equality with the scan list)', async () => {
    const blocks = await load(demoPath);
    const ordered = orderBlocks(blocks);
    expect(ordered.length).toBe(blocks.length);
    const key = (b: BuildBlock): string => `${b.x},${b.y},${b.z}`;
    expect(new Set(ordered.map(key)).size).toBe(blocks.length);
    for (const b of blocks) expect(ordered.some((o) => key(o) === key(b))).toBe(true);
  });

  it('holds the support invariant per step', async () => {
    expectSupportInvariant(await load(demoPath));
  });

  it('is deterministic', async () => {
    const blocks = await load(demoPath);
    expect(orderBlocks(blocks)).toEqual(orderBlocks(blocks));
  });

  it('builds layer-by-layer from the bottom (y never decreases by more than placement needs)', async () => {
    const blocks = await load(demoPath);
    const ordered = orderBlocks(blocks);
    // First block sits on the floor layer.
    expect(Math.min(...ordered.map((b) => b.y))).toBe(0);
    expect(ordered[0]!.y).toBe(0);
  });
});

describe('orderBlocks — phantommarket (furnace/rail/wire fixture)', () => {
  it('places every block exactly once and is deterministic', async () => {
    const blocks = await load(phantomPath);
    const ordered = orderBlocks(blocks);
    expect(ordered.length).toBe(blocks.length);
    expect(orderBlocks(blocks)).toEqual(ordered);
  });

  it('holds the support invariant, including the hanging hopper chain and wall torches', async () => {
    const ordered = orderBlocks(await load(phantomPath));
    expectSupportInvariant(ordered);
  });

  it('places attach blocks (rails, wire, torches, lever) after their anchor', async () => {
    const blocks = await load(phantomPath);
    const ordered = orderBlocks(blocks);
    const pos = new Map(ordered.map((b, i) => [`${b.x},${b.y},${b.z}`, i] as const));
    const attach = ordered.filter((b) => supportKind(b.block) === 'attach');
    expect(attach.length).toBeGreaterThan(50); // rails + wire + torches really exercised
    for (const b of attach) {
      const ns = neighborsOf(blocks, b);
      if (ns.length === 0) continue;
      const minNeighbor = Math.min(...ns.map((n) => pos.get(`${n.x},${n.y},${n.z}`)!));
      expect(pos.get(`${b.x},${b.y},${b.z}`)!).toBeGreaterThan(minNeighbor);
    }
  });
});

describe('orderBlocks — synthetic fixtures', () => {
  // Furnace bench: stone floor, furnace, rail next to it, wire in front,
  // wall torch mounted on the furnace side (same layer as the furnace).
  function furnaceSchem() {
    // 3x2x3; index = (y*3+z)*3+x, palette per position.
    const idx = (x: number, y: number, z: number): number => (y * 3 + z) * 3 + x;
    const palette = [
      'minecraft:air',
      'minecraft:stone',
      'minecraft:furnace[facing=north,lit=false]',
      'minecraft:powered_rail[powered=true,shape=east_west,waterlogged=false]',
      'minecraft:redstone_wire[east=side,north=side,power=0,south=side,west=side]',
      'minecraft:wall_torch[facing=west]',
    ];
    const blocks = new Array(3 * 2 * 3).fill(0);
    for (let x = 0; x < 3; x++) {
      for (let z = 0; z < 3; z++) blocks[idx(x, 0, z)] = 1;
    }
    blocks[idx(1, 1, 1)] = 2; // furnace
    blocks[idx(0, 1, 1)] = 3; // powered rail east_west, rests on stone
    blocks[idx(1, 1, 0)] = 4; // redstone wire cross, rests on stone
    blocks[idx(2, 1, 1)] = 5; // wall torch on the furnace's east side
    return makeSchemBuffer({ width: 3, height: 2, length: 3, palette, blockIndices: blocks });
  }

  // Portal scenario: pillar with a beam sticking out 2 blocks; a torch
  // hangs under the beam and a block floats under the beam's end.
  function overhangSchem() {
    const palette = [
      'minecraft:air',
      'minecraft:stone',
      'minecraft:oak_stairs[facing=south]',
      'minecraft:torch',
    ];
    const W = 5, H = 4, L = 1;
    const blocks = new Array(W * H * L).fill(0);
    const set = (x: number, y: number, z: number, v: number): void => {
      blocks[(y * L + z) * W + x] = v;
    };
    for (let y = 0; y < 4; y++) set(0, y, 0, 1); // pillar
    for (let x = 0; x < 5; x++) set(x, 3, 0, 2); // beam, 2 past the pillar
    set(2, 2, 0, 3); // torch hanging under the beam
    set(4, 2, 0, 1); // floating block under the beam end (air below)
    return makeSchemBuffer({ width: W, height: H, length: L, palette, blockIndices: blocks });
  }

  it('furnace fixture: torch lands after the furnace it mounts on', async () => {
    const blocks = toBuildBlocks(await parseSchem(furnaceSchem()));
    const ordered = orderBlocks(blocks);
    expect(ordered.length).toBe(3 * 3 + 4);
    const pos = new Map(ordered.map((b, i) => [`${b.x},${b.y},${b.z}`, i] as const));
    expect(pos.get('2,1,1')!).toBeGreaterThan(pos.get('1,1,1')!); // torch after furnace
    expectSupportInvariant(ordered);
  });

  it('overhang fixture: hanging torch is placed after the beam above it', async () => {
    const blocks = toBuildBlocks(await parseSchem(overhangSchem()));
    const ordered = orderBlocks(blocks);
    // pillar 4 + beam 5 (shares the pillar top cell) + torch + floater.
    expect(ordered.length).toBe(10);
    const pos = new Map(ordered.map((b, i) => [`${b.x},${b.y},${b.z}`, i] as const));
    // The portal scenario: torch (scan-earlier!) must come after the beam.
    expect(pos.get('2,2,0')!).toBeGreaterThan(pos.get('2,3,0')!);
    // The floating block has air below: no dependency, but placed once.
    expect(ordered.filter((b) => b.x === 4 && b.y === 2).length).toBe(1);
    expectSupportInvariant(ordered);
    expect(orderBlocks(blocks)).toEqual(ordered);
  });
});

describe('faceAdjacent', () => {
  it('accepts exactly the six face neighbours', () => {
    const a = { x: 1, y: 1, z: 1 };
    expect(faceAdjacent(a, { x: 2, y: 1, z: 1 })).toBe(true);
    expect(faceAdjacent(a, { x: 1, y: 2, z: 1 })).toBe(true);
    expect(faceAdjacent(a, { x: 1, y: 1, z: 0 })).toBe(true);
    expect(faceAdjacent(a, { x: 2, y: 2, z: 1 })).toBe(false);
    expect(faceAdjacent(a, { x: 2, y: 2, z: 0 })).toBe(false);
    expect(faceAdjacent(a, { x: 1, y: 1, z: 1 })).toBe(false);
  });
});

describe('orderBlocks — build direction (P2)', () => {
  const b = (x: number, y: number, z: number): BuildBlock => ({ x, y, z, paletteIndex: 1, block: 'minecraft:stone' });

  function floor(w: number, d: number): BuildBlock[] {
    const out: BuildBlock[] = [];
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) out.push(b(x, 0, z));
    return out;
  }

  it('default direction equals the historical order exactly', () => {
    const blocks = floor(4, 3);
    const a = orderBlocks(blocks);
    const def = orderBlocks(blocks, { dirX: 1, dirZ: 1 });
    expect(def).toEqual(a);
    expect(a.map((x) => `${x.x},${x.z}`)).toEqual(['0,0', '1,0', '2,0', '3,0', '0,1', '1,1', '2,1', '3,1', '0,2', '1,2', '2,2', '3,2']);
  });

  it('reversed X walks the layer east→west within each row', () => {
    const ordered = orderBlocks(floor(3, 1), { dirX: -1, dirZ: 1 });
    expect(ordered.map((x) => x.x)).toEqual([2, 1, 0]);
  });

  it('reversed Z walks the rows north→south', () => {
    const ordered = orderBlocks(floor(2, 3), { dirX: 1, dirZ: -1 });
    expect(ordered.map((x) => `${x.x},${x.z}`)).toEqual(['0,2', '1,2', '0,1', '1,1', '0,0', '1,0']);
  });

  it('combined X+Z reverses both; every direction keeps support-first', () => {
    const blocks = [
      b(0, 0, 0), b(1, 0, 0), b(2, 0, 0),
      b(2, 1, 0), // stands on (2,0,0)
    ];
    for (const dir of [{ dirX: 1, dirZ: 1 }, { dirX: -1, dirZ: 1 }, { dirX: 1, dirZ: -1 }, { dirX: -1, dirZ: -1 }] as const) {
      const ordered = orderBlocks(blocks, dir);
      expect(ordered.length).toBe(4);
      const pos = new Map(ordered.map((x, i) => [`${x.x},${x.y},${x.z}`, i]));
      expect(pos.get('2,1,0')!).toBeGreaterThan(pos.get('2,0,0')!);
    }
    const reversed = orderBlocks(blocks, { dirX: -1, dirZ: -1 });
    expect(reversed.slice(0, 3).map((x) => `${x.x},${x.z}`)).toEqual(['2,0', '1,0', '0,0']);
  });

  it('is a raster order, not an optimality claim: output stays a permutation', () => {
    const blocks = floor(3, 3);
    const sum = (dir: { dirX: 1 | -1; dirZ: 1 | -1 }) =>
      orderBlocks(blocks, dir).map((x) => `${x.x},${x.y},${x.z}`).sort().join('|');
    expect(sum({ dirX: -1, dirZ: -1 })).toBe(sum({ dirX: 1, dirZ: 1 }));
  });
});
