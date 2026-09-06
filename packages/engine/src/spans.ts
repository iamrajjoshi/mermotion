import type { SourceSpan } from './types.js';

export function sourceSpan(source: string, start: number, end: number): SourceSpan {
  const startPrefix = source.slice(0, start);
  const endPrefix = source.slice(0, end);
  const line = startPrefix.split('\n').length;
  const endLine = endPrefix.split('\n').length;
  const lastStartNewline = startPrefix.lastIndexOf('\n');
  const lastEndNewline = endPrefix.lastIndexOf('\n');

  return {
    start,
    end,
    line,
    column: start - lastStartNewline,
    endLine,
    endColumn: end - lastEndNewline,
  };
}

export function wholeSourceSpan(source: string): SourceSpan {
  return sourceSpan(source, 0, source.length);
}
