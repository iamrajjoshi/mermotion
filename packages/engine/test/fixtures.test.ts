import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { formatMotion, parseMotion, validateMermaid } from '../src/index.js';

const fixtureUrl = (kind: 'mermaid' | 'motion', name: string) =>
  new URL(`../../../fixtures/${kind}/${name}`, import.meta.url);

describe('checked-in compatibility fixtures', () => {
  it.each(['flowchart-basic.mmd', 'sequence-basic.mmd'])(
    'accepts pinned Mermaid syntax in %s',
    async (name) => {
      const source = await readFile(fixtureUrl('mermaid', name), 'utf8');
      await expect(validateMermaid(source)).resolves.toEqual([]);
    },
  );

  it.each(['flowchart-basic.motion', 'sequence-basic.motion'])(
    'parses and canonically formats %s',
    async (name) => {
      const source = await readFile(fixtureUrl('motion', name), 'utf8');
      expect(parseMotion(source).diagnostics).toEqual([]);
      expect(formatMotion(source)).toEqual({ formatted: source, diagnostics: [] });
    },
  );
});
