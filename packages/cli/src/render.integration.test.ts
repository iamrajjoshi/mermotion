import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { renderDiagram } from './render.js';

const runBrowserTests = process.env.MERMOTION_BROWSER_TEST === '1';

interface GifStructure {
  delays: number[];
  frameCount: number;
  height: number;
  repeat?: number;
  trailer: boolean;
  width: number;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function skipSubBlocks(bytes: Uint8Array, initialOffset: number): number {
  let offset = initialOffset;
  while (offset < bytes.length) {
    const size = bytes[offset] ?? 0;
    offset += 1;
    if (size === 0) return offset;
    offset += size;
  }
  throw new Error('GIF sub-block did not terminate.');
}

function parseGif(bytes: Uint8Array): GifStructure {
  expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
  const width = readUint16(bytes, 6);
  const height = readUint16(bytes, 8);
  const packed = bytes[10] ?? 0;
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1);

  const delays: number[] = [];
  let frameCount = 0;
  let repeat: number | undefined;
  let trailer = false;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      trailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) {
        expect(bytes[offset++]).toBe(4);
        offset += 1;
        delays.push(readUint16(bytes, offset));
        offset += 4;
      } else if (label === 0xff) {
        const blockSize = bytes[offset++] ?? 0;
        const identifier = new TextDecoder().decode(bytes.slice(offset, offset + blockSize));
        offset += blockSize;
        if (identifier === 'NETSCAPE2.0' && bytes[offset] === 3 && bytes[offset + 1] === 1) {
          repeat = readUint16(bytes, offset + 2);
        }
        offset = skipSubBlocks(bytes, offset);
      } else {
        offset = skipSubBlocks(bytes, offset);
      }
      continue;
    }
    if (marker !== 0x2c) throw new Error(`Unexpected GIF block 0x${marker?.toString(16)}`);
    frameCount += 1;
    offset += 8;
    const imagePacked = bytes[offset++] ?? 0;
    if ((imagePacked & 0x80) !== 0) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    offset += 1;
    offset = skipSubBlocks(bytes, offset);
  }

  return {
    delays,
    frameCount,
    height,
    ...(repeat === undefined ? {} : { repeat }),
    trailer,
    width,
  };
}

describe.skipIf(!runBrowserTests)('browser renderer', () => {
  it('renders a sampled flowchart frame as SVG and PNG', async () => {
    const request = {
      mermaidSource: 'flowchart LR\n  Client --> API\n',
      motionSource:
        'motionDiagram-v1\n  defaults duration 400ms easing linear\n  marker request as "Request"\n  at 0ms move request along Client --> API over 1s easing linear\n',
      timeMs: 500,
    };

    const svg = await renderDiagram({ ...request, format: 'svg' });
    const svgSource = new TextDecoder().decode(svg.bytes);
    expect(svg.diagramType).toBe('flowchart-v2');
    expect(svg.targetCount).toBeGreaterThanOrEqual(4);
    expect(svg.durationMs).toBe(1_200);
    expect(svg.diagnostics).toEqual([]);
    expect(svgSource).toContain('data-mermotion-target="node:Client"');
    expect(svgSource).toContain('data-marker-id="request"');

    const png = await renderDiagram({ ...request, format: 'png' });
    expect(Array.from(png.bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  }, 60_000);

  it('renders a structurally valid animated GIF from one prepared diagram', async () => {
    const result = await renderDiagram({
      endPauseMs: 500,
      format: 'gif',
      mermaidSource: 'flowchart LR\n  Client --> API\n',
      motionSource: 'motionDiagram-v1\n  pulse API for 120ms\n',
      repeat: 0,
    });

    expect(result.diagramType).toBe('flowchart-v2');
    expect(result.targetCount).toBeGreaterThanOrEqual(4);
    expect(result.durationMs).toBe(120);
    expect(result.diagnostics).toEqual([]);
    expect(result.animation).toEqual({
      frameCount: 4,
      height: expect.any(Number),
      playbackMs: 620,
      width: 960,
    });
    expect(result.animation?.height).toBeGreaterThan(0);
    expect(parseGif(result.bytes)).toEqual({
      delays: [5, 5, 2, 50],
      frameCount: 4,
      height: result.animation?.height,
      repeat: 0,
      trailer: true,
      width: 960,
    });
  }, 60_000);

  it('renders a one-shot sequence-diagram GIF without loop metadata', async () => {
    const result = await renderDiagram({
      endPauseMs: 0,
      format: 'gif',
      mermaidSource: `sequenceDiagram
  participant Worker
  participant API
  Worker->>API: GET /status
`,
      motionSource: 'motionDiagram-v1\n  pulse Worker for 100ms\n',
      repeat: -1,
    });
    const structure = parseGif(result.bytes);

    expect(result.diagramType).toBe('sequence');
    expect(result.durationMs).toBe(100);
    expect(result.diagnostics).toEqual([]);
    expect(structure.frameCount).toBe(3);
    expect(structure.delays).toEqual([5, 5, 1]);
    expect(structure.repeat).toBeUndefined();
    expect(structure.width).toBe(960);
    expect(structure.height).toBeGreaterThan(0);
    expect(structure.trailer).toBe(true);
  }, 60_000);

  it('expands the GIF viewport to preserve moving marker labels', async () => {
    const mermaidSource = `flowchart LR
  A --> B --> C --> D --> E --> F --> G --> H --> I --> J --> K --> L --> M --> N --> O --> P
`;
    const still = await renderDiagram({ format: 'svg', mermaidSource, timeMs: 0 });
    const stillSource = new TextDecoder().decode(still.bytes);
    const viewBoxMatch = /viewBox="-?[\d.]+\s+-?[\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(stillSource);
    expect(viewBoxMatch).not.toBeNull();
    const stillWidth = Number(viewBoxMatch?.[1]);
    const stillHeight = Number(viewBoxMatch?.[2]);
    const unexpandedHeight = Math.round((960 * stillHeight) / stillWidth);

    const animated = await renderDiagram({
      endPauseMs: 0,
      format: 'gif',
      mermaidSource,
      motionSource:
        'motionDiagram-v1\n  marker request as "Scale dependent callout"\n  move request along A --> B over 100ms\n',
      repeat: -1,
    });

    expect(animated.diagnostics).toEqual([]);
    expect(animated.animation?.height).toBeGreaterThan(unexpandedHeight + 20);
  }, 60_000);

  it('includes CSS pulse-shadow paint when settling a downscaled GIF', async () => {
    const mermaidSource = `flowchart LR
  A --> B --> C --> D --> E --> F --> G --> H --> I --> J --> K --> L --> M --> N --> O --> P
`;
    const still = await renderDiagram({ format: 'svg', mermaidSource, timeMs: 0 });
    const stillSource = new TextDecoder().decode(still.bytes);
    const viewBoxMatch = /viewBox="-?[\d.]+\s+-?[\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(stillSource);
    expect(viewBoxMatch).not.toBeNull();
    const unexpandedHeight = Math.round(
      (960 * Number(viewBoxMatch?.[2])) / Number(viewBoxMatch?.[1]),
    );

    const animated = await renderDiagram({
      endPauseMs: 0,
      format: 'gif',
      mermaidSource,
      motionSource: 'motionDiagram-v1\n  pulse A for 100ms\n',
      repeat: -1,
    });

    expect(animated.diagnostics).toEqual([]);
    expect(animated.animation?.height).toBeGreaterThan(unexpandedHeight + 40);
  }, 60_000);

  it('preserves screen-sized callouts when a tall GIF reaches the dimension cap', async () => {
    const nodeIds = Array.from({ length: 40 }, (_, index) => `N${index}`);
    const mermaidSource = `flowchart TB
  ${nodeIds.join(' --> ')}
`;
    const still = await renderDiagram({ format: 'svg', mermaidSource, timeMs: 0 });
    const stillSource = new TextDecoder().decode(still.bytes);
    const viewBoxMatch = /viewBox="-?[\d.]+\s+-?[\d.]+\s+([\d.]+)\s+([\d.]+)"/.exec(stillSource);
    expect(viewBoxMatch).not.toBeNull();
    const stillWidth = Number(viewBoxMatch?.[1]);
    const stillHeight = Number(viewBoxMatch?.[2]);
    const unexpandedWidth = Math.round((2_400 * stillWidth) / stillHeight);

    const animated = await renderDiagram({
      endPauseMs: 0,
      format: 'gif',
      mermaidSource,
      motionSource:
        'motionDiagram-v1\n  marker request as "Tall scale dependent callout"\n  move request along N0 --> N1 over 100ms\n',
      repeat: -1,
    });

    expect(animated.diagnostics).toEqual([]);
    expect(animated.animation?.height).toBe(2_400);
    expect(animated.animation?.width).toBeGreaterThan(unexpandedWidth + 100);
  }, 60_000);

  it('reports a missing rendered target', async () => {
    const result = await renderDiagram({
      mermaidSource: 'flowchart LR\n  A --> B\n',
      motionSource: 'motionDiagram-v1\n  highlight Missing\n',
      timeMs: 0,
      format: 'svg',
    });

    expect(result.durationMs).toBe(0);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'motion.target-not-found', severity: 'error' }),
      ]),
    );
  }, 30_000);

  it('renders motion against sequence participants and their unique message', async () => {
    const result = await renderDiagram({
      mermaidSource: `sequenceDiagram
  participant Worker
  participant API
  Worker->>API: GET /status
`,
      motionSource: `motionDiagram-v1
  marker request as "Request"
  at 0ms move request along Worker --> API over 1s easing linear
  with trace Worker --> API over 1s easing linear
`,
      timeMs: 500,
      format: 'svg',
    });

    const svgSource = new TextDecoder().decode(result.bytes);
    expect(result.diagramType).toBe('sequence');
    expect(result.targetCount).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics).toEqual([]);
    expect(svgSource).toContain('data-mermotion-target="participant:Worker"');
    expect(svgSource).toContain('data-mermotion-target="message:Worker-&gt;&gt;API:GET /status#1"');
    expect(svgSource).toContain('data-marker-id="request"');
    expect(svgSource).toContain('data-mermotion-trace');
  }, 30_000);

  it('exports SVG without active external resources', async () => {
    const externalResource = 'https://example.invalid/probe.svg';
    const result = await renderDiagram({
      mermaidSource: `---
config:
  themeCSS: ".node rect { fill: url('${externalResource}') !important; }"
---
flowchart LR
  A["<img src='${externalResource}' alt='Remote'>"] --> B[Consumer]
  click B href "${externalResource}"
`,
      timeMs: 0,
      format: 'svg',
    });

    const svgSource = new TextDecoder().decode(result.bytes);
    expect(svgSource).not.toContain(externalResource);

    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const attemptedRequests: string[] = [];
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        attemptedRequests.push(route.request().url());
        await route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      await page.setContent(svgSource);
      await page.waitForTimeout(100);
    } finally {
      await browser.close();
    }

    expect(attemptedRequests).toEqual([]);
  }, 30_000);
});
