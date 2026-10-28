/**
 * Model geometry (phase 5a) — pure, DOM-free, three.js-free.
 *
 * Turns resolved model elements (src/textures/models.ts) into triangle
 * soup: per visible face four corners + per-corner uv (normalized 0..1,
 * v measured from the texture TOP, converted at atlas-mapping time) plus
 * an index order that renders outward-facing. Element rotations (±45° on
 * one axis, e.g. the lever stick) rotate the corner positions exactly —
 * no AABB approximation. Face-culling ("cullface") is intentionally
 * ignored: a build guide must show interior faces too.
 *
 * Face corner convention (per vanilla block models): corners are emitted
 * in uv order TL, TR, BL, BR; indices [0,2,1, 1,2,3] give outward CCW
 * triangles. uvRot rotates the texture clockwise inside the face.
 */
import type { FaceDir, ModelElement } from '../textures/models.js';

export interface FaceQuad {
  /** Four corners in uv order (TL, TR, BL, BR), block-local units 0..1. */
  corners: [number, number, number][];
  /** Per-corner uv in texture fractions, v from TOP: TL,TR,BL,BR. */
  uv: [number, number][];
  texturePath: string;
  dir: FaceDir;
}

type Box = [number, number, number];

/** Element coords are 0..16 block units; the viewer works in 0..1. */
const SCALE = 1 / 16;

/**
 * Corner positions per face in uv order TL,TR,BL,BR for a box (x1..x2,
 * y1..y2, z1..z2), following the vanilla per-face uv orientation
 * (up: u→+x, v→+z; north: viewed from −z; …).
 */
function faceCorners(from: Box, to: Box, dir: FaceDir): [Box, Box, Box, Box] {
  const [x1, y1, z1] = from;
  const [x2, y2, z2] = to;
  switch (dir) {
    case 'up': return [[x1!, y2!, z1!], [x2!, y2!, z1!], [x1!, y2!, z2!], [x2!, y2!, z2!]];
    case 'down': return [[x1!, y1!, z2!], [x2!, y1!, z2!], [x1!, y1!, z1!], [x2!, y1!, z1!]];
    case 'north': return [[x2!, y2!, z1!], [x1!, y2!, z1!], [x2!, y1!, z1!], [x1!, y1!, z1!]];
    case 'south': return [[x1!, y2!, z2!], [x2!, y2!, z2!], [x1!, y1!, z2!], [x2!, y1!, z2!]];
    case 'west': return [[x1!, y2!, z2!], [x1!, y2!, z1!], [x1!, y1!, z2!], [x1!, y1!, z1!]];
    case 'east': return [[x2!, y2!, z1!], [x2!, y2!, z2!], [x2!, y1!, z1!], [x2!, y1!, z2!]];
  }
}

/** Rotate one point around an axis through origin by `angle` degrees. */
export function rotatePoint(
  p: Box,
  origin: Box,
  axis: 'x' | 'y' | 'z',
  angle: number,
): Box {
  const rad = (angle * Math.PI) / 180;
  const [x, y, z] = [p[0]! - origin[0]!, p[1]! - origin[1]!, p[2]! - origin[2]!];
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let out: [number, number, number];
  if (axis === 'x') out = [x, y * c - z * s, y * s + z * c];
  else if (axis === 'y') out = [x * c + z * s, y, -x * s + z * c];
  else out = [x * c - y * s, x * s + y * c, z];
  return [out[0]! + origin[0]!, out[1]! + origin[1]!, out[2]! + origin[2]!];
}

/** Default (full-tile) uv in pixel space: [x1,y1,x2,y2] per face. */
function defaultUv(from: Box, to: Box, dir: FaceDir): [number, number, number, number] {
  const [x1, y1, z1] = from;
  const [x2, y2, z2] = to;
  switch (dir) {
    case 'up': return [x1!, 16 - z2!, x2!, 16 - z1!];
    case 'down': return [x1!, z1!, x2!, z2!];
    case 'north': return [16 - x2!, 16 - y2!, 16 - x1!, 16 - y1!];
    case 'south': return [x1!, 16 - y2!, x2!, 16 - y1!];
    case 'west': return [z1!, 16 - y2!, z2!, 16 - y1!];
    case 'east': return [16 - z2!, 16 - y2!, 16 - z1!, 16 - y1!];
  }
}

/**
 * uvRot: the texture rotates clockwise inside the face, so each corner
 * receives the uv of the corner the content came FROM: 90° cw moves
 * TL-content to TR ⇒ new[i] = old[(i + 3) % 4], and 90° more each step.
 */
function applyUvRot(uv: [number, number][], rot: 0 | 90 | 180 | 270): [number, number][] {
  const k = rot / 90;
  return uv.map((_, i) => uv[((i - k) % 4 + 4) % 4]!);
}

function uvCorners(
  rect: [number, number, number, number],
): [number, number][] {
  const [u1, v1, u2, v2] = rect;
  // TL, TR, BL, BR in pixel coords (v from top)
  return [[u1 / 16, v1 / 16], [u2 / 16, v1 / 16], [u1 / 16, v2 / 16], [u2 / 16, v2 / 16]];
}

/**
 * All outward-facing quads of one element, rotated and uv-mapped. Faces
 * without a resolvable texture are skipped by the resolver already.
 */
export function elementQuads(el: ModelElement): FaceQuad[] {
  const quads: FaceQuad[] = [];
  for (const [dir, face] of Object.entries(el.faces) as [FaceDir, NonNullable<ModelElement['faces'][FaceDir]>][]) {
    const corners = faceCorners(el.from, el.to, dir).map((c) => [
      c[0] * SCALE, c[1] * SCALE, c[2] * SCALE,
    ] as Box);
    const rotated = el.rotation
      ? corners.map((c) => rotatePoint(c, el.rotation!.origin.map((n) => n * SCALE) as Box, el.rotation!.axis, el.rotation!.angle))
      : corners;
    const rect = face.uv ?? defaultUv(el.from, el.to, dir);
    const uv = applyUvRot(uvCorners(rect), face.uvRot);
    quads.push({ corners: rotated, uv, texturePath: face.texturePath, dir });
  }
  return quads;
}

/** All quads of a model, in element order (deterministic). */
export function modelQuads(elements: readonly ModelElement[]): FaceQuad[] {
  const out: FaceQuad[] = [];
  for (const el of elements) out.push(...elementQuads(el));
  return out;
}

/**
 * Triangle-soup arrays ready for a BufferGeometry, with uv remapped into
 * atlas rects. `rectFor` returns the atlas uv rect (u0,v0,u1,v1 with v0 =
 * BOTTOM edge — three.js flipY) or null to drop the face (texture not in
 * the atlas). Index order [0,2,1, 1,2,3] per quad renders outward-facing.
 */
export function buildModelArrays(
  quads: readonly FaceQuad[],
  rectFor: (texturePath: string) => { u0: number; v0: number; u1: number; v1: number } | null,
): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const quad of quads) {
    const rect = rectFor(quad.texturePath);
    if (!rect) continue;
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const c = quad.corners[i]!;
      positions.push(c[0]!, c[1]!, c[2]!);
      // quad uv v is from TOP; rect v0 is the BOTTOM edge (flipY).
      const u = rect.u0 + quad.uv[i]![0]! * (rect.u1 - rect.u0);
      const v = rect.v1 - quad.uv[i]![1]! * (rect.v1 - rect.v0);
      uvs.push(u, v);
    }
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}
