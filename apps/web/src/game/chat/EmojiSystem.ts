import Phaser from "phaser";

export interface EmojiDef {
  id: string;
  label: string;
  key: string; // keyboard key to trigger
  symbol: string; // text rendered above avatar
  color: string;
}

export const EMOJI_REGISTRY: EmojiDef[] = [
  { id: "wave", label: "Wave", key: "1", symbol: "gm!", color: "#14F195" },
  { id: "heart", label: "Heart", key: "2", symbol: "<3", color: "#F72585" },
  { id: "fire", label: "Fire", key: "3", symbol: "LFG", color: "#FF6B35" },
  { id: "laugh", label: "Laugh", key: "4", symbol: "lol", color: "#FFD700" },
  { id: "think", label: "Think", key: "5", symbol: "hmm", color: "#00D1FF" },
  { id: "gg", label: "GG", key: "6", symbol: "GG", color: "#9945FF" },
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
  const text = scene.add.text(0, -30, emoji.symbol, {
    fontSize: "12px",
    fontFamily: '"Press Start 2P", monospace',
    color: emoji.color,
    align: "center",
    stroke: "#0a0a1e",
    strokeThickness: 3,
  }).setOrigin(0.5, 1);

  target.add(text);

  scene.tweens.add({
    targets: text,
    y: -30 - EMOJI_FLOAT_HEIGHT,
    alpha: 0,
    duration: EMOJI_DURATION,
    ease: "Cubic.easeOut",
    onComplete: () => {
      target.remove(text);
      text.destroy();
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
