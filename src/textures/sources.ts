/**
 * Asset-source precedence (phase 4c), pure and unit-tested.
 *
 * userAssets (picked via map/zip) > default-assets (same-origin fetch from
 * public/default-assets/) > color fallback. The vanilla default set is
 * supplied by the instance operator via scripts/prepare-default-assets.sh
 * and never ships with the repo.
 */
import { resolveBlockstate, type AssetsTree, type ResolvedBlock } from './atlas.js';

export type TextureSourceKind = 'user' | 'default' | 'fallback';

/** Ordered, available sources only. */
export function resolveSourceOrder(hasUser: boolean, hasDefault: boolean): TextureSourceKind[] {
  const order: TextureSourceKind[] = [];
  if (hasUser) order.push('user');
  if (hasDefault) order.push('default');
  return order;
}

/** Which source renders one block type: first usable wins. */
export function chooseSource(userUsable: boolean, defaultUsable: boolean): TextureSourceKind {
  if (userUsable) return 'user';
  if (defaultUsable) return 'default';
  return 'fallback';
}

/**
 * Resolve one palette entry for rendering, in source order: user assets
 * first, then the default set; null when neither resolves completely.
 * This is the single resolution used by BOTH the status counts and mesh
 * building, so the two can never disagree (the 4d bug: the status counted
 * against the default tree while meshes resolved against user assets
 * only — default-only setups rendered all color while claiming textures).
 */
export function resolveForRender(
  block: string,
  userTree: AssetsTree | null,
  defaultTree: AssetsTree | null,
): ResolvedBlock | null {
  if (userTree) {
    const r = resolveBlockstate(block, userTree);
    if (r && !r.incomplete && r.texturePath) return r;
  }
  if (defaultTree) {
    const r = resolveBlockstate(block, defaultTree);
    if (r && !r.incomplete && r.texturePath) return r;
  }
  return null;
}

const KIND_LABELS: Record<TextureSourceKind, string> = {
  user: 'eigen assets',
  default: 'default assets',
  fallback: 'kleur-fallback',
};

/** Human label for one kind. */
export function sourceLabel(kind: TextureSourceKind): string {
  return KIND_LABELS[kind];
}

/**
 * Status-bar line from per-kind type counts; zero groups are omitted and
 * a fully-fallback render says "kleurmodus" explicitly.
 */
export function sourceStatusLine(counts: Record<TextureSourceKind, number>): string {
  const parts: string[] = [];
  if (counts.user > 0) parts.push(`${counts.user} types (${KIND_LABELS.user})`);
  if (counts.default > 0) parts.push(`${counts.default} types (${KIND_LABELS.default})`);
  if (counts.fallback > 0) parts.push(`${counts.fallback} ${KIND_LABELS.fallback}`);
  if (parts.length === 0) return 'kleurmodus (geen textures beschikbaar)';
  return parts.join(', ');
}

/**
 * Status line for the atlas-report slot. When the atlas is actually bound
 * the per-source split is shown; when resolution succeeded but the atlas
 * could not be built yet, say so instead of claiming textured rendering.
 */
export function atlasReportLine(split: string | null, resolvedTypes: number): string {
  return split ?? `${resolvedTypes} types resolvet, render pending`;
}

