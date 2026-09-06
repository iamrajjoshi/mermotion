import { describe, expect, it } from 'vitest';
import { discoverTargetsFromSvg } from '../src/index.js';

function semanticKeys(svg: string, diagramType: string): string[] {
  return discoverTargetsFromSvg(svg, diagramType)
    .map(({ key }) => key)
    .sort((left, right) => left.localeCompare(right));
}

describe('Mermaid 11.17 target discovery', () => {
  it('normalizes flowchart nodes and route edges from synthetic rendered SVG', () => {
    const svg = `<svg id="chart" aria-roledescription="flowchart-v2">
      <g class="edgePaths">
        <path id="chart-L_A_B_0" class="flowchart-link" data-edge="true" data-et="edge" data-id="L_A_B_0" />
      </g>
      <g class="nodes">
        <g class="node default" id="chart-flowchart-A-0"><span class="nodeLabel">Client</span></g>
        <g class="node default" id="chart-flowchart-B-1"><span class="nodeLabel">API</span></g>
        <g class="image-shape" id="chart-flowchart-Image-2"><span class="nodeLabel">Image</span></g>
        <g class="icon-shape" id="chart-flowchart-Icon-3"><span class="nodeLabel">Icon</span></g>
      </g>
    </svg>`;
    const targets = discoverTargetsFromSvg(svg, 'flowchart-v2');
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'node:A', kind: 'node', id: 'A', label: 'Client' }),
        expect.objectContaining({ key: 'node:B', kind: 'node', id: 'B', label: 'API' }),
        expect.objectContaining({ key: 'node:Image', kind: 'node', id: 'Image', label: 'Image' }),
        expect.objectContaining({ key: 'node:Icon', kind: 'node', id: 'Icon', label: 'Icon' }),
        expect.objectContaining({ key: 'edge:A-->B#1', kind: 'edge', from: 'A', to: 'B' }),
      ]),
    );
  });

  it('normalizes participants and repeated sequence messages by semantic occurrence', () => {
    const svg = `<svg id="seq" aria-roledescription="sequence">
      <g data-et="participant" data-id="Worker"><text>Worker</text></g>
      <g data-et="participant" data-id="API"><text>API</text></g>
      <text class="messageText">GET /status</text>
      <line class="messageLine0" data-et="message" data-id="i0" data-from="Worker" data-to="API" marker-end="url(#seq-arrowhead)" />
      <text class="messageText">GET /status</text>
      <line class="messageLine0" data-et="message" data-id="i1" data-from="Worker" data-to="API" marker-end="url(#seq-arrowhead)" />
    </svg>`;
    const targets = discoverTargetsFromSvg(svg, 'sequence');
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'participant:Worker', kind: 'participant' }),
        expect.objectContaining({ key: 'participant:API', kind: 'participant' }),
        expect.objectContaining({ key: 'message:Worker->>API:GET /status#1', occurrence: 1 }),
        expect.objectContaining({ key: 'message:Worker->>API:GET /status#2', occurrence: 2 }),
      ]),
    );
  });

  it('keeps ordinary sequence arrow semantics in target keys', () => {
    const svg = `<svg>
      <text class="messageText">open</text><line class="messageLine0" data-et="message" data-id="i0" data-from="A" data-to="B" />
      <text class="messageText">dashed</text><line class="messageLine1" data-et="message" data-id="i1" data-from="A" data-to="B" />
      <text class="messageText">filled</text><line class="messageLine0" data-et="message" data-id="i2" data-from="A" data-to="B" marker-end="url(#seq-arrowhead)" />
      <text class="messageText">cross</text><line class="messageLine0" data-et="message" data-id="i3" data-from="A" data-to="B" marker-end="url(#seq-crosshead)" />
      <text class="messageText">async</text><line class="messageLine1" data-et="message" data-id="i4" data-from="A" data-to="B" marker-end="url(#seq-filled-head)" />
    </svg>`;
    expect(
      discoverTargetsFromSvg(svg, 'sequence')
        .filter((target) => target.kind === 'message')
        .map((target) => target.arrow),
    ).toEqual(['->', '-->', '->>', '-x', '--)']);
  });

  it('keeps flowchart keys stable across labels, source order, layout, and theme markup', () => {
    const variants = [
      `<svg><g class="nodes">
        <g class="node" id="one-flowchart-source-0"><span class="nodeLabel">Client</span></g>
        <g class="node" id="one-flowchart-api-1"><span class="nodeLabel">API</span></g>
      </g><path data-edge="true" data-id="L_source_api_0" /></svg>`,
      `<svg class="dark" style="background: #111827"><path data-et="edge" data-id="L_source_api_0" />
        <g class="node" id="two-flowchart-api-8"><span class="nodeLabel">Gateway</span></g>
        <g class="node" id="two-flowchart-source-4"><span class="nodeLabel">Browser</span></g>
      </svg>`,
    ];

    const keys = variants.map((svg) => semanticKeys(svg, 'flowchart-v2'));
    expect(keys[1]).toEqual(keys[0]);
    expect(keys[0]).toEqual(['diagram', 'edge:source-->api#1', 'node:api', 'node:source']);
  });

  it('keeps sequence keys stable when participant labels and unrelated message order change', () => {
    const baseline = `<svg>
      <g data-et="participant" data-id="worker"><text>Worker</text></g>
      <g data-et="participant" data-id="api"><text>API</text></g>
      <text class="messageText">GET /status</text>
      <line class="messageLine0" data-et="message" data-from="worker" data-to="api" marker-end="url(#one-arrowhead)" />
      <text class="messageText">200 OK</text>
      <line class="messageLine1" data-et="message" data-from="api" data-to="worker" marker-end="url(#one-arrowhead)" />
    </svg>`;
    const edited = `<svg class="themed">
      <g data-et="participant" data-id="api"><text>Status gateway</text></g>
      <g data-et="participant" data-id="worker"><text>Queue worker</text></g>
      <text class="messageText">200 OK</text>
      <line class="messageLine1" data-et="message" data-from="api" data-to="worker" marker-end="url(#two-arrowhead)" />
      <text class="messageText">GET /status</text>
      <line class="messageLine0" data-et="message" data-from="worker" data-to="api" marker-end="url(#two-arrowhead)" />
    </svg>`;
    expect(semanticKeys(edited, 'sequence')).toEqual(semanticKeys(baseline, 'sequence'));
    expect(semanticKeys(baseline, 'sequence')).toEqual([
      'diagram',
      'message:api-->>worker:200 OK#1',
      'message:worker->>api:GET /status#1',
      'participant:api',
      'participant:worker',
    ]);
  });
});
