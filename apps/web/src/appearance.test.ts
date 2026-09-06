import { describe, expect, it } from 'vitest';

import {
  defaultAppearancePreference,
  isHexColor,
  normalizeHexColor,
  resolveMermaidPalette,
  resolveShellPalette,
  shellPaletteCssVariables,
  shellPaletteNames,
  shellPalettes,
} from './appearance';

function luminance(color: string): number {
  const channels = [1, 3, 5].map(
    (start) => Number.parseInt(color.slice(start, start + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe('appearance palettes', () => {
  it('provides the four named presets in product order', () => {
    expect(shellPaletteNames).toEqual(['Graphite', 'Blueprint', 'Paper', 'Midnight']);
    expect(defaultAppearancePreference.shellPreset).toBe('Graphite');
    expect(Object.keys(shellPalettes)).toEqual(shellPaletteNames);
  });

  it('normalizes only six-digit hexadecimal colors', () => {
    expect(normalizeHexColor(' 5B8CFF ')).toBe('#5b8cff');
    expect(normalizeHexColor('#ABC123')).toBe('#abc123');
    expect(normalizeHexColor('#fff')).toBeUndefined();
    expect(normalizeHexColor('#abcdex')).toBeUndefined();
    expect(isHexColor('#5b8cff')).toBe(true);
    expect(isHexColor('#5B8CFF')).toBe(true);
    expect(isHexColor('5B8CFF')).toBe(false);
  });

  it('applies normalized overrides without changing other preset fields', () => {
    const palette = resolveShellPalette({
      shellPreset: 'Blueprint',
      shellOverrides: {
        accent: '#FF00AA',
      },
    });

    expect(palette.name).toBe('Blueprint');
    expect(palette.accent).toBe('#ff00aa');
    expect(palette.rule).toBe(shellPalettes.Blueprint.rule);
  });

  it('maps semantic colors to the workbench CSS contract', () => {
    const variables = shellPaletteCssVariables(shellPalettes.Graphite);

    expect(variables['--graphite']).toBe('#15171c');
    expect(variables['--panel']).toBe('#1d2027');
    expect(variables['--canvas']).toBe('#f4f6f8');
    expect(variables['--motion']).toBe('#5b8cff');
    expect(variables['--transport']).toBe('#ff5470');
    expect(variables['--transport-ink']).toBe('#101217');
    expect(variables['--motion-wash']).toMatch(/^#[\da-f]{6}$/);
    expect(variables['--header-muted']).toMatch(/^#[\da-f]{6}$/);
  });

  it('keeps header metadata legible in every built-in preset', () => {
    for (const palette of Object.values(shellPalettes)) {
      const variables = shellPaletteCssVariables(palette);
      expect(
        contrastRatio(variables['--header']!, variables['--header-muted']!),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('derives readable transport ink for extreme custom colors', () => {
    const blackTransport = shellPaletteCssVariables(
      resolveShellPalette({ shellPreset: 'Graphite', shellOverrides: { transport: '#000000' } }),
    );
    const whiteTransport = shellPaletteCssVariables(
      resolveShellPalette({ shellPreset: 'Graphite', shellOverrides: { transport: '#ffffff' } }),
    );

    expect(blackTransport['--transport-ink']).toBe('#ffffff');
    expect(whiteTransport['--transport-ink']).toBe('#101217');
  });

  it('resolves a partial Mermaid palette with normalized fallback values', () => {
    expect(resolveMermaidPalette({ primaryColor: '#ABCDEF' })).toMatchObject({
      primaryColor: '#abcdef',
      lineColor: '#687086',
    });
  });
});
