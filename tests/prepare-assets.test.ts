import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { makeZip } from './helpers-zip.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'prepare-default-assets.sh');
const DEST = join(HERE, '..', 'public', 'default-assets');
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function run(args: string[]): { status: number; output: string } {
  const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('prepare-default-assets.sh', () => {
  // The real operator set lives at DEST (the dev server serves it). Tests
  // must never leave it deleted: back it up for the run, restore after.
  const BACKUP = `${DEST}.before-tests`;
  beforeAll(() => {
    if (existsSync(DEST)) renameSync(DEST, BACKUP);
  });
  afterAll(() => {
    rmSync(DEST, { recursive: true, force: true });
    if (existsSync(BACKUP)) renameSync(BACKUP, DEST);
  });

  it('fails cleanly without arguments', () => {
    const r = run([]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch('gebruik');
  });

  it('fails cleanly on a missing file (no half work)', () => {
    const r = run(['/tmp/bestaat-niet-4c.zip']);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch('bestand niet gevonden');
    expect(existsSync(DEST)).toBe(false);
  });

  it('fails cleanly on a zip without assets', () => {
    const dir = mkdtemp();
    const zip = join(dir, 'leeg.zip');
    writeFileSync(zip, Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])); // empty zip EOCD
    const r = run([zip]);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch('geen geldige zip');
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts blockstates/models/textures and writes a manifest', async () => {
    const dir = mkdtemp();
    const zip = join(dir, 'vanilla-template.zip');
    const entries: [string, Uint8Array][] = [
      ['assets/minecraft/blockstates/furnace.json', enc('{"variants":{}}')],
      ['assets/minecraft/models/block/furnace.json', enc('{}')],
      ['assets/minecraft/textures/block/furnace_front.png', enc('png')],
      ['pack.png', enc('ignored')], // not blockstates/models/textures
    ];
    await awaitZip(zip, entries);
    try {
      const r = run([zip]);
      expect(r.output).toMatch('klaar:');
      const manifest = JSON.parse(readFileSync(join(DEST, 'manifest.json'), 'utf8')) as { files: string[] };
      expect(manifest.files).toContain('minecraft/blockstates/furnace.json');
      expect(manifest.files).toContain('minecraft/models/block/furnace.json');
      expect(manifest.files).toContain('minecraft/textures/block/furnace_front.png');
      expect(manifest.files.some((f) => f.includes('pack.png'))).toBe(false);
      expect(existsSync(join(DEST, 'minecraft', 'textures', 'block', 'furnace_front.png'))).toBe(true);
    } finally {
      rmSync(DEST, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a flat pack root (blockstates/ at top level)', async () => {
    const dir = mkdtemp();
    const zip = join(dir, 'pack.zip');
    await awaitZip(zip, [['blockstates/stone.json', enc('{}')], ['textures/block/stone.png', enc('png')]]);
    try {
      const r = run([zip]);
      expect(r.output).toMatch('klaar:');
      const manifest = JSON.parse(readFileSync(join(DEST, 'manifest.json'), 'utf8')) as { files: string[] };
      expect(manifest.files).toContain('minecraft/blockstates/stone.json');
    } finally {
      rmSync(DEST, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function mkdtemp(): string {
  return mkdtempSync(join(tmpdir(), 'mcslicer-4c-'));
}

async function awaitZip(path: string, entries: [string, Uint8Array][]): Promise<void> {
  writeFileSync(path, Buffer.from(await makeZip(entries)));
}
