import { expect, test, type Page } from '@playwright/test';

const firstTabDiagram = `flowchart LR
  first["First tab"] --> saved["Saved"]
`;

const secondTabDiagram = `flowchart LR
  second["Second tab"] --> local["Local draft"]
`;

const legacyDiagram = `flowchart LR
  legacy["Legacy"] --> kept["Kept"]
`;

const legacyMotion = `motionDiagram-v1
  at 0ms pulse legacy for 200ms
`;

async function waitForWorkbench(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Preview current')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Saved locally');
}

async function editDiagram(page: Page, source: string): Promise<void> {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(source);
}

async function readStoredWorkspace(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('mermotion');
      request.addEventListener('error', () => reject(request.error), { once: true });
      request.addEventListener('success', () => resolve(request.result), { once: true });
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction('documents', 'readonly');
        const request = transaction.objectStore('documents').get('current');
        request.addEventListener('error', () => reject(request.error), { once: true });
        request.addEventListener('success', () => resolve(request.result), { once: true });
      });
    } finally {
      database.close();
    }
  });
}

test('rejects a stale second-tab save without overwriting either local draft', async ({
  context,
  page,
}) => {
  await waitForWorkbench(page);
  const secondPage = await context.newPage();
  await waitForWorkbench(secondPage);

  await editDiagram(page, firstTabDiagram);
  await expect(page.getByTestId('save-status')).toHaveText('Saving locally');
  await expect(page.getByTestId('save-status')).toHaveText('Saved locally');

  await editDiagram(secondPage, secondTabDiagram);
  await expect(secondPage.getByTestId('save-status')).toHaveText('Reload to sync');
  await expect(secondPage.getByTestId('save-status')).toHaveAttribute(
    'title',
    /newer version was saved in another tab/i,
  );
  await expect(secondPage.getByLabel('Edit diagram.mmd')).toHaveValue(secondTabDiagram);
  await expect(page.getByLabel('Edit diagram.mmd')).toHaveValue(firstTabDiagram);

  expect(await readStoredWorkspace(page)).toMatchObject({
    diagramSource: firstTabDiagram,
    revision: 1,
    scenes: [{ diagramSource: firstTabDiagram }],
  });
});

test('times out a blocked upgrade without autosaving defaults and recovers after reload', async ({
  context,
  page: blocker,
}) => {
  await blocker.route('**/idb-blocker', async (route) => {
    await route.fulfill({
      body: '<!doctype html><title>IndexedDB blocker</title>',
      contentType: 'text/html',
    });
  });
  await blocker.goto('/idb-blocker');
  await blocker.evaluate(
    async ({ diagramSource, motionSource }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mermotion', 1);
        request.addEventListener(
          'upgradeneeded',
          () => request.result.createObjectStore('documents', { keyPath: 'id' }),
          { once: true },
        );
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
      window.addEventListener('pagehide', () => database.close(), { once: true });
    },
    { diagramSource: legacyDiagram, motionSource: legacyMotion },
  );

  const app = await context.newPage();
  await app.goto('/');
  await expect(app.getByText('Preview current')).toBeVisible();
  await expect(app.getByTestId('save-status')).toHaveText('Save unavailable');
  await expect(app.getByTestId('save-status')).toHaveAttribute('title', /blocked by another/i);

  await editDiagram(app, secondTabDiagram);
  await expect(app.getByLabel('Edit diagram.mmd')).toHaveValue(secondTabDiagram);
  await blocker.close();
  await app.waitForTimeout(750);

  expect(await readStoredWorkspace(app)).toMatchObject({
    diagramSource: legacyDiagram,
    motionSource: legacyMotion,
  });

  await app.reload();
  await expect(app.getByText('Preview current')).toBeVisible();
  await expect(app.getByTestId('save-status')).toHaveText('Saved locally');
  await expect(app.getByRole('tab', { name: /Checkout$/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await app.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await expect(app.getByLabel('Edit diagram.mmd')).toHaveValue(legacyDiagram);
});

test('preserves a valid v2 scene named Scene 1', async ({ page }) => {
  await page.route('**/idb-seed', async (route) => {
    await route.fulfill({
      body: '<!doctype html><title>IndexedDB seed</title>',
      contentType: 'text/html',
    });
  });
  await page.goto('/idb-seed');
  await page.evaluate(
    async ({ diagramSource, motionSource }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mermotion', 2);
        request.addEventListener(
          'upgradeneeded',
          () => request.result.createObjectStore('documents', { keyPath: 'id' }),
          { once: true },
        );
        request.addEventListener('error', () => reject(request.error), { once: true });
        request.addEventListener('success', () => resolve(request.result), { once: true });
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('documents', 'readwrite');
        transaction.objectStore('documents').put({
          id: 'current',
          format: 'mermotion-workspace-v2',
          activeSceneId: 'scene-1',
          diagramSource,
          motionSource,
          revision: 8,
          scenes: [{ id: 'scene-1', name: 'Scene 1', diagramSource, motionSource }],
          themePreference: 'dark',
          updatedAt: 1,
        });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
        transaction.addEventListener('error', () => reject(transaction.error), { once: true });
        transaction.addEventListener('complete', () => resolve(), { once: true });
      });
      database.close();
    },
    { diagramSource: firstTabDiagram, motionSource: legacyMotion },
  );

  await waitForWorkbench(page);
  await expect(page.getByRole('tab', { name: /Scene 1$/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: /Checkout$/ })).toHaveCount(0);
});
