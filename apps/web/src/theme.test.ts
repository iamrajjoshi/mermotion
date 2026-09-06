import { describe, expect, it } from 'vitest';

import {
  readMermaidPalette,
  readMermaidTheme,
  writeMermaidPalette,
  writeMermaidTheme,
} from './theme';

describe('Mermaid theme source edits', () => {
  it('changes only the existing theme value', () => {
    const source = '---\nconfig:\n  theme: base\n---\nflowchart LR\n  A --> B';
    const changed = writeMermaidTheme(source, 'forest');
    expect(changed).toBe('---\nconfig:\n  theme: forest\n---\nflowchart LR\n  A --> B');
    expect(readMermaidTheme(changed)).toBe('forest');
  });

  it.each(['"dark"', "'dark'"])('recognizes and preserves a quoted theme value (%s)', (value) => {
    const source = `---\nconfig:\n  theme: ${value}\n---\nflowchart LR\n  A --> B`;
    const quote = value[0];

    expect(readMermaidTheme(source)).toBe('dark');
    expect(writeMermaidTheme(source, 'forest')).toContain(`theme: ${quote}forest${quote}`);
  });

  it('adds standard Mermaid frontmatter to a plain diagram', () => {
    expect(writeMermaidTheme('flowchart LR\n  A --> B', 'dark')).toBe(
      '---\nconfig:\n  theme: dark\n---\nflowchart LR\n  A --> B',
    );
  });

  it('inserts a Mermaid base palette while retaining the original diagram bytes', () => {
    const body = 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n';
    const changed = writeMermaidPalette(body, {
      primaryColor: '#112233',
      lineColor: '#445566',
    });

    expect(changed).toBe(
      '---\nconfig:\n  theme: base\n  themeVariables:\n    primaryColor: "#112233"\n    lineColor: "#445566"\n---\n' +
        body,
    );
    expect(changed.endsWith(body)).toBe(true);
  });

  it('updates only palette values and theme while preserving comments and unrelated config', () => {
    const body = 'flowchart LR\n  A --> B\n';
    const source = `---
title: Checkout
config:
  theme: dark # preserve this note
  securityLevel: strict
  themeVariables:
    primaryColor: '#ABCDEF' # node fill
    fontFamily: IBM Plex Sans
  flowchart:
    curve: basis
author: Raj
---
${body}`;
    const changed = writeMermaidPalette(source, {
      primaryColor: '#010203',
      background: '#fefefe',
    });

    expect(changed).toContain('title: Checkout');
    expect(changed).toContain('theme: base # preserve this note');
    expect(changed).toContain("primaryColor: '#010203' # node fill");
    expect(changed).toContain('fontFamily: IBM Plex Sans');
    expect(changed).toContain('curve: basis');
    expect(changed).toContain('author: Raj');
    expect(changed).toContain('background: "#fefefe"');
    expect(changed.slice(changed.indexOf('---\n', 4) + 4)).toBe(body);
  });

  it('reads valid palette colors and ignores invalid values', () => {
    const source = `---
config:
  theme: base
  themeVariables:
    primaryColor: "#ABCDEF"
    lineColor: '#123456'
    background: no
---
flowchart LR
  A --> B`;

    expect(readMermaidPalette(source)).toEqual({
      primaryColor: '#abcdef',
      lineColor: '#123456',
    });
  });

  it('is idempotent and never duplicates managed keys', () => {
    const source = `---
config:
  theme: forest
  theme: dark
  themeVariables:
    lineColor: "#111111"
    lineColor: "#222222"
---
flowchart LR
  A --> B`;
    const once = writeMermaidPalette(source, {
      lineColor: '#334455',
      tertiaryColor: '#667788',
    });
    const twice = writeMermaidPalette(once, {
      lineColor: '#334455',
      tertiaryColor: '#667788',
    });

    expect(twice).toBe(once);
    expect(once.match(/^  theme:/gm)).toHaveLength(1);
    expect(once.match(/^    lineColor:/gm)).toHaveLength(1);
    expect(once.match(/^    tertiaryColor:/gm)).toHaveLength(1);
  });

  it('does not confuse unrelated top-level theme keys with Mermaid config', () => {
    const source = `---
theme: editorial
title: Diagram
---
flowchart LR
  A --> B`;
    const changed = writeMermaidPalette(source, { primaryColor: '#123456' });

    expect(changed).toContain('theme: editorial');
    expect(changed).toContain('config:\n  theme: base');
    expect(readMermaidTheme(changed)).toBe('base');
  });

  it('retains CRLF line endings when editing CRLF frontmatter', () => {
    const source = '---\r\nconfig:\r\n  theme: dark\r\n---\r\nflowchart LR\r\n  A --> B\r\n';
    const changed = writeMermaidPalette(source, { primaryColor: '#123456' });

    expect(changed).not.toMatch(/(?<!\r)\n/);
    expect(changed).toContain('    primaryColor: "#123456"\r\n');
  });

  it('expands empty flow mappings without producing duplicate keys', () => {
    const source = '---\nconfig: {}\n---\nflowchart LR\n  A --> B';
    const changed = writeMermaidPalette(source, { primaryColor: '#123456' });

    expect(changed).toContain(
      'config: \n  theme: base\n  themeVariables:\n    primaryColor: "#123456"',
    );
    expect(changed.match(/^config:/gm)).toHaveLength(1);
  });

  it('leaves non-empty flow mappings untouched instead of corrupting their YAML', () => {
    const source =
      '---\nconfig: { theme: dark, securityLevel: strict }\n---\nflowchart LR\n  A --> B';

    expect(writeMermaidPalette(source, { primaryColor: '#123456' })).toBe(source);
    expect(writeMermaidTheme(source, 'base')).toBe(source);
  });
});
