import { neutralizeMermaidImageSources, renderMermaid } from '@mermotion/engine';
import {
  PREVIEW_RENDERER_CHANNEL,
  type PreviewRenderFailure,
  type PreviewRenderRequest,
  type PreviewRenderSuccess,
} from './preview-renderer-protocol';

let renderQueue = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    if (typeof error.message === 'string') return error.message;
    if (typeof error.str === 'string') return error.str;
  }
  return 'Mermaid could not render this diagram.';
}

function isRenderRequest(value: unknown): value is PreviewRenderRequest {
  if (!isRecord(value) || !isRecord(value.options)) return false;
  return (
    value.channel === PREVIEW_RENDERER_CHANNEL &&
    value.kind === 'render' &&
    typeof value.requestId === 'string' &&
    typeof value.options.id === 'string' &&
    typeof value.options.source === 'string'
  );
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !isRenderRequest(event.data)) return;
  const { options, requestId } = event.data;
  renderQueue = renderQueue.then(async () => {
    try {
      const { diagramType, svg } = await renderMermaid({
        ...options,
        source: neutralizeMermaidImageSources(options.source),
      });
      const response: PreviewRenderSuccess = {
        channel: PREVIEW_RENDERER_CHANNEL,
        kind: 'render-result',
        requestId,
        result: { diagramType, svg },
      };
      window.parent.postMessage(response, '*');
    } catch (error) {
      const response: PreviewRenderFailure = {
        channel: PREVIEW_RENDERER_CHANNEL,
        error: errorMessage(error),
        kind: 'render-error',
        requestId,
      };
      window.parent.postMessage(response, '*');
    }
  });
});
