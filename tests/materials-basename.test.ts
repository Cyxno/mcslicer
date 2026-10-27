import { describe, expect, it } from 'vitest';
import { baseTypeName } from '../src/slicer/materials.js';

describe('baseTypeName (4d materiaallijst)', () => {
  it('stript state properties', () => {
    expect(baseTypeName('minecraft:redstone_wire[east=side,north=none,power=14,south=up,west=none]')).toBe('redstone_wire');
    expect(baseTypeName('minecraft:furnace[facing=north,lit=true]')).toBe('furnace');
    expect(baseTypeName('minecraft:chest[facing=west,type=right,waterlogged=false]')).toBe('chest');
  });

  it('stript namespace en laat kale ids intact', () => {
    expect(baseTypeName('minecraft:dirt')).toBe('dirt');
    expect(baseTypeName('dirt')).toBe('dirt');
    expect(baseTypeName('othermod:gadget[mode=fast]')).toBe('gadget');
  });
});
