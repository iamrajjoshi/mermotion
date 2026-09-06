import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

interface SemanticFixtureGroup {
  name: string;
  motionFile: string;
  requiredTargetKeys: string[];
  variants: Array<{ name: string; file: string }>;
}

interface SemanticFixtureMatrix {
  schemaVersion: number;
  groups: SemanticFixtureGroup[];
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

const mermaidFixtureUrl = (name: string) => new URL(`../fixtures/mermaid/${name}`, import.meta.url);
const motionFixtureUrl = (name: string) => new URL(`../fixtures/motion/${name}`, import.meta.url);

async function fixtureMatrix(): Promise<SemanticFixtureMatrix> {
  const matrix: unknown = JSON.parse(
    await readFile(mermaidFixtureUrl('semantic-matrix.json'), 'utf8'),
  );
  if (!isSemanticFixtureMatrix(matrix)) throw new Error('Invalid semantic fixture matrix.');
  return matrix;
}

async function visibleRenderId(page: Page): Promise<string | null> {
  return page.locator('.preview-canvas svg').first().getAttribute('id');
}

async function replaceDiagram(page: Page, source: string): Promise<void> {
  const previousId = await visibleRenderId(page);
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(source);
  await expect.poll(() => visibleRenderId(page)).not.toBe(previousId);
  await expect(page.getByText('Preview current')).toBeVisible();
}

async function replaceMotion(page: Page, source: string): Promise<void> {
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(source);
  await expect(page.getByText('Source and motion agree')).toBeVisible();
  await expect(page.locator('.diagnostic-line')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Preview current')).toBeVisible();
});

test('keeps semantic bindings stable across the Mermaid upgrade fixture matrix', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const matrix = await fixtureMatrix();
  expect(matrix.schemaVersion).toBe(1);

  /* oxlint-disable no-await-in-loop -- one editor instance must finish each render before receiving the next source. */
  for (const group of matrix.groups) {
    const motionSource = await readFile(motionFixtureUrl(group.motionFile), 'utf8');

    for (const variant of group.variants) {
      const mermaidSource = await readFile(mermaidFixtureUrl(variant.file), 'utf8');

      await replaceMotion(page, 'motionDiagram-v1\n');
      await replaceDiagram(page, mermaidSource);
      await replaceMotion(page, motionSource);

      const keys = await page
        .locator('[data-mermotion-effect-root][data-mermotion-target]')
        .evaluateAll((elements) => [
          ...new Set(
            elements
              .map((element) => element.getAttribute('data-mermotion-target'))
              .filter((key): key is string => key !== null),
          ),
        ]);
      expect(
        keys.sort((left, right) => left.localeCompare(right)),
        `${group.name}/${variant.name}`,
      ).toEqual([...group.requiredTargetKeys].sort((left, right) => left.localeCompare(right)));
    }
  }
  /* oxlint-enable no-await-in-loop */
});

test('does not rebind a renamed Mermaid ID by its unchanged label', async ({ page }) => {
  await replaceMotion(page, 'motionDiagram-v1\n');
  await replaceDiagram(page, 'flowchart LR\n  source[Client] --> api[API]\n');
  await replaceMotion(page, 'motionDiagram-v1\n  at 0ms highlight source\n');

  await replaceDiagram(page, 'flowchart LR\n  origin[Client] --> api[API]\n');

  await expect(page.getByText("Target 'source' was not found.")).toBeVisible();
  await expect(page.locator('[data-mermotion-target="node:origin"]').first()).toBeVisible();
  await expect(page.locator('.diagnostic-line')).toHaveCount(1);
});
