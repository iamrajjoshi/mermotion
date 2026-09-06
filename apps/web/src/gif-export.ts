import type { MotionViewportDimensions } from '@mermotion/engine';
import { GIFEncoder, applyPalette, quantize, type GifEncoder } from 'gifenc';

import type { SceneSources } from './scenes';

export const GIF_FRAME_RATES = [10, 20, 25] as const;
export const GIF_WIDTHS = [640, 960, 1_280] as const;
const MAX_GIF_FRAMES = 600;
const MAX_GIF_PIXEL_FRAMES = 120_000_000;

export type GifFrameRate = (typeof GIF_FRAME_RATES)[number];
export type GifLoopMode = 'count' | 'forever' | 'once';
export type GifWidth = (typeof GIF_WIDTHS)[number];

export interface GifExportSettings {
  endPauseMs: number;
  frameRate: GifFrameRate;
  loopMode: GifLoopMode;
  playCount: number;
  width: GifWidth;
}

interface GifExportControl {
  onProgress: (progress: GifExportProgress) => void;
  signal: AbortSignal;
}

export type GifExporter = (
  settings: GifExportSettings,
  control: GifExportControl,
) => Promise<GifExportResult>;

export interface GifExportInfo extends SceneSources {
  durationMs: number;
  viewBoxHeight: number;
  viewBoxWidth: number;
}

interface GifFrameSpec {
  delayMs: number;
  timeMs: number;
}

export interface GifFramePlan {
  frames: GifFrameSpec[];
  playbackMs: number;
}

export type GifDimensions = MotionViewportDimensions;

export interface GifExportProgress {
  completedFrames: number;
  totalFrames: number;
}

export interface GifExportResult extends GifDimensions {
  bytes: Uint8Array;
  frameCount: number;
  playbackMs: number;
}

export interface GifFrameEncoder {
  finish(): Uint8Array;
  writeFrame(rgba: Uint8ClampedArray, delayMs: number): void;
}

const MIN_GIF_DELAY_MS = 10;
const MAX_GIF_DELAY_MS = 655_350;
const MAX_GIF_DIMENSION = 2_400;

function quantizedDelay(milliseconds: number): number {
  return Math.min(MAX_GIF_DELAY_MS, Math.max(MIN_GIF_DELAY_MS, Math.round(milliseconds / 10) * 10));
}

function validateDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error('GIF duration must be a non-negative finite number.');
  }
}

export function createGifFramePlan(
  durationMs: number,
  frameRate: GifFrameRate,
  endPauseMs: number,
): GifFramePlan {
  validateDuration(durationMs);
  if (!GIF_FRAME_RATES.includes(frameRate)) throw new Error('Unsupported GIF frame rate.');
  if (!Number.isFinite(endPauseMs) || endPauseMs < 0 || endPauseMs > MAX_GIF_DELAY_MS) {
    throw new Error('GIF end pause is outside the supported range.');
  }

  const intervalMs = 1_000 / frameRate;
  const times = [0];
  for (let timeMs = intervalMs; timeMs < durationMs; timeMs += intervalMs) {
    if (durationMs - timeMs < MIN_GIF_DELAY_MS) continue;
    if (times.length >= MAX_GIF_FRAMES) {
      throw new Error(
        `This export exceeds ${MAX_GIF_FRAMES} frames. Shorten the animation or lower the frame rate.`,
      );
    }
    times.push(timeMs);
  }
  if (durationMs > 0 && times.at(-1) !== durationMs) {
    if (times.length >= MAX_GIF_FRAMES) {
      throw new Error(
        `This export exceeds ${MAX_GIF_FRAMES} frames. Shorten the animation or lower the frame rate.`,
      );
    }
    times.push(durationMs);
  }

  const frames = times.map((timeMs, index): GifFrameSpec => {
    const nextTime = times[index + 1];
    return {
      delayMs:
        nextTime === undefined
          ? quantizedDelay(endPauseMs || MIN_GIF_DELAY_MS)
          : quantizedDelay(nextTime - timeMs),
      timeMs,
    };
  });
  return {
    frames,
    playbackMs: frames.reduce((total, frame) => total + frame.delayMs, 0),
  };
}

export function gifRepeatCount(loopMode: GifLoopMode, playCount: number): number {
  if (loopMode === 'once') return -1;
  if (loopMode === 'forever') return 0;
  if (!Number.isInteger(playCount) || playCount < 2 || playCount > 65_536) {
    throw new Error('GIF play count must be an integer from 2 to 65,536.');
  }
  return playCount - 1;
}

export function fitGifDimensions(
  viewBoxWidth: number,
  viewBoxHeight: number,
  requestedWidth: GifWidth,
): GifDimensions {
  if (
    !Number.isFinite(viewBoxWidth) ||
    !Number.isFinite(viewBoxHeight) ||
    viewBoxWidth <= 0 ||
    viewBoxHeight <= 0
  ) {
    throw new Error('The rendered diagram has no exportable dimensions.');
  }
  if (!GIF_WIDTHS.includes(requestedWidth)) throw new Error('Unsupported GIF width.');

  const requestedHeight = Math.max(1, Math.round((requestedWidth * viewBoxHeight) / viewBoxWidth));
  if (requestedHeight <= MAX_GIF_DIMENSION) {
    return { height: requestedHeight, width: requestedWidth };
  }
  const scale = MAX_GIF_DIMENSION / requestedHeight;
  return {
    height: MAX_GIF_DIMENSION,
    width: Math.max(1, Math.round(requestedWidth * scale)),
  };
}

export function validateGifWorkload(dimensions: GifDimensions, frameCount: number): void {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error('A GIF needs at least one planned frame.');
  }
  const pixelFrames = dimensions.width * dimensions.height * frameCount;
  if (!Number.isSafeInteger(pixelFrames) || pixelFrames > MAX_GIF_PIXEL_FRAMES) {
    throw new Error(
      'This export is too large for a browser tab. Lower the width or frame rate, or shorten the animation.',
    );
  }
}

export function createGifFrameEncoder(
  width: number,
  height: number,
  repeat: number,
  encoder: GifEncoder = GIFEncoder(),
): GifFrameEncoder {
  let frameCount = 0;
  return {
    finish() {
      if (frameCount === 0) throw new Error('A GIF needs at least one frame.');
      encoder.finish();
      return encoder.bytes();
    },
    writeFrame(rgba, delayMs) {
      if (rgba.length !== width * height * 4) {
        throw new Error('GIF frame dimensions do not match the encoder.');
      }
      const palette = quantize(rgba, 256, { format: 'rgb565' });
      const index = applyPalette(rgba, palette, 'rgb565');
      encoder.writeFrame(index, width, height, {
        delay: quantizedDelay(delayMs),
        dispose: 1,
        palette,
        ...(frameCount === 0 ? { repeat } : {}),
      });
      frameCount += 1;
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('GIF export canceled.', 'AbortError');
}

export async function encodeGifFrames(
  plan: GifFramePlan,
  capture: (timeMs: number) => Promise<Uint8ClampedArray>,
  encoder: GifFrameEncoder,
  options: {
    onProgress: (progress: GifExportProgress) => void;
    signal: AbortSignal;
    yieldControl?: () => Promise<void>;
  },
): Promise<Uint8Array> {
  const yieldControl = options.yieldControl ?? (() => Promise.resolve());
  for (const [index, frame] of plan.frames.entries()) {
    throwIfAborted(options.signal);
    // Frame capture is intentionally serial: each sample updates and reads the same SVG/canvas.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const rgba = await capture(frame.timeMs);
    throwIfAborted(options.signal);
    encoder.writeFrame(rgba, frame.delayMs);
    options.onProgress({ completedFrames: index + 1, totalFrames: plan.frames.length });
    // Yield between frames so the panel can paint progress and respond to cancellation.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await yieldControl();
  }
  throwIfAborted(options.signal);
  return encoder.finish();
}
