import { describe, expect, it } from 'vitest';
import { layerOpacity, LAYER_FADE_MIN, LAYER_FADE_RANGE } from '../src/slicer/layer-opacity.js';

describe('layerOpacity — 4e B3', () => {
  it('active layer (distance <= 0) is fully visible in both modes', () => {
    expect(layerOpacity(0, 'cumulative')).toBe(1);
    expect(layerOpacity(0, 'isolate')).toBe(1);
    expect(layerOpacity(-3, 'cumulative')).toBe(1); // layers above: full
    expect(layerOpacity(-3, 'isolate')).toBe(1);
  });

  it('monotonically non-increasing in distance (cumulative)', () => {
    let prev = Infinity;
    for (let d = 0; d <= 12; d++) {
      const f = layerOpacity(d, 'cumulative');
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it('cumulative fades linearly to the floor over the fade range', () => {
    expect(layerOpacity(1, 'cumulative')).toBeCloseTo(1 - 0.72 / 5, 12);
    expect(layerOpacity(LAYER_FADE_RANGE, 'cumulative')).toBeCloseTo(LAYER_FADE_MIN, 12);
    expect(layerOpacity(LAYER_FADE_RANGE + 10, 'cumulative')).toBeCloseTo(LAYER_FADE_MIN, 12);
  });

  it('isolate dims everything except the active layer to the floor', () => {
    expect(layerOpacity(1, 'isolate')).toBe(LAYER_FADE_MIN);
    expect(layerOpacity(50, 'isolate')).toBe(LAYER_FADE_MIN);
  });

  it('near layers are much more visible than deep layers (cumulative vs old binary dim)', () => {
    expect(layerOpacity(1, 'cumulative')).toBeGreaterThan(0.8);
    expect(layerOpacity(1, 'cumulative')).toBeGreaterThan(layerOpacity(3, 'cumulative'));
  });

  it('custom options: range 1 collapses to the floor in one step', () => {
    expect(layerOpacity(1, 'cumulative', { min: 0.5, range: 1 })).toBe(0.5);
    expect(layerOpacity(0.5, 'cumulative', { min: 0.5, range: 1 })).toBeCloseTo(0.75, 12);
  });
});
