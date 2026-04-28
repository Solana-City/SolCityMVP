import * as Phaser from "phaser";
import { TiledMapDefinition, MapLayerConfig } from "../config/mapRegistry";
import { TILE_SIZE } from "../config/constants";

export interface LoadedMap {
  tilemap: Phaser.Tilemaps.Tilemap;
  layers: Map<string, Phaser.Tilemaps.TilemapLayer>;
  widthPx: number;
  heightPx: number;
  spawnX: number;
  spawnY: number;
}

/**
 * Preloads all assets needed for a map definition.
 * Call this in a scene's preload() method.
 */
export function preloadMap(scene: Phaser.Scene, def: TiledMapDefinition): void {
  scene.load.tilemapTiledJSON(def.id, def.jsonPath);
  for (const ts of def.tilesets) {
    scene.load.image(ts.name, ts.imagePath);
  }
}

/**
 * Builds a Phaser tilemap from a loaded Tiled JSON.
 * Returns the tilemap, all named layers, and pixel dimensions.
 * Call this in a scene's create() method after preloading.
 */
export function buildMap(scene: Phaser.Scene, def: TiledMapDefinition): LoadedMap {
  const tilemap = scene.make.tilemap({ key: def.id });

  // Add all tilesets
  const tilesets: Phaser.Tilemaps.Tileset[] = [];
  for (const ts of def.tilesets) {
    const added = tilemap.addTilesetImage(
      ts.name,
      ts.name,
      ts.tileWidth,
      ts.tileHeight,
      ts.margin ?? 0,
      ts.spacing ?? 0
    );
    if (added) tilesets.push(added);
  }

  // Create layers based on registry config
  const layers = new Map<string, Phaser.Tilemaps.TilemapLayer>();

  for (const layerCfg of def.layers) {
    // zones layer may be an object layer, skip tilemap creation for it
    if (layerCfg.type === "zones") continue;

    const layer = tilemap.createLayer(layerCfg.name, tilesets, 0, 0);
    if (!layer) continue;

    layer.setVisible(layerCfg.visible !== false);

    if (layerCfg.depth !== undefined) {
      layer.setDepth(layerCfg.depth);
    }

    // Collision layer: mark all non-empty tiles as collidable
    if (layerCfg.type === "collision") {
      layer.setCollisionByExclusion([-1]);
    }

    layers.set(layerCfg.name, layer);
  }

  const widthPx = tilemap.widthInPixels;
  const heightPx = tilemap.heightInPixels;
  const spawnX = def.spawnPoint.x * TILE_SIZE + TILE_SIZE / 2;
  const spawnY = def.spawnPoint.y * TILE_SIZE + TILE_SIZE / 2;

  return { tilemap, layers, widthPx, heightPx, spawnX, spawnY };
}

/**
 * Reads object layer "zones" from the tilemap for NPC placement,
 * portals, and trigger areas.
 *
 * In Tiled, create an Object Layer named "zones".
 * Add Rectangle objects with a custom property "type" = "npc" | "portal" | "trigger"
 * and any extra properties (npcId, targetMap, etc).
 */
export function getZoneObjects(
  tilemap: Phaser.Tilemaps.Tilemap,
  layerName = "zones"
): Phaser.Types.Tilemaps.TiledObject[] {
  const objectLayer = tilemap.getObjectLayer(layerName);
  if (!objectLayer) return [];
  return objectLayer.objects;
}
