import pako from 'pako';
import { parseAs, TagType, type Tags } from 'prismarine-nbt';
import {
  AIR_BLOCK,
  SchemParseError,
  type SchemFormat,
  type Schematic,
  type SchemSize,
} from './types.js';
import { legacyBlockName } from './legacy-ids.js';

type NbtTag = Tags[TagType];
type NbtRoot = Tags[TagType.Compound] & { name: string };

function compoundValue(tag: NbtTag, what: string): Record<string, NbtTag> {
  if (tag.type !== TagType.Compound) {
    throw new SchemParseError(`${what} has unexpected NBT type ${tag.type} (expected compound)`);
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

function byteArrayValue(tag: NbtTag, field: string): ArrayLike<number> {
  if (tag.type !== TagType.ByteArray) {
    throw new SchemParseError(`field "${field}" has unexpected NBT type ${tag.type} (expected byteArray)`);
  }
  return tag.value;
}

function readSize(schematic: Record<string, NbtTag>): SchemSize {
  const size: SchemSize = {
    x: numberValue(child(schematic, 'Width'), 'Width'),
    y: numberValue(child(schematic, 'Height'), 'Height'),
    z: numberValue(child(schematic, 'Length'), 'Length'),
  };
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
    throw new SchemParseError(`invalid schematic size ${size.x}x${size.y}x${size.z}`);
  }
  return size;
}

function checkVersion(schematic: Record<string, NbtTag>): void {
  // Version is optional (some writers omit it); if present it must be 1..3.
  const versionTag = schematic['Version'];
  if (versionTag !== undefined) {
    const version = numberValue(versionTag, 'Version');
    if (version < 1 || version > 3) {
      throw new SchemParseError(`unsupported schematic Version ${version} (expected 1, 2 or 3)`);
    }
  }
}

/** Layout dispatch is on field presence, not on the Version number: writers
 * exist that emit Version 2 with the v3 palette layout ("v2 hybrid"). */
function hasPaletteLayout(schematic: Record<string, NbtTag>): boolean {
  return schematic['Palette'] !== undefined && schematic['BlockData'] !== undefined;
}

function hasLegacyLayout(schematic: Record<string, NbtTag>): boolean {
  return schematic['Blocks'] !== undefined;
}

function parsePaletteLayout(schematic: Record<string, NbtTag>, size: SchemSize): { palette: string[]; blocks: Int32Array } {
  const paletteTag = child(schematic, 'Palette');
  const paletteCompound = compoundValue(paletteTag, 'Palette');
  const palette: string[] = new Array(Object.keys(paletteCompound).length);
  for (const [blockId, indexTag] of Object.entries(paletteCompound)) {
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
  const raw = byteArrayValue(child(schematic, 'BlockData'), 'BlockData');
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
  if (cursor === 0) {
    throw new SchemParseError('BlockData is empty');
  }
  return { palette, blocks };
}

/**
 * MCEdit-legacy layout (Sponge v1): numeric block ids in `Blocks`, optional
 * 4-bit metadata in `Data` (packed nibbles, same yzx order). Every id+data
 * pair is translated to a modern namespaced blockstate string via
 * legacyBlockName (src/schem/legacy-ids.ts) so renderer, legend and
 * textures need no legacy knowledge; unknown ids map to an explicit
 * "legacy:unknown_<id>" marker that renders with the color fallback.
 */
function parseLegacyLayout(schematic: Record<string, NbtTag>, size: SchemSize): { palette: string[]; blocks: Int32Array } {
  const volume = size.x * size.y * size.z;
  const rawBlocks = byteArrayValue(child(schematic, 'Blocks'), 'Blocks');
  if (rawBlocks.length < volume) {
    throw new SchemParseError(`Blocks truncated: ${rawBlocks.length} bytes for ${volume} blocks`);
  }
  const dataTag = schematic['Data'];
  let rawData: ArrayLike<number> | undefined;
  if (dataTag !== undefined) {
    rawData = byteArrayValue(dataTag, 'Data');
    if (rawData.length < Math.ceil(volume / 2)) {
      throw new SchemParseError(`Data truncated: ${rawData.length} bytes for ${volume} packed nibbles`);
    }
  }

  const palette: string[] = [];
  const indexOf = new Map<string, number>();
  const blocks = new Int32Array(volume);
  for (let i = 0; i < volume; i++) {
    const id = rawBlocks[i]!;
    let name: string;
    if (id === 0) {
      name = AIR_BLOCK;
    } else if (rawData !== undefined) {
      const nibble = rawData[i >> 1]!;
      const meta = (i & 1) === 0 ? nibble & 0x0f : (nibble >> 4) & 0x0f;
      name = legacyBlockName(id, meta);
    } else {
      name = legacyBlockName(id, 0);
    }
    let paletteIndex = indexOf.get(name);
    if (paletteIndex === undefined) {
      paletteIndex = palette.length;
      palette.push(name);
      indexOf.set(name, paletteIndex);
    }
    blocks[i] = paletteIndex;
  }
  return { palette, blocks };
}

/**
 * Parse a Sponge schematic (v1 legacy, v2 legacy or palette-based, v2
 * "hybrid" and v3 — layout dispatch is on field presence) into a plain data
 * structure. Pure async function: input bytes in, data out, no DOM.
 */
export async function parseSchem(input: Uint8Array | ArrayBuffer): Promise<Schematic> {
  const buffer = ArrayBuffer.isView(input)
    ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
    : Buffer.from(input);

  // prismarine-nbt's own gzip path uses node zlib, which does not exist in
  // the browser. We gunzip with pako (pure JS) and parse the plain NBT, so
  // zlib is never reached. Sponge schematics are big-endian NBT.
  // Note: parseAs() resolves to { data, metadata, type } at runtime, even
  // though its typings claim { parsed } — the typings are wrong.
  const parseBig = async (buf: Buffer): Promise<NbtRoot> =>
    ((await parseAs(buf, 'big')) as unknown as { data: NbtRoot }).data;
  let root: NbtRoot;
  try {
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      const inflated = pako.ungzip(new Uint8Array(buffer));
      root = await parseBig(Buffer.from(inflated));
    } else {
      root = await parseBig(buffer);
    }
  } catch (err) {
    throw new SchemParseError('not a readable NBT/schematic file', { cause: err });
  }

  // Layout container: Sponge nests everything under a "Schematic" child;
  // MCEdit-era files put the fields directly on the (often "Schematic"-named)
  // root. Distinguish explicitly so errors name the real problem.
  const rootValue = root.value as Record<string, NbtTag>;
  let schematic: Record<string, NbtTag>;
  const schematicChild = rootValue['Schematic'];
  if (schematicChild !== undefined && schematicChild.type === TagType.Compound) {
    schematic = schematicChild.value as Record<string, NbtTag>;
  } else if (
    rootValue['Width'] !== undefined &&
    rootValue['Height'] !== undefined &&
    rootValue['Length'] !== undefined
  ) {
    schematic = rootValue;
  } else if (schematicChild !== undefined) {
    throw new SchemParseError(
      `NBT root "${root.name}" has a "Schematic" child of type ${schematicChild.type}, expected compound`,
    );
  } else {
    throw new SchemParseError(
      `unrecognized schematic layout: NBT root "${root.name}" has neither a "Schematic" compound ` +
      'nor direct Width/Height/Length fields (missing Width, Height, Length)',
    );
  }

  checkVersion(schematic);
  const size = readSize(schematic);

  let parsed: { palette: string[]; blocks: Int32Array };
  let format: SchemFormat;
  if (hasPaletteLayout(schematic)) {
    parsed = parsePaletteLayout(schematic, size);
    const version = schematic['Version'] !== undefined ? numberValue(schematic['Version'], 'Version') : 2;
    format = version === 3 ? 'sponge-v3' : 'sponge-v2';
  } else if (hasLegacyLayout(schematic)) {
    parsed = parseLegacyLayout(schematic, size);
    format = 'legacy-mcedit';
  } else {
    throw new SchemParseError(
      `schematic declares no block layout: missing both "Palette"+"BlockData" (Sponge v2/v3) ` +
      'and "Blocks" (legacy v1); present fields: ' + Object.keys(schematic).join(', '),
    );
  }

  const { palette, blocks } = parsed;

  return { size, palette, blockCount: size.x * size.y * size.z, blocks, format };
}
