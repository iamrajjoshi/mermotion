import { expect, test } from '@playwright/test';

const diagramWithRemoteImage = `flowchart LR
  A[Producer] --> B[Consumer]
  Remote@{ img: "/probe.svg", label: "Reference image", h: 60 }
`;

const markerMotion = `motionDiagram-v1
  marker request as "Request"
  at 0ms move request along A --> B over 1s easing linear
`;

const shortHighlightMotion = `motionDiagram-v1
  defaults duration 100ms easing linear
  at 0ms highlight A
`;

const diagramWithNetworkStyles = `---
config:
  themeCSS: ".node rect { fill: url('/probe.svg') !important; }"
---
flowchart LR
  A[Producer] --> B[Consumer]
  click A href "/probe.svg"
`;

const diagramWithHtmlImage = `flowchart LR
  A["<img src='/probe.svg' alt='Remote'>"] --> B[Consumer]
`;

const diagramWithHtmlForm = `flowchart LR
  A["<form><button type='submit'>Reload</button></form>"] --> B[Consumer]
`;

test('renders remote-image syntax without making an outbound preview request', async ({ page }) => {
  let endpointHits = 0;
  const probeRequests: string[] = [];
  await page.route('**/probe.svg', async (route) => {
    endpointHits += 1;
    await route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" />',
      contentType: 'image/svg+xml',
    });
  });
  page.on('request', (request) => {
    if (request.url().endsWith('/probe.svg')) probeRequests.push(request.url());
  });

  await page.goto('/');
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(diagramWithRemoteImage);

  await expect(page.getByText('semantic targets')).toBeVisible();
  await expect(page.locator('.mermaid-stage svg')).toBeVisible();
  await expect(page.locator('[data-mermotion-target="node:A"]').first()).toBeVisible();
  await expect(page.locator('[data-mermotion-target="node:B"]').first()).toBeVisible();
  await expect(page.locator('[data-mermotion-target="node:Remote"]').first()).toBeVisible();
  expect(endpointHits).toBe(0);
  expect(probeRequests).toEqual([]);

  const renderer = page.locator('.preview-render-realm');
  await expect(renderer).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(renderer).not.toHaveAttribute('sandbox', /allow-same-origin/);
  await expect(page.locator('.mermaid-stage image')).toHaveAttribute(
    'href',
    /^data:image\/gif;base64,/,
  );

  await page.locator('[data-mermotion-target="node:A"]').first().click();
  await expect(page.getByLabel(/Selected target Producer/)).toBeVisible();
  const zoomOutput = page.locator('output[aria-label="Preview zoom"]');
  const initialZoom = await zoomOutput.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoomOutput).not.toHaveText(initialZoom ?? '');

  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(markerMotion);
  await expect(page.locator('.cue-block')).toHaveCount(1);
  await page.getByLabel('Seek animation').fill('500');
  await expect(page.locator('[data-mermotion-marker-decoration="request"]')).toBeVisible();

  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await expect(page.getByLabel('Edit diagram.mmd')).toHaveValue(diagramWithRemoteImage);
  expect(endpointHits).toBe(0);
});

test('keeps the scripted renderer in an opaque origin', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.mermaid-stage svg')).toBeVisible();

  const rendererFrame = page.frames().find((frame) => frame.url() === 'about:srcdoc');
  expect(rendererFrame).toBeDefined();
  const parentAccess = await rendererFrame?.evaluate(() => {
    try {
      void window.parent.document;
      return 'readable';
    } catch (error) {
      return error instanceof DOMException ? error.name : 'blocked';
    }
  });

  expect(parentAccess).toBe('SecurityError');
});

test('replaces a timed-out renderer and accepts a later render', async ({ page }) => {
  let endpointHits = 0;
  await page.route('**/probe.svg', async (route) => {
    endpointHits += 1;
    await route.fulfill({ body: 'not reached', contentType: 'text/plain' });
  });
  await page.addInitScript(() => {
    const accelerateRenderTimeoutsKey = '__mermotionAccelerateRenderTimeouts';
    const stalledRequestCountKey = '__mermotionStalledRequestCount';
    /* oxlint-disable-next-line unicorn/consistent-function-scoping -- This guard executes inside the injected browser script. */
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null;

    if (window === window.top) {
      Reflect.set(window, accelerateRenderTimeoutsKey, false);
      Reflect.set(window, stalledRequestCountKey, 0);
      const nativeSetTimeout = window.setTimeout.bind(window);
      const accelerateTimeout: typeof window.setTimeout = (handler, timeout, ...arguments_) =>
        nativeSetTimeout(
          handler,
          timeout === 30_000 && Reflect.get(window, accelerateRenderTimeoutsKey) === true
            ? 40
            : timeout,
          ...arguments_,
        );
      window.setTimeout = accelerateTimeout;
      window.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (!isRecord(event.data) || event.data.kind !== 'test-preview-render-stalled') return;
        const current = Reflect.get(window, stalledRequestCountKey);
        Reflect.set(window, stalledRequestCountKey, typeof current === 'number' ? current + 1 : 1);
      });
      return;
    }

    window.addEventListener(
      'message',
      (event: MessageEvent<unknown>) => {
        const message = event.data;
        const options = isRecord(message) ? message.options : undefined;
        if (
          event.source !== window.parent ||
          !isRecord(message) ||
          message.channel !== 'mermotion.preview.v1' ||
          message.kind !== 'render' ||
          !isRecord(options) ||
          typeof options.source !== 'string' ||
          !options.source.includes('preview-timeout-sentinel')
        ) {
          return;
        }
        event.stopImmediatePropagation();
        window.parent.postMessage({ kind: 'test-preview-render-stalled' }, '*');
      },
      { capture: true },
    );
  });

  await page.goto('/');
  await expect(page.locator('.mermaid-stage svg')).toBeVisible();

  const renderer = page.locator('.preview-render-realm');
  const initialDocument = await renderer.getAttribute('srcdoc');
  const initialNonce = initialDocument?.match(/script-src 'nonce-([^']+)'/)?.[1];
  expect(initialNonce).toBeTruthy();

  await page.evaluate(() => Reflect.set(window, '__mermotionAccelerateRenderTimeouts', true));

  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(`flowchart LR
  %% preview-timeout-sentinel
  stuck[Stuck] --> blocked[Blocked]
`);

  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__mermotionStalledRequestCount')))
    .toBe(1);
  await expect(page.getByText('Preview held at the last valid state')).toBeVisible();
  await expect(page.locator('.preview-error strong')).toHaveText(
    'The isolated Mermaid renderer timed out.',
  );
  await page.evaluate(() => Reflect.set(window, '__mermotionAccelerateRenderTimeouts', false));
  await expect(page.locator('.mermaid-stage svg')).toBeVisible();
  await expect.poll(() => renderer.getAttribute('srcdoc')).not.toBe(initialDocument);

  const recoveredDocument = await renderer.getAttribute('srcdoc');
  const recoveredNonce = recoveredDocument?.match(/script-src 'nonce-([^']+)'/)?.[1];
  expect(recoveredNonce).toBeTruthy();
  expect(recoveredNonce).not.toBe(initialNonce);
  expect(recoveredDocument).toContain("default-src 'none'");
  expect(recoveredDocument).toContain("connect-src 'none'");
  expect(recoveredDocument).toContain("frame-src 'none'");
  expect(recoveredDocument).toContain("worker-src 'none'");
  await expect(renderer).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(renderer).not.toHaveAttribute('sandbox', /allow-same-origin/);

  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Reflect.get(window, '__mermotionStalledRequestCount'))).toBe(1);

  const rendererFrame = page.frames().find((frame) => frame.url() === 'about:srcdoc');
  expect(rendererFrame).toBeDefined();
  const parentAccess = await rendererFrame?.evaluate(() => {
    try {
      void window.parent.document;
      return 'readable';
    } catch (error) {
      return error instanceof DOMException ? error.name : 'blocked';
    }
  });
  expect(parentAccess).toBe('SecurityError');

  await page.getByLabel('Edit diagram.mmd').fill(diagramWithRemoteImage);
  await expect(page.locator('[data-mermotion-target="node:Remote"]').first()).toBeVisible();
  await expect(page.getByText('Preview held at the last valid state')).toHaveCount(0);
  expect(endpointHits).toBe(0);
});

test('removes form navigation without discarding safe label content', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(diagramWithHtmlForm);

  await expect(page.locator('.mermaid-stage svg')).toBeVisible();
  await expect(page.locator('.mermaid-stage form')).toHaveCount(0);
  await expect(page.locator('.mermaid-stage button', { hasText: 'Reload' })).toBeVisible();

  const urlBeforeClick = page.url();
  await page.locator('.mermaid-stage button', { hasText: 'Reload' }).click();
  await expect(page).toHaveURL(urlBeforeClick);
  await expect(page.locator('.mermaid-stage svg')).toBeVisible();
});

test('removes network CSS and links before inserting the rendered SVG', async ({ page }) => {
  let endpointHits = 0;
  await page.route('**/probe.svg', async (route) => {
    endpointHits += 1;
    await route.fulfill({ body: 'not reached', contentType: 'text/plain' });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(diagramWithNetworkStyles);

  await expect(page.locator('.mermaid-stage svg')).toBeVisible();
  await expect(page.locator('[data-mermotion-target="node:A"]').first()).toBeVisible();
  expect(await page.locator('.mermaid-stage').innerHTML()).not.toContain('/probe.svg');
  await expect(page.locator('.mermaid-stage a[href]')).toHaveCount(0);
  expect(endpointHits).toBe(0);
});

test('neutralizes image markup inside Mermaid HTML labels', async ({ page }) => {
  let endpointHits = 0;
  await page.route('**/probe.svg', async (route) => {
    endpointHits += 1;
    await route.fulfill({ body: 'not reached', contentType: 'text/plain' });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(diagramWithHtmlImage);

  await expect(page.locator('.mermaid-stage svg')).toBeVisible();
  await expect(page.locator('[data-mermotion-target="node:B"]').first()).toBeVisible();
  await expect(page.locator('.mermaid-stage img[src]')).toHaveCount(0);
  expect(await page.locator('.mermaid-stage').innerHTML()).not.toContain('/probe.svg');
  expect(endpointHits).toBe(0);
});

test('exports sanitized GIF frames without fetching remote image markup', async ({ page }) => {
  let endpointHits = 0;
  await page.route('**/probe.svg', async (route) => {
    endpointHits += 1;
    await route.fulfill({ body: 'not reached', contentType: 'text/plain' });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(diagramWithRemoteImage);
  await expect(page.locator('[data-mermotion-target="node:B"]').first()).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(shortHighlightMotion);
  await expect(page.getByText('Source and motion agree')).toBeVisible();

  await page.getByRole('button', { name: 'Open export options' }).click();
  await page.getByLabel('GIF width').selectOption('640');
  await page.getByLabel('GIF frame rate').selectOption('10');
  await expect(page.getByRole('button', { name: 'Export GIF' })).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GIF' }).click();
  await downloadPromise;

  expect(endpointHits).toBe(0);
});
