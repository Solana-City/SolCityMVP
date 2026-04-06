export interface TiledMapDefinition {
  id: string;
  name: string;
  jsonPath: string;          // path relative to public/
  tilesets: TilesetRef[];
  spawnPoint: { x: number; y: number };
  layers: MapLayerConfig[];
}

export interface TilesetRef {
  name: string;              // must match the tileset name inside the .tmx/.json
  imagePath: string;         // path relative to public/
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
}

export interface MapLayerConfig {
  name: string;              // must match the layer name in Tiled
  type: "ground" | "decoration" | "collision" | "above" | "zones";
  visible?: boolean;         // defaults to true; collision/zones are hidden
  depth?: number;            // render order; higher = on top
}

/**
 * All maps registered in the game.
 * BootScene uses this to know what to preload.
 * CityScene uses this to build the world.
 *
 * Tiled workflow:
 *   1. Create map in Tiled (File > New Map, tile size 32x32)
 *   2. Add tileset image (Tileset > New Tileset, embed in map)
 *   3. Create layers matching the names below
 *   4. Export as JSON (File > Export As > .json)
 *   5. Save JSON to public/assets/maps/
 *   6. Save tileset PNGs to public/assets/tilesets/
 *   7. Register the map here
 */
export const MAP_REGISTRY: TiledMapDefinition[] = [
  {
    id: "city-main",
    name: "Sol City",
    jsonPath: "assets/maps/city-main.json",
    tilesets: [
      {
        name: "city-tiles",
        imagePath: "assets/tilesets/city-tiles.png",
        tileWidth: 32,
        tileHeight: 32,
      },
    ],
    spawnPoint: { x: 12, y: 8 },
    layers: [
      { name: "ground", type: "ground", depth: 0 },
      { name: "paths", type: "ground", depth: 1 },
      { name: "buildings", type: "decoration", depth: 2 },
      { name: "collision", type: "collision", visible: false },
      { name: "above", type: "above", depth: 10 },
      { name: "zones", type: "zones", visible: false },
    ],
  },
];

/**
 * Returns a map definition by ID.
 */
export function getMapDef(id: string): TiledMapDefinition | undefined {
  return MAP_REGISTRY.find((m) => m.id === id);
}

/**
 * Returns all unique tileset image paths that need preloading.
 */
export function getAllTilesetPaths(): { name: string; path: string }[] {
  const seen = new Set<string>();
  const result: { name: string; path: string }[] = [];
  for (const map of MAP_REGISTRY) {
    for (const ts of map.tilesets) {
      if (!seen.has(ts.imagePath)) {
        seen.add(ts.imagePath);
        result.push({ name: ts.name, path: ts.imagePath });
      }
    }
  }
  return result;
}
