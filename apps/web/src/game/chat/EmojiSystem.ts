import Phaser from "phaser";

export interface EmojiDef {
  id: string;
  label: string;
  key: string; // keyboard key to trigger
  symbol: string; // text rendered above avatar
  color: string;
  artKey: string;
  uiSymbol: string;
}

export const EMOJI_REGISTRY: EmojiDef[] = [
  { id: "wave", label: "Wave", key: "1", symbol: "gm!", color: "#14F195", artKey: "emoji-wave", uiSymbol: "👋" },
  { id: "heart", label: "Heart", key: "2", symbol: "<3", color: "#F72585", artKey: "emoji-heart", uiSymbol: "💜" },
  { id: "fire", label: "Fire", key: "3", symbol: "LFG", color: "#FF6B35", artKey: "emoji-fire", uiSymbol: "🔥" },
  { id: "laugh", label: "Laugh", key: "4", symbol: "lol", color: "#FFD700", artKey: "emoji-laugh", uiSymbol: "😆" },
  { id: "think", label: "Think", key: "5", symbol: "hmm", color: "#00D1FF", artKey: "emoji-think", uiSymbol: "🤔" },
  { id: "gg", label: "GG", key: "6", symbol: "GG", color: "#9945FF", artKey: "emoji-gg", uiSymbol: "🏆" },
];

const EMOJI_DURATION = 2500;
const EMOJI_FLOAT_HEIGHT = 40;

/**
 * Displays a floating emoji animation above a game object container.
 * The emoji floats up and fades out.
 */
export function showEmoji(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Container,
  emoji: EmojiDef
): void {
  ensureEmojiArt(scene);

  const bubble = scene.add.container(0, -30);
  const glow = scene.add.circle(0, -2, 14, 0x0a0a1e, 0.85).setStrokeStyle(2, 0xffffff, 0.08);
  const icon = scene.add.image(0, -2, emoji.artKey).setScale(1.25);
  const text = scene.add.text(0, 16, emoji.symbol, {
    fontSize: "12px",
    fontFamily: '"Press Start 2P", monospace',
    color: emoji.color,
    align: "center",
    stroke: "#0a0a1e",
    strokeThickness: 4,
  }).setOrigin(0.5, 1);
  bubble.add([glow, icon, text]);

  target.add(bubble);

  scene.tweens.add({
    targets: bubble,
    y: -30 - EMOJI_FLOAT_HEIGHT,
    alpha: 0,
    duration: EMOJI_DURATION,
    ease: "Cubic.easeOut",
    onComplete: () => {
      target.remove(bubble);
      bubble.destroy();
    },
  });
}

/**
 * Sets up keyboard listeners for emoji triggers.
 * Only fires when chat input is NOT focused.
 */
export function setupEmojiKeys(
  scene: Phaser.Scene,
  getTarget: () => Phaser.GameObjects.Container,
  getChatActive: () => boolean,
  onEmoji?: (emoji: EmojiDef) => void
): void {
  for (const emoji of EMOJI_REGISTRY) {
    scene.input.keyboard!.on(`keydown-${emoji.key}`, () => {
      if (getChatActive()) return;
      showEmoji(scene, getTarget(), emoji);
      onEmoji?.(emoji);
    });
  }
}

export function ensureEmojiArt(scene: Phaser.Scene): void {
  for (const emoji of EMOJI_REGISTRY) {
    if (scene.textures.exists(emoji.artKey)) continue;
    const g = scene.add.graphics({ x: 0, y: 0 });
    g.fillStyle(0x0a0a1e, 0.2);
    g.fillCircle(12, 12, 12);

    switch (emoji.id) {
      case "wave":
        g.fillStyle(0x14f195, 1);
        g.fillRoundedRect(6, 5, 10, 13, 4);
        g.fillStyle(0x8cf7c8, 1);
        g.fillRect(9, 2, 2, 5);
        g.fillRect(12, 2, 2, 5);
        break;
      case "heart":
        g.fillStyle(0xf72585, 1);
        g.fillCircle(8, 9, 5);
        g.fillCircle(16, 9, 5);
        g.fillTriangle(4, 11, 20, 11, 12, 20);
        break;
      case "fire":
        g.fillStyle(0xff6b35, 1);
        g.fillTriangle(12, 3, 5, 18, 19, 18);
        g.fillStyle(0xffd166, 1);
        g.fillTriangle(12, 7, 8, 17, 16, 17);
        break;
      case "laugh":
        g.fillStyle(0xffd700, 1);
        g.fillCircle(12, 12, 10);
        g.fillStyle(0x1a1a3e, 1);
        g.fillRect(8, 9, 2, 2);
        g.fillRect(14, 9, 2, 2);
        g.fillRoundedRect(8, 14, 8, 3, 2);
        break;
      case "think":
        g.fillStyle(0x00d1ff, 1);
        g.fillCircle(11, 11, 8);
        g.fillStyle(0x061a2c, 1);
        g.fillRect(8, 9, 2, 2);
        g.fillRect(12, 9, 2, 2);
        g.fillRect(10, 14, 4, 2);
        g.fillCircle(18, 18, 2);
        break;
      case "gg":
        g.fillStyle(0x9945ff, 1);
        g.fillRoundedRect(5, 5, 14, 14, 3);
        g.fillStyle(0xffd700, 1);
        g.fillRect(10, 7, 4, 8);
        g.fillRect(8, 15, 8, 2);
        break;
    }

    g.generateTexture(emoji.artKey, 24, 24);
    g.destroy();
  }
}
