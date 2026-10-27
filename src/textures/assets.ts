/**
 * Assets-tree construction for user-supplied Minecraft assets.
 *
 * Accepts a directory listing (File objects from <input webkitdirectory>)
 * or a .zip (resource pack) and normalizes every entry to a path under
 * `assets/`, e.g. ".../.minecraft/assets/minecraft/blockstates/x.json"
 * becomes "minecraft/blockstates/x.json". Everything stays in memory in
 * the browser; nothing is uploaded anywhere.
 *
 * Zip parsing is dependency-free: stored entries pass through, deflate
 * entries go through the browser's native DecompressionStream.
 * (src/textures/loader.ts uses this to build the atlas.)
 */
import type { AssetsTree } from './atlas.js';

/**
 * A tree of *files* (bytes), keyed by normalized path under assets/.
 * Unlike AssetsTree (parsed JSON) this also holds PNG data, so it is the
 * single source for both the blockstate resolver and the atlas builder.
 */
export interface AssetFiles {
  get(path: string): Uint8Array | undefined;
  has(path: string): boolean;
  /** Lower-cased normalized paths under assets/, sorted. */
  paths(): string[];
}

/** Normalize one archive/walk path to its form under assets/, or null. */
export function normalizeAssetPath(rawPath: string): string | null {
  const lowered = rawPath.toLowerCase().replace(/\\/g, '/');
  const marker = lowered.lastIndexOf('assets/');
  if (marker === -1) return null;
  const rel = lowered.slice(marker + 'assets/'.length);
  return rel === '' ? null : rel;
}

const TEXT_EXTENSIONS = /\.(json|mcmeta)$/;

export function buildAssetFiles(entries: Iterable<[string, Uint8Array]>): AssetFiles {
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    const normalized = normalizeAssetPath(path);
    if (!normalized) continue;
    files.set(normalized, bytes);
  }
  return {
    get: (p) => files.get(p.toLowerCase()),
    has: (p) => files.has(p.toLowerCase()),
    paths: () => [...files.keys()].sort(),
  };
}

/** Parse JSON file from the tree; undefined on absence or parse failure. */
export function readJsonAsset(files: AssetFiles, path: string): unknown {
  const bytes = files.get(path);
  if (!bytes || !TEXT_EXTENSIONS.test(path)) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** View the file tree as the parsed-JSON AssetsTree the resolver wants. */
export function treeFromAssetFiles(files: AssetFiles): AssetsTree {
  const parsed = new Map<string, unknown>();
  for (const path of files.paths()) {
    if (!path.endsWith('.json')) continue;
    const value = readJsonAsset(files, path);
    if (value !== undefined) parsed.set(path, value);
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Zip reading                                                         */
/* ------------------------------------------------------------------ */

interface ZipEntry {
  offset: number;
  compressedSize: number;
  method: number;
}

function readU32(b: DataView, off: number): number {
  return b.getUint32(off, true);
}
function readU16(b: DataView, off: number): number {
  return b.getUint16(off, true);
}

/**
 * Parse a zip's central directory. Throws a typed error when the bytes
 * are not a zip — callers surface that, never silently.
 */
export function parseZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate the end-of-central-directory record (scan back over max 64 KiB
  // of possible comment).
  let eocd = -1;
  const minEocd = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (readU32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new AssetError('Geen geldige zip (geen end-of-central-directory)');
  const count = readU16(view, eocd + 10);
  let offset = readU32(view, eocd + 16);

  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (readU32(view, offset) !== 0x02014b50) throw new AssetError('Corrupt zip: centr. directory');
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const nameLen = readU16(view, offset + 28);
    const extraLen = readU16(view, offset + 30);
    const commentLen = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (!name.endsWith('/')) entries.set(name, { offset: localOffset, compressedSize, method });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extract one entry's bytes (stored pass-through, deflate via native API). */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = entry.offset;
  if (readU32(view, localOffset) !== 0x04034b50) throw new AssetError('Corrupt zip: lokale header');
  const nameLen = readU16(view, localOffset + 26);
  const extraLen = readU16(view, localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new AssetError(`Niet-ondersteunde zip-compressie: ${entry.method}`);
  const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Error type for user-facing asset problems (bad zip, unreadable files). */
export class AssetError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AssetError';
  }
}

/** Build an AssetFiles from a resource-pack or assets.zip. Never partial: */
export async function assetFilesFromZip(bytes: Uint8Array): Promise<AssetFiles> {
  const entries = parseZipDirectory(bytes);
  const list: [string, Uint8Array][] = [];
  for (const [name, entry] of entries) {
    list.push([name, await readZipEntry(bytes, entry)]);
  }
  return buildAssetFiles(list);
}

/** Read every picked File's bytes and build the tree. */
export async function assetFilesFromFiles(fileList: FileList | File[]): Promise<AssetFiles> {
  const list: [string, Uint8Array][] = [];
  for (const file of Array.from(fileList as ArrayLike<File>)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    list.push([rel, new Uint8Array(await file.arrayBuffer())]);
  }
  return buildAssetFiles(list);
}
