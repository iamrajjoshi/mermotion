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
    const dashOffset = Number.parseFloat(element.style.strokeDashoffset);
    const length = element.getTotalLength();
    if (!Number.isFinite(dashOffset) || length <= 0) {
      throw new Error('Expected measurable trace dash geometry.');
    }
    return dashOffset / length;
  });
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
  const comets = decoration.locator('[data-mermotion-comet]');
  const wakes = decoration.locator('[data-mermotion-wake]');
  const arrival = decoration.locator('[data-mermotion-arrival]');
  await expect(decoration).toHaveCount(1);
  await expect(marker).toHaveCount(1);
  await expect(comets).toHaveCount(3);
  await expect(decoration.locator('[data-mermotion-comet="glow"]')).toHaveCount(1);
  await expect(decoration.locator('[data-mermotion-comet="body"]')).toHaveCount(1);
  await expect(decoration.locator('[data-mermotion-comet="core"]')).toHaveCount(1);
  await expect(wakes).toHaveCount(2);
  await expect(decoration.locator('[data-mermotion-wake="glow"]')).toHaveCount(1);
  await expect(decoration.locator('[data-mermotion-wake="core"]')).toHaveCount(1);
  await expect(arrival).toHaveCount(1);

  const initial = await page.evaluate(() => {
    const selector = '[data-mermotion-marker-decoration="request"]';
    const root = document.querySelector(selector);
    if (!root) throw new Error('Expected a marker decoration group.');
    const elements = [
      root,
      ...root.querySelectorAll(
        '[data-marker-id], [data-mermotion-comet], [data-mermotion-wake], [data-mermotion-arrival]',
      ),
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
      ...root.querySelectorAll(
        '[data-marker-id], [data-mermotion-comet], [data-mermotion-wake], [data-mermotion-arrival]',
      ),
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

test('keeps the marker comet and active-edge wake attached to rendered geometry', async ({
  page,
}) => {
  await useRouteFixture(page, 'move');

  const edge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const marker = page.locator('[data-marker-id="request"]');
  const cometCore = page.locator('[data-mermotion-comet="core"]');
  const wakeCore = page.locator('[data-mermotion-wake="core"]');
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

  const nativeStartProgress = orientedGeometryProgress(sourceCenter, edgeMetrics, 0);
  const nativeStart = await geometryScreenPoint(edge, nativeStartProgress);
  const nativeMidpoint = await geometryScreenPoint(edge, 0.5);
  const markerPoint = await originScreenPoint(marker);

  expectPointsToAlign(markerPoint, nativeMidpoint, tolerance);
  expectPointsToAlign(await geometryScreenPoint(cometCore, 1), markerPoint);
  expectPointsToAlign(await geometryScreenPoint(wakeCore, 0), nativeStart);
  expectPointsToAlign(await geometryScreenPoint(wakeCore, 1), markerPoint, tolerance);
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
  const edge = page
    .locator(
      ':is(path, line, polyline)[data-mermotion-target="edge:A-->B#1"][data-mermotion-effect-root]',
    )
    .first();
  const decorations = page.locator(
    '[data-mermotion-marker-decoration="request"] :is([data-mermotion-comet], [data-mermotion-wake], [data-mermotion-arrival])',
  );
  await expect(marker).toBeAttached();
  await expect(decorations).toHaveCount(6);

  await seek(page, 10);
  const occupancy = page.locator('[data-mermotion-marker-occupancy]');
  const core = page.locator('[data-mermotion-marker-core]');
  await expect(occupancy).toHaveCount(1);
  await expect(occupancy).toHaveAttribute('visibility', 'hidden');
  await expect(core).toHaveAttribute('visibility', 'visible');

  await seek(page, 500);
  expectPointsToAlign(await originScreenPoint(marker), await geometryScreenPoint(edge, 0.5));

  expect(
    await decorations.evaluateAll((elements) =>
      elements.every(
        (element) =>
          element.getAttribute('visibility') === 'hidden' &&
          getComputedStyle(element).visibility === 'hidden',
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
  const initialCore = await core.boundingBox();
  const initialText = await calloutText.boundingBox();
  if (!initialCore || !initialText) throw new Error('Expected a visible marker and callout.');

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await settleMotionFrame(page);

  const zoomedCore = await core.boundingBox();
  const zoomedText = await calloutText.boundingBox();
  if (!zoomedCore || !zoomedText) throw new Error('Expected the marker and callout after zooming.');
  expect(Math.abs(zoomedCore.width - initialCore.width)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(zoomedCore.height - initialCore.height)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(zoomedText.height - initialText.height)).toBeLessThanOrEqual(0.75);
});

test('keeps cyclic marker motion direction-correct through a reverse and repeated edge', async ({
  page,
}) => {
  await useRouteFixture(page, 'move', cyclicRouteDiagram, 'A --> B --> A --> B');
  const marker = page.locator('[data-marker-id="request"]');
  const decoration = page.locator('[data-mermotion-marker-decoration="request"]');
  const cometCore = decoration.locator('[data-mermotion-comet="core"]');
  const wakeCore = decoration.locator('[data-mermotion-wake="core"]');
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
  expectPointsToAlign(reverseMarkerPoint, expectedReversePoint, tolerance);
  expectPointsToAlign(await geometryScreenPoint(cometCore, 1), reverseMarkerPoint);
  expectDirectionsToAlign(
    await geometryScreenPoint(cometCore, 0.5),
    reverseMarkerPoint,
    await geometryScreenPoint(
      reverseEdge,
      orientedGeometryProgress(centerB, reverseMetrics, reverseProgress - 0.05),
    ),
    expectedReversePoint,
  );
  expectPointsToAlign(await geometryScreenPoint(wakeCore, 0), orientedReverse.start);
  expectPointsToAlign(await geometryScreenPoint(wakeCore, 1), reverseMarkerPoint, tolerance);

  await page.evaluate(() => {
    const elements = [
      document.querySelector('[data-mermotion-marker-decoration="request"]'),
      document.querySelector('[data-marker-id="request"]'),
      document.querySelector('[data-mermotion-comet="core"]'),
      document.querySelector('[data-mermotion-wake="core"]'),
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
  expectPointsToAlign(repeatedForwardMarkerPoint, expectedForwardPoint, tolerance);
  expectPointsToAlign(await geometryScreenPoint(cometCore, 1), repeatedForwardMarkerPoint);
  expectDirectionsToAlign(
    await geometryScreenPoint(cometCore, 0.5),
    repeatedForwardMarkerPoint,
    await geometryScreenPoint(
      forwardEdge,
      orientedGeometryProgress(centerA, forwardMetrics, secondForwardProgress - 0.05),
    ),
    expectedForwardPoint,
  );
  expectPointsToAlign(await geometryScreenPoint(wakeCore, 0), orientedForward.start);
  expectPointsToAlign(
    await geometryScreenPoint(wakeCore, 1),
    repeatedForwardMarkerPoint,
    tolerance,
  );
  expect(
    await page.evaluate(() => {
      const retained = Reflect.get(window, '__e2eCyclicMarkerVisuals');
      if (!Array.isArray(retained)) return false;
      const current = [
        document.querySelector('[data-mermotion-marker-decoration="request"]'),
        document.querySelector('[data-marker-id="request"]'),
        document.querySelector('[data-mermotion-comet="core"]'),
        document.querySelector('[data-mermotion-wake="core"]'),
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
