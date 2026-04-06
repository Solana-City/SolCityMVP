import Phaser from "phaser";
import {
  SPRITE_FRAME_WIDTH,
  SPRITE_FRAME_HEIGHT,
  SPRITE_COLS,
  SPRITE_ROWS,
} from "../config/outfitRegistry";

interface PlaceholderDef {
  key: string;
  color: string;     // hex like "#FF0000"
  alpha?: number;     // 0-1, defaults to 1
  shape?: "body" | "hair" | "outfit" | "accessory";
}

/**
 * Generates a placeholder sprite sheet for a single outfit layer.
 * Produces a 4x4 grid (4 frames x 4 directions) matching the contract.
 *
 * This lets the full avatar pipeline work end-to-end before
 * any real pixel art is created in Aseprite.
 */
export function generatePlaceholderSheet(
  scene: Phaser.Scene,
  def: PlaceholderDef
): void {
  if (scene.textures.exists(def.key)) return;

  const fw = SPRITE_FRAME_WIDTH;
  const fh = SPRITE_FRAME_HEIGHT;
  const w = fw * SPRITE_COLS;
  const h = fh * SPRITE_ROWS;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  ctx.globalAlpha = def.alpha ?? 1;

  for (let row = 0; row < SPRITE_ROWS; row++) {
    for (let col = 0; col < SPRITE_COLS; col++) {
      const x = col * fw;
      const y = row * fh;

      drawFrame(ctx, x, y, fw, fh, def.color, def.shape ?? "body", row, col);
    }
  }

  const texture = scene.textures.addCanvas(def.key, canvas);

  // Add frame data so Phaser treats it as a spritesheet
  Phaser.Textures.Parsers.SpriteSheet(
    texture,
    0,
    0, 0, w, h,
    { frameWidth: fw, frameHeight: fh }
  );
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  fw: number, fh: number,
  color: string,
  shape: string,
  row: number,
  col: number
): void {
  ctx.fillStyle = color;

  switch (shape) {
    case "body": {
      // Head
      const hx = x + fw * 0.3;
      const hy = y + fh * 0.08;
      const hw = fw * 0.4;
      const hh = fh * 0.3;
      ctx.fillRect(hx, hy, hw, hh);

      // Torso (slight bob for walk animation)
      const bob = col % 2 === 1 ? 1 : 0;
      const tx = x + fw * 0.25;
      const ty = y + fh * 0.38 + bob;
      ctx.fillRect(tx, ty, fw * 0.5, fh * 0.3);

      // Legs
      const ly = y + fh * 0.68 + bob;
      const lw = fw * 0.18;
      const gap = fw * 0.04 + (col % 2) * 2;
      ctx.fillRect(x + fw * 0.25, ly, lw, fh * 0.22);
      ctx.fillRect(x + fw * 0.5 + gap, ly, lw, fh * 0.22);
      break;
    }
    case "hair": {
      const hx = x + fw * 0.25;
      const hy = y + fh * 0.02;
      ctx.fillRect(hx, hy, fw * 0.5, fh * 0.15);
      break;
    }
    case "outfit": {
      const bob = col % 2 === 1 ? 1 : 0;
      const tx = x + fw * 0.22;
      const ty = y + fh * 0.38 + bob;
      ctx.fillRect(tx, ty, fw * 0.56, fh * 0.32);
      break;
    }
    case "accessory": {
      const ax = x + fw * 0.6;
      const ay = y + fh * 0.1;
      ctx.fillRect(ax, ay, fw * 0.2, fh * 0.12);
      break;
    }
  }
}

/**
 * Generates placeholder sprite sheets for all base layers.
 * Call this from BootScene to get the avatar system working
 * before real assets exist.
 */
export function generateAllPlaceholders(scene: Phaser.Scene): void {
  const defs: PlaceholderDef[] = [
    { key: "body-base", color: "#EDCAA8", shape: "body" },
    { key: "eyes-default", color: "#222244", shape: "accessory" },
    { key: "hair-short", color: "#3B2510", shape: "hair" },
    { key: "hair-spiky", color: "#CC6633", shape: "hair" },
    { key: "hair-long", color: "#1A1A2E", shape: "hair" },
    { key: "outfit-starter", color: "#14F195", shape: "outfit" },
    { key: "outfit-trader-cloak", color: "#FFD700", shape: "outfit" },
    { key: "outfit-builder-jacket", color: "#FF6B35", shape: "outfit" },
    { key: "outfit-collector", color: "#F72585", shape: "outfit" },
    { key: "acc-trading-badge", color: "#FFD700", shape: "accessory" },
    { key: "acc-nft-frame", color: "#00D1FF", shape: "accessory" },
  ];

  for (const d of defs) {
    generatePlaceholderSheet(scene, d);
  }
}
