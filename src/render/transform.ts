/**
 * Pure model-space <-> world-space mapping (phase 4e, part A).
 *
 * The viewer scales the schematic into world space with one transform
 * (group-fitScale + centering). Fixed-size effects that must track blocks
 * (hover highlight, step marker, ground grid) are parented under that
 * transform and addressed in LOCAL coordinates — a 1x1x1 box in local
 * space is exactly one block regardless of scale. These helpers hold the
 * math; the Viewer only applies it.
 */
import { Matrix4, Vector3 } from 'three';
import type { Schematic } from '../schem/types.js';

/** Longest-edge fit scale used by the slicer view (keep in sync with the Viewer). */
export function fitScale(size: { x: number; y: number; z: number }): number {
  return 16 / Math.max(size.x, size.y, size.z);
}

/**
 * The single model transform: uniform fit scale, model centered on x/z,
 * base on y=0. Same matrix the Viewer bakes into its meshes.
 */
export function modelMatrix(size: Schematic['size']): Matrix4 {
  const s = fitScale(size);
  const m = new Matrix4();
  m.makeScale(s, s, s);
  m.setPosition(-(size.x / 2) * s, 0, -(size.z / 2) * s);
  return m;
}

/** World-space point -> schematic block coordinates (floor of the local point). */
export function worldToBlock(m: Matrix4, p: Vector3): { x: number; y: number; z: number } {
  const local = p.clone().applyMatrix4(m.clone().invert());
  return { x: Math.floor(local.x), y: Math.floor(local.y), z: Math.floor(local.z) };
}

/** Local-space point -> world space (the forward transform, for roundtrips). */
export function localToWorld(m: Matrix4, p: Vector3): Vector3 {
  return p.clone().applyMatrix4(m);
}

/** Center of one block, in model-local coordinates. */
export function blockCenterLocal(c: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(c.x + 0.5, c.y + 0.5, c.z + 0.5);
}

/**
 * Ground-grid footprint in BLOCK units: cells of `cell` blocks, extended
 * one cell past the model on every side. The Viewer parents the grid under
 * the model transform, so these block units render as block-sized cells
 * at any zoom (the 4e audit: the old grid was sized in block units but
 * placed in world space — cells grew and shrank with model scale).
 */
export function gridSpan(sizeX: number, sizeZ: number, cell = 8): number {
  return Math.ceil(Math.max(sizeX, sizeZ) / cell) * cell + cell * 2;
}
