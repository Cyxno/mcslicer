import type { BlockFaces, UVRect } from './atlas.js';

/**
 * BoxGeometry face order in three.js: +x, -x, +y, -y, +z, -z, each face
 * with 4 vertices (uv layout per face: (0,1) (1,1) (0,0) (1,0)).
 */
export const BOX_FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;

const FACE_CORNERS: [number, number][] = [
  [0, 1],
  [1, 1],
  [0, 0],
  [1, 0],
];

/**
 * Build the uv attribute values (48 floats) for a BoxGeometry so each face
 * samples its own atlas rect. Faces without a rect fall back to
 * `fallbackRect` (callers pass the rect of the primary texture) or, when
 * that is also null, to null — then the whole type uses color rendering.
 * Returns null only when *no* face has a rect.
 */
export function boxFaceUVs(
  rects: Partial<Record<keyof BlockFaces, UVRect | null>>,
  fallbackRect: UVRect | null,
): Float32Array | null {
  const out = new Float32Array(24 * 2);
  let assigned = 0;
  BOX_FACE_ORDER.forEach((face, faceIndex) => {
    const rect = rects[face] ?? fallbackRect;
    if (!rect) return;
    assigned++;
    FACE_CORNERS.forEach(([cu, cv], corner) => {
      const i = (faceIndex * 4 + corner) * 2;
      out[i] = rect.u0 + cu * (rect.u1 - rect.u0);
      out[i + 1] = rect.v0 + cv * (rect.v1 - rect.v0);
    });
  });
  return assigned > 0 ? out : null;
}
