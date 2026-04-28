"use client";

import { useEffect, useRef } from "react";
import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { CityScene } from "./scenes/CityScene";

interface PhaserGameProps {
  onGameReady?: (game: Phaser.Game) => void;
}

export default function PhaserGame({ onGameReady }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (gameRef.current || !containerRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.WEBGL,
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
      },
    };

    gameRef.current = new Phaser.Game(config);
    onGameReady?.(gameRef.current);

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
