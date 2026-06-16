import * as Phaser from "phaser";
import { generateTileset } from "../utils/tilesetGenerator";
import { SimpleSprite } from "../entities/SimpleSprite";
import { AvatarSprite } from "../entities/AvatarSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";
import { getAllLayerVariants } from "../config/paperDoll";

const TILESET_KEYS = [
  "SCTileGrass",
  "SCBuildSTEarn",
  "SCBuildMonkeyDAO",
  "SCBuildSTBrazil",
  "SCBuildJupter",
  "SCTileFountain",
  "SCTileGround",
  "SCVegetationSet",
  "SCPalm",
  "SCBuildIndies",
  "SCUrbanEquipament",
  "SCBuildGenericBuild",
  "SCBuildKeepGreen",
  "SCBuildMagicBlock",
  "SCLogoIcon",
  "SCGameAssets",
];

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (
        file.key.startsWith("avatar-") ||
        file.key.startsWith("pd-") ||
        NPC_REGISTRY.some(n => n.spriteKey === file.key)
      ) {
        console.info(`[BootScene] ${file.key} not present — fallback active`);
        this.textures.remove(file.key);
      }
      if (file.key === "city-map") {
        console.error("[BootScene] city.json failed to load");
      }
      if (["SCBuildGenericBuild", "SCBuildKeepGreen", "SCBuildMagicBlock"].includes(file.key)) {
        console.warn(`[BootScene] ${file.key}.png missing — add to public/assets/tilesets/`);
      }
    });

    // Tiled map JSON with embedded tileset metadata
    this.load.tilemapTiledJSON("city-map", "assets/maps/city.json");

    // Tileset spritesheet PNGs
    for (const key of TILESET_KEYS) {
      this.load.image(key, `assets/tilesets/${key}.png`);
    }

    // Player sprite
    SimpleSprite.load(this, "avatar-player", "assets/sprites/main_char.png", 64, 64);

    // NPC sprites — all use spritesheets (same 64×64 frame format as the player).
    // spriteKey is either the character's display name (e.g. "Sushi Man")
    // or a legacy "avatar-*" key for older NPCs.
    const loadedKeys = new Set<string>();
    for (const npc of NPC_REGISTRY) {
      if (!npc.spriteKey || loadedKeys.has(npc.spriteKey)) continue;
      loadedKeys.add(npc.spriteKey);
      const filename = npc.spriteKey.startsWith("avatar-")
        ? npc.spriteKey.replace(/^avatar-/, "")
        : npc.spriteKey.replace(/ /g, "%20");
      SimpleSprite.load(this, npc.spriteKey, `assets/sprites/${filename}.png`, 64, 64);
    }

    // Paper doll layers — each category/variant is its own 64x64 spritesheet.
    // Drop the spriter's files into public/assets/sprites/paperdoll/ matching
    // each variant's `file` path; missing layers are skipped at render time.
    for (const { variant } of getAllLayerVariants()) {
      AvatarSprite.loadSpriteSheet(this, variant.textureKey, `assets/sprites/paperdoll/${variant.file}`);
    }
  }

  create(): void {
    generateTileset(this); // procedural tileset kept as fallback texture
    this.scene.start("CityScene");
  }
}
