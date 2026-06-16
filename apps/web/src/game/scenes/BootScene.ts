import * as Phaser from "phaser";
import { generateTileset } from "../utils/tilesetGenerator";
import { SimpleSprite } from "../entities/SimpleSprite";
import { AvatarSprite } from "../entities/AvatarSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";
import { getAllLayerVariants, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT } from "../config/paperDoll";

// Background color used in the spriter's sheets — treated as transparent.
const CHROMA_R = 215;
const CHROMA_G = 123;
const CHROMA_B = 186;
const CHROMA_TOLERANCE = 30;

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

    this.load.tilemapTiledJSON("city-map", "assets/maps/city.json");

    for (const key of TILESET_KEYS) {
      this.load.image(key, `assets/tilesets/${key}.png`);
    }

    SimpleSprite.load(this, "avatar-player", "assets/sprites/main_char.png", 64, 64);

    const loadedKeys = new Set<string>();
    for (const npc of NPC_REGISTRY) {
      if (!npc.spriteKey || loadedKeys.has(npc.spriteKey)) continue;
      loadedKeys.add(npc.spriteKey);
      const filename = npc.spriteKey.startsWith("avatar-")
        ? npc.spriteKey.replace(/^avatar-/, "")
        : npc.spriteKey.replace(/ /g, "%20");
      SimpleSprite.load(this, npc.spriteKey, `assets/sprites/${filename}.png`, 64, 64);
    }

    for (const { variant } of getAllLayerVariants()) {
      AvatarSprite.loadSpriteSheet(this, variant.textureKey, `assets/sprites/paperdoll/${variant.file}`);
    }
  }

  create(): void {
    generateTileset(this);

    // Apply chroma key to all paper doll layers — removes the pink background
    // (rgb 215,123,186) so layers composite transparently over each other.
    for (const { variant } of getAllLayerVariants()) {
      if (this.textures.exists(variant.textureKey)) {
        applyChromaKey(this, variant.textureKey);
      }
    }

    this.scene.start("CityScene");
  }
}

/**
 * Replaces a loaded spritesheet texture with a canvas copy that has the
 * chroma-key color removed (set to alpha 0). Re-registers frame data so
 * Phaser treats it identically to the original spritesheet.
 */
function applyChromaKey(scene: Phaser.Scene, key: string): void {
  const texture = scene.textures.get(key);
  const source = texture.source[0];
  const img = source.image as HTMLImageElement;

  const w = source.width;
  const h = source.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.abs(data[i]     - CHROMA_R) <= CHROMA_TOLERANCE &&
      Math.abs(data[i + 1] - CHROMA_G) <= CHROMA_TOLERANCE &&
      Math.abs(data[i + 2] - CHROMA_B) <= CHROMA_TOLERANCE
    ) {
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  scene.textures.remove(key);
  const newTex = scene.textures.addCanvas(key, canvas);
  (Phaser.Textures.Parsers as any).SpriteSheet(
    newTex, 0,
    0, 0, w, h,
    { frameWidth: SPRITE_FRAME_WIDTH, frameHeight: SPRITE_FRAME_HEIGHT }
  );
}
