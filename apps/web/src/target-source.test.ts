import { compileMotion, type SemanticTarget } from '@mermotion/engine';
import { describe, expect, it } from 'vitest';

import { motionStatementForTarget, selectorForTarget } from './target-source';

const target = (overrides: Partial<SemanticTarget>): SemanticTarget => ({
  id: 'checkout',
  key: 'node:checkout',
  kind: 'node',
  order: 1,
  ...overrides,
});

describe('target source serialization', () => {
  it.each([
    [target({}), 'checkout'],
    [target({ id: 'Browser', key: 'participant:Browser', kind: 'participant' }), 'Browser'],
    [target({ id: 'diagram', key: 'diagram', kind: 'diagram' }), 'diagram'],
  ] as const)('serializes %s', (semanticTarget, expected) => {
    expect(selectorForTarget(semanticTarget)).toBe(expected);
  });

  it('keeps repeated sequence messages unambiguous and escapes their label', () => {
    expect(
      selectorForTarget(
        target({
          arrow: '->>',
          from: 'Worker',
          id: 'message-2',
          key: 'message:Worker->>API:Say "ready"#2',
          kind: 'message',
          label: 'Say "ready"',
          occurrence: 2,
          to: 'API',
        }),
      ),
    ).toBe('message Worker->>API: "Say \\"ready\\"" occurrence 2');
  });

  it('omits the default occurrence for a unique sequence message', () => {
    expect(
      selectorForTarget(
        target({
          arrow: '->>',
          from: 'Worker',
          id: 'message-1',
          key: 'message:Worker->>API:Ready#1',
          kind: 'message',
          label: 'Ready',
          occurrence: 1,
          to: 'API',
        }),
      ),
    ).toBe('message Worker->>API: "Ready"');
  });

  it('writes a stable route for a clicked connection instead of its generated SVG ID', () => {
    const edge = target({
      from: 'checkout',
      id: 'L_checkout_done_0',
      key: 'edge:checkout-->done#1',
      kind: 'edge',
      occurrence: 1,
      to: 'done',
    });
    const statement = motionStatementForTarget(edge, 260);
    const motionSource = `motionDiagram-v1\n${statement}`;
    const compiled = compileMotion({ mermaidSource: '', motionSource }, { targets: [edge] });

    expect(statement).toBe('  at 260ms trace checkout --> done over 500ms');
    expect(statement).not.toContain('L_checkout_done_0');
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.timeline?.events[0]?.targetKeys).toEqual([edge.key]);
  });

  it('refuses to serialize a connection when Mermaid endpoints cannot be recovered', () => {
    const unresolvedEdge = target({
      id: 'L_generated_0',
      key: 'edge:L_generated_0',
      kind: 'edge',
    });

    expect(() => selectorForTarget(unresolvedEdge)).toThrow(/stable Mermaid endpoints/);
    expect(() => motionStatementForTarget(unresolvedEdge, 260)).toThrow(
      /no stable Mermaid endpoints/,
    );
  });

  it('writes the short canonical pulse form for a node', () => {
    expect(motionStatementForTarget(target({}), 260)).toBe('  at 260ms pulse checkout for 500ms');
  });
});
