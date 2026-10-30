/**
 * Human-readable load-error presentation (pure; the card wiring lives in
 * main.ts). Typed errors from the parse/asset pipelines map to short Dutch
 * titles; the original error name + message stay visible as a one-line
 * detail — stack traces never reach the UI.
 */
import { SchemParseError } from '../schem/types.js';
import { AssetError } from '../textures/assets.js';

export interface LoadErrorView {
  /** Short human title, mentioning the file when one is known. */
  title: string;
  /** One-line technical detail (error name + message, no stack). */
  detail: string;
}

export function formatLoadError(err: unknown, label: string): LoadErrorView {
  const file = label.trim();
  if (err instanceof SchemParseError) {
    return {
      title: file ? `"${file}" is geen leesbare schematic` : 'Dit is geen leesbare schematic',
      detail: `${err.name}: ${err.message}`,
    };
  }
  if (err instanceof AssetError) {
    return {
      title: file ? `Texturebron "${file}" kon niet gelezen worden` : 'Texturebron kon niet gelezen worden',
      detail: `${err.name}: ${err.message}`,
    };
  }
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return {
    title: file ? `Laden van "${file}" mislukt` : 'Laden mislukt',
    detail,
  };
}
