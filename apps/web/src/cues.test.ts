import type { SemanticTarget } from '@mermotion/engine';
import { describe, expect, it } from 'vitest';

import { inferDuration, summarizeCues } from './cues';

describe('cue summaries', () => {
  it('uses the compiled timing and labels for the visual ruler', () => {
    const cues = summarizeCues(`motionDiagram-v1
  marker request as "Request" shape dot
  at 0ms highlight brief
  at 450ms move request along brief --> render over 1.6s
  at 2.4s pulse render for 500ms`);

    expect(cues).toMatchObject([
      { type: 'highlight', startMs: 0, durationMs: 400, label: 'brief', line: 3 },
      {
        type: 'move',
        startMs: 450,
        durationMs: 1_600,
        label: 'request · brief → render',
        line: 4,
      },
      { type: 'pulse', startMs: 2_400, durationMs: 500, label: 'render', line: 5 },
    ]);
  });

  it('includes implicit, with, after, visibility, route, and marker events', () => {
    const cues = summarizeCues(`motionDiagram-v1
  defaults duration 100ms easing linear
  marker request as "Request" shape dot
  intro: highlight A
  with pulse B for 50ms
  after intro hide A
  unhighlight A
  reveal B
  trace A --> B over 300ms
  move request along A --> B over 200ms
  remove request`);

    expect(cues.map(({ type }) => type)).toEqual([
      'highlight',
      'pulse',
      'hide',
      'unhighlight',
      'reveal',
      'trace',
      'move',
      'removeMarker',
    ]);
    expect(cues.map(({ startMs }) => startMs)).toEqual([0, 0, 100, 200, 300, 400, 700, 900]);
    expect(cues.at(-1)).toMatchObject({ durationMs: 0, label: 'request', line: 11 });
  });

  it('shows one compiled block per staggered message when targets are available', () => {
    const targets: SemanticTarget[] = [1, 2].map((occurrence) => ({
      arrow: '->>',
      from: 'Worker',
      id: `message-${occurrence}`,
      key: `message:Worker->>API:Ready#${occurrence}`,
      kind: 'message',
      label: 'Ready',
      occurrence,
      order: occurrence,
      to: 'API',
    }));
    const cues = summarizeCues(
      'motionDiagram-v1\n  defaults duration 100ms\n  reveal messages every 200ms',
      targets,
    );

    expect(cues).toMatchObject([
      { id: 'cue-2-1', type: 'reveal', startMs: 0, label: 'Worker->>API:Ready#1' },
      { id: 'cue-2-2', type: 'reveal', startMs: 200, label: 'Worker->>API:Ready#2' },
    ]);
  });

  it('keeps valid compiled events visible when another statement is invalid', () => {
    const cues = summarizeCues(`motionDiagram-v1
  pulse A for nope
  highlight B`);

    expect(cues).toMatchObject([{ type: 'highlight', label: 'B', line: 3 }]);
  });

  it('extends the visible ruler to contain every cue', () => {
    const cues = summarizeCues('motionDiagram-v1\n  at 4s pulse A for 1s');
    expect(inferDuration(cues, 4_800)).toBe(5_200);
  });
});
