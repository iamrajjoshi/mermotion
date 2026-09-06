import { parseMotion } from './language.js';
import { wholeSourceSpan } from './spans.js';
import type {
  CompileOptions,
  CompileResult,
  CompiledEvent,
  CompiledMarker,
  CompiledTimeline,
  Diagnostic,
  DiagramDocument,
  EffectStatement,
  FrameMarkerState,
  FrameState,
  FrameTargetState,
  MotionDocument,
  MotionDefaults,
  MotionEasing,
  MotionSelector,
  MotionStatement,
  MotionTiming,
  SemanticTarget,
  SourceSpan,
} from './types.js';

const MOVE_ARRIVAL_DURATION_MS = 200;

function compileDiagnostic(
  code: string,
  message: string,
  span: SourceSpan,
  severity: Diagnostic['severity'] = 'error',
): Diagnostic {
  return { code, message, span, severity };
}

function isMotionDocument(document: DiagramDocument | MotionDocument): document is MotionDocument {
  return 'version' in document && document.version === 'motionDiagram-v1';
}

function getMotionDocument(input: DiagramDocument | MotionDocument): {
  document?: MotionDocument;
  diagnostics: Diagnostic[];
} {
  if (isMotionDocument(input)) return { document: input, diagnostics: [] };
  const source = input.motionSource ?? '';
  if (source.trim() === '') {
    return {
      document: {
        version: 'motionDiagram-v1',
        source,
        statements: [],
        defaults: { durationMs: 400, easing: 'ease-out' },
        comments: [],
      },
      diagnostics: [],
    };
  }
  const parsed = parseMotion(source);
  return {
    ...(parsed.document ? { document: parsed.document } : {}),
    diagnostics: parsed.diagnostics,
  };
}

function inferredKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function matchesIdTarget(
  selector: Extract<MotionSelector, { kind: 'id' }>,
  targets: SemanticTarget[],
): SemanticTarget[] {
  const acceptedKinds = selector.targetKind ? [selector.targetKind] : ['node', 'participant'];
  return targets.filter((target) => {
    if (target.kind !== 'node' && target.kind !== 'edge' && target.kind !== 'participant') {
      return false;
    }
    return (
      acceptedKinds.includes(target.kind) &&
      (target.id === selector.id || target.key === selector.id)
    );
  });
}

function resolveRouteConnections(
  nodes: string[],
  targets: SemanticTarget[],
  diagnostics: Diagnostic[],
  span: SourceSpan,
): string[] {
  const keys: string[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    const matches = targets.filter(
      (target) =>
        (target.kind === 'edge' || target.kind === 'message') &&
        target.from === from &&
        target.to === to,
    );
    if (matches.length === 1 && matches[0]) keys.push(matches[0].key);
    else if (matches.length === 0)
      diagnostics.push(
        compileDiagnostic(
          'motion.route-edge-not-found',
          `No rendered connection goes from '${from}' to '${to}'.`,
          span,
        ),
      );
    else
      diagnostics.push(
        compileDiagnostic(
          'motion.ambiguous-route',
          `More than one rendered connection goes from '${from}' to '${to}', so the route segment is ambiguous.`,
          span,
        ),
      );
  }
  return keys;
}

function resolveSelector(
  selector: MotionSelector,
  effect: EffectStatement['effect'],
  targets: SemanticTarget[] | undefined,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): string[] {
  if (selector.kind === 'diagram') return ['diagram'];
  if (selector.kind === 'allMessages') {
    if (!targets) {
      diagnostics.push(
        compileDiagnostic(
          'motion.targets-required',
          "Rendered targets are required to expand 'reveal messages'.",
          span,
          'warning',
        ),
      );
      return ['message:*'];
    }
    return targets
      .filter((target) => target.kind === 'message')
      .sort((left, right) => left.order - right.order)
      .map((target) => target.key);
  }
  if (selector.kind === 'message') {
    if (!targets)
      return [
        `message:${selector.from}${selector.arrow}${selector.to}:${selector.text}#${selector.occurrence}`,
      ];
    const matches = targets.filter(
      (target) =>
        target.kind === 'message' &&
        target.from === selector.from &&
        target.to === selector.to &&
        target.arrow === selector.arrow &&
        target.label === selector.text &&
        target.occurrence === selector.occurrence,
    );
    if (matches.length === 0)
      diagnostics.push(
        compileDiagnostic(
          'motion.target-not-found',
          `Message '${selector.from}${selector.arrow}${selector.to}: ${selector.text}' occurrence ${selector.occurrence} was not found.`,
          span,
        ),
      );
    if (matches.length > 1)
      diagnostics.push(
        compileDiagnostic(
          'motion.ambiguous-target',
          'The message selector matched more than one rendered target.',
          span,
        ),
      );
    return matches.map((target) => target.key);
  }
  if (selector.kind === 'edges') {
    if (!targets) return selector.ids.map((id) => inferredKey('edge', id));
    const keys: string[] = [];
    for (const id of selector.ids) {
      const matches = targets.filter(
        (target) => target.kind === 'edge' && (target.id === id || target.key === id),
      );
      if (matches.length === 1 && matches[0]) keys.push(matches[0].key);
      else if (matches.length === 0)
        diagnostics.push(
          compileDiagnostic('motion.target-not-found', `Edge '${id}' was not found.`, span),
        );
      else
        diagnostics.push(
          compileDiagnostic('motion.ambiguous-target', `Edge '${id}' is ambiguous.`, span),
        );
    }
    return keys;
  }
  if (selector.kind === 'route') {
    if (effect === 'trace') {
      if (!targets)
        return selector.nodes
          .slice(0, -1)
          .map((from, index) => `edge:${from}-->${selector.nodes[index + 1]}`);
      return resolveRouteConnections(selector.nodes, targets, diagnostics, span);
    }
    if (!targets) return selector.nodes.map((id) => inferredKey('node', id));
    return selector.nodes.flatMap((id) => {
      const matches = targets.filter(
        (target) => (target.kind === 'node' || target.kind === 'participant') && target.id === id,
      );
      if (matches.length === 0)
        diagnostics.push(
          compileDiagnostic('motion.target-not-found', `Target '${id}' was not found.`, span),
        );
      if (matches.length > 1)
        diagnostics.push(
          compileDiagnostic('motion.ambiguous-target', `Target '${id}' is ambiguous.`, span),
        );
      return matches.length === 1 && matches[0] ? [matches[0].key] : [];
    });
  }

  if (!targets) return [inferredKey(selector.targetKind ?? 'node', selector.id)];
  const matches = matchesIdTarget(selector, targets);
  if (matches.length === 0)
    diagnostics.push(
      compileDiagnostic('motion.target-not-found', `Target '${selector.id}' was not found.`, span),
    );
  if (matches.length > 1)
    diagnostics.push(
      compileDiagnostic(
        'motion.ambiguous-target',
        `Target '${selector.id}' matches more than one rendered element. Add a target kind.`,
        span,
      ),
    );
  return matches.length === 1 && matches[0] ? [matches[0].key] : [];
}

function eventStart(
  timing: MotionTiming,
  cursorMs: number,
  previousStartMs: number,
  labels: Map<string, { startMs: number; endMs: number }>,
  diagnostics: Diagnostic[],
  span: SourceSpan,
): number {
  if (timing.kind === 'implicit') return cursorMs;
  if (timing.kind === 'at') return timing.timeMs;
  if (timing.kind === 'with') return previousStartMs;
  const dependency = labels.get(timing.label);
  if (!dependency) {
    diagnostics.push(
      compileDiagnostic(
        'motion.unknown-label',
        `No earlier statement is labeled '${timing.label}'.`,
        span,
      ),
    );
    return cursorMs;
  }
  return dependency.endMs;
}

function eventId(statement: MotionStatement, suffix = ''): string {
  return statement.label
    ? `${statement.label}${suffix}`
    : `cue-${statement.sourceIndex + 1}${suffix}`;
}

export function compileMotion(
  input: DiagramDocument | MotionDocument,
  options: CompileOptions = {},
): CompileResult {
  const parsed = getMotionDocument(input);
  const diagnostics = [...parsed.diagnostics];
  const document = parsed.document;
  if (!document) return { diagnostics };
  const parseErrors = parsed.diagnostics.filter((item) => item.severity === 'error');

  const markers: Record<string, CompiledMarker> = {};
  const events: CompiledEvent[] = [];
  const labels = new Map<string, { startMs: number; endMs: number }>();
  let defaults: MotionDefaults = { durationMs: 400, easing: 'ease-out' };
  let cursorMs = 0;
  let previousStartMs = 0;

  for (const statement of document.statements) {
    const overlapsParseError = parseErrors.some(
      (item) => item.span.start <= statement.span.end && item.span.end >= statement.span.start,
    );
    if (overlapsParseError) continue;
    const statementDiagnosticStart = diagnostics.length;
    const statementHasErrors = () =>
      diagnostics
        .slice(statementDiagnosticStart)
        .some((diagnostic) => diagnostic.severity === 'error');

    if (statement.label && labels.has(statement.label)) {
      diagnostics.push(
        compileDiagnostic(
          'motion.duplicate-label',
          `Statement label '${statement.label}' is already defined.`,
          statement.span,
        ),
      );
    }
    if (statement.kind === 'defaults') {
      if (statementHasErrors()) continue;
      defaults = statement.defaults;
      if (statement.label) labels.set(statement.label, { startMs: cursorMs, endMs: cursorMs });
      continue;
    }
    if (statement.kind === 'marker') {
      if (markers[statement.markerId])
        diagnostics.push(
          compileDiagnostic(
            'motion.duplicate-marker',
            `Marker '${statement.markerId}' is already defined.`,
            statement.span,
          ),
        );
      if (statementHasErrors()) continue;
      markers[statement.markerId] = {
        id: statement.markerId,
        label: statement.displayLabel,
        shape: statement.shape,
      };
      if (statement.label) labels.set(statement.label, { startMs: cursorMs, endMs: cursorMs });
      continue;
    }
    if (statement.kind === 'wait') {
      if (statementHasErrors()) continue;
      const startMs = cursorMs;
      cursorMs += statement.durationMs;
      previousStartMs = startMs;
      if (statement.label) labels.set(statement.label, { startMs, endMs: cursorMs });
      continue;
    }

    const startMs = eventStart(
      statement.timing,
      cursorMs,
      previousStartMs,
      labels,
      diagnostics,
      statement.span,
    );
    if (statement.kind === 'removeMarker') {
      if (!markers[statement.markerId])
        diagnostics.push(
          compileDiagnostic(
            'motion.unknown-marker',
            `Marker '${statement.markerId}' is not defined.`,
            statement.span,
          ),
        );
      if (statementHasErrors()) continue;
      events.push({
        id: eventId(statement),
        kind: 'removeMarker',
        startMs,
        durationMs: 0,
        easing: defaults.easing,
        sourceIndex: statement.sourceIndex,
        sourceSpan: statement.span,
        targetKeys: [],
        route: [],
        markerId: statement.markerId,
      });
      previousStartMs = startMs;
      cursorMs = Math.max(cursorMs, startMs);
      if (statement.label) labels.set(statement.label, { startMs, endMs: startMs });
      continue;
    }
    if (statement.kind === 'move') {
      if (!markers[statement.markerId])
        diagnostics.push(
          compileDiagnostic(
            'motion.unknown-marker',
            `Marker '${statement.markerId}' is not defined.`,
            statement.span,
          ),
        );
      const route = resolveSelector(
        { kind: 'route', nodes: statement.route },
        'highlight',
        options.targets,
        diagnostics,
        statement.span,
      );
      const routeEdgeKeys = options.targets
        ? resolveRouteConnections(statement.route, options.targets, diagnostics, statement.span)
        : statement.route
            .slice(0, -1)
            .map((from, index) => `edge:${from}-->${statement.route[index + 1]}`);
      if (statementHasErrors()) continue;
      const durationMs = statement.durationMs ?? defaults.durationMs;
      const color = statement.color ?? defaults.color;
      events.push({
        id: eventId(statement),
        kind: 'move',
        startMs,
        durationMs,
        easing: statement.easing ?? defaults.easing,
        sourceIndex: statement.sourceIndex,
        sourceSpan: statement.span,
        targetKeys: route,
        route,
        routeEdgeKeys,
        markerId: statement.markerId,
        ...(color === undefined ? {} : { color }),
      });
      const endMs = startMs + durationMs;
      previousStartMs = startMs;
      cursorMs = Math.max(cursorMs, endMs);
      if (statement.label) labels.set(statement.label, { startMs, endMs });
      continue;
    }

    const keys = resolveSelector(
      statement.selector,
      statement.effect,
      options.targets,
      diagnostics,
      statement.span,
    );
    if (statementHasErrors()) continue;
    if (statement.selector.kind === 'allMessages' && statement.effect === 'reveal') {
      const intervalMs = statement.intervalMs ?? defaults.durationMs;
      const color = statement.color ?? defaults.color;
      keys.forEach((key, index) => {
        events.push({
          id: eventId(statement, `-${index + 1}`),
          kind: 'reveal',
          startMs: startMs + index * intervalMs,
          durationMs: statement.durationMs ?? Math.min(defaults.durationMs, intervalMs),
          easing: statement.easing ?? defaults.easing,
          sourceIndex: statement.sourceIndex,
          sourceSpan: statement.span,
          targetKeys: [key],
          route: [],
          ...(color === undefined ? {} : { color }),
        });
      });
      const endMs =
        keys.length === 0
          ? startMs
          : startMs +
            Math.max(0, keys.length - 1) * intervalMs +
            (statement.durationMs ?? Math.min(defaults.durationMs, intervalMs));
      previousStartMs = startMs;
      cursorMs = Math.max(cursorMs, endMs);
      if (statement.label) labels.set(statement.label, { startMs, endMs });
      continue;
    }

    const durationMs = statement.durationMs ?? defaults.durationMs;
    const color = statement.color ?? defaults.color;
    events.push({
      id: eventId(statement),
      kind: statement.effect,
      startMs,
      durationMs,
      easing: statement.easing ?? defaults.easing,
      sourceIndex: statement.sourceIndex,
      sourceSpan: statement.span,
      targetKeys: keys,
      route: statement.selector.kind === 'route' ? keys : [],
      ...(color === undefined ? {} : { color }),
    });
    const endMs = startMs + durationMs;
    previousStartMs = startMs;
    cursorMs = Math.max(cursorMs, endMs);
    if (statement.label) labels.set(statement.label, { startMs, endMs });
  }

  const sortedEvents = [...events].sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.sourceIndex - right.sourceIndex ||
      left.id.localeCompare(right.id),
  );
  const validEvents: CompiledEvent[] = [];
  const markerPositions = new Map<string, { destination: string; endMs: number }>();
  for (const event of sortedEvents) {
    if (event.kind === 'removeMarker' && event.markerId) {
      markerPositions.delete(event.markerId);
      validEvents.push(event);
      continue;
    }
    if (event.kind !== 'move' || !event.markerId) {
      validEvents.push(event);
      continue;
    }

    const previous = markerPositions.get(event.markerId);
    if (previous && event.startMs < previous.endMs) {
      diagnostics.push(
        compileDiagnostic(
          'motion.overlapping-marker-move',
          `Marker '${event.markerId}' is already moving until ${previous.endMs}ms.`,
          event.sourceSpan,
        ),
      );
      continue;
    }
    const origin = event.route[0];
    if (previous && origin !== previous.destination) {
      diagnostics.push(
        compileDiagnostic(
          'motion.discontinuous-marker-route',
          `Marker '${event.markerId}' last arrived at '${previous.destination}', but this route starts at '${origin ?? 'unknown'}'.`,
          event.sourceSpan,
        ),
      );
      continue;
    }

    validEvents.push(event);
    const destination = event.route[event.route.length - 1];
    if (destination) {
      markerPositions.set(event.markerId, {
        destination,
        endMs: event.startMs + event.durationMs,
      });
    }
  }

  const eventTargetKeys = validEvents.flatMap((event) => event.targetKeys);
  const targetKeys = [
    ...new Set([...(options.targets?.map((target) => target.key) ?? []), ...eventTargetKeys]),
  ];
  const initialHiddenTargetKeys = [
    ...new Set(
      validEvents.filter((event) => event.kind === 'reveal').flatMap((event) => event.targetKeys),
    ),
  ];
  const durationMs = validEvents.reduce(
    (maximum, event) => Math.max(maximum, event.startMs + event.durationMs),
    cursorMs,
  );
  const nextMarkerChange = new Map<string, number>();
  let visualDurationMs = durationMs;
  for (const event of [...validEvents].reverse()) {
    if (!event.markerId || (event.kind !== 'move' && event.kind !== 'removeMarker')) continue;
    const capMs = nextMarkerChange.get(event.markerId);
    if (event.kind === 'move') {
      const arrivalEndMs = event.startMs + event.durationMs + MOVE_ARRIVAL_DURATION_MS;
      visualDurationMs = Math.max(visualDurationMs, Math.min(arrivalEndMs, capMs ?? Infinity));
    }
    nextMarkerChange.set(event.markerId, event.startMs);
  }
  return {
    timeline: {
      version: 'motion-ir-v1',
      durationMs: visualDurationMs,
      defaults: document.defaults,
      markers,
      events: validEvents,
      targetKeys,
      initialHiddenTargetKeys,
    },
    diagnostics,
  };
}

function easingProgress(easing: MotionEasing, progress: number): number {
  const value = Math.max(0, Math.min(1, progress));
  if (easing === 'linear') return value;
  if (easing === 'ease-in') return value * value;
  if (easing === 'ease-out') return 1 - (1 - value) * (1 - value);
  if (easing === 'ease-in-out')
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function frameTarget(key: string, hidden: Set<string>): FrameTargetState {
  const opacity = hidden.has(key) ? 0 : 1;
  return { key, visible: opacity > 0, opacity, highlight: 0, pulse: 0 };
}

function eventProgress(event: CompiledEvent, timeMs: number): number {
  if (event.durationMs === 0) return timeMs >= event.startMs ? 1 : 0;
  return easingProgress(event.easing, (timeMs - event.startMs) / event.durationMs);
}

function sampleMarker(
  event: CompiledEvent,
  timeline: CompiledTimeline,
  timeMs: number,
): FrameMarkerState | undefined {
  if (!event.markerId || event.route.length === 0 || timeMs < event.startMs) return undefined;
  const definition = timeline.markers[event.markerId];
  if (!definition) return undefined;
  const progress = eventProgress(event, timeMs);
  const arrivalStartMs = event.startMs + event.durationMs;
  const arrivalProgress = Math.max(
    0,
    Math.min(1, (timeMs - arrivalStartMs) / MOVE_ARRIVAL_DURATION_MS),
  );
  const phase =
    timeMs < arrivalStartMs
      ? ('moving' as const)
      : arrivalProgress < 1
        ? ('arriving' as const)
        : ('settled' as const);
  const segments = Math.max(1, event.route.length - 1);
  const scaled = progress * segments;
  const segmentIndex = Math.min(segments - 1, Math.floor(scaled));
  const segmentProgress = progress >= 1 ? 1 : scaled - segmentIndex;
  const from = event.route[segmentIndex] ?? event.route[0] ?? '';
  const destination = event.route[event.route.length - 1];
  const to = event.route[segmentIndex + 1] ?? destination ?? from;
  const at = progress >= 1 ? (destination ?? to) : from;
  return {
    id: definition.id,
    label: definition.label,
    shape: definition.shape,
    route: event.route,
    edgeKeys: event.routeEdgeKeys ?? [],
    at,
    routeProgress: progress,
    progress: segmentProgress,
    phase,
    arrivalProgress,
    ...(event.color === undefined ? {} : { color: event.color }),
    from,
    to,
  };
}

export function sampleTimeline(timeline: CompiledTimeline, requestedTimeMs: number): FrameState {
  const timeMs = Math.max(
    0,
    Math.min(timeline.durationMs, Number.isFinite(requestedTimeMs) ? requestedTimeMs : 0),
  );
  const hidden = new Set(timeline.initialHiddenTargetKeys);
  const targets = Object.fromEntries(
    timeline.targetKeys.map((key) => [key, frameTarget(key, hidden)]),
  );
  const markers: Record<string, FrameMarkerState> = {};
  const traces: FrameState['traces'] = [];

  const ensureTarget = (key: string): FrameTargetState => {
    const existing = targets[key];
    if (existing) return existing;
    const created = frameTarget(key, hidden);
    targets[key] = created;
    return created;
  };

  for (const event of timeline.events) {
    if (timeMs < event.startMs) continue;
    const progress = eventProgress(event, timeMs);
    if (event.kind === 'move') {
      const marker = sampleMarker(event, timeline, timeMs);
      if (marker) markers[marker.id] = marker;
      continue;
    }
    if (event.kind === 'removeMarker') {
      if (event.markerId) delete markers[event.markerId];
      continue;
    }
    if (event.kind === 'trace') {
      if (timeMs < event.startMs + event.durationMs) {
        traces.push({
          id: event.id,
          targetKeys: event.targetKeys,
          progress,
          ...(event.color === undefined ? {} : { color: event.color }),
        });
      }
      continue;
    }
    for (const key of event.targetKeys) {
      const state = ensureTarget(key);
      if (event.kind === 'highlight')
        state.highlight = state.highlight + (1 - state.highlight) * progress;
      else if (event.kind === 'unhighlight') state.highlight *= 1 - progress;
      else if (event.kind === 'reveal')
        state.opacity = state.opacity + (1 - state.opacity) * progress;
      else if (event.kind === 'hide') state.opacity *= 1 - progress;
      else if (event.kind === 'pulse' && timeMs < event.startMs + event.durationMs)
        state.pulse = Math.max(state.pulse, Math.sin(progress * Math.PI));
      if (event.color !== undefined) state.color = event.color;
      state.visible = state.opacity > 0.001;
    }
  }

  return { timeMs, durationMs: timeline.durationMs, targets, markers, traces };
}

export const sampleMotion = sampleTimeline;

export function emptyTimeline(): CompiledTimeline {
  return {
    version: 'motion-ir-v1',
    durationMs: 0,
    defaults: { durationMs: 400, easing: 'ease-out' },
    markers: {},
    events: [],
    targetKeys: [],
    initialHiddenTargetKeys: [],
  };
}

export function compileMotionSource(source: string, options: CompileOptions = {}): CompileResult {
  return compileMotion({ mermaidSource: '', motionSource: source }, options);
}

export function noMotionDocument(mermaidSource: string): DiagramDocument {
  return { mermaidSource };
}

export function diagnosticForUnexpectedCompilerFailure(message: string): Diagnostic {
  return compileDiagnostic('motion.compiler-failure', message, wholeSourceSpan(''));
}
