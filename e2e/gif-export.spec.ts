import { readFile } from 'node:fs/promises';

import { expect, test, type Download, type Page } from '@playwright/test';

const shortDiagram = `flowchart LR
  A[Alpha] --> B[Beta]
`;

const shortMotion = `motionDiagram-v1
  defaults duration 100ms easing linear
  at 0ms highlight A
`;

const wideDiagram = `flowchart LR
  A --> B --> C --> D --> E --> F --> G --> H --> I --> J --> K --> L --> M --> N --> O --> P
`;

interface ParsedGif {
  delays: number[];
  frames: number;
  height: number;
  repeat?: number;
  trailer: boolean;
  width: number;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function skipSubBlocks(bytes: Uint8Array, initialOffset: number): number {
  let offset = initialOffset;
  while (offset < bytes.length) {
    const size = bytes[offset] ?? 0;
    offset += 1;
    if (size === 0) return offset;
    offset += size;
  }
  throw new Error('GIF sub-block did not terminate.');
}

function parseGif(bytes: Uint8Array): ParsedGif {
  expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
  const width = readUint16(bytes, 6);
  const height = readUint16(bytes, 8);
  const packed = bytes[10] ?? 0;
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1);

  const delays: number[] = [];
  let frames = 0;
  let repeat: number | undefined;
  let trailer = false;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      trailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = bytes[offset++];
      const blockSize = bytes[offset++] ?? 0;
      if (label === 0xf9) {
        expect(blockSize).toBe(4);
        delays.push(readUint16(bytes, offset + 1));
        offset += blockSize + 1;
      } else if (label === 0xff) {
        const identifier = new TextDecoder().decode(bytes.slice(offset, offset + blockSize));
        offset += blockSize;
        if (identifier === 'NETSCAPE2.0' && bytes[offset] === 3 && bytes[offset + 1] === 1) {
          repeat = readUint16(bytes, offset + 2);
        }
        offset = skipSubBlocks(bytes, offset);
      } else {
        offset += blockSize;
        offset = skipSubBlocks(bytes, offset);
      }
      continue;
    }
    if (marker !== 0x2c) throw new Error(`Unexpected GIF block 0x${marker?.toString(16)}`);

    frames += 1;
    offset += 8;
    const imagePacked = bytes[offset++] ?? 0;
    if ((imagePacked & 0x80) !== 0) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    offset += 1;
    offset = skipSubBlocks(bytes, offset);
  }

  return { delays, frames, height, ...(repeat === undefined ? {} : { repeat }), trailer, width };
}

async function readDownload(download: Download): Promise<Uint8Array> {
  const file = await download.path();
  if (!file) throw new Error('Playwright did not retain the GIF download.');
  return readFile(file);
}

async function useShortFixture(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('semantic targets')).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(shortDiagram);
  await expect(page.locator('[data-mermotion-target="node:B"]').first()).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(shortMotion);
  await expect(page.locator('.cue-block')).toHaveCount(1);
  await expect(page.getByText('Source and motion agree')).toBeVisible();
}

test('downloads a locally rendered GIF with the chosen loop and hold metadata', async ({
  page,
}) => {
  await useShortFixture(page);
  const exportTrigger = page.getByRole('button', { name: 'Open export options' });
  await exportTrigger.click();

  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await page.getByRole('button', { name: 'Use 640px · 10fps' }).click();
  await expect(page.getByLabel('GIF width')).toHaveValue('640');
  await expect(page.getByLabel('GIF frame rate')).toHaveValue('10');
  await expect(page.getByRole('button', { name: 'Export GIF' })).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('checkout.gif');
  const parsed = parseGif(await readDownload(download));

  expect(parsed).toEqual({
    delays: [10, 50],
    frames: 2,
    height: expect.any(Number),
    repeat: 0,
    trailer: true,
    width: 640,
  });
  expect(parsed.height).toBeGreaterThan(0);
  await expect(page.getByText(/Downloaded checkout\.gif.*ready to upload to Notion/)).toBeVisible();
});

test('expands every GIF frame to preserve moving marker labels outside the Mermaid viewBox', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(wideDiagram);
  await expect(page.locator('[data-mermotion-target="node:B"]').first()).toBeVisible();

  const baseViewBox = await page.locator('.mermaid-stage svg').getAttribute('viewBox');
  if (!baseViewBox) throw new Error('Rendered Mermaid SVG has no viewBox.');
  const [, , baseWidth = 0, baseHeight = 0] = baseViewBox.split(/\s+/).map(Number);
  const unexpandedHeight = Math.round((640 * baseHeight) / baseWidth);
  expect(baseWidth).toBeGreaterThan(640);

  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  marker request as "Scale dependent callout"
  move request along A --> B over 100ms
`);
  await expect(page.getByText('Source and motion agree')).toBeVisible();
  await page.getByRole('button', { name: 'Open export options' }).click();
  await page.getByRole('button', { name: 'Use 640px · 10fps' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const parsed = parseGif(await readDownload(await downloadPromise));

  expect(parsed.width).toBe(640);
  expect(parsed.height).toBeGreaterThan(unexpandedHeight + 20);
});

test('includes pulse-shadow paint when settling a downscaled GIF', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(wideDiagram);
  await expect(page.locator('[data-mermotion-target="node:A"]').first()).toBeVisible();

  const baseViewBox = await page.locator('.mermaid-stage svg').getAttribute('viewBox');
  if (!baseViewBox) throw new Error('Rendered Mermaid SVG has no viewBox.');
  const [, , baseWidth = 0, baseHeight = 0] = baseViewBox.split(/\s+/).map(Number);
  const unexpandedHeight = Math.round((640 * baseHeight) / baseWidth);
  expect(baseWidth).toBeGreaterThan(640);

  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill('motionDiagram-v1\n  pulse A for 200ms\n');
  await expect(page.getByText('Source and motion agree')).toBeVisible();
  await page.getByRole('button', { name: 'Open export options' }).click();
  await page.getByRole('button', { name: 'Use 640px · 10fps' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GIF' }).click();
  const parsed = parseGif(await readDownload(await downloadPromise));

  expect(parsed.width).toBe(640);
  expect(parsed.height).toBeGreaterThan(unexpandedHeight + 40);
});

test('makes playback count explicit and keeps one-shot exports free of a loop hold', async ({
  page,
}) => {
  await useShortFixture(page);
  const exportTrigger = page.getByRole('button', { name: 'Open export options' });
  await exportTrigger.click();
  await expect(page.getByRole('button', { name: 'Close Export' })).toBeFocused();

  await page.getByRole('radio', { name: 'Play once' }).check();
  await expect(page.getByRole('checkbox', { name: 'Pause on final frame' })).toBeDisabled();
  await expect(page.getByLabel('Final frame pause')).toBeDisabled();
  await page.getByRole('radio', { name: 'Set count' }).check();
  const totalPlays = page.getByLabel('Total plays');
  await expect(totalPlays).toHaveValue('3');
  await totalPlays.fill('1');
  await expect(page.getByRole('button', { name: 'Export GIF' })).toBeDisabled();
  await totalPlays.fill('3');
  await expect(page.getByRole('button', { name: 'Export GIF' })).toBeEnabled();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeHidden();
  await expect(exportTrigger).toBeFocused();
});

test('keeps GIF export reachable and contained on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ height: 640, width: 360 });
  await page.goto('/');
  await expect(page.getByText('semantic targets')).toBeVisible();
  const exportTrigger = page.getByRole('button', { name: 'Open export options' });
  await expect(exportTrigger).toBeVisible();
  await exportTrigger.click();

  const dialog = page.getByRole('dialog', { name: 'Export' });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect(bounds?.width).toBeLessThanOrEqual(360.1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await expect(page.getByRole('button', { name: 'Export GIF' })).toBeEnabled();
});

test('explains how to reduce an export that exceeds the frame budget', async ({ page }) => {
  await useShortFixture(page);
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  at 0ms highlight A for 31s easing linear
`);
  await expect(page.getByText('Source and motion agree')).toBeVisible();
  await page.getByRole('button', { name: 'Open export options' }).click();

  await expect(page.getByText(/exceeds 600 frames/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export GIF' })).toBeDisabled();
  await page.getByLabel('GIF frame rate').selectOption('10');
  await expect(page.getByText(/exceeds 600 frames/)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export GIF' })).toBeEnabled();
});
