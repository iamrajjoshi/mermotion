import {
  applyFrameToSvg,
  compileMotion,
  discoverTargets,
  neutralizeMermaidImageSources,
  neutralizeSvgNetworkResources,
  renderMermaid,
  sampleTimeline,
  settleMotionViewport,
  type Diagnostic,
} from '@mermotion/engine';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type {
  BrowserFrameRequest,
  BrowserFrameResult,
  BrowserGifRequest,
  BrowserGifResult,
  BrowserRendererApi,
  BrowserRenderSource,
} from './browser-contract.js';
import {
  createGifFramePlan,
  fitGifDimensions,
  validateGifWorkload,
  type GifDimensions,
  type GifFramePlan,
} from './gif.js';

declare global {
  interface Window extends BrowserRendererApi {}
}

function sizeSvgToViewBox(svg: SVGSVGElement): void {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) {
    svg.setAttribute('width', `${viewBox.width}`);
    svg.setAttribute('height', `${viewBox.height}`);
  }
  svg.style.display = 'block';
  svg.style.maxWidth = 'none';
}

async function prepareDiagram(request: BrowserRenderSource) {
  document.body.replaceChildren();
  const container = document.createElement('main');
  container.style.display = 'inline-block';
  document.body.append(container);

  await document.fonts.ready;
  const rendered = await renderMermaid({
    id: 'mermotion-cli-render',
    source: neutralizeMermaidImageSources(request.mermaidSource),
  });
  container.innerHTML = rendered.svg;
  await document.fonts.ready;

  const svg = container.querySelector('svg');
  if (!svg) throw new Error('Mermaid did not return an SVG document.');
  svg.setAttribute('data-mermotion-cli-root', '');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  sizeSvgToViewBox(svg);

  const targets = discoverTargets(svg, rendered.diagramType);
  const compiled = compileMotion(
    {
      mermaidSource: request.mermaidSource,
      ...(request.motionSource === undefined ? {} : { motionSource: request.motionSource }),
    },
    { targets },
  );

  return { compiled, container, rendered, svg, targets };
}

function exportDiagnostic(message: string): Diagnostic {
  return {
    code: 'gif.export-invalid',
    message,
    severity: 'error',
    span: { column: 1, end: 0, endColumn: 1, endLine: 1, line: 1, start: 0 },
  };
}

function svgBackground(svg: SVGSVGElement): string {
  const background = getComputedStyle(svg).backgroundColor;
  return background === '' || background === 'transparent' || background === 'rgba(0, 0, 0, 0)'
    ? '#ffffff'
    : background;
}

function loadSvgImage(markup: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'sync';
  return new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener(
      'error',
      () => reject(new Error('The browser could not rasterize an exported SVG frame.')),
      { once: true },
    );
    // Blob URLs taint canvases containing Mermaid foreignObject labels. An encoded data URL
    // preserves those labels while keeping getImageData available to the local GIF encoder.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

async function rasterizeSvg(
  svg: SVGSVGElement,
  canvas: HTMLCanvasElement,
  background: string,
): Promise<Uint8ClampedArray> {
  const markup = neutralizeSvgNetworkResources(new XMLSerializer().serializeToString(svg));
  const image = await loadSvgImage(markup);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser could not create a canvas for GIF export.');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function sizeSvgForGif(
  container: HTMLElement,
  svg: SVGSVGElement,
  dimensions: GifDimensions,
): void {
  container.style.height = `${dimensions.height}px`;
  container.style.width = `${dimensions.width}px`;
  svg.setAttribute('height', `${dimensions.height}`);
  svg.setAttribute('width', `${dimensions.width}`);
  svg.style.height = `${dimensions.height}px`;
  svg.style.maxHeight = 'none';
  svg.style.overflow = 'visible';
  svg.style.width = `${dimensions.width}px`;
}

window.mermotionRenderFrame = async (request: BrowserFrameRequest): Promise<BrowserFrameResult> => {
  const { compiled, rendered, svg, targets } = await prepareDiagram(request);
  if (compiled.timeline) {
    applyFrameToSvg(svg, targets, sampleTimeline(compiled.timeline, request.timeMs), {
      reducedMotion: false,
    });
  }

  return {
    svg: neutralizeSvgNetworkResources(new XMLSerializer().serializeToString(svg)),
    diagramType: rendered.diagramType,
    targetCount: targets.length,
    durationMs: compiled.timeline?.durationMs ?? null,
    diagnostics: compiled.diagnostics,
  };
};

window.mermotionRenderGif = async (request: BrowserGifRequest): Promise<BrowserGifResult> => {
  const { compiled, container, rendered, svg, targets } = await prepareDiagram(request);
  const timeline = compiled.timeline;
  if (!timeline || compiled.diagnostics.some(({ severity }) => severity === 'error')) {
    return {
      animation: null,
      bytes: new Uint8Array(),
      diagramType: rendered.diagramType,
      targetCount: targets.length,
      durationMs: timeline?.durationMs ?? null,
      diagnostics: compiled.diagnostics,
    };
  }

  let plan: GifFramePlan;
  let dimensions: GifDimensions;
  try {
    plan = createGifFramePlan(timeline.durationMs, request.endPauseMs);
    const settled = settleMotionViewport(
      svg,
      targets,
      plan.frames.map(({ timeMs }) => timeMs),
      {
        fit: ({ height, width }) => fitGifDimensions(width, height),
        resize: (nextDimensions) => sizeSvgForGif(container, svg, nextDimensions),
        sample: (timeMs) => sampleTimeline(timeline, timeMs),
      },
    );
    dimensions = settled.dimensions;
    validateGifWorkload(dimensions, plan.frames.length);
  } catch (error) {
    return {
      animation: null,
      bytes: new Uint8Array(),
      diagramType: rendered.diagramType,
      targetCount: targets.length,
      durationMs: timeline.durationMs,
      diagnostics: [
        ...compiled.diagnostics,
        exportDiagnostic(error instanceof Error ? error.message : String(error)),
      ],
    };
  }
  const background = svgBackground(svg);
  const canvas = document.createElement('canvas');
  canvas.height = dimensions.height;
  canvas.width = dimensions.width;
  const encoder = GIFEncoder();

  for (const [index, frame] of plan.frames.entries()) {
    applyFrameToSvg(svg, targets, sampleTimeline(timeline, frame.timeMs), {
      reducedMotion: false,
    });
    // Each frame intentionally reuses the same rendered SVG. The only asynchronous work here is
    // rasterizing that sampled state; Mermaid layout and semantic binding run exactly once.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const rgba = await rasterizeSvg(svg, canvas, background);
    const palette = quantize(rgba, 256, { format: 'rgb565' });
    const indexed = applyPalette(rgba, palette, 'rgb565');
    encoder.writeFrame(indexed, dimensions.width, dimensions.height, {
      delay: frame.delayMs,
      dispose: 1,
      palette,
      ...(index === 0 ? { repeat: request.repeat } : {}),
    });
  }
  encoder.finish();

  return {
    animation: {
      frameCount: plan.frames.length,
      height: dimensions.height,
      playbackMs: plan.playbackMs,
      width: dimensions.width,
    },
    bytes: encoder.bytes(),
    diagramType: rendered.diagramType,
    targetCount: targets.length,
    durationMs: timeline.durationMs,
    diagnostics: compiled.diagnostics,
  };
};
