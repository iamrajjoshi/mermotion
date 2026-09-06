import { mermaidPaletteKeys, normalizeHexColor, type MermaidDiagramPalette } from './appearance';

export const mermaidThemes = ['default', 'base', 'dark', 'forest', 'neutral'] as const;
export type MermaidTheme = (typeof mermaidThemes)[number];

interface FrontmatterParts {
  content: string;
  newline: '\n' | '\r\n';
  prefix: string;
  suffix: string;
}

interface ParsedKey {
  indent: string;
  key: string;
  rest: string;
}

const lineEnding = /\r?\n$/;

export function isMermaidTheme(value: string | undefined): value is MermaidTheme {
  return mermaidThemes.some((theme) => theme === value);
}

function splitFrontmatter(source: string): FrontmatterParts | undefined {
  const opening = /^(?:\u{feff})?---[ \t]*(\r\n|\n)/u.exec(source);
  if (!opening) return undefined;

  const contentStart = opening[0].length;
  const closing = /^---[ \t]*(?:\r\n|\n|$)/gm;
  closing.lastIndex = contentStart;
  const match = closing.exec(source);
  if (!match) return undefined;

  return {
    content: source.slice(contentStart, match.index),
    newline: opening[1] === '\r\n' ? '\r\n' : '\n',
    prefix: source.slice(0, contentStart),
    suffix: source.slice(match.index),
  };
}

function sourceNewline(source: string): '\n' | '\r\n' {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(content: string): string[] {
  return content.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
}

function withoutLineEnding(line: string): string {
  return line.replace(lineEnding, '');
}

function parseKey(line: string): ParsedKey | undefined {
  const match = /^([ \t]*)([A-Za-z][\w-]*)[ \t]*:([ \t]*)(.*)$/.exec(withoutLineEnding(line));
  if (!match) return undefined;
  return {
    indent: match[1] ?? '',
    key: match[2] ?? '',
    rest: match[4] ?? '',
  };
}

function isTrivia(line: string): boolean {
  const trimmed = withoutLineEnding(line).trim();
  return trimmed === '' || trimmed.startsWith('#');
}

function indentation(line: string): number {
  return /^([ \t]*)/.exec(withoutLineEnding(line))?.[1]?.length ?? 0;
}

function blockEnd(lines: string[], parentIndex: number): number {
  const parentIndent = parseKey(lines[parentIndex] ?? '')?.indent.length ?? -1;
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isTrivia(line) && indentation(line) <= parentIndent) return index;
  }
  return lines.length;
}

function childIndent(lines: string[], parentIndex: number): string | undefined {
  const parentIndent = parseKey(lines[parentIndex] ?? '')?.indent.length ?? -1;
  const end = blockEnd(lines, parentIndex);
  let result: string | undefined;

  for (let index = parentIndex + 1; index < end; index += 1) {
    const parsed = parseKey(lines[index] ?? '');
    if (!parsed || parsed.indent.length <= parentIndent) continue;
    if (!result || parsed.indent.length < result.length) result = parsed.indent;
  }

  return result;
}

function directKeyIndices(lines: string[], parentIndex: number, key: string): number[] {
  const indent = childIndent(lines, parentIndex);
  if (!indent) return [];
  const end = blockEnd(lines, parentIndex);
  const indices: number[] = [];

  for (let index = parentIndex + 1; index < end; index += 1) {
    const parsed = parseKey(lines[index] ?? '');
    if (parsed?.indent === indent && parsed.key === key) indices.push(index);
  }

  return indices;
}

function rootKeyIndex(lines: string[], key: string): number | undefined {
  const index = lines.findIndex((line) => {
    const parsed = parseKey(line);
    return parsed?.indent === '' && parsed.key === key;
  });
  return index === -1 ? undefined : index;
}

function ensurePreviousLineEnding(lines: string[], index: number, newline: string): void {
  if (index > 0 && !lineEnding.test(lines[index - 1] ?? '')) {
    lines[index - 1] = `${lines[index - 1]}${newline}`;
  }
}

function trailingTriviaStart(lines: string[]): number {
  let index = lines.length;
  while (index > 0 && withoutLineEnding(lines[index - 1] ?? '').trim() === '') index -= 1;
  return index;
}

function ensureConfig(lines: string[], newline: string): number {
  const existing = rootKeyIndex(lines, 'config');
  if (existing !== undefined) {
    if (scalarValue(lines[existing] ?? '', 'config') === '{}') {
      lines[existing] = replaceScalar(lines[existing] ?? '', 'config', '');
    }
    return existing;
  }

  const index = trailingTriviaStart(lines);
  ensurePreviousLineEnding(lines, index, newline);
  lines.splice(index, 0, `config:${newline}`);
  return index;
}

function scalarParts(
  rest: string,
  leadingHashIsValue: boolean,
): { quote?: string; suffix: string } {
  let quote: string | undefined;
  let activeQuote: string | undefined;
  let commentAt = -1;

  for (let index = 0; index < rest.length; index += 1) {
    const character = rest[index];
    if ((character === '"' || character === "'") && (index === 0 || rest[index - 1] !== '\\')) {
      if (!activeQuote) {
        activeQuote = character;
        if (rest.slice(0, index).trim() === '') quote = character;
      } else if (activeQuote === character) {
        activeQuote = undefined;
      }
      continue;
    }
    if (character !== '#' || activeQuote) continue;
    if (index === 0 && leadingHashIsValue && /^#[\da-f]{6}(?:\s|$)/i.test(rest)) continue;
    if (index === 0 || /\s/.test(rest[index - 1] ?? '')) {
      commentAt = index;
      break;
    }
  }

  let suffixStart = commentAt === -1 ? rest.length : commentAt;
  while (suffixStart > 0 && /[ \t]/.test(rest[suffixStart - 1] ?? '')) suffixStart -= 1;

  const suffix = rest.slice(suffixStart);
  return quote ? { quote, suffix } : { suffix };
}

function replaceScalar(
  line: string,
  key: string,
  value: string,
  options: { leadingHashIsValue?: boolean; quote?: boolean } = {},
): string {
  const ending = lineEnding.exec(line)?.[0] ?? '';
  const text = withoutLineEnding(line);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^([ \\t]*${escapedKey}[ \\t]*:[ \\t]*)(.*)$`).exec(text);
  if (!match) return line;

  const decoration = scalarParts(match[2] ?? '', options.leadingHashIsValue ?? false);
  const quote = options.quote ? (decoration.quote === "'" ? "'" : '"') : decoration.quote;
  const rendered = quote ? `${quote}${value}${quote}` : value;
  const commentGap = decoration.suffix.startsWith('#') && rendered ? ' ' : '';
  return `${match[1]}${rendered}${commentGap}${decoration.suffix}${ending}`;
}

function scalarValue(line: string, key: string, leadingHashIsValue = false): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^[ \\t]*${escapedKey}[ \\t]*:[ \\t]*(.*)$`).exec(
    withoutLineEnding(line),
  );
  if (!match) return undefined;

  const rest = match[1] ?? '';
  const { suffix } = scalarParts(rest, leadingHashIsValue);
  const value = rest.slice(0, rest.length - suffix.length).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function removeDuplicateScalarKeys(lines: string[], parentIndex: number, key: string): void {
  const indices = directKeyIndices(lines, parentIndex, key);
  for (let index = indices.length - 1; index >= 1; index -= 1) {
    lines.splice(indices[index]!, 1);
  }
}

function writeThemeLines(lines: string[], theme: MermaidTheme, newline: string): void {
  let configIndex = ensureConfig(lines, newline);
  removeDuplicateScalarKeys(lines, configIndex, 'theme');
  configIndex = rootKeyIndex(lines, 'config') ?? configIndex;
  const existing = directKeyIndices(lines, configIndex, 'theme')[0];

  if (existing !== undefined) {
    lines[existing] = replaceScalar(lines[existing] ?? '', 'theme', theme);
    return;
  }

  const indent =
    childIndent(lines, configIndex) ?? `${parseKey(lines[configIndex] ?? '')?.indent}  `;
  const variablesIndex = directKeyIndices(lines, configIndex, 'themeVariables')[0];
  const insertAt = variablesIndex ?? blockEnd(lines, configIndex);
  ensurePreviousLineEnding(lines, insertAt, newline);
  lines.splice(insertAt, 0, `${indent}theme: ${theme}${newline}`);
}

function themeVariablesIndex(lines: string[], configIndex: number): number | undefined {
  const indices = directKeyIndices(lines, configIndex, 'themeVariables');
  for (let index = indices.length - 1; index >= 1; index -= 1) {
    const duplicate = indices[index]!;
    lines.splice(duplicate, blockEnd(lines, duplicate) - duplicate);
  }
  return directKeyIndices(lines, configIndex, 'themeVariables')[0];
}

function ensureThemeVariables(lines: string[], newline: string): number {
  const configIndex = rootKeyIndex(lines, 'config') ?? ensureConfig(lines, newline);
  const existing = themeVariablesIndex(lines, configIndex);
  if (existing !== undefined) {
    if (scalarValue(lines[existing] ?? '', 'themeVariables') === '{}') {
      lines[existing] = replaceScalar(lines[existing] ?? '', 'themeVariables', '');
    }
    return existing;
  }

  const configChildIndent = childIndent(lines, configIndex) ?? '  ';
  const insertAt = blockEnd(lines, configIndex);
  ensurePreviousLineEnding(lines, insertAt, newline);
  lines.splice(insertAt, 0, `${configChildIndent}themeVariables:${newline}`);
  return insertAt;
}

function mutateFrontmatter(
  source: string,
  mutate: (lines: string[], newline: string) => void,
): string {
  const frontmatter = splitFrontmatter(source);
  const newline = frontmatter?.newline ?? sourceNewline(source);
  const lines = splitLines(frontmatter?.content ?? '');
  mutate(lines, newline);
  const content = lines.join('');

  if (frontmatter) return `${frontmatter.prefix}${content}${frontmatter.suffix}`;
  return `---${newline}${content}---${newline}${source}`;
}

function supportsBlockMappings(source: string, includeThemeVariables: boolean): boolean {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) return true;
  const lines = splitLines(frontmatter.content);
  const configIndex = rootKeyIndex(lines, 'config');
  if (configIndex === undefined) return true;
  const configValue = scalarValue(lines[configIndex] ?? '', 'config');
  if (configValue && configValue !== '{}') return false;
  if (!includeThemeVariables || configValue === '{}') return true;

  const variablesIndex = directKeyIndices(lines, configIndex, 'themeVariables')[0];
  if (variablesIndex === undefined) return true;
  const variablesValue = scalarValue(lines[variablesIndex] ?? '', 'themeVariables');
  return !variablesValue || variablesValue === '{}';
}

export function readMermaidTheme(source: string): MermaidTheme | 'source' {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) return 'source';
  const lines = splitLines(frontmatter.content);
  const configIndex = rootKeyIndex(lines, 'config');
  if (configIndex === undefined) return 'source';
  const themeIndex = directKeyIndices(lines, configIndex, 'theme')[0];
  if (themeIndex === undefined) return 'source';
  const value = scalarValue(lines[themeIndex] ?? '', 'theme');
  return isMermaidTheme(value) ? value : 'source';
}

export function writeMermaidTheme(source: string, theme: MermaidTheme): string {
  if (!supportsBlockMappings(source, false)) return source;
  return mutateFrontmatter(source, (lines, newline) => writeThemeLines(lines, theme, newline));
}

export function readMermaidPalette(source: string): Partial<MermaidDiagramPalette> {
  const frontmatter = splitFrontmatter(source);
  if (!frontmatter) return {};
  const lines = splitLines(frontmatter.content);
  const configIndex = rootKeyIndex(lines, 'config');
  if (configIndex === undefined) return {};
  const variablesIndex = directKeyIndices(lines, configIndex, 'themeVariables')[0];
  if (variablesIndex === undefined) return {};

  const palette: Partial<MermaidDiagramPalette> = {};
  for (const key of mermaidPaletteKeys) {
    const index = directKeyIndices(lines, variablesIndex, key)[0];
    if (index === undefined) continue;
    const color = normalizeHexColor(scalarValue(lines[index] ?? '', key, true));
    if (color) palette[key] = color;
  }
  return palette;
}

export function writeMermaidPalette(
  source: string,
  palette: Partial<MermaidDiagramPalette>,
): string {
  if (!supportsBlockMappings(source, true)) return source;
  const colors = mermaidPaletteKeys.flatMap((key) => {
    const color = normalizeHexColor(palette[key]);
    return color ? ([[key, color]] as const) : [];
  });

  return mutateFrontmatter(source, (lines, newline) => {
    writeThemeLines(lines, 'base', newline);
    let variablesIndex = ensureThemeVariables(lines, newline);

    for (const [key, color] of colors) {
      removeDuplicateScalarKeys(lines, variablesIndex, key);
      variablesIndex = ensureThemeVariables(lines, newline);
      const existing = directKeyIndices(lines, variablesIndex, key)[0];
      if (existing !== undefined) {
        lines[existing] = replaceScalar(lines[existing] ?? '', key, color, {
          leadingHashIsValue: true,
          quote: true,
        });
        continue;
      }

      const indent =
        childIndent(lines, variablesIndex) ?? `${parseKey(lines[variablesIndex] ?? '')?.indent}  `;
      const insertAt = blockEnd(lines, variablesIndex);
      ensurePreviousLineEnding(lines, insertAt, newline);
      lines.splice(insertAt, 0, `${indent}${key}: "${color}"${newline}`);
    }
  });
}
