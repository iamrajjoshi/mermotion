export interface SvgPoint {
  x: number;
  y: number;
}

export interface SvgBounds extends SvgPoint {
  height: number;
  width: number;
}

function finitePoint(point: SvgPoint): SvgPoint | undefined {
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
}

export function pointInSvgSpace(
  svg: SVGSVGElement,
  source: SVGGraphicsElement,
  sourcePoint: SvgPoint,
): SvgPoint | undefined {
  try {
    const sourceMatrix = source.getScreenCTM();
    const svgMatrix = svg.getScreenCTM();
    if (!sourceMatrix || !svgMatrix) return undefined;
    const point = svg.createSVGPoint();
    point.x = sourcePoint.x;
    point.y = sourcePoint.y;
    const screenPoint = point.matrixTransform(sourceMatrix);
    const localPoint = screenPoint.matrixTransform(svgMatrix.inverse());
    return finitePoint({ x: localPoint.x, y: localPoint.y });
  } catch {
    return undefined;
  }
}

export function screenScale(svg: SVGSVGElement): number {
  const matrix = svg.getScreenCTM();
  if (!matrix) return 1;
  const horizontal = Math.hypot(matrix.a, matrix.b);
  const vertical = Math.hypot(matrix.c, matrix.d);
  const scale = Math.sqrt(horizontal * vertical);
  return Number.isFinite(scale) && scale > 0.001 ? scale : 1;
}

export function transformedElementBounds(
  svg: SVGSVGElement,
  element: SVGGraphicsElement,
): SvgBounds | undefined {
  try {
    const box = element.getBBox();
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x, y: box.y + box.height },
      { x: box.x + box.width, y: box.y + box.height },
    ]
      .map((point) => pointInSvgSpace(svg, element, point))
      .filter((point): point is SvgPoint => point !== undefined);
    if (corners.length !== 4) return undefined;
    const xs = corners.map(({ x }) => x);
    const ys = corners.map(({ y }) => y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { height: Math.max(...ys) - y, width: Math.max(...xs) - x, x, y };
  } catch {
    return undefined;
  }
}
