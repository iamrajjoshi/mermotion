import { expect, test, type Locator, type Page } from '@playwright/test';

const simpleDiagram = `flowchart LR
  A[Alpha] --> B[Beta]
`;

const traceMotion = `motionDiagram-v1
  defaults duration 400ms easing linear
  at 0ms trace A --> B over 1s easing linear
`;

async function waitForWorkbench(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Rendered Mermaid diagram' })).toBeVisible();
}

async function openAppearance(page: Page): Promise<Locator> {
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true });
  await trigger.click();
  const panel = page.getByTestId('appearance-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function editDiagram(page: Page, source: string): Promise<void> {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(source);
  await expect(page.locator('[data-mermotion-target="node:A"]').first()).toBeVisible();
}

async function editMotion(page: Page, source: string): Promise<void> {
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(source);
  await expect(page.getByText('Source and motion agree')).toBeVisible();
}

async function computedRootVariable(page: Page, property: string): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    property,
  );
}

async function computedSvgPaint(element: Locator, property: 'fill' | 'stroke'): Promise<string> {
  return element.evaluate((candidate, paintProperty) => {
    if (!(candidate instanceof SVGElement)) throw new Error('Expected an SVG element.');
    return getComputedStyle(candidate)[paintProperty];
  }, property);
}

async function computedStyleValue(element: Locator, property: string): Promise<string> {
  return element.evaluate(
    (candidate, styleProperty) =>
      getComputedStyle(candidate).getPropertyValue(styleProperty).trim(),
    property,
  );
}

function colorChannels(color: string): [number, number, number] {
  const hex = color.trim().match(/^#([\da-f]{6})$/i)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgb = color.trim().match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) throw new Error(`Unsupported CSS color: ${color}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [red, green, blue] = colorChannels(color).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test.beforeEach(async ({ page }) => {
  // Playwright creates a fresh browser context for every test, so IndexedDB starts empty.
  await waitForWorkbench(page);
});

test('applies an interface preset and custom color, then restores both after reload', async ({
  page,
}) => {
  const panel = await openAppearance(page);
  const paperPreset = panel.getByRole('button', { name: 'Paper', exact: true });

  await paperPreset.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => computedRootVariable(page, '--graphite')).toBe('#e7eaee');

  await panel.getByLabel('Interface Selection hex').fill('#13a4c5');
  await panel.getByLabel('Interface Selection hex').press('Enter');
  await expect.poll(() => computedRootVariable(page, '--motion')).toBe('#13a4c5');

  await expect(page.getByTestId('save-status')).toHaveText('Saving locally');
  await expect(page.getByTestId('save-status')).toHaveText('Saved locally');
  await page.reload();
  await expect(page.getByText('Preview current')).toBeVisible();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => computedRootVariable(page, '--graphite')).toBe('#e7eaee');
  await expect.poll(() => computedRootVariable(page, '--motion')).toBe('#13a4c5');

  const restoredPanel = await openAppearance(page);
  await expect(restoredPanel.getByRole('button', { name: 'Paper', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(restoredPanel.getByLabel('Interface Selection hex')).toHaveValue('#13a4c5');
});

test('writes a standard Mermaid palette and renders it on a simple flowchart', async ({ page }) => {
  await editDiagram(page, simpleDiagram);
  const panel = await openAppearance(page);

  await panel.getByLabel('Diagram Node fill hex').fill('#c0d4ff');
  await panel.getByLabel('Diagram Node fill hex').press('Enter');

  const diagramEditor = page.getByLabel('Edit diagram.mmd');
  await expect(diagramEditor).toHaveValue(/config:\n  theme: base\n  themeVariables:/);
  await expect(diagramEditor).toHaveValue(/primaryColor: "#c0d4ff"/);
  await expect
    .poll(async () => (await diagramEditor.inputValue()).endsWith(simpleDiagram))
    .toBe(true);

  const nodeShape = page
    .locator('[data-mermotion-target="node:A"][data-mermotion-effect-root]')
    .first()
    .locator('rect, polygon, circle, path')
    .first();
  await expect(nodeShape).toBeVisible();
  await expect.poll(() => computedSvgPaint(nodeShape, 'fill')).toBe('rgb(192, 212, 255)');
});

test('writes a declarative motion signal color and paints an active trace', async ({ page }) => {
  await editDiagram(page, simpleDiagram);
  await editMotion(page, traceMotion);
  const panel = await openAppearance(page);

  await panel.getByLabel('Motion Signal hex').fill('#12ab34');
  await panel.getByLabel('Motion Signal hex').press('Enter');

  await expect(page.getByLabel('Edit diagram.motion')).toHaveValue(
    /defaults duration 400ms easing linear color #12ab34/,
  );
  await expect(page.getByLabel('Edit diagram.motion')).toHaveValue(
    /at 0ms trace A --> B over 1s easing linear/,
  );

  await page.getByLabel('Seek animation').fill('500');
  const trace = page.locator('[data-mermotion-trace]').first();
  await expect(trace).toBeAttached();
  await expect.poll(() => computedSvgPaint(trace, 'stroke')).toBe('rgb(18, 171, 52)');
});

test('keeps brand and transport colors independent from a black motion signal', async ({
  page,
}) => {
  await editDiagram(page, simpleDiagram);
  await editMotion(page, traceMotion);

  const brand = page.locator('.wordmark').first();
  const headerPlay = page.locator('.header-play');
  const timelinePlay = page.locator('.timeline-transport .play-button').first();
  const colorsBefore = {
    brand: await computedStyleValue(brand, 'color'),
    headerPlayBackground: await computedStyleValue(headerPlay, 'background-color'),
    headerPlayInk: await computedStyleValue(headerPlay, 'color'),
    timelinePlayBackground: await computedStyleValue(timelinePlay, 'background-color'),
    timelinePlayInk: await computedStyleValue(timelinePlay, 'color'),
    transport: await computedRootVariable(page, '--transport'),
    transportInk: await computedRootVariable(page, '--transport-ink'),
  };

  const panel = await openAppearance(page);
  await panel.getByLabel('Motion Signal hex').fill('#000000');
  await panel.getByLabel('Motion Signal hex').press('Enter');

  await expect(page.getByLabel('Edit diagram.motion')).toHaveValue(/color #000000/);
  await expect.poll(() => computedRootVariable(page, '--signal')).toBe('#000000');
  await page.getByRole('button', { name: 'Close Appearance' }).last().click();

  await expect(brand).toBeVisible();
  await expect(headerPlay).toBeVisible();
  await expect(timelinePlay).toBeVisible();
  expect(await computedStyleValue(brand, 'color')).toBe(colorsBefore.brand);
  expect(await computedStyleValue(headerPlay, 'background-color')).toBe(
    colorsBefore.headerPlayBackground,
  );
  expect(await computedStyleValue(headerPlay, 'color')).toBe(colorsBefore.headerPlayInk);
  expect(await computedStyleValue(timelinePlay, 'background-color')).toBe(
    colorsBefore.timelinePlayBackground,
  );
  expect(await computedStyleValue(timelinePlay, 'color')).toBe(colorsBefore.timelinePlayInk);
  expect(await computedRootVariable(page, '--transport')).toBe(colorsBefore.transport);
  expect(await computedRootVariable(page, '--transport-ink')).toBe(colorsBefore.transportInk);
  expect(colorsBefore.transport).not.toBe('#000000');
});

test('uses Mermaid diagram ground for the preview canvas and preserves it in source', async ({
  page,
}) => {
  await editDiagram(page, simpleDiagram);
  const canvas = page.locator('.preview-canvas');
  const originalBackground = await computedStyleValue(canvas, 'background-color');
  const panel = await openAppearance(page);

  await panel.getByLabel('Diagram Diagram ground hex').fill('#decaf0');
  await panel.getByLabel('Diagram Diagram ground hex').press('Enter');

  const diagramEditor = page.getByLabel('Edit diagram.mmd');
  await expect(diagramEditor).toHaveValue(/background: "#decaf0"/);
  await expect
    .poll(async () => (await diagramEditor.inputValue()).endsWith(simpleDiagram))
    .toBe(true);
  await expect
    .poll(() => computedStyleValue(canvas, 'background-color'))
    .toBe('rgb(222, 202, 240)');
  expect(await computedStyleValue(canvas, 'background-color')).not.toBe(originalBackground);
});

test('uses the local canvas color as a visible frame around the Mermaid ground', async ({
  page,
}) => {
  const canvas = page.locator('.preview-canvas');
  const panel = await openAppearance(page);

  await panel.getByLabel('Interface Canvas frame hex').fill('#00ff00');
  await panel.getByLabel('Interface Canvas frame hex').press('Enter');

  await expect.poll(() => computedRootVariable(page, '--canvas')).toBe('#00ff00');
  await expect.poll(() => computedStyleValue(canvas, 'box-shadow')).toContain('rgb(0, 255, 0)');
});

test('traps keyboard focus inside Appearance and makes the workbench inert', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true });
  const panel = await openAppearance(page);
  const close = panel.getByRole('button', { name: 'Close Appearance' });
  const reset = panel.getByRole('button', { name: 'Reset all colors' });

  await expect(close).toBeFocused();
  expect(
    await page.locator('.app-header').evaluate((element) => element.hasAttribute('inert')),
  ).toBe(true);
  expect(
    await page.locator('.workbench').evaluate((element) => element.hasAttribute('inert')),
  ).toBe(true);

  await page.keyboard.press('Shift+Tab');
  await expect(reset).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.appearance-trigger')?.focus();
  });
  await expect(trigger).not.toBeFocused();
  expect(await panel.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(
    await page.locator('.app-header').evaluate((element) => element.hasAttribute('inert')),
  ).toBe(false);
  expect(
    await page.locator('.workbench').evaluate((element) => element.hasAttribute('inert')),
  ).toBe(false);
});

(['Graphite', 'Blueprint', 'Paper', 'Midnight'] as const).forEach((preset) => {
  test(`${preset} keeps header text at readable contrast`, async ({ page }) => {
    const panel = await openAppearance(page);
    const header = page.locator('.app-header');
    const headerButton = page.locator('.header-button.fit-control');
    const headerMeta = page.locator('.document-meta');
    const presetButton = panel.getByRole('button', { name: preset, exact: true });

    await presetButton.click();
    await expect(presetButton).toHaveAttribute('aria-pressed', 'true');

    const headerBackground = await computedStyleValue(header, 'background-color');
    const headerMuted = await computedRootVariable(page, '--header-muted');
    const buttonColor = await computedStyleValue(headerButton, 'color');
    const metaColor = await computedStyleValue(headerMeta, 'color');

    expect(
      contrastRatio(headerMuted, headerBackground),
      `${preset} --header-muted contrast`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(buttonColor, headerBackground),
      `${preset} header button contrast`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(metaColor, headerBackground),
      `${preset} header metadata contrast`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});

test('resets palette colors without changing the diagram body or motion cues', async ({ page }) => {
  const preservedDiagram = `flowchart LR
  A[Keep this node] --> B[Keep this route]
`;
  const preservedMotion = `motionDiagram-v1
  defaults duration 725ms easing linear
  marker request as "Request" shape dot

  at 125ms move request along A --> B over 725ms easing linear
`;

  await editDiagram(page, preservedDiagram);
  await editMotion(page, preservedMotion);
  const panel = await openAppearance(page);
  await panel.getByLabel('Diagram Connections hex').fill('#336699');
  await panel.getByLabel('Diagram Connections hex').press('Enter');
  await panel.getByLabel('Motion Signal hex').fill('#12ab34');
  await panel.getByLabel('Motion Signal hex').press('Enter');

  await panel.getByRole('button', { name: 'Reset all colors' }).click();

  const diagramAfterReset = await page.getByLabel('Edit diagram.mmd').inputValue();
  expect(diagramAfterReset).toContain('lineColor: "#687086"');
  expect(diagramAfterReset.endsWith(preservedDiagram)).toBe(true);

  const motionAfterReset = await page.getByLabel('Edit diagram.motion').inputValue();
  expect(motionAfterReset).toContain('defaults duration 725ms easing linear color #ff5470');
  expect(motionAfterReset).toContain('marker request as "Request" shape dot');
  expect(motionAfterReset).toContain(
    'at 125ms move request along A --> B over 725ms easing linear',
  );
});

test.describe('mobile appearance panel', () => {
  test.use({ viewport: { height: 640, width: 360 } });

  test('stays inside the viewport and returns focus to its trigger on Escape', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Appearance', exact: true });
    const panel = await openAppearance(page);
    await panel.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const viewport = page.viewportSize();
    const bounds = await panel.boundingBox();

    expect(viewport).not.toBeNull();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
