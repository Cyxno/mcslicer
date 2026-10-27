import { parse as parseNbt, TagType, type Tags } from 'prismarine-nbt';
import {
  AIR_BLOCK,
  SchemParseError,
  type Schematic,
  type SchemSize,
} from './types.js';

type NbtTag = Tags[TagType];

function compoundValue(tag: NbtTag): Record<string, NbtTag> {
  if (tag.type !== TagType.Compound) {
    throw new SchemParseError(`expected compound, got ${tag.type}`);
  }
  return tag.value as Record<string, NbtTag>;
}

function numberValue(tag: NbtTag | undefined, field: string): number {
  if (tag === undefined) {
    throw new SchemParseError(`missing field "${field}"`);
  }
  if (tag.type === TagType.Int || tag.type === TagType.Short || tag.type === TagType.Byte) {
    return tag.value;
  }
  if (tag.type === TagType.Long && Array.isArray(tag.value)) {
    const [hi, lo] = tag.value as [number, number];
    return hi * 0x1_0000_0000 + (lo >>> 0);
  }
  throw new SchemParseError(`field "${field}" has unexpected NBT type ${tag.type}`);
}

function child(compound: Record<string, NbtTag>, field: string): NbtTag {
  const tag = compound[field];
  if (tag === undefined) {
    throw new SchemParseError(`missing field "${field}"`);
  }
  return tag;
}

/**
 * Parse a Sponge schematic file (v2 or v3, gzip- or plain-NBT) into a plain
 * data structure. Pure async function: input bytes in, data out, no DOM.
 */
export async function parseSchem(input: Uint8Array | ArrayBuffer): Promise<Schematic> {
  const buffer = ArrayBuffer.isView(input)
    ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
    : Buffer.from(input);

  let root;
  try {
    const result = await parseNbt(buffer);
    root = result.parsed;
  } catch (err) {
    throw new SchemParseError('not a readable NBT/schematic file', { cause: err });
  }

  const rootValue = compoundValue(root);
  const schematic = compoundValue(child(rootValue, 'Schematic'));
  const version = numberValue(child(schematic, 'Version'), 'Version');
  if (version !== 2 && version !== 3) {
    throw new SchemParseError(`unsupported schematic version ${version} (expected 2 or 3)`);
  }

  const size: SchemSize = {
    x: numberValue(child(schematic, 'Width'), 'Width'),
    y: numberValue(child(schematic, 'Height'), 'Height'),
    z: numberValue(child(schematic, 'Length'), 'Length'),
  };
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
    throw new SchemParseError(`invalid schematic size ${size.x}x${size.y}x${size.z}`);
  }

  const paletteTag = child(schematic, 'Palette');
  if (paletteTag.type !== TagType.Compound) {
    throw new SchemParseError(`Palette has unexpected NBT type ${paletteTag.type}`);
  }
  const palette: string[] = new Array(Object.keys(paletteTag.value).length);
  for (const [blockId, indexTag] of Object.entries(paletteTag.value)) {
    const index = numberValue(indexTag, `Palette["${blockId}"]`);
    if (index < 0 || index >= palette.length) {
      throw new SchemParseError(`palette index ${index} for "${blockId}" out of range 0..${palette.length - 1}`);
    }
    if (palette[index] !== undefined) {
      throw new SchemParseError(`duplicate palette index ${index} ("${palette[index]}" and "${blockId}")`);
    }
    palette[index] = blockId;
  }
  for (let i = 0; i < palette.length; i++) {
    if (palette[i] === undefined) {
      throw new SchemParseError(`palette index ${i} never assigned`);
    }
  }

  const volume = size.x * size.y * size.z;
  const blockDataTag = child(schematic, 'BlockData');
  if (blockDataTag.type !== TagType.ByteArray) {
    throw new SchemParseError(`BlockData has unexpected NBT type ${blockDataTag.type}`);
  }
  const raw = blockDataTag.value;
  const blocks = new Int32Array(volume);
  let cursor = 0;
  for (let i = 0; i < volume; i++) {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (cursor >= raw.length) {
        throw new SchemParseError(`BlockData truncated: decoded ${i} of ${volume} blocks`);
      }
      const byte = raw[cursor++]!;
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) {
        throw new SchemParseError(`BlockData varint for block ${i} is too long`);
      }
    }
    if (value < 0 || value >= palette.length) {
      throw new SchemParseError(`block ${i} references palette index ${value}, but palette has ${palette.length} entries`);
    }
    blocks[i] = value;
  }

  // Trailing bytes are allowed in v3 (block entities live separately), but a
  // gross mismatch means the file does not describe what it claims.
  if (cursor === 0) {
    throw new SchemParseError('BlockData is empty');
  }

  if (!palette.includes(AIR_BLOCK)) {
    throw new SchemParseError(`palette has no "${AIR_BLOCK}" entry`);
  }

  return { size, palette, blockCount: volume, blocks };
}
