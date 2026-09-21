/**
 * Crops every tile layer of a Tiled JSON map to the rectangle it actually
 * paints, before Phaser parses it.
 *
 * Phaser's Tiled parser creates a Tile object for EVERY cell of EVERY layer
 * the moment the tilemap is made — empty cells included, and before any of
 * our code runs. city.json is 116 layers of 135x115, so opening the city
 * allocated 1.8M Tile objects to describe 43k painted tiles; converting the
 * sparse layers afterwards (sparseLayer.ts) fixed the steady state but not
 * that spike, which is what the tab showed on load.
 *
 * A palm authored as a 135x115 layer comes out as a 3x3 layer sitting at the
 * same world position (the cropped-away margin moves into the layer's pixel
 * offset). Names, order, groups, tiles and positions are untouched, so every
 * rule that reads the layers — depth, y-sort, fade, collision — sees the same
 * thing it always did, just without the empty cells.
 *
 * Mutates and returns the map object. Anything unexpected (compressed or
 * base64 data, infinite maps) is left as it was.
 */

interface TiledLayer {
  type: string;
  name?: string;
  width?: number;
  height?: number;
  data?: unknown;
  offsetx?: number;
  offsety?: number;
  layers?: TiledLayer[];
}

interface TiledMap {
  infinite?: boolean;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
}

export interface CropReport {
  cellsBefore: number;
  cellsAfter: number;
}

export function cropTileLayers(map: TiledMap): CropReport {
  const report: CropReport = { cellsBefore: 0, cellsAfter: 0 };
  if (map.infinite) return report; // chunked data — nothing to crop this way

  const visit = (layers: TiledLayer[]) => {
    for (const layer of layers) {
      if (layer.type === "group" && layer.layers) { visit(layer.layers); continue; }
      if (layer.type !== "tilelayer" || !Array.isArray(layer.data)) continue;
      const w = layer.width ?? 0;
      const h = layer.height ?? 0;
      const data = layer.data as number[];
      if (w * h !== data.length || w === 0) continue;
      report.cellsBefore += w * h;

      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let i = 0; i < data.length; i++) {
        if (!data[i]) continue;
        const x = i % w;
        const y = (i - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      if (maxX < 0) {
        // Nothing painted: keep the layer (the rules look layers up by name)
        // as a single empty cell.
        layer.data = [0];
        layer.width = 1;
        layer.height = 1;
        report.cellsAfter += 1;
        continue;
      }

      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;
      if (cw === w && ch === h) { report.cellsAfter += w * h; continue; }

      const cropped = new Array<number>(cw * ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          cropped[y * cw + x] = data[(y + minY) * w + (x + minX)];
        }
      }
      layer.data = cropped;
      layer.width = cw;
      layer.height = ch;
      // The margin that was cut away becomes offset, so every tile keeps its
      // world position. Whole tiles only, so the merge passes still accept it.
      layer.offsetx = (layer.offsetx ?? 0) + minX * map.tilewidth;
      layer.offsety = (layer.offsety ?? 0) + minY * map.tileheight;
      report.cellsAfter += cw * ch;
    }
  };

  visit(map.layers);
  return report;
}
