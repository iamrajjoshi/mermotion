import { pointInSvgSpace, screenScale, transformedElementBounds } from './svg-geometry.js';
import type { SvgBounds as Bounds, SvgPoint as Point } from './svg-geometry.js';
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
    /<g\b([^>]*\bclass=(?:"[^"]*\b(?:node|image-shape|icon-shape)\b[^"]*"|'[^']*\b(?:node|image-shape|icon-shape)\b[^']*')[^>]*)>([\s\S]*?)<\/g>/gi,
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
  const nodes = elements
    .filter((element) => element.matches('g.node[id], g.image-shape[id], g.icon-shape[id]'))
    .map((element) => ({ element, id: flowNodeId(element.id) }));
  const nodeIds = nodes.map(({ id }) => id);
  nodes.forEach(({ element, id }) => {
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
  baseOpacity: number;
  opacity: string;
  opacityPriority: string;
  filter: string;
  filterPriority: string;
  pointerEvents: string;
  pointerEventsPriority: string;
  animationName: string;
  animationNamePriority: string;
  animationPlayState: string;
  animationPlayStatePriority: string;
  transitionProperty: string;
  transitionPropertyPriority: string;
}

const originalStyles = new WeakMap<Element, OriginalStyle>();
const effectColors = new WeakMap<Element, string>();
const pausedAnimationRoots = new WeakSet<ParentNode>();
const managedMotionRoots = new WeakSet<ParentNode>();
const effectBindingCache = new WeakMap<ParentNode, Map<string, Element[]>>();

interface SampledGeometry {
  points: Point[];
  distances: number[];
  length: number;
  localLength: number;
}

interface RoutePlan {
  points: Point[];
  distances: number[];
  length: number;
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
  tails: [SVGPathElement, SVGPathElement];
  routeKey: string;
  incarnation: number;
  label?: {
    group: SVGGElement;
    leader: SVGLineElement;
    background: SVGRectElement;
    text: SVGTextElement;
  };
}

interface TraceVisual {
  core: MeasurableGeometry;
  glow: MeasurableGeometry;
}

interface OverlayScene {
  root: SVGGElement;
  traceLayer: SVGGElement;
  markerLayer: SVGGElement;
  markers: Map<string, MarkerVisual>;
  traces: Map<string, TraceVisual>;
  traceCaps: Map<string, SVGCircleElement>;
  traceGroups: Map<string, SVGGElement>;
}

const sampledGeometryCache = new WeakMap<SVGGraphicsElement, SampledGeometry>();
const bindingCenterCache = new WeakMap<SVGSVGElement, Map<string, Point>>();
const routePlanCache = new WeakMap<SVGSVGElement, Map<string, RoutePlan>>();
const overlayScenes = new WeakMap<SVGSVGElement, OverlayScene>();
const calloutObstacleCache = new WeakMap<SVGSVGElement, Bounds[]>();
const backdropColors = new WeakMap<SVGSVGElement, RgbColor>();

function saveOriginalStyle(element: Element): OriginalStyle | undefined {
  if (typeof SVGElement === 'undefined' || !(element instanceof SVGElement)) return undefined;
  const styled = element;
  const saved = originalStyles.get(element) ?? {
    baseOpacity: 1,
    opacity: styled.style.opacity,
    opacityPriority: styled.style.getPropertyPriority('opacity'),
    filter: styled.style.filter,
    filterPriority: styled.style.getPropertyPriority('filter'),
    pointerEvents: styled.style.pointerEvents,
    pointerEventsPriority: styled.style.getPropertyPriority('pointer-events'),
    animationName: styled.style.animationName,
    animationNamePriority: styled.style.getPropertyPriority('animation-name'),
    animationPlayState: styled.style.animationPlayState,
    animationPlayStatePriority: styled.style.getPropertyPriority('animation-play-state'),
    transitionProperty: styled.style.transitionProperty,
    transitionPropertyPriority: styled.style.getPropertyPriority('transition-property'),
  };
  originalStyles.set(element, saved);
  return saved;
}

function restoreInlineStyle(
  style: CSSStyleDeclaration,
  property: string,
  value: string,
  priority: string,
): void {
  if (value) style.setProperty(property, value, priority);
  else style.removeProperty(property);
}

function pauseNativeAnimations(root: ParentNode): void {
  const animationRoot = svgRoot(root) ?? root;
  if (pausedAnimationRoots.has(animationRoot)) return;
  for (const element of allElements(animationRoot)) {
    if (typeof SVGElement === 'undefined' || !(element instanceof SVGElement)) continue;
    saveOriginalStyle(element);
    // Only override the longhands that activate native interpolation. Assigning the shorthands
    // would erase authored inline duration/delay/timing longhands and make clearMotionFromSvg
    // unable to restore the Mermaid SVG byte-for-byte.
    element.style.setProperty('animation-name', 'none', 'important');
    element.style.setProperty('animation-play-state', 'paused', 'important');
    element.style.setProperty('transition-property', 'none', 'important');
    const saved = originalStyles.get(element);
    const opacity =
      typeof getComputedStyle === 'undefined'
        ? 1
        : Number.parseFloat(getComputedStyle(element).opacity);
    if (saved) saved.baseOpacity = Number.isFinite(opacity) ? opacity : 1;
  }
  pausedAnimationRoots.add(animationRoot);
}

function effectColor(element: Element): string {
  if (typeof getComputedStyle === 'undefined') return 'currentColor';
  const cached = effectColors.get(element);
  if (cached) return cached;
  const computed = getComputedStyle(element);
  const color =
    computed.stroke && computed.stroke !== 'none' && computed.stroke !== 'transparent'
      ? computed.stroke
      : computed.color && computed.color !== 'transparent'
        ? computed.color
        : computed.fill && computed.fill !== 'none'
          ? computed.fill
          : 'currentColor';
  effectColors.set(element, color);
  return color;
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
  const cached = backdropColors.get(svg);
  if (cached) return cached;
  let current: Element | null = svg;
  while (current) {
    const color = parseRgbColor(getComputedStyle(current).backgroundColor);
    if (color) {
      backdropColors.set(svg, color);
      return color;
    }
    current = current.parentElement;
  }
  const fallback = { red: 13, green: 23, blue: 21 };
  backdropColors.set(svg, fallback);
  return fallback;
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
  const cache = bindingCenterCache.get(svg) ?? new Map<string, Point>();
  bindingCenterCache.set(svg, cache);
  const cached = cache.get(key);
  if (cached) return cached;
  const element = bindings
    .get(key)
    ?.find(
      (candidate) =>
        typeof SVGGraphicsElement !== 'undefined' && candidate instanceof SVGGraphicsElement,
    );
  const center = targetCenter(svg, element);
  if (center) cache.set(key, center);
  return center;
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
    return point ? { points: [point], distances: [0], length: 0 } : undefined;
  }
  if (marker.edgeKeys.length !== marker.route.length - 1) return undefined;

  const points: Point[] = [];
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
    appendDistinct(points, firstEdgePoint);
    for (const point of oriented.points.slice(1, -1)) appendDistinct(points, point);
    appendDistinct(points, lastEdgePoint);
    if (!isMessage) appendDistinct(points, to);
  }
  if (points.length === 0) return undefined;
  return withDistances(points);
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

function markerPlan(
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  marker: FrameMarkerState,
  targets: SemanticTarget[],
): RoutePlan | undefined {
  const cache = routePlanCache.get(svg) ?? new Map<string, RoutePlan>();
  routePlanCache.set(svg, cache);
  const cacheKey = markerRouteKey(marker);
  let plan = cache.get(cacheKey);
  if (plan === undefined) {
    plan = buildRoutePlan(svg, bindings, marker, targets);
    if (plan) cache.set(cacheKey, plan);
  }
  return plan;
}

function markerRouteKey(marker: FrameMarkerState): string {
  return `${marker.route.join('\u0000')}\u0001${marker.edgeKeys.join('\u0000')}`;
}

function elementBounds(svg: SVGSVGElement, element: SVGGraphicsElement): Bounds | undefined {
  return transformedElementBounds(svg, element);
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
  const distanceFromHead = 32 * inverseScale + height / 2;
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
  const candidates = [distanceFromHead, distanceFromHead + 42 * inverseScale].flatMap(
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
  return candidates.reduce((selected, candidate) =>
    candidate.score < selected.score ? candidate : selected,
  );
}

function routeLabelTangent(plan: RoutePlan): Point {
  const first = plan.points[0];
  const last = plan.points[plan.points.length - 1];
  if (!first || !last) return { x: 1, y: 0 };
  const delta = { x: last.x - first.x, y: last.y - first.y };
  if (Math.hypot(delta.x, delta.y) > Math.max(1, plan.length * 0.08)) {
    const magnitude = Math.hypot(delta.x, delta.y);
    return { x: delta.x / magnitude, y: delta.y / magnitude };
  }
  const xs = plan.points.map(({ x }) => x);
  const ys = plan.points.map(({ y }) => y);
  return Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
    ? { x: 1, y: 0 }
    : { x: 0, y: 1 };
}

function routeLabelPlacementPoints(plan: RoutePlan): Point[] {
  const anchor = pointAtPlanDistance(plan, plan.length / 2) ?? plan.points[0];
  const samples = Array.from({ length: 9 }, (_, index) =>
    pointAtPlanDistance(plan, (plan.length * index) / 8),
  ).filter((point): point is Point => point !== undefined);
  return anchor ? [anchor, ...samples] : samples;
}

function ensureOverlayScene(svg: SVGSVGElement): OverlayScene {
  const existing = overlayScenes.get(svg);
  if (existing?.root.isConnected) return existing;
  svg.querySelector('[data-mermotion-overlay]')?.remove();
  const root = document.createElementNS(SVG_NAMESPACE, 'g');
  root.setAttribute('data-mermotion-overlay', 'true');
  setOverlayPresentation(root, 'pointer-events', 'none');
  setOverlayPresentation(root, 'visibility', 'visible');
  setOverlayPresentation(root, 'display', 'inline');
  setOverlayPresentation(root, 'opacity', '1');
  setOverlayPresentation(root, 'transform', 'none');
  const traceLayer = document.createElementNS(SVG_NAMESPACE, 'g');
  traceLayer.setAttribute('data-mermotion-layer', 'traces');
  setOverlayPresentation(traceLayer, 'visibility', 'visible');
  setOverlayPresentation(traceLayer, 'pointer-events', 'none');
  setOverlayPresentation(traceLayer, 'opacity', '1');
  setOverlayPresentation(traceLayer, 'transform', 'none');
  const markerLayer = document.createElementNS(SVG_NAMESPACE, 'g');
  markerLayer.setAttribute('data-mermotion-layer', 'markers');
  setOverlayPresentation(markerLayer, 'visibility', 'visible');
  setOverlayPresentation(markerLayer, 'pointer-events', 'none');
  setOverlayPresentation(markerLayer, 'opacity', '1');
  setOverlayPresentation(markerLayer, 'transform', 'none');
  root.append(traceLayer, markerLayer);
  svg.append(root);
  const scene: OverlayScene = {
    root,
    traceLayer,
    markerLayer,
    markers: new Map(),
    traces: new Map(),
    traceCaps: new Map(),
    traceGroups: new Map(),
  };
  overlayScenes.set(svg, scene);
  return scene;
}

function setOverlayPresentation(element: SVGElement, property: string, value: string): void {
  element.style.setProperty('display', 'inline', 'important');
  element.style.setProperty('pointer-events', 'none', 'important');
  element.style.setProperty('transition', 'none', 'important');
  element.style.setProperty('animation', 'none', 'important');
  element.style.setProperty('filter', 'none', 'important');
  element.style.setProperty('clip-path', 'none', 'important');
  element.style.setProperty('mask', 'none', 'important');
  element.style.setProperty('color', 'inherit', 'important');
  element.setAttribute(property, value);
  element.style.setProperty(property, value, 'important');
}

function orderOverlayChildren(parent: SVGGElement, ordered: SVGElement[]): void {
  let cursor = parent.firstElementChild;
  for (const element of ordered) {
    if (cursor === element) {
      cursor = cursor.nextElementSibling;
      continue;
    }
    parent.insertBefore(element, cursor);
  }
}

function styledPath(attribute: string, value: string): SVGPathElement {
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute(attribute, value);
  setOverlayPresentation(path, 'fill', 'none');
  setOverlayPresentation(path, 'stroke', 'currentColor');
  setOverlayPresentation(path, 'stroke-opacity', '1');
  setOverlayPresentation(path, 'stroke-linecap', 'round');
  setOverlayPresentation(path, 'stroke-linejoin', 'round');
  setOverlayPresentation(path, 'vector-effect', 'none');
  setOverlayPresentation(path, 'pointer-events', 'none');
  setOverlayPresentation(path, 'display', 'inline');
  setOverlayPresentation(path, 'transform', 'none');
  setOverlayPresentation(path, 'visibility', 'visible');
  return path;
}

function createMarkerVisual(
  scene: OverlayScene,
  marker: FrameMarkerState,
  color: string,
  plan: RoutePlan,
  routeKey: string,
): MarkerVisual {
  const root = document.createElementNS(SVG_NAMESPACE, 'g');
  root.setAttribute('data-mermotion-marker-decoration', marker.id);
  setOverlayPresentation(root, 'color', color);
  setOverlayPresentation(root, 'pointer-events', 'none');
  setOverlayPresentation(root, 'visibility', 'visible');
  setOverlayPresentation(root, 'display', 'inline');
  setOverlayPresentation(root, 'opacity', '1');
  setOverlayPresentation(root, 'transform', 'none');

  const routePathData = pointsPathData(plan.points);
  const tailSoft = styledPath('data-mermotion-tail', 'soft');
  tailSoft.setAttribute('d', routePathData);
  tailSoft.setAttribute('pathLength', '1');
  setOverlayPresentation(tailSoft, 'stroke-width', '6');
  setOverlayPresentation(tailSoft, 'stroke-linecap', 'butt');
  setOverlayPresentation(tailSoft, 'stroke-dasharray', '0 0 0 1');
  setOverlayPresentation(tailSoft, 'stroke-dashoffset', '0');
  setOverlayPresentation(tailSoft, 'opacity', '0');
  const tailCore = styledPath('data-mermotion-tail', 'core');
  tailCore.setAttribute('d', routePathData);
  tailCore.setAttribute('pathLength', '1');
  setOverlayPresentation(tailCore, 'stroke-width', '2.2');
  setOverlayPresentation(tailCore, 'stroke-linecap', 'butt');
  setOverlayPresentation(tailCore, 'stroke-dasharray', '0 0 0 1');
  setOverlayPresentation(tailCore, 'stroke-dashoffset', '0');
  setOverlayPresentation(tailCore, 'opacity', '0');

  const arrival = document.createElementNS(SVG_NAMESPACE, 'circle');
  arrival.setAttribute('data-mermotion-arrival', '');
  setOverlayPresentation(arrival, 'fill', 'none');
  setOverlayPresentation(arrival, 'stroke', 'currentColor');
  setOverlayPresentation(arrival, 'stroke-opacity', '1');
  setOverlayPresentation(arrival, 'stroke-width', '1.8');
  setOverlayPresentation(arrival, 'vector-effect', 'non-scaling-stroke');
  setOverlayPresentation(arrival, 'visibility', 'hidden');
  setOverlayPresentation(arrival, 'opacity', '0');
  setOverlayPresentation(arrival, 'display', 'inline');
  setOverlayPresentation(arrival, 'transform', 'none');
  arrival.setAttribute('data-arrival-progress', '0');

  const head = document.createElementNS(SVG_NAMESPACE, 'g');
  head.setAttribute('data-marker-id', marker.id);
  head.setAttribute('data-marker-label', marker.label);
  head.setAttribute('data-marker-phase', marker.phase);
  setOverlayPresentation(head, 'pointer-events', 'none');
  setOverlayPresentation(head, 'visibility', 'visible');
  setOverlayPresentation(head, 'opacity', '1');
  setOverlayPresentation(head, 'display', 'inline');

  const halo = document.createElementNS(SVG_NAMESPACE, 'circle');
  halo.setAttribute('data-mermotion-marker-halo', '');
  setOverlayPresentation(halo, 'fill', 'currentColor');
  setOverlayPresentation(halo, 'fill-opacity', '1');
  setOverlayPresentation(halo, 'opacity', '0.14');
  setOverlayPresentation(halo, 'display', 'inline');
  setOverlayPresentation(halo, 'transform', 'none');
  head.append(halo);

  const core = document.createElementNS(SVG_NAMESPACE, 'circle');
  core.setAttribute('data-mermotion-marker-core', '');
  setOverlayPresentation(core, 'fill', 'currentColor');
  setOverlayPresentation(core, 'fill-opacity', '1');
  setOverlayPresentation(core, 'stroke', '#ecfdf5');
  setOverlayPresentation(core, 'stroke-opacity', '1');
  setOverlayPresentation(core, 'stroke-width', '1.35');
  setOverlayPresentation(core, 'vector-effect', 'non-scaling-stroke');
  setOverlayPresentation(core, 'display', 'inline');
  setOverlayPresentation(core, 'opacity', '1');
  setOverlayPresentation(core, 'transform', 'none');
  head.append(core);

  let labelVisual: MarkerVisual['label'];
  if (marker.label) {
    const labelGroup = document.createElementNS(SVG_NAMESPACE, 'g');
    labelGroup.setAttribute('data-mermotion-marker-callout', '');
    setOverlayPresentation(labelGroup, 'pointer-events', 'none');
    setOverlayPresentation(labelGroup, 'display', 'inline');
    setOverlayPresentation(labelGroup, 'visibility', 'visible');
    const leader = document.createElementNS(SVG_NAMESPACE, 'line');
    leader.setAttribute('data-mermotion-marker-leader', '');
    setOverlayPresentation(leader, 'stroke', 'currentColor');
    setOverlayPresentation(leader, 'stroke-width', '1');
    setOverlayPresentation(leader, 'stroke-opacity', '0.58');
    setOverlayPresentation(leader, 'vector-effect', 'non-scaling-stroke');
    setOverlayPresentation(leader, 'display', 'inline');
    setOverlayPresentation(leader, 'transform', 'none');
    setOverlayPresentation(leader, 'visibility', 'visible');
    const background = document.createElementNS(SVG_NAMESPACE, 'rect');
    setOverlayPresentation(background, 'fill', '#0d1715');
    setOverlayPresentation(background, 'fill-opacity', '1');
    setOverlayPresentation(background, 'stroke', 'currentColor');
    setOverlayPresentation(background, 'stroke-opacity', '0.56');
    setOverlayPresentation(background, 'stroke-width', '1');
    setOverlayPresentation(background, 'vector-effect', 'non-scaling-stroke');
    setOverlayPresentation(background, 'display', 'inline');
    setOverlayPresentation(background, 'opacity', '1');
    setOverlayPresentation(background, 'transform', 'none');
    setOverlayPresentation(background, 'visibility', 'visible');
    const text = document.createElementNS(SVG_NAMESPACE, 'text');
    setOverlayPresentation(text, 'x', '0');
    setOverlayPresentation(text, 'y', '0');
    setOverlayPresentation(text, 'dominant-baseline', 'central');
    setOverlayPresentation(text, 'text-anchor', 'middle');
    setOverlayPresentation(text, 'font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
    setOverlayPresentation(text, 'font-weight', '650');
    setOverlayPresentation(text, 'fill', '#f6fbf9');
    setOverlayPresentation(text, 'fill-opacity', '1');
    setOverlayPresentation(text, 'display', 'inline');
    setOverlayPresentation(text, 'opacity', '1');
    setOverlayPresentation(text, 'transform', 'none');
    setOverlayPresentation(text, 'visibility', 'visible');
    text.textContent = marker.label;
    labelGroup.append(background, text);
    head.append(leader, labelGroup);
    labelVisual = { group: labelGroup, leader, background, text };
  }

  root.append(tailSoft, tailCore, arrival, head);
  scene.markerLayer.append(root);
  return {
    root,
    head,
    halo,
    core,
    arrival,
    tails: [tailSoft, tailCore],
    routeKey,
    incarnation: marker.incarnation,
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
  inverseScale: number,
): void {
  const activeKeys = new Set<string>();
  const activeCaps = new Set<string>();
  const activeTraceIds = new Set<string>();
  frame.traces.forEach((trace) => {
    activeTraceIds.add(trace.id);
    let traceGroup = scene.traceGroups.get(trace.id);
    if (!traceGroup) {
      traceGroup = document.createElementNS(SVG_NAMESPACE, 'g');
      traceGroup.setAttribute('data-mermotion-trace-group', trace.id);
      setOverlayPresentation(traceGroup, 'visibility', 'visible');
      setOverlayPresentation(traceGroup, 'pointer-events', 'none');
      setOverlayPresentation(traceGroup, 'opacity', '1');
      setOverlayPresentation(traceGroup, 'transform', 'none');
      scene.traceLayer.append(traceGroup);
      scene.traceGroups.set(trace.id, traceGroup);
    }
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
          clone.setAttribute('pathLength', '1');
          setOverlayPresentation(clone, 'fill', 'none');
          setOverlayPresentation(clone, 'stroke-opacity', '1');
          setOverlayPresentation(clone, 'stroke-dasharray', '1');
          setOverlayPresentation(clone, 'stroke-dashoffset', '1');
          setOverlayPresentation(clone, 'stroke-linecap', 'round');
          setOverlayPresentation(clone, 'stroke-linejoin', 'round');
          setOverlayPresentation(clone, 'vector-effect', 'none');
          setOverlayPresentation(clone, 'pointer-events', 'none');
          if (layer === 'core') {
            clone.setAttribute('data-mermotion-trace', traceKey);
            clone.setAttribute('data-mermotion-trace-source', key);
          } else clone.setAttribute('data-mermotion-trace-layer', 'glow');
          return clone;
        };
        const core = createClone('core');
        const glow = createClone('glow');
        if (!core || !glow) return;
        setOverlayPresentation(core, 'opacity', '0.92');
        setOverlayPresentation(glow, 'opacity', '0.14');
        traceGroup.append(glow, core);
        visual = { core, glow };
        scene.traces.set(traceKey, visual);
      }
      const sourceColor =
        trace.color && trace.color !== 'inherit' ? undefined : effectColor(source);
      const color =
        trace.color === 'inherit'
          ? (sourceColor ?? 'currentColor')
          : (trace.color ?? readableMotionColor(svg, sourceColor ?? 'currentColor'));
      setOverlayPresentation(visual.core, 'stroke', color);
      setOverlayPresentation(visual.glow, 'stroke', color);
      setOverlayPresentation(visual.core, 'stroke-width', coordinate(3 * inverseScale));
      setOverlayPresentation(visual.glow, 'stroke-width', coordinate(7 * inverseScale));
      const edgeProgress =
        sampled.length <= 0 || totalLength <= 0
          ? 0
          : Math.max(
              0,
              Math.min(1, (trace.progress * totalLength - consumedLength) / sampled.length),
            );
      for (const clone of [visual.glow, visual.core]) {
        setOverlayPresentation(clone, 'stroke-dashoffset', coordinate(1 - edgeProgress));
      }
      setOverlayPresentation(
        visual.glow,
        'visibility',
        options.reducedMotion ? 'hidden' : 'visible',
      );
      setOverlayPresentation(visual.core, 'visibility', 'visible');
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
        const sourceColor =
          trace.color && trace.color !== 'inherit' ? undefined : effectColor(last.source);
        capColor =
          trace.color === 'inherit'
            ? (sourceColor ?? 'currentColor')
            : (trace.color ?? readableMotionColor(svg, sourceColor ?? 'currentColor'));
      }
    }
    if (capPoint) {
      activeCaps.add(trace.id);
      let cap = scene.traceCaps.get(trace.id);
      if (!cap) {
        cap = document.createElementNS(SVG_NAMESPACE, 'circle');
        cap.setAttribute('data-mermotion-trace-cap', trace.id);
        setOverlayPresentation(cap, 'stroke', 'none');
        setOverlayPresentation(cap, 'stroke-opacity', '1');
        setOverlayPresentation(cap, 'pointer-events', 'none');
        setOverlayPresentation(cap, 'opacity', '1');
        setOverlayPresentation(cap, 'vector-effect', 'none');
        setOverlayPresentation(cap, 'display', 'inline');
        setOverlayPresentation(cap, 'transform', 'none');
        traceGroup.append(cap);
        scene.traceCaps.set(trace.id, cap);
      }
      setOverlayPresentation(cap, 'cx', coordinate(capPoint.x));
      setOverlayPresentation(cap, 'cy', coordinate(capPoint.y));
      setOverlayPresentation(cap, 'r', coordinate(2.25 * inverseScale));
      setOverlayPresentation(cap, 'fill', capColor);
      setOverlayPresentation(cap, 'fill-opacity', '1');
      setOverlayPresentation(cap, 'visibility', options.reducedMotion ? 'hidden' : 'visible');
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
  for (const [id, group] of scene.traceGroups) {
    if (activeTraceIds.has(id)) continue;
    group.remove();
    scene.traceGroups.delete(id);
  }
  orderOverlayChildren(
    scene.traceLayer,
    frame.traces.flatMap((trace) => {
      const group = scene.traceGroups.get(trace.id);
      return group ? [group] : [];
    }),
  );
}

function updateMarkers(
  scene: OverlayScene,
  svg: SVGSVGElement,
  bindings: Map<string, Element[]>,
  targets: SemanticTarget[],
  frame: FrameState,
  options: ApplyFrameOptions,
  inverseScale: number,
): void {
  const activeIds = new Set<string>();
  Object.values(frame.markers).forEach((marker) => {
    const plan = markerPlan(svg, bindings, marker, targets);
    const point = plan ? pointOnPlan(plan, marker.routeProgress) : undefined;
    if (!plan || !point) return;
    activeIds.add(marker.id);
    const colorSourceKey =
      marker.colorSourceKey ?? marker.edgeKeys[0] ?? marker.route[0] ?? marker.at;
    const markerSource =
      bindingGeometry(bindings, colorSourceKey) ?? bindings.get(colorSourceKey)?.[0];
    const markerColor =
      marker.color === 'inherit'
        ? markerSource
          ? effectColor(markerSource)
          : readableMotionColor(svg, 'currentColor')
        : (marker.color ??
          (markerSource
            ? readableMotionColor(svg, effectColor(markerSource))
            : readableMotionColor(svg, 'currentColor')));
    const routeKey = markerRouteKey(marker);
    let visual = scene.markers.get(marker.id);
    if (
      visual &&
      (visual.head.getAttribute('data-marker-label') !== marker.label ||
        visual.incarnation !== marker.incarnation)
    ) {
      visual.root.remove();
      scene.markers.delete(marker.id);
      visual = undefined;
    }
    if (!visual) {
      visual = createMarkerVisual(scene, marker, markerColor, plan, routeKey);
      scene.markers.set(marker.id, visual);
    } else if (visual.routeKey !== routeKey) {
      const routePathData = pointsPathData(plan.points);
      for (const tail of visual.tails) tail.setAttribute('d', routePathData);
      visual.routeKey = routeKey;
    }

    const arrivalProgress = Math.max(0, Math.min(1, marker.arrivalProgress));
    const arrivalBell = Math.sin(Math.PI * arrivalProgress) ** 2;
    const arrivalEase = 1 - (1 - arrivalProgress) ** 3;
    const arrivalOpacity =
      marker.phase === 'arriving' && !options.reducedMotion ? 0.42 * arrivalBell : 0;
    const movingOpacity =
      marker.phase === 'moving'
        ? Math.min(1, marker.routeProgress / 0.055)
        : marker.phase === 'arriving'
          ? Math.max(0, 1 - arrivalProgress * arrivalProgress * (3 - 2 * arrivalProgress))
          : 0;

    setOverlayPresentation(visual.root, 'color', markerColor);
    setOverlayPresentation(
      visual.head,
      'transform',
      `translate(${coordinate(point.x)} ${coordinate(point.y)})`,
    );
    visual.head.setAttribute('data-route-progress', `${marker.routeProgress}`);
    visual.head.setAttribute('data-marker-phase', marker.phase);
    setOverlayPresentation(visual.halo, 'r', coordinate(8 * inverseScale));
    setOverlayPresentation(visual.core, 'r', coordinate(4.5 * inverseScale));

    const tails = [
      { element: visual.tails[0], length: 34, opacity: 0.12, width: 6 },
      { element: visual.tails[1], length: 19, opacity: 0.7, width: 2.2 },
    ] as const;
    for (const { element: tail, length, opacity, width } of tails) {
      const normalizedLength =
        plan.length <= 0 ? 0 : Math.max(0, Math.min(0.45, (length * inverseScale) / plan.length));
      const paintedLength = Math.min(normalizedLength, marker.routeProgress);
      const leadingGap = Math.max(0, marker.routeProgress - paintedLength);
      const trailingGap = Math.max(0, 1 - marker.routeProgress);
      setOverlayPresentation(
        tail,
        'stroke-dasharray',
        `0 ${coordinate(leadingGap)} ${coordinate(paintedLength)} ${coordinate(trailingGap)}`,
      );
      setOverlayPresentation(tail, 'stroke-dashoffset', '0');
      setOverlayPresentation(tail, 'stroke-width', coordinate(width * inverseScale));
      setOverlayPresentation(
        tail,
        'opacity',
        coordinate(options.reducedMotion ? 0 : opacity * movingOpacity),
      );
    }

    setOverlayPresentation(visual.arrival, 'cx', coordinate(point.x));
    setOverlayPresentation(visual.arrival, 'cy', coordinate(point.y));
    setOverlayPresentation(visual.arrival, 'r', coordinate((8 + arrivalEase * 9) * inverseScale));
    setOverlayPresentation(visual.arrival, 'opacity', coordinate(arrivalOpacity));
    visual.arrival.setAttribute('data-arrival-progress', `${marker.arrivalProgress}`);
    setOverlayPresentation(
      visual.arrival,
      'visibility',
      !options.reducedMotion && marker.phase === 'arriving' && arrivalOpacity > 0
        ? 'visible'
        : 'hidden',
    );

    setOverlayPresentation(visual.core, 'visibility', 'visible');
    setOverlayPresentation(visual.halo, 'visibility', options.reducedMotion ? 'hidden' : 'visible');

    if (visual.label) {
      const callout = steadyLabelOffset(
        svg,
        bindings,
        routeLabelPlacementPoints(plan),
        routeLabelTangent(plan),
        marker.label,
        inverseScale,
      );
      const calloutOpacity = 1;
      const magnitude = Math.hypot(callout.x, callout.y) || 1;
      const direction = { x: callout.x / magnitude, y: callout.y / magnitude };
      const lineStart = 6.5 * inverseScale;
      const lineEnd = Math.max(lineStart, magnitude - Math.min(callout.width, callout.height) / 2);
      setOverlayPresentation(visual.label.leader, 'x1', coordinate(direction.x * lineStart));
      setOverlayPresentation(visual.label.leader, 'y1', coordinate(direction.y * lineStart));
      setOverlayPresentation(visual.label.leader, 'x2', coordinate(direction.x * lineEnd));
      setOverlayPresentation(visual.label.leader, 'y2', coordinate(direction.y * lineEnd));
      setOverlayPresentation(
        visual.label.group,
        'transform',
        `translate(${coordinate(callout.x)} ${coordinate(callout.y)}) scale(${coordinate(inverseScale)})`,
      );
      setOverlayPresentation(visual.label.group, 'opacity', coordinate(calloutOpacity));
      visual.label.group.setAttribute('data-callout-placement', `${callout.placement}`);
      setOverlayPresentation(visual.label.leader, 'opacity', coordinate(calloutOpacity));
      setOverlayPresentation(
        visual.label.background,
        'x',
        coordinate(-callout.width / inverseScale / 2),
      );
      setOverlayPresentation(visual.label.background, 'y', '-10.5');
      setOverlayPresentation(
        visual.label.background,
        'width',
        coordinate(callout.width / inverseScale),
      );
      setOverlayPresentation(visual.label.background, 'height', '21');
      setOverlayPresentation(visual.label.background, 'rx', '5');
      setOverlayPresentation(visual.label.text, 'font-size', '11');
    }
  });
  for (const [id, visual] of scene.markers) {
    if (activeIds.has(id)) continue;
    visual.root.remove();
    scene.markers.delete(id);
  }
  orderOverlayChildren(
    scene.markerLayer,
    Object.values(frame.markers).flatMap((marker) => {
      const visual = scene.markers.get(marker.id);
      return visual ? [visual.root] : [];
    }),
  );
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
  const inverseScale = 1 / screenScale(svg);
  updateTraces(scene, svg, bindings, targets, frame, options, inverseScale);
  updateMarkers(scene, svg, bindings, targets, frame, options, inverseScale);
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
      if (state?.opacityControlled) {
        styled.style.setProperty('opacity', `${saved.baseOpacity * state.opacity}`, 'important');
      } else restoreInlineStyle(styled.style, 'opacity', saved.opacity, saved.opacityPriority);
      if (state && !state.visible) {
        styled.style.setProperty('pointer-events', 'none', 'important');
      } else {
        restoreInlineStyle(
          styled.style,
          'pointer-events',
          saved.pointerEvents,
          saved.pointerEventsPriority,
        );
      }
      const effect = state ? Math.max(state.highlight, state.pulse) : 0;
      if (effect > 0.001) {
        const color =
          state?.color && state.color !== 'inherit'
            ? state.color
            : (() => {
                const inheritedColor = effectColor(element);
                return state?.color === 'inherit' || !svg
                  ? inheritedColor
                  : readableMotionColor(svg, inheritedColor);
              })();
        const filter =
          state && state.pulse > state.highlight
            ? `drop-shadow(0 0 ${1 + state.pulse * 2}px ${color}) drop-shadow(0 0 ${3 + state.pulse * 5}px ${color})`
            : `drop-shadow(0 0 ${1 + effect * 2.5}px ${color})`;
        styled.style.setProperty('filter', filter, 'important');
      } else restoreInlineStyle(styled.style, 'filter', saved.filter, saved.filterPriority);
    }
  }
  if (svg) redrawOverlay(svg, bindings, targets, frame, options);
}

export function clearMotionFromSvg(root: ParentNode): void {
  const styledElements: Array<{ element: SVGElement; saved: OriginalStyle }> = [];
  for (const element of allElements(root)) {
    const saved = originalStyles.get(element);
    if (saved && typeof SVGElement !== 'undefined' && element instanceof SVGElement) {
      const styled = element;
      restoreInlineStyle(styled.style, 'opacity', saved.opacity, saved.opacityPriority);
      restoreInlineStyle(styled.style, 'filter', saved.filter, saved.filterPriority);
      restoreInlineStyle(
        styled.style,
        'pointer-events',
        saved.pointerEvents,
        saved.pointerEventsPriority,
      );
      styledElements.push({ element: styled, saved });
    }
  }

  // Commit the source-owned visual values while transitions and animations are still neutralized.
  // Restoring the authored transition first would tween from the last sampled frame back to Mermaid
  // over several seconds, which makes deleting the final cue visibly nondeterministic.
  if (typeof getComputedStyle !== 'undefined') {
    for (const { element } of styledElements) void getComputedStyle(element).opacity;
  }

  for (const { element: styled, saved } of styledElements) {
    restoreInlineStyle(
      styled.style,
      'animation-name',
      saved.animationName,
      saved.animationNamePriority,
    );
    restoreInlineStyle(
      styled.style,
      'animation-play-state',
      saved.animationPlayState,
      saved.animationPlayStatePriority,
    );
    restoreInlineStyle(
      styled.style,
      'transition-property',
      saved.transitionProperty,
      saved.transitionPropertyPriority,
    );
    originalStyles.delete(styled);
    effectColors.delete(styled);
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
