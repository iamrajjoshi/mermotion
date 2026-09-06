import { compileMotion } from './compiler.js';
import { parseMotion } from './language.js';
import type { CompileOptions, Diagnostic } from './types.js';

export function validateMotion(source: string, options: CompileOptions = {}): Diagnostic[] {
  const parsed = parseMotion(source);
  if (!parsed.document || parsed.diagnostics.some((item) => item.severity === 'error')) {
    return parsed.diagnostics;
  }
  const compiled = compileMotion(parsed.document, options);
  return [...parsed.diagnostics, ...compiled.diagnostics];
}
