import { Command, CommanderError } from 'commander';
import path from 'node:path';
import type { DiagramDocument } from '@mermotion/engine';
import { parseDuration, DurationInputError } from './duration.js';
import { gifRepeatCount, MAX_GIF_HOLD_MS } from './gif.js';
import {
  atomicWriteFile,
  atomicWriteTextFile,
  FileInputError,
  readDiagramFiles,
  readTextFile,
  requireExtension,
  siblingMotionPath,
  type DiagramFiles,
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
import {
  RenderRuntimeError,
  type prepareRenderer,
  type renderDiagram,
  type RenderFormat,
  type RenderRequest,
} from './render.js';

export type CliEngine = Pick<
  typeof import('@mermotion/engine'),
  | 'compileMotion'
  | 'formatMotion'
  | 'parseMotion'
  | 'sampleTimeline'
  | 'validateMermaid'
  | 'validateMotion'
>;

export interface CliDependencies {
  engine: CliEngine;
  prepareRenderer: typeof prepareRenderer;
  render: typeof renderDiagram;
  output: OutputWriter;
}

interface CommandOutcome {
  exitCode: number;
}

interface JsonOption {
  json?: boolean;
}

interface RenderCommandOptions {
  at?: string;
  check?: boolean;
  hold?: string;
  loop?: string;
  output?: string;
}

const CLI_VERSION = '0.1.0';

class CliInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CliInputError';
    this.code = code;
  }
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
    .description('Render, validate, compile, format, and sample Mermaid motion documents.')
    .version(CLI_VERSION)
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
    .command('setup')
    .description('prepare local rendering')
    .action(async function (this: Command) {
      setOutcome(await runSetup(wantsJson(this), dependencies));
    });

  program
    .command('render')
    .description('render an SVG, PNG, or animated GIF from a Mermaid diagram')
    .argument('<diagram.mmd>', 'Mermaid source file')
    .option('-o, --output <path>', 'output .svg, .png, or .gif path')
    .option('--at <duration>', 'SVG or PNG timestamp such as 250ms or 1.5s')
    .option('--loop <mode>', 'GIF loop: forever, once, or a total play count')
    .option('--hold <duration>', 'GIF pause on the final frame between loops')
    .option('--check', 'render and validate without writing an output file')
    .action(async (diagramPath: string, options: RenderCommandOptions, command: Command) => {
      setOutcome(await runRender(diagramPath, options, wantsJson(command), dependencies));
    });

  program
    .command('validate')
    .description('validate a Mermaid diagram and its optional sibling motion file')
    .argument('<diagram.mmd>', 'Mermaid source file')
    .action(async function (this: Command, diagramPath: string) {
      setOutcome(await runValidate(diagramPath, wantsJson(this), dependencies));
    });

  const motion = program.command('motion').description('work with motion source files');

  motion
    .command('check')
    .description('validate a motion file or the sibling motion file for a Mermaid diagram')
    .argument('<file.motion|diagram.mmd>', 'motion file or Mermaid source file')
    .action(async function (this: Command, inputPath: string) {
      setOutcome(await runMotionCheck(inputPath, wantsJson(this), dependencies));
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
    .action(async function (this: Command, diagramPath: string) {
      setOutcome(await runMotionCompile(diagramPath, wantsJson(this), dependencies));
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

async function runSetup(json: boolean, dependencies: CliDependencies): Promise<CommandOutcome> {
  if (!json) dependencies.output.stdout('Preparing Mermotion rendering...\n');
  await dependencies.prepareRenderer();

  const data = { ready: true };
  if (json) writeJson(dependencies.output, jsonEnvelope('setup', true, data, []));
  else dependencies.output.stdout('Mermotion rendering is ready.\n');
  return { exitCode: 0 };
}

function outputForDiagram(
  diagramPath: string,
  requestedOutput: string | undefined,
): {
  format: RenderFormat;
  outputPath: string;
} {
  const outputPath = path.resolve(
    requestedOutput ?? `${diagramPath.slice(0, -path.extname(diagramPath).length)}.svg`,
  );
  const extension = path.extname(outputPath).toLowerCase();
  if (extension !== '.svg' && extension !== '.png' && extension !== '.gif') {
    throw new FileInputError(
      'CLI_INVALID_OUTPUT_FORMAT',
      `Expected an .svg, .png, or .gif output path, received ${outputPath}`,
      outputPath,
    );
  }
  const format: RenderFormat = extension === '.gif' ? 'gif' : extension === '.png' ? 'png' : 'svg';
  return { format, outputPath };
}

async function runRender(
  inputPath: string,
  options: RenderCommandOptions,
  json: boolean,
  dependencies: CliDependencies,
): Promise<CommandOutcome> {
  const files = await readDiagramFiles(inputPath);
  const output = outputForDiagram(files.diagramPath, options.output);
  const source = {
    mermaidSource: files.mermaidSource,
    ...(files.motionSource === undefined ? {} : { motionSource: files.motionSource }),
  };
  let request: RenderRequest;
  let timeMs: number | null;
  if (output.format === 'gif') {
    if (options.at !== undefined) {
      throw new CliInputError(
        'CLI_GIF_AT_UNSUPPORTED',
        'GIF export uses the full motion timeline; remove --at or choose an .svg or .png output.',
      );
    }
    let repeat: number;
    try {
      repeat = gifRepeatCount(options.loop ?? 'forever');
    } catch (error) {
      throw new CliInputError(
        'CLI_INVALID_GIF_LOOP',
        error instanceof Error ? error.message : String(error),
      );
    }
    const requestedEndPauseMs = parseDuration(options.hold ?? '500ms');
    if (requestedEndPauseMs > MAX_GIF_HOLD_MS) {
      throw new CliInputError(
        'CLI_INVALID_GIF_HOLD',
        `GIF hold must not exceed ${MAX_GIF_HOLD_MS}ms.`,
      );
    }
    request = {
      ...source,
      endPauseMs: repeat === -1 ? 0 : requestedEndPauseMs,
      format: 'gif',
      repeat,
    };
    timeMs = null;
  } else {
    if (options.loop !== undefined || options.hold !== undefined) {
      throw new CliInputError(
        'CLI_GIF_OPTION_REQUIRES_GIF',
        '--loop and --hold require a .gif output path.',
      );
    }
    timeMs = parseDuration(options.at ?? '0ms');
    request = { ...source, format: output.format, timeMs };
  }
  const isGif = request.format === 'gif';
  const mermaidDiagnostics = attachFile(
    await dependencies.engine.validateMermaid(files.mermaidSource),
    files.diagramPath,
  );

  if (hasErrors(mermaidDiagnostics)) {
    const data = {
      diagramPath: files.diagramPath,
      motionPath: files.motionSource === undefined ? null : files.motionPath,
      outputPath: null,
      format: output.format,
      timeMs,
      durationMs: null,
      diagramType: null,
      targetCount: null,
      written: false,
    };
    if (json)
      writeJson(dependencies.output, jsonEnvelope('render', false, data, mermaidDiagnostics));
    else writeDiagnostics(dependencies.output, mermaidDiagnostics);
    return { exitCode: 1 };
  }

  const rendered = await dependencies.render(request);
  const motionDiagnostics = attachFile(rendered.diagnostics, files.motionPath);
  const diagnostics = [...mermaidDiagnostics, ...motionDiagnostics];
  const ok = !hasErrors(diagnostics);
  if (ok && isGif && !rendered.animation) {
    throw new RenderRuntimeError(
      'CLI_RENDER_FAILED',
      'Mermotion could not render this diagram. Check the Mermaid and motion source, then retry.',
      3,
    );
  }
  const written = ok && options.check !== true;
  if (written) await atomicWriteFile(output.outputPath, rendered.bytes);

  const data = {
    diagramPath: files.diagramPath,
    motionPath: files.motionSource === undefined ? null : files.motionPath,
    outputPath: written ? output.outputPath : null,
    format: output.format,
    timeMs,
    durationMs: rendered.durationMs,
    diagramType: rendered.diagramType,
    targetCount: rendered.targetCount,
    frameCount: rendered.animation?.frameCount ?? null,
    height: rendered.animation?.height ?? null,
    playbackMs: rendered.animation?.playbackMs ?? null,
    width: rendered.animation?.width ?? null,
    written,
  };
  if (json) {
    writeJson(dependencies.output, jsonEnvelope('render', ok, data, diagnostics));
  } else {
    writeDiagnostics(dependencies.output, diagnostics);
    if (ok) {
      let message: string;
      if (options.check === true) {
        message = isGif
          ? `GIF render check passed: ${files.diagramPath}\n`
          : `Render check passed at ${timeMs}ms: ${files.diagramPath}\n`;
      } else if (isGif) {
        message = `Rendered GIF (${rendered.animation?.frameCount ?? 0} frames): ${output.outputPath}\n`;
      } else {
        message = `Rendered ${output.format.toUpperCase()} at ${timeMs}ms: ${output.outputPath}\n`;
      }
      dependencies.output.stdout(message);
    }
  }
  return { exitCode: ok ? 0 : 1 };
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
  const diagnostics = [...mermaidDiagnostics, ...motionDiagnostics];
  const ok = !hasErrors(diagnostics);
  const data = {
    diagramPath: files.diagramPath,
    motionPath: files.motionSource === undefined ? null : files.motionPath,
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
  const diagnostics = [
    ...attachFile(
      await dependencies.engine.validateMermaid(files.mermaidSource),
      files.diagramPath,
    ),
    ...attachFile(result.diagnostics, files.motionPath),
  ];
  const ok = !hasErrors(diagnostics) && result.timeline !== undefined;
  const data = {
    diagramPath: files.diagramPath,
    motionPath: files.motionSource === undefined ? null : files.motionPath,
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
  const diagnostics = [
    ...attachFile(
      await dependencies.engine.validateMermaid(files.mermaidSource),
      files.diagramPath,
    ),
    ...attachFile(result.diagnostics, files.motionPath),
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

function toDiagramDocument(files: DiagramFiles): DiagramDocument {
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
      command,
      diagnostic: cliDiagnostic(error.code, error.message),
      exitCode: 2,
    };
  }
  if (error instanceof CliInputError) {
    return {
      command,
      diagnostic: cliDiagnostic(error.code, error.message),
      exitCode: 2,
    };
  }
  if (error instanceof RenderRuntimeError) {
    return {
      command,
      diagnostic: cliDiagnostic(error.code, error.message),
      exitCode: error.exitCode,
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
  if (commands[0] === 'setup') {
    return 'setup';
  }
  if (commands[0] === 'validate') {
    return 'validate';
  }
  if (commands[0] === 'render') {
    return 'render';
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
