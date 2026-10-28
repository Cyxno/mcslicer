/**
 * Model-elements resolution (phase 5a) — pure and DOM-free.
 *
 * Goes one level deeper than atlas.ts: reads the `elements[]` of the
 * selected blockstate models (from/to, faces, per-face uv + rotation,
 * element rotation) and resolves every face's "#ref" texture to a
 * normalized texture path. Returns null when the blockstate or any selected
 * model file is missing — the caller then keeps its existing cube/color
 * fallback and reports the type via the existing fallback counter.
 *
 * Selection follows the vanilla chain (see atlas.ts): palette entry →
 * blockstate variants/multipart → model refs; textures merge child-wins
 * over the parent chain; elements come from the shallowest model that
 * defines them. Multipart models (fences, walls) contribute one merged
 * texture set across their parts; elements are collected from EVERY part
 * that defines them (post + side quads).
 */
import {
  loadMergedModel,
  modelRefsFor,
  normalizeTexturePath,
  type AssetsTree,
  type RawModelElement,
} from './atlas.js';

export type FaceDir = 'north' | 'south' | 'west' | 'east' | 'up' | 'down';

/** One face ready for geometry building. */
export interface ModelFace {
  /** Normalized texture path ("minecraft:textures/block/x.png"). */
  texturePath: string;
  /** Vanilla uv in texture-pixel space (0..16, y from top), or null = full. */
  uv: [number, number, number, number] | null;
  /** Texture rotation inside the face, clockwise (vanilla "rotation"). */
  uvRot: 0 | 90 | 180 | 270;
}

/** One resolved element: box bounds in block units (0..16), rotated faces. */
export interface ModelElement {
  from: [number, number, number];
  to: [number, number, number];
  faces: Partial<Record<FaceDir, ModelFace>>;
  rotation: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number } | null;
}

const FACE_DIRS: readonly FaceDir[] = ['north', 'south', 'west', 'east', 'up', 'down'];
const UV_ROTS: readonly number[] = [0, 90, 180, 270];

function parseRawElement(raw: RawModelElement, textures: Record<string, string>, namespace: string): ModelElement | null {
  const from = raw.from;
  const to = raw.to;
  if (!Array.isArray(from) || !Array.isArray(to) || from.length !== 3 || to.length !== 3) return null;
  const faces: ModelElement['faces'] = {};
  for (const dir of FACE_DIRS) {
    const rawFace = raw.faces?.[dir];
    if (!rawFace || typeof rawFace.texture !== 'string') continue;
    let texturePath: string | null = null;
    if (!rawFace.texture.startsWith('#')) {
      texturePath = normalizeTexturePath(rawFace.texture, namespace);
    } else {
      const resolved = textures[rawFace.texture.slice(1)];
      if (resolved) texturePath = normalizeTexturePath(resolved, namespace);
    }
    if (!texturePath) continue; // dangling #ref: skip this face, keep the rest
    const uvRaw = rawFace.uv;
    const uv = Array.isArray(uvRaw) && uvRaw.length === 4 && uvRaw.every((n) => typeof n === 'number')
      ? (uvRaw as [number, number, number, number])
      : null;
    const rawRot = rawFace.rotation ?? 0;
    const uvRot = UV_ROTS.includes(rawRot) ? (rawRot as 0 | 90 | 180 | 270) : 0;
    faces[dir] = { texturePath, uv, uvRot };
  }
  const rot = raw.rotation;
  const rotation =
    rot && rot.origin && rot.axis && typeof rot.angle === 'number' &&
    ['x', 'y', 'z'].includes(rot.axis) &&
    (rot.origin as unknown[]).length === 3
      ? { origin: rot.origin as [number, number, number], axis: rot.axis as 'x' | 'y' | 'z', angle: rot.angle }
      : null;
  return {
    from: [from[0]!, from[1]!, from[2]!],
    to: [to[0]!, to[1]!, to[2]!],
    faces,
    rotation,
  };
}

/**
 * Resolve one palette entry's model elements against one assets tree.
 * Null when the blockstate is missing, no variant matched, or a selected
 * model file is unreadable. Every matched model's elements are included
 * (multipart: post + wall quads).
 */
export function elementsFor(paletteEntry: string, tree: AssetsTree): ModelElement[] | null {
  const { namespace } = parseNamespaceOf(paletteEntry);
  const refs = modelRefsFor(paletteEntry, tree);
  if (!refs) return null;
  const out: ModelElement[] = [];
  for (const ref of refs) {
    const model = loadMergedModel(ref, tree);
    if (!model) return null;
    if (!model.elements) continue; // cube-only models have no elements
    for (const raw of model.elements) {
      const el = parseRawElement(raw, model.textures, namespace);
      if (el) out.push(el);
    }
  }
  return out.length > 0 ? out : null;
}

function parseNamespaceOf(paletteEntry: string): { namespace: string } {
  const colon = paletteEntry.indexOf(':');
  const namespace = colon === -1 ? 'minecraft' : paletteEntry.slice(0, colon);
  return { namespace };
}

/**
 * Source-order resolution for rendering (user assets > default set) —
 * mirrors sources.resolveForRender so meshes and the reported texture
 * state can never disagree. Null when neither tree resolves completely.
 */
export function elementsForRender(
  paletteEntry: string,
  userTree: AssetsTree | null,
  defaultTree: AssetsTree | null,
): ModelElement[] | null {
  if (userTree) {
    const r = elementsFor(paletteEntry, userTree);
    if (r) return r;
  }
  if (defaultTree) {
    const r = elementsFor(paletteEntry, defaultTree);
    if (r) return r;
  }
  return null;
}
