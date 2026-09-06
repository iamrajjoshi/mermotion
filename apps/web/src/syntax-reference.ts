import { parseMotion, type SemanticTarget } from '@mermotion/engine';

import { motionId, selectorForTarget } from './target-source';

type SyntaxGroup = 'Foundation' | 'Effects' | 'Timing' | 'Sequence diagrams';

export interface SyntaxEntry {
  description: string;
  group: SyntaxGroup;
  id: string;
  insertable?: boolean;
  label: string;
  source: string;
}

export interface ResolvedSyntaxEntry extends SyntaxEntry {
  insertSource?: string;
}

export const CANONICAL_MOTION_EXAMPLE = `motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request"

  highlight client
  with pulse api for 600ms
  move request along client --> api --> worker over 1.8s
  trace api --> worker over 800ms`;

export const SYNTAX_ENTRIES: SyntaxEntry[] = [
  {
    description: 'Required once, before defaults, markers, or cues.',
    group: 'Foundation',
    id: 'header',
    label: 'Version header',
    source: 'motionDiagram-v1',
  },
  {
    description:
      'Sets shared duration and color. Easing shapes state effects; canonical paths stay linear.',
    group: 'Foundation',
    id: 'defaults',
    label: 'Document defaults',
    source: 'defaults duration 480ms easing ease-out color #ff5470',
  },
  {
    description: 'Comments occupy their own line and never change playback.',
    group: 'Foundation',
    id: 'comment',
    label: 'Comment',
    source: '%% explain this beat',
  },
  {
    description:
      'Declares a dot: request is the ID used by move, while “Request” is its displayed label.',
    group: 'Foundation',
    id: 'marker',
    label: 'Named marker',
    source: 'marker request as "Request"',
  },
  {
    description: 'Emphasizes a Mermaid node by its source ID.',
    group: 'Effects',
    id: 'highlight',
    insertable: true,
    label: 'Highlight a node',
    source: 'highlight client',
  },
  {
    description: 'Adds a finite pulse to a Mermaid node.',
    group: 'Effects',
    id: 'pulse',
    insertable: true,
    label: 'Pulse a node',
    source: 'pulse api for 600ms',
  },
  {
    description: 'Draws progress across adjacent rendered connections named by Mermaid IDs.',
    group: 'Effects',
    id: 'trace',
    insertable: true,
    label: 'Trace a route',
    source: 'trace client --> api --> worker over 1.2s',
  },
  {
    description:
      'Moves a declared marker along measured geometry. Insert creates a fresh marker; later moves continue from its last destination and cannot overlap it.',
    group: 'Effects',
    id: 'move',
    insertable: true,
    label: 'Move a marker',
    source: 'move request along client --> api --> worker over 1.8s',
  },
  {
    description: 'Cues run after the preceding cue unless with or at changes their timing.',
    group: 'Timing',
    id: 'implicit',
    insertable: true,
    label: 'Sequence by default',
    source: 'highlight client\npulse api for 600ms',
  },
  {
    description: 'Starts alongside the preceding cue instead of after it.',
    group: 'Timing',
    id: 'with',
    insertable: true,
    label: 'Overlap a cue',
    source: 'with pulse api for 600ms',
  },
  {
    description: 'Pins a cue to an exact point on the timeline.',
    group: 'Timing',
    id: 'at',
    insertable: true,
    label: 'Place a cue',
    source: 'at 2.4s highlight client',
  },
  {
    description:
      'The short form targets a message only while sender, arrow, receiver, and text are unique.',
    group: 'Sequence diagrams',
    id: 'sequence-message-first',
    insertable: true,
    label: 'Unique message',
    source: 'pulse message Worker->>API: "GET /status" for 300ms',
  },
  {
    description:
      'Repeated messages use a one-based occurrence, including occurrence 1, so edits cannot rebind a cue.',
    group: 'Sequence diagrams',
    id: 'sequence-message',
    insertable: true,
    label: 'Repeated message',
    source: 'pulse message Worker->>API: "GET /status" occurrence 2 for 300ms',
  },
];

export function filterSyntaxEntries(
  query: string,
  entries: SyntaxEntry[] = SYNTAX_ENTRIES,
): SyntaxEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;
  return entries.filter((entry) => {
    const searchableText = [entry.group, entry.label, entry.source, entry.description]
      .join(' ')
      .toLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
}

function uniqueRouteTarget(targets: SemanticTarget[]): SemanticTarget | undefined {
  const candidates = targets.filter(
    (target) => (target.kind === 'edge' || target.kind === 'message') && target.from && target.to,
  );
  const counts = new Map<string, number>();
  for (const target of candidates) {
    const key = `${target.from}\u0000${target.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return candidates.find((target) => counts.get(`${target.from}\u0000${target.to}`) === 1);
}

function pointSource(target: SemanticTarget | undefined): string | undefined {
  return target ? selectorForTarget(target) : undefined;
}

function nextMarker(motionSource: string): { id: string; label: string } {
  const markerIds = new Set(
    parseMotion(motionSource).document?.statements.flatMap((statement) =>
      statement.kind === 'marker' ? [statement.markerId] : [],
    ) ?? [],
  );
  let index = 1;
  let id = 'request';
  while (markerIds.has(id)) {
    index += 1;
    id = `request${index}`;
  }
  return { id, label: index === 1 ? 'Request' : `Request ${index}` };
}

export function resolveSyntaxEntries(
  targets: SemanticTarget[],
  motionSource: string,
): ResolvedSyntaxEntry[] {
  const pointTargets = targets.filter(
    (target) => target.kind === 'node' || target.kind === 'participant',
  );
  const primaryTarget = pointTargets[0];
  const secondaryTarget = pointTargets[1] ?? primaryTarget;
  const routeTarget = uniqueRouteTarget(targets);
  const firstMessage = targets.find(
    (target) => target.kind === 'message' && (target.occurrence ?? 1) === 1,
  );
  const repeatedMessage = targets.find(
    (target) => target.kind === 'message' && (target.occurrence ?? 1) > 1,
  );
  const marker = nextMarker(motionSource);

  const routeSource = routeTarget
    ? `${motionId(routeTarget.from ?? '')} --> ${motionId(routeTarget.to ?? '')}`
    : undefined;

  return SYNTAX_ENTRIES.map((entry) => {
    let insertSource: string | undefined;
    if (entry.id === 'highlight' && primaryTarget)
      insertSource = `highlight ${pointSource(primaryTarget)}`;
    else if (entry.id === 'pulse' && secondaryTarget)
      insertSource = `pulse ${pointSource(secondaryTarget)} for 600ms`;
    else if (entry.id === 'trace' && routeSource) insertSource = `trace ${routeSource} over 1.2s`;
    else if (entry.id === 'move' && routeSource) {
      const markerId = motionId(marker.id);
      insertSource = `marker ${markerId} as ${JSON.stringify(marker.label)}\nmove ${markerId} along ${routeSource} over 1.8s`;
    } else if (entry.id === 'implicit' && primaryTarget && secondaryTarget)
      insertSource = `highlight ${pointSource(primaryTarget)}\npulse ${pointSource(secondaryTarget)} for 600ms`;
    else if (entry.id === 'with' && primaryTarget && secondaryTarget)
      insertSource = `highlight ${pointSource(primaryTarget)}\nwith pulse ${pointSource(secondaryTarget)} for 600ms`;
    else if (entry.id === 'at' && primaryTarget)
      insertSource = `at 2.4s highlight ${pointSource(primaryTarget)}`;
    else if (entry.id === 'sequence-message-first' && firstMessage)
      insertSource = `pulse ${selectorForTarget(firstMessage)} for 300ms`;
    else if (entry.id === 'sequence-message' && repeatedMessage)
      insertSource = `pulse ${selectorForTarget(repeatedMessage)} for 300ms`;

    return insertSource ? Object.assign({}, entry, { insertSource, source: insertSource }) : entry;
  });
}

export function insertMotionSnippet(
  source: string,
  snippet: string,
  selection = { end: source.length, start: source.length },
): { cursor: number; source: string } {
  if (!source.trim()) {
    const canonicalSnippet = `  ${snippet.trim().replaceAll('\n', '\n  ')}`;
    const nextSource = `motionDiagram-v1\n${canonicalSnippet}`;
    return { cursor: nextSource.length, source: nextSource };
  }

  const parsed = parseMotion(source);
  let declarationBlockEnd = 0;
  for (const line of parsed.cst) {
    const statement =
      line.statementIndex === undefined
        ? undefined
        : parsed.document?.statements[line.statementIndex];
    if (
      line.kind !== 'declaration' &&
      statement?.kind !== 'defaults' &&
      statement?.kind !== 'marker'
    )
      continue;
    const lineBreak = source.indexOf('\n', line.span.start);
    declarationBlockEnd = Math.max(
      declarationBlockEnd,
      lineBreak >= 0 ? lineBreak + 1 : source.length,
    );
  }
  const requestedPosition = Math.max(0, Math.min(selection.end, source.length));
  const protectedPosition = Math.max(requestedPosition, declarationBlockEnd);
  let insertionPoint: number;
  if (protectedPosition === 0 || source[protectedPosition - 1] === '\n') {
    insertionPoint = protectedPosition;
  } else {
    const nextLineBreak = source.indexOf('\n', protectedPosition);
    insertionPoint = nextLineBreak >= 0 ? nextLineBreak + 1 : source.length;
  }
  const before = source.slice(0, insertionPoint);
  const after = source.slice(insertionPoint);
  const canonicalSnippet = `  ${snippet.trim().replaceAll('\n', '\n  ')}`;
  const leadingBreak = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const trailingBreak = after.length > 0 || source.endsWith('\n') ? '\n' : '';
  const insertion = `${leadingBreak}${canonicalSnippet}${trailingBreak}`;

  return {
    cursor: before.length + leadingBreak.length + canonicalSnippet.length,
    source: `${before}${insertion}${after}`,
  };
}
