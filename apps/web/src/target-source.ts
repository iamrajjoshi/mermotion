import type { SemanticTarget } from '@mermotion/engine';

function quoteMotionValue(value: string): string {
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')}"`;
}

function motionId(id: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(id) ? id : quoteMotionValue(id);
}

export function selectorForTarget(target: SemanticTarget): string {
  switch (target.kind) {
    case 'diagram':
      return 'diagram';
    case 'node':
    case 'participant':
      return motionId(target.id);
    case 'edge':
      throw new Error('Connections must be authored from stable Mermaid endpoints.');
    case 'message': {
      const from = motionId(target.from ?? '');
      const to = motionId(target.to ?? '');
      const arrow = target.arrow ?? '->>';
      const label = quoteMotionValue(target.label ?? target.id);
      const occurrence = (target.occurrence ?? 1) > 1 ? ` occurrence ${target.occurrence}` : '';
      return `message ${from}${arrow}${to}: ${label}${occurrence}`;
    }
    default:
      return motionId(target.id);
  }
}

export function motionStatementForTarget(target: SemanticTarget, timeMs: number): string {
  if (target.kind === 'edge') {
    if (!target.from || !target.to) {
      throw new Error('This connection has no stable Mermaid endpoints to animate.');
    }
    return `  at ${Math.round(timeMs)}ms trace ${motionId(target.from)} --> ${motionId(target.to)} over 500ms`;
  }
  return `  at ${Math.round(timeMs)}ms pulse ${selectorForTarget(target)} for 500ms`;
}
