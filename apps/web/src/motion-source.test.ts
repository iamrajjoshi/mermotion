import { describe, expect, it } from 'vitest';

import { readMotionDefaultColor, writeMotionDefaultColor } from './motion-source';

describe('motion palette source edits', () => {
  it('updates an existing defaults line without changing other statements', () => {
    const source = `motionDiagram-v1
  defaults duration 480ms easing ease-out color #112233
  marker request as "Request" shape dot
  at 0ms move request along A --> B over 1s
`;

    const changed = writeMotionDefaultColor(source, '#ff5470');

    expect(changed).toBe(`motionDiagram-v1
  defaults duration 480ms easing ease-out color #ff5470
  marker request as "Request" shape dot
  at 0ms move request along A --> B over 1s
`);
    expect(readMotionDefaultColor(changed)).toBe('#ff5470');
  });

  it('adds a defaults line after the declaration and is idempotent', () => {
    const source = 'motionDiagram-v1\n  pulse A for 500ms\n';
    const changed = writeMotionDefaultColor(source, '6687FF');

    expect(changed).toBe('motionDiagram-v1\n  defaults color #6687ff\n  pulse A for 500ms\n');
    expect(writeMotionDefaultColor(changed, '#6687ff')).toBe(changed);
  });

  it('updates every legacy defaults line so the effective value matches the control', () => {
    const source = `motionDiagram-v1
  defaults duration 300ms color #111111
  defaults easing linear
  pulse A
`;

    const changed = writeMotionDefaultColor(source, '#6687ff');

    expect(changed.match(/color #6687ff/g)).toHaveLength(2);
    expect(readMotionDefaultColor(changed)).toBe('#6687ff');
  });

  it('does not modify source for an invalid color', () => {
    const source = 'motionDiagram-v1\n  pulse A\n';
    expect(writeMotionDefaultColor(source, 'blue')).toBe(source);
  });
});
