import Phaser from "phaser";
import { generateTileset } from "../utils/tilesetGenerator";
import { generateAllPlaceholders } from "../utils/placeholderSprites";
import { SimpleSprite } from "../entities/SimpleSprite";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    // Load real sprite sheets (48x48 frames, 4x4 grid)
    SimpleSprite.load(this, "avatar-chef", "assets/sprites/chef.png", 48, 48);

    // Add more characters here as they become available:
    // SimpleSprite.load(this, "avatar-knight", "assets/sprites/knight.png", 48, 48);
    // SimpleSprite.load(this, "avatar-mage", "assets/sprites/mage.png", 48, 48);
  }

  create(): void {
    generateTileset(this);

    // Placeholder sprites still needed for the layered outfit system (kept for future use)
    generateAllPlaceholders(this);

    this.scene.start("CityScene");
  }
}
