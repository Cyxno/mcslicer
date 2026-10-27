/**
 * Asset-source precedence (phase 4c), pure and unit-tested.
 *
 * userAssets (picked via map/zip) > default-assets (same-origin fetch from
 * public/default-assets/) > color fallback. The vanilla default set is
 * supplied by the instance operator via scripts/prepare-default-assets.sh
 * and never ships with the repo.
 */

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
