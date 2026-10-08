/**
 * Minimal types for pngjs.
 *
 * pngjs ships no types and `@types/pngjs` is not installed. It was only ever
 * used from the untyped build scripts under apps/web/scripts until
 * hairPalette.test.ts became the first TypeScript consumer, so this declares
 * just the synchronous reader that test needs rather than pulling in a
 * dependency for one call.
 */
declare module "pngjs" {
  export interface PNGData {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel, row major. */
    data: Buffer;
  }
  export const PNG: {
    sync: {
      read(buffer: Buffer): PNGData;
      write(png: PNGData): Buffer;
    };
  };
}
