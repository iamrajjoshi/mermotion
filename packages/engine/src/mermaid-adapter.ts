import DOMPurify from 'dompurify';
import mermaid, { type MermaidConfig } from 'mermaid';
import { sourceSpan, wholeSourceSpan } from './spans.js';
import type {
  Diagnostic,
  MermaidInspection,
  MermaidRenderOptions,
  RenderedMermaid,
  SourceSpan,
} from './types.js';

const BASE_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  deterministicIds: true,
  deterministicIDSeed: 'mermotion',
};

let initializedConfig: string | undefined;
let renderCounter = 0;
let nodeParseSanitizerInstalled = false;

/**
 * Mermaid's public Node entry currently receives DOMPurify's window factory rather than an
 * initialized instance (upstream mermaid-js/mermaid#5204). Parsing can therefore crash on an
 * ordinary label before syntax validation begins. The CLI never renders or returns sanitized
 * markup, so its parse-only path can use identity sanitation until Mermaid fixes the Node export.
 * Browser rendering continues to use DOMPurify's real strict-mode instance.
 */
function ensureNodeParseSanitizer(): void {
  if (typeof document !== 'undefined' || typeof DOMPurify.sanitize === 'function') return;

  Reflect.set(DOMPurify, 'addHook', () => undefined);
  Reflect.set(DOMPurify, 'sanitize', (value: string | Node) => value);
  nodeParseSanitizerInstalled = true;
}

export class MermaidAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MermaidAdapterError';
    this.code = code;
  }
}

function configFor(options?: MermaidConfig): MermaidConfig {
  return {
    ...BASE_CONFIG,
    ...options,
    startOnLoad: false,
    securityLevel: 'strict',
    deterministicIds: true,
    deterministicIDSeed: options?.deterministicIDSeed ?? 'mermotion',
  };
}

function ensureInitialized(config?: MermaidConfig): void {
  const next = configFor(config);
  const serialized = JSON.stringify(next);
  if (initializedConfig && initializedConfig !== serialized) {
    throw new MermaidAdapterError(
      'mermaid.realm-config-changed',
      'This Mermaid render realm is already initialized with a different site configuration. Create a new isolated render realm instead.',
    );
  }
  if (!initializedConfig) {
    mermaid.initialize(next);
    initializedConfig = serialized;
  }
}

function safeRenderId(id: string | undefined): string {
  const candidate = id ?? `mermotion-${++renderCounter}`;
  const safe = candidate.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z]+/, 'mermotion-');
  return safe || `mermotion-${renderCounter}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; str?: unknown };
    if (typeof value.message === 'string') return value.message;
    if (typeof value.str === 'string') return value.str;
  }
  return 'Mermaid could not parse this diagram.';
}

function errorSpan(source: string, error: unknown): SourceSpan {
  if (!error || typeof error !== 'object') return wholeSourceSpan(source);
  const hash = (error as { hash?: { loc?: Record<string, unknown> } }).hash;
  const location = hash?.loc;
  const firstLine = typeof location?.first_line === 'number' ? location.first_line : undefined;
  const firstColumn = typeof location?.first_column === 'number' ? location.first_column : 0;
  const lastLine = typeof location?.last_line === 'number' ? location.last_line : firstLine;
  const lastColumn =
    typeof location?.last_column === 'number' ? location.last_column : firstColumn + 1;
  if (!firstLine) return wholeSourceSpan(source);
  const starts: number[] = [0];
  for (let index = 0; index < source.length; index += 1)
    if (source[index] === '\n') starts.push(index + 1);
  const start = (starts[firstLine - 1] ?? 0) + firstColumn;
  const end = (starts[(lastLine ?? firstLine) - 1] ?? start) + (lastColumn ?? firstColumn + 1);
  return sourceSpan(
    source,
    Math.min(start, source.length),
    Math.min(Math.max(start, end), source.length),
  );
}

function mermaidDiagnostic(source: string, error: unknown): Diagnostic {
  return {
    code: 'mermaid.parse-error',
    severity: 'error',
    message: errorMessage(error),
    span: errorSpan(source, error),
  };
}

export async function inspectMermaid(source: string): Promise<MermaidInspection> {
  try {
    ensureNodeParseSanitizer();
    ensureInitialized();
    const result = await mermaid.parse(source);
    return { diagramType: result.diagramType, diagnostics: [] };
  } catch (error) {
    return { diagnostics: [mermaidDiagnostic(source, error)] };
  }
}

export async function validateMermaid(source: string): Promise<Diagnostic[]> {
  return (await inspectMermaid(source)).diagnostics;
}

export async function renderMermaid(options: MermaidRenderOptions): Promise<RenderedMermaid> {
  if (typeof document === 'undefined') {
    throw new MermaidAdapterError(
      'mermaid.browser-required',
      'Mermaid SVG rendering requires a browser document. Use validateMermaid in plain Node or run rendering in a browser.',
    );
  }
  if (nodeParseSanitizerInstalled) {
    throw new MermaidAdapterError(
      'mermaid.clean-browser-realm-required',
      "This process already used Mermaid's parse-only Node compatibility path. Render in a fresh browser realm so strict DOMPurify sanitation remains active.",
    );
  }
  ensureInitialized(options.config);
  await mermaid.parse(options.source);
  const rendered = await mermaid.render(safeRenderId(options.id), options.source);
  return {
    svg: rendered.svg,
    diagramType: rendered.diagramType,
    ...(rendered.bindFunctions ? { bindFunctions: rendered.bindFunctions } : {}),
  };
}

export async function registeredMermaidDiagramTypes(): Promise<string[]> {
  ensureInitialized();
  return mermaid
    .getRegisteredDiagramsMetadata()
    .map((diagram) => diagram.id)
    .sort();
}

export function detectMermaidType(source: string, config?: MermaidConfig): string {
  ensureInitialized(config);
  return mermaid.detectType(source, config);
}
