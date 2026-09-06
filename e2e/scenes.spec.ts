import { readFile } from 'node:fs/promises';

import { expect, test, type Download, type Locator, type Page } from '@playwright/test';

const originalDiagram = `flowchart LR
  originalA["Original"] --> originalB["Stored"]
`;

const originalMotion = `motionDiagram-v1
  defaults duration 300ms easing linear
  at 0ms highlight originalA for 300ms
`;

const secondDiagram = `flowchart LR
  secondA["Second"] --> secondB["Independent"]
`;

const secondMotion = `motionDiagram-v1
  defaults duration 400ms easing ease-out
  at 100ms pulse secondB for 400ms
`;

function scenes(page: Page): Locator {
  return page.locator('.scene-rail');
}

function sceneTabs(page: Page): Locator {
  return scenes(page).locator('.scene-tabs').getByRole('tab');
}

function sceneTab(page: Page, name: string): Locator {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return scenes(page)
    .locator('.scene-tabs')
    .getByRole('tab', { name: new RegExp(`${escapedName}$`) });
}

async function waitForWorkbench(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Preview current')).toBeVisible();
  await expect(scenes(page)).toBeVisible();
}

async function setSources(page: Page, diagram: string, motion: string): Promise<void> {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(diagram);
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(motion);
  await expect(page.getByText('Source and motion agree')).toBeVisible();
}

async function expectSources(page: Page, diagram: string, motion: string): Promise<void> {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await expect(page.getByLabel('Edit diagram.mmd')).toHaveValue(diagram);
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await expect(page.getByLabel('Edit diagram.motion')).toHaveValue(motion);
}

async function renameActiveScene(page: Page, name: string): Promise<void> {
  await scenes(page).getByRole('button', { name: 'Rename scene' }).click();
  const input = scenes(page).getByLabel('Scene name');
  await input.fill(name);
  await input.press('Enter');
  await expect(sceneTab(page, name)).toHaveAttribute('aria-selected', 'true');
}

async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error('Playwright did not retain the downloaded workspace.');
  return readFile(path, 'utf8');
}

async function writeLegacyWorkspace(page: Page): Promise<void> {
  await page.evaluate(
    async ({ diagramSource, motionSource }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mermotion');
        request.addEventListener('error', () => reject(request.error), { once: true });
        request.addEventListener('success', () => resolve(request.result), { once: true });
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('documents', 'readwrite');
        transaction.objectStore('documents').put({
          id: 'current',
          diagramSource,
          motionSource,
          themePreference: 'dark',
          updatedAt: 1,
        });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
        transaction.addEventListener('error', () => reject(transaction.error), { once: true });
        transaction.addEventListener('complete', () => resolve(), { once: true });
      });
      database.close();
    },
    { diagramSource: originalDiagram, motionSource: originalMotion },
  );
}

test.beforeEach(async ({ page }) => {
  // Playwright gives each test a fresh browser context and therefore a fresh IndexedDB.
  await waitForWorkbench(page);
});

test('keeps scene sources independent through CRUD, ordering, and presentation', async ({
  page,
}) => {
  await expect(sceneTabs(page)).toHaveCount(1);
  await expect(sceneTab(page, 'Checkout')).toHaveAttribute('aria-selected', 'true');
  await setSources(page, originalDiagram, originalMotion);

  await scenes(page).getByRole('button', { name: 'Scene', exact: true }).click();
  await expect(sceneTabs(page)).toHaveCount(2);
  await expect(sceneTab(page, 'Scene 1')).toHaveAttribute('aria-selected', 'true');
  await setSources(page, secondDiagram, secondMotion);
  await renameActiveScene(page, 'Handoff');

  await scenes(page).getByRole('button', { name: 'Duplicate scene' }).click();
  await expect(sceneTabs(page)).toHaveCount(3);
  await expect(sceneTab(page, 'Handoff copy')).toHaveAttribute('aria-selected', 'true');
  await expectSources(page, secondDiagram, secondMotion);

  await scenes(page).getByRole('button', { name: 'Move scene earlier' }).click();
  await expect(scenes(page).locator('.scene-name')).toHaveText([
    'Checkout',
    'Handoff copy',
    'Handoff',
  ]);

  await sceneTab(page, 'Checkout').click();
  await expectSources(page, originalDiagram, originalMotion);
  await sceneTab(page, 'Handoff').click();
  await expectSources(page, secondDiagram, secondMotion);

  await sceneTab(page, 'Handoff copy').click();
  await scenes(page).getByRole('button', { name: 'Delete scene' }).click();
  const confirmation = scenes(page).getByRole('group', { name: 'Confirm scene deletion' });
  await expect(confirmation).toContainText('Delete Handoff copy?');
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(sceneTabs(page)).toHaveCount(2);
  await expect(scenes(page).locator('.scene-name')).toHaveText(['Checkout', 'Handoff']);
  await expect(sceneTab(page, 'Handoff')).toHaveAttribute('aria-selected', 'true');

  await scenes(page).getByRole('button', { name: 'Present' }).click();
  await expect(page.locator('.presentation-identity strong')).toHaveText('Handoff');
  await expect(page.locator('.presentation-stage .mermaid-stage svg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next scene' })).toBeDisabled();

  await page.getByRole('button', { name: 'Previous scene' }).click();
  await expect(page.locator('.presentation-identity strong')).toHaveText('Checkout');
  await expect(page.locator('[data-mermotion-target="node:originalA"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next scene' }).click();
  await expect(page.locator('.presentation-identity strong')).toHaveText('Handoff');
  await expect(page.locator('[data-mermotion-target="node:secondB"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Play animation' }).click();
  await expect(page.getByRole('button', { name: 'Pause animation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.presentation-shell')).toBeHidden();
  await expect(sceneTab(page, 'Handoff')).toHaveAttribute('aria-selected', 'true');
  await expectSources(page, secondDiagram, secondMotion);
});

test('migrates a legacy source pair and persists the resulting scene workspace', async ({
  page,
}) => {
  await expect(page.getByTestId('save-status')).toHaveText('Saved locally');
  await writeLegacyWorkspace(page);
  await page.reload();
  await expect(page.getByText('Preview current')).toBeVisible();

  await expect(sceneTabs(page)).toHaveCount(1);
  await expect(sceneTab(page, 'Checkout')).toHaveAttribute('aria-selected', 'true');
  await expectSources(page, originalDiagram, originalMotion);

  await scenes(page).getByRole('button', { name: 'Scene', exact: true }).click();
  await renameActiveScene(page, 'Persisted scene');
  await setSources(page, secondDiagram, secondMotion);
  await expect(page.getByTestId('save-status')).toHaveText('Saving locally');
  await expect(page.getByTestId('save-status')).toHaveText('Saved locally');

  await page.reload();
  await expect(page.getByText('Preview current')).toBeVisible();
  await expect(sceneTabs(page)).toHaveCount(2);
  await expect(scenes(page).locator('.scene-name')).toHaveText(['Checkout', 'Persisted scene']);
  await expect(sceneTab(page, 'Persisted scene')).toHaveAttribute('aria-selected', 'true');
  await expectSources(page, secondDiagram, secondMotion);

  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mermotion');
      request.addEventListener('error', () => reject(request.error), { once: true });
      request.addEventListener('success', () => resolve(request.result), { once: true });
    });
    const record = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction('documents', 'readonly');
      const request = transaction.objectStore('documents').get('current');
      request.addEventListener('error', () => reject(request.error), { once: true });
      request.addEventListener('success', () => resolve(request.result), { once: true });
    });
    database.close();
    return record;
  });

  expect(stored).toMatchObject({
    format: 'mermotion-workspace-v2',
    diagramSource: secondDiagram,
    motionSource: secondMotion,
    scenes: [
      {
        name: 'Checkout',
        diagramSource: originalDiagram,
        motionSource: originalMotion,
      },
      {
        name: 'Persisted scene',
        diagramSource: secondDiagram,
        motionSource: secondMotion,
      },
    ],
  });
  if (
    typeof stored !== 'object' ||
    stored === null ||
    !('activeSceneId' in stored) ||
    !('scenes' in stored) ||
    !Array.isArray(stored.scenes) ||
    typeof stored.scenes[1] !== 'object' ||
    stored.scenes[1] === null ||
    !('id' in stored.scenes[1])
  ) {
    throw new Error('Expected a stored workspace with two scenes.');
  }
  expect(stored.activeSceneId).toBe(stored.scenes[1].id);
});

test('downloads every scene while retaining an active top-level source pair', async ({ page }) => {
  await setSources(page, originalDiagram, originalMotion);
  await scenes(page).getByRole('button', { name: 'Scene', exact: true }).click();
  await renameActiveScene(page, 'Download scene');
  await setSources(page, secondDiagram, secondMotion);

  await page.getByRole('button', { name: 'Open export options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Bundle' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('workspace.mermotion.json');

  const bundle: unknown = JSON.parse(await readDownload(download));
  expect(bundle).toEqual({
    format: 'mermotion-workspace-v2',
    activeSceneId: expect.any(String),
    files: {
      'diagram.mmd': secondDiagram,
      'diagram.motion': secondMotion,
    },
    scenes: [
      {
        id: expect.any(String),
        name: 'Checkout',
        files: {
          'diagram.mmd': originalDiagram,
          'diagram.motion': originalMotion,
        },
      },
      {
        id: expect.any(String),
        name: 'Download scene',
        files: {
          'diagram.mmd': secondDiagram,
          'diagram.motion': secondMotion,
        },
      },
    ],
  });
  if (
    typeof bundle !== 'object' ||
    bundle === null ||
    !('activeSceneId' in bundle) ||
    !('scenes' in bundle) ||
    !Array.isArray(bundle.scenes) ||
    typeof bundle.scenes[1] !== 'object' ||
    bundle.scenes[1] === null ||
    !('id' in bundle.scenes[1])
  ) {
    throw new Error('Expected a downloaded workspace with two scenes.');
  }
  expect(bundle.activeSceneId).toBe(bundle.scenes[1].id);
});
