import { randomUUID } from 'node:crypto';
import { open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export interface DiagramFiles {
  diagramPath: string;
  mermaidSource: string;
  motionPath: string;
  motionSource?: string;
}

export class FileInputError extends Error {
  readonly code: string;
  readonly filePath: string;

  constructor(code: string, message: string, filePath: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FileInputError';
    this.code = code;
    this.filePath = filePath;
  }
}

export function siblingMotionPath(diagramPath: string): string {
  const extension = path.extname(diagramPath);
  return `${diagramPath.slice(0, -extension.length)}.motion`;
}

export function requireExtension(filePath: string, extension: '.mmd' | '.motion'): string {
  const resolvedPath = path.resolve(filePath);
  if (path.extname(resolvedPath).toLowerCase() !== extension) {
    throw new FileInputError(
      'CLI_INVALID_EXTENSION',
      `Expected a ${extension} file, received ${filePath}`,
      resolvedPath,
    );
  }
  return resolvedPath;
}

export async function readTextFile(filePath: string): Promise<string> {
  try {
    const handle = await open(filePath, 'r');
    try {
      return await handle.readFile({ encoding: 'utf8' });
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw toFileInputError(error, filePath);
  }
}

export async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readTextFile(filePath);
  } catch (error) {
    if (error instanceof FileInputError && error.code === 'CLI_FILE_NOT_FOUND') {
      return undefined;
    }
    throw error;
  }
}

export async function readDiagramFiles(inputPath: string): Promise<DiagramFiles> {
  const diagramPath = requireExtension(inputPath, '.mmd');
  const motionPath = siblingMotionPath(diagramPath);
  const [mermaidSource, motionSource] = await Promise.all([
    readTextFile(diagramPath),
    readOptionalTextFile(motionPath),
  ]);

  return {
    diagramPath,
    mermaidSource,
    motionPath,
    ...(motionSource === undefined ? {} : { motionSource }),
  };
}

export async function atomicWriteTextFile(filePath: string, content: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const directory = path.dirname(resolvedPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let mode: number | undefined;

  try {
    mode = (await stat(resolvedPath)).mode;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw toFileInputError(error, resolvedPath);
    }
  }

  try {
    const handle = await open(temporaryPath, 'wx', mode);
    try {
      await handle.writeFile(content, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw toFileInputError(error, resolvedPath);
  }
}

function toFileInputError(error: unknown, filePath: string): FileInputError {
  const resolvedPath = path.resolve(filePath);
  if (isNodeError(error)) {
    if (error.code === 'ENOENT') {
      return new FileInputError(
        'CLI_FILE_NOT_FOUND',
        `File not found: ${resolvedPath}`,
        resolvedPath,
        { cause: error },
      );
    }
    if (error.code === 'EISDIR') {
      return new FileInputError(
        'CLI_EXPECTED_FILE',
        `Expected a file, received a directory: ${resolvedPath}`,
        resolvedPath,
        { cause: error },
      );
    }
    return new FileInputError(
      'CLI_FILE_ERROR',
      `Unable to access ${resolvedPath}: ${error.message}`,
      resolvedPath,
      { cause: error },
    );
  }

  return new FileInputError('CLI_FILE_ERROR', `Unable to access ${resolvedPath}`, resolvedPath, {
    cause: error,
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
