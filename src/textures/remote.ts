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
 * All asset paths the palette needs, discovered from whatever is cached so
 * far: blockstates, their variant/multipart model refs, model parents, and
 * non-"#ref" texture values. Layered assets surface one layer per call —
 * a model's parent only becomes known once that model is cached — so run
 * this inside an ensure loop until pendingPaths(...) is empty.
 *
 * Model/textures refs may carry a namespace ("minecraft:block/furnace");
 * both are normalized to slash-form paths under minecraft/.
 */
export function wantedPathsForPalette(source: RemoteSource, palette: string[]): string[] {
  const wanted: string[] = [];
  const modelRefs: string[] = [];
  const textureValues: string[] = [];
  for (const entry of palette) {
    const base = entry.split('[')[0] ?? entry;
    const colon = base.indexOf(':');
    const ns = colon === -1 ? 'minecraft' : base.slice(0, colon);
    const name = colon === -1 ? base : base.slice(colon + 1);
    const statePath = `${ns}/blockstates/${name}.json`;
    wanted.push(statePath);
    const state = source.json(statePath) as
      | {
          variants?: Record<string, unknown>;
          multipart?: { apply?: unknown }[];
        }
      | undefined;
    if (!state || typeof state !== 'object') continue;
    const collectRefs = (variant: unknown): void => {
      for (const v of Array.isArray(variant) ? variant : [variant]) {
        if (v && typeof v === 'object' && typeof (v as { model?: unknown }).model === 'string') {
          modelRefs.push((v as { model: string }).model);
        }
      }
    };
    if (state.variants) for (const variant of Object.values(state.variants)) collectRefs(variant);
    for (const part of state.multipart ?? []) collectRefs(part.apply);
  }
  for (const ref of modelRefs) {
    const colon = ref.indexOf(':');
    const rel = colon === -1 ? ref : ref.slice(colon + 1);
    const modelPath = `minecraft/models/${rel}.json`;
    wanted.push(modelPath);
    const model = source.json(modelPath) as { parent?: unknown; textures?: Record<string, unknown> } | undefined;
    if (!model || typeof model !== 'object') continue;
    if (typeof model.parent === 'string') modelRefs.push(model.parent);
    for (const value of Object.values(model.textures ?? {})) {
      // Vanilla (1.20.5+) allows object values: { sprite: "block/x", ... }.
      const tex =
        typeof value === 'string'
          ? value
          : value && typeof value === 'object' && typeof (value as { sprite?: unknown }).sprite === 'string'
            ? (value as { sprite: string }).sprite
            : null;
      if (tex && !tex.startsWith('#')) textureValues.push(tex);
    }
  }
  for (const value of textureValues) {
    const colon = value.indexOf(':');
    const ns = colon === -1 ? 'minecraft' : value.slice(0, colon);
    const rel = colon === -1 ? value : value.slice(colon + 1);
    wanted.push(`${ns}/textures/${rel}.png`);
  }
  return wanted;
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
