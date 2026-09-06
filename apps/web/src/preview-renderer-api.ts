import { createPreviewRendererDocument } from './preview-renderer-document';
import {
  PREVIEW_RENDERER_CHANNEL,
  type PreviewRenderOptions,
  type PreviewRenderRequest,
  type PreviewRenderResult,
  type PreviewRenderResponse,
} from './preview-renderer-protocol';

export type { PreviewRenderOptions, PreviewRenderResult } from './preview-renderer-protocol';
const RENDER_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MESSAGE = 'The isolated Mermaid renderer timed out.';

interface RendererRecoveryState {
  generation: number;
  recovering: boolean;
  sourceToSkip: string | undefined;
}

const rendererStates = new WeakMap<HTMLIFrameElement, RendererRecoveryState>();
let requestSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRenderResponse(value: unknown): value is PreviewRenderResponse {
  if (!isRecord(value) || value.channel !== PREVIEW_RENDERER_CHANNEL) return false;
  if (typeof value.requestId !== 'string') return false;
  if (value.kind === 'render-error') return typeof value.error === 'string';
  if (value.kind !== 'render-result' || !isRecord(value.result)) return false;
  return typeof value.result.diagramType === 'string' && typeof value.result.svg === 'string';
}

function rendererState(iframe: HTMLIFrameElement): RendererRecoveryState {
  const current = rendererStates.get(iframe);
  if (current) return current;
  const created: RendererRecoveryState = {
    generation: 0,
    recovering: false,
    sourceToSkip: undefined,
  };
  rendererStates.set(iframe, created);
  return created;
}

function restartTimedOutRenderer(
  iframe: HTMLIFrameElement,
  generation: number,
  source: string,
): void {
  const state = rendererState(iframe);
  if (state.generation !== generation) return;
  const recoveredGeneration = generation + 1;
  state.generation = recoveredGeneration;
  state.recovering = true;
  state.sourceToSkip = source;
  iframe.addEventListener(
    'load',
    () => {
      const current = rendererState(iframe);
      if (current.generation === recoveredGeneration) current.recovering = false;
    },
    { once: true },
  );
  iframe.srcdoc = createPreviewRendererDocument();
}

export function renderPreviewInFrame(
  iframe: HTMLIFrameElement,
  options: PreviewRenderOptions,
): Promise<PreviewRenderResult> {
  const state = rendererState(iframe);
  if (state.recovering) {
    return Promise.reject(new Error(RENDER_TIMEOUT_MESSAGE));
  }
  if (state.sourceToSkip === options.source) {
    state.sourceToSkip = undefined;
    return Promise.reject(new Error(RENDER_TIMEOUT_MESSAGE));
  }
  state.sourceToSkip = undefined;
  const rendererWindow = iframe.contentWindow;
  if (!rendererWindow) return Promise.reject(new Error('The Mermaid renderer is not available.'));
  const rendererGeneration = state.generation;

  const requestId = `preview-${Date.now()}-${++requestSequence}`;
  const request: PreviewRenderRequest = {
    channel: PREVIEW_RENDERER_CHANNEL,
    kind: 'render',
    options,
    requestId,
  };

  return new Promise((resolve, reject) => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== rendererWindow || event.origin !== 'null') return;
      if (!isRenderResponse(event.data) || event.data.requestId !== requestId) return;
      cleanUp();
      if (event.data.kind === 'render-error') reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    const cleanUp = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
    const timeout = window.setTimeout(() => {
      cleanUp();
      restartTimedOutRenderer(iframe, rendererGeneration, options.source);
      reject(new Error(RENDER_TIMEOUT_MESSAGE));
    }, RENDER_TIMEOUT_MS);

    window.addEventListener('message', receive);
    rendererWindow.postMessage(request, '*');
  });
}
