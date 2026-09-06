import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

type FixtureStatus = 'provisional' | 'stable';

interface RenderFixture {
  family: string;
  syntax: string;
  file: string;
  status: FixtureStatus;
}

interface RenderCompatibilityMatrix {
  schemaVersion: number;
  fixtures: RenderFixture[];
}

const expectedFamilies = [
  'architecture',
  'block',
  'c4',
  'class',
  'cynefin',
  'entity relationship',
  'event modeling',
  'flowchart',
  'gantt',
  'git graph',
  'ishikawa',
  'kanban',
  'mindmap',
  'packet',
  'pie',
  'quadrant',
  'radar',
  'railroad',
  'requirement',
  'sankey',
  'sequence',
  'state',
  'swimlane',
  'timeline',
  'tree view',
  'treemap',
  'user journey',
  'venn',
  'wardley',
  'xy chart',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFixtureStatus(value: unknown): value is FixtureStatus {
  return value === 'provisional' || value === 'stable';
}

function isRenderCompatibilityMatrix(value: unknown): value is RenderCompatibilityMatrix {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    Array.isArray(value.fixtures) &&
    value.fixtures.length > 0 &&
    value.fixtures.every(
      (fixture) =>
        isRecord(fixture) &&
        typeof fixture.family === 'string' &&
        typeof fixture.syntax === 'string' &&
        typeof fixture.file === 'string' &&
        isFixtureStatus(fixture.status),
    )
  );
}

const mermaidFixtureUrl = (name: string) => new URL(`../fixtures/mermaid/${name}`, import.meta.url);

async function fixtureMatrix(): Promise<RenderCompatibilityMatrix> {
  const matrix: unknown = JSON.parse(
    await readFile(mermaidFixtureUrl('render-compatibility.json'), 'utf8'),
  );
  if (!isRenderCompatibilityMatrix(matrix)) {
    throw new Error('Invalid Mermaid render compatibility matrix.');
  }
  return matrix;
}

async function visibleRenderId(page: Page): Promise<string | null> {
  return page.locator('.preview-canvas svg').first().getAttribute('id');
}

async function replaceDiagram(page: Page, source: string, fixture: RenderFixture): Promise<void> {
  const previousId = await visibleRenderId(page);
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(source);
  await expect(page.getByText('Rendering', { exact: true })).toBeVisible();

  await expect
    .poll(
      async () => {
        const renderId = await visibleRenderId(page);
        return (
          (renderId !== null && renderId !== previousId) ||
          (await page.getByText('Render failed').isVisible())
        );
      },
      { message: `${fixture.family}/${fixture.syntax} should render` },
    )
    .toBe(true);

  const diagnostics = await page.locator('.diagnostic-line').allTextContents();
  expect.soft(diagnostics, `${fixture.family}/${fixture.syntax} render diagnostics`).toEqual([]);
  if (await page.getByText('Render failed').isVisible()) return;

  await expect
    .soft(
      page
        .locator('.preview-canvas svg[data-mermotion-target="diagram"][data-mermotion-effect-root]')
        .first(),
      `${fixture.family}/${fixture.syntax} should expose the whole-diagram target`,
    )
    .toBeAttached();
  await expect.soft(page.getByText('Preview current')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Preview current')).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill('motionDiagram-v1\n');
  await expect(page.getByText('Source and motion agree')).toBeVisible();
});

test('renders every Mermaid family in the compatibility matrix', async ({ page }) => {
  test.setTimeout(180_000);
  const matrix = await fixtureMatrix();
  const families = [...new Set(matrix.fixtures.map((fixture) => fixture.family))].sort();
  const uniqueSyntaxes = new Set(matrix.fixtures.map((fixture) => fixture.syntax));
  const uniqueFiles = new Set(matrix.fixtures.map((fixture) => fixture.file));

  expect(families, 'The matrix must retain every built-in user-facing Mermaid family.').toEqual(
    [...expectedFamilies].sort(),
  );
  expect(matrix.fixtures, 'The 30 families expose 33 distinct built-in syntaxes.').toHaveLength(33);
  expect(uniqueSyntaxes.size, 'Every compatibility entry needs a distinct syntax identifier.').toBe(
    matrix.fixtures.length,
  );
  expect(uniqueFiles.size, 'Every compatibility entry needs a distinct fixture file.').toBe(
    matrix.fixtures.length,
  );

  /* oxlint-disable no-await-in-loop -- one editor instance must finish each render before receiving the next source. */
  for (const fixture of matrix.fixtures) {
    const source = await readFile(mermaidFixtureUrl(fixture.file), 'utf8');
    const [declaration] = source.trimStart().split(/\s/, 1);
    expect(declaration, `${fixture.file} should use its declared syntax`).toBe(fixture.syntax);
    await replaceDiagram(page, source, fixture);
  }
  /* oxlint-enable no-await-in-loop */
});
