import { expect, test, type Locator, type Page } from '@playwright/test';

interface ScreenPoint {
  x: number;
  y: number;
}

const routeDiagram = `flowchart LR
  A[Service] --> B[Service]
`;

const continuousRouteDiagram = `flowchart LR
  A[Producer] --> M[Middleware]
  M --> B[Consumer]
`;

const cyclicRouteDiagram = `flowchart LR
  A[Service A] --> B[Service B]
  B --> A
`;

function markerMotion(effect: 'move' | 'trace', route = 'A --> B'): string {
  const statement =
    effect === 'move'
      ? `marker request as "Request"\n  at 0ms move request along ${route} over 1s easing linear`
      : `at 0ms trace ${route} over 1s easing linear`;
  return `motionDiagram-v1
  defaults duration 400ms easing linear
  ${statement}
`;
}

async function useRouteFixture(
  page: Page,
  effect: 'move' | 'trace',
  diagram = routeDiagram,
  route = 'A --> B',
): Promise<void> {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(diagram);
  await expect(page.locator('[data-mermotion-target="node:A"]').first()).toBeVisible();

  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(markerMotion(effect, route));
  await expect(page.locator('.cue-block')).toHaveCount(1);
  await expect(page.getByText('Source and motion agree')).toBeVisible();
  await expect(page.getByLabel('Seek animation')).toHaveAttribute('max', '1200');
  await expect(page.locator('.timeline-duration')).toHaveText('00:01.20');
}

async function settleMotionFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function seek(page: Page, timeMs: number): Promise<void> {
  await page.getByLabel('Seek animation').fill(String(timeMs));
  await settleMotionFrame(page);
}

async function geometryScreenPoint(geometry: Locator, progress: number): Promise<ScreenPoint> {
  return geometry.evaluate((element, requestedProgress) => {
    if (!(element instanceof SVGGeometryElement)) {
      throw new Error('Expected an SVG geometry element.');
    }
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('Expected the SVG geometry to have a screen transform.');
    const point = element.getPointAtLength(element.getTotalLength() * requestedProgress);
    return {
      x: matrix.a * point.x + matrix.c * point.y + matrix.e,
      y: matrix.b * point.x + matrix.d * point.y + matrix.f,
    };
  }, progress);
}

async function originScreenPoint(graphics: Locator): Promise<ScreenPoint> {
  return graphics.evaluate((element) => {
    if (!(element instanceof SVGGraphicsElement)) {
      throw new Error('Expected an SVG graphics element.');
    }
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('Expected the SVG marker to have a screen transform.');
    return { x: matrix.e, y: matrix.f };
  });
}

async function centerScreenPoint(graphics: Locator): Promise<ScreenPoint> {
  return graphics.evaluate((element) => {
    if (!(element instanceof SVGGraphicsElement)) {
      throw new Error('Expected an SVG graphics element.');
    }
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('Expected the SVG target to have a screen transform.');
    const box = element.getBBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return {
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f,
    };
  });
}

async function geometryScreenMetrics(
  geometry: Locator,
): Promise<{ start: ScreenPoint; end: ScreenPoint; length: number }> {
  return geometry.evaluate((element) => {
    if (!(element instanceof SVGGeometryElement)) {
      throw new Error('Expected an SVG geometry element.');
    }
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('Expected the SVG geometry to have a screen transform.');
    const geometryLength = element.getTotalLength();
    const samples = Array.from({ length: 101 }, (_, index) => {
      const point = element.getPointAtLength((geometryLength * index) / 100);
      return {
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
      };
    });
    const length = samples.slice(1).reduce((total, point, index) => {
      const previous = samples[index];
      return previous ? total + Math.hypot(point.x - previous.x, point.y - previous.y) : total;
    }, 0);
    const start = samples[0];
    const end = samples.at(-1);
    if (!start || !end) throw new Error('Expected sampled SVG geometry points.');
    return { start, end, length };
  });
}

function pointDistance(left: ScreenPoint, right: ScreenPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function seekTimeForDistance(distance: number, totalDistance: number): number {
  return Math.round((distance / totalDistance) * 100) * 10;
}

function orientFrom(
  source: ScreenPoint,
  edge: { start: ScreenPoint; end: ScreenPoint; length: number },
): { start: ScreenPoint; end: ScreenPoint; length: number } {
  return pointDistance(source, edge.start) <= pointDistance(source, edge.end)
    ? edge
    : { start: edge.end, end: edge.start, length: edge.length };
}

function orientedGeometryProgress(
  source: ScreenPoint,
  edge: { start: ScreenPoint; end: ScreenPoint },
  progress: number,
): number {
  return pointDistance(source, edge.start) <= pointDistance(source, edge.end)
    ? progress
    : 1 - progress;
}

function expectPointsToAlign(actual: ScreenPoint, expected: ScreenPoint, tolerance = 1.5): void {
  expect(pointDistance(actual, expected)).toBeLessThanOrEqual(tolerance);
}

function expectDirectionsToAlign(
  actualFrom: ScreenPoint,
  actualTo: ScreenPoint,
  expectedFrom: ScreenPoint,
  expectedTo: ScreenPoint,
): void {
  const actual = { x: actualTo.x - actualFrom.x, y: actualTo.y - actualFrom.y };
  const expected = { x: expectedTo.x - expectedFrom.x, y: expectedTo.y - expectedFrom.y };
  const denominator = Math.hypot(actual.x, actual.y) * Math.hypot(expected.x, expected.y);
  if (denominator <= 0.001) throw new Error('Expected measurable direction vectors.');
  expect((actual.x * expected.x + actual.y * expected.y) / denominator).toBeGreaterThan(0.8);
}

async function traceRemainingRatio(trace: Locator): Promise<number> {
  return trace.evaluate((element) => {
    if (!(element instanceof SVGGeometryElement)) {
      throw new Error('Expected an SVG trace geometry element.');
    }
    const normalizedLength = Number.parseFloat(element.getAttribute('pathLength') ?? '');
    const dashOffset = Number.parseFloat(element.getAttribute('stroke-dashoffset') ?? '');
    if (!Number.isFinite(dashOffset) || normalizedLength <= 0) {
      throw new Error('Expected normalized trace dash geometry.');
    }
    return dashOffset / normalizedLength;
  });
}

async function isStrokePaintedAt(geometry: Locator, progress: number): Promise<boolean> {
  return geometry.evaluate((element, requestedProgress) => {
    if (!(element instanceof SVGGeometryElement)) {
      throw new Error('Expected an SVG geometry element.');
    }
    const point = element.getPointAtLength(element.getTotalLength() * requestedProgress);
    return element.isPointInStroke(new DOMPoint(point.x, point.y));
  }, progress);
}

async function computedSvgVisual(element: Locator): Promise<{
  opacity: number;
  radius?: number;
  visibility: string;
}> {
  return element.evaluate((candidate) => {
    if (!(candidate instanceof SVGGraphicsElement)) {
      throw new Error('Expected an SVG graphics element.');
    }
    const style = getComputedStyle(candidate);
    return {
      opacity: Number.parseFloat(style.opacity),
      ...(candidate instanceof SVGCircleElement ? { radius: candidate.r.baseVal.value } : {}),
      visibility: style.visibility,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('semantic targets')).toBeVisible();
  await expect(page.getByText('Preview current')).toBeVisible();
});

test('renders a Mermaid document and exposes the motion workbench', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Mermotion home' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(page.locator('.target-count')).toHaveText('11');
  await expect(page.locator('.cue-block')).toHaveCount(4);
  await expect(page.locator('[data-mermotion-target="node:brief"]').first()).toBeVisible();
  await expect(page.getByText(/Mermaid \d+\.\d+\.\d+/)).toBeVisible();
});

test('keeps a named marker on its rendered edge while scrubbing and at its destination', async ({
  page,
}) => {
  await useRouteFixture(page, 'move');
  const edge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const marker = page.locator('[data-marker-id="request"]').first();
  const sourceCenter = await centerScreenPoint(
    page.locator('[data-mermotion-target="node:A"][data-mermotion-effect-root]').first(),
  );
  const destinationCenter = await centerScreenPoint(
    page.locator('[data-mermotion-target="node:B"][data-mermotion-effect-root]').first(),
  );
  const edgeMetrics = orientFrom(sourceCenter, await geometryScreenMetrics(edge));
  const startConnectorLength = pointDistance(sourceCenter, edgeMetrics.start);
  const routeLength =
    startConnectorLength + edgeMetrics.length + pointDistance(edgeMetrics.end, destinationCenter);
  const midpointTimeMs = seekTimeForDistance(
    startConnectorLength + edgeMetrics.length / 2,
    routeLength,
  );

  await seek(page, midpointTimeMs);
  await expect(marker).toBeAttached();
  const expectedMidpoint = await geometryScreenPoint(edge, 0.5);
  const firstMidpoint = await originScreenPoint(marker);
  expectPointsToAlign(firstMidpoint, expectedMidpoint);
  await page.evaluate(() => {
    const markerElement = document.querySelector('[data-marker-id="request"]');
    const overlayElement = markerElement?.closest('[data-mermotion-overlay]');
    if (!markerElement || !overlayElement) throw new Error('Expected retained motion elements.');
    Reflect.set(window, '__e2eMermotionMarker', markerElement);
    Reflect.set(window, '__e2eMermotionOverlay', overlayElement);
  });

  await seek(page, 200);
  expect(
    await page.evaluate(() => ({
      marker:
        Reflect.get(window, '__e2eMermotionMarker') ===
        document.querySelector('[data-marker-id="request"]'),
      overlay:
        Reflect.get(window, '__e2eMermotionOverlay') ===
        document.querySelector('[data-mermotion-overlay]'),
    })),
  ).toEqual({ marker: true, overlay: true });
  await seek(page, midpointTimeMs);
  expect(
    await page.evaluate(() => ({
      marker:
        Reflect.get(window, '__e2eMermotionMarker') ===
        document.querySelector('[data-marker-id="request"]'),
      overlay:
        Reflect.get(window, '__e2eMermotionOverlay') ===
        document.querySelector('[data-mermotion-overlay]'),
    })),
  ).toEqual({ marker: true, overlay: true });
  const repeatedMidpoint = await originScreenPoint(marker);
  expectPointsToAlign(repeatedMidpoint, expectedMidpoint);
  expectPointsToAlign(repeatedMidpoint, firstMidpoint);

  await seek(page, 1000);
  await expect(page.getByLabel('Current time')).toHaveText('00:01.00');
  const completedPosition = await originScreenPoint(marker);
  expectPointsToAlign(completedPosition, destinationCenter);
});

test('retains marker decoration DOM and reproduces it exactly after a reseek', async ({ page }) => {
  await useRouteFixture(page, 'move');
  await seek(page, 500);

  const decoration = page.locator('[data-mermotion-marker-decoration="request"]');
  const marker = page.locator('[data-marker-id="request"]');
  const tails = decoration.locator('[data-mermotion-tail]');
  const arrival = decoration.locator('[data-mermotion-arrival]');
  await expect(decoration).toHaveCount(1);
  await expect(marker).toHaveCount(1);
  await expect(tails).toHaveCount(2);
  await expect(decoration.locator('[data-mermotion-tail="soft"]')).toHaveCount(1);
  await expect(decoration.locator('[data-mermotion-tail="core"]')).toHaveCount(1);
  await expect(decoration.locator('[data-mermotion-wake]')).toHaveCount(0);
  await expect(decoration.locator('[data-mermotion-marker-occupancy]')).toHaveCount(0);
  await expect(arrival).toHaveCount(1);

  const initial = await page.evaluate(() => {
    const selector = '[data-mermotion-marker-decoration="request"]';
    const root = document.querySelector(selector);
    if (!root) throw new Error('Expected a marker decoration group.');
    const elements = [
      root,
      ...root.querySelectorAll('[data-marker-id], [data-mermotion-tail], [data-mermotion-arrival]'),
    ];
    Reflect.set(window, '__e2eMarkerDecorationElements', elements);
    return root.outerHTML;
  });

  await seek(page, 180);
  await seek(page, 500);

  const repeated = await page.evaluate(() => {
    const root = document.querySelector('[data-mermotion-marker-decoration="request"]');
    const retained = Reflect.get(window, '__e2eMarkerDecorationElements');
    if (!root || !Array.isArray(retained)) {
      throw new Error('Expected retained marker decoration state.');
    }
    const current = [
      root,
      ...root.querySelectorAll('[data-marker-id], [data-mermotion-tail], [data-mermotion-arrival]'),
    ];
    return {
      markup: root.outerHTML,
      retained:
        retained.length === current.length &&
        retained.every((element, index) => element === current[index]),
    };
  });
  expect(repeated.retained).toBe(true);
  expect(repeated.markup).toBe(initial);
});

test('retains one named marker across contiguous move statements', async ({ page }) => {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(`flowchart LR
  A[Producer] --> B[Queue]
  B --> C[Consumer]
`);
  await expect(page.locator('[data-mermotion-target="node:C"]').first()).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  marker request as "Request"
  at 0ms move request along A --> B over 1s easing linear
  move request along B --> C over 1s easing linear
`);
  await expect(page.locator('.diagnostic-line')).toHaveCount(0);
  await expect(page.locator('.cue-block')).toHaveCount(2);

  await seek(page, 900);
  await page.evaluate(() => {
    const decoration = document.querySelector('[data-mermotion-marker-decoration="request"]');
    const marker = document.querySelector('[data-marker-id="request"]');
    const tails = [...document.querySelectorAll('[data-mermotion-tail]')];
    if (!decoration || !marker || tails.length !== 2) {
      throw new Error('Expected one complete marker visual.');
    }
    Reflect.set(window, '__e2eContiguousMarkerVisuals', [decoration, marker, ...tails]);
  });

  await seek(page, 1100);
  await expect(page.locator('[data-marker-id="request"]')).toHaveAttribute(
    'data-marker-phase',
    'moving',
  );
  expect(
    await page.evaluate(() => {
      const retained = Reflect.get(window, '__e2eContiguousMarkerVisuals');
      const current = [
        document.querySelector('[data-mermotion-marker-decoration="request"]'),
        document.querySelector('[data-marker-id="request"]'),
        ...document.querySelectorAll('[data-mermotion-tail]'),
      ];
      return (
        Array.isArray(retained) &&
        retained.length === current.length &&
        retained.every((element, index) => element === current[index])
      );
    }),
  ).toBe(true);
});

test('keeps an implicit marker color deterministic across direct and prior seeks', async ({
  page,
}) => {
  await seek(page, 1_100);
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(`flowchart LR
  A[A] --> B[B]
  B --> C[C]
  linkStyle 0 stroke:#ff0000,stroke-width:4px
  linkStyle 1 stroke:#0000ff,stroke-width:4px
`);
  await expect(page.locator('[data-mermotion-target="node:C"]').first()).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  marker request as "Request"
  at 0ms move request along A --> B over 1s easing linear
  move request along B --> C over 1s easing linear
`);
  await expect(page.locator('.diagnostic-line')).toHaveCount(0);

  await settleMotionFrame(page);
  const directColor = await page
    .locator('[data-mermotion-marker-decoration="request"]')
    .getAttribute('color');
  expect(directColor).toBe('rgb(255, 0, 0)');

  await seek(page, 0);
  await seek(page, 1_100);
  await expect(page.locator('[data-mermotion-marker-decoration="request"]')).toHaveAttribute(
    'color',
    directColor ?? '',
  );
});

test('starts a new marker incarnation after remove while retaining each incarnation', async ({
  page,
}) => {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(`flowchart LR
  A[A] --> B[B]
  B --> C[C]
`);
  await expect(page.locator('[data-mermotion-target="node:C"]').first()).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  marker request as "Request"
  at 0ms move request along A --> B over 500ms easing linear
  remove request
  move request along B --> C over 500ms easing linear
`);
  await expect(page.locator('.diagnostic-line')).toHaveCount(0);

  await seek(page, 400);
  await page.evaluate(() => {
    const marker = document.querySelector('[data-mermotion-marker-decoration="request"]');
    if (!marker) throw new Error('Expected the first marker incarnation.');
    Reflect.set(window, '__e2eFirstMarkerIncarnation', marker);
  });

  await seek(page, 600);
  expect(
    await page.evaluate(() => {
      const first = Reflect.get(window, '__e2eFirstMarkerIncarnation');
      const current = document.querySelector('[data-mermotion-marker-decoration="request"]');
      if (!current) throw new Error('Expected the second marker incarnation.');
      Reflect.set(window, '__e2eSecondMarkerIncarnation', current);
      return current !== first;
    }),
  ).toBe(true);

  await seek(page, 700);
  expect(
    await page.evaluate(
      () =>
        document.querySelector('[data-mermotion-marker-decoration="request"]') ===
        Reflect.get(window, '__e2eSecondMarkerIncarnation'),
    ),
  ).toBe(true);
});

test('keeps trace and marker paint order deterministic after elements are removed and recreated', async ({
  page,
}) => {
  await seek(page, 1_000);
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(routeDiagram);
  await expect(page.locator('[data-mermotion-target="node:B"]').first()).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  marker red as "Red"
  marker blue as "Blue"
  at 0ms move red along A --> B over 2s color #ff3b30
  at 500ms move blue along A --> B over 1s color #0a84ff
  at 0ms trace A --> B over 2s color #ff3b30
  at 500ms trace A --> B over 2s color #0a84ff
  at 2100ms remove red
`);
  await expect(page.locator('.diagnostic-line')).toHaveCount(0);
  await settleMotionFrame(page);

  const snapshotPaintOrder = () =>
    page.locator('[data-mermotion-overlay]').evaluate(() => {
      const traceLayer = document.querySelector('[data-mermotion-layer="traces"]');
      const markerLayer = document.querySelector('[data-mermotion-layer="markers"]');
      if (!(traceLayer instanceof SVGGElement) || !(markerLayer instanceof SVGGElement)) {
        throw new Error('Expected ordered overlay layers.');
      }
      return {
        layerOrder: traceLayer.nextElementSibling === markerLayer,
        markerPaint: [...markerLayer.children].map((group) => getComputedStyle(group).color),
        tracePaint: [...traceLayer.children].map((group) => {
          const core = group.querySelector('[data-mermotion-trace]');
          if (!(core instanceof SVGPathElement)) throw new Error('Expected a trace core.');
          return getComputedStyle(core).stroke;
        }),
      };
    });

  const direct = await snapshotPaintOrder();
  expect(direct).toEqual({
    layerOrder: true,
    markerPaint: ['rgb(255, 59, 48)', 'rgb(10, 132, 255)'],
    tracePaint: ['rgb(255, 59, 48)', 'rgb(10, 132, 255)'],
  });

  await seek(page, 2_200);
  await expect(page.locator('[data-mermotion-trace-group]')).toHaveCount(1);
  await expect(page.locator('[data-mermotion-marker-decoration]')).toHaveCount(1);
  await seek(page, 1_000);
  expect(await snapshotPaintOrder()).toEqual(direct);
});

test('updates steady marker frames without rebuilding children or rescanning route bounds', async ({
  page,
}) => {
  await useRouteFixture(page, 'move', continuousRouteDiagram, 'A --> M --> B');
  await seek(page, 300);
  await page.evaluate(() => {
    const root = document.querySelector('[data-mermotion-marker-decoration="request"]');
    if (!root) throw new Error('Expected a retained marker decoration.');
    const metrics = {
      boundingBoxes: 0,
      childListMutations: 0,
      computedStyles: 0,
      screenTransforms: 0,
    };
    const graphicsPrototype = SVGGraphicsElement.prototype;
    /* oxlint-disable-next-line typescript/unbound-method -- the wrapper restores the element receiver with call(). */
    const originalGetBBox = graphicsPrototype.getBBox;
    /* oxlint-disable-next-line typescript/unbound-method -- the wrapper restores the element receiver with call(). */
    const originalGetScreenCtm = graphicsPrototype.getScreenCTM;
    const originalGetComputedStyle = window.getComputedStyle;
    Object.defineProperty(graphicsPrototype, 'getBBox', {
      configurable: true,
      value: function getBBox(this: SVGGraphicsElement) {
        metrics.boundingBoxes += 1;
        return originalGetBBox.call(this);
      },
    });
    Object.defineProperty(graphicsPrototype, 'getScreenCTM', {
      configurable: true,
      value: function getScreenCTM(this: SVGGraphicsElement) {
        metrics.screenTransforms += 1;
        return originalGetScreenCtm.call(this);
      },
    });
    window.getComputedStyle = function getComputedStyle(
      element: Element,
      pseudoElement?: string | null,
    ) {
      metrics.computedStyles += 1;
      return originalGetComputedStyle.call(window, element, pseudoElement);
    };
    const observer = new MutationObserver((records) => {
      metrics.childListMutations += records.filter((record) => record.type === 'childList').length;
    });
    observer.observe(root, { childList: true, subtree: true });
    Reflect.set(window, '__e2eMotionFrameMetrics', {
      metrics,
      observer,
      originalGetComputedStyle,
    });
  });

  await seek(page, 360);
  await seek(page, 420);
  const metrics = await page.evaluate(() => {
    const stored = Reflect.get(window, '__e2eMotionFrameMetrics');
    if (!stored || !(stored.observer instanceof MutationObserver)) {
      throw new Error('Expected motion frame instrumentation.');
    }
    stored.metrics.childListMutations += stored.observer
      .takeRecords()
      .filter((record: MutationRecord) => record.type === 'childList').length;
    stored.observer.disconnect();
    window.getComputedStyle = stored.originalGetComputedStyle;
    return {
      boundingBoxes: Number(stored.metrics.boundingBoxes),
      childListMutations: Number(stored.metrics.childListMutations),
      computedStyles: Number(stored.metrics.computedStyles),
      screenTransforms: Number(stored.metrics.screenTransforms),
    };
  });

  expect(metrics.boundingBoxes).toBe(0);
  expect(metrics.childListMutations).toBe(0);
  expect(metrics.computedStyles).toBe(0);
  expect(metrics.screenTransforms).toBeLessThanOrEqual(2);
});

test('keeps two bounded full-route tails attached to rendered geometry', async ({ page }) => {
  await useRouteFixture(page, 'move');

  const edge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const marker = page.locator('[data-marker-id="request"]');
  const tails = page.locator('[data-mermotion-tail]');
  const tailCore = page.locator('[data-mermotion-tail="core"]');
  const sourceCenter = await centerScreenPoint(
    page.locator('[data-mermotion-target="node:A"][data-mermotion-effect-root]').first(),
  );
  const destinationCenter = await centerScreenPoint(
    page.locator('[data-mermotion-target="node:B"][data-mermotion-effect-root]').first(),
  );
  const edgeMetrics = await geometryScreenMetrics(edge);
  const orientedEdge = orientFrom(sourceCenter, edgeMetrics);
  const sourceConnectorLength = pointDistance(sourceCenter, orientedEdge.start);
  const routeLength =
    sourceConnectorLength + edgeMetrics.length + pointDistance(orientedEdge.end, destinationCenter);
  const midpointTimeMs = seekTimeForDistance(
    sourceConnectorLength + edgeMetrics.length / 2,
    routeLength,
  );
  const tolerance = routeLength * 0.005 + 1.5;
  await seek(page, midpointTimeMs);

  const nativeMidpoint = await geometryScreenPoint(edge, 0.5);
  const markerPoint = await originScreenPoint(marker);
  const routeProgress = Number(await marker.getAttribute('data-route-progress'));

  await expect(tails).toHaveCount(2);
  expectPointsToAlign(markerPoint, nativeMidpoint, tolerance);
  expectPointsToAlign(await geometryScreenPoint(tailCore, routeProgress), markerPoint, tolerance);
  expectPointsToAlign(await geometryScreenPoint(tailCore, 0), sourceCenter);
  const tailMetrics = await geometryScreenMetrics(tailCore);
  const [initialDash, leadingGap, tailLength, trailingGap] = (
    (await tailCore.getAttribute('stroke-dasharray')) ?? ''
  )
    .split(/\s+/)
    .map(Number);
  expect(initialDash).toBe(0);
  expect((leadingGap ?? 0) + (tailLength ?? 0)).toBeCloseTo(routeProgress, 3);
  expect(
    (initialDash ?? 0) + (leadingGap ?? 0) + (tailLength ?? 0) + (trailingGap ?? 0),
  ).toBeCloseTo(1, 3);
  expect((tailLength ?? 0) * tailMetrics.length).toBeCloseTo(19, 0);
  await expect(tailCore).toHaveAttribute('stroke-dashoffset', '0');
  await expect(tailCore).not.toHaveAttribute('vector-effect', 'non-scaling-stroke');
  expect(await isStrokePaintedAt(tailCore, routeProgress - (tailLength ?? 0) / 2)).toBe(true);
  expect(
    await isStrokePaintedAt(tailCore, Math.min(1, routeProgress + (tailLength ?? 0) / 2)),
  ).toBe(false);

  const stablePath = await tailCore.getAttribute('d');
  await seek(page, Math.min(900, midpointTimeMs + 180));
  await expect(tailCore).toHaveAttribute('d', stablePath ?? '');
  await expect(page.locator('[data-mermotion-wake]')).toHaveCount(0);
  await expect(page.locator('[data-mermotion-marker-occupancy]')).toHaveCount(0);
});

test('isolates marker and trace paint from broad Mermaid theme CSS', async ({ page }) => {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(`---
config:
  theme: base
  themeCSS: |
    g { opacity: 0 !important; }
    [data-mermotion-overlay], [data-mermotion-overlay] g { transform: translate(80px, 40px) !important; }
    g, path, circle, rect, text, line { pointer-events: auto !important; }
    path, circle { display: none !important; }
    circle { color: #0000ff !important; fill-opacity: 0 !important; opacity: 0 !important; stroke-opacity: 0 !important; }
    path { color: #0000ff !important; stroke-dasharray: 0.01 0.99 !important; stroke-dashoffset: 0 !important; stroke-opacity: 0 !important; vector-effect: non-scaling-stroke !important; opacity: 1 !important; visibility: visible !important; stroke-width: 21px !important; stroke-linecap: square !important; transition: stroke-dashoffset 10s linear !important; animation: hostile-motion 10s linear infinite !important; }
---
flowchart LR
  A[A] --> B[B]
`);
  await expect(page.locator('[data-mermotion-target="node:B"]').first()).toBeAttached();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  marker request as "Request"
  at 0ms move request along A --> B over 1s easing linear
  with trace A --> B over 1s easing linear
`);
  await expect(page.locator('.diagnostic-line')).toHaveCount(0);
  await seek(page, 500);

  const tail = page.locator('[data-mermotion-tail="core"]');
  const trace = page.locator('[data-mermotion-trace]').first();
  const marker = page.locator('[data-marker-id="request"]');
  const routeProgress = Number(await marker.getAttribute('data-route-progress'));
  const authoredTailDash = ((await tail.getAttribute('stroke-dasharray')) ?? '')
    .split(/\s+/)
    .map(Number);
  const computed = await page.locator('[data-mermotion-overlay]').evaluate(() => {
    /* oxlint-disable-next-line unicorn/consistent-function-scoping -- This helper executes inside the browser callback. */
    const read = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof SVGGeometryElement)) {
        throw new Error(`Expected overlay geometry for ${selector}.`);
      }
      const style = getComputedStyle(element);
      return {
        dasharray: style.strokeDasharray.split(/[ ,]+/).filter(Boolean).map(Number.parseFloat),
        dashoffset: Number.parseFloat(style.strokeDashoffset),
        display: style.display,
        linecap: style.strokeLinecap,
        opacity: Number.parseFloat(style.opacity),
        stroke: style.stroke,
        strokeOpacity: Number.parseFloat(style.strokeOpacity),
        strokeWidth: Number.parseFloat(style.strokeWidth),
        transitionDuration: style.transitionDuration,
        vectorEffect: style.vectorEffect,
        animationName: style.animationName,
      };
    };
    return {
      tail: read('[data-mermotion-tail="core"]'),
      trace: read('[data-mermotion-trace]'),
    };
  });

  expect(computed.tail.dasharray).toEqual(authoredTailDash);
  expect(computed.tail.dashoffset).toBe(0);
  expect(computed.tail.display).not.toBe('none');
  expect(computed.tail.linecap).toBe('butt');
  expect(computed.tail.opacity).toBeCloseTo(0.7, 2);
  expect(computed.tail.stroke).not.toBe('rgb(0, 0, 255)');
  expect(computed.tail.strokeOpacity).toBe(1);
  expect(computed.tail.strokeWidth).toBeLessThan(21);
  expect(computed.tail.transitionDuration).toBe('0s');
  expect(computed.tail.vectorEffect).toBe('none');
  expect(computed.tail.animationName).toBe('none');
  expect(computed.trace.dasharray).toEqual([1]);
  expect(computed.trace.dashoffset).toBeCloseTo(0.5, 2);
  expect(computed.trace.display).not.toBe('none');
  expect(computed.trace.linecap).toBe('round');
  expect(computed.trace.opacity).toBeCloseTo(0.92, 2);
  expect(computed.trace.stroke).not.toBe('rgb(0, 0, 255)');
  expect(computed.trace.strokeOpacity).toBe(1);
  expect(computed.trace.strokeWidth).toBeLessThan(21);
  expect(computed.trace.transitionDuration).toBe('0s');
  expect(computed.trace.vectorEffect).toBe('none');
  expect(computed.trace.animationName).toBe('none');

  const tailLength = authoredTailDash[2] ?? 0;
  expect(await isStrokePaintedAt(tail, routeProgress - tailLength / 2)).toBe(true);
  expect(await isStrokePaintedAt(tail, Math.min(1, routeProgress + tailLength / 2))).toBe(false);
  expect(await isStrokePaintedAt(trace, 0.25)).toBe(true);
  expect(await isStrokePaintedAt(trace, 0.75)).toBe(false);
  const markerCore = page.locator('[data-mermotion-marker-core]');
  await expect(markerCore).toHaveCSS('display', 'inline');
  await expect(markerCore).toHaveCSS('opacity', '1');
  await expect(markerCore).toHaveCSS('fill-opacity', '1');
  await expect(markerCore).toHaveCSS('pointer-events', 'none');
  await expect(markerCore).toHaveCSS('stroke-opacity', '1');
  await expect(markerCore).not.toHaveCSS('fill', 'rgb(0, 0, 255)');
  expect(
    await page.locator('[data-mermotion-overlay]').evaluate(() =>
      [
        '[data-mermotion-overlay]',
        '[data-mermotion-layer="traces"]',
        '[data-mermotion-layer="markers"]',
        '[data-mermotion-trace-group]',
        '[data-mermotion-marker-decoration]',
      ].map((selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof SVGGElement)) throw new Error(`Expected ${selector}.`);
        const style = getComputedStyle(element);
        return {
          opacity: Number.parseFloat(style.opacity),
          pointerEvents: style.pointerEvents,
          transform: style.transform,
        };
      }),
    ),
  ).toEqual(
    Array.from({ length: 5 }, () => ({ opacity: 1, pointerEvents: 'none', transform: 'none' })),
  );
  expect(
    await page
      .locator('[data-mermotion-overlay]')
      .evaluate((overlay) =>
        [overlay, ...overlay.querySelectorAll('*')].every(
          (element) => getComputedStyle(element).pointerEvents === 'none',
        ),
      ),
  ).toBe(true);

  await seek(page, 750);
  await expect(trace).toHaveCSS('stroke-dashoffset', '0.25px');
  await seek(page, 250);
  await expect(trace).toHaveCSS('stroke-dashoffset', '0.75px');
  expect(await isStrokePaintedAt(trace, 0.1)).toBe(true);
  expect(await isStrokePaintedAt(trace, 0.5)).toBe(false);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settleMotionFrame(page);
  expect(
    Number.parseFloat(await tail.evaluate((element) => getComputedStyle(element).opacity)),
  ).toBe(0);
});

test('samples target effects independently of Mermaid CSS transitions and animations', async ({
  page,
}) => {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(`---
config:
  theme: base
  themeCSS: |
    g.node { opacity: 0.4 !important; filter: none !important; transition: opacity 5s linear !important; animation: hostile-node 5s linear infinite !important; }
---
flowchart LR
  A[A] --> B[B]
`);
  const target = page
    .locator('[data-mermotion-target="node:A"][data-mermotion-effect-root]')
    .first();
  await expect(target).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  const editor = page.getByLabel('Edit diagram.motion');
  await editor.fill('motionDiagram-v1\n');
  await expect(page.locator('.cue-block')).toHaveCount(0);
  const authoredInlineStyle = await target.evaluate((element) => {
    if (!(element instanceof SVGElement)) throw new Error('Expected an SVG target.');
    element.style.setProperty('animation-name', 'hostile-node', 'important');
    element.style.setProperty('animation-duration', '5s');
    element.style.setProperty('animation-delay', '250ms');
    element.style.setProperty('transition-property', 'opacity', 'important');
    element.style.setProperty('transition-duration', '5s');
    element.style.setProperty('transition-timing-function', 'linear');
    return {
      animationDelay: element.style.animationDelay,
      animationDuration: element.style.animationDuration,
      animationName: element.style.animationName,
      animationNamePriority: element.style.getPropertyPriority('animation-name'),
      transitionDuration: element.style.transitionDuration,
      transitionProperty: element.style.transitionProperty,
      transitionPropertyPriority: element.style.getPropertyPriority('transition-property'),
      transitionTimingFunction: element.style.transitionTimingFunction,
    };
  });
  await editor.fill(`motionDiagram-v1
  at 0ms hide A for 1s easing linear
  with highlight A for 1s easing linear
`);
  await expect(page.locator('.diagnostic-line')).toHaveCount(0);
  await seek(page, 500);

  const sampled = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    const matrix = element instanceof SVGGraphicsElement ? element.getScreenCTM() : undefined;
    return {
      animationName: style.animationName,
      filter: style.filter,
      matrix: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : [],
      opacity: Number.parseFloat(style.opacity),
      transitionProperty: style.transitionProperty,
    };
  });
  expect(sampled.animationName).toBe('none');
  expect(sampled.filter).not.toBe('none');
  expect(sampled.opacity).toBeCloseTo(0.2, 2);
  expect(sampled.transitionProperty).toBe('none');

  await page.waitForTimeout(300);
  expect(
    await target.evaluate((element) => {
      const style = getComputedStyle(element);
      const matrix = element instanceof SVGGraphicsElement ? element.getScreenCTM() : undefined;
      return {
        filter: style.filter,
        matrix: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : [],
        opacity: Number.parseFloat(style.opacity),
      };
    }),
  ).toEqual({ filter: sampled.filter, matrix: sampled.matrix, opacity: sampled.opacity });

  await seek(page, 750);
  expect(
    Number.parseFloat(await target.evaluate((element) => getComputedStyle(element).opacity)),
  ).toBeCloseTo(0.1, 3);
  await seek(page, 250);
  expect(
    Number.parseFloat(await target.evaluate((element) => getComputedStyle(element).opacity)),
  ).toBeCloseTo(0.3, 3);

  await editor.fill('motionDiagram-v1\n');
  await expect(page.locator('.cue-block')).toHaveCount(0);
  await expect(target).toHaveCSS('opacity', '0.4');
  await expect(target).toHaveCSS('transition-duration', '5s');
  await expect(target).toHaveCSS('animation-name', 'hostile-node');
  expect(
    await target.evaluate((element) => {
      if (!(element instanceof SVGElement)) throw new Error('Expected an SVG target.');
      return {
        animationDelay: element.style.animationDelay,
        animationDuration: element.style.animationDuration,
        animationName: element.style.animationName,
        animationNamePriority: element.style.getPropertyPriority('animation-name'),
        transitionDuration: element.style.transitionDuration,
        transitionProperty: element.style.transitionProperty,
        transitionPropertyPriority: element.style.getPropertyPriority('transition-property'),
        transitionTimingFunction: element.style.transitionTimingFunction,
      };
    }),
  ).toEqual(authoredInlineStyle);
});

test('settles a marker with one finite arrival ring at its destination', async ({ page }) => {
  await useRouteFixture(page, 'move');
  const marker = page.locator('[data-marker-id="request"]');
  const arrival = page.locator(
    '[data-mermotion-marker-decoration="request"] [data-mermotion-arrival]',
  );
  const destination = page
    .locator('[data-mermotion-target="node:B"][data-mermotion-effect-root]')
    .first();
  const destinationCenter = await centerScreenPoint(destination);

  await seek(page, 500);
  await expect(marker).toHaveAttribute('data-marker-phase', 'moving');
  await expect(arrival).toHaveAttribute('data-arrival-progress', '0');
  const movingRing = await computedSvgVisual(arrival);
  expect(movingRing.visibility === 'hidden' || movingRing.opacity <= 0.01).toBe(true);

  await seek(page, 1000);
  await expect(marker).toHaveAttribute('data-marker-phase', 'arriving');
  await expect(arrival).toHaveAttribute('data-arrival-progress', '0');
  const arrivalStart = await computedSvgVisual(arrival);
  expect(arrivalStart.opacity).toBe(0);
  expectPointsToAlign(await originScreenPoint(marker), destinationCenter);
  expectPointsToAlign(await centerScreenPoint(arrival), destinationCenter);

  await seek(page, 1100);
  await expect(marker).toHaveAttribute('data-marker-phase', 'arriving');
  const arrivalProgress = Number(await arrival.getAttribute('data-arrival-progress'));
  expect(arrivalProgress).toBeCloseTo(0.5, 2);
  const arrivalMiddle = await computedSvgVisual(arrival);
  expect(arrivalMiddle.visibility).not.toBe('hidden');
  expect(arrivalMiddle.opacity).toBeGreaterThan(0.05);
  expect(arrivalMiddle.radius ?? 0).toBeGreaterThan(arrivalStart.radius ?? 0);
  expectPointsToAlign(await originScreenPoint(marker), destinationCenter);
  expectPointsToAlign(await centerScreenPoint(arrival), destinationCenter);

  await seek(page, 1200);
  await expect(marker).toHaveAttribute('data-marker-phase', 'settled');
  await expect(arrival).toHaveAttribute('data-arrival-progress', '1');
  const arrivalEnd = await computedSvgVisual(arrival);
  expect(arrivalEnd.opacity).toBe(0);
  expect(arrivalEnd.visibility === 'hidden' || arrivalEnd.opacity <= 0.01).toBe(true);
  expectPointsToAlign(await originScreenPoint(marker), destinationCenter);
});

test('keeps the marker label visible and clear of occupied nodes', async ({ page }) => {
  await useRouteFixture(page, 'move');
  const callout = page.locator('[data-mermotion-marker-callout]');
  const nodes = page.locator('[data-mermotion-target^="node:"][data-mermotion-effect-root]');

  const expectClearCallout = async (timeMs: number) => {
    await seek(page, timeMs);
    await expect(callout).toHaveAttribute('opacity', '1');
    const calloutBox = await callout.boundingBox();
    if (!calloutBox) throw new Error('Expected a visible marker callout.');
    const nodeBoxes = await nodes.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }),
    );
    for (const nodeBox of nodeBoxes) {
      const overlapWidth = Math.max(
        0,
        Math.min(calloutBox.x + calloutBox.width, nodeBox.x + nodeBox.width) -
          Math.max(calloutBox.x, nodeBox.x),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(calloutBox.y + calloutBox.height, nodeBox.y + nodeBox.height) -
          Math.max(calloutBox.y, nodeBox.y),
      );
      expect(overlapWidth * overlapHeight).toBeLessThanOrEqual(1);
    }
  };

  await expectClearCallout(10);
  await expectClearCallout(1000);
});

test('moves continuously through an intermediate node without a displacement spike', async ({
  page,
}) => {
  await useRouteFixture(page, 'move', continuousRouteDiagram, 'A --> M --> B');
  const marker = page.locator('[data-marker-id="request"]').first();
  const firstEdge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->M#1"][data-mermotion-effect-root]',
    )
    .first();
  const secondEdge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:M-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const sourceCenter = await centerScreenPoint(
    page.locator('[data-mermotion-target="node:A"][data-mermotion-effect-root]').first(),
  );
  const middleCenter = await centerScreenPoint(
    page.locator('[data-mermotion-target="node:M"][data-mermotion-effect-root]').first(),
  );
  const destinationCenter = await centerScreenPoint(
    page.locator('[data-mermotion-target="node:B"][data-mermotion-effect-root]').first(),
  );
  const firstEdgeMetrics = orientFrom(sourceCenter, await geometryScreenMetrics(firstEdge));
  const secondEdgeMetrics = orientFrom(middleCenter, await geometryScreenMetrics(secondEdge));
  const sourceConnectorLength = pointDistance(sourceCenter, firstEdgeMetrics.start);
  const firstArrivalLength = pointDistance(firstEdgeMetrics.end, middleCenter);
  const secondDepartureLength = pointDistance(middleCenter, secondEdgeMetrics.start);
  const destinationConnectorLength = pointDistance(secondEdgeMetrics.end, destinationCenter);
  const routeLength =
    sourceConnectorLength +
    firstEdgeMetrics.length +
    firstArrivalLength +
    secondDepartureLength +
    secondEdgeMetrics.length +
    destinationConnectorLength;

  const landmarkTolerance = routeLength * 0.005 + 1.5;
  const landmarks = [
    {
      distance: sourceConnectorLength + firstEdgeMetrics.length / 2,
      point: await geometryScreenPoint(firstEdge, 0.5),
    },
    {
      distance: sourceConnectorLength + firstEdgeMetrics.length + firstArrivalLength,
      point: middleCenter,
    },
    {
      distance:
        sourceConnectorLength +
        firstEdgeMetrics.length +
        firstArrivalLength +
        secondDepartureLength +
        secondEdgeMetrics.length / 2,
      point: await geometryScreenPoint(secondEdge, 0.5),
    },
  ];

  /* oxlint-disable no-await-in-loop -- each seek must settle before measuring the next frame. */
  for (const landmark of landmarks) {
    await seek(page, seekTimeForDistance(landmark.distance, routeLength));
    await expect(marker).toBeAttached();
    expectPointsToAlign(await originScreenPoint(marker), landmark.point, landmarkTolerance);
  }

  const positions: ScreenPoint[] = [];
  for (let timeMs = 0; timeMs <= 1000; timeMs += 20) {
    await seek(page, timeMs);
    await expect(marker).toBeAttached();
    positions.push(await originScreenPoint(marker));
  }
  /* oxlint-enable no-await-in-loop */

  const displacements = positions.slice(1).map((point, index) => {
    const previous = positions[index];
    return previous ? pointDistance(previous, point) : 0;
  });
  const expectedStepDistance = routeLength / 50;
  expect(Math.max(...displacements)).toBeLessThanOrEqual(expectedStepDistance * 1.75 + 1.5);
  const completedPosition = positions.at(-1);
  if (!completedPosition) throw new Error('Expected a completed marker position.');
  expectPointsToAlign(completedPosition, destinationCenter);

  const middleTimeMs = seekTimeForDistance(
    sourceConnectorLength + firstEdgeMetrics.length + firstArrivalLength,
    routeLength,
  );
  const callout = page.locator('[data-mermotion-marker-callout]');
  const relativeOffsets: ScreenPoint[] = [];
  const placements: string[] = [];
  /* oxlint-disable no-await-in-loop -- each seek must settle before measuring the next frame. */
  for (const timeMs of [middleTimeMs - 30, middleTimeMs, middleTimeMs + 30]) {
    await seek(page, timeMs);
    const [markerPoint, calloutBox, placement] = await Promise.all([
      originScreenPoint(marker),
      callout.boundingBox(),
      callout.getAttribute('data-callout-placement'),
    ]);
    if (!calloutBox || !placement) throw new Error('Expected a stable marker callout.');
    relativeOffsets.push({
      x: calloutBox.x + calloutBox.width / 2 - markerPoint.x,
      y: calloutBox.y + calloutBox.height / 2 - markerPoint.y,
    });
    placements.push(placement);
  }
  /* oxlint-enable no-await-in-loop */
  const initialOffset = relativeOffsets[0];
  if (!initialOffset) throw new Error('Expected sampled marker callout offsets.');
  for (const offset of relativeOffsets.slice(1)) {
    expect(pointDistance(offset, initialOffset)).toBeLessThanOrEqual(1);
  }
  expect(new Set(placements).size).toBe(1);
});

test('keeps a trace overlay aligned with its rendered source edge', async ({ page }) => {
  await useRouteFixture(page, 'trace');
  await seek(page, 500);

  const sourceEdge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const trace = page.locator('[data-mermotion-trace]').first();
  await expect(trace).toBeAttached();

  const comparisons = await Promise.all(
    [0, 0.5, 1].map(async (progress) => ({
      sourcePoint: await geometryScreenPoint(sourceEdge, progress),
      tracePoint: await geometryScreenPoint(trace, progress),
    })),
  );
  for (const { sourcePoint, tracePoint } of comparisons) {
    expectPointsToAlign(tracePoint, sourcePoint);
  }
});

test('layers a trace glow and keeps one leading cap on the drawn route', async ({ page }) => {
  await useRouteFixture(page, 'trace');
  await seek(page, 500);

  const sourceEdge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const core = page.locator('[data-mermotion-trace]').first();
  const glow = page.locator('[data-mermotion-trace-layer="glow"]');
  const cap = page.locator('[data-mermotion-trace-cap]');
  await expect(core).toHaveCount(1);
  await expect(glow).toHaveCount(1);
  await expect(cap).toHaveCount(1);
  await expect(core).toHaveAttribute('pathLength', '1');
  await expect(glow).toHaveAttribute('pathLength', '1');
  await expect(core).toHaveAttribute('stroke-dasharray', '1');
  await expect(glow).toHaveAttribute('stroke-dasharray', '1');
  await expect(core).not.toHaveAttribute('vector-effect', 'non-scaling-stroke');
  await expect(glow).not.toHaveAttribute('vector-effect', 'non-scaling-stroke');
  expect(await traceRemainingRatio(core)).toBeCloseTo(0.5, 2);
  expect(await traceRemainingRatio(glow)).toBeCloseTo(0.5, 2);
  expect(await isStrokePaintedAt(core, 0.25)).toBe(true);
  expect(await isStrokePaintedAt(core, 0.75)).toBe(false);

  const comparisons = await Promise.all(
    [0, 0.5, 1].map(async (progress) => ({
      core: await geometryScreenPoint(core, progress),
      glow: await geometryScreenPoint(glow, progress),
      source: await geometryScreenPoint(sourceEdge, progress),
    })),
  );
  for (const comparison of comparisons) {
    expectPointsToAlign(comparison.core, comparison.source);
    expectPointsToAlign(comparison.glow, comparison.source);
  }
  expectPointsToAlign(await centerScreenPoint(cap), await geometryScreenPoint(sourceEdge, 0.5));

  await seek(page, 250);
  expect(await traceRemainingRatio(core)).toBeCloseTo(0.75, 2);
  expectPointsToAlign(await centerScreenPoint(cap), await geometryScreenPoint(core, 0.25));
  await seek(page, 750);
  expect(await traceRemainingRatio(core)).toBeCloseTo(0.25, 2);
  expectPointsToAlign(await centerScreenPoint(cap), await geometryScreenPoint(core, 0.75));
});

test('hides decorative motion under reduced motion while preserving the marker position', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByText('semantic targets')).toBeVisible();
  await expect(page.getByText('Preview current')).toBeVisible();
  await useRouteFixture(page, 'move');
  await seek(page, 500);

  const marker = page.locator('[data-marker-id="request"]');
  const tailCore = page.locator('[data-mermotion-tail="core"]');
  const decorations = page.locator(
    '[data-mermotion-marker-decoration="request"] :is([data-mermotion-tail], [data-mermotion-arrival])',
  );
  await expect(marker).toBeAttached();
  await expect(decorations).toHaveCount(3);

  await seek(page, 10);
  const occupancy = page.locator('[data-mermotion-marker-occupancy]');
  const core = page.locator('[data-mermotion-marker-core]');
  await expect(occupancy).toHaveCount(0);
  await expect(core).toHaveAttribute('visibility', 'visible');

  await seek(page, 500);
  const routeProgress = Number(await marker.getAttribute('data-route-progress'));
  expectPointsToAlign(
    await originScreenPoint(marker),
    await geometryScreenPoint(tailCore, routeProgress),
  );

  expect(
    await decorations.evaluateAll((elements) =>
      elements.every(
        (element) =>
          element.getAttribute('visibility') === 'hidden' ||
          Number.parseFloat(getComputedStyle(element).opacity) <= 0.001,
      ),
    ),
  ).toBe(true);
  const markerVisual = await computedSvgVisual(marker);
  expect(markerVisual.visibility).not.toBe('hidden');
  expect(markerVisual.opacity).toBeGreaterThan(0);
});

test('keeps the signal bead screen-sized when preview zoom changes', async ({ page }) => {
  await useRouteFixture(page, 'move');
  await seek(page, 500);

  const core = page.locator('[data-mermotion-marker-core]');
  const calloutText = page.locator('[data-mermotion-marker-callout] text');
  const tailCore = page.locator('[data-mermotion-tail="core"]');
  const initialCore = await core.boundingBox();
  const initialText = await calloutText.boundingBox();
  const initialTailMetrics = await geometryScreenMetrics(tailCore);
  const [, , initialTailDash] = ((await tailCore.getAttribute('stroke-dasharray')) ?? '')
    .split(/\s+/)
    .map(Number);
  if (!initialCore || !initialText) throw new Error('Expected a visible marker and callout.');

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await settleMotionFrame(page);

  const zoomedCore = await core.boundingBox();
  const zoomedText = await calloutText.boundingBox();
  const zoomedTailMetrics = await geometryScreenMetrics(tailCore);
  const [, , zoomedTailDash] = ((await tailCore.getAttribute('stroke-dasharray')) ?? '')
    .split(/\s+/)
    .map(Number);
  if (!zoomedCore || !zoomedText) throw new Error('Expected the marker and callout after zooming.');
  expect(Math.abs(zoomedCore.width - initialCore.width)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(zoomedCore.height - initialCore.height)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(zoomedText.height - initialText.height)).toBeLessThanOrEqual(0.75);
  expect((initialTailDash ?? 0) * initialTailMetrics.length).toBeCloseTo(19, 0);
  expect((zoomedTailDash ?? 0) * zoomedTailMetrics.length).toBeCloseTo(19, 0);
});

test('keeps cyclic marker motion direction-correct through a reverse and repeated edge', async ({
  page,
}) => {
  await useRouteFixture(page, 'move', cyclicRouteDiagram, 'A --> B --> A --> B');
  const marker = page.locator('[data-marker-id="request"]');
  const decoration = page.locator('[data-mermotion-marker-decoration="request"]');
  const tailCore = decoration.locator('[data-mermotion-tail="core"]');
  const nodeA = page
    .locator('[data-mermotion-target="node:A"][data-mermotion-effect-root]')
    .first();
  const nodeB = page
    .locator('[data-mermotion-target="node:B"][data-mermotion-effect-root]')
    .first();
  const forwardEdge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const reverseEdge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:B-->A#1"][data-mermotion-effect-root]',
    )
    .first();
  const [centerA, centerB, forwardMetrics, reverseMetrics] = await Promise.all([
    centerScreenPoint(nodeA),
    centerScreenPoint(nodeB),
    geometryScreenMetrics(forwardEdge),
    geometryScreenMetrics(reverseEdge),
  ]);
  const orientedForward = orientFrom(centerA, forwardMetrics);
  const orientedReverse = orientFrom(centerB, reverseMetrics);
  const forwardStartConnector = pointDistance(centerA, orientedForward.start);
  const forwardEndConnector = pointDistance(orientedForward.end, centerB);
  const reverseStartConnector = pointDistance(centerB, orientedReverse.start);
  const reverseEndConnector = pointDistance(orientedReverse.end, centerA);
  const forwardLegLength = forwardStartConnector + forwardMetrics.length + forwardEndConnector;
  const reverseLegLength = reverseStartConnector + reverseMetrics.length + reverseEndConnector;
  const routeLength = forwardLegLength * 2 + reverseLegLength;
  const tolerance = routeLength * 0.005 + 1.5;

  const reverseProgress = 0.3;
  const reverseDistance =
    forwardLegLength + reverseStartConnector + reverseMetrics.length * reverseProgress;
  await seek(page, seekTimeForDistance(reverseDistance, routeLength));
  await expect(marker).toBeAttached();
  const reverseMarkerPoint = await originScreenPoint(marker);
  const expectedReversePoint = await geometryScreenPoint(
    reverseEdge,
    orientedGeometryProgress(centerB, reverseMetrics, reverseProgress),
  );
  const reverseRouteProgress = Number(await marker.getAttribute('data-route-progress'));
  expectPointsToAlign(reverseMarkerPoint, expectedReversePoint, tolerance);
  expectPointsToAlign(
    await geometryScreenPoint(tailCore, reverseRouteProgress),
    reverseMarkerPoint,
    tolerance,
  );
  expectDirectionsToAlign(
    await geometryScreenPoint(tailCore, Math.max(0, reverseRouteProgress - 0.02)),
    reverseMarkerPoint,
    await geometryScreenPoint(
      reverseEdge,
      orientedGeometryProgress(centerB, reverseMetrics, reverseProgress - 0.05),
    ),
    expectedReversePoint,
  );

  await page.evaluate(() => {
    const elements = [
      document.querySelector('[data-mermotion-marker-decoration="request"]'),
      document.querySelector('[data-marker-id="request"]'),
      document.querySelector('[data-mermotion-tail="soft"]'),
      document.querySelector('[data-mermotion-tail="core"]'),
    ];
    if (elements.some((element) => !element)) throw new Error('Expected cyclic marker visuals.');
    Reflect.set(window, '__e2eCyclicMarkerVisuals', elements);
  });

  const secondForwardProgress = 0.35;
  const secondForwardDistance =
    forwardLegLength +
    reverseLegLength +
    forwardStartConnector +
    forwardMetrics.length * secondForwardProgress;
  await seek(page, seekTimeForDistance(secondForwardDistance, routeLength));
  const repeatedForwardMarkerPoint = await originScreenPoint(marker);
  const expectedForwardPoint = await geometryScreenPoint(
    forwardEdge,
    orientedGeometryProgress(centerA, forwardMetrics, secondForwardProgress),
  );
  const forwardRouteProgress = Number(await marker.getAttribute('data-route-progress'));
  expectPointsToAlign(repeatedForwardMarkerPoint, expectedForwardPoint, tolerance);
  expectPointsToAlign(
    await geometryScreenPoint(tailCore, forwardRouteProgress),
    repeatedForwardMarkerPoint,
    tolerance,
  );
  expectDirectionsToAlign(
    await geometryScreenPoint(tailCore, Math.max(0, forwardRouteProgress - 0.02)),
    repeatedForwardMarkerPoint,
    await geometryScreenPoint(
      forwardEdge,
      orientedGeometryProgress(centerA, forwardMetrics, secondForwardProgress - 0.05),
    ),
    expectedForwardPoint,
  );
  expect(
    await page.evaluate(() => {
      const retained = Reflect.get(window, '__e2eCyclicMarkerVisuals');
      if (!Array.isArray(retained)) return false;
      const current = [
        document.querySelector('[data-mermotion-marker-decoration="request"]'),
        document.querySelector('[data-marker-id="request"]'),
        document.querySelector('[data-mermotion-tail="soft"]'),
        document.querySelector('[data-mermotion-tail="core"]'),
      ];
      return retained.every((element, index) => element === current[index]);
    }),
  ).toBe(true);

  const repeatedLegStartTime = seekTimeForDistance(
    forwardLegLength + reverseLegLength,
    routeLength,
  );
  await seek(page, repeatedLegStartTime);
  expectPointsToAlign(await originScreenPoint(marker), centerA, tolerance);
  await seek(page, repeatedLegStartTime + 10);
  expect(pointDistance(await originScreenPoint(marker), centerA)).toBeLessThanOrEqual(
    routeLength * 0.015 + 1.5,
  );
});

test('retains distinct trace clones when a cyclic route uses the same edge twice', async ({
  page,
}) => {
  await useRouteFixture(page, 'trace', cyclicRouteDiagram, 'A --> B --> A --> B');
  const forwardEdge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const reverseEdge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:B-->A#1"][data-mermotion-effect-root]',
    )
    .first();
  const forwardLength = (await geometryScreenMetrics(forwardEdge)).length;
  const reverseLength = (await geometryScreenMetrics(reverseEdge)).length;
  const totalLength = forwardLength * 2 + reverseLength;
  const inspectionTimeMs = seekTimeForDistance(forwardLength + reverseLength / 2, totalLength);

  await seek(page, inspectionTimeMs);
  const repeatedForwardTraces = page.locator('[data-mermotion-trace-source="edge:A-->B#1"]');
  const firstForwardTrace = page.locator('[data-mermotion-trace="cue-2:0:edge:A-->B#1"]');
  const reverseTrace = page.locator('[data-mermotion-trace="cue-2:1:edge:B-->A#1"]');
  const secondForwardTrace = page.locator('[data-mermotion-trace="cue-2:2:edge:A-->B#1"]');
  await expect(repeatedForwardTraces).toHaveCount(2);
  await expect(firstForwardTrace).toHaveCount(1);
  await expect(reverseTrace).toHaveCount(1);
  await expect(secondForwardTrace).toHaveCount(1);

  const [firstRemaining, reverseRemaining, secondRemaining] = await Promise.all([
    traceRemainingRatio(firstForwardTrace),
    traceRemainingRatio(reverseTrace),
    traceRemainingRatio(secondForwardTrace),
  ]);
  expect(firstRemaining).toBeLessThanOrEqual(0.03);
  expect(reverseRemaining).toBeGreaterThan(0.4);
  expect(reverseRemaining).toBeLessThan(0.6);
  expect(secondRemaining).toBeGreaterThanOrEqual(0.97);

  await page.evaluate(() => {
    const traces = [
      document.querySelector('[data-mermotion-trace="cue-2:0:edge:A-->B#1"]'),
      document.querySelector('[data-mermotion-trace="cue-2:1:edge:B-->A#1"]'),
      document.querySelector('[data-mermotion-trace="cue-2:2:edge:A-->B#1"]'),
    ];
    if (traces.some((trace) => !trace)) throw new Error('Expected three cyclic trace clones.');
    Reflect.set(window, '__e2eCyclicTraces', traces);
  });
  await seek(page, Math.min(inspectionTimeMs + 20, 980));
  expect(
    await page.evaluate(() => {
      const retained = Reflect.get(window, '__e2eCyclicTraces');
      if (!Array.isArray(retained)) return false;
      const current = [
        document.querySelector('[data-mermotion-trace="cue-2:0:edge:A-->B#1"]'),
        document.querySelector('[data-mermotion-trace="cue-2:1:edge:B-->A#1"]'),
        document.querySelector('[data-mermotion-trace="cue-2:2:edge:A-->B#1"]'),
      ];
      return (
        retained.length === current.length &&
        retained.every((trace, index) => trace === current[index])
      );
    }),
  ).toBe(true);
});

test('keeps Mermaid frontmatter as the source of diagram themes', async ({ page }) => {
  const renderedDiagram = page.locator('.mermaid-stage svg');
  const initialRenderId = await renderedDiagram.getAttribute('id');
  expect(initialRenderId).toBeTruthy();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByLabel('Mermaid diagram theme').selectOption('forest');
  await expect(renderedDiagram).not.toHaveAttribute('id', initialRenderId!);
  await page
    .getByRole('dialog', { name: 'Appearance' })
    .getByRole('button', { name: 'Close Appearance' })
    .click();
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await expect(page.getByLabel('Edit diagram.mmd')).toHaveValue(/theme: forest/);
  await expect(page.getByText('Render failed')).toHaveCount(0);
});

test('selects a semantic connection and authors motion without changing Mermaid', async ({
  page,
}) => {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  const diagramEditor = page.getByLabel('Edit diagram.mmd');
  const originalDiagram = await diagramEditor.inputValue();

  await page
    .locator('rect[data-mermotion-hit-area][data-mermotion-target="edge:brief-->render#1"]')
    .click();
  await expect(page.locator('.target-hud')).toBeVisible();

  await page.getByRole('button', { name: 'Animate' }).click();
  const motionEditor = page.getByLabel('Edit diagram.motion');
  await expect(motionEditor).toBeVisible();
  await expect(motionEditor).toHaveValue(/at 0ms trace brief --> render over 500ms/);
  await expect(motionEditor).not.toHaveValue(/L_brief_render_/);

  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await expect(diagramEditor).toHaveValue(originalDiagram);
});

test('authors the short canonical pulse form for a selected node', async ({ page }) => {
  await page.locator('[data-mermotion-target="node:cue"]').first().click();
  await expect(page.locator('.target-hud')).toBeVisible();

  await page.getByRole('button', { name: 'Animate' }).click();
  const motionEditor = page.getByLabel('Edit diagram.motion');
  await expect(motionEditor).toHaveValue(/at 0ms pulse cue for 500ms/);
  await expect(motionEditor).not.toHaveValue(/pulse node cue/);
});

test('samples motion at the scrubbed timestamp', async ({ page }) => {
  const target = page.locator('[data-mermotion-target="node:cue"]').first();
  await expect(target).not.toHaveAttribute('style', /drop-shadow/);

  await page.getByLabel('Seek animation').fill('2500');
  await expect(target).toHaveAttribute('style', /drop-shadow/);
  await expect(page.getByLabel('Current time')).toHaveText('00:02.50');
});

test('seeks to a cue from its timeline block', async ({ page }) => {
  const pulseCue = page.getByRole('button', { name: /pulse cue, starts 00:02\.25/ });
  await pulseCue.click();
  await expect(pulseCue).toHaveClass(/is-selected/);
  await expect(page.getByLabel('Current time')).toHaveText('00:02.25');
});

test('keeps the last valid preview when Mermaid editing fails', async ({ page }) => {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await expect(page.getByText('Write Mermaid', { exact: true })).toBeVisible();

  await page.getByLabel('Edit diagram.mmd').fill('this is not Mermaid');
  await expect(page.getByText('Render failed')).toBeVisible();
  await expect(page.getByText('Preview held at the last valid state')).toBeVisible();
  await expect(page.getByText('Write Mermaid', { exact: true })).toBeVisible();
});

test('restores Mermaid and motion drafts from local storage after reload', async ({ page }) => {
  const diagram = 'flowchart LR\n  api[API] --> db[(Database)]\n';
  const motion = 'motionDiagram-v1\n  pulse node api for 500ms\n';

  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(diagram);
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(motion);
  await expect(page.getByText('Saving locally')).toBeVisible();
  await expect(page.getByText('Saved locally')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Preview current')).toBeVisible();
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await expect(page.getByLabel('Edit diagram.mmd')).toHaveValue(diagram);
  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await expect(page.getByLabel('Edit diagram.motion')).toHaveValue(motion);
});

test('binds repeated sequence messages by semantic occurrence', async ({ page }) => {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(`sequenceDiagram
  participant Worker
  participant API
  Worker->>API: GET /status
  API-->>Worker: 200 OK
  Worker->>API: GET /status
`);

  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  reveal messages every 600ms
  pulse participant API for 400ms
  pulse message Worker->>API: "GET /status" occurrence 2 for 300ms
`);

  await expect(page.locator('.target-count')).toHaveText('6');
  await expect(page.locator('[data-mermotion-target="participant:API"]').first()).toBeVisible();
  await expect(
    page.locator('[data-mermotion-target="message:Worker->>API:GET /status#2"]').first(),
  ).toBeVisible();
  await expect(page.getByText('Source and motion agree')).toBeVisible();
});

test('animates a marker and trace along one unique sequence message', async ({ page }) => {
  await page.getByRole('tab', { name: /diagram\.mmd/ }).click();
  await page.getByLabel('Edit diagram.mmd').fill(`sequenceDiagram
  participant Worker
  participant API
  Worker->>API: GET /status
`);

  const message = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="message:Worker->>API:GET /status#1"][data-mermotion-effect-root]',
    )
    .first();
  const worker = page
    .locator('[data-mermotion-target="participant:Worker"][data-mermotion-effect-root]')
    .first();
  const api = page
    .locator('[data-mermotion-target="participant:API"][data-mermotion-effect-root]')
    .first();
  await expect(message).toBeAttached();

  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await page.getByLabel('Edit diagram.motion').fill(`motionDiagram-v1
  marker request as "Request" shape dot
  at 0ms move request along Worker --> API over 1s easing linear
  with trace Worker --> API over 1s easing linear
`);
  await expect(page.locator('.diagnostic-line')).toHaveCount(0);
  await expect(page.getByText('Source and motion agree')).toBeVisible();

  const [workerCenter, apiCenter, messageMetrics] = await Promise.all([
    centerScreenPoint(worker),
    centerScreenPoint(api),
    geometryScreenMetrics(message),
  ]);
  const orientedMessage = orientFrom(workerCenter, messageMetrics);

  await seek(page, 500);
  const marker = page.locator('[data-marker-id="request"]');
  const trace = page.locator('[data-mermotion-trace]').first();
  const traceCap = page.locator('[data-mermotion-trace-cap]').first();
  await expect(marker).toHaveAttribute('data-marker-phase', 'moving');
  await expect(trace).toBeAttached();
  await expect(traceCap).toBeVisible();

  const messageMidpoint = await geometryScreenPoint(message, 0.5);
  expectPointsToAlign(await originScreenPoint(marker), messageMidpoint);
  expect(await traceRemainingRatio(trace)).toBeCloseTo(0.5, 2);
  expectPointsToAlign(await centerScreenPoint(traceCap), messageMidpoint);
  const traceStart = await geometryScreenPoint(trace, 0);
  const traceMidpoint = await geometryScreenPoint(trace, 0.5);
  expectPointsToAlign(traceStart, orientedMessage.start);
  expectPointsToAlign(traceMidpoint, messageMidpoint);
  expectDirectionsToAlign(traceStart, traceMidpoint, workerCenter, apiCenter);

  await seek(page, 1000);
  await expect(marker).toHaveAttribute('data-marker-phase', 'arriving');
  const arrival = await originScreenPoint(marker);
  expectPointsToAlign(arrival, orientedMessage.end);
  expect(pointDistance(arrival, apiCenter)).toBeLessThan(pointDistance(arrival, workerCenter));
});

test('opens the command palette from the keyboard', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect(page.getByRole('dialog', { name: 'Mermotion commands' })).toBeVisible();
  await page.getByPlaceholder('Type a command or search…').fill('source bundle');
  await expect(page.getByText('Download source bundle')).toBeVisible();
});

test('browses canonical syntax as an accessible source view without changing files', async ({
  page,
}) => {
  const diagramEditor = page.getByLabel('Edit diagram.mmd');
  const motionEditor = page.getByLabel('Edit diagram.motion');
  const originalDiagram = await diagramEditor.inputValue();
  const originalMotion = await motionEditor.inputValue();
  const motionTab = page.getByRole('tab', { name: /diagram\.motion/ });
  const syntaxTab = page.getByRole('tab', { name: 'Syntax', exact: true });

  await motionTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(syntaxTab).toBeFocused();
  await expect(syntaxTab).toHaveAttribute('aria-selected', 'true');
  await expect(syntaxTab).toHaveAttribute('aria-controls', 'motion-syntax-reference');

  const syntaxPanel = page.getByRole('tabpanel', { name: 'Syntax' });
  await expect(syntaxPanel).toBeVisible();
  await expect(syntaxPanel).toHaveAttribute('aria-labelledby', 'source-tab-syntax');

  await syntaxTab.press('Home');
  await expect(page.getByRole('tab', { name: /diagram\.mmd/ })).toBeFocused();
  await page.getByRole('tab', { name: /diagram\.mmd/ }).press('End');
  await expect(syntaxTab).toBeFocused();

  await page.getByLabel('Search motion syntax').fill('occurrence');
  await expect(page.getByText('Repeated message', { exact: true })).toBeVisible();
  await expect(page.getByText('Highlight a node')).toHaveCount(0);
  const copyMessage = page.getByRole('button', { name: 'Copy repeated message syntax' });
  await copyMessage.click();
  await expect(copyMessage).toContainText('Copied');
  await expect(page.getByText('Copied to clipboard')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mermaid diagram syntax' })).toHaveAttribute(
    'href',
    'https://mermaid.js.org/intro/syntax-reference.html',
  );
  await expect(page.getByRole('link', { name: 'Mermaid diagram syntax' })).toHaveAttribute(
    'target',
    '_blank',
  );

  expect(await diagramEditor.inputValue()).toBe(originalDiagram);
  expect(await motionEditor.inputValue()).toBe(originalMotion);
});

test('opens syntax from commands and inserts after the current motion statement', async ({
  page,
}) => {
  const diagramEditor = page.getByLabel('Edit diagram.mmd');
  const motionEditor = page.getByLabel('Edit diagram.motion');
  const originalDiagram = await diagramEditor.inputValue();

  await page.keyboard.press('ControlOrMeta+KeyK');
  await page.getByPlaceholder('Type a command or search…').fill('docs');
  await page.getByText('Open syntax reference').click();
  await expect(page.getByRole('tabpanel', { name: 'Syntax' })).toBeFocused();

  await page.getByRole('tab', { name: /diagram\.motion/ }).click();
  await motionEditor.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement)) throw new Error('Expected a textarea.');
    const statement = 'at 0ms highlight brief';
    const position = element.value.indexOf(statement) + 7;
    element.focus();
    element.setSelectionRange(position, position);
    element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.keyboard.press('ControlOrMeta+Slash');
  await expect(page.getByRole('tabpanel', { name: 'Syntax' })).toBeFocused();

  await page.getByLabel('Search motion syntax').fill('highlight');
  await page.getByRole('button', { name: 'Insert highlight a node example' }).click();

  await expect(motionEditor).toBeFocused();
  await expect(motionEditor).toHaveValue(
    /at 0ms highlight brief\n  highlight brief\n  at 450ms move/,
  );
  await expect(page.getByText('Source and motion agree')).toBeVisible();

  await motionEditor.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement)) throw new Error('Expected a textarea.');
    const position = element.value.indexOf('duration') + 3;
    element.focus();
    element.setSelectionRange(position, position);
    element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.keyboard.press('ControlOrMeta+Slash');
  await page.getByLabel('Search motion syntax').fill('move marker');
  await page.getByRole('button', { name: 'Insert move a marker example' }).click();

  await expect(motionEditor).toHaveValue(
    /marker request as "Request"\n  marker request2 as "Request 2"\n  move request2 along brief --> render over 1\.8s\n\n  at 0ms/,
  );
  await expect(page.getByText('Source and motion agree')).toBeVisible();
  expect(await diagramEditor.inputValue()).toBe(originalDiagram);
});

test('does not offer stale syntax targets after a diagram render fails', async ({ page }) => {
  const diagramTab = page.getByRole('tab', { name: /diagram\.mmd/ });
  const syntaxTab = page.getByRole('tab', { name: 'Syntax', exact: true });
  const diagramEditor = page.getByLabel('Edit diagram.mmd');

  await diagramTab.click();
  await diagramEditor.fill(`flowchart LR
  fresh[Fresh] --> done[Done]
`);
  await expect(page.locator('[data-mermotion-target="node:fresh"]').first()).toBeVisible();

  await syntaxTab.click();
  await page.getByLabel('Search motion syntax').fill('highlight');
  const highlightEntry = page.locator('.syntax-entry').filter({ hasText: 'Highlight a node' });
  await expect(highlightEntry.locator('code')).toHaveText('highlight fresh');
  await expect(
    highlightEntry.getByRole('button', {
      exact: true,
      name: 'Insert highlight a node example in diagram.motion',
    }),
  ).toBeVisible();

  await diagramTab.click();
  await diagramEditor.fill('this is not Mermaid');
  await expect(page.getByText('Render failed')).toBeVisible();
  await expect(page.getByText('Preview held at the last valid state')).toBeVisible();
  await expect(page.locator('[data-mermotion-target="node:fresh"]').first()).toBeVisible();
  await expect(page.getByText('Fix Mermaid source to refresh selectable targets')).toBeVisible();

  await syntaxTab.click();
  await page.getByLabel('Search motion syntax').fill('highlight');
  await expect(highlightEntry.locator('code')).toHaveText('highlight client');
  await expect(highlightEntry.locator('code')).not.toContainText('fresh');
  await expect(
    highlightEntry.getByRole('button', {
      exact: true,
      name: 'Insert highlight a node example in diagram.motion',
    }),
  ).toHaveCount(0);
});

for (const width of [320, 390]) {
  test(`keeps the syntax reference usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.getByRole('button', { name: 'source', exact: true }).click();
    await page.getByRole('tab', { name: 'Syntax', exact: true }).click();

    await expect(page.getByRole('tabpanel', { name: 'Syntax' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const syntaxTabBox = await page.getByRole('tab', { name: 'Syntax', exact: true }).boundingBox();
    const sourceHeadingBox = await page.locator('.source-heading').boundingBox();
    expect(syntaxTabBox).not.toBeNull();
    expect(sourceHeadingBox).not.toBeNull();
    expect(syntaxTabBox!.x + syntaxTabBox!.width).toBeLessThanOrEqual(
      sourceHeadingBox!.x + sourceHeadingBox!.width + 1,
    );

    const referenceScroll = page.locator('.syntax-reference-scroll');
    const metrics = await referenceScroll.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    await referenceScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await referenceScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });
}

test('uses tabbed workbench regions on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Workspace regions' })).toBeVisible();
  await page.getByRole('button', { name: 'source', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Source' })).toBeVisible();
  await page.getByRole('button', { name: 'timeline', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
});
