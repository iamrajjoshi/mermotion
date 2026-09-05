import { describe, expect, it } from 'vitest';
import { inspectMermaid, renderMermaid, validateMermaid } from '../src/index.js';

describe('public Mermaid adapter', () => {
  it('validates and detects a Mermaid diagram in plain Node', async () => {
    await expect(inspectMermaid('flowchart LR\n A-->B')).resolves.toEqual({
      diagramType: 'flowchart-v2',
      diagnostics: [],
    });
    await expect(validateMermaid('this is not Mermaid')).resolves.toEqual([
      expect.objectContaining({
        code: 'mermaid.parse-error',
        severity: 'error',
        span: expect.objectContaining({ line: 1 }),
      }),
    ]);
  });

  it('fails clearly when SVG rendering is attempted without a browser document', async () => {
    await expect(renderMermaid({ source: 'flowchart LR\n A-->B' })).rejects.toMatchObject({
      name: 'MermaidAdapterError',
      code: 'mermaid.browser-required',
    });
  });
});
