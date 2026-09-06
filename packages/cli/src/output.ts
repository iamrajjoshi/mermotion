import type { Diagnostic, SourceSpan } from '@mermotion/engine';

export type CliCommand =
  | 'setup'
  | 'validate'
  | 'render'
  | 'motion.check'
  | 'motion.fmt'
  | 'motion.compile'
  | 'sample'
  | 'cli';

export interface CliDiagnostic extends Omit<Diagnostic, 'span'> {
  span?: SourceSpan;
  file?: string;
}

export interface JsonEnvelope<Data> {
  schemaVersion: 1;
  command: CliCommand;
  ok: boolean;
  data: Data;
  diagnostics: CliDiagnostic[];
}

export interface OutputWriter {
  stdout(message: string): void;
  stderr(message: string): void;
}

export function jsonEnvelope<Data>(
  command: CliCommand,
  ok: boolean,
  data: Data,
  diagnostics: CliDiagnostic[],
): JsonEnvelope<Data> {
  return {
    schemaVersion: 1,
    command,
    ok,
    data,
    diagnostics,
  };
}

export function writeJson<Data>(output: OutputWriter, envelope: JsonEnvelope<Data>): void {
  output.stdout(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function attachFile(diagnostics: readonly Diagnostic[], file: string): CliDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    file,
    ...(diagnostic.span === undefined ? {} : { span: diagnostic.span }),
  }));
}

export function hasErrors(diagnostics: readonly Pick<Diagnostic, 'severity'>[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

export function formatDiagnostic(diagnostic: CliDiagnostic): string {
  const location = diagnostic.span ? `:${diagnostic.span.line}:${diagnostic.span.column}` : '';
  const file = diagnostic.file ?? '<input>';
  return `${file}${location} ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

export function writeDiagnostics(
  output: OutputWriter,
  diagnostics: readonly CliDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    const message = `${formatDiagnostic(diagnostic)}\n`;
    if (diagnostic.severity === 'error') {
      output.stderr(message);
    } else {
      output.stdout(message);
    }
  }
}
