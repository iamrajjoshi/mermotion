import type { Diagnostic, DiagramDocument, MotionViewportDimensions } from '@mermotion/engine';

export type BrowserRenderSource = DiagramDocument;

export interface BrowserFrameRequest extends BrowserRenderSource {
  timeMs: number;
}

export interface BrowserGifRequest extends BrowserRenderSource {
  endPauseMs: number;
  repeat: number;
}

export interface BrowserRenderMetadata {
  diagramType: string;
  targetCount: number;
  durationMs: number | null;
  diagnostics: Diagnostic[];
}

export interface AnimationRenderResult extends MotionViewportDimensions {
  frameCount: number;
  playbackMs: number;
}

export interface BrowserFrameResult extends BrowserRenderMetadata {
  svg: string;
}

export interface BrowserGifResult extends BrowserRenderMetadata {
  animation: AnimationRenderResult | null;
  bytes: Uint8Array;
}

export interface BrowserRendererApi {
  mermotionRenderFrame(request: BrowserFrameRequest): Promise<BrowserFrameResult>;
  mermotionRenderGif(request: BrowserGifRequest): Promise<BrowserGifResult>;
}
