/**
 * Pure blockstate → texture resolution (no DOM, no three.js).
 *
 * Input is an "assets tree" shaped like the assets/ directory of a
 * minecraft.jar or resource pack: keys are paths relative to assets/
 * ("minecraft/blockstates/hopper.json"), values are the parsed JSON.
 * The tree is supplied by the caller (src/textures/assets.ts builds one
 * from a user-picked directory or zip); nothing here touches the network
 * or the filesystem.
 *
 * Resolution follows the vanilla chain:
 *   palette entry ("hopper[enabled=true,facing=north]")
 *   → blockstates/<base>.json: match the state properties against variant
 *     keys (and multipart conditions)
 *   → models/<ref>.json: merge the parent chain, resolve "#ref" texture
 *     values
 *   → normalized texture paths ("minecraft:textures/block/stone.png").
 *
 * Face selection is heuristic over texture *keys* (all/top/bottom/up/down/
 * side/end/north/...). Models that define per-face UVs inside elements[]
 * are intentionally not read; see the README limitations.
 */

/** Parsed assets tree: path under assets/ → parsed JSON content. */
export type AssetsTree = ReadonlyMap<string, unknown>;

export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Texture path per cube face; null = no texture resolved for that face. */
export interface BlockFaces {
  px: string | null;
  nx: string | null;
  py: string | null;
  ny: string | null;
  pz: string | null;
  nz: string | null;
}

export interface ResolvedBlock {
  /** Primary texture path (all/side/top/particle order) or null. */
  texturePath: string | null;
  /** Texture key that produced texturePath ("all", "side", "top", …). */
  uvHint: string;
  /** Normalized texture path per face ("minecraft:textures/block/x.png"). */
  faces: BlockFaces;
  /** True when a texture was referenced but missing from the assets tree. */
  incomplete: boolean;
}

/** Parse "hopper[enabled=true,facing=north]" → base id + state props. */
export function parsePaletteEntry(entry: string): {
  namespace: string;
  base: string;
  props: Record<string, string>;
} {
  const bracket = entry.indexOf('[');
  const id = bracket === -1 ? entry : entry.slice(0, bracket);
  const colon = id.indexOf(':');
  const namespace = colon === -1 ? 'minecraft' : id.slice(0, colon);
  const base = colon === -1 ? id : id.slice(colon + 1);
  const props: Record<string, string> = {};
  if (bracket !== -1) {
    const body = entry.slice(bracket + 1, entry.endsWith(']') ? -1 : undefined);
    for (const pair of body.split(',')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      props[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
  return { namespace, base, props };
}

/** Normalize a texture value ("block/stone" or "minecraft:block/stone"). */
export function normalizeTexturePath(value: string, namespace: string): string {
  const colon = value.indexOf(':');
  const ns = colon === -1 ? namespace : value.slice(0, colon);
  const path = colon === -1 ? value : value.slice(colon + 1);
  return `${ns}:textures/${path}.png`;
}

interface ModelJson {
  parent?: string;
  textures?: Record<string, string>;
}

/** Strip an optional namespace: "minecraft:block/x" → "block/x". */
function stripNamespace(ref: string): string {
  const colon = ref.indexOf(':');
  return colon === -1 ? ref : ref.slice(colon + 1);
}

/**
 * Merge a model's textures over its parent chain (child wins), resolving
 * "#ref" values against the merged map. Returns null only when the first
 * model file is missing; missing parents (e.g. builtin/generated, which
 * has no file in any resource pack) end the chain with the textures
 * collected so far — vanilla treats those as terminal.
 */
function resolveModelTextures(ref: string, tree: AssetsTree): Record<string, string> | null {
  const chain: ModelJson[] = [];
  const seen = new Set<string>();
  let current: string | undefined = ref;
  while (current) {
    if (seen.has(current)) return null; // parent cycle
    seen.add(current);
    const model = tree.get(`minecraft/models/${stripNamespace(current)}.json`) as ModelJson | undefined;
    if (!model || typeof model !== 'object') {
      if (chain.length === 0) return null;
      break;
    }
    chain.unshift(model);
    current = model.parent;
  }
  const merged: Record<string, string> = {};
  for (const model of chain) {
    for (const [key, value] of Object.entries(model.textures ?? {})) {
      // Vanilla (1.20.5+) allows object values: { sprite: "block/x", ... }.
      merged[key] =
        typeof value === 'string'
          ? value
          : value && typeof value === 'object' && typeof (value as { sprite?: unknown }).sprite === 'string'
            ? (value as { sprite: string }).sprite
            : '';
    }
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    out[key] = value.startsWith('#') ? (merged[value.slice(1)] ?? '') : value;
  }
  return out;
}

/** Candidate texture keys per face, in priority order. */
const FACE_KEYS: Record<keyof BlockFaces, string[]> = {
  py: ['up', 'top', 'end', 'side', 'all', 'particle'],
  ny: ['down', 'bottom', 'end', 'side', 'all', 'particle'],
  px: ['east', 'side', 'end', 'all', 'particle'],
  nx: ['west', 'side', 'end', 'all', 'particle'],
  pz: ['south', 'side', 'all', 'particle'],
  nz: ['north', 'side', 'all', 'particle'],
};

/** Does a variant key ("facing=north,open=true") match the state props? */
function variantKeyMatches(key: string, props: Record<string, string>): boolean {
  if (key === '') return true;
  for (const pair of key.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) return false;
    if (props[pair.slice(0, eq).trim()] !== pair.slice(eq + 1).trim()) return false;
  }
  return true;
}

/** Multipart "when" condition: object (AND), array (OR of objects), or nested OR/AND. */
function whenMatches(when: unknown, props: Record<string, string>): boolean {
  if (when == null) return true;
  if (Array.isArray(when)) return when.some((w) => whenMatches(w, props));
  if (typeof when !== 'object') return false;
  const entries = Object.entries(when as Record<string, unknown>);
  if (entries.length === 0) return true;
  const isAnd = entries.some(([k]) => k === 'AND');
  if (isAnd) {
    const nested = (when as { AND?: unknown }).AND;
    return Array.isArray(nested) ? nested.every((w) => whenMatches(w, props)) : whenMatches(nested, props);
  }
  if (entries.some(([k]) => k === 'OR')) {
    const nested = (when as { OR?: unknown }).OR;
    return Array.isArray(nested) ? nested.some((w) => whenMatches(w, props)) : whenMatches(nested, props);
  }
  // Pipe alternation ("side|up") is vanilla OR within one property value.
  return entries.every(([k, v]) =>
    typeof v === 'string' && v.split('|').some((alt) => props[k] === alt),
  );
}

/**
 * Resolve one palette entry to textures. Returns null when the blockstate
 * file is missing/unreadable or no variant matched — the caller then uses
 * the existing color fallback.
 */
export function resolveBlockstate(paletteEntry: string, tree: AssetsTree): ResolvedBlock | null {
  const { namespace, base, props } = parsePaletteEntry(paletteEntry);
  const state = tree.get(`${namespace}/blockstates/${base}.json`) as
    | { variants?: Record<string, unknown>; multipart?: { when?: unknown; apply: unknown }[] }
    | undefined;
  if (!state || typeof state !== 'object') return null;

  // Collect candidate model refs: variant match (most specific wins) and
  // all matching multipart parts, in order.
  const refs: string[] = [];
  if (state.variants) {
    let best: string | null = null;
    let bestScore = -1;
    for (const key of Object.keys(state.variants)) {
      if (!variantKeyMatches(key, props)) continue;
      const score = key === '' ? 0 : key.split(',').length;
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
    if (best === null) return null;
    const variant = state.variants[best];
    const modelRef = (variant: unknown): string | null => {
      if (Array.isArray(variant)) return variant.length > 0 ? modelRef(variant[0]) : null;
      if (variant && typeof variant === 'object' && typeof (variant as { model?: unknown }).model === 'string') {
        return (variant as { model: string }).model;
      }
      return null;
    };
    const ref = modelRef(variant);
    if (!ref) return null;
    refs.push(ref);
  }
  if (state.multipart) {
    for (const part of state.multipart) {
      if (!whenMatches(part.when, props)) continue;
      const apply = part.apply;
      const ref = Array.isArray(apply)
        ? typeof apply[0] === 'object' && apply[0] !== null
          ? (apply[0] as { model?: unknown }).model
          : null
        : typeof apply === 'object' && apply !== null
          ? (apply as { model?: unknown }).model
          : null;
      if (typeof ref === 'string') refs.push(ref);
    }
  }
  if (refs.length === 0) return null;

  // Merge textures across the applied models (later parts layer on top).
  let merged: Record<string, string> | null = null;
  for (const ref of refs) {
    const textures = resolveModelTextures(ref, tree);
    if (!textures) return null;
    merged = { ...(merged ?? {}), ...textures };
  }
  const textures = merged!;

  const faces: BlockFaces = { px: null, nx: null, py: null, ny: null, pz: null, nz: null };
  let incomplete = false;
  for (const face of Object.keys(faces) as (keyof BlockFaces)[]) {
    for (const key of FACE_KEYS[face]) {
      const value = textures[key];
      if (!value) continue;
      if (value.startsWith('#')) continue; // dangling ref
      // The path is reported regardless of atlas membership; whether the
      // PNG actually exists is the loader's concern (incomplete flag).
      faces[face] = normalizeTexturePath(value, namespace);
      if (!tree.has(faces[face])) {
        incomplete = true;
      }
      break;
    }
  }

  // Primary texture: what a uniform-color/UV consumer should use.
  const primaryOrder = ['all', 'side', 'top', 'up', 'particle'] as const;
  let texturePath: string | null = null;
  let uvHint = 'particle';
  for (const key of primaryOrder) {
    const value = textures[key];
    if (value && !value.startsWith('#')) {
      texturePath = normalizeTexturePath(value, namespace);
      uvHint = key;
      break;
    }
  }
  if (!texturePath) {
    texturePath = faces.py ?? faces.px;
    uvHint = texturePath === faces.py ? 'up' : 'side';
  }
  if (!texturePath) return null;
  return { texturePath, uvHint, faces, incomplete };
}
