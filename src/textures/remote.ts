/**
 * Remote (same-origin) default-assets source, phase 4c.
 *
 * The prepare script (scripts/prepare-default-assets.sh) writes
 * public/default-assets/ with a manifest.json (array of slash-form paths,
 * e.g. "minecraft/blockstates/furnace.json"). The client fetches only the
 * manifest at startup, then lazily fetches the blockstates/models/textures
 * the current schematic actually needs — the vanilla set is far too big to
 * download wholesale.
 *
 * The core here is network-free: the manifest paths and a bytes loader are
 * injected, so the cache/ensure logic is unit-testable with a fake loader.
 * JSON parsing is cached; texture lookups are colon/slash-insensitive.
 */
import type { AssetsTree } from './atlas.js';

export interface RemoteSource {
  /** Manifest membership (colon or slash form accepted). */
  has(path: string): boolean;
  /** Cached bytes; undefined when not (yet) fetched or absent. */
  getBytes(path: string): Uint8Array | undefined;
  /** Parsed JSON from cache; undefined when absent or not JSON. */
  json(path: string): unknown;
  /** Fetch every listed path that is not cached yet; returns count. */
  ensure(paths: string[]): Promise<number>;
  /** Number of cached files. */
  cached(): number;
  /** Cached keys (slash form), sorted — drives tree views. */
  keys(): string[];
}

const normalize = (p: string): string => p.toLowerCase().replace(/:/g, '/').replace(/^\//, '');

export function createRemoteSource(
  manifestPaths: string[],
  load: (path: string) => Promise<Uint8Array | undefined>,
): RemoteSource {
  const manifest = new Set(manifestPaths.map(normalize));
  const bytes = new Map<string, Uint8Array>();
  const parsed = new Map<string, unknown>();

  return {
    has: (p) => manifest.has(normalize(p)),
    getBytes: (p) => bytes.get(normalize(p)),
    json: (p) => {
      const key = normalize(p);
      if (!key.endsWith('.json')) return undefined;
      if (parsed.has(key)) return parsed.get(key);
      const raw = bytes.get(key);
      if (!raw) return undefined;
      try {
        const value = JSON.parse(new TextDecoder().decode(raw)) as unknown;
        parsed.set(key, value);
        return value;
      } catch {
        parsed.set(key, undefined);
        return undefined;
      }
    },
    ensure: async (paths) => {
      const pending = [...new Set(paths.map(normalize))].filter((p) => manifest.has(p) && !bytes.has(p));
      await Promise.all(
        pending.map(async (p) => {
          const data = await load(p).catch(() => undefined);
          if (data) bytes.set(p, data);
        }),
      );
      return pending.length;
    },
    cached: () => bytes.size,
    keys: () => [...bytes.keys()].sort(),
  };
}

/** Paths wanted but not cached yet (pure; used to drive ensure passes). */
export function pendingPaths(source: RemoteSource, wanted: string[]): string[] {
  return [...new Set(wanted.map(normalize))].filter((p) => source.has(p) && source.getBytes(p) === undefined);
}

/**
 * View the remote cache as the parsed AssetsTree the resolver wants:
 * JSON entries as parsed objects, textures as presence stubs in colon
 * form (the resolver queries "minecraft:textures/…", files are slash-form).
 */
export function treeFromRemote(source: RemoteSource): AssetsTree {
  const tree = new Map<string, unknown>();
  for (const key of source.keys()) {
    if (key.endsWith('.json')) {
      const value = source.json(key);
      if (value !== undefined) tree.set(key, value);
    } else {
      const slash = key.indexOf('/');
      if (slash !== -1) tree.set(`${key.slice(0, slash)}:${key.slice(slash + 1)}`, {});
    }
  }
  return tree;
}
