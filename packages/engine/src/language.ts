import { sourceSpan, wholeSourceSpan } from './spans.js';
import type {
  Diagnostic,
  EffectStatement,
  MarkerStatement,
  MotionCstLine,
  MotionDefaults,
  MotionDocument,
  MotionEasing,
  MotionEffectKind,
  MotionFormatResult,
  MotionParseResult,
  MotionSelector,
  MotionStatement,
  MotionTiming,
  MotionToken,
  MotionTokenKind,
  MoveStatement,
  RemoveMarkerStatement,
  SourceSpan,
  WaitStatement,
} from './types.js';

const DEFAULTS: MotionDefaults = { durationMs: 400, easing: 'ease-out' };
const ARROWS = [
  '<<-->>',
  '<<->>',
  '<-->>',
  '-.->',
  '-->>',
  '-->+',
  '--)-',
  '->>+',
  '->>-',
  '-->',
  '->>',
  '--x',
  '--)',
  '--o',
  '<--',
  '==>',
  '->',
  '-x',
  '-)',
];
const MODIFIERS = new Set(['for', 'over', 'every', 'easing', 'color']);
const SELECTOR_KEYWORDS = new Set([
  'diagram',
  'edge',
  'edges',
  'message',
  'messages',
  'node',
  'participant',
]);

interface LineCursor {
  tokens: MotionToken[];
  index: number;
  source: string;
  diagnostics: Diagnostic[];
}

function diagnostic(
  code: string,
  message: string,
  span: SourceSpan,
  severity: Diagnostic['severity'] = 'error',
): Diagnostic {
  return { code, severity, message, span };
}

function arrowAt(source: string, index: number): string | undefined {
  return ARROWS.find((arrow) => source.startsWith(arrow, index));
}

function tokenKindForWord(raw: string): MotionTokenKind {
  if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/.test(raw)) return 'duration';
  if (/^\d+$/.test(raw)) return 'number';
  return 'word';
}

export function tokenizeMotion(source: string): {
  tokens: MotionToken[];
  diagnostics: Diagnostic[];
} {
  const tokens: MotionToken[] = [];
  const diagnostics: Diagnostic[] = [];
  let index = 0;

  const push = (
    kind: MotionTokenKind,
    start: number,
    end: number,
    value = source.slice(start, end),
  ) => {
    tokens.push({
      kind,
      value,
      raw: source.slice(start, end),
      span: sourceSpan(source, start, end),
    });
  };

  while (index < source.length) {
    const start = index;
    const character = source[index];

    if (character === ' ' || character === '\t' || character === '\r') {
      index += 1;
      continue;
    }
    if (character === '\n') {
      push('newline', start, ++index, '\n');
      continue;
    }
    if (source.startsWith('%%', index)) {
      while (index < source.length && source[index] !== '\n') index += 1;
      push('comment', start, index, source.slice(start + 2, index));
      continue;
    }
    if (character === '"') {
      index += 1;
      let value = '';
      let closed = false;
      while (index < source.length) {
        const quotedCharacter = source[index];
        if (quotedCharacter === '"') {
          index += 1;
          closed = true;
          break;
        }
        if (quotedCharacter === '\\' && index + 1 < source.length) {
          const escaped = source[index + 1];
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          index += 2;
          continue;
        }
        value += quotedCharacter;
        index += 1;
      }
      push('string', start, index, value);
      if (!closed)
        diagnostics.push(
          diagnostic(
            'motion.unterminated-string',
            'Close this string with a double quote.',
            sourceSpan(source, start, index),
          ),
        );
      continue;
    }

    const arrow = arrowAt(source, index);
    if (arrow) {
      index += arrow.length;
      push('arrow', start, index, arrow);
      continue;
    }
    if (character === ':') {
      push('colon', start, ++index);
      continue;
    }
    if (character === ',') {
      push('comma', start, ++index);
      continue;
    }
    if (character === ';') {
      push('semicolon', start, ++index);
      continue;
    }

    while (index < source.length) {
      const wordCharacter = source[index];
      if (
        wordCharacter === undefined ||
        /[\s:,;"]/.test(wordCharacter) ||
        source.startsWith('%%', index) ||
        arrowAt(source, index)
      )
        break;
      index += 1;
    }
    if (index === start) {
      push('unknown', start, ++index);
      continue;
    }
    const raw = source.slice(start, index);
    push(tokenKindForWord(raw), start, index, raw);
  }

  const eofSpan = sourceSpan(source, source.length, source.length);
  tokens.push({ kind: 'eof', value: '', raw: '', span: eofSpan });
  return { tokens, diagnostics };
}

export function formatMotionIdentifier(value: string): string {
  const [token, eof] = tokenizeMotion(value).tokens;
  const isSafeWord =
    token?.kind === 'word' &&
    token.raw === value &&
    eof?.kind === 'eof' &&
    !SELECTOR_KEYWORDS.has(value) &&
    !MODIFIERS.has(value);
  return isSafeWord ? value : quote(value);
}

function splitCstLines(source: string): MotionCstLine[] {
  const lines: MotionCstLine[] = [];
  let offset = 0;
  const rawLines = source.split('\n');
  rawLines.forEach((raw, lineIndex) => {
    const trimmed = raw.trim();
    const end = offset + raw.length;
    lines.push({
      kind: trimmed === '' ? 'blank' : trimmed.startsWith('%%') ? 'comment' : 'statement',
      raw,
      span: sourceSpan(source, offset, end),
    });
    offset = end + (lineIndex < rawLines.length - 1 ? 1 : 0);
  });
  return lines;
}

function durationMs(token: MotionToken | undefined, cursor: LineCursor): number | undefined {
  if (!token || token.kind !== 'duration') {
    cursor.diagnostics.push(
      diagnostic(
        'motion.expected-duration',
        'Expected a duration such as 400ms or 1.2s.',
        token?.span ?? wholeSourceSpan(cursor.source),
      ),
    );
    return undefined;
  }
  const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/.exec(token.value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    cursor.diagnostics.push(
      diagnostic(
        'motion.invalid-duration',
        'Duration must be a non-negative finite number.',
        token.span,
      ),
    );
    return undefined;
  }
  return match[2] === 's' ? amount * 1000 : amount;
}

function current(cursor: LineCursor): MotionToken | undefined {
  return cursor.tokens[cursor.index];
}

function take(cursor: LineCursor): MotionToken | undefined {
  const token = current(cursor);
  cursor.index += 1;
  return token;
}

function takeWord(cursor: LineCursor, description: string): MotionToken | undefined {
  const token = current(cursor);
  if (token?.kind === 'word' || token?.kind === 'string') {
    cursor.index += 1;
    return token;
  }
  cursor.diagnostics.push(
    diagnostic(
      'motion.expected-value',
      `Expected ${description}.`,
      token?.span ?? wholeSourceSpan(cursor.source),
    ),
  );
  return undefined;
}

function matchWord(cursor: LineCursor, word: string): boolean {
  if (current(cursor)?.kind === 'word' && current(cursor)?.value === word) {
    cursor.index += 1;
    return true;
  }
  return false;
}

function parseEasing(cursor: LineCursor): MotionEasing | undefined {
  const token = takeWord(cursor, 'an easing name');
  if (!token) return undefined;
  const easing = toEasing(token.value);
  if (!easing) {
    cursor.diagnostics.push(
      diagnostic(
        'motion.invalid-easing',
        `Unknown easing '${token.value}'. Use linear, ease, ease-in, ease-out, or ease-in-out.`,
        token.span,
      ),
    );
    return undefined;
  }
  return easing;
}

function parseColor(cursor: LineCursor): string | undefined {
  const colorToken = takeWord(cursor, 'a hexadecimal color or inherit');
  if (
    colorToken &&
    colorToken.value !== 'inherit' &&
    !/^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(colorToken.value)
  ) {
    cursor.diagnostics.push(
      diagnostic(
        'motion.invalid-color',
        "Color must be 'inherit' or a 3, 4, 6, or 8 digit hexadecimal color.",
        colorToken.span,
      ),
    );
    return undefined;
  }
  return colorToken?.value;
}

function toEasing(value: string): MotionEasing | undefined {
  switch (value) {
    case 'linear':
    case 'ease':
    case 'ease-in':
    case 'ease-out':
    case 'ease-in-out':
      return value;
    default:
      return undefined;
  }
}

function isEffect(value: string): value is MotionEffectKind {
  switch (value) {
    case 'highlight':
    case 'unhighlight':
    case 'reveal':
    case 'hide':
    case 'pulse':
    case 'trace':
      return true;
    default:
      return false;
  }
}

function parseTiming(cursor: LineCursor): MotionTiming {
  if (matchWord(cursor, 'at')) {
    const token = take(cursor);
    return { kind: 'at', timeMs: durationMs(token, cursor) ?? 0 };
  }
  if (matchWord(cursor, 'after')) {
    return { kind: 'after', label: takeWord(cursor, 'a statement label')?.value ?? '' };
  }
  if (matchWord(cursor, 'with')) return { kind: 'with' };
  return { kind: 'implicit' };
}

function parseMessageSelector(cursor: LineCursor): MotionSelector {
  const from = takeWord(cursor, 'a message sender')?.value ?? '';
  const arrow = take(cursor);
  if (arrow?.kind !== 'arrow') {
    cursor.diagnostics.push(
      diagnostic(
        'motion.expected-message-arrow',
        'Expected a Mermaid sequence arrow such as ->>.',
        arrow?.span ?? wholeSourceSpan(cursor.source),
      ),
    );
  }
  const to = takeWord(cursor, 'a message receiver')?.value ?? '';
  if (current(cursor)?.kind === 'colon') take(cursor);
  else
    cursor.diagnostics.push(
      diagnostic(
        'motion.expected-message-colon',
        "Expected ':' before the message text.",
        current(cursor)?.span ?? wholeSourceSpan(cursor.source),
      ),
    );
  const text = takeWord(cursor, 'a quoted message label')?.value ?? '';
  let occurrence: number | undefined;
  if (matchWord(cursor, 'occurrence')) {
    const occurrenceToken = take(cursor);
    if (occurrenceToken?.kind !== 'number' || Number(occurrenceToken.value) < 1) {
      cursor.diagnostics.push(
        diagnostic(
          'motion.invalid-occurrence',
          'Occurrence must be a positive integer.',
          occurrenceToken?.span ?? wholeSourceSpan(cursor.source),
        ),
      );
    } else occurrence = Number(occurrenceToken.value);
  }
  return {
    kind: 'message',
    from,
    to,
    arrow: arrow?.value.replace(/[+-]$/, '') ?? '->>',
    text,
    ...(occurrence === undefined ? {} : { occurrence }),
  };
}

function parseSelector(cursor: LineCursor): MotionSelector {
  const first = current(cursor);
  if (!first) return { kind: 'diagram' };
  const isKeyword = first.kind === 'word';
  if (isKeyword && first.value === 'diagram') {
    take(cursor);
    return { kind: 'diagram' };
  }
  if (isKeyword && first.value === 'messages') {
    take(cursor);
    return { kind: 'allMessages' };
  }
  if (isKeyword && first.value === 'message') {
    take(cursor);
    return parseMessageSelector(cursor);
  }
  if (isKeyword && first.value === 'edges') {
    take(cursor);
    const ids: string[] = [];
    while (
      current(cursor) &&
      !(current(cursor)?.kind === 'word' && MODIFIERS.has(current(cursor)?.value ?? ''))
    ) {
      if (current(cursor)?.kind === 'comma') take(cursor);
      else {
        const id = takeWord(cursor, 'an edge ID');
        if (!id) break;
        ids.push(id.value);
      }
    }
    return { kind: 'edges', ids };
  }
  if (
    isKeyword &&
    (first.value === 'participant' || first.value === 'node' || first.value === 'edge')
  ) {
    const targetKind = first.value;
    take(cursor);
    return { kind: 'id', targetKind, id: takeWord(cursor, `a ${targetKind} ID`)?.value ?? '' };
  }

  const nodes: string[] = [];
  const firstNode = takeWord(cursor, 'a target ID');
  if (!firstNode) return { kind: 'diagram' };
  nodes.push(firstNode.value);
  while (current(cursor)?.kind === 'arrow') {
    take(cursor);
    const node = takeWord(cursor, 'a route node ID');
    if (!node) break;
    nodes.push(node.value);
  }
  return nodes.length > 1 ? { kind: 'route', nodes } : { kind: 'id', id: nodes[0] ?? '' };
}

function parseModifiers(cursor: LineCursor): {
  durationMs?: number;
  easing?: MotionEasing;
  color?: string;
  intervalMs?: number;
} {
  let duration: number | undefined;
  let easing: MotionEasing | undefined;
  let color: string | undefined;
  let interval: number | undefined;
  while (cursor.index < cursor.tokens.length) {
    if (matchWord(cursor, 'for') || matchWord(cursor, 'over'))
      duration = durationMs(take(cursor), cursor);
    else if (matchWord(cursor, 'every')) interval = durationMs(take(cursor), cursor);
    else if (matchWord(cursor, 'easing')) easing = parseEasing(cursor);
    else if (matchWord(cursor, 'color')) color = parseColor(cursor);
    else {
      const token = take(cursor);
      if (token)
        cursor.diagnostics.push(
          diagnostic('motion.unexpected-token', `Unexpected '${token.raw}'.`, token.span),
        );
    }
  }
  return {
    ...(duration === undefined ? {} : { durationMs: duration }),
    ...(easing === undefined ? {} : { easing }),
    ...(color === undefined ? {} : { color }),
    ...(interval === undefined ? {} : { intervalMs: interval }),
  };
}

function parseStatement(
  source: string,
  tokens: MotionToken[],
  sourceIndex: number,
  diagnostics: Diagnostic[],
): MotionStatement | undefined {
  const cursor: LineCursor = { tokens, index: 0, source, diagnostics };
  const statementSpan =
    tokens.length > 0
      ? sourceSpan(source, tokens[0]?.span.start ?? 0, tokens[tokens.length - 1]?.span.end ?? 0)
      : wholeSourceSpan(source);
  let label: string | undefined;
  if (tokens[0]?.kind === 'word' && tokens[1]?.kind === 'colon') {
    label = tokens[0].value;
    cursor.index = 2;
  }
  const timingToken = current(cursor);
  const timing = parseTiming(cursor);
  const verb = takeWord(cursor, 'a motion statement');
  if (!verb) return undefined;
  const base = { ...(label === undefined ? {} : { label }), span: statementSpan, sourceIndex };
  const diagnoseUnsupportedTiming = () => {
    if (timing.kind === 'implicit') return;
    diagnostics.push(
      diagnostic(
        'motion.unsupported-timing',
        `Timing prefixes are not supported on '${verb.value}' statements.`,
        timingToken?.span ?? statementSpan,
      ),
    );
  };

  if (verb.value === 'defaults') {
    diagnoseUnsupportedTiming();
    let defaults = { ...DEFAULTS };
    let sawValue = false;
    while (cursor.index < tokens.length) {
      if (matchWord(cursor, 'duration')) {
        defaults.durationMs = durationMs(take(cursor), cursor) ?? defaults.durationMs;
        sawValue = true;
      } else if (matchWord(cursor, 'easing')) {
        defaults.easing = parseEasing(cursor) ?? defaults.easing;
        sawValue = true;
      } else if (matchWord(cursor, 'color')) {
        const color = parseColor(cursor);
        if (color !== undefined) defaults.color = color;
        sawValue = true;
      } else {
        const token = take(cursor);
        if (token)
          diagnostics.push(
            diagnostic(
              'motion.unexpected-token',
              `Unexpected '${token.raw}' in defaults.`,
              token.span,
            ),
          );
      }
    }
    if (!sawValue)
      diagnostics.push(
        diagnostic(
          'motion.empty-defaults',
          'Defaults must set duration, easing, color, or a combination of them.',
          statementSpan,
        ),
      );
    return { kind: 'defaults', defaults, ...base };
  }

  if (verb.value === 'marker') {
    diagnoseUnsupportedTiming();
    const markerId = takeWord(cursor, 'a marker ID')?.value ?? '';
    const displayLabel = matchWord(cursor, 'as')
      ? (takeWord(cursor, 'a quoted marker label')?.value ?? markerId)
      : markerId;
    if (matchWord(cursor, 'shape')) {
      const shape = takeWord(cursor, "the marker shape 'dot'")?.value;
      if (shape !== 'dot')
        diagnostics.push(
          diagnostic(
            'motion.invalid-marker-shape',
            "Mermotion supports only the 'dot' marker shape.",
            statementSpan,
          ),
        );
    }
    if (cursor.index < tokens.length)
      diagnostics.push(
        diagnostic(
          'motion.unexpected-token',
          `Unexpected '${tokens[cursor.index]?.raw}'.`,
          tokens[cursor.index]?.span ?? statementSpan,
        ),
      );
    return {
      kind: 'marker',
      markerId,
      displayLabel,
      shape: 'dot',
      ...base,
    } satisfies MarkerStatement;
  }

  if (verb.value === 'wait') {
    diagnoseUnsupportedTiming();
    return {
      kind: 'wait',
      durationMs: durationMs(take(cursor), cursor) ?? 0,
      ...base,
    } satisfies WaitStatement;
  }

  if (verb.value === 'move') {
    const markerId = takeWord(cursor, 'a marker ID')?.value ?? '';
    if (!matchWord(cursor, 'along'))
      diagnostics.push(
        diagnostic(
          'motion.expected-along',
          "Expected 'along' before a route.",
          current(cursor)?.span ?? statementSpan,
        ),
      );
    const selector = parseSelector(cursor);
    const route =
      selector.kind === 'route' ? selector.nodes : selector.kind === 'id' ? [selector.id] : [];
    if (route.length < 2)
      diagnostics.push(
        diagnostic(
          'motion.invalid-route',
          'A marker route needs at least two node IDs joined by -->.',
          statementSpan,
        ),
      );
    const modifiers = parseModifiers(cursor);
    return { kind: 'move', markerId, route, timing, ...modifiers, ...base } satisfies MoveStatement;
  }

  if (verb.value === 'remove') {
    return {
      kind: 'removeMarker',
      markerId: takeWord(cursor, 'a marker ID')?.value ?? '',
      timing,
      ...base,
    } satisfies RemoveMarkerStatement;
  }

  if (isEffect(verb.value)) {
    const selectorToken = current(cursor);
    const hasExplicitSelector =
      selectorToken !== undefined &&
      !(selectorToken.kind === 'word' && MODIFIERS.has(selectorToken.value));
    if (!hasExplicitSelector)
      diagnostics.push(
        diagnostic(
          'motion.expected-selector',
          `Expected an explicit target for '${verb.value}', such as 'diagram' or 'node api'.`,
          selectorToken?.span ?? verb.span,
        ),
      );
    const selector = hasExplicitSelector ? parseSelector(cursor) : { kind: 'diagram' as const };
    const modifiers = parseModifiers(cursor);
    if (
      modifiers.intervalMs !== undefined &&
      !(verb.value === 'reveal' && selector.kind === 'allMessages')
    ) {
      diagnostics.push(
        diagnostic(
          'motion.invalid-every',
          "'every' is supported only by 'reveal messages'.",
          statementSpan,
        ),
      );
    }
    return {
      kind: 'effect',
      effect: verb.value,
      selector,
      timing,
      ...modifiers,
      ...base,
    } satisfies EffectStatement;
  }

  diagnostics.push(
    diagnostic('motion.unknown-statement', `Unknown motion statement '${verb.value}'.`, verb.span),
  );
  return undefined;
}

export function parseMotion(source: string): MotionParseResult {
  const lexed = tokenizeMotion(source);
  const diagnostics = [...lexed.diagnostics];
  const cst = splitCstLines(source);
  const lineTokens = new Map<number, MotionToken[]>();
  for (const token of lexed.tokens) {
    if (
      token.kind === 'newline' ||
      token.kind === 'comment' ||
      token.kind === 'eof' ||
      token.kind === 'semicolon'
    )
      continue;
    const existing = lineTokens.get(token.span.line) ?? [];
    existing.push(token);
    lineTokens.set(token.span.line, existing);
  }

  const declarationLine = cst.find((line) => line.kind !== 'blank' && line.kind !== 'comment');
  if (!declarationLine || declarationLine.raw.trim().replace(/;$/, '') !== 'motionDiagram-v1') {
    diagnostics.push(
      diagnostic(
        'motion.invalid-declaration',
        "The first non-comment line must be 'motionDiagram-v1'.",
        declarationLine?.span ?? wholeSourceSpan(source),
      ),
    );
    if (declarationLine) declarationLine.kind = 'invalid';
    return { diagnostics, tokens: lexed.tokens, cst };
  }
  declarationLine.kind = 'declaration';

  const statements: MotionStatement[] = [];
  let sawDefaults = false;
  for (const line of cst) {
    if (line === declarationLine || line.kind === 'blank' || line.kind === 'comment') continue;
    const tokens = lineTokens.get(line.span.line) ?? [];
    if (tokens.length === 0) continue;
    const statement = parseStatement(source, tokens, statements.length, diagnostics);
    if (statement) {
      if (statement.kind === 'defaults') {
        if (sawDefaults)
          diagnostics.push(
            diagnostic(
              'motion.duplicate-defaults',
              "Only one 'defaults' statement is allowed.",
              statement.span,
            ),
          );
        sawDefaults = true;
      }
      line.kind = 'statement';
      line.statementIndex = statements.length;
      statements.push(statement);
    } else line.kind = 'invalid';
  }

  let defaults = { ...DEFAULTS };
  for (const statement of statements)
    if (statement.kind === 'defaults') defaults = statement.defaults;
  const comments = cst.filter((line) => line.kind === 'comment');
  const document: MotionDocument = {
    version: 'motionDiagram-v1',
    source,
    statements,
    defaults,
    comments,
  };
  return { document, diagnostics, tokens: lexed.tokens, cst };
}

export function validateMotionSyntax(source: string): Diagnostic[] {
  return parseMotion(source).diagnostics;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds >= 1000 && milliseconds % 100 === 0)
    return `${Number((milliseconds / 1000).toFixed(3))}s`;
  return `${Number(milliseconds.toFixed(3))}ms`;
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;
}

function formatTiming(statement: EffectStatement | MoveStatement | RemoveMarkerStatement): string {
  const label = statement.label ? `${statement.label}: ` : '';
  if (statement.timing.kind === 'at')
    return `${label}at ${formatDuration(statement.timing.timeMs)} `;
  if (statement.timing.kind === 'after') return `${label}after ${statement.timing.label} `;
  if (statement.timing.kind === 'with') return `${label}with `;
  return label;
}

function formatSelector(selector: MotionSelector): string {
  if (selector.kind === 'diagram') return 'diagram';
  if (selector.kind === 'allMessages') return 'messages';
  if (selector.kind === 'route') return selector.nodes.map(formatMotionIdentifier).join(' --> ');
  if (selector.kind === 'edges')
    return `edges ${selector.ids.map(formatMotionIdentifier).join(', ')}`;
  if (selector.kind === 'message') {
    const occurrence =
      selector.occurrence === undefined ? '' : ` occurrence ${selector.occurrence}`;
    return `message ${formatMotionIdentifier(selector.from)}${selector.arrow}${formatMotionIdentifier(selector.to)}: ${quote(selector.text)}${occurrence}`;
  }
  return `${selector.targetKind ? `${selector.targetKind} ` : ''}${formatMotionIdentifier(selector.id)}`;
}

function formatStatement(statement: MotionStatement): string {
  if (statement.kind === 'defaults') {
    const color =
      statement.defaults.color === undefined ? '' : ` color ${statement.defaults.color}`;
    return `defaults duration ${formatDuration(statement.defaults.durationMs)} easing ${statement.defaults.easing}${color}`;
  }
  if (statement.kind === 'marker')
    return statement.displayLabel === statement.markerId
      ? `marker ${formatMotionIdentifier(statement.markerId)}`
      : `marker ${formatMotionIdentifier(statement.markerId)} as ${quote(statement.displayLabel)}`;
  if (statement.kind === 'wait') return `wait ${formatDuration(statement.durationMs)}`;
  if (statement.kind === 'removeMarker')
    return `${formatTiming(statement)}remove ${formatMotionIdentifier(statement.markerId)}`;
  if (statement.kind === 'move') {
    const duration =
      statement.durationMs === undefined ? '' : ` over ${formatDuration(statement.durationMs)}`;
    const easing = statement.easing === undefined ? '' : ` easing ${statement.easing}`;
    const color = statement.color === undefined ? '' : ` color ${statement.color}`;
    return `${formatTiming(statement)}move ${formatMotionIdentifier(statement.markerId)} along ${statement.route.map(formatMotionIdentifier).join(' --> ')}${duration}${easing}${color}`;
  }
  const durationKeyword =
    statement.effect === 'trace' && statement.selector.kind === 'route' ? 'over' : 'for';
  const duration =
    statement.durationMs === undefined
      ? ''
      : ` ${durationKeyword} ${formatDuration(statement.durationMs)}`;
  const interval =
    statement.intervalMs === undefined ? '' : ` every ${formatDuration(statement.intervalMs)}`;
  const easing = statement.easing === undefined ? '' : ` easing ${statement.easing}`;
  const color = statement.color === undefined ? '' : ` color ${statement.color}`;
  return `${formatTiming(statement)}${statement.effect} ${formatSelector(statement.selector)}${duration}${interval}${easing}${color}`;
}

export function formatMotion(source: string): MotionFormatResult {
  const parsed = parseMotion(source);
  if (!parsed.document) return { formatted: source, diagnostics: parsed.diagnostics };
  const lines: string[] = [];
  let previousBlank = false;
  for (const line of parsed.cst) {
    if (line.kind === 'declaration') {
      lines.push('motionDiagram-v1');
      previousBlank = false;
    } else if (line.kind === 'blank') {
      if (!previousBlank && lines.length > 0) lines.push('');
      previousBlank = true;
    } else if (line.kind === 'comment') {
      const trimmed = line.raw.trim();
      lines.push(`${lines.includes('motionDiagram-v1') ? '  ' : ''}${trimmed}`);
      previousBlank = false;
    } else if (line.statementIndex !== undefined) {
      const statement = parsed.document.statements[line.statementIndex];
      if (statement) lines.push(`  ${formatStatement(statement)}`);
      previousBlank = false;
    } else {
      lines.push(line.raw.trimEnd());
      previousBlank = false;
    }
  }
  while (lines[lines.length - 1] === '') lines.pop();
  return { formatted: `${lines.join('\n')}\n`, diagnostics: parsed.diagnostics };
}

export { DEFAULTS as MOTION_DEFAULTS };
