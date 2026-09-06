import { describe, expect, it } from 'vitest';
import { compileMotion, compileMotionSource, sampleTimeline } from '../src/index.js';
import type { SemanticTarget } from '../src/index.js';

const flowTargets: SemanticTarget[] = [
  { key: 'node:A', kind: 'node', id: 'A', label: 'Client', order: 0 },
  { key: 'node:B', kind: 'node', id: 'B', label: 'API', order: 1 },
  { key: 'node:C', kind: 'node', id: 'C', label: 'Worker', order: 2 },
  { key: 'edge:A-->B#1', kind: 'edge', id: 'L_A_B_0', from: 'A', to: 'B', occurrence: 1, order: 3 },
  { key: 'edge:B-->C#1', kind: 'edge', id: 'L_B_C_0', from: 'B', to: 'C', occurrence: 1, order: 4 },
];

const sequenceTargets: SemanticTarget[] = [
  { key: 'participant:Worker', kind: 'participant', id: 'Worker', label: 'Worker', order: 0 },
  { key: 'participant:API', kind: 'participant', id: 'API', label: 'API', order: 1 },
  {
    key: 'message:Worker->>API:GET /status#1',
    kind: 'message',
    id: 'i0',
    label: 'GET /status',
    from: 'Worker',
    to: 'API',
    arrow: '->>',
    occurrence: 1,
    order: 2,
  },
  {
    key: 'message:Worker->>API:GET /status#2',
    kind: 'message',
    id: 'i1',
    label: 'GET /status',
    from: 'Worker',
    to: 'API',
    arrow: '->>',
    occurrence: 2,
    order: 3,
  },
];

function compile(source: string) {
  const result = compileMotionSource(source, { targets: flowTargets });
  expect(result.diagnostics).toEqual([]);
  expect(result.timeline).toBeDefined();
  return result.timeline!;
}

describe('motion compilation and sampling', () => {
  it('returns a still, empty state for a document without motion', () => {
    const result = compileMotion(
      { mermaidSource: 'flowchart LR\n A-->B' },
      { targets: flowTargets },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.timeline).toMatchObject({
      durationMs: 0,
      events: [],
      initialHiddenTargetKeys: [],
    });
    const frame = sampleTimeline(result.timeline!, 10_000);
    expect(frame).toMatchObject({ timeMs: 0, durationMs: 0, markers: {}, traces: [] });
    expect(Object.values(frame.targets)).toHaveLength(flowTargets.length);
    expect(
      Object.values(frame.targets).every(
        (target) =>
          target.visible && target.opacity === 1 && target.highlight === 0 && target.pulse === 0,
      ),
    ).toBe(true);
  });

  it('persists highlight and marker destination state after their cues', () => {
    const timeline = compile(`motionDiagram-v1
  defaults duration 400ms easing linear
  marker request as "Request" shape dot
  highlight A
  move request along A --> B --> C over 1.2s
`);
    const frame = sampleTimeline(timeline, timeline.durationMs);
    expect(frame.targets['node:A']?.highlight).toBe(1);
    expect(frame.markers.request).toMatchObject({
      at: 'node:C',
      route: ['node:A', 'node:B', 'node:C'],
      edgeKeys: ['edge:A-->B#1', 'edge:B-->C#1'],
      routeProgress: 1,
      progress: 1,
      phase: 'settled',
      arrivalProgress: 1,
      from: 'node:B',
      to: 'node:C',
    });
    expect(frame.markers.request).not.toHaveProperty('color');
  });

  it('applies a default motion color while explicit cue colors take precedence', () => {
    const timeline = compile(`motionDiagram-v1
  defaults duration 1s easing linear color #ff4d6d
  marker request as "Request" shape dot
  at 0ms highlight A
  with pulse B color #ffd166
  with trace A --> B color inherit
  with move request along A --> B color #62a8ff
`);

    expect(timeline.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'highlight', color: '#ff4d6d' }),
        expect.objectContaining({ kind: 'pulse', color: '#ffd166' }),
        expect.objectContaining({ kind: 'trace', color: 'inherit' }),
        expect.objectContaining({ kind: 'move', color: '#62a8ff' }),
      ]),
    );

    const frame = sampleTimeline(timeline, 500);
    expect(frame.targets['node:A']?.color).toBe('#ff4d6d');
    expect(frame.targets['node:B']?.color).toBe('#ffd166');
    expect(frame.traces).toEqual([expect.objectContaining({ color: 'inherit' })]);
    expect(frame.markers.request?.color).toBe('#62a8ff');
  });

  it('samples marker color identity independently of prior seeks', () => {
    const timeline = compile(`motionDiagram-v1
  marker request as "Request"
  at 0ms move request along A --> B over 1s easing linear
  move request along B --> C over 1s easing linear
`);

    expect(sampleTimeline(timeline, 100).markers.request).toMatchObject({
      colorSourceKey: 'edge:A-->B#1',
    });
    expect(sampleTimeline(timeline, 1_100).markers.request).toMatchObject({
      route: ['node:B', 'node:C'],
      colorSourceKey: 'edge:A-->B#1',
    });
  });

  it('resets inherited marker color identity after remove', () => {
    const timeline = compile(`motionDiagram-v1
  marker request as "Request"
  at 0ms move request along A --> B over 1s easing linear
  remove request
  move request along B --> C over 1s easing linear
`);

    expect(sampleTimeline(timeline, 1_100).markers.request).toMatchObject({
      colorSourceKey: 'edge:B-->C#1',
    });
  });

  it('samples a deterministic 200ms arrival after movement finishes', () => {
    const timeline = compile(`motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request" shape dot
  move request along A --> B
`);

    expect(timeline.durationMs).toBe(300);
    expect(sampleTimeline(timeline, 99).markers.request).toMatchObject({
      phase: 'moving',
      arrivalProgress: 0,
      routeProgress: 0.99,
    });
    expect(sampleTimeline(timeline, 100).markers.request).toMatchObject({
      phase: 'arriving',
      arrivalProgress: 0,
      routeProgress: 1,
    });
    expect(sampleTimeline(timeline, 200).markers.request).toMatchObject({
      phase: 'arriving',
      arrivalProgress: 0.5,
      routeProgress: 1,
    });
    expect(sampleTimeline(timeline, 299).markers.request).toMatchObject({
      phase: 'arriving',
      arrivalProgress: 0.995,
      routeProgress: 1,
    });
    expect(sampleTimeline(timeline, 300).markers.request).toMatchObject({
      phase: 'settled',
      arrivalProgress: 1,
      routeProgress: 1,
    });
    expect(sampleTimeline(timeline, 10_000)).toEqual(sampleTimeline(timeline, 300));
  });

  it('keeps authored cue chaining independent from the visual arrival window', () => {
    const timeline = compile(`motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request" shape dot
  travel: move request along A --> B
  after travel pulse B for 50ms
  move request along B --> C
`);

    expect(timeline.events).toEqual([
      expect.objectContaining({ kind: 'move', startMs: 0, durationMs: 100 }),
      expect.objectContaining({ kind: 'pulse', startMs: 100, durationMs: 50 }),
      expect.objectContaining({ kind: 'move', startMs: 150, durationMs: 100 }),
    ]);
    expect(timeline.durationMs).toBe(450);
    expect(sampleTimeline(timeline, 149).markers.request).toMatchObject({
      phase: 'arriving',
      arrivalProgress: 0.245,
      at: 'node:B',
    });
    expect(sampleTimeline(timeline, 150).markers.request).toMatchObject({
      phase: 'moving',
      arrivalProgress: 0,
      from: 'node:B',
      to: 'node:C',
    });
  });

  it('caps arrival when a following marker move or removal takes over', () => {
    const continued = compile(`motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request" shape dot
  move request along A --> B
  move request along B --> C
`);

    expect(continued.durationMs).toBe(400);
    expect(sampleTimeline(continued, 100).markers.request).toMatchObject({
      phase: 'moving',
      arrivalProgress: 0,
      from: 'node:B',
      to: 'node:C',
    });

    const removed = compile(`motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request" shape dot
  move request along A --> B
  at 150ms remove request
`);

    expect(removed.durationMs).toBe(150);
    expect(sampleTimeline(removed, 149).markers.request).toMatchObject({
      phase: 'arriving',
      arrivalProgress: 0.245,
    });
    expect(sampleTimeline(removed, 150).markers.request).toBeUndefined();
  });

  it('samples identical state for the same timestamp regardless of prior seeks', () => {
    const timeline = compile(`motionDiagram-v1
  marker request as "Request" shape dot
  highlight A
  move request along A --> B --> C over 1.2s
  pulse C for 500ms
`);
    const first = sampleTimeline(timeline, 725);
    sampleTimeline(timeline, 0);
    sampleTimeline(timeline, timeline.durationMs);
    const repeated = sampleTimeline(timeline, 725);
    expect(repeated).toEqual(first);
  });

  it('keeps one marker continuous across route segments', () => {
    const timeline = compile(`motionDiagram-v1
  defaults duration 400ms easing linear
  marker request as "Request" shape dot
  move request along A --> B --> C over 1s
`);
    const beforeBoundary = sampleTimeline(timeline, 499).markers.request;
    const boundary = sampleTimeline(timeline, 500).markers.request;
    const afterBoundary = sampleTimeline(timeline, 501).markers.request;
    expect(beforeBoundary).toMatchObject({ from: 'node:A', to: 'node:B' });
    expect(boundary).toMatchObject({ from: 'node:B', to: 'node:C', progress: 0 });
    expect(afterBoundary).toMatchObject({ from: 'node:B', to: 'node:C' });
    expect(beforeBoundary?.routeProgress).toBeCloseTo(0.499);
    expect(boundary?.routeProgress).toBe(0.5);
    expect(afterBoundary?.routeProgress).toBeCloseTo(0.501);
    expect(beforeBoundary?.id).toBe(boundary?.id);
    expect(boundary?.id).toBe(afterBoundary?.id);
  });

  it('defaults literal route motion to linear without changing state-effect easing', () => {
    const timeline = compile(`motionDiagram-v1
  defaults duration 400ms easing ease-out
  marker request as "Request"
  move request along A --> B
  trace A --> B
  highlight B
`);

    expect(timeline.events).toEqual([
      expect.objectContaining({ kind: 'move', easing: 'linear' }),
      expect.objectContaining({ kind: 'trace', easing: 'linear' }),
      expect.objectContaining({ kind: 'highlight', easing: 'ease-out' }),
    ]);
  });

  it('respects an explicit route easing', () => {
    const timeline = compile(`motionDiagram-v1
  marker request as "Request"
  move request along A --> B easing ease-in-out
  trace A --> B easing ease-in
`);

    expect(timeline.events).toEqual([
      expect.objectContaining({ kind: 'move', easing: 'ease-in-out' }),
      expect.objectContaining({ kind: 'trace', easing: 'ease-in' }),
    ]);
  });

  it('accepts contiguous marker moves and rejects discontinuous ones', () => {
    const contiguous = compile(`motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request" shape dot
  move request along A --> B
  move request along B --> C
`);
    expect(contiguous.events.filter(({ kind }) => kind === 'move')).toHaveLength(2);

    const discontinuous = compileMotionSource(
      `motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request" shape dot
  move request along A --> B
  move request along A --> B over 10s
`,
      { targets: flowTargets },
    );
    expect(discontinuous.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'motion.discontinuous-marker-route' }),
      ]),
    );
    expect(discontinuous.timeline?.events.filter(({ kind }) => kind === 'move')).toHaveLength(1);
    expect(discontinuous.timeline?.durationMs).toBe(300);
  });

  it('rejects overlapping moves for one marker', () => {
    const result = compileMotionSource(
      `motionDiagram-v1
  marker request as "Request" shape dot
  at 0ms move request along A --> B over 1s easing linear
  at 500ms move request along B --> C over 10s easing linear
`,
      { targets: flowTargets },
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'motion.overlapping-marker-move' })]),
    );
    expect(result.timeline?.events.filter(({ kind }) => kind === 'move')).toHaveLength(1);
    expect(result.timeline?.durationMs).toBe(1_200);
  });

  it('does not let a rejected move delay later implicit cues', () => {
    const result = compileMotionSource(
      `motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request"
  move request along A --> B
  move request along A --> B over 10s
  highlight C
`,
      { targets: flowTargets },
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'motion.discontinuous-marker-route' }),
      ]),
    );
    expect(result.timeline?.events).toEqual([
      expect.objectContaining({ kind: 'move', startMs: 0, durationMs: 100 }),
      expect.objectContaining({ kind: 'highlight', startMs: 100, durationMs: 100 }),
    ]);
    expect(result.timeline?.durationMs).toBe(300);
  });

  it('revalidates later moves after compacting one rejected implicit cue', () => {
    const result = compileMotionSource(
      `motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request"
  move request along A --> B
  move request along A --> B over 10s
  move request along B --> C
  at 500ms move request along B --> C
`,
      { targets: flowTargets },
    );

    expect(result.timeline?.events).toEqual([
      expect.objectContaining({ kind: 'move', sourceIndex: 2, startMs: 0, durationMs: 100 }),
      expect.objectContaining({ kind: 'move', sourceIndex: 4, startMs: 100, durationMs: 100 }),
    ]);
    expect(result.timeline?.durationMs).toBe(400);
    expect(
      result.diagnostics.filter(
        ({ code }) =>
          code === 'motion.discontinuous-marker-route' || code === 'motion.overlapping-marker-move',
      ),
    ).toEqual([
      expect.objectContaining({ span: expect.objectContaining({ line: 5 }) }),
      expect.objectContaining({ span: expect.objectContaining({ line: 7 }) }),
    ]);
  });

  it('reports unknown semantic targets instead of guessing', () => {
    const result = compileMotionSource('motionDiagram-v1\n  highlight A\n  pulse Missing\n', {
      targets: flowTargets,
    });
    expect(result.timeline?.events).toEqual([
      expect.objectContaining({ kind: 'highlight', targetKeys: ['node:A'] }),
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'motion.target-not-found' })]),
    );
  });

  it('compiles the same semantic bindings after label, source-order, layout, and theme edits', () => {
    const source = `motionDiagram-v1
  marker request as "Request"
  at 0ms highlight A
  with trace A --> B over 800ms
  with move request along A --> B --> C over 1.2s
`;
    const variants: SemanticTarget[][] = [
      flowTargets,
      flowTargets.map((target) => ({
        ...target,
        order: flowTargets.length - target.order,
        ...(target.kind === 'node' ? { label: `Changed ${target.id}` } : {}),
      })),
      flowTargets.map((target) =>
        target.kind === 'edge'
          ? { ...target, id: `different-rendered-id-${target.order}` }
          : { ...target },
      ),
    ];

    const compilations = variants.map((targets) => compileMotionSource(source, { targets }));
    for (const result of compilations) expect(result.diagnostics).toEqual([]);

    const bindings = compilations.map((result) =>
      result.timeline?.events.map(({ kind, route, routeEdgeKeys, targetKeys }) => ({
        kind,
        route,
        routeEdgeKeys,
        targetKeys,
      })),
    );
    expect(bindings[1]).toEqual(bindings[0]);
    expect(bindings[2]).toEqual(bindings[0]);
  });

  it.each([
    {
      name: 'deleted',
      targets: flowTargets.filter(
        (target) => target.id !== 'A' && !(target.from === 'A' && target.to === 'B'),
      ),
    },
    {
      name: 'renamed while retaining its label',
      targets: flowTargets.map((target) => {
        if (target.kind === 'node' && target.id === 'A')
          return { ...target, key: 'node:origin', id: 'origin', label: 'Client' };
        if (target.kind === 'edge' && target.from === 'A')
          return {
            ...target,
            key: 'edge:origin-->B#1',
            id: 'L_origin_B_0',
            from: 'origin',
          };
        return target;
      }),
    },
  ])('fails $name IDs instead of rebinding by label', ({ targets }) => {
    const result = compileMotionSource(
      'motionDiagram-v1\n  at 0ms highlight A\n  with trace A --> B over 400ms\n',
      { targets },
    );

    expect(result.timeline?.events).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'motion.target-not-found', severity: 'error' }),
        expect.objectContaining({ code: 'motion.route-edge-not-found', severity: 'error' }),
      ]),
    );
  });

  it('rejects duplicate semantic IDs instead of taking the first rendered target', () => {
    const targets: SemanticTarget[] = [
      ...flowTargets,
      { key: 'node:A-duplicate', kind: 'node', id: 'A', label: 'Client copy', order: 5 },
    ];
    const result = compileMotionSource('motionDiagram-v1\n  highlight A\n', { targets });

    expect(result.timeline?.events).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'motion.ambiguous-target', severity: 'error' }),
    ]);
  });

  it.each([
    ['deleted occurrence', sequenceTargets.slice(0, 3)],
    [
      'renamed message',
      sequenceTargets.map((target) =>
        target.kind === 'message' && target.label === 'GET /status'
          ? {
              ...target,
              key: target.key.replace('GET /status', 'GET /health'),
              label: 'GET /health',
            }
          : target,
      ),
    ],
  ])('fails a %s instead of rebinding a repeated sequence message', (_name, targets) => {
    const result = compileMotionSource(
      'motionDiagram-v1\n  pulse message Worker->>API: "GET /status" occurrence 2\n',
      { targets },
    );

    expect(result.timeline?.events).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'motion.target-not-found', severity: 'error' }),
    ]);
  });

  it('requires an explicit occurrence when otherwise identical sequence messages repeat', () => {
    const ambiguous = compileMotionSource(
      'motionDiagram-v1\n  pulse message Worker->>API: "GET /status"\n',
      { targets: sequenceTargets },
    );
    expect(ambiguous.timeline?.events).toEqual([]);
    expect(ambiguous.diagnostics).toEqual([
      expect.objectContaining({
        code: 'motion.ambiguous-target',
        message: expect.stringContaining('Add a one-based occurrence'),
        severity: 'error',
      }),
    ]);

    const first = compileMotionSource(
      'motionDiagram-v1\n  pulse message Worker->>API: "GET /status" occurrence 1\n',
      { targets: sequenceTargets },
    );
    expect(first.diagnostics).toEqual([]);
    expect(first.timeline?.events).toEqual([
      expect.objectContaining({ targetKeys: ['message:Worker->>API:GET /status#1'] }),
    ]);
  });

  it('uses the Mermaid arrow when resolving otherwise identical messages', () => {
    const targets: SemanticTarget[] = [
      {
        key: 'message:Worker->>API:GET /status#1',
        kind: 'message',
        id: 'solid',
        label: 'GET /status',
        from: 'Worker',
        to: 'API',
        arrow: '->>',
        occurrence: 1,
        order: 0,
      },
      {
        key: 'message:Worker-->>API:GET /status#1',
        kind: 'message',
        id: 'dashed',
        label: 'GET /status',
        from: 'Worker',
        to: 'API',
        arrow: '-->>',
        occurrence: 1,
        order: 1,
      },
    ];
    const result = compileMotionSource(
      'motionDiagram-v1\n  pulse message Worker-->>API: "GET /status" for 300ms\n',
      { targets },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.timeline?.events).toEqual([
      expect.objectContaining({
        kind: 'pulse',
        targetKeys: ['message:Worker-->>API:GET /status#1'],
      }),
    ]);
  });

  it('moves a marker across a unique sequence message connection', () => {
    const result = compileMotionSource(
      `motionDiagram-v1
  marker request as "Request" shape dot
  move request along Worker --> API over 1s easing linear
`,
      { targets: sequenceTargets.slice(0, 3) },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.timeline?.events).toEqual([
      expect.objectContaining({
        kind: 'move',
        markerId: 'request',
        targetKeys: ['participant:Worker', 'participant:API'],
        route: ['participant:Worker', 'participant:API'],
        routeEdgeKeys: ['message:Worker->>API:GET /status#1'],
      }),
    ]);
  });

  it('traces a unique sequence message connection', () => {
    const result = compileMotionSource(
      'motionDiagram-v1\n  trace Worker --> API over 1s easing linear\n',
      { targets: sequenceTargets.slice(0, 3) },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.timeline?.events).toEqual([
      expect.objectContaining({
        kind: 'trace',
        targetKeys: ['message:Worker->>API:GET /status#1'],
        route: ['message:Worker->>API:GET /status#1'],
      }),
    ]);
  });

  it.each([
    [
      'move',
      `motionDiagram-v1
  marker request as "Request" shape dot
  move request along Worker --> API over 1s
`,
    ],
    ['trace', 'motionDiagram-v1\n  trace Worker --> API over 1s\n'],
  ])('rejects an ambiguous sequence %s route', (_effect, source) => {
    const result = compileMotionSource(source, { targets: sequenceTargets });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'motion.ambiguous-route', severity: 'error' }),
    ]);
    expect(result.timeline?.events).toEqual([]);
  });

  it('omits only a syntactically invalid cue and keeps later valid cues playable', () => {
    const result = compileMotionSource(`motionDiagram-v1
  pulse A for nope
  highlight B
`);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'motion.expected-duration' })]),
    );
    expect(result.timeline?.events).toEqual([
      expect.objectContaining({ kind: 'highlight', targetKeys: ['node:B'] }),
    ]);
  });

  it('supports the complete effect vocabulary', () => {
    const source = `motionDiagram-v1
  defaults duration 100ms easing linear
  reveal messages every 200ms
  highlight participant API
  unhighlight participant API
  pulse message Worker->>API: "GET /status" occurrence 2 for 300ms
  hide participant Worker
`;
    const result = compileMotionSource(source, { targets: sequenceTargets });
    expect(result.diagnostics).toEqual([]);
    expect(result.timeline?.events.map((event) => event.kind)).toEqual([
      'reveal',
      'reveal',
      'highlight',
      'unhighlight',
      'pulse',
      'hide',
    ]);
    const firstMessageBeforeReveal = sampleTimeline(result.timeline!, 0).targets[
      'message:Worker->>API:GET /status#1'
    ];
    const final = sampleTimeline(result.timeline!, result.timeline!.durationMs);
    expect(firstMessageBeforeReveal?.opacity).toBe(0);
    expect(final.targets['message:Worker->>API:GET /status#1']?.opacity).toBe(1);
    expect(final.targets['participant:API']?.highlight).toBe(0);
    expect(final.targets['participant:Worker']?.visible).toBe(false);
  });

  it('traces each edge in a semantic route and then removes the temporary trace', () => {
    const timeline = compile(`motionDiagram-v1
  trace A --> B --> C over 1s easing linear
`);
    expect(timeline.events[0]).toMatchObject({
      kind: 'trace',
      targetKeys: ['edge:A-->B#1', 'edge:B-->C#1'],
    });
    expect(sampleTimeline(timeline, 500).traces[0]).toMatchObject({
      id: timeline.events[0]?.id,
      progress: 0.5,
    });
    expect(sampleTimeline(timeline, 1_001).traces).toEqual([]);
  });
});
