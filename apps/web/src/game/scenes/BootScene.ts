import Phaser from "phaser";
import { generateTileset } from "../utils/tilesetGenerator";
import { generateAllPlaceholders } from "../utils/placeholderSprites";
import { getAllLayerKeys } from "../config/outfitRegistry";
import { AvatarSprite } from "../entities/AvatarSprite";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    // When real Tiled maps exist, preload them here:
    // import { preloadMap } from "../utils/mapLoader";
    // import { getMapDef } from "../config/mapRegistry";
    // const def = getMapDef("city-main");
    // if (def) preloadMap(this, def);

    // When real sprite PNGs exist, load them here:
    // for (const key of getAllLayerKeys()) {
    //   AvatarSprite.loadSpriteSheet(this, key, `assets/sprites/${key}.png`);
    // }
  }

  create(): void {
    // Programmatic tileset (used until Tiled map is ready)
    generateTileset(this);

    // Placeholder sprite sheets (used until Aseprite art is ready)
    generateAllPlaceholders(this);

    this.scene.start("CityScene");
  }
}
