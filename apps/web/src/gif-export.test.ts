import { describe, expect, it, vi } from 'vitest';

import {
  createGifFrameEncoder,
  createGifFramePlan,
  encodeGifFrames,
  fitGifDimensions,
  gifRepeatCount,
  validateGifWorkload,
} from './gif-export';

interface ParsedGif {
  delays: number[];
  frames: number;
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

function parseGif(bytes: Uint8Array): ParsedGif {
  expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
  const width = readUint16(bytes, 6);
  const height = readUint16(bytes, 8);
  const packed = bytes[10] ?? 0;
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1);

  const delays: number[] = [];
  let frames = 0;
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
        const blockSize = bytes[offset++] ?? 0;
        expect(blockSize).toBe(4);
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
      } else offset = skipSubBlocks(bytes, offset);
      continue;
    }
    if (marker !== 0x2c) throw new Error(`Unexpected GIF block 0x${marker?.toString(16)}`);
    frames += 1;
    offset += 8;
    const imagePacked = bytes[offset++] ?? 0;
    if ((imagePacked & 0x80) !== 0) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    offset += 1;
    offset = skipSubBlocks(bytes, offset);
  }

  return { delays, frames, height, ...(repeat === undefined ? {} : { repeat }), trailer, width };
}

describe('GIF frame planning', () => {
  it('samples the start, cadence, and exact terminal frame', () => {
    expect(createGifFramePlan(120, 20, 500)).toEqual({
      frames: [
        { delayMs: 50, timeMs: 0 },
        { delayMs: 50, timeMs: 50 },
        { delayMs: 20, timeMs: 100 },
        { delayMs: 500, timeMs: 120 },
      ],
      playbackMs: 620,
    });
  });

  it.each([104, 105, 109, 110])('never emits a zero-tick delay for %sms', (durationMs) => {
    const plan = createGifFramePlan(durationMs, 20, 0);
    expect(plan.frames.at(-1)?.timeMs).toBe(durationMs);
    expect(plan.frames.every(({ delayMs }) => delayMs >= 10 && delayMs % 10 === 0)).toBe(true);
  });

  it('creates one valid frame for a zero-duration timeline', () => {
    expect(createGifFramePlan(0, 20, 0)).toEqual({
      frames: [{ delayMs: 10, timeMs: 0 }],
      playbackMs: 10,
    });
  });

  it('rejects an export that would create too many frames', () => {
    expect(() => createGifFramePlan(60_000, 20, 0)).toThrow(/exceeds 600/);
  });

  it('rejects enormous durations without materializing their frame schedule', () => {
    expect(() => createGifFramePlan(1_000_000_000_000_000, 25, 0)).toThrow(/exceeds 600/);
  });

  it('fits tall diagrams inside the encoder limit without changing aspect ratio', () => {
    expect(fitGifDimensions(100, 400, 960)).toEqual({ height: 2_400, width: 600 });
  });

  it('rejects a combined frame and pixel workload that could overwhelm the tab', () => {
    expect(() => validateGifWorkload({ height: 2_400, width: 1_280 }, 600)).toThrow(
      /too large for a browser tab/,
    );
    expect(() => validateGifWorkload({ height: 720, width: 1_280 }, 100)).not.toThrow();
  });
});

describe('GIF encoding', () => {
  const black = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
  const white = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);

  it.each([
    ['forever', 0, 0],
    ['once', 1, -1],
    ['count', 3, 2],
  ] as const)('writes %s loop metadata', (loopMode, playCount, expectedRepeat) => {
    const encoder = createGifFrameEncoder(2, 1, gifRepeatCount(loopMode, playCount));
    encoder.writeFrame(black, 50);
    encoder.writeFrame(white, 500);
    const parsed = parseGif(encoder.finish());

    expect(parsed).toEqual({
      delays: [5, 50],
      frames: 2,
      height: 1,
      ...(expectedRepeat < 0 ? {} : { repeat: expectedRepeat }),
      trailer: true,
      width: 2,
    });
  });

  it('maps total plays to the Netscape extra-iteration count', () => {
    expect(gifRepeatCount('forever', 3)).toBe(0);
    expect(gifRepeatCount('once', 3)).toBe(-1);
    expect(gifRepeatCount('count', 3)).toBe(2);
    expect(() => gifRepeatCount('count', 1)).toThrow(/from 2/);
  });

  it('captures every planned time in order and reports monotonic progress', async () => {
    const plan = createGifFramePlan(120, 20, 0);
    const times: number[] = [];
    const progress: number[] = [];
    const writeFrame = vi.fn();
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await encodeGifFrames(
      plan,
      async (timeMs) => {
        times.push(timeMs);
        return black;
      },
      { finish: () => bytes, writeFrame },
      {
        onProgress: ({ completedFrames }) => progress.push(completedFrames),
        signal: new AbortController().signal,
      },
    );

    expect(times).toEqual([0, 50, 100, 120]);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(writeFrame).toHaveBeenCalledTimes(4);
    expect(result).toBe(bytes);
  });

  it('stops before writing an aborted capture', async () => {
    const controller = new AbortController();
    const writeFrame = vi.fn();
    const finish = vi.fn(() => new Uint8Array());
    const capture = vi.fn(async () => {
      controller.abort();
      return black;
    });

    await expect(
      encodeGifFrames(
        createGifFramePlan(100, 20, 0),
        capture,
        { finish, writeFrame },
        {
          onProgress: vi.fn(),
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(writeFrame).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });
});
