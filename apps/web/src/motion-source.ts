import { parseMotion } from '@mermotion/engine';

import { normalizeHexColor, type HexColor } from './appearance';

const defaultsLine = /^(\s*defaults\b)([^\n\r]*?)(;?)(\r?)$/gm;
const colorModifier = /\s+color\s+(?:inherit|#[\da-fA-F]{3,8})\b/g;
const declarationLine = /^(\s*motionDiagram-v1\s*;?)(\r?)$/m;

export function readMotionDefaultColor(source: string): HexColor | undefined {
  const color = parseMotion(source).document?.defaults.color;
  return color ? normalizeHexColor(color) : undefined;
}

export function writeMotionDefaultColor(source: string, requestedColor: string): string {
  const color = normalizeHexColor(requestedColor);
  if (!color) return source;

  if (source.search(defaultsLine) !== -1) {
    return source.replace(defaultsLine, (_line, prefix, modifiers, semicolon, carriageReturn) => {
      const nextModifiers = String(modifiers).replace(colorModifier, '').trimEnd();
      return `${prefix}${nextModifiers} color ${color}${semicolon}${carriageReturn}`;
    });
  }

  return source.replace(
    declarationLine,
    (_line, declaration, carriageReturn) =>
      `${declaration}${carriageReturn}\n  defaults color ${color}`,
  );
}
