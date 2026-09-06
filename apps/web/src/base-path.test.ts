import { describe, expect, it } from 'vitest';

import { normalizeBasePath } from './base-path';

describe('normalizeBasePath', () => {
  it.each([undefined, '', ' ', '/'])("uses the site root for '%s'", (configuredPath) => {
    expect(normalizeBasePath(configuredPath)).toBe('/');
  });

  it.each([
    ['mermotion', '/mermotion/'],
    ['/mermotion', '/mermotion/'],
    ['/mermotion/', '/mermotion/'],
  ])('normalizes %s for a project site', (configuredPath, expected) => {
    expect(normalizeBasePath(configuredPath)).toBe(expected);
  });
});
