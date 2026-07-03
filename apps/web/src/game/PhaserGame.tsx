"use client";

import { useEffect, useRef, useState } from "react";
import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { CityScene } from "./scenes/CityScene";

interface PhaserGameProps {
  onGameReady?: (game: Phaser.Game) => void;
}

export default function PhaserGame({ onGameReady }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // Throwing during render propagates the error to the nearest ErrorBoundary —
  // the only way to surface useEffect errors (which React doesn't auto-catch).
  const [fatalError, setFatalError] = useState<Error | null>(null);
  if (fatalError) throw fatalError;

  useEffect(() => {
    if (gameRef.current || !containerRef.current) return;

    // On mobile (coarse-pointer / touch devices) force Canvas2D instead of
    // WebGL. WebGL uploads every texture to GPU VRAM, and the combined weight
    // of 16 tilesets + 22 paperdoll sheets + 13 NPC sprites saturates mobile
    // GPU memory, causing Chrome/Safari to kill the tab (OOM crash).
    // Canvas2D keeps textures in system RAM which has a much higher limit.
    // On desktop AUTO still picks WebGL for crisp pixel art.
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    const config: Phaser.Types.Core.GameConfig = {
      type: isMobile ? Phaser.CANVAS : Phaser.AUTO,
      parent: containerRef.current,
      width: window.innerWidth,
      height: window.innerHeight,
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      physics: {
        default: "arcade",
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false,
        },
      },
      // Explicitly keep keyboard enabled even on mobile — CityScene guards all
      // keyboard accesses so a null plugin won't crash anything, but having it
      // present means we don't have to branch everywhere.
      input: {
        keyboard: true,
        mouse: true,
        touch: true,
        gamepad: false,
      },
      scene: [BootScene, CityScene],
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      backgroundColor: "#061a2c",
      render: {
        pixelArt: true,
        antialias: false,
        antialiasGL: false,
        roundPixels: true,
        // Only relevant for WebGL; ignored in Canvas mode.
        powerPreference: isMobile ? "default" : "low-power",
      },
    };

    try {
      gameRef.current = new Phaser.Game(config);
      onGameReady?.(gameRef.current);
    } catch (err) {
      console.error("[PhaserGame] Failed to initialize:", err);
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    }

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ imageRendering: "pixelated", touchAction: "none" }}
    />
  );
}
