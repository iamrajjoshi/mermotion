import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['apps', 'packages'].map((directory) => path.join(repositoryRoot, directory));
const sourceExtension = /\.(?:c|m)?(?:j|t)sx?$/;
const directMermaidImport = /(?:from\s+|import\s*\()(['"])mermaid\1/;
const mermaidSubpathImport = /(?:from\s+|import\s*\()(['"])mermaid\//;
const violations = [];

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'dist' || entry.name === 'node_modules') return;

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        return;
      }

      if (!sourceExtension.test(entry.name)) return;

      const source = await readFile(entryPath, 'utf8');
      const relativePath = path.relative(repositoryRoot, entryPath);

      if (mermaidSubpathImport.test(source)) {
        violations.push(`${relativePath}: imports an unsupported Mermaid subpath`);
      }

      if (directMermaidImport.test(source) && !relativePath.startsWith('packages/engine/src/')) {
        violations.push(`${relativePath}: imports Mermaid outside packages/engine`);
      }
    }),
  );
}

await Promise.all(sourceRoots.map(visit));

const [workspaceSource, versionSource] = await Promise.all([
  readFile(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'),
  readFile(path.join(repositoryRoot, 'packages/engine/src/version.ts'), 'utf8'),
]);
const catalogVersion = /^\s*mermaid:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(workspaceSource)?.[1];
const adapterVersion = /MERMAID_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(versionSource)?.[1];
if (!catalogVersion || !adapterVersion || catalogVersion !== adapterVersion) {
  violations.push(
    `Mermaid version mismatch: catalog=${catalogVersion ?? 'missing'}, adapter=${adapterVersion ?? 'missing'}`,
  );
}

if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Mermaid dependency boundary and ${catalogVersion} pin are valid.`);
}
