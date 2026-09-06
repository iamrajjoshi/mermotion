declare module 'gifenc' {
  export type GifRgbColor = [red: number, green: number, blue: number];
  export type GifRgbaColor = [red: number, green: number, blue: number, alpha: number];
  export type GifPalette = Array<GifRgbColor | GifRgbaColor>;

  export interface GifWriteFrameOptions {
    delay?: number;
    dispose?: number;
    palette: GifPalette;
    repeat?: number;
  }

  export interface GifEncoder {
    bytes(): Uint8Array;
    finish(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: GifWriteFrameOptions,
    ): void;
  }

  export function GIFEncoder(options?: { initialCapacity?: number }): GifEncoder;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: 'rgb444' | 'rgb565' | 'rgba4444',
  ): Uint8Array;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: 'rgb444' | 'rgb565' | 'rgba4444' },
  ): GifPalette;
}
