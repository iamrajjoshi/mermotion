import type { ApplyFrameOptions, FrameMarkerState, FrameState, SemanticTarget } from './types.js';

const TARGET_ATTRIBUTE = 'data-mermotion-target';
const EFFECT_ATTRIBUTE = 'data-mermotion-effect-root';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized
    ? normalized
        .replaceAll('&quot;', '"')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
    : undefined;
}

function attributesFrom(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1];
    if (name) attributes[name] = match[2] ?? match[3] ?? '';
  }
  return attributes;
}

function flowNodeId(renderedId: string): string {
  const flowchartMarker = '-flowchart-';
  const markerIndex = renderedId.indexOf(flowchartMarker);
  const suffix =
    markerIndex >= 0
      ? renderedId.slice(markerIndex + flowchartMarker.length)
      : renderedId.replace(/^flowchart-/, '');
  return suffix.replace(/-\d+$/, '');
}

function edgeEndpoints(dataId: string, nodeIds: string[]): { from?: string; to?: string } {
  if (!dataId.startsWith('L_')) return {};
  const body = dataId.slice(2).replace(/_\d+$/, '');
  const candidates = nodeIds
    .flatMap((from) => nodeIds.map((to) => ({ from, to })))
    .filter(({ from, to }) => `${from}_${to}` === body);
  return candidates.length === 1 && candidates[0] ? candidates[0] : {};
}

function flowEdgeKey(
  from: string | undefined,
  to: string | undefined,
  id: string,
  occurrence: number,
): string {
  return from && to ? `edge:${from}-->${to}#${occurrence}` : `edge:${id}`;
}

function messageKey(
  from: string,
  arrow: string,
  to: string,
  label: string,
  occurrence: number,
): string {
  return `message:${from}${arrow}${to}:${label}#${occurrence}`;
}

function sequenceArrow(className: string, markerStart?: string, markerEnd?: string): string {
  const dashed = className.includes('messageLine1');
  const start = markerStart ?? '';
  const end = markerEnd ?? '';
  if (start.includes('arrowhead') && end.includes('arrowhead')) return dashed ? '<<-->>' : '<<->>';
  if (end.includes('crosshead')) return dashed ? '--x' : '-x';
  if (end.includes('filled-head')) return dashed ? '--)' : '-)';
  if (end.includes('arrowhead')) return dashed ? '-->>' : '->>';
  return dashed ? '-->' : '->';
}

function renumberTargets(targets: SemanticTarget[]): SemanticTarget[] {
  const sorted = [...targets].sort((left, right) => left.order - right.order);
  sorted.forEach((target, order) => {
    target.order = order;
  });
  return sorted;
}

function isElementNode(root: ParentNode): root is Element {
  return 'matches' in root && typeof root.matches === 'function';
}

function discoverFromString(svg: string, diagramType?: string): SemanticTarget[] {
  const targets: SemanticTarget[] = [
    { key: 'diagram', kind: 'diagram', id: 'diagram', label: diagramType ?? 'Diagram', order: 0 },
  ];
  const nodes: Array<{ index: number; id: string; label?: string }> = [];
  for (const match of svg.matchAll(
    /<g\b([^>]*\bclass=(?:"[^"]*\bnode\b[^"]*"|'[^']*\bnode\b[^']*')[^>]*)>([\s\S]*?)<\/g>/gi,
  )) {
    const attributes = attributesFrom(match[1] ?? '');
    if (!attributes.id) continue;
    const id = flowNodeId(attributes.id);
    const label = normalizeText(match[2]);
    nodes.push({ index: match.index, id, ...(label ? { label } : {}) });
  }
  nodes.forEach((node) =>
    targets.push({
      key: `node:${node.id}`,
      kind: 'node',
      id: node.id,
      order: node.index,
      ...(node.label ? { label: node.label } : {}),
    }),
  );

  const edgeCounts = new Map<string, number>();
  for (const match of svg.matchAll(
    /<(?:path|line|polyline)\b([^>]*\bdata-(?:edge|et)=(?:"(?:true|edge)"|'(?:true|edge)')[^>]*)>/gi,
  )) {
    const attributes = attributesFrom(match[1] ?? '');
    const id = attributes['data-id'] ?? attributes.id;
    if (!id) continue;
    const endpoints = edgeEndpoints(
      id,
      nodes.map((node) => node.id),
    );
    const signature = `${endpoints.from ?? ''}->${endpoints.to ?? ''}`;
    const occurrence = (edgeCounts.get(signature) ?? 0) + 1;
    edgeCounts.set(signature, occurrence);
    const key = flowEdgeKey(endpoints.from, endpoints.to, id, occurrence);
    targets.push({
      key,
      kind: 'edge',
      id,
      order: match.index,
      occurrence,
      ...(endpoints.from ? { from: endpoints.from } : {}),
      ...(endpoints.to ? { to: endpoints.to } : {}),
    });
  }

  for (const match of svg.matchAll(
    /<g\b([^>]*\bdata-et=(?:"participant"|'participant')[^>]*)>([\s\S]*?)<\/g>/gi,
  )) {
    const attributes = attributesFrom(match[1] ?? '');
    const id = attributes['data-id'];
    if (!id) continue;
    targets.push({
      key: `participant:${id}`,
      kind: 'participant',
      id,
      label: normalizeText(match[2]) ?? id,
      order: match.index,
    });
  }

  const messageLabels = [
    ...svg.matchAll(
      /<(?:text|foreignObject)\b([^>]*\bclass=(?:"[^"]*\bmessageText\b[^"]*"|'[^']*\bmessageText\b[^']*')[^>]*)>([\s\S]*?)<\/(?:text|foreignObject)>/gi,
    ),
  ].map((match) => normalizeText(match[2]) ?? '');
  const messageCounts = new Map<string, number>();
  let messageIndex = 0;
  for (const match of svg.matchAll(
    /<(?:path|line|polyline)\b([^>]*\bdata-et=(?:"message"|'message')[^>]*)>/gi,
  )) {
    const attributes = attributesFrom(match[1] ?? '');
    const from = attributes['data-from'] ?? '';
    const to = attributes['data-to'] ?? '';
    const id = attributes['data-id'] ?? `message-${messageIndex + 1}`;
    const label = messageLabels[messageIndex] ?? id;
    const className = attributes.class ?? '';
    const arrow = sequenceArrow(className, attributes['marker-start'], attributes['marker-end']);
    const signature = `${from}\u0000${arrow}\u0000${to}\u0000${label}`;
    const occurrence = (messageCounts.get(signature) ?? 0) + 1;
    messageCounts.set(signature, occurrence);
    targets.push({
      key: messageKey(from, arrow, to, label, occurrence),
      kind: 'message',
      id,
      label,
      from,
      to,
      arrow,
      occurrence,
      order: match.index,
    });
    messageIndex += 1;
  }
  return renumberTargets(targets);
}

function allElements(root: ParentNode): Element[] {
  const descendants = Array.from(root.querySelectorAll('*'));
  return isElementNode(root) ? [root, ...descendants] : descendants;
}

function bind(elements: Iterable<Element>, key: string, effectRoot = true): void {
  for (const element of elements) {
    element.setAttribute(TARGET_ATTRIBUTE, key);
    if (effectRoot) element.setAttribute(EFFECT_ATTRIBUTE, '');
  }
}

function discoverFromDom(root: ParentNode, diagramType?: string): SemanticTarget[] {
  const targets: SemanticTarget[] = [
    { key: 'diagram', kind: 'diagram', id: 'diagram', label: diagramType ?? 'Diagram', order: 0 },
  ];
  const elements = allElements(root);
  const nodeElements = elements.filter((element) => element.matches('g.node[id]'));
  const nodeIds = nodeElements.map((element) => flowNodeId(element.id));
  nodeElements.forEach((element, index) => {
    const id = nodeIds[index] ?? flowNodeId(element.id);
    const key = `node:${id}`;
    bind([element], key);
    const labelElement = Array.from(
      element.querySelectorAll('.nodeLabel, .label text, .label span'),
    );
    bind(labelElement, key, false);
    const label = normalizeText(element.querySelector('.nodeLabel, .label')?.textContent);
    targets.push({
      key,
      kind: 'node',
      id,
      order: elements.indexOf(element),
      ...(label ? { label } : {}),
    });
  });

  const edgeCounts = new Map<string, number>();
  const edgeElements = elements.filter(
    (element) =>
      element.getAttribute('data-edge') === 'true' || element.getAttribute('data-et') === 'edge',
  );
  edgeElements.forEach((element) => {
    const id = element.getAttribute('data-id') ?? element.id;
    if (!id) return;
    const endpoints = edgeEndpoints(id, nodeIds);
    const signature = `${endpoints.from ?? ''}->${endpoints.to ?? ''}`;
    const occurrence = (edgeCounts.get(signature) ?? 0) + 1;
    edgeCounts.set(signature, occurrence);
    const key = flowEdgeKey(endpoints.from, endpoints.to, id, occurrence);
    const matchingLabels = elements.filter(
      (candidate) => candidate !== element && candidate.getAttribute('data-id') === id,
    );
    bind([element, ...matchingLabels], key);
    targets.push({
      key,
      kind: 'edge',
      id,
      order: elements.indexOf(element),
      occurrence,
      ...(endpoints.from ? { from: endpoints.from } : {}),
      ...(endpoints.to ? { to: endpoints.to } : {}),
    });
  });

  const participantElements = elements.filter(
    (element) => element.getAttribute('data-et') === 'participant',
  );
  participantElements.forEach((element) => {
    const id = element.getAttribute('data-id');
    if (!id) return;
    const key = `participant:${id}`;
    const related = elements.filter(
      (candidate) =>
        candidate !== element &&
        (candidate.getAttribute('data-id') === id || candidate.getAttribute('name') === id) &&
        (candidate.classList.contains('actor-line') ||
          candidate.classList.contains('actor-bottom')),
    );
    const relatedRoots = related.map((candidate) =>
      candidate.classList.contains('actor-bottom')
        ? (candidate.closest('g') ?? candidate)
        : candidate,
    );
    bind([element, ...relatedRoots], key);
    targets.push({
      key,
      kind: 'participant',
      id,
      label: normalizeText(element.textContent) ?? id,
      order: elements.indexOf(element),
    });
  });

  const messageElements = elements.filter(
    (element) => element.getAttribute('data-et') === 'message',
  );
  const messageLabels = elements.filter((element) => element.classList.contains('messageText'));
  const messageCounts = new Map<string, number>();
  messageElements.forEach((element, index) => {
    const from = element.getAttribute('data-from') ?? '';
    const to = element.getAttribute('data-to') ?? '';
    const id = element.getAttribute('data-id') ?? `message-${index + 1}`;
    const labelElement = messageLabels[index];
    const label = normalizeText(labelElement?.textContent) ?? id;
    const arrow = sequenceArrow(
      element.getAttribute('class') ?? '',
      element.getAttribute('marker-start') ?? undefined,
      element.getAttribute('marker-end') ?? undefined,
    );
    const signature = `${from}\u0000${arrow}\u0000${to}\u0000${label}`;
    const occurrence = (messageCounts.get(signature) ?? 0) + 1;
    messageCounts.set(signature, occurrence);
    const key = messageKey(from, arrow, to, label, occurrence);
    bind(labelElement ? [element, labelElement] : [element], key);
    targets.push({
      key,
      kind: 'message',
      id,
      label,
      from,
      to,
      arrow,
      occurrence,
      order: elements.indexOf(element),
    });
  });

  const svg = isElementNode(root) && root.matches('svg') ? root : root.querySelector('svg');
  if (svg) bind([svg], 'diagram');
  return renumberTargets(targets);
}

export function discoverTargets(root: ParentNode | string, diagramType?: string): SemanticTarget[] {
  if (typeof root !== 'string') return discoverFromDom(root, diagramType);
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(root, 'image/svg+xml');
    return discoverFromDom(parsed, diagramType);
  }
  return discoverFromString(root, diagramType);
}

export const discoverTargetsFromSvg = (svg: string, diagramType?: string): SemanticTarget[] =>
  discoverTargets(svg, diagramType);

export function resolveTargetFromElement(
  targets: SemanticTarget[],
  element: Element | null,
): SemanticTarget | undefined {
  let current = element;
  while (current) {
    const key = current.getAttribute(TARGET_ATTRIBUTE);
    if (key) return targets.find((target) => target.key === key);
    current = current.parentElement;
  }
  return undefined;
}

interface OriginalStyle {
  opacity: string;
  filter: string;
  pointerEvents: string;
  animationPlayState: string;
}

const originalStyles = new WeakMap<Element, OriginalStyle>();
const pausedAnimationRoots = new WeakSet<ParentNode>();
const managedMotionRoots = new WeakSet<ParentNode>();
const markerColors = new WeakMap<SVGSVGElement, Map<string, string>>();
const effectBindingCache = new WeakMap<ParentNode, Map<string, Element[]>>();

interface Point {
  x: number;
  y: number;
}

interface SampledGeometry {
  points: Point[];
  distances: number[];
  length: number;
  localLength: number;
}

interface RouteEdgeSection {
  key: string;
  pathData: string;
  points: Point[];
  distances: number[];
  startDistance: number;
  endDistance: number;
  length: number;
}

interface RoutePlan {
  points: Point[];
  distances: number[];
  length: number;
  edges: RouteEdgeSection[];
}

type MeasurableGeometry = SVGGraphicsElement & {
  getPointAtLength(distance: number): DOMPoint;
  getTotalLength(): number;
};

interface MarkerVisual {
  root: SVGGElement;
  head: SVGGElement;
  halo: SVGCircleElement;
  core: SVGCircleElement;
  arrival: SVGCircleElement;
  comets: [SVGPathElement, SVGPathElement, SVGPathElement];
  wakes: [SVGPathElement, SVGPathElement];
  label?: {
    group: SVGGElement;
    leader: SVGLineElement;
    background: SVGRectElement;
    text: SVGTextElement;
  };
  occupancy?: SVGGraphicsElement;
  occupancyKey?: string;
}

interface TraceVisual {
  core: MeasurableGeometry;
  glow: MeasurableGeometry;
}

interface OverlayScene {
  root: SVGGElement;
  markers: Map<string, MarkerVisual>;
  traces: Map<string, TraceVisual>;
  traceCaps: Map<string, SVGCircleElement>;
}

const sampledGeometryCache = new WeakMap<SVGGraphicsElement, SampledGeometry>();
const routePlanCache = new WeakMap<SVGSVGElement, Map<string, RoutePlan>>();
const overlayScenes = new WeakMap<SVGSVGElement, OverlayScene>();
const calloutObstacleCache = new WeakMap<SVGSVGElement, Bounds[]>();

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function saveOriginalStyle(element: Element): OriginalStyle | undefined {
  if (typeof SVGElement === 'undefined' || !(element instanceof SVGElement)) return undefined;
  const styled = element;
  const saved = originalStyles.get(element) ?? {
    opacity: styled.style.opacity,
    filter: styled.style.filter,
    pointerEvents: styled.style.pointerEvents,
    animationPlayState: styled.style.animationPlayState,
  };
  originalStyles.set(element, saved);
  return saved;
}

function pauseNativeAnimations(root: ParentNode): void {
  const animationRoot = svgRoot(root) ?? root;
  if (pausedAnimationRoots.has(animationRoot)) return;
  for (const element of allElements(animationRoot)) {
    if (typeof SVGElement === 'undefined' || !(element instanceof SVGElement)) continue;
    const computed =
      typeof getComputedStyle === 'undefined' ? undefined : getComputedStyle(element);
    if (element.style.animation || (computed?.animationName && computed.animationName !== 'none')) {
      saveOriginalStyle(element);
      element.style.animationPlayState = 'paused';
    }
  }
  pausedAnimationRoots.add(animationRoot);
}

function effectColor(element: Element): string {
  if (typeof getComputedStyle === 'undefined') return 'currentColor';
  const computed = getComputedStyle(element);
  if (computed.stroke && computed.stroke !== 'none' && computed.stroke !== 'transparent')
    return computed.stroke;
  if (computed.color && computed.color !== 'transparent') return computed.color;
  return computed.fill && computed.fill !== 'none' ? computed.fill : 'currentColor';
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

function parseRgbColor(value: string): RgbColor | undefined {
  if (value === 'transparent' || /^rgba\([^)]*[,/]\s*0(?:\.0+)?\s*\)$/i.test(value))
    return undefined;
  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*[\d.]+)?\s*\)$/i,
  );
  if (rgb) {
    const red = Number(rgb[1]);
    const green = Number(rgb[2]);
    const blue = Number(rgb[3]);
    return [red, green, blue].every(Number.isFinite) ? { red, green, blue } : undefined;
  }
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!hex) return undefined;
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : hex;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance(color: RgbColor): number {
  return (
    0.2126 * channelLuminance(color.red) +
    0.7152 * channelLuminance(color.green) +
    0.0722 * channelLuminance(color.blue)
  );
}

function contrast(left: RgbColor, right: RgbColor): number {
  const brighter = Math.max(luminance(left), luminance(right));
  const darker = Math.min(luminance(left), luminance(right));
  return (brighter + 0.05) / (darker + 0.05);
}

function backdropColor(svg: SVGSVGElement): RgbColor {
  let current: Element | null = svg;
  while (current) {
    const color = parseRgbColor(getComputedStyle(current).backgroundColor);
    if (color) return color;
    current = current.parentElement;
  }
  return { red: 13, green: 23, blue: 21 };
}

function readableMotionColor(svg: SVGSVGElement, preferred: string): string {
  const foreground = parseRgbColor(preferred);
  const background = backdropColor(svg);
  const chroma = foreground
    ? Math.max(foreground.red, foreground.green, foreground.blue) -
      Math.min(foreground.red, foreground.green, foreground.blue)
    : 0;
  if (foreground && chroma >= 48 && contrast(foreground, background) >= 2.4) return preferred;
  return luminance(background) < 0.36 ? '#2dd4bf' : '#0f766e';
}

function boundElements(root: ParentNode, effectRootsOnly = false): Map<string, Element[]> {
  const result = new Map<string, Element[]>();
  for (const element of allElements(root).filter(
    (candidate) =>
      candidate.hasAttribute(TARGET_ATTRIBUTE) &&
      (!effectRootsOnly || candidate.hasAttribute(EFFECT_ATTRIBUTE)),
  )) {
    const key = element.getAttribute(TARGET_ATTRIBUTE);
    if (!key) continue;
    const list = result.get(key) ?? [];
    list.push(element);
    result.set(key, list);
  }
  return result;
}

function cachedEffectBindings(root: ParentNode): Map<string, Element[]> {
  const cached = effectBindingCache.get(root);
  if (cached) return cached;
  const bindings = boundElements(root, true);
  effectBindingCache.set(root, bindings);
  return bindings;
}

function svgRoot(root: ParentNode): SVGSVGElement | undefined {
  if (typeof SVGSVGElement === 'undefined') return undefined;
  if (root instanceof SVGSVGElement) return root;
  const descendant = root.querySelector('svg');
  return descendant instanceof SVGSVGElement ? descendant : undefined;
}

function isMeasurableGeometry(element: Node | undefined): element is MeasurableGeometry {
  return (
    !!element &&
    typeof SVGGraphicsElement !== 'undefined' &&
    element instanceof SVGGraphicsElement &&
    'getTotalLength' in element &&
    typeof element.getTotalLength === 'function' &&
    'getPointAtLength' in element &&
    typeof element.getPointAtLength === 'function'
  );
}

function finitePoint(point: Point): Point | undefined {
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
}

function pointInSvgSpace(
  svg: SVGSVGElement,
  source: SVGGraphicsElement,
  sourcePoint: Point,
): Point | undefined {
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

function relativeMatrix(svg: SVGSVGElement, source: SVGGraphicsElement): DOMMatrix | undefined {
  try {
    const sourceMatrix = source.getScreenCTM();
    const svgMatrix = svg.getScreenCTM();
    if (!sourceMatrix || !svgMatrix) return undefined;
    const matrix = svgMatrix.inverse().multiply(sourceMatrix);
    return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
      ? matrix
      : undefined;
  } catch {
    return undefined;
  }
}

function targetCenter(svg: SVGSVGElement, element: Element | undefined): Point | undefined {
  if (
    !element ||
    typeof SVGGraphicsElement === 'undefined' ||
    !(element instanceof SVGGraphicsElement)
  )
    return undefined;
  const graphics = element;
  try {
    const box = graphics.getBBox();
    return pointInSvgSpace(svg, graphics, {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
  } catch {
    return undefined;
  }
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function withDistances(points: Point[]): Pick<RoutePlan, 'points' | 'distances' | 'length'> {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    distances.push(
      (distances[index - 1] ?? 0) + (previous && point ? distance(previous, point) : 0),
    );
  }
  return { points, distances, length: distances[distances.length - 1] ?? 0 };
}

function sampledGeometry(
  svg: SVGSVGElement,
  geometry: MeasurableGeometry,
): SampledGeometry | undefined {
  const cached = sampledGeometryCache.get(geometry);
  if (cached) return cached;
  try {
    const localLength = geometry.getTotalLength();
    if (!Number.isFinite(localLength) || localLength <= 0) return undefined;
    const sampleCount = Math.min(512, Math.max(24, Math.ceil(localLength / 2)));
    const points: Point[] = [];
    for (let index = 0; index <= sampleCount; index += 1) {
      const localPoint = geometry.getPointAtLength((localLength * index) / sampleCount);
      const point = pointInSvgSpace(svg, geometry, localPoint);
      if (!point) return undefined;
      points.push(point);
    }
    const measured = withDistances(points);
    const result: SampledGeometry = { ...measured, localLength };
    sampledGeometryCache.set(geometry, result);
    return result;
  } catch {
    return undefined;
  }
}

function orientedGeometry(sampled: SampledGeometry, from: Point, to: Point): SampledGeometry {
  const first = sampled.points[0];
  const last = sampled.points[sampled.points.length - 1];
  if (!first || !last) return sampled;
  const forwardDistance = distance(from, first) + distance(to, last);
  const reverseDistance = distance(from, last) + distance(to, first);
  if (forwardDistance <= reverseDistance) return sampled;
  const measured = withDistances([...sampled.points].reverse());
  return { ...measured, localLength: sampled.localLength };
}

function bindingCenter(
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  key: string | undefined,
): Point | undefined {
  if (!key) return undefined;
  const element = bindings
    .get(key)
    ?.find(
      (candidate) =>
        typeof SVGGraphicsElement !== 'undefined' && candidate instanceof SVGGraphicsElement,
    );
  return targetCenter(svg, element);
}

function bindingGeometry(
  bindings: Map<string, Element[]>,
  key: string | undefined,
): MeasurableGeometry | undefined {
  if (!key) return undefined;
  return bindings.get(key)?.find(isMeasurableGeometry);
}

function flowEdgeEndpointsFromKey(key: string): { from: string; to: string } | undefined {
  if (!key.startsWith('edge:')) return undefined;
  const withoutOccurrence = key.replace(/#\d+$/, '').slice('edge:'.length);
  const separator = withoutOccurrence.indexOf('-->');
  if (separator < 1) return undefined;
  const from = withoutOccurrence.slice(0, separator);
  const to = withoutOccurrence.slice(separator + '-->'.length);
  return from && to ? { from, to } : undefined;
}

function appendDistinct(points: Point[], point: Point): void {
  const previous = points[points.length - 1];
  if (!previous || distance(previous, point) > 0.001) points.push(point);
}

function appendDistinctIndex(points: Point[], point: Point): number {
  appendDistinct(points, point);
  return Math.max(0, points.length - 1);
}

function coordinate(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function pointsPathData(points: Point[]): string {
  return points
    .map(
      (point, index) => `${index === 0 ? 'M' : 'L'}${coordinate(point.x)} ${coordinate(point.y)}`,
    )
    .join(' ');
}

function buildRoutePlan(
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  marker: FrameMarkerState,
  targets: SemanticTarget[],
): RoutePlan | undefined {
  if (marker.route.length === 1) {
    const point = bindingCenter(svg, bindings, marker.route[0]);
    return point ? { points: [point], distances: [0], length: 0, edges: [] } : undefined;
  }
  if (marker.edgeKeys.length !== marker.route.length - 1) return undefined;

  const points: Point[] = [];
  const sections: Array<{ key: string; points: Point[]; startIndex: number; endIndex: number }> =
    [];
  for (let index = 0; index < marker.edgeKeys.length; index += 1) {
    const from = bindingCenter(svg, bindings, marker.route[index]);
    const to = bindingCenter(svg, bindings, marker.route[index + 1]);
    const edgeKey = marker.edgeKeys[index];
    const geometry = bindingGeometry(bindings, edgeKey);
    const connection = targets.find((target) => target.key === edgeKey);
    const isMessage = connection?.kind === 'message';
    if (!from || !to || !geometry) return undefined;
    const sampled = sampledGeometry(svg, geometry);
    if (!sampled) return undefined;
    const oriented = orientedGeometry(sampled, from, to);
    if (!isMessage) appendDistinct(points, from);
    const firstEdgePoint = oriented.points[0];
    const lastEdgePoint = oriented.points[oriented.points.length - 1];
    if (!firstEdgePoint || !lastEdgePoint || !edgeKey) return undefined;
    const startIndex = appendDistinctIndex(points, firstEdgePoint);
    for (const point of oriented.points.slice(1, -1)) appendDistinct(points, point);
    const endIndex = appendDistinctIndex(points, lastEdgePoint);
    sections.push({ key: edgeKey, points: oriented.points, startIndex, endIndex });
    if (!isMessage) appendDistinct(points, to);
  }
  if (points.length === 0) return undefined;
  const measured = withDistances(points);
  const edges = sections.map((section) => {
    const startDistance = measured.distances[section.startIndex] ?? 0;
    const endDistance = measured.distances[section.endIndex] ?? startDistance;
    return {
      key: section.key,
      pathData: pointsPathData(section.points),
      points: section.points,
      distances: withDistances(section.points).distances,
      startDistance,
      endDistance,
      length: Math.max(0, endDistance - startDistance),
    };
  });
  return { ...measured, edges };
}

function upperDistanceIndex(distances: number[], requestedDistance: number): number {
  if (distances.length <= 1) return 0;
  let lowerBound = 1;
  let upperBound = distances.length - 1;
  while (lowerBound < upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);
    if ((distances[middle] ?? 0) < requestedDistance) lowerBound = middle + 1;
    else upperBound = middle;
  }
  return lowerBound;
}

function pointAtPlanDistance(
  plan: Pick<RoutePlan, 'points' | 'distances' | 'length'>,
  requestedDistance: number,
): Point | undefined {
  const first = plan.points[0];
  if (!first) return undefined;
  if (plan.length <= 0 || requestedDistance <= 0) return first;
  if (requestedDistance >= plan.length) return plan.points[plan.points.length - 1] ?? first;
  const upperIndex = upperDistanceIndex(plan.distances, requestedDistance);
  const lowerIndex = upperIndex - 1;
  const from = plan.points[lowerIndex];
  const to = plan.points[upperIndex];
  const lowerDistance = plan.distances[lowerIndex] ?? 0;
  const upperDistance = plan.distances[upperIndex] ?? lowerDistance;
  if (!from || !to || upperDistance <= lowerDistance) return from ?? to;
  const localProgress = (requestedDistance - lowerDistance) / (upperDistance - lowerDistance);
  return {
    x: from.x + (to.x - from.x) * localProgress,
    y: from.y + (to.y - from.y) * localProgress,
  };
}

function pointOnPlan(plan: RoutePlan, progress: number): Point | undefined {
  return pointAtPlanDistance(plan, plan.length * Math.max(0, Math.min(1, progress)));
}

function pathDataBetween(
  plan: Pick<RoutePlan, 'points' | 'distances' | 'length'>,
  startDistance: number,
  endDistance: number,
): string {
  const start = Math.max(0, Math.min(plan.length, startDistance));
  const end = Math.max(start, Math.min(plan.length, endDistance));
  const startPoint = pointAtPlanDistance(plan, start);
  const endPoint = pointAtPlanDistance(plan, end);
  if (!startPoint || !endPoint) return '';
  const points = [startPoint];
  const firstIndex = upperDistanceIndex(plan.distances, start);
  const lastIndex = upperDistanceIndex(plan.distances, end);
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const measuredDistance = plan.distances[index] ?? 0;
    const point = plan.points[index];
    if (point && measuredDistance > start && measuredDistance < end) appendDistinct(points, point);
  }
  appendDistinct(points, endPoint);
  return pointsPathData(points);
}

function planTangent(plan: RoutePlan, requestedDistance: number, sampleDistance: number): Point {
  const before = pointAtPlanDistance(plan, requestedDistance - sampleDistance);
  const after = pointAtPlanDistance(plan, requestedDistance + sampleDistance);
  if (!before || !after) return { x: 1, y: 0 };
  const length = distance(before, after);
  return length <= 0.001
    ? { x: 1, y: 0 }
    : { x: (after.x - before.x) / length, y: (after.y - before.y) / length };
}

function markerPlan(
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  marker: FrameMarkerState,
  targets: SemanticTarget[],
): RoutePlan | undefined {
  const cache = routePlanCache.get(svg) ?? new Map<string, RoutePlan>();
  routePlanCache.set(svg, cache);
  const cacheKey = `${marker.route.join('\u0000')}\u0001${marker.edgeKeys.join('\u0000')}`;
  let plan = cache.get(cacheKey);
  if (plan === undefined) {
    plan = buildRoutePlan(svg, bindings, marker, targets);
    if (plan) cache.set(cacheKey, plan);
  }
  return plan;
}

function screenScale(svg: SVGSVGElement): number {
  const matrix = svg.getScreenCTM();
  if (!matrix) return 1;
  const horizontal = Math.hypot(matrix.a, matrix.b);
  const vertical = Math.hypot(matrix.c, matrix.d);
  const scale = Math.sqrt(horizontal * vertical);
  return Number.isFinite(scale) && scale > 0.001 ? scale : 1;
}

function elementBounds(svg: SVGSVGElement, element: SVGGraphicsElement): Bounds | undefined {
  try {
    const box = element.getBBox();
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x, y: box.y + box.height },
      { x: box.x + box.width, y: box.y + box.height },
    ]
      .map((point) => pointInSvgSpace(svg, element, point))
      .filter((point): point is Point => point !== undefined);
    if (corners.length !== 4) return undefined;
    const xs = corners.map(({ x }) => x);
    const ys = corners.map(({ y }) => y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  } catch {
    return undefined;
  }
}

function overlappingArea(left: Bounds, right: Bounds, padding = 0): number {
  const overlapWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width + padding) -
      Math.max(left.x, right.x - padding),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height + padding) -
      Math.max(left.y, right.y - padding),
  );
  return overlapWidth * overlapHeight;
}

function calloutObstacles(svg: SVGSVGElement, bindings: Map<string, Element[]>): Bounds[] {
  const cached = calloutObstacleCache.get(svg);
  if (cached) return cached;
  const obstacles: Bounds[] = [];
  for (const [key, elements] of bindings) {
    const candidates =
      key.startsWith('node:') || key.startsWith('participant:')
        ? elements.slice(0, 1)
        : key.startsWith('edge:') || key.startsWith('message:')
          ? elements.filter((element) => !isMeasurableGeometry(element))
          : [];
    for (const element of candidates) {
      if (typeof SVGGraphicsElement === 'undefined' || !(element instanceof SVGGraphicsElement))
        continue;
      const bounds = elementBounds(svg, element);
      if (bounds && bounds.width > 0 && bounds.height > 0) obstacles.push(bounds);
    }
  }
  calloutObstacleCache.set(svg, obstacles);
  return obstacles;
}

function steadyLabelOffset(
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  placementPoints: Point[],
  tangent: Point,
  label: string,
  inverseScale: number,
): { x: number; y: number; width: number; height: number; placement: number } {
  const width = Math.max(42, label.length * 6.7 + 16) * inverseScale;
  const height = 21 * inverseScale;
  const distanceFromHead = 56 * inverseScale + height / 2;
  const viewBox = svg.viewBox.baseVal;
  const center = { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
  const point = placementPoints[0] ?? center;
  const horizontalRoute = Math.abs(tangent.x) >= Math.abs(tangent.y);
  const verticalDirection = point.y <= center.y + inverseScale ? -1 : 1;
  const horizontalDirection = point.x <= center.x + inverseScale ? -1 : 1;
  const directions = horizontalRoute
    ? [
        { x: -tangent.x * 0.24, y: verticalDirection },
        { x: -tangent.x * 0.24, y: -verticalDirection },
        { x: -Math.sign(tangent.x || 1), y: verticalDirection * 0.64 },
        { x: Math.sign(tangent.x || 1), y: verticalDirection * 0.64 },
      ]
    : [
        { x: horizontalDirection, y: -tangent.y * 0.24 },
        { x: -horizontalDirection, y: -tangent.y * 0.24 },
        { x: horizontalDirection * 0.64, y: -Math.sign(tangent.y || 1) },
        { x: horizontalDirection * 0.64, y: Math.sign(tangent.y || 1) },
      ];
  const obstacles = calloutObstacles(svg, bindings);
  const viewBounds: Bounds = {
    x: viewBox.x,
    y: viewBox.y,
    width: viewBox.width,
    height: viewBox.height,
  };
  const candidates = [distanceFromHead, distanceFromHead + 18 * inverseScale].flatMap(
    (radius, distanceIndex) =>
      directions.map((direction, directionIndex) => {
        const magnitude = Math.hypot(direction.x, direction.y) || 1;
        const x = (direction.x / magnitude) * radius;
        const y = (direction.y / magnitude) * radius;
        const scoreBounds = placementPoints.map((placementPoint) => ({
          x: placementPoint.x + x - width / 2,
          y: placementPoint.y + y - height / 2,
          width,
          height,
        }));
        const collisions = scoreBounds.reduce(
          (total, bounds) =>
            total +
            obstacles.reduce(
              (subtotal, obstacle) =>
                subtotal + overlappingArea(bounds, obstacle, 4 * inverseScale),
              0,
            ),
          0,
        );
        const outsideArea = scoreBounds.reduce(
          (total, bounds) => total + width * height - overlappingArea(bounds, viewBounds),
          0,
        );
        return {
          x,
          y,
          width,
          height,
          placement: distanceIndex * directions.length + directionIndex,
          score: collisions * 10_000 + outsideArea * 500 + distanceIndex * 2 + directionIndex,
        };
      }),
  );
  const selected = candidates.sort((left, right) => left.score - right.score)[0];
  return selected ?? { x: 0, y: -distanceFromHead, width, height, placement: 0 };
}

function nodeContainingPoint(
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  marker: FrameMarkerState,
  point: Point,
): { key: string; shape: SVGGraphicsElement } | undefined {
  for (const key of marker.route) {
    const root = bindings
      .get(key)
      ?.find(
        (candidate): candidate is SVGGraphicsElement =>
          typeof SVGGraphicsElement !== 'undefined' && candidate instanceof SVGGraphicsElement,
      );
    if (!root) continue;
    const bounds = elementBounds(svg, root);
    if (
      !bounds ||
      point.x < bounds.x ||
      point.x > bounds.x + bounds.width ||
      point.y < bounds.y ||
      point.y > bounds.y + bounds.height
    )
      continue;
    const shape = root.matches('rect, circle, ellipse, polygon, path')
      ? root
      : root.querySelector<SVGGraphicsElement>(
          ':scope > rect, :scope > circle, :scope > ellipse, :scope > polygon, :scope > path',
        );
    if (shape) return { key, shape };
  }
  return undefined;
}

function ensureOverlayScene(svg: SVGSVGElement): OverlayScene {
  const existing = overlayScenes.get(svg);
  if (existing?.root.isConnected) return existing;
  svg.querySelector('[data-mermotion-overlay]')?.remove();
  const root = document.createElementNS(SVG_NAMESPACE, 'g');
  root.setAttribute('data-mermotion-overlay', 'true');
  root.setAttribute('pointer-events', 'none');
  svg.append(root);
  const scene: OverlayScene = {
    root,
    markers: new Map(),
    traces: new Map(),
    traceCaps: new Map(),
  };
  overlayScenes.set(svg, scene);
  return scene;
}

function styledPath(attribute: string, value: string): SVGPathElement {
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute(attribute, value);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  return path;
}

function createMarkerVisual(
  scene: OverlayScene,
  marker: FrameMarkerState,
  color: string,
): MarkerVisual {
  const root = document.createElementNS(SVG_NAMESPACE, 'g');
  root.setAttribute('data-mermotion-marker-decoration', marker.id);
  root.setAttribute('color', color);

  const cometGlow = styledPath('data-mermotion-comet', 'glow');
  cometGlow.setAttribute('stroke-width', '8');
  cometGlow.setAttribute('opacity', '0.1');
  const cometBody = styledPath('data-mermotion-comet', 'body');
  cometBody.setAttribute('stroke-width', '4');
  cometBody.setAttribute('opacity', '0.24');
  const cometCore = styledPath('data-mermotion-comet', 'core');
  cometCore.setAttribute('stroke-width', '1.8');
  cometCore.setAttribute('opacity', '0.84');

  const wakeGlow = styledPath('data-mermotion-wake', 'glow');
  wakeGlow.setAttribute('stroke-width', '7');
  wakeGlow.setAttribute('opacity', '0.1');
  const wakeCore = styledPath('data-mermotion-wake', 'core');
  wakeCore.setAttribute('stroke-width', '2.8');
  wakeCore.setAttribute('opacity', '0.68');

  const arrival = document.createElementNS(SVG_NAMESPACE, 'circle');
  arrival.setAttribute('data-mermotion-arrival', '');
  arrival.setAttribute('fill', 'none');
  arrival.setAttribute('stroke', 'currentColor');
  arrival.setAttribute('stroke-width', '1.8');
  arrival.setAttribute('vector-effect', 'non-scaling-stroke');
  arrival.setAttribute('visibility', 'hidden');
  arrival.setAttribute('opacity', '0');
  arrival.setAttribute('data-arrival-progress', '0');

  const head = document.createElementNS(SVG_NAMESPACE, 'g');
  head.setAttribute('data-marker-id', marker.id);
  head.setAttribute('data-marker-label', marker.label);
  head.setAttribute('data-marker-phase', marker.phase);

  const halo = document.createElementNS(SVG_NAMESPACE, 'circle');
  halo.setAttribute('data-mermotion-marker-halo', '');
  halo.setAttribute('fill', 'currentColor');
  halo.setAttribute('opacity', '0.14');
  head.append(halo);

  const core = document.createElementNS(SVG_NAMESPACE, 'circle');
  core.setAttribute('data-mermotion-marker-core', '');
  core.setAttribute('fill', 'currentColor');
  core.setAttribute('stroke', '#ecfdf5');
  core.setAttribute('stroke-width', '1.35');
  core.setAttribute('vector-effect', 'non-scaling-stroke');
  head.append(core);

  let labelVisual: MarkerVisual['label'];
  if (marker.label) {
    const labelGroup = document.createElementNS(SVG_NAMESPACE, 'g');
    labelGroup.setAttribute('data-mermotion-marker-callout', '');
    const leader = document.createElementNS(SVG_NAMESPACE, 'line');
    leader.setAttribute('data-mermotion-marker-leader', '');
    leader.setAttribute('stroke', 'currentColor');
    leader.setAttribute('stroke-width', '1');
    leader.setAttribute('stroke-opacity', '0.58');
    leader.setAttribute('vector-effect', 'non-scaling-stroke');
    const background = document.createElementNS(SVG_NAMESPACE, 'rect');
    background.setAttribute('fill', '#0d1715');
    background.setAttribute('stroke', 'currentColor');
    background.setAttribute('stroke-opacity', '0.56');
    background.setAttribute('stroke-width', '1');
    background.setAttribute('vector-effect', 'non-scaling-stroke');
    const text = document.createElementNS(SVG_NAMESPACE, 'text');
    text.setAttribute('x', '0');
    text.setAttribute('y', '0');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
    text.setAttribute('font-weight', '650');
    text.setAttribute('fill', '#f6fbf9');
    text.textContent = marker.label;
    labelGroup.append(background, text);
    head.append(leader, labelGroup);
    labelVisual = { group: labelGroup, leader, background, text };
  }

  root.append(wakeGlow, wakeCore, cometGlow, cometBody, cometCore, arrival, head);
  scene.root.append(root);
  return {
    root,
    head,
    halo,
    core,
    arrival,
    comets: [cometGlow, cometBody, cometCore],
    wakes: [wakeGlow, wakeCore],
    ...(labelVisual ? { label: labelVisual } : {}),
  };
}

function updateTraces(
  scene: OverlayScene,
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  targets: SemanticTarget[],
  frame: FrameState,
  options: ApplyFrameOptions,
): void {
  const activeKeys = new Set<string>();
  const activeCaps = new Set<string>();
  frame.traces.forEach((trace) => {
    const entries = trace.targetKeys.flatMap((key, targetIndex) => {
      const source = bindingGeometry(bindings, key);
      const discovered = source ? sampledGeometry(svg, source) : undefined;
      const target = targets.find((candidate) => candidate.key === key);
      const endpoints =
        target?.from && target.to
          ? { from: target.from, to: target.to, kind: target.kind }
          : flowEdgeEndpointsFromKey(key);
      const endpointKind =
        endpoints && 'kind' in endpoints && endpoints.kind === 'message' ? 'participant' : 'node';
      const from = endpoints
        ? bindingCenter(svg, bindings, `${endpointKind}:${endpoints.from}`)
        : undefined;
      const to = endpoints
        ? bindingCenter(svg, bindings, `${endpointKind}:${endpoints.to}`)
        : undefined;
      const sampled =
        discovered && from && to ? orientedGeometry(discovered, from, to) : discovered;
      return source && sampled ? [{ key, source, sampled, targetIndex }] : [];
    });
    const totalLength = entries.reduce((sum, entry) => sum + entry.sampled.length, 0);
    let consumedLength = 0;
    let capPoint: Point | undefined;
    let capColor = '#2dd4bf';
    entries.forEach(({ key, source, sampled, targetIndex }) => {
      const traceKey = `${trace.id}:${targetIndex}:${key}`;
      activeKeys.add(traceKey);
      let visual = scene.traces.get(traceKey);
      if (!visual) {
        const createClone = (layer: 'core' | 'glow'): MeasurableGeometry | undefined => {
          const clone = document.createElementNS(SVG_NAMESPACE, 'path');
          if (!isMeasurableGeometry(clone)) return undefined;
          clone.setAttribute('d', pointsPathData(sampled.points));
          if (layer === 'core') {
            clone.setAttribute('data-mermotion-trace', traceKey);
            clone.setAttribute('data-mermotion-trace-source', key);
          } else clone.setAttribute('data-mermotion-trace-layer', 'glow');
          clone.setAttribute('vector-effect', 'non-scaling-stroke');
          clone.style.fill = 'none';
          clone.style.strokeLinecap = 'round';
          clone.style.strokeLinejoin = 'round';
          clone.style.pointerEvents = 'none';
          return clone;
        };
        const core = createClone('core');
        const glow = createClone('glow');
        if (!core || !glow) return;
        core.style.strokeWidth = '3';
        core.style.opacity = '0.92';
        glow.style.strokeWidth = '7';
        glow.style.opacity = '0.14';
        scene.root.prepend(core);
        scene.root.prepend(glow);
        visual = { core, glow };
        scene.traces.set(traceKey, visual);
      }
      const sourceColor = effectColor(source);
      const color =
        trace.color === 'inherit'
          ? sourceColor
          : (trace.color ?? readableMotionColor(svg, sourceColor));
      visual.core.style.stroke = color;
      visual.glow.style.stroke = color;
      const edgeProgress =
        sampled.length <= 0 || totalLength <= 0
          ? 0
          : Math.max(
              0,
              Math.min(1, (trace.progress * totalLength - consumedLength) / sampled.length),
            );
      for (const clone of [visual.glow, visual.core]) {
        clone.style.strokeDasharray = `${sampled.length}`;
        clone.style.strokeDashoffset = `${sampled.length * (1 - edgeProgress)}`;
      }
      visual.glow.setAttribute('visibility', options.reducedMotion ? 'hidden' : 'visible');
      visual.core.setAttribute('visibility', 'visible');
      const progressDistance = trace.progress * totalLength;
      if (
        !capPoint &&
        progressDistance >= consumedLength &&
        progressDistance <= consumedLength + sampled.length
      ) {
        capPoint = pointAtPlanDistance(sampled, sampled.length * edgeProgress);
        capColor = color;
      }
      consumedLength += sampled.length;
    });
    if (!capPoint && entries.length > 0) {
      const last = entries[entries.length - 1];
      if (last) {
        capPoint = last.sampled.points[last.sampled.points.length - 1];
        const sourceColor = effectColor(last.source);
        capColor =
          trace.color === 'inherit'
            ? sourceColor
            : (trace.color ?? readableMotionColor(svg, sourceColor));
      }
    }
    if (capPoint) {
      activeCaps.add(trace.id);
      let cap = scene.traceCaps.get(trace.id);
      if (!cap) {
        cap = document.createElementNS(SVG_NAMESPACE, 'circle');
        cap.setAttribute('data-mermotion-trace-cap', trace.id);
        cap.setAttribute('stroke', 'none');
        scene.root.append(cap);
        scene.traceCaps.set(trace.id, cap);
      }
      const inverseScale = 1 / screenScale(svg);
      cap.setAttribute('cx', coordinate(capPoint.x));
      cap.setAttribute('cy', coordinate(capPoint.y));
      cap.setAttribute('r', coordinate(2.25 * inverseScale));
      cap.setAttribute('fill', capColor);
      cap.setAttribute('visibility', options.reducedMotion ? 'hidden' : 'visible');
    }
  });
  for (const [key, trace] of scene.traces) {
    if (activeKeys.has(key)) continue;
    trace.core.remove();
    trace.glow.remove();
    scene.traces.delete(key);
  }
  for (const [index, cap] of scene.traceCaps) {
    if (activeCaps.has(index)) continue;
    cap.remove();
    scene.traceCaps.delete(index);
  }
}

function updateMarkers(
  scene: OverlayScene,
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  targets: SemanticTarget[],
  frame: FrameState,
  options: ApplyFrameOptions,
): void {
  const activeIds = new Set<string>();
  Object.values(frame.markers).forEach((marker) => {
    const plan = markerPlan(svg, bindings, marker, targets);
    const point = plan ? pointOnPlan(plan, marker.routeProgress) : undefined;
    if (!plan || !point) return;
    activeIds.add(marker.id);
    const colors = markerColors.get(svg) ?? new Map<string, string>();
    markerColors.set(svg, colors);
    const markerSource =
      bindingGeometry(bindings, marker.edgeKeys[0]) ??
      bindings.get(marker.route[0] ?? marker.at)?.[0];
    let markerColor =
      marker.color === 'inherit'
        ? markerSource
          ? effectColor(markerSource)
          : readableMotionColor(svg, 'currentColor')
        : marker.color;
    if (!markerColor) {
      markerColor = colors.get(marker.id);
    }
    if (!markerColor) {
      markerColor = markerSource
        ? readableMotionColor(svg, effectColor(markerSource))
        : readableMotionColor(svg, 'currentColor');
      colors.set(marker.id, markerColor);
    }
    let visual = scene.markers.get(marker.id);
    if (visual && visual.head.getAttribute('data-marker-label') !== marker.label) {
      visual.root.remove();
      scene.markers.delete(marker.id);
      visual = undefined;
    }
    if (!visual) {
      visual = createMarkerVisual(scene, marker, markerColor);
      scene.markers.set(marker.id, visual);
    }

    const scale = screenScale(svg);
    const inverseScale = 1 / scale;
    const currentDistance = plan.length * marker.routeProgress;
    const tangent = planTangent(plan, currentDistance, 5 * inverseScale);
    const reducedVisibility = options.reducedMotion ? 'hidden' : 'visible';
    const arrivalOpacity =
      marker.phase === 'arriving' ? Math.max(0, 0.72 * (1 - marker.arrivalProgress)) : 0;
    const movingOpacity =
      marker.phase === 'moving'
        ? Math.min(1, marker.routeProgress / 0.055)
        : marker.phase === 'arriving'
          ? Math.max(0, 1 - marker.arrivalProgress * 1.45)
          : 0;

    visual.root.setAttribute('color', markerColor);
    visual.head.setAttribute(
      'transform',
      `translate(${coordinate(point.x)} ${coordinate(point.y)})`,
    );
    visual.head.setAttribute('data-route-progress', `${marker.routeProgress}`);
    visual.head.setAttribute('data-marker-phase', marker.phase);
    visual.halo.setAttribute('r', coordinate(8 * inverseScale));
    visual.core.setAttribute('r', coordinate(4.5 * inverseScale));

    const cometLengths = [44, 28, 14];
    visual.comets.forEach((comet, index) => {
      const length = (cometLengths[index] ?? 14) * inverseScale;
      comet.setAttribute('d', pathDataBetween(plan, currentDistance - length, currentDistance));
      comet.setAttribute('opacity', coordinate(([0.1, 0.24, 0.84][index] ?? 0.1) * movingOpacity));
      comet.setAttribute('visibility', reducedVisibility);
    });

    let activeEdge = plan.edges[0];
    for (const edge of plan.edges) {
      if (currentDistance >= edge.startDistance) activeEdge = edge;
      else break;
    }
    if (activeEdge) {
      const traveled = Math.max(
        0,
        Math.min(activeEdge.length, currentDistance - activeEdge.startDistance),
      );
      const wakePathData = traveled > 0 ? pathDataBetween(activeEdge, 0, traveled) : '';
      visual.wakes.forEach((wake, index) => {
        wake.setAttribute('d', wakePathData);
        wake.removeAttribute('pathLength');
        wake.removeAttribute('stroke-dasharray');
        wake.removeAttribute('stroke-dashoffset');
        wake.setAttribute(
          'opacity',
          coordinate(([0.1, 0.68][index] ?? 0.1) * Math.max(0, movingOpacity)),
        );
        wake.setAttribute('visibility', reducedVisibility);
      });
    } else {
      for (const wake of visual.wakes) {
        wake.setAttribute('d', '');
        wake.setAttribute('opacity', '0');
        wake.setAttribute('visibility', reducedVisibility);
      }
    }

    visual.arrival.setAttribute('cx', coordinate(point.x));
    visual.arrival.setAttribute('cy', coordinate(point.y));
    visual.arrival.setAttribute('r', coordinate((10 + marker.arrivalProgress * 20) * inverseScale));
    visual.arrival.setAttribute('opacity', coordinate(arrivalOpacity));
    visual.arrival.setAttribute('data-arrival-progress', `${marker.arrivalProgress}`);
    visual.arrival.setAttribute(
      'visibility',
      !options.reducedMotion && marker.phase === 'arriving' ? 'visible' : 'hidden',
    );

    const occupied = nodeContainingPoint(svg, bindings, marker, point);
    if (occupied?.key !== visual.occupancyKey) {
      visual.occupancy?.remove();
      delete visual.occupancy;
      delete visual.occupancyKey;
      if (occupied) {
        const clone = occupied.shape.cloneNode(true);
        const matrix = relativeMatrix(svg, occupied.shape);
        if (clone instanceof SVGGraphicsElement && matrix) {
          clone.removeAttribute('id');
          clone.removeAttribute(TARGET_ATTRIBUTE);
          clone.removeAttribute(EFFECT_ATTRIBUTE);
          clone.setAttribute('data-mermotion-marker-occupancy', occupied.key);
          clone.setAttribute(
            'transform',
            `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`,
          );
          clone.setAttribute('vector-effect', 'non-scaling-stroke');
          clone.style.fill = 'none';
          clone.style.stroke = 'currentColor';
          clone.style.strokeWidth = '2';
          clone.style.opacity = '0.76';
          clone.style.pointerEvents = 'none';
          visual.root.insertBefore(clone, visual.arrival);
          visual.occupancy = clone;
          visual.occupancyKey = occupied.key;
        }
      }
    }
    visual.occupancy?.setAttribute('visibility', options.reducedMotion ? 'hidden' : 'visible');
    if (visual.occupancy) {
      visual.occupancy.style.strokeWidth =
        marker.phase === 'arriving' ? `${3.5 - marker.arrivalProgress * 1.5}` : '2';
      visual.occupancy.style.opacity =
        marker.phase === 'arriving' ? `${0.92 - marker.arrivalProgress * 0.16}` : '0.76';
    }
    visual.core.setAttribute(
      'visibility',
      occupied && !options.reducedMotion ? 'hidden' : 'visible',
    );
    visual.halo.setAttribute(
      'visibility',
      options.reducedMotion || occupied ? 'hidden' : 'visible',
    );

    if (visual.label) {
      const labelLanePoint = activeEdge
        ? (pointAtPlanDistance(plan, (activeEdge.startDistance + activeEdge.endDistance) / 2) ??
          point)
        : point;
      const activeEdgeIndex = activeEdge ? plan.edges.indexOf(activeEdge) : -1;
      const connection = activeEdge
        ? targets.find((target) => target.key === activeEdge.key)
        : undefined;
      const placementPoints = [
        labelLanePoint,
        ...(connection?.kind === 'message' || activeEdgeIndex < 0
          ? []
          : [
              bindingCenter(svg, bindings, marker.route[activeEdgeIndex]),
              bindingCenter(svg, bindings, marker.route[activeEdgeIndex + 1]),
            ].filter((candidate): candidate is Point => candidate !== undefined)),
      ];
      const callout = steadyLabelOffset(
        svg,
        bindings,
        placementPoints,
        tangent,
        marker.label,
        inverseScale,
      );
      const calloutOpacity = 1;
      const magnitude = Math.hypot(callout.x, callout.y) || 1;
      const direction = { x: callout.x / magnitude, y: callout.y / magnitude };
      const lineStart = 6.5 * inverseScale;
      const lineEnd = Math.max(lineStart, magnitude - Math.min(callout.width, callout.height) / 2);
      visual.label.leader.setAttribute('x1', coordinate(direction.x * lineStart));
      visual.label.leader.setAttribute('y1', coordinate(direction.y * lineStart));
      visual.label.leader.setAttribute('x2', coordinate(direction.x * lineEnd));
      visual.label.leader.setAttribute('y2', coordinate(direction.y * lineEnd));
      visual.label.group.setAttribute(
        'transform',
        `translate(${coordinate(callout.x)} ${coordinate(callout.y)}) scale(${coordinate(inverseScale)})`,
      );
      visual.label.group.setAttribute('opacity', coordinate(calloutOpacity));
      visual.label.group.setAttribute('data-callout-placement', `${callout.placement}`);
      visual.label.leader.setAttribute('opacity', coordinate(calloutOpacity));
      visual.label.background.setAttribute('x', coordinate(-callout.width / inverseScale / 2));
      visual.label.background.setAttribute('y', '-10.5');
      visual.label.background.setAttribute('width', coordinate(callout.width / inverseScale));
      visual.label.background.setAttribute('height', '21');
      visual.label.background.setAttribute('rx', '5');
      visual.label.text.setAttribute('font-size', '11');
    }
  });
  for (const [id, visual] of scene.markers) {
    if (activeIds.has(id)) continue;
    visual.root.remove();
    scene.markers.delete(id);
  }
}

function redrawOverlay(
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  targets: SemanticTarget[],
  frame: FrameState,
  options: ApplyFrameOptions,
): void {
  const needsOverlay = frame.traces.length > 0 || Object.keys(frame.markers).length > 0;
  if (!needsOverlay) {
    overlayScenes.get(svg)?.root.remove();
    overlayScenes.delete(svg);
    return;
  }
  const scene = ensureOverlayScene(svg);
  updateTraces(scene, svg, bindings, targets, frame, options);
  updateMarkers(scene, svg, bindings, targets, frame, options);
}

function isNoMotionFrame(frame: FrameState): boolean {
  return (
    frame.durationMs === 0 &&
    frame.traces.length === 0 &&
    Object.keys(frame.markers).length === 0 &&
    Object.values(frame.targets).every(
      (target) =>
        target.visible && target.opacity === 1 && target.highlight === 0 && target.pulse === 0,
    )
  );
}

export function applyFrameToSvg(
  root: ParentNode,
  targets: SemanticTarget[],
  frame: FrameState,
  options: ApplyFrameOptions = {},
): void {
  const motionRoot = svgRoot(root) ?? root;
  if (isNoMotionFrame(frame)) {
    if (managedMotionRoots.has(motionRoot)) clearMotionFromSvg(root);
    return;
  }
  managedMotionRoots.add(motionRoot);
  pauseNativeAnimations(root);
  const bindings = cachedEffectBindings(root);
  const svg = svgRoot(root);
  for (const [key, elements] of bindings) {
    const state = frame.targets[key];
    for (const element of elements) {
      const saved = saveOriginalStyle(element);
      if (!saved || typeof SVGElement === 'undefined' || !(element instanceof SVGElement)) continue;
      const styled = element;
      styled.style.opacity = state ? `${state.opacity}` : saved.opacity;
      styled.style.pointerEvents = state && !state.visible ? 'none' : saved.pointerEvents;
      const effect = state ? Math.max(state.highlight, state.pulse) : 0;
      if (effect > 0.001) {
        const inheritedColor = effectColor(element);
        const color =
          state?.color === 'inherit'
            ? inheritedColor
            : (state?.color ?? (svg ? readableMotionColor(svg, inheritedColor) : inheritedColor));
        styled.style.filter =
          state && state.pulse > state.highlight
            ? `drop-shadow(0 0 ${1 + state.pulse * 2}px ${color}) drop-shadow(0 0 ${3 + state.pulse * 5}px ${color})`
            : `drop-shadow(0 0 ${1 + effect * 2.5}px ${color})`;
      } else styled.style.filter = saved.filter;
    }
  }
  if (svg) redrawOverlay(svg, bindings, targets, frame, options);
}

export function clearMotionFromSvg(root: ParentNode): void {
  for (const element of allElements(root)) {
    const saved = originalStyles.get(element);
    if (saved && typeof SVGElement !== 'undefined' && element instanceof SVGElement) {
      const styled = element;
      styled.style.opacity = saved.opacity;
      styled.style.filter = saved.filter;
      styled.style.pointerEvents = saved.pointerEvents;
      styled.style.animationPlayState = saved.animationPlayState;
    }
  }
  root.querySelector('[data-mermotion-overlay]')?.remove();
  const svg = svgRoot(root);
  if (svg) {
    overlayScenes.delete(svg);
    pausedAnimationRoots.delete(svg);
    managedMotionRoots.delete(svg);
  } else pausedAnimationRoots.delete(root);
  effectBindingCache.delete(root);
  managedMotionRoots.delete(root);
}

export { TARGET_ATTRIBUTE };
