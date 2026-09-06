import { Command, CommanderError } from 'commander';
import path from 'node:path';
import type {
  CompiledTimeline,
  CompileResult,
  Diagnostic,
  FrameState,
  MotionFormatResult,
  MotionParseResult,
  MotionStatement,
} from '@mermotion/engine';
import { parseDuration, DurationInputError } from './duration.js';
import {
  atomicWriteTextFile,
  FileInputError,
  readDiagramFiles,
  readTextFile,
  requireExtension,
  siblingMotionPath,
} from './files.js';
import {
  attachFile,
  formatDiagnostic,
  hasErrors,
  jsonEnvelope,
  writeDiagnostics,
  writeJson,
  type CliCommand,
  type CliDiagnostic,
  type OutputWriter,
} from './output.js';

export interface CliEngine {
  validateMermaid: (source: string) => Promise<Diagnostic[]>;
  validateMotion: (source: string) => Diagnostic[];
  parseMotion: (source: string) => MotionParseResult;
  formatMotion: (source: string) => MotionFormatResult;
  compileMotion: (document: { mermaidSource: string; motionSource?: string }) => CompileResult;
  sampleTimeline: (timeline: CompiledTimeline, timeMs: number) => FrameState;
}

export interface CliDependencies {
  engine: CliEngine;
  output: OutputWriter;
}

interface CommandOutcome {
  exitCode: number;
}

interface JsonOption {
  json?: boolean;
}

type TargetResolution = 'not-needed' | 'inferred';

const TARGETS_NOT_VERIFIED_CODE = 'CLI_TARGETS_NOT_VERIFIED';

function statementUsesRenderedTargets(statement: MotionStatement): boolean {
  return (
    statement.kind === 'move' ||
    (statement.kind === 'effect' && statement.selector.kind !== 'diagram')
  );
}

function targetResolution(motionSource: string | undefined, engine: CliEngine): TargetResolution {
  if (motionSource === undefined) return 'not-needed';
  const document = engine.parseMotion(motionSource).document;
  return document?.statements.some(statementUsesRenderedTargets) === true
    ? 'inferred'
    : 'not-needed';
}

function targetResolutionDiagnostics(
  resolution: TargetResolution,
  motionPath: string,
): CliDiagnostic[] {
  if (resolution === 'not-needed') return [];
  return [
    {
      code: TARGETS_NOT_VERIFIED_CODE,
      severity: 'warning',
      message:
        'Motion targets are inferred; rendered target existence and ambiguity were not checked.',
      file: motionPath,
    },
  ];
}

export async function runCli(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  let outcome: CommandOutcome = { exitCode: 0 };
  const jsonRequested = arguments_.includes('--json');
  const requestedCommand = inferCommand(arguments_);
  const program = createProgram(
    dependencies,
    (nextOutcome) => {
      outcome = nextOutcome;
    },
    jsonRequested,
  );

  try {
    await program.parseAsync([...arguments_], { from: 'user' });
    return outcome.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return 0;
      }
      if (jsonRequested) {
        writeJson(
          dependencies.output,
          jsonEnvelope('cli', false, null, [
            cliDiagnostic('CLI_USAGE', cleanCommanderMessage(error.message)),
          ]),
        );
      }
      return 2;
    }

    const failure = toFailure(error, requestedCommand);
    if (jsonRequested) {
      writeJson(
        dependencies.output,
        jsonEnvelope(failure.command, false, null, [failure.diagnostic]),
      );
    } else {
      dependencies.output.stderr(`${formatDiagnostic(failure.diagnostic)}\n`);
    }
    return failure.exitCode;
  }
}

function createProgram(
  dependencies: CliDependencies,
  setOutcome: (outcome: CommandOutcome) => void,
  jsonRequested: boolean,
): Command {
  const program = new Command();
  program
    .name('mermotion')
    .description('Validate, compile, format, and sample Mermaid motion documents.')
    .version('0.0.0')
    .option('--json', 'write a stable machine-readable JSON envelope')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (message) => dependencies.output.stdout(message),
      writeErr: (message) => {
        if (!jsonRequested) {
          dependencies.output.stderr(message);
        }
      },
      outputError: (message, write) => write(message),
    });

  program
    .command('validate')
    .description('validate a Mermaid diagram and its optional sibling motion file')
    .argument('<diagram.mmd>', 'Mermaid source file')
    .action(async (diagramPath: string, _options: object, command: Command) => {
      setOutcome(await runValidate(diagramPath, wantsJson(command), dependencies));
    });

  const motion = program.command('motion').description('work with motion source files');

  motion
    .command('check')
    .description('validate a motion file or the sibling motion file for a Mermaid diagram')
    .argument('<file.motion|diagram.mmd>', 'motion file or Mermaid source file')
    .action(async (inputPath: string, _options: object, command: Command) => {
      setOutcome(await runMotionCheck(inputPath, wantsJson(command), dependencies));
    });

  motion
    .command('fmt')
    .description('format a motion source file')
    .argument('<file.motion>', 'motion source file')
    .option('--check', 'check formatting without writing')
    .action(async (motionPath: string, options: { check?: boolean }, command: Command) => {
      setOutcome(
        await runMotionFormat(motionPath, options.check === true, wantsJson(command), dependencies),
      );
    });

  motion
    .command('compile')
    .description('compile a Mermaid diagram and its sibling motion file')
    .argument('<diagram.mmd>', 'Mermaid source file')
    .action(async (diagramPath: string, _options: object, command: Command) => {
      setOutcome(await runMotionCompile(diagramPath, wantsJson(command), dependencies));
    });

  program
    .command('sample')
    .description('sample a compiled motion document at an exact timestamp')
    .argument('<diagram.mmd>', 'Mermaid source file')
    .requiredOption('--time <duration>', 'timestamp such as 250ms or 1.5s')
    .action(async (diagramPath: string, options: { time: string }, command: Command) => {
      setOutcome(await runSample(diagramPath, options.time, wantsJson(command), dependencies));
    });

  return program;
}

async function runValidate(
  inputPath: string,
  json: boolean,
  dependencies: CliDependencies,
): Promise<CommandOutcome> {
  const files = await readDiagramFiles(inputPath);
  const mermaidDiagnostics = attachFile(
    await dependencies.engine.validateMermaid(files.mermaidSource),
    files.diagramPath,
  );
  const motionDiagnostics =
    files.motionSource === undefined
      ? []
      : attachFile(dependencies.engine.validateMotion(files.motionSource), files.motionPath);
  const resolution = targetResolution(files.motionSource, dependencies.engine);
  const diagnostics = [
    ...mermaidDiagnostics,
    ...motionDiagnostics,
    ...targetResolutionDiagnostics(resolution, files.motionPath),
  ];
  const ok = !hasErrors(diagnostics);
  const data = {
    diagramPath: files.diagramPath,
    motionPath: files.motionSource === undefined ? null : files.motionPath,
    targetResolution: resolution,
  };

  if (json) {
    writeJson(dependencies.output, jsonEnvelope('validate', ok, data, diagnostics));
  } else {
    writeDiagnostics(dependencies.output, diagnostics);
    if (ok) {
      dependencies.output.stdout(`Valid: ${files.diagramPath}\n`);
      dependencies.output.stdout(
        files.motionSource === undefined
          ? `Motion: none (${files.motionPath})\n`
          : `Motion: ${files.motionPath}\n`,
      );
    }
  }

  return { exitCode: ok ? 0 : 1 };
}

async function runMotionCheck(
  inputPath: string,
  json: boolean,
  dependencies: CliDependencies,
): Promise<CommandOutcome> {
  const resolvedInput = path.resolve(inputPath);
  const extension = path.extname(resolvedInput).toLowerCase();
  let motionPath: string;
  let motionSource: string | undefined;

  if (extension === '.mmd') {
    const diagramPath = requireExtension(resolvedInput, '.mmd');
    await readTextFile(diagramPath);
    motionPath = siblingMotionPath(diagramPath);
    try {
      motionSource = await readTextFile(motionPath);
    } catch (error) {
      if (error instanceof FileInputError && error.code === 'CLI_FILE_NOT_FOUND') {
        motionSource = undefined;
      } else {
        throw error;
      }
    }
  } else if (extension === '.motion') {
    motionPath = requireExtension(resolvedInput, '.motion');
    motionSource = await readTextFile(motionPath);
  } else {
    throw new FileInputError(
      'CLI_INVALID_EXTENSION',
      `Expected a .motion or .mmd file, received ${inputPath}`,
      resolvedInput,
    );
  }

  const diagnostics =
    motionSource === undefined
      ? []
      : attachFile(dependencies.engine.validateMotion(motionSource), motionPath);
  const ok = !hasErrors(diagnostics);
  const data = { motionPath: motionSource === undefined ? null : motionPath };

  if (json) {
    writeJson(dependencies.output, jsonEnvelope('motion.check', ok, data, diagnostics));
  } else {
    writeDiagnostics(dependencies.output, diagnostics);
    if (ok) {
      dependencies.output.stdout(
        motionSource === undefined
          ? `No motion file found; the diagram has no cues (${motionPath})\n`
          : `Motion is valid: ${motionPath}\n`,
      );
    }
  }

  return { exitCode: ok ? 0 : 1 };
}

async function runMotionFormat(
  inputPath: string,
  checkOnly: boolean,
  json: boolean,
  dependencies: CliDependencies,
): Promise<CommandOutcome> {
  const motionPath = requireExtension(inputPath, '.motion');
  const source = await readTextFile(motionPath);
  const result = dependencies.engine.formatMotion(source);
  const formatDiagnostics = attachFile(result.diagnostics, motionPath);
  const valid = !hasErrors(formatDiagnostics);
  const changed = valid && result.formatted !== source;
  const checkDiagnostics =
    checkOnly && changed
      ? [
          cliDiagnostic(
            'CLI_FORMAT_REQUIRED',
            'Motion source does not match the canonical format.',
            motionPath,
          ),
        ]
      : [];
  const diagnostics = [...formatDiagnostics, ...checkDiagnostics];
  const ok = !hasErrors(diagnostics);

  if (valid && changed && !checkOnly) {
    await atomicWriteTextFile(motionPath, result.formatted);
  }

  const data = {
    motionPath,
    changed,
    checkOnly,
    written: valid && changed && !checkOnly,
  };
  if (json) {
    writeJson(dependencies.output, jsonEnvelope('motion.fmt', ok, data, diagnostics));
  } else {
    writeDiagnostics(dependencies.output, diagnostics);
    if (valid) {
      if (changed && !checkOnly) {
        dependencies.output.stdout(`Formatted: ${motionPath}\n`);
      } else if (!changed) {
        dependencies.output.stdout(`Already formatted: ${motionPath}\n`);
      }
    }
  }

  return { exitCode: ok ? 0 : 1 };
}

async function runMotionCompile(
  inputPath: string,
  json: boolean,
  dependencies: CliDependencies,
): Promise<CommandOutcome> {
  const files = await readDiagramFiles(inputPath);
  const result = dependencies.engine.compileMotion(toDiagramDocument(files));
  const resolution = targetResolution(files.motionSource, dependencies.engine);
  const diagnostics = [
    ...attachFile(
      await dependencies.engine.validateMermaid(files.mermaidSource),
      files.diagramPath,
    ),
    ...attachFile(result.diagnostics, files.motionPath),
    ...targetResolutionDiagnostics(resolution, files.motionPath),
  ];
  const ok = !hasErrors(diagnostics) && result.timeline !== undefined;
  const data = {
    diagramPath: files.diagramPath,
    motionPath: files.motionSource === undefined ? null : files.motionPath,
    targetResolution: resolution,
    timeline: result.timeline ?? null,
  };

  if (json) {
    writeJson(dependencies.output, jsonEnvelope('motion.compile', ok, data, diagnostics));
  } else {
    writeDiagnostics(dependencies.output, diagnostics);
    if (ok) {
      dependencies.output.stdout(`Compiled: ${files.diagramPath}\n`);
      dependencies.output.stdout(`${JSON.stringify(result.timeline, null, 2)}\n`);
    }
  }

  return { exitCode: ok ? 0 : 1 };
}

async function runSample(
  inputPath: string,
  time: string,
  json: boolean,
  dependencies: CliDependencies,
): Promise<CommandOutcome> {
  const timeMs = parseDuration(time);
  const files = await readDiagramFiles(inputPath);
  const result = dependencies.engine.compileMotion(toDiagramDocument(files));
  const resolution = targetResolution(files.motionSource, dependencies.engine);
  const diagnostics = [
    ...attachFile(
      await dependencies.engine.validateMermaid(files.mermaidSource),
      files.diagramPath,
    ),
    ...attachFile(result.diagnostics, files.motionPath),
    ...targetResolutionDiagnostics(resolution, files.motionPath),
  ];
  const timeline = result.timeline;
  const canSample = !hasErrors(diagnostics) && timeline !== undefined;
  const frame =
    !hasErrors(diagnostics) && timeline !== undefined
      ? dependencies.engine.sampleTimeline(timeline, timeMs)
      : null;
  const data = {
    diagramPath: files.diagramPath,
    motionPath: files.motionSource === undefined ? null : files.motionPath,
    targetResolution: resolution,
    timeMs,
    frame,
  };

  if (json) {
    writeJson(dependencies.output, jsonEnvelope('sample', canSample, data, diagnostics));
  } else {
    writeDiagnostics(dependencies.output, diagnostics);
    if (canSample) {
      dependencies.output.stdout(`Sample at ${timeMs}ms: ${files.diagramPath}\n`);
      dependencies.output.stdout(`${JSON.stringify(frame, null, 2)}\n`);
    }
  }

  return { exitCode: canSample ? 0 : 1 };
}

function toDiagramDocument(files: { mermaidSource: string; motionSource?: string }): {
  mermaidSource: string;
  motionSource?: string;
} {
  return {
    mermaidSource: files.mermaidSource,
    ...(files.motionSource === undefined ? {} : { motionSource: files.motionSource }),
  };
}

function wantsJson(command: Command): boolean {
  return command.optsWithGlobals<JsonOption>().json === true;
}

function toFailure(
  error: unknown,
  command: CliCommand,
): {
  command: CliCommand;
  diagnostic: CliDiagnostic;
  exitCode: number;
} {
  if (error instanceof FileInputError) {
    return {
      command,
      diagnostic: cliDiagnostic(error.code, error.message, error.filePath),
      exitCode: 2,
    };
  }
  if (error instanceof DurationInputError) {
    return {
      command: 'sample',
      diagnostic: cliDiagnostic(error.code, error.message),
      exitCode: 2,
    };
  }

  return {
    command,
    diagnostic: cliDiagnostic(
      'CLI_INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unexpected CLI failure',
    ),
    exitCode: 3,
  };
}

function inferCommand(arguments_: readonly string[]): CliCommand {
  const commands = arguments_.filter((argument) => !argument.startsWith('-'));
  if (commands[0] === 'validate') {
    return 'validate';
  }
  if (commands[0] === 'sample') {
    return 'sample';
  }
  if (commands[0] === 'motion') {
    if (commands[1] === 'check') {
      return 'motion.check';
    }
    if (commands[1] === 'fmt') {
      return 'motion.fmt';
    }
    if (commands[1] === 'compile') {
      return 'motion.compile';
    }
  }
  return 'cli';
}

function cliDiagnostic(code: string, message: string, file?: string): CliDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    ...(file === undefined ? {} : { file }),
  };
}

function cleanCommanderMessage(message: string): string {
  return message.replace(/^error:\s*/i, '').trim();
}
