import { describe, expect, it } from 'vitest';
import { formatMotion, parseMotion, validateMotion } from '../src/index.js';

describe('motionDiagram-v1 language', () => {
  it('requires the versioned declaration', () => {
    const result = parseMotion('highlight A\n');
    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'motion.invalid-declaration',
          severity: 'error',
          span: expect.objectContaining({ line: 1 }),
        }),
      ]),
    );
  });

  it('accepts Mermaid-style comments and optional semicolons', () => {
    const source = `%% leading comment
motionDiagram-v1;
  defaults duration 400ms easing ease-out;
  %% route comment
  marker request as "Request" shape dot;
  move request along A --> B --> C over 1.2s;
`;
    const result = parseMotion(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.statements.map((statement) => statement.kind)).toEqual([
      'defaults',
      'marker',
      'move',
    ]);
    expect(result.document?.comments).toHaveLength(2);

    const formatted = formatMotion(source).formatted;
    expect(formatted).not.toContain(';');
    expect(formatMotion(formatted).formatted).toBe(formatted);
    expect(formatted).toContain('marker request as "Request"');
    expect(formatted).not.toContain('shape dot');
    expect(formatted).toContain('move request along A --> B --> C over 1.2s');
  });

  it('accepts concise markers and normalizes the legacy dot shape', () => {
    const source = `motionDiagram-v1
  marker request
  marker worker as "Worker"
  marker response as "response"
  marker legacy as "Legacy" shape dot
  marker compact shape dot
`;
    const result = parseMotion(source);

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ markerId: 'request', displayLabel: 'request', shape: 'dot' }),
        expect.objectContaining({ markerId: 'worker', displayLabel: 'Worker', shape: 'dot' }),
        expect.objectContaining({ markerId: 'legacy', displayLabel: 'Legacy', shape: 'dot' }),
      ]),
    );
    expect(formatMotion(source).formatted).toBe(`motionDiagram-v1
  marker request
  marker worker as "Worker"
  marker response
  marker legacy as "Legacy"
  marker compact
`);
  });

  it('parses and formats default and per-move colors without losing either', () => {
    const source = `motionDiagram-v1
  defaults color #ff4d6d duration 480ms easing ease-out
  marker request as "Request" shape dot
  move request along A --> B over 1.2s color #62a8ff easing linear
`;
    const result = parseMotion(source);

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.defaults).toEqual({
      durationMs: 480,
      easing: 'ease-out',
      color: '#ff4d6d',
    });
    expect(result.document?.statements[2]).toMatchObject({
      kind: 'move',
      color: '#62a8ff',
    });
    expect(formatMotion(source).formatted).toBe(`motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff4d6d
  marker request as "Request"
  move request along A --> B over 1.2s easing linear color #62a8ff
`);
  });

  it('diagnoses duplicate defaults without changing last-statement compatibility', () => {
    const result = parseMotion(`motionDiagram-v1
  defaults duration 200ms easing linear
  defaults duration 750ms easing ease-in
`);

    expect(result.document?.statements.filter(({ kind }) => kind === 'defaults')).toHaveLength(2);
    expect(result.document?.defaults).toEqual({ durationMs: 750, easing: 'ease-in' });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'motion.duplicate-defaults',
        severity: 'error',
        span: expect.objectContaining({ line: 3 }),
      }),
    ]);
  });

  it('diagnoses timing prefixes that cannot affect defaults, markers, or waits', () => {
    const result = parseMotion(`motionDiagram-v1
  at 0ms defaults duration 200ms
  with marker request
  after intro wait 100ms
`);

    expect(result.document?.statements.map(({ kind }) => kind)).toEqual([
      'defaults',
      'marker',
      'wait',
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'motion.unsupported-timing',
        span: expect.objectContaining({ line: 2 }),
      }),
      expect.objectContaining({
        code: 'motion.unsupported-timing',
        span: expect.objectContaining({ line: 3 }),
      }),
      expect.objectContaining({
        code: 'motion.unsupported-timing',
        span: expect.objectContaining({ line: 4 }),
      }),
    ]);
  });

  it('requires effects to name an explicit selector', () => {
    const source = `motionDiagram-v1
  pulse
  pulse for 200ms
  pulse diagram
`;
    const result = parseMotion(source);

    expect(result.document?.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: { kind: 'diagram' } }),
        expect.objectContaining({ selector: { kind: 'diagram' }, durationMs: 200 }),
      ]),
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'motion.expected-selector',
        span: expect.objectContaining({ line: 2 }),
      }),
      expect.objectContaining({
        code: 'motion.expected-selector',
        span: expect.objectContaining({ line: 3 }),
      }),
    ]);
    expect(formatMotion(source).formatted).toBe(`motionDiagram-v1
  pulse diagram
  pulse diagram for 200ms
  pulse diagram
`);
  });

  it('uses over for trace routes and for for target effect durations', () => {
    const source = `motionDiagram-v1
  trace A --> M --> X over 1.2s
  pulse node X for 500ms
`;

    expect(formatMotion(source)).toEqual({ formatted: source, diagnostics: [] });
  });

  it('reports an invalid default color at its source line', () => {
    const result = parseMotion(`motionDiagram-v1
  defaults duration 400ms color tomato
`);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'motion.invalid-color',
        span: expect.objectContaining({ line: 2 }),
      }),
    ]);
  });

  it('recovers after an invalid statement and reports its exact line', () => {
    const result = parseMotion(`motionDiagram-v1
  sparkle A
  highlight B
`);
    expect(result.document?.statements).toHaveLength(1);
    expect(result.document?.statements[0]).toMatchObject({ kind: 'effect', effect: 'highlight' });
    expect(result.diagnostics[0]).toMatchObject({
      code: 'motion.unknown-statement',
      span: { line: 2 },
    });
  });

  it('parses explicit timing and repeated message selectors', () => {
    const result = parseMotion(`motionDiagram-v1
  intro: at 0ms highlight participant API
  with pulse participant API for 500ms
  later: after intro pulse message Worker->>API: "GET /status" occurrence 2 for 300ms
`);
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'intro', timing: { kind: 'at', timeMs: 0 } }),
        expect.objectContaining({ timing: { kind: 'with' } }),
        expect.objectContaining({
          label: 'later',
          selector: expect.objectContaining({ kind: 'message', occurrence: 2 }),
        }),
      ]),
    );
  });

  it('includes compiler diagnostics in motion validation', () => {
    const diagnostics = validateMotion(`motionDiagram-v1
  move missing along A --> B over 1s
`);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'motion.unknown-marker', severity: 'error' }),
      ]),
    );
  });
});
