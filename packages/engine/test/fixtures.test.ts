import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { formatMotion, parseMotion, validateMermaid } from '../src/index.js';

const fixtureUrl = (kind: 'mermaid' | 'motion', name: string) =>
  new URL(`../../../fixtures/${kind}/${name}`, import.meta.url);

interface SemanticFixtureMatrix {
  schemaVersion: number;
  groups: Array<{
    name: string;
    motionFile: string;
    requiredTargetKeys: string[];
    variants: Array<{ name: string; file: string }>;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSemanticFixtureMatrix(value: unknown): value is SemanticFixtureMatrix {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    Array.isArray(value.groups) &&
    value.groups.every(
      (group) =>
        isRecord(group) &&
        typeof group.name === 'string' &&
        typeof group.motionFile === 'string' &&
        isStringArray(group.requiredTargetKeys) &&
        Array.isArray(group.variants) &&
        group.variants.every(
          (variant) =>
            isRecord(variant) &&
            typeof variant.name === 'string' &&
            typeof variant.file === 'string',
        ),
    )
  );
}

async function semanticFixtureMatrix(): Promise<SemanticFixtureMatrix> {
  const source = await readFile(fixtureUrl('mermaid', 'semantic-matrix.json'), 'utf8');
  const matrix: unknown = JSON.parse(source);
  if (!isSemanticFixtureMatrix(matrix)) throw new Error('Invalid semantic fixture matrix.');
  return matrix;
}

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

  it('keeps the semantic upgrade matrix structurally valid and collision-free', async () => {
    const matrix = await semanticFixtureMatrix();
    const groupNames = matrix.groups.map(({ name }) => name);

    expect(matrix.schemaVersion).toBe(1);
    expect(new Set(groupNames).size).toBe(groupNames.length);
    expect(matrix.groups.length).toBeGreaterThan(0);

    for (const group of matrix.groups) {
      const variantNames = group.variants.map(({ name }) => name);
      const variantFiles = group.variants.map(({ file }) => file);

      expect(group.requiredTargetKeys).toContain('diagram');
      expect(new Set(group.requiredTargetKeys).size).toBe(group.requiredTargetKeys.length);
      expect(new Set(variantNames).size).toBe(variantNames.length);
      expect(new Set(variantFiles).size).toBe(variantFiles.length);
      expect(group.variants.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('accepts every Mermaid source in the semantic upgrade matrix', async () => {
    const matrix = await semanticFixtureMatrix();
    const variants = await Promise.all(
      matrix.groups.flatMap((group) =>
        group.variants.map(async (variant) => ({
          group,
          variant,
          source: await readFile(fixtureUrl('mermaid', variant.file), 'utf8'),
        })),
      ),
    );

    /* oxlint-disable no-await-in-loop -- Mermaid parsing shares one initialized adapter realm. */
    for (const { group, source, variant } of variants) {
      await expect(validateMermaid(source), `${group.name}/${variant.name}`).resolves.toEqual([]);
    }
    /* oxlint-enable no-await-in-loop */
  });

  it('parses and canonically formats every matrix motion source', async () => {
    const matrix = await semanticFixtureMatrix();
    const sources = await Promise.all(
      matrix.groups.map(async (group) => ({
        group,
        source: await readFile(fixtureUrl('motion', group.motionFile), 'utf8'),
      })),
    );

    for (const { group, source } of sources) {
      expect(parseMotion(source).diagnostics, group.name).toEqual([]);
      expect(formatMotion(source), group.name).toEqual({ formatted: source, diagnostics: [] });
    }
  });
});
