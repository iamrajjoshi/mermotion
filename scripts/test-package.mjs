import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const runFile = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceManifest = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
);
const sourceVersion = sourceManifest.version;
if (typeof sourceVersion !== 'string') throw new Error('Mermotion package version is missing.');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'mermotion-package-'));
const tarballPath = path.join(temporaryRoot, `mermotion-${sourceVersion}.tgz`);
const projectRoot = path.join(temporaryRoot, 'consumer');

async function run(command, arguments_, cwd) {
  return runFile(command, arguments_, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await run('pnpm', ['pack', '--out', tarballPath], repositoryRoot);
  await mkdir(projectRoot);
  await writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({ name: 'mermotion-package-smoke', private: true }, null, 2)}\n`,
  );
  await run('pnpm', ['add', '--ignore-scripts', tarballPath], projectRoot);

  const installedRoot = await realpath(path.join(projectRoot, 'node_modules', 'mermotion'));
  assert(
    !installedRoot.startsWith(`${repositoryRoot}${path.sep}`),
    'Packed Mermotion resolved back to the source checkout.',
  );

  const requiredFiles = [
    'LICENSE',
    'README.md',
    '.agents/skills/mermotion/SKILL.md',
    '.agents/skills/mermotion/references/motion-language.md',
    'packages/cli/dist/index.js',
    'packages/cli/dist/browser/renderer.js',
    'packages/cli/dist/browser/THIRD_PARTY_LICENSES.md',
  ];
  await Promise.all(requiredFiles.map((file) => access(path.join(installedRoot, file))));

  const manifest = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
  assert(manifest.name === 'mermotion', 'Packed package has the wrong name.');
  assert(manifest.version === sourceVersion, 'Packed package has the wrong version.');
  assert(
    manifest.dependencies?.['@mermotion/engine'] === undefined,
    'Packed package depends on the private workspace engine.',
  );
  for (const version of Object.values(manifest.dependencies ?? {})) {
    assert(
      typeof version === 'string' && !/^(?:file|link|workspace):/.test(version),
      `Packed package contains a source-only dependency: ${String(version)}`,
    );
  }

  const version = await run('pnpm', ['exec', 'mermotion', '--version'], projectRoot);
  assert(version.stdout.trim() === sourceVersion, 'Installed CLI reports the wrong version.');

  const diagramPath = path.join(projectRoot, 'request.mmd');
  const motionPath = path.join(projectRoot, 'request.motion');
  const framePath = path.join(projectRoot, 'request.svg');
  await writeFile(diagramPath, 'flowchart LR\n  Client --> API\n');
  await writeFile(
    motionPath,
    'motionDiagram-v1\n  marker request as "Request"\n  move request along Client --> API over 1s\n',
  );

  const validation = await run(
    'pnpm',
    ['exec', 'mermotion', 'validate', diagramPath, '--json'],
    projectRoot,
  );
  assert(JSON.parse(validation.stdout).ok === true, 'Installed CLI validation failed.');

  const rendering = await run(
    'pnpm',
    ['exec', 'mermotion', 'render', diagramPath, '--at', '500ms', '-o', framePath, '--json'],
    projectRoot,
  );
  const renderResult = JSON.parse(rendering.stdout);
  assert(renderResult.ok === true, 'Installed CLI rendering failed.');
  assert(renderResult.data?.written === true, 'Installed CLI did not write the rendered frame.');
  const frame = await readFile(framePath, 'utf8');
  assert(frame.includes('<svg'), 'Installed CLI output is not SVG.');
  assert(
    frame.includes('data-marker-id="request"'),
    'Installed CLI omitted the sampled motion marker.',
  );

  process.stdout.write('Packed Mermotion installed and rendered outside the source checkout.\n');
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
