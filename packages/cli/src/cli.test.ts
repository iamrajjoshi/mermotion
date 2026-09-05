import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli, type CliDependencies, type CliEngine } from './cli.js';
import {
  parseMotion,
  type CompiledTimeline,
  type Diagnostic,
  type FrameState,
} from '@mermotion/engine';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('runCli', () => {
  it('marks target-bearing validation as inferred without rewriting either source file', async () => {
    const directory = await temporaryDirectory();
    const diagramPath = path.join(directory, 'checkout.mmd');
    const motionPath = path.join(directory, 'checkout.motion');
    const mermaidSource = 'flowchart LR\n  A --> B\n';
    const motionSource = 'motionDiagram-v1\n  highlight Missing\n';
    await writeFile(diagramPath, mermaidSource);
    await writeFile(motionPath, motionSource);
    const harness = createHarness({
      compileMotion: vi.fn(() => ({
        timeline: compiledTimeline(400, 'node:Missing'),
        diagnostics: [],
      })),
    });

    const exitCode = await runCli(['validate', diagramPath, '--json'], harness.dependencies);

    expect(exitCode).toBe(0);
    expect(harness.engine.validateMermaid).toHaveBeenCalledWith(mermaidSource);
    expect(harness.engine.validateMotion).toHaveBeenCalledWith(motionSource);
    expect(await readFile(diagramPath, 'utf8')).toBe(mermaidSource);
    expect(await readFile(motionPath, 'utf8')).toBe(motionSource);
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      schemaVersion: 1,
      command: 'validate',
      ok: true,
      data: { diagramPath, motionPath, targetResolution: 'inferred' },
      diagnostics: [
        {
          code: 'CLI_TARGETS_NOT_VERIFIED',
          severity: 'warning',
          file: motionPath,
        },
      ],
    });
    expect(harness.stderr).toBe('');
  });

  it('does not warn about target resolution for a diagram without motion cues', async () => {
    const directory = await temporaryDirectory();
    const diagramPath = path.join(directory, 'static.mmd');
    await writeFile(diagramPath, 'flowchart LR\n  A --> B\n');
    const harness = createHarness();

    const exitCode = await runCli(['validate', diagramPath, '--json'], harness.dependencies);

    expect(exitCode).toBe(0);
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'validate',
      ok: true,
      data: { targetResolution: 'not-needed' },
      diagnostics: [],
    });
  });

  it('does not require rendered targets for a diagram-level effect', async () => {
    const directory = await temporaryDirectory();
    const diagramPath = path.join(directory, 'whole-diagram.mmd');
    const motionPath = path.join(directory, 'whole-diagram.motion');
    await writeFile(diagramPath, 'flowchart LR\n  A --> B\n');
    await writeFile(motionPath, 'motionDiagram-v1\n  pulse diagram for 200ms\n');
    const harness = createHarness();

    const exitCode = await runCli(['validate', diagramPath, '--json'], harness.dependencies);

    expect(exitCode).toBe(0);
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'validate',
      ok: true,
      data: { targetResolution: 'not-needed' },
      diagnostics: [],
    });
  });

  it('treats a missing optional motion sibling as a valid no-cue diagram', async () => {
    const directory = await temporaryDirectory();
    const diagramPath = path.join(directory, 'static.mmd');
    await writeFile(diagramPath, 'flowchart LR\n  A --> B\n');
    const harness = createHarness();

    const exitCode = await runCli(['motion', 'check', diagramPath, '--json'], harness.dependencies);

    expect(exitCode).toBe(0);
    expect(harness.engine.validateMotion).not.toHaveBeenCalled();
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'motion.check',
      ok: true,
      data: { motionPath: null },
    });
  });

  it('returns exit code 1 and file-qualified diagnostics for invalid motion', async () => {
    const directory = await temporaryDirectory();
    const motionPath = path.join(directory, 'broken.motion');
    await writeFile(motionPath, 'not-a-motion-file\n');
    const harness = createHarness({
      validateMotion: vi.fn((): Diagnostic[] => [
        {
          code: 'MOTION_HEADER_REQUIRED',
          severity: 'error',
          message: 'Expected motionDiagram-v1',
          span: { start: 0, end: 17, line: 1, column: 1, endLine: 1, endColumn: 18 },
        },
      ]),
    });

    const exitCode = await runCli(['--json', 'motion', 'check', motionPath], harness.dependencies);

    expect(exitCode).toBe(1);
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'motion.check',
      ok: false,
      diagnostics: [{ code: 'MOTION_HEADER_REQUIRED', file: motionPath }],
    });
  });

  it('formats through an atomic same-directory replacement and preserves file mode', async () => {
    const directory = await temporaryDirectory();
    const motionPath = path.join(directory, 'format.motion');
    await writeFile(motionPath, 'motionDiagram-v1\nhighlight A\n');
    await chmod(motionPath, 0o640);
    const harness = createHarness({
      formatMotion: vi.fn(() => ({
        formatted: 'motionDiagram-v1\n  highlight A\n',
        diagnostics: [],
      })),
    });

    const exitCode = await runCli(['motion', 'fmt', motionPath, '--json'], harness.dependencies);

    expect(exitCode).toBe(0);
    expect(await readFile(motionPath, 'utf8')).toBe('motionDiagram-v1\n  highlight A\n');
    expect((await stat(motionPath)).mode & 0o777).toBe(0o640);
    expect((await readdir(directory)).toSorted()).toEqual(['format.motion']);
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'motion.fmt',
      ok: true,
      data: { changed: true, checkOnly: false, written: true },
    });
  });

  it('reports a formatting check failure without writing', async () => {
    const directory = await temporaryDirectory();
    const motionPath = path.join(directory, 'format.motion');
    const original = 'motionDiagram-v1\nhighlight A\n';
    await writeFile(motionPath, original);
    const harness = createHarness({
      formatMotion: vi.fn(() => ({
        formatted: 'motionDiagram-v1\n  highlight A\n',
        diagnostics: [],
      })),
    });

    const exitCode = await runCli(
      ['motion', 'fmt', motionPath, '--check', '--json'],
      harness.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(await readFile(motionPath, 'utf8')).toBe(original);
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'motion.fmt',
      ok: false,
      data: { changed: true, checkOnly: true, written: false },
      diagnostics: [{ code: 'CLI_FORMAT_REQUIRED', file: motionPath }],
    });
  });

  it('compiles the exact source pair and emits the timeline in its JSON envelope', async () => {
    const directory = await temporaryDirectory();
    const diagramPath = path.join(directory, 'compile.mmd');
    const motionPath = path.join(directory, 'compile.motion');
    const mermaidSource = 'flowchart LR\n  A --> B\n';
    const motionSource = 'motionDiagram-v1\n  pulse B for 200ms\n';
    await writeFile(diagramPath, mermaidSource);
    await writeFile(motionPath, motionSource);
    const timeline = compiledTimeline(200, 'node:B');
    const compile = vi.fn(() => ({ timeline, diagnostics: [] }));
    const harness = createHarness({ compileMotion: compile });

    const exitCode = await runCli(
      ['motion', 'compile', diagramPath, '--json'],
      harness.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(compile).toHaveBeenCalledWith({ mermaidSource, motionSource });
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'motion.compile',
      ok: true,
      data: { diagramPath, motionPath, targetResolution: 'inferred', timeline },
      diagnostics: [
        {
          code: 'CLI_TARGETS_NOT_VERIFIED',
          severity: 'warning',
          file: motionPath,
        },
      ],
    });
  });

  it('parses duration units and samples the compiled timeline at an exact time', async () => {
    const directory = await temporaryDirectory();
    const diagramPath = path.join(directory, 'sample.mmd');
    const motionPath = path.join(directory, 'sample.motion');
    await writeFile(diagramPath, 'flowchart LR\n  A --> B\n');
    await writeFile(motionPath, 'motionDiagram-v1\n  pulse Missing for 2s\n');
    const timeline = compiledTimeline(2_000, 'node:Missing');
    const sample = vi.fn((_timeline: CompiledTimeline, timeMs: number) =>
      frameState(timeMs, 2_000),
    );
    const harness = createHarness({
      compileMotion: vi.fn(() => ({ timeline, diagnostics: [] })),
      sampleTimeline: sample,
    });

    const exitCode = await runCli(
      ['sample', diagramPath, '--time', '1.25s', '--json'],
      harness.dependencies,
    );

    expect(exitCode).toBe(0);
    expect(sample).toHaveBeenCalledWith(timeline, 1_250);
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'sample',
      ok: true,
      data: {
        targetResolution: 'inferred',
        timeMs: 1_250,
        frame: frameState(1_250, 2_000),
      },
      diagnostics: [
        {
          code: 'CLI_TARGETS_NOT_VERIFIED',
          severity: 'warning',
          file: motionPath,
        },
      ],
    });
  });

  it('does not sample when Mermaid validation fails', async () => {
    const directory = await temporaryDirectory();
    const diagramPath = path.join(directory, 'broken.mmd');
    await writeFile(diagramPath, 'not a diagram\n');
    const sample = vi.fn((_timeline: CompiledTimeline, timeMs: number) => frameState(timeMs));
    const harness = createHarness({
      validateMermaid: vi.fn(async (): Promise<Diagnostic[]> => [
        {
          code: 'mermaid.parse-error',
          severity: 'error',
          message: 'UnknownDiagramError',
          span: { start: 0, end: 13, line: 1, column: 1, endLine: 1, endColumn: 14 },
        },
      ]),
      sampleTimeline: sample,
    });

    const exitCode = await runCli(
      ['sample', diagramPath, '--time', '100ms', '--json'],
      harness.dependencies,
    );

    expect(exitCode).toBe(1);
    expect(sample).not.toHaveBeenCalled();
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'sample',
      ok: false,
      diagnostics: [{ code: 'mermaid.parse-error', file: diagramPath }],
    });
  });

  it('uses exit code 2 and a JSON diagnostic for invalid invocation input', async () => {
    const directory = await temporaryDirectory();
    const diagramPath = path.join(directory, 'sample.mmd');
    await writeFile(diagramPath, 'flowchart LR\n  A --> B\n');
    const harness = createHarness();

    const exitCode = await runCli(
      ['sample', diagramPath, '--time', 'soon', '--json'],
      harness.dependencies,
    );

    expect(exitCode).toBe(2);
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      command: 'sample',
      ok: false,
      diagnostics: [{ code: 'CLI_INVALID_DURATION' }],
    });
  });

  it('keeps Commander usage failures machine-readable when JSON is requested', async () => {
    const harness = createHarness();

    const exitCode = await runCli(['sample', '--json'], harness.dependencies);

    expect(exitCode).toBe(2);
    expect(harness.stderr).toBe('');
    expect(parseSingleJson(harness.stdout)).toMatchObject({
      schemaVersion: 1,
      command: 'cli',
      ok: false,
      data: null,
      diagnostics: [{ code: 'CLI_USAGE' }],
    });
  });
});

function createHarness(overrides: Partial<CliEngine> = {}): {
  dependencies: CliDependencies;
  engine: CliEngine;
  stdout: string;
  stderr: string;
} {
  let stdout = '';
  let stderr = '';
  const engine: CliEngine = {
    validateMermaid: vi.fn(async () => []),
    validateMotion: vi.fn(() => []),
    parseMotion,
    formatMotion: vi.fn((source) => ({ formatted: source, diagnostics: [] })),
    compileMotion: vi.fn(() => ({ timeline: compiledTimeline(), diagnostics: [] })),
    sampleTimeline: vi.fn((_timeline: CompiledTimeline, timeMs: number) => frameState(timeMs)),
    ...overrides,
  };
  const result = {
    engine,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    dependencies: {
      engine,
      output: {
        stdout(message: string) {
          stdout += message;
        },
        stderr(message: string) {
          stderr += message;
        },
      },
    },
  };
  return result;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'mermotion-cli-'));
  temporaryDirectories.push(directory);
  return directory;
}

function parseSingleJson(output: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed)) {
    throw new TypeError('Expected one JSON object from the CLI');
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compiledTimeline(durationMs = 0, targetKey?: string): CompiledTimeline {
  return {
    version: 'motion-ir-v1',
    durationMs,
    defaults: { durationMs: 400, easing: 'ease-out' },
    markers: {},
    events:
      targetKey === undefined
        ? []
        : [
            {
              id: 'cue-1',
              kind: 'pulse',
              startMs: 0,
              durationMs,
              easing: 'ease-out',
              sourceIndex: 0,
              sourceSpan: { start: 0, end: 1, line: 1, column: 1, endLine: 1, endColumn: 2 },
              targetKeys: [targetKey],
              route: [],
            },
          ],
    targetKeys: targetKey === undefined ? [] : [targetKey],
    initialHiddenTargetKeys: [],
  };
}

function frameState(timeMs: number, durationMs = 0): FrameState {
  return { timeMs, durationMs, targets: {}, markers: {}, traces: [] };
}
