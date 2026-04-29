import * as Phaser from "phaser";
import { generateTileset } from "../utils/tilesetGenerator";
import { SimpleSprite } from "../entities/SimpleSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";

const TILESET_KEYS = [
  "SCTileGrass",
  "SCBuildSTEarn",
  "SCBuildMonkeyDAO",
  "SCBuildSTBrazil",
  "SCBuildJupter",
  "SCTileFountain",
  "SCTileGround",
  "SCNPCAlien",
];

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (file.key.startsWith("avatar-")) {
        console.info(`[BootScene] ${file.key} not present — fallback active`);
        this.textures.remove(file.key);
      }
      if (file.key === "city-map") {
        console.error("[BootScene] city.json failed to load");
      }
    });

    // Tiled map JSON with embedded tileset metadata
    this.load.tilemapTiledJSON("city-map", "assets/maps/city.json");

    // Tileset spritesheet PNGs
    for (const key of TILESET_KEYS) {
      this.load.image(key, `assets/tilesets/${key}.png`);
    }

    // Player sprite
    SimpleSprite.load(this, "avatar-player", "assets/sprites/player.png", 64, 64);

    // NPC sprites
    for (const npc of NPC_REGISTRY) {
      if (!npc.spriteKey) continue;
      const filename = npc.spriteKey.replace(/^avatar-/, "");
      SimpleSprite.load(this, npc.spriteKey, `assets/sprites/${filename}.png`, 64, 64);
    }
  }

  create(): void {
    generateTileset(this); // procedural tileset kept as fallback texture
    this.scene.start("CityScene");
  }
}
