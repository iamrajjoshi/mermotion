import { describe, expect, it } from 'vitest';

import { effectPaintOverflowPixels } from '../src/index.js';

describe('motion viewport paint overflow', () => {
  it('reserves the complete stacked pulse-shadow kernel', () => {
    expect(effectPaintOverflowPixels({ highlight: 0, pulse: 1, visible: true })).toBe(34);
  });

  it('scales highlight paint with effect progress', () => {
    expect(effectPaintOverflowPixels({ highlight: 1, pulse: 0, visible: true })).toBe(12);
    expect(effectPaintOverflowPixels({ highlight: 0.5, pulse: 0, visible: true })).toBe(8);
  });

  it('does not reserve paint for inactive or invisible effects', () => {
    expect(effectPaintOverflowPixels({ highlight: 0, pulse: 0, visible: true })).toBe(0);
    expect(effectPaintOverflowPixels({ highlight: 1, pulse: 0, visible: false })).toBe(0);
  });
});
