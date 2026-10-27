import { describe, expect, it } from 'vitest';
import { parseSchem } from '../src/schem/parse.js';
import { AIR_BLOCK, SchemParseError } from '../src/schem/types.js';
import { makeSchemBuffer, tinySchem } from './helpers.js';

describe('parseSchem — happy path', () => {
  it('parses a small valid gzipped .schem', async () => {
    const schem = await parseSchem(tinySchem());
    expect(schem.size).toEqual({ x: 2, y: 1, z: 2 });
    expect(schem.palette).toEqual(['minecraft:air', 'minecraft:stone', 'minecraft:oak_planks']);
    expect(schem.blockCount).toBe(4);
    expect(Array.from(schem.blocks)).toEqual([0, 1, 1, 2]);
  });

  it('accepts plain (non-gzipped) NBT too', async () => {
    const schem = await parseSchem(makeSchemBuffer({
      width: 1, height: 1, length: 1,
      palette: [AIR_BLOCK],
      blockIndices: [0],
      gzip: false,
    }));
    expect(schem.blockCount).toBe(1);
  });

  it('decodes multi-byte varints (palette index > 127)', async () => {
    const palette = [AIR_BLOCK, ...Array.from({ length: 200 }, (_, i) => `minecraft:block_${i}`)];
    const schem = await parseSchem(makeSchemBuffer({
      width: 2, height: 1, length: 1,
      palette,
      blockIndices: [0, 150], // 150 needs 2 varint bytes
    }));
    expect(schem.blocks[1]).toBe(150);
  });

  it('handles v2 schematics', async () => {
    const schem = await parseSchem(makeSchemBuffer({
      width: 1, height: 1, length: 1,
      palette: [AIR_BLOCK],
      blockIndices: [0],
      version: 2,
    }));
    expect(schem.blockCount).toBe(1);
  });
});

describe('parseSchem — corrupt input must yield SchemParseError, never a crash', () => {
  it('rejects empty input', async () => {
    await expect(parseSchem(new Uint8Array(0))).rejects.toThrow(SchemParseError);
  });

  it('rejects random bytes', async () => {
    const noise = new Uint8Array(256).map((_, i) => (i * 37 + 11) & 0xff);
    await expect(parseSchem(noise)).rejects.toThrow(SchemParseError);
  });

  it('rejects truncated gzip', async () => {
    const buf = tinySchem();
    await expect(parseSchem(buf.subarray(0, Math.floor(buf.length / 2)))).rejects.toThrow(SchemParseError);
  });

  it('rejects truncated uncompressed NBT', async () => {
    const buf = makeSchemBuffer({
      width: 1, height: 1, length: 1,
      palette: [AIR_BLOCK],
      blockIndices: [0],
      gzip: false,
    });
    await expect(parseSchem(buf.subarray(0, buf.length - 4))).rejects.toThrow(SchemParseError);
  });

  it('rejects truncated BlockData', async () => {
    const buf = makeSchemBuffer({
      width: 4, height: 4, length: 4, // claims 64 blocks
      palette: [AIR_BLOCK],
      blockIndices: new Array(64).fill(0).slice(0, 4), // but only encodes 4
    });
    await expect(parseSchem(buf)).rejects.toThrow(/truncated/i);
  });

  it('rejects unknown version', async () => {
    const buf = makeSchemBuffer({
      width: 1, height: 1, length: 1,
      palette: [AIR_BLOCK],
      blockIndices: [0],
      version: 99,
    });
    await expect(parseSchem(buf)).rejects.toThrow(/Version 99/);
  });

  it('rejects out-of-range block palette index', async () => {
    const buf = makeSchemBuffer({
      width: 1, height: 1, length: 1,
      palette: [AIR_BLOCK],
      blockIndices: [5],
    });
    await expect(parseSchem(buf)).rejects.toThrow(/palette index 5/);
  });

  it('rejects zero/invalid size', async () => {
    // hand-mutate: easiest is to build with width 0
    const buf = makeSchemBuffer({
      width: 0, height: 1, length: 1,
      palette: [AIR_BLOCK],
      blockIndices: [],
    });
    await expect(parseSchem(buf)).rejects.toThrow(/invalid schematic size/);
  });

  it('error is a typed Error instance with name SchemParseError', async () => {
    const err = await parseSchem(new Uint8Array([1, 2, 3])).catch((e) => e);
    expect(err).toBeInstanceOf(SchemParseError);
    expect(err.name).toBe('SchemParseError');
    expect(typeof err.message).toBe('string');
  });
});
