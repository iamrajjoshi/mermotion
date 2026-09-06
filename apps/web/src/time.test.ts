import { describe, expect, it } from 'vitest';

import { clampTime, formatTimecode, timeToPercent } from './time';

describe('timeline time helpers', () => {
  it('formats stable editor timecodes', () => {
    expect(formatTimecode(0)).toBe('00:00.00');
    expect(formatTimecode(1_234)).toBe('00:01.23');
    expect(formatTimecode(62_099)).toBe('01:02.09');
  });

  it('clamps seeks to the deterministic playback interval', () => {
    expect(clampTime(-20, 4_800)).toBe(0);
    expect(clampTime(2_400, 4_800)).toBe(2_400);
    expect(clampTime(8_000, 4_800)).toBe(4_800);
    expect(timeToPercent(2_400, 4_800)).toBe(50);
  });
});
