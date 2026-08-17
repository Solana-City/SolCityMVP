import * as Phaser from "phaser";
import { generateTileset } from "../utils/tilesetGenerator";
import { SimpleSprite } from "../entities/SimpleSprite";
import { AvatarSprite } from "../entities/AvatarSprite";
import { NPC_REGISTRY } from "../config/npcRegistry";
import { getAllLayerVariants, EXPRESSIONS, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT } from "../config/paperDoll";

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

// SCUrbanEquipament and SCBuildKeepGreen have no tiles in city-mobile.json.
const TILESET_KEYS_MOBILE = TILESET_KEYS.filter(
  k => k !== "SCUrbanEquipament" && k !== "SCBuildKeepGreen"
);

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

    const mapFile = window.matchMedia("(pointer: coarse)").matches
      ? "assets/maps/city-mobile.json"
      : "assets/maps/city.json";
    this.load.tilemapTiledJSON("city-map", mapFile);

    const isMobileTilesets = window.matchMedia("(pointer: coarse)").matches;
    for (const key of (isMobileTilesets ? TILESET_KEYS_MOBILE : TILESET_KEYS)) {
      this.load.image(key, `assets/tilesets/${key}.png`);
    }

    // Pixel-art NPC attention balloons — one per palette variant.
    for (const variant of ["green", "orange", "purple", "red", "yellow"]) {
      this.load.image(`attention-${variant}`, `assets/ui/attention_${variant}.png`);
    }

    SimpleSprite.load(this, "avatar-player", "assets/sprites/main_char.png", 64, 64);

    const loadedKeys = new Set<string>();
    for (const npc of NPC_REGISTRY) {
      if (!npc.spriteKey || loadedKeys.has(npc.spriteKey)) continue;
      loadedKeys.add(npc.spriteKey);
      const filename = npc.spriteKey.startsWith("avatar-")
        ? npc.spriteKey.replace(/^avatar-/, "")
        : npc.spriteKey.replace(/ /g, "%20");
      // Static animated NPCs (idle-loop sheets) ship their own frame size —
      // everyone else uses the standard 64×64 walk-cycle grid.
      const { frameWidth, frameHeight } = npc.spriteAnimation ?? { frameWidth: 64, frameHeight: 64 };
      SimpleSprite.load(this, npc.spriteKey, `assets/sprites/${filename}.png`, frameWidth, frameHeight);
    }

    // Paper doll sheets are small (256x256 each, ~5MB decoded in total) — load
    // all of them on every platform. Pedestrians wear random variants, so
    // loading only the player's loadout left their missing layers invisible
    // on mobile. The heavy mobile memory cost is the tilemap, not these sheets.
    for (const { variant } of getAllLayerVariants()) {
      AvatarSprite.loadSpriteSheet(this, variant.textureKey, `assets/sprites/paperdoll/${variant.file}`);
    }

    // Expression face sheets — same paper-doll format, own texture keys.
    for (const expr of EXPRESSIONS) {
      AvatarSprite.loadSpriteSheet(this, expr.textureKey, `assets/sprites/paperdoll/${expr.file}`);
    }
  }

  create(): void {
    generateTileset(this);

    const isMobile = window.matchMedia("(pointer: coarse)").matches;

    // Static animated NPCs (idle-loop sheets, e.g. Kite Pro) ship with the
    // same pink chroma-key background as the paperdoll sheets — key each
    // one out at its own frame size before either path below starts.
    const animatedNpcSheets = NPC_REGISTRY.filter(
      (npc) => npc.spriteKey && npc.spriteAnimation && this.textures.exists(npc.spriteKey)
    );
    // Expression face sheets carry the same pink background too.
    const exprKeys = EXPRESSIONS
      .map((e) => e.textureKey)
      .filter((k) => this.textures.exists(k));

    if (isMobile) {
      // Process chroma key one sprite per requestAnimationFrame so we
      // never block the main thread for more than ~30ms at a time
      // (~21 sheets ≈ 0.35s total before CityScene starts).
      const variants = getAllLayerVariants().filter(
        ({ variant }) => this.textures.exists(variant.textureKey)
      );
      const npcStart = variants.length;
      const exprStart = npcStart + animatedNpcSheets.length;
      const total = exprStart + exprKeys.length;
      let i = 0;
      const processNext = () => {
        if (i < npcStart) {
          applyChromaKey(this, variants[i].variant.textureKey);
        } else if (i < exprStart) {
          const npc = animatedNpcSheets[i - npcStart];
          // Flat: NPC art has pink background pockets enclosed by the sprite
          // (e.g. Kite Pro's kite) that a flood fill can't reach.
          applyChromaKey(this, npc.spriteKey!, npc.spriteAnimation!.frameWidth, npc.spriteAnimation!.frameHeight, false);
        } else if (i < total) {
          applyChromaKey(this, exprKeys[i - exprStart]);
        } else {
          waitForGameFont(() => this.scene.start("CityScene"));
          return;
        }
        i++;
        requestAnimationFrame(processNext);
      };
      requestAnimationFrame(processNext);
      return;
    }

    // Apply chroma key to all paper doll layers — removes the pink background
    // (rgb 215,123,186) so layers composite transparently over each other.
    for (const { variant } of getAllLayerVariants()) {
      if (this.textures.exists(variant.textureKey)) {
        applyChromaKey(this, variant.textureKey);
      }
    }
    for (const npc of animatedNpcSheets) {
      // Flat pass (no flood fill) — clears pink pockets enclosed by the NPC art.
      applyChromaKey(this, npc.spriteKey!, npc.spriteAnimation!.frameWidth, npc.spriteAnimation!.frameHeight, false);
    }
    for (const key of exprKeys) {
      applyChromaKey(this, key);
    }

    waitForGameFont(() => this.scene.start("CityScene"));
  }
}

/**
 * Phaser draws text on a <canvas> — if the web font hasn't finished loading
 * yet, the canvas rasterizes with the fallback font and never redraws once
 * the font arrives (unlike DOM text, which repaints automatically). Force
 * the font to load and wait for it before any in-game Text object is created,
 * so NPC labels/chat bubbles reliably render in Press Start 2P.
 */
function waitForGameFont(onReady: () => void): void {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1000));
  Promise.race([
    document.fonts.load('10px "Press Start 2P"').then(() => undefined),
    timeout,
  ]).then(onReady).catch(onReady);
}

/**
 * Replaces a loaded spritesheet texture with a canvas copy that has the
 * chroma-key BACKGROUND removed (set to alpha 0). Re-registers frame data so
 * Phaser treats it identically to the original spritesheet.
 *
 * Two modes:
 *  • floodFill (default) — clears only key-colored pixels reachable from each
 *    frame's borders. The pink key (215/123/186) can equal a pink SKIN tone, so
 *    a flat pass punched holes in pink-skinned characters; seeding from the
 *    edges clears the true background and leaves same-colored interior skin.
 *  • flat (floodFill=false) — clears EVERY matching pixel. Needed for art whose
 *    background forms pockets ENCLOSED by the sprite (e.g. the Kite Pro NPC's
 *    kite), which a flood fill can't reach and would leave as pink residue.
 *    Safe for sheets that have no pink skin (the NPC sheets).
 */
function applyChromaKey(
  scene: Phaser.Scene,
  key: string,
  frameWidth: number = SPRITE_FRAME_WIDTH,
  frameHeight: number = SPRITE_FRAME_HEIGHT,
  floodFill: boolean = true,
): void {
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

  const isKey = (a: number): boolean =>
    Math.abs(data[a]     - CHROMA_R) <= CHROMA_TOLERANCE &&
    Math.abs(data[a + 1] - CHROMA_G) <= CHROMA_TOLERANCE &&
    Math.abs(data[a + 2] - CHROMA_B) <= CHROMA_TOLERANCE;

  if (!floodFill) {
    // Flat pass: clear every matching pixel, enclosed pockets included.
    for (let a = 0; a < data.length; a += 4) {
      if (data[a + 3] !== 0 && isKey(a)) data[a + 3] = 0;
    }
  } else {
    // Clear pixel `i` iff it's still opaque and matches the key; on clear, queue
    // it so the fill spreads outward from the frame borders.
    const stack: number[] = [];
    const tryClear = (i: number): void => {
      const a = i * 4;
      if (data[a + 3] === 0) return; // already transparent → visited
      if (isKey(a)) { data[a + 3] = 0; stack.push(i); }
    };

    const cols = Math.max(1, Math.floor(w / frameWidth));
    const rows = Math.max(1, Math.floor(h / frameHeight));

    for (let fr = 0; fr < rows; fr++) {
      for (let fc = 0; fc < cols; fc++) {
        const x0 = fc * frameWidth;
        const y0 = fr * frameHeight;
        const x1 = Math.min(x0 + frameWidth, w);
        const y1 = Math.min(y0 + frameHeight, h);

        // Seed from the four borders of this frame.
        for (let x = x0; x < x1; x++) { tryClear(y0 * w + x); tryClear((y1 - 1) * w + x); }
        for (let y = y0; y < y1; y++) { tryClear(y * w + x0); tryClear(y * w + (x1 - 1)); }

        // Flood inward, staying within this frame's bounds so a character that
        // reaches its own edge can't let the fill bleed into a neighbour frame.
        while (stack.length) {
          const i = stack.pop()!;
          const px = i % w;
          const py = (i - px) / w;
          if (px > x0)      tryClear(i - 1);
          if (px < x1 - 1)  tryClear(i + 1);
          if (py > y0)      tryClear(i - w);
          if (py < y1 - 1)  tryClear(i + w);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  scene.textures.remove(key);
  const newTex = scene.textures.addCanvas(key, canvas);
  (Phaser.Textures.Parsers as any).SpriteSheet(
    newTex, 0,
    0, 0, w, h,
    { frameWidth, frameHeight }
  );
}
