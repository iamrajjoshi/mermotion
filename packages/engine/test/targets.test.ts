import { describe, expect, it } from 'vitest';
import { discoverTargetsFromSvg } from '../src/index.js';

describe('Mermaid 11.17 target discovery', () => {
  it('normalizes flowchart nodes and route edges from synthetic rendered SVG', () => {
    const svg = `<svg id="chart" aria-roledescription="flowchart-v2">
      <g class="edgePaths">
        <path id="chart-L_A_B_0" class="flowchart-link" data-edge="true" data-et="edge" data-id="L_A_B_0" />
      </g>
      <g class="nodes">
        <g class="node default" id="chart-flowchart-A-0"><span class="nodeLabel">Client</span></g>
        <g class="node default" id="chart-flowchart-B-1"><span class="nodeLabel">API</span></g>
      </g>
    </svg>`;
    const targets = discoverTargetsFromSvg(svg, 'flowchart-v2');
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'node:A', kind: 'node', id: 'A', label: 'Client' }),
        expect.objectContaining({ key: 'node:B', kind: 'node', id: 'B', label: 'API' }),
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
});
