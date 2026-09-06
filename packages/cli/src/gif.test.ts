import { describe, expect, it } from 'vitest';
import {
  createGifFramePlan,
  fitGifDimensions,
  gifRepeatCount,
  MAX_GIF_FRAMES,
  validateGifWorkload,
} from './gif.js';

describe('CLI GIF planning', () => {
  it('samples at 20fps, preserves the exact final state, and uses the requested loop hold', () => {
    expect(createGifFramePlan(120, 500)).toEqual({
      frames: [
        { delayMs: 50, timeMs: 0 },
        { delayMs: 50, timeMs: 50 },
        { delayMs: 20, timeMs: 100 },
        { delayMs: 500, timeMs: 120 },
      ],
      playbackMs: 620,
    });
  });

  it('does not create a redundant near-terminal frame below GIF delay precision', () => {
    expect(createGifFramePlan(105, 0).frames).toEqual([
      { delayMs: 50, timeMs: 0 },
      { delayMs: 60, timeMs: 50 },
      { delayMs: 10, timeMs: 105 },
    ]);
  });

  it('creates one displayable frame for a zero-duration timeline', () => {
    expect(createGifFramePlan(0, 0)).toEqual({
      frames: [{ delayMs: 10, timeMs: 0 }],
      playbackMs: 10,
    });
  });

  it('bounds frame count and total pixel work', () => {
    expect(() => createGifFramePlan(60_000, 0)).toThrow(`${MAX_GIF_FRAMES} frames`);
    expect(() => validateGifWorkload({ height: 2_400, width: 960 }, 600)).toThrow('too large');
  });

  it('fits tall diagrams without exceeding the encoder dimension cap', () => {
    expect(fitGifDimensions(100, 1_000)).toEqual({ height: 2_400, width: 240 });
  });

  it('maps human loop values to GIF repeat metadata', () => {
    expect(gifRepeatCount('forever')).toBe(0);
    expect(gifRepeatCount('once')).toBe(-1);
    expect(gifRepeatCount('1')).toBe(-1);
    expect(gifRepeatCount('3')).toBe(2);
    expect(() => gifRepeatCount('sometimes')).toThrow('total play count');
    expect(() => gifRepeatCount('0')).toThrow('total play count');
  });
});
