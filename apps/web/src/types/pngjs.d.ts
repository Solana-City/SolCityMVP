/**
 * Minimal types for pngjs.
 *
 * pngjs ships no types and `@types/pngjs` is not installed. It was only ever
 * used from the untyped build scripts under apps/web/scripts until
 * hairPalette.test.ts became the first TypeScript consumer, so this declared
 * just the synchronous reader that test needed rather than pulling in a
 * dependency for one call.
 *
 * build-collectible-art.ts is the second, and it WRITES: `PNG.sync.write`
 * wants a real PNG, so the class itself is declared now. Still only the two
 * things that are actually called.
 */
declare module "pngjs" {
  export interface PNGData {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel, row major. */
    data: Buffer;
  }
  export class PNG implements PNGData {
    constructor(options?: { width?: number; height?: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer): PNGData;
      write(png: PNGData): Buffer;
    };
  }
}
