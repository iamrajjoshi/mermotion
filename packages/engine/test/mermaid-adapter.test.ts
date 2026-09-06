import { describe, expect, it } from 'vitest';
import { inspectMermaid, renderMermaid, validateMermaid } from '../src/index.js';
import type { MermaidRenderConfig } from '../src/index.js';

const NESTED_THEME_CONFIG = {
  theme: 'base',
  themeVariables: {
    wardley: {
      axisColor: '#1d4ed8',
    },
  },
} satisfies MermaidRenderConfig;

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

  it('accepts nested Mermaid theme variables and fails clearly without a browser document', async () => {
    await expect(
      renderMermaid({ source: 'flowchart LR\n A-->B', config: NESTED_THEME_CONFIG }),
    ).rejects.toMatchObject({
      name: 'MermaidAdapterError',
      code: 'mermaid.browser-required',
    });
  });
});
