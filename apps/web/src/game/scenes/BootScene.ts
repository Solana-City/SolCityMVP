import * as Phaser from "phaser";
import { generateTileset } from "../utils/tilesetGenerator";
import { SimpleSprite } from "../entities/SimpleSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";

/**
 * Pokemon-style placeholder sprites — all share the same format:
 *   256×256 PNG, 4×4 grid of 64×64 frames, rows = down/left/right/up.
 * Loaded as `avatar-{id}` where id matches the NPC's id (or "player" for
 * the local character). Missing files fall back to chef automatically via
 * the CityScene key check.
 */
const PLACEHOLDER_SPRITES = [
  { key: "avatar-player", path: "assets/sprites/player.png" },
  // NPC sprites are derived from NPC_REGISTRY.spriteKey below.
] as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    // Placeholder sprites and NPC sprites — all 64×64 native, no
    // preprocessed downscale. The loader handles missing files gracefully
    // via the loaderror event below; the runtime falls back to the player
    // sprite for NPCs whose individual sheets didn't ship.
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (file.key.startsWith("avatar-")) {
        console.info(`[BootScene] ${file.key} not present — fallback active`);
        this.textures.remove(file.key);
      }
    });

    // Player sprite
    for (const s of PLACEHOLDER_SPRITES) {
      SimpleSprite.load(this, s.key, s.path, 64, 64);
    }

    // NPC sprites — one per NPC in the registry that declares a spriteKey.
    for (const npc of NPC_REGISTRY) {
      if (!npc.spriteKey) continue;
      const filename = npc.spriteKey.replace(/^avatar-/, "");
      SimpleSprite.load(this, npc.spriteKey, `assets/sprites/${filename}.png`, 64, 64);
    }
  }

  create(): void {
    generateTileset(this);
    this.scene.start("CityScene");
  }
}
