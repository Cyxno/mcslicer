import { describe, expect, it } from 'vitest';
import { sliceVisible, type SliceMode } from '../src/slicer/steps.js';

describe('sliceVisible (4d slice semantics)', () => {
  it('cumulative (default): toon t/m laag N', () => {
    const mode: SliceMode = 'cumulative';
    expect(sliceVisible(0, 3, mode)).toBe(true);
    expect(sliceVisible(2, 3, mode)).toBe(true);
    expect(sliceVisible(3, 3, mode)).toBe(true);
    expect(sliceVisible(4, 3, mode)).toBe(false);
  });

  it('isolate: toon alleen laag N', () => {
    const mode: SliceMode = 'isolate';
    expect(sliceVisible(3, 3, mode)).toBe(true);
    expect(sliceVisible(2, 3, mode)).toBe(false);
    expect(sliceVisible(4, 3, mode)).toBe(false);
  });

  it('zonder gekozen laag (current < 0) is de hele build zichtbaar', () => {
    expect(sliceVisible(0, -1, 'cumulative')).toBe(true);
    expect(sliceVisible(7, -1, 'isolate')).toBe(true);
  });
});
