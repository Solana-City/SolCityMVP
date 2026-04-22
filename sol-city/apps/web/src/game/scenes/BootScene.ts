import Phaser from "phaser";
import { generateTileset } from "../utils/tilesetGenerator";
import { SimpleSprite } from "../entities/SimpleSprite";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    SimpleSprite.load(this, "avatar-orc", "assets/sprites/orc.png", 48, 48);
    SimpleSprite.load(this, "avatar-chef", "assets/sprites/chef.png", 48, 48);
  }

  create(): void {
    generateTileset(this);
    this.scene.start("CityScene");
  }
}
