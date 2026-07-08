"use client";

import { useEffect, useRef, useState } from "react";
import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { CityScene } from "./scenes/CityScene";
import { computeRenderDpr } from "./config/zoomConfig";

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

    // Render the canvas backing store at device resolution on desktop
    // (dpr is 1 on mobile — see computeRenderDpr). The Scale zoom of 1/dpr
    // shrinks the CSS size back to the window, so one game pixel maps to
    // exactly one device pixel. Without this, fractional-DPR screens
    // (Windows 125%/150%, Retina) CSS-upscale the canvas with
    // nearest-neighbor, producing unevenly sized "distorted" pixels.
    // Published on globalThis so zoomConfig uses the same value the canvas
    // was actually created with.
    const dpr = computeRenderDpr();
    (globalThis as { __solCityRenderDpr?: number }).__solCityRenderDpr = dpr;

    const config: Phaser.Types.Core.GameConfig = {
      type: isMobile ? Phaser.CANVAS : Phaser.AUTO,
      parent: containerRef.current,
      width: Math.round(window.innerWidth * dpr),
      height: Math.round(window.innerHeight * dpr),
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
        // NONE (not RESIZE) because RESIZE forces 1 game px = 1 CSS px,
        // which defeats the device-resolution backing store. Window
        // resizes are forwarded manually below.
        mode: Phaser.Scale.NONE,
        zoom: 1 / dpr,
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

    const onResize = () => {
      gameRef.current?.scale.resize(
        Math.round(window.innerWidth * dpr),
        Math.round(window.innerHeight * dpr)
      );
    };

    try {
      gameRef.current = new Phaser.Game(config);
      onGameReady?.(gameRef.current);
      window.addEventListener("resize", onResize);
    } catch (err) {
      console.error("[PhaserGame] Failed to initialize:", err);
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    }

    return () => {
      window.removeEventListener("resize", onResize);
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
