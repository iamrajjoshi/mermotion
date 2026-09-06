import type { MermaidRenderOptions, RenderedMermaid } from '@mermotion/engine';

export const PREVIEW_RENDERER_CHANNEL = 'mermotion.preview.v1';

export type PreviewRenderOptions = Required<Pick<MermaidRenderOptions, 'id' | 'source'>>;

export type PreviewRenderResult = Pick<RenderedMermaid, 'diagramType' | 'svg'>;

interface PreviewRendererMessage {
  channel: typeof PREVIEW_RENDERER_CHANNEL;
  requestId: string;
}

export interface PreviewRenderRequest extends PreviewRendererMessage {
  kind: 'render';
  options: PreviewRenderOptions;
}

export interface PreviewRenderSuccess extends PreviewRendererMessage {
  kind: 'render-result';
  result: PreviewRenderResult;
}

export interface PreviewRenderFailure extends PreviewRendererMessage {
  error: string;
  kind: 'render-error';
}

export type PreviewRenderResponse = PreviewRenderSuccess | PreviewRenderFailure;
