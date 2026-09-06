import type { MotionViewportDimensions } from '@mermotion/engine';

const GIF_FRAME_RATE = 20;
const GIF_WIDTH = 960;
export const MAX_GIF_FRAMES = 600;
export const MAX_GIF_HOLD_MS = 655_350;

const minGifDelayMs = 10;
const maxGifDimension = 2_400;
const maxGifPixelFrames = 120_000_000;

interface GifFrame {
  delayMs: number;
  timeMs: number;
}

export interface GifFramePlan {
  frames: GifFrame[];
  playbackMs: number;
}

export type GifDimensions = MotionViewportDimensions;

function quantizedDelay(milliseconds: number): number {
  return Math.min(MAX_GIF_HOLD_MS, Math.max(minGifDelayMs, Math.round(milliseconds / 10) * 10));
}

export function createGifFramePlan(durationMs: number, endPauseMs: number): GifFramePlan {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error('GIF duration must be a non-negative finite number.');
  }
  if (!Number.isFinite(endPauseMs) || endPauseMs < 0 || endPauseMs > MAX_GIF_HOLD_MS) {
    throw new Error('GIF end pause is outside the supported range.');
  }

  const intervalMs = 1_000 / GIF_FRAME_RATE;
  const times = [0];
  for (let timeMs = intervalMs; timeMs < durationMs; timeMs += intervalMs) {
    if (durationMs - timeMs < minGifDelayMs) continue;
    assertFrameLimit(times.length);
    times.push(timeMs);
  }
  if (durationMs > 0 && times.at(-1) !== durationMs) {
    assertFrameLimit(times.length);
    times.push(durationMs);
  }

  const frames = times.map((timeMs, index): GifFrame => {
    const nextTimeMs = times[index + 1];
    return {
      delayMs:
        nextTimeMs === undefined
          ? quantizedDelay(endPauseMs || minGifDelayMs)
          : quantizedDelay(nextTimeMs - timeMs),
      timeMs,
    };
  });
  return {
    frames,
    playbackMs: frames.reduce((total, frame) => total + frame.delayMs, 0),
  };
}

function assertFrameLimit(frameCount: number): void {
  if (frameCount >= MAX_GIF_FRAMES) {
    throw new Error(
      `This export exceeds ${MAX_GIF_FRAMES} frames. Shorten the animation before exporting it.`,
    );
  }
}

export function fitGifDimensions(viewBoxWidth: number, viewBoxHeight: number): GifDimensions {
  if (
    !Number.isFinite(viewBoxWidth) ||
    !Number.isFinite(viewBoxHeight) ||
    viewBoxWidth <= 0 ||
    viewBoxHeight <= 0
  ) {
    throw new Error('The rendered diagram has no exportable dimensions.');
  }

  const requestedHeight = Math.max(1, Math.round((GIF_WIDTH * viewBoxHeight) / viewBoxWidth));
  if (requestedHeight <= maxGifDimension) {
    return { height: requestedHeight, width: GIF_WIDTH };
  }
  const scale = maxGifDimension / requestedHeight;
  return {
    height: maxGifDimension,
    width: Math.max(1, Math.round(GIF_WIDTH * scale)),
  };
}

export function validateGifWorkload(dimensions: GifDimensions, frameCount: number): void {
  const pixelFrames = dimensions.width * dimensions.height * frameCount;
  if (!Number.isSafeInteger(pixelFrames) || pixelFrames > maxGifPixelFrames) {
    throw new Error('This GIF is too large to render locally. Shorten the animation and retry.');
  }
}

export function gifRepeatCount(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'forever') return 0;
  if (normalized === 'once') return -1;

  const totalPlays = Number(normalized);
  if (
    !/^\d+$/.test(normalized) ||
    !Number.isInteger(totalPlays) ||
    totalPlays < 1 ||
    totalPlays > 65_536
  ) {
    throw new Error('GIF loop must be "forever", "once", or a total play count from 1 to 65,536.');
  }
  return totalPlays === 1 ? -1 : totalPlays - 1;
}
