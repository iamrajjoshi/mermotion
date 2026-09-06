import { expect, test } from '@playwright/test';

test('boots when Array.at and structuredClone are not native', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Array.prototype, 'at');
    Reflect.deleteProperty(globalThis, 'structuredClone');
  });

  await page.goto('/');
  await expect(page.getByText('semantic targets')).toBeVisible();
  await expect(page.locator('.mermaid-stage svg')).toBeVisible();
  await expect(page.getByText('Source and motion agree')).toBeVisible();
  expect(
    await page.evaluate(() => ({
      arrayAt: typeof Array.prototype.at,
      structuredClone: typeof globalThis.structuredClone,
    })),
  ).toEqual({ arrayAt: 'function', structuredClone: 'function' });
});
