import Phaser from "phaser";
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
    // Fallback sprites — always present in repo (48×48, 192×192 sheet).
    SimpleSprite.load(this, "avatar-orc", "assets/sprites/orc.png", 48, 48);
    SimpleSprite.load(this, "avatar-chef", "assets/sprites/chef.png", 48, 48);

    // Any sprite referenced below is loaded optionally — a missing file
    // triggers `loaderror`, we log it and remove the half-registered
    // texture so `textures.exists()` returns false and the runtime falls
    // back to chef gracefully.
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      if (file.key.startsWith("avatar-")) {
        console.info(`[BootScene] ${file.key} not present — fallback active`);
        this.textures.remove(file.key);
      }
    });

    // Player sprite
    for (const s of PLACEHOLDER_SPRITES) {
      SimpleSprite.load(this, s.key, s.path, 32, 32);
    }

    // NPC sprites — one per NPC in the registry that declares a spriteKey.
    for (const npc of NPC_REGISTRY) {
      if (!npc.spriteKey) continue;
      // Convention: spriteKey "avatar-{id}" ↔ file "assets/sprites/{id}.png"
      const filename = npc.spriteKey.replace(/^avatar-/, "");
      SimpleSprite.load(this, npc.spriteKey, `assets/sprites/${filename}.png`, 32, 32);
    }
  }

  create(): void {
    generateTileset(this);
    this.scene.start("CityScene");
  }
}
