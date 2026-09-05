import {
  compileMotion,
  type CompiledEvent,
  type CompiledEventKind,
  type SemanticTarget,
} from '@mermotion/engine';

export interface CueSummary {
  id: string;
  line: number;
  type: CompiledEventKind;
  label: string;
  startMs: number;
  durationMs: number;
}

function compactTarget(key: string): string {
  if (key.startsWith('node:')) return key.slice('node:'.length);
  if (key.startsWith('participant:')) return key.slice('participant:'.length);
  if (key.startsWith('edge:')) return key.slice('edge:'.length).replace('-->', ' → ');
  if (key.startsWith('message:')) return key.slice('message:'.length);
  return key;
}

function eventLabel(event: CompiledEvent): string {
  const targetKeys = event.route.length > 0 ? event.route : event.targetKeys;
  const separator = event.kind === 'move' ? ' → ' : ' · ';
  const targetLabel = targetKeys.map(compactTarget).join(separator);
  return [event.markerId, targetLabel].filter(Boolean).join(' · ') || 'diagram';
}

export function summarizeCues(source: string, targets?: SemanticTarget[]): CueSummary[] {
  const { timeline } = compileMotion(
    { mermaidSource: '', motionSource: source },
    targets ? { targets } : {},
  );

  return (timeline?.events ?? []).map((event) => ({
    durationMs: event.durationMs,
    id: event.id,
    label: eventLabel(event),
    line: event.sourceSpan.line,
    startMs: event.startMs,
    type: event.kind,
  }));
}

export function inferDuration(cues: CueSummary[], fallbackMs: number): number {
  const contentDuration = cues.reduce(
    (largest, cue) => Math.max(largest, cue.startMs + cue.durationMs),
    0,
  );
  return Math.max(fallbackMs, Math.ceil(contentDuration / 400) * 400);
}
