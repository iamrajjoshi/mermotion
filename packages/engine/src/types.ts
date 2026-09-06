import type { MermaidConfig } from 'mermaid';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface SourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  span: SourceSpan;
}

export type MotionTokenKind =
  | 'word'
  | 'string'
  | 'duration'
  | 'number'
  | 'arrow'
  | 'colon'
  | 'comma'
  | 'semicolon'
  | 'comment'
  | 'newline'
  | 'unknown'
  | 'eof';

export interface MotionToken {
  kind: MotionTokenKind;
  value: string;
  raw: string;
  span: SourceSpan;
}

export interface MotionCstLine {
  kind: 'blank' | 'comment' | 'declaration' | 'statement' | 'invalid';
  raw: string;
  span: SourceSpan;
  statementIndex?: number;
}

export type MotionEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface MotionDefaults {
  durationMs: number;
  easing: MotionEasing;
  color?: string;
}

export type MotionTiming =
  | { kind: 'implicit' }
  | { kind: 'at'; timeMs: number }
  | { kind: 'after'; label: string }
  | { kind: 'with' };

export type SemanticTargetKind = 'diagram' | 'node' | 'edge' | 'participant' | 'message';

export type MotionSelector =
  | { kind: 'id'; id: string; targetKind?: Exclude<SemanticTargetKind, 'diagram' | 'message'> }
  | { kind: 'message'; from: string; to: string; arrow: string; text: string; occurrence: number }
  | { kind: 'allMessages' }
  | { kind: 'route'; nodes: string[] }
  | { kind: 'edges'; ids: string[] }
  | { kind: 'diagram' };

interface MotionStatementBase {
  label?: string;
  span: SourceSpan;
  sourceIndex: number;
}

export interface DefaultsStatement extends MotionStatementBase {
  kind: 'defaults';
  defaults: MotionDefaults;
}

export interface MarkerStatement extends MotionStatementBase {
  kind: 'marker';
  markerId: string;
  displayLabel: string;
  shape: 'dot';
}

export interface WaitStatement extends MotionStatementBase {
  kind: 'wait';
  durationMs: number;
}

export type MotionEffectKind = 'highlight' | 'unhighlight' | 'reveal' | 'hide' | 'pulse' | 'trace';

export interface EffectStatement extends MotionStatementBase {
  kind: 'effect';
  effect: MotionEffectKind;
  selector: MotionSelector;
  timing: MotionTiming;
  durationMs?: number;
  easing?: MotionEasing;
  color?: string;
  intervalMs?: number;
}

export interface MoveStatement extends MotionStatementBase {
  kind: 'move';
  markerId: string;
  route: string[];
  timing: MotionTiming;
  durationMs?: number;
  easing?: MotionEasing;
  color?: string;
}

export interface RemoveMarkerStatement extends MotionStatementBase {
  kind: 'removeMarker';
  markerId: string;
  timing: MotionTiming;
}

export type MotionStatement =
  | DefaultsStatement
  | MarkerStatement
  | WaitStatement
  | EffectStatement
  | MoveStatement
  | RemoveMarkerStatement;

export interface MotionDocument {
  version: 'motionDiagram-v1';
  source: string;
  statements: MotionStatement[];
  defaults: MotionDefaults;
  comments: MotionCstLine[];
}

export interface MotionParseResult {
  document?: MotionDocument;
  diagnostics: Diagnostic[];
  tokens: MotionToken[];
  cst: MotionCstLine[];
}

export interface MotionFormatResult {
  formatted: string;
  diagnostics: Diagnostic[];
}

export interface DiagramDocument {
  mermaidSource: string;
  motionSource?: string;
}

export interface SemanticTarget {
  key: string;
  kind: SemanticTargetKind;
  id: string;
  order: number;
  label?: string;
  from?: string;
  to?: string;
  arrow?: string;
  occurrence?: number;
}

export interface CompiledMarker {
  id: string;
  label: string;
  shape: 'dot';
}

export type CompiledEventKind =
  | 'highlight'
  | 'unhighlight'
  | 'reveal'
  | 'hide'
  | 'pulse'
  | 'trace'
  | 'move'
  | 'removeMarker';

export interface CompiledEvent {
  id: string;
  kind: CompiledEventKind;
  startMs: number;
  durationMs: number;
  easing: MotionEasing;
  sourceIndex: number;
  sourceSpan: SourceSpan;
  targetKeys: string[];
  route: string[];
  routeEdgeKeys?: string[];
  markerId?: string;
  color?: string;
}

export interface CompiledTimeline {
  version: 'motion-ir-v1';
  durationMs: number;
  defaults: MotionDefaults;
  markers: Record<string, CompiledMarker>;
  events: CompiledEvent[];
  targetKeys: string[];
  initialHiddenTargetKeys: string[];
}

export interface CompileOptions {
  targets?: SemanticTarget[];
}

export interface CompileResult {
  timeline?: CompiledTimeline;
  diagnostics: Diagnostic[];
}

export interface FrameTargetState {
  key: string;
  visible: boolean;
  opacity: number;
  highlight: number;
  pulse: number;
  color?: string;
}

export interface FrameMarkerState {
  id: string;
  label: string;
  shape: 'dot';
  route: string[];
  edgeKeys: string[];
  at: string;
  routeProgress: number;
  progress: number;
  phase: 'moving' | 'arriving' | 'settled';
  arrivalProgress: number;
  color?: string;
  from?: string;
  to?: string;
}

export interface FrameTraceState {
  id: string;
  targetKeys: string[];
  progress: number;
  color?: string;
}

export interface FrameState {
  timeMs: number;
  durationMs: number;
  targets: Record<string, FrameTargetState>;
  markers: Record<string, FrameMarkerState>;
  traces: FrameTraceState[];
}

export interface ApplyFrameOptions {
  reducedMotion?: boolean;
}

export interface MermaidRenderOptions {
  source: string;
  id?: string;
  config?: MermaidConfig;
}

export interface RenderedMermaid {
  svg: string;
  diagramType: string;
  bindFunctions?: (element: Element) => void;
}

export interface MermaidInspection {
  diagramType?: string;
  diagnostics: Diagnostic[];
}
