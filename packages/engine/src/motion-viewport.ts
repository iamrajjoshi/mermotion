import { screenScale, transformedElementBounds, type SvgBounds } from './svg-geometry.js';
import { applyFrameToSvg } from './targets.js';
import type { FrameState, FrameTargetState, SemanticTarget } from './types.js';

const maxSettlementIterations = 12;
const settlementTolerancePx = 0.01;
const overlayPaintOverflowPx = 4;
const gaussianExtent = 3;
const antialiasAllowancePx = 1;

export type MotionViewportBounds = SvgBounds;

export type MotionViewportDimensions = Pick<SvgBounds, 'height' | 'width'>;

export interface SettleMotionViewportOptions {
  fit: (bounds: MotionViewportBounds) => MotionViewportDimensions;
  resize: (dimensions: MotionViewportDimensions) => void;
  sample: (timeMs: number) => FrameState;
  throwIfCanceled?: () => void;
}

export interface SettledMotionViewport {
  bounds: MotionViewportBounds;
  dimensions: MotionViewportDimensions;
  iterations: number;
}

function finiteBounds(bounds: MotionViewportBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

function finiteElementBounds(bounds: MotionViewportBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width >= 0 &&
    bounds.height >= 0
  );
}

function viewBoxBounds(svg: SVGSVGElement): MotionViewportBounds {
  const { height, width, x, y } = svg.viewBox.baseVal;
  const bounds = { height, width, x, y };
  if (!finiteBounds(bounds)) throw new Error('The rendered diagram has no exportable dimensions.');
  return bounds;
}

function right(bounds: MotionViewportBounds): number {
  return bounds.x + bounds.width;
}

function bottom(bounds: MotionViewportBounds): number {
  return bounds.y + bounds.height;
}

function unionBounds(
  left: MotionViewportBounds,
  rightBounds: MotionViewportBounds,
): MotionViewportBounds {
  const x = Math.min(left.x, rightBounds.x);
  const y = Math.min(left.y, rightBounds.y);
  const maximumX = Math.max(right(left), right(rightBounds));
  const maximumY = Math.max(bottom(left), bottom(rightBounds));
  return { height: maximumY - y, width: maximumX - x, x, y };
}

function expandedBounds(bounds: MotionViewportBounds, amount: number): MotionViewportBounds {
  return {
    height: bounds.height + amount * 2,
    width: bounds.width + amount * 2,
    x: bounds.x - amount,
    y: bounds.y - amount,
  };
}

function elementBounds(
  svg: SVGSVGElement,
  element: SVGGraphicsElement,
): MotionViewportBounds | undefined {
  const bounds = transformedElementBounds(svg, element);
  return bounds && finiteElementBounds(bounds) ? bounds : undefined;
}

export function effectPaintOverflowPixels(
  state: Pick<FrameTargetState, 'highlight' | 'pulse' | 'visible'>,
): number {
  if (!state.visible) return 0;
  const effect = Math.max(state.highlight, state.pulse);
  if (effect <= 0.001) return 0;
  if (state.pulse > state.highlight) {
    const innerDeviation = 1 + state.pulse * 2;
    const outerDeviation = 3 + state.pulse * 5;
    return Math.ceil(gaussianExtent * (innerDeviation + outerDeviation) + antialiasAllowancePx);
  }
  return Math.ceil(gaussianExtent * (1 + effect * 2.5) + antialiasAllowancePx);
}

function frameBounds(
  svg: SVGSVGElement,
  targets: SemanticTarget[],
  frame: FrameState,
  minimum: MotionViewportBounds,
): MotionViewportBounds {
  applyFrameToSvg(svg, targets, frame, { reducedMotion: false });
  const scale = screenScale(svg);
  let bounds = minimum;
  const geometry = elementBounds(svg, svg);
  if (geometry) bounds = unionBounds(bounds, geometry);

  const overlay = svg.querySelector('[data-mermotion-overlay]');
  if (typeof SVGGraphicsElement !== 'undefined' && overlay instanceof SVGGraphicsElement) {
    const overlayBounds = elementBounds(svg, overlay);
    if (overlayBounds) {
      bounds = unionBounds(bounds, expandedBounds(overlayBounds, overlayPaintOverflowPx / scale));
    }
  }

  const effectRoots = [svg, ...svg.querySelectorAll('[data-mermotion-effect-root]')];
  for (const element of effectRoots) {
    if (typeof SVGGraphicsElement === 'undefined' || !(element instanceof SVGGraphicsElement)) {
      continue;
    }
    const key = element.getAttribute('data-mermotion-target');
    const state = key ? frame.targets[key] : undefined;
    if (!state) continue;
    const overflow = effectPaintOverflowPixels(state);
    if (overflow === 0) continue;
    const effectBounds = elementBounds(svg, element);
    if (effectBounds) bounds = unionBounds(bounds, expandedBounds(effectBounds, overflow / scale));
  }
  return bounds;
}

function setViewBox(svg: SVGSVGElement, bounds: MotionViewportBounds): void {
  svg.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
}

function validateDimensions(dimensions: MotionViewportDimensions): void {
  if (
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new Error('The requested motion viewport has invalid dimensions.');
  }
}

function edgeDeltaPixels(
  current: MotionViewportBounds,
  next: MotionViewportBounds,
  scale: number,
): number {
  return (
    Math.max(
      Math.abs(current.x - next.x),
      Math.abs(current.y - next.y),
      Math.abs(right(current) - right(next)),
      Math.abs(bottom(current) - bottom(next)),
    ) * scale
  );
}

export function settleMotionViewport(
  svg: SVGSVGElement,
  targets: SemanticTarget[],
  sampleTimesMs: readonly number[],
  options: SettleMotionViewportOptions,
): SettledMotionViewport {
  if (sampleTimesMs.length === 0) throw new Error('A motion viewport needs at least one frame.');
  const minimum = viewBoxBounds(svg);
  let bounds = minimum;

  for (let iteration = 1; iteration <= maxSettlementIterations; iteration += 1) {
    options.throwIfCanceled?.();
    const dimensions = options.fit(bounds);
    validateDimensions(dimensions);
    setViewBox(svg, bounds);
    options.resize(dimensions);

    let measured = minimum;
    for (const timeMs of sampleTimesMs) {
      options.throwIfCanceled?.();
      measured = unionBounds(measured, frameBounds(svg, targets, options.sample(timeMs), minimum));
    }
    const nextBounds = unionBounds(bounds, measured);
    const nextDimensions = options.fit(nextBounds);
    validateDimensions(nextDimensions);
    const stable =
      edgeDeltaPixels(bounds, nextBounds, screenScale(svg)) <= settlementTolerancePx &&
      dimensions.width === nextDimensions.width &&
      dimensions.height === nextDimensions.height;
    bounds = nextBounds;
    if (stable) {
      setViewBox(svg, bounds);
      options.resize(nextDimensions);
      return { bounds, dimensions: nextDimensions, iterations: iteration };
    }
  }

  throw new Error('The motion viewport could not settle at the requested output size.');
}
