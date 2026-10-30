import { describe, expect, it } from 'vitest';
import { SchemParseError } from '../src/schem/types.js';
import { AssetError } from '../src/textures/assets.js';
import { formatLoadError } from '../src/ui/errors.js';

describe('formatLoadError', () => {
  it('maps SchemParseError to a human title with the error name as detail', () => {
    const view = formatLoadError(new SchemParseError('missing field "Width"'), 'huis.schem');
    expect(view.title).toBe('"huis.schem" is geen leesbare schematic');
    expect(view.detail).toBe('SchemParseError: missing field "Width"');
  });

  it('works without a file label', () => {
    const view = formatLoadError(new SchemParseError('BlockData is empty'), '');
    expect(view.title).toBe('Dit is geen leesbare schematic');
    expect(view.detail).toContain('SchemParseError');
  });

  it('maps AssetError (bad texture zip/dir) to a texture-source title', () => {
    const view = formatLoadError(new AssetError('geen geldige zip'), 'pack.zip');
    expect(view.title).toBe('Texturebron "pack.zip" kon niet gelezen worden');
    expect(view.detail).toBe('AssetError: geen geldige zip');
  });

  it('maps generic Errors to a neutral title with name + message', () => {
    const view = formatLoadError(new TypeError('fetch failed'), 'x.schem');
    expect(view.title).toBe('Laden van "x.schem" mislukt');
    expect(view.detail).toBe('TypeError: fetch failed');
  });

  it('survives non-Error throwables', () => {
    const view = formatLoadError('kapot', 'x.schem');
    expect(view.title).toBe('Laden van "x.schem" mislukt');
    expect(view.detail).toBe('kapot');
  });

  it('never leaks a stack trace (single line, no frame text)', () => {
    const err = new SchemParseError('missing field "Width"', { cause: new Error('inner boom') });
    const view = formatLoadError(err, 'a.schem');
    expect(view.detail).not.toContain('\n');
    expect(view.detail).not.toContain('    at ');
    expect(view.title).not.toContain('    at ');
  });
});
