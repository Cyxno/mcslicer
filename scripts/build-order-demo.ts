/**
 * Phase 4g part C — numbers report (pure, no UI, no browser).
 *
 * Prints, per fixture and per granularity: number of steps, average and
 * max blocks per step, and for the furnace fixture the contents of the
 * first five steps. Run: npm run report:build-order
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchem } from '../src/schem/parse.js';
import type { Schematic } from '../src/schem/types.js';
import { orderBlocks, baseTypeName, supportKind, type BuildBlock } from '../src/slicer/build-order.js';
import { CAP_OPTIONS, groupSteps, type CapOption } from '../src/slicer/step-groups.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

function toBuildBlocks(schem: Schematic): BuildBlock[] {
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

function overhangSchem(): Schematic {
  // Portal scenario, same shape as tests/build-order.test.ts: pillar +
  // beam sticking out 2 blocks, torch hanging under the beam, floater.
  const W = 5, H = 4, L = 1;
  const palette = ['minecraft:air', 'minecraft:stone', 'minecraft:oak_stairs[facing=south]', 'minecraft:torch'];
  const blocks = new Array(W * H * L).fill(0);
  const set = (x: number, y: number, z: number, v: number): void => {
    blocks[(y * L + z) * W + x] = v;
  };
  for (let y = 0; y < 4; y++) set(0, y, 0, 1);
  for (let x = 0; x < 5; x++) set(x, 3, 0, 2);
  set(2, 2, 0, 3);
  set(4, 2, 0, 1);
  return {
    size: { x: W, y: H, z: L },
    palette,
    blockCount: W * H * L,
    blocks: Int32Array.from(blocks),
    format: 'sponge-v3',
  };
}

function report(name: string, blocks: BuildBlock[]): void {
  console.log(`\n=== ${name} — ${blocks.length} blocks ===`);
  const attach = blocks.filter((b) => supportKind(b.block) === 'attach').length;
  console.log(`attach-type blocks (rails/wire/torches/…): ${attach}, solids: ${blocks.length - attach}`);
  for (const cap of CAP_OPTIONS) {
    const groups = groupSteps(orderBlocks(blocks), { cap });
    const counts = groups.map((g) => g.count);
    const avg = counts.reduce((a, c) => a + c, 0) / counts.length;
    console.log(
      `cap ${String(cap).padEnd(9)} stappen: ${String(groups.length).padStart(5)}` +
      ` · gem ${avg.toFixed(1).padStart(5)} blocks/stap` +
      ` · max ${String(Math.max(...counts)).padStart(3)}` +
      ` · 1-blocks stappen: ${counts.filter((c) => c === 1).length}`,
    );
  }
}

function firstSteps(blocks: BuildBlock[], cap: CapOption, n: number): void {
  const ordered = orderBlocks(blocks);
  const groups = groupSteps(ordered, { cap });
  console.log(`\n-- furnace-fixture, eerste ${n} stappen (cap ${cap}) --`);
  for (const g of groups.slice(0, n)) {
    const types = new Map<string, number>();
    for (let i = g.first; i < g.first + g.count; i++) {
      const t = baseTypeName(ordered[i]!.block);
      types.set(t, (types.get(t) ?? 0) + 1);
    }
    const ys = new Set(ordered.slice(g.first, g.first + g.count).map((b) => b.y));
    const desc = [...types.entries()].map(([t, c]) => `${c}× ${t}`).join(' + ');
    console.log(
      `stap ${g.index + 1}: ${desc} — laag y=${[...ys].join('/')}` +
      ` — pos (${g.minX}..${g.maxX}, ${g.minZ}..${g.maxZ})`,
    );
  }
}

async function main(): Promise<void> {
  const demo = toBuildBlocks(await parseSchem(await readFile(join(FIX, 'demo-huisje.schem'))));
  const furnace = toBuildBlocks(await parseSchem(await readFile(join(FIX, 'phantommarket-f64.schem'))));
  const ov = overhangSchem();
  const overhang = toBuildBlocks(ov);
  report('demo-huisje (20x10x20)', demo);
  report('phantommarket f64 (42x10x13) — de furnace-fixture', furnace);
  report('overhang-fixture (portal-balk, 5x4x1)', overhang);
  firstSteps(furnace, 12, 5);
  firstSteps(furnace, 24, 5);
  // Sanity for the overhang: the hanging torch must come after the beam.
  const ordered = orderBlocks(overhang);
  const pos = (b: BuildBlock): number => ordered.findIndex((o) => o.x === b.x && o.y === b.y && o.z === b.z);
  const torch = ordered.find((b) => b.block.startsWith('minecraft:torch'))!;
  const beamAbove = ordered.find((b) => b.x === torch.x && b.y === torch.y + 1 && b.z === torch.z)!;
  console.log(
    `\noverhang-check: hangende torch op ordindex ${pos(torch)} NA balk erboven op ${pos(beamAbove)}: ` +
    `${pos(torch) > pos(beamAbove) ? 'OK' : 'SCHENDT support-invariant'}`,
  );
}

main().catch((err) => {
  console.error(`${err instanceof Error ? err.name : 'Error'}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
