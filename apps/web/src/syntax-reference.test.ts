import { describe, expect, it } from 'vitest';

import {
  compileMotionSource,
  formatMotion,
  validateMotionSyntax,
  type SemanticTarget,
} from '@mermotion/engine';

import {
  CANONICAL_MOTION_EXAMPLE,
  filterSyntaxEntries,
  insertMotionSnippet,
  resolveSyntaxEntries,
  SYNTAX_ENTRIES,
} from './syntax-reference';

describe('motion syntax reference', () => {
  it('filters by section, grammar, and explanatory text', () => {
    expect(filterSyntaxEntries('sequence').map(({ id }) => id)).toEqual([
      'implicit',
      'sequence-message-first',
      'sequence-message',
    ]);
    expect(filterSyntaxEntries('easing').map(({ id }) => id)).toEqual(['defaults']);
    expect(filterSyntaxEntries('source id').map(({ id }) => id)).toEqual(['highlight']);
    expect(filterSyntaxEntries('move marker').map(({ id }) => id)).toEqual(['marker', 'move']);
    expect(filterSyntaxEntries('not-a-language-feature')).toEqual([]);
  });

  it('keeps the complete example parseable and canonically formatted', () => {
    expect(validateMotionSyntax(CANONICAL_MOTION_EXAMPLE)).toEqual([]);
    expect(formatMotion(CANONICAL_MOTION_EXAMPLE)).toEqual({
      diagnostics: [],
      formatted: `${CANONICAL_MOTION_EXAMPLE}\n`,
    });
  });

  it.each(SYNTAX_ENTRIES.filter(({ insertable }) => insertable))(
    'keeps the $id insertion example parseable',
    ({ source }) => {
      expect(validateMotionSyntax(`motionDiagram-v1\n  ${source}\n`)).toEqual([]);
    },
  );

  it('only teaches canonical milestone-one forms', () => {
    const sources = [CANONICAL_MOTION_EXAMPLE, ...SYNTAX_ENTRIES.map(({ source }) => source)];

    for (const source of sources) {
      expect(source).not.toMatch(/\b(?:after|wait|unhighlight|reveal|hide|remove)\b/);
      expect(source).not.toMatch(/\bshape\s+dot\b|\bcolor\s+inherit\b|;/);
      expect(source).not.toMatch(/\b(?:highlight|pulse)\s+(?:node|edge|participant)\b/);
      expect(source).not.toMatch(/\b(?:highlight|pulse|trace|move)\b[^\n]*\b(?:easing|color)\b/);
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,4}(?![0-9a-fA-F])/);
    }
  });

  it('adapts insertions to the current semantic target inventory', () => {
    const targets: SemanticTarget[] = [
      { id: 'brief', key: 'node:brief', kind: 'node', order: 0 },
      { id: 'render', key: 'node:render', kind: 'node', order: 1 },
      {
        from: 'brief',
        id: 'brief-->render#1',
        key: 'edge:brief-->render#1',
        kind: 'edge',
        order: 2,
        to: 'render',
      },
    ];
    const entries = resolveSyntaxEntries(
      targets,
      'motionDiagram-v1\n  marker signal as "Signal"\n',
    );
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    expect(byId.get('highlight')?.insertSource).toBe('highlight brief');
    expect(byId.get('pulse')?.insertSource).toBe('pulse render for 600ms');
    expect(byId.get('trace')?.insertSource).toBe('trace brief --> render over 1.2s');
    expect(byId.get('move')?.insertSource).toBe(
      'marker request as "Request"\nmove request along brief --> render over 1.8s',
    );
    expect(byId.get('with')?.insertSource).toBe('highlight brief\nwith pulse render for 600ms');
    expect(byId.get('sequence-message')?.insertSource).toBeUndefined();

    for (const entry of entries) {
      if (!entry.insertSource) continue;
      const source = insertMotionSnippet(
        'motionDiagram-v1\n  marker signal as "Signal"\n',
        entry.insertSource,
      ).source;
      expect(compileMotionSource(source, { targets }).diagnostics).toEqual([]);
    }
  });

  it('adds a marker declaration when adapting move for a marker-free document', () => {
    const targets: SemanticTarget[] = [
      { id: 'A', key: 'node:A', kind: 'node', order: 0 },
      { id: 'B', key: 'node:B', kind: 'node', order: 1 },
      {
        from: 'A',
        id: 'A-->B#1',
        key: 'edge:A-->B#1',
        kind: 'edge',
        order: 2,
        to: 'B',
      },
    ];
    const move = resolveSyntaxEntries(targets, 'motionDiagram-v1\n').find(
      ({ id }) => id === 'move',
    );

    expect(move?.insertSource).toBe(
      'marker request as "Request"\nmove request along A --> B over 1.8s',
    );
    expect(
      compileMotionSource(
        insertMotionSnippet('motionDiagram-v1\n', move?.insertSource ?? '').source,
        { targets },
      ).diagnostics,
    ).toEqual([]);
  });

  it('allocates a new marker for every adapted move', () => {
    const targets: SemanticTarget[] = [
      { id: 'A', key: 'node:A', kind: 'node', order: 0 },
      { id: 'B', key: 'node:B', kind: 'node', order: 1 },
      {
        from: 'A',
        id: 'A-->B#1',
        key: 'edge:A-->B#1',
        kind: 'edge',
        order: 2,
        to: 'B',
      },
    ];
    const source = `motionDiagram-v1
  marker request as "Request"
  marker request2 as "Request 2"
  move request along A --> B over 1s
`;
    const firstMove = resolveSyntaxEntries(targets, source).find(({ id }) => id === 'move');

    expect(firstMove?.insertSource).toBe(
      'marker request3 as "Request 3"\nmove request3 along A --> B over 1.8s',
    );
    const firstInsertion = insertMotionSnippet(source, firstMove?.insertSource ?? '').source;
    expect(compileMotionSource(firstInsertion, { targets }).diagnostics).toEqual([]);

    const secondMove = resolveSyntaxEntries(targets, firstInsertion).find(
      ({ id }) => id === 'move',
    );
    expect(secondMove?.insertSource).toBe(
      'marker request4 as "Request 4"\nmove request4 along A --> B over 1.8s',
    );
    expect(
      compileMotionSource(
        insertMotionSnippet(firstInsertion, secondMove?.insertSource ?? '').source,
        { targets },
      ).diagnostics,
    ).toEqual([]);
  });

  it('does not offer an ambiguous route for insertion', () => {
    const targets: SemanticTarget[] = [
      { id: 'A', key: 'node:A', kind: 'node', order: 0 },
      { id: 'B', key: 'node:B', kind: 'node', order: 1 },
      {
        from: 'A',
        id: 'A-->B#1',
        key: 'edge:A-->B#1',
        kind: 'edge',
        occurrence: 1,
        order: 2,
        to: 'B',
      },
      {
        from: 'A',
        id: 'A-->B#2',
        key: 'edge:A-->B#2',
        kind: 'edge',
        occurrence: 2,
        order: 3,
        to: 'B',
      },
    ];
    const entries = resolveSyntaxEntries(targets, 'motionDiagram-v1\n');
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    expect(byId.get('highlight')?.insertSource).toBe('highlight A');
    expect(byId.get('trace')?.insertSource).toBeUndefined();
    expect(byId.get('move')?.insertSource).toBeUndefined();
  });

  it('adapts first and repeated sequence-message selectors independently', () => {
    const targets: SemanticTarget[] = [
      { id: 'Worker', key: 'participant:Worker', kind: 'participant', order: 0 },
      { id: 'API', key: 'participant:API', kind: 'participant', order: 1 },
      {
        arrow: '->>',
        from: 'Worker',
        id: 'Worker->>API:GET /status#1',
        key: 'message:Worker->>API:GET /status#1',
        kind: 'message',
        label: 'GET /status',
        occurrence: 1,
        order: 2,
        to: 'API',
      },
      {
        arrow: '->>',
        from: 'Worker',
        id: 'Worker->>API:GET /status#2',
        key: 'message:Worker->>API:GET /status#2',
        kind: 'message',
        label: 'GET /status',
        occurrence: 2,
        order: 3,
        to: 'API',
      },
    ];
    const entries = resolveSyntaxEntries(targets, 'motionDiagram-v1\n');
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    expect(byId.get('sequence-message-first')?.insertSource).toBe(
      'pulse message Worker->>API: "GET /status" occurrence 1 for 300ms',
    );
    expect(byId.get('sequence-message')?.insertSource).toBe(
      'pulse message Worker->>API: "GET /status" occurrence 2 for 300ms',
    );

    for (const entry of entries) {
      if (!entry.insertSource) continue;
      const source = insertMotionSnippet('motionDiagram-v1\n', entry.insertSource).source;
      expect(compileMotionSource(source, { targets }).diagnostics).toEqual([]);
    }
  });
});

describe('motion snippet insertion', () => {
  it('appends a statement on its own indented line', () => {
    const original = 'motionDiagram-v1\n  highlight client';
    const inserted = insertMotionSnippet(original, 'pulse api for 600ms');

    expect(inserted.source).toBe('motionDiagram-v1\n  highlight client\n  pulse api for 600ms');
    expect(inserted.cursor).toBe(inserted.source.length);

    expect(insertMotionSnippet(`${original}\n`, 'pulse api for 600ms').source).toBe(
      'motionDiagram-v1\n  highlight client\n  pulse api for 600ms\n',
    );
  });

  it('inserts after the current statement without splitting it', () => {
    const original = 'motionDiagram-v1\n  highlight client\n  trace api --> worker over 800ms';
    const cursor = original.indexOf('client') + 2;
    const inserted = insertMotionSnippet(original, 'pulse api for 600ms', {
      end: cursor,
      start: cursor,
    });

    expect(inserted.source).toBe(
      'motionDiagram-v1\n  highlight client\n  pulse api for 600ms\n  trace api --> worker over 800ms',
    );
    expect(validateMotionSyntax(inserted.source)).toEqual([]);
  });

  it('protects the declaration and restores it for an empty document', () => {
    expect(
      insertMotionSnippet('motionDiagram-v1\n  highlight client', 'pulse api for 600ms', {
        end: 0,
        start: 0,
      }).source,
    ).toBe('motionDiagram-v1\n  pulse api for 600ms\n  highlight client');

    expect(insertMotionSnippet('', 'highlight client').source).toBe(
      'motionDiagram-v1\n  highlight client',
    );
  });

  it('protects a declaration after leading comments and blank lines', () => {
    const source = '\n%% author note\n\nmotionDiagram-v1\n  highlight client\n';

    expect(insertMotionSnippet(source, 'pulse api for 600ms', { end: 0, start: 0 }).source).toBe(
      '\n%% author note\n\nmotionDiagram-v1\n  pulse api for 600ms\n  highlight client\n',
    );
  });

  it('keeps defaults and marker declarations ahead of an inserted move', () => {
    const source = `motionDiagram-v1
  defaults duration 400ms easing ease-out
  marker request as "Request"

  highlight A
`;
    const cursor = source.indexOf('duration') + 3;
    const inserted = insertMotionSnippet(source, 'move request along A --> B over 1s', {
      end: cursor,
      start: cursor,
    });
    const targets: SemanticTarget[] = [
      { id: 'A', key: 'node:A', kind: 'node', order: 0 },
      { id: 'B', key: 'node:B', kind: 'node', order: 1 },
      {
        from: 'A',
        id: 'A-->B#1',
        key: 'edge:A-->B#1',
        kind: 'edge',
        order: 2,
        to: 'B',
      },
    ];

    expect(inserted.source.indexOf('marker request')).toBeLessThan(
      inserted.source.indexOf('move request'),
    );
    expect(inserted.source).toBe(`motionDiagram-v1
  defaults duration 400ms easing ease-out
  marker request as "Request"
  move request along A --> B over 1s

  highlight A
`);
    expect(compileMotionSource(inserted.source, { targets }).diagnostics).toEqual([]);
  });

  it('indents multiline snippets and preserves a terminal newline', () => {
    expect(
      insertMotionSnippet('motionDiagram-v1\n', 'highlight client\nwith pulse api for 300ms')
        .source,
    ).toBe('motionDiagram-v1\n  highlight client\n  with pulse api for 300ms\n');
  });
});
