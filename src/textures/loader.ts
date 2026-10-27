/**
 * Canvas-atlas builder for user-supplied block textures (browser side).
 *
 * Decodes the PNGs an AssetFiles tree contains for the texture paths the
 * blockstate resolver requested, lays them out in a grid on one canvas,
 * and returns per-texture UV rects. Missing or undecodable textures are
 * reported in `missing`/`broken` — the viewer falls back to its color
 * rendering for those types and the status bar says so explicitly; this
 * module never fails silently.
 *
 * UI-keuring-grens: de gerenderde uitkomst (UV-orientatie per face,
 * tinting, transparantie) wordt visueel gekeurd, niet door unit tests.
 * Wat hier wél getest wordt is de pure layout (`planAtlas`).
 */
import type { UVRect } from './atlas.js';
import type { AssetFiles } from './assets.js';

export interface AtlasPlan {
  cols: number;
  rows: number;
  /** Atlas edge in pixels (square, power of two). */
  size: number;
  /** Cell edge in pixels (uniform, scaled-to-fit tiles). */
  cell: number;
}

export interface AtlasResult {
  canvas: HTMLCanvasElement;
  /** CanvasTexture-ready UV rect per texture path that was placed. */
  uvRects: Map<string, UVRect>;
  placed: string[];
  /** Requested paths with no PNG in the assets tree. */
  missing: string[];
  /** PNGs present but undecodable. */
  broken: string[];
}

/** Deterministic grid layout: as square as possible, power-of-two atlas. */
export function planAtlas(count: number, cell: number): AtlasPlan {
  const n = Math.max(count, 1);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const edge = Math.max(cols, rows) * cell;
  const size = 1 << Math.ceil(Math.log2(edge));
  return { cols, rows, size, cell };
}

async function decodePng(bytes: Uint8Array): Promise<ImageBitmap> {
  const copy = new Uint8Array(bytes); // detach-safe copy for Blob
  return createImageBitmap(new Blob([copy.buffer as ArrayBuffer], { type: 'image/png' }));
}

/**
 * Build the atlas. `texturePaths` are normalized paths
 * ("minecraft:textures/block/stone.png"); order determines grid position,
 * so the caller controls determinism.
 */
export async function buildAtlas(files: AssetFiles, texturePaths: string[], cell = 16): Promise<AtlasResult> {
  const missing: string[] = [];
  const broken: string[] = [];
  const present: { path: string; bytes: Uint8Array }[] = [];
  for (const path of texturePaths) {
    const bytes = files.get(path);
    if (!bytes) {
      missing.push(path);
      continue;
    }
    present.push({ path, bytes });
  }

  const plan = planAtlas(present.length, cell);
  const canvas = document.createElement('canvas');
  canvas.width = plan.size;
  canvas.height = plan.size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const uvRects = new Map<string, UVRect>();
  const placed: string[] = [];
  // Half-texel inset on every side so adjacent atlas tiles never bleed
  // (the texture uses NearestFilter without mipmaps).
  const eps = 0.5 / plan.size;
  for (let i = 0; i < present.length; i++) {
    const { path, bytes } = present[i]!;
    const col = i % plan.cols;
    const row = Math.floor(i / plan.cols);
    let bitmap: ImageBitmap;
    try {
      bitmap = await decodePng(bytes);
    } catch {
      broken.push(path);
      continue;
    }
    const x = col * plan.cell;
    const y = row * plan.cell;
    ctx.drawImage(bitmap, x, y, plan.cell, plan.cell);
    bitmap.close();
    const u0 = x / plan.size + eps;
    const u1 = (x + plan.cell) / plan.size - eps;
    // flipY textures (three.js default): v axis is mirrored against canvas y.
    const v0 = 1 - (y + plan.cell) / plan.size + eps;
    const v1 = 1 - y / plan.size - eps;
    uvRects.set(path, { u0, v0, u1, v1 });
    placed.push(path);
  }

  return { canvas, uvRects, placed, missing, broken };
}
