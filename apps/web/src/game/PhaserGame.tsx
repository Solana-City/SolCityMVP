"use client";

import { useEffect, useRef, useState } from "react";
import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { CityScene } from "./scenes/CityScene";
import { computeRenderDpr } from "./config/zoomConfig";

interface PhaserGameProps {
  onGameReady?: (game: Phaser.Game) => void;
}

/**
 * Idle frame throttling.
 *
 * Rendering is about half of the CPU an idle tab spends: a profile of a
 * standing player put `render` at 48.8% of the trace, with `batchQuad` the
 * single most expensive function in it. That cost is per quad submitted, and
 * the city submits thousands of them a frame — to redraw a picture that, for
 * a player who is not touching anything, is nearly the one already on screen.
 *
 * So the loop drops to 30fps after a spell without input, and snaps back the
 * instant anything is pressed, clicked or touched.
 *
 * Deliberately a throttle and NOT a sleep: this world keeps moving while you
 * stand still. Pedestrians walk, NPCs step every 4 seconds, the football
 * rolls, other players wander past. Pausing the loop would freeze all of
 * that; halving its rate just renders it at 30, which on slow-moving pixel
 * art is very hard to see.
 *
 * Arcade physics is unaffected: it runs fixedStep with a catch-up loop, so it
 * keeps taking ~60 steps a second regardless of how often we draw.
 */
const ACTIVE_FPS_LIMIT = 240;
const IDLE_FPS_LIMIT = 30;
const IDLE_AFTER_MS = 10_000;

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

    // Render the canvas backing store at device resolution (dpr capped at
    // 2 — see computeRenderDpr). The Scale zoom of 1/dpr shrinks the CSS
    // size back to the container, so one game pixel maps to exactly one
    // device pixel. Without this, fractional-DPR screens (Windows
    // 125%/150%, Retina) CSS-upscale the canvas with nearest-neighbor,
    // producing unevenly sized "distorted" pixels — and the crisp 0.5x
    // zoom-out level would be impossible.
    // Published on globalThis so zoomConfig uses the same value the canvas
    // was actually created with.
    const dpr = computeRenderDpr();
    (globalThis as { __solCityRenderDpr?: number }).__solCityRenderDpr = dpr;

    // Size from the container, not window.inner* — on mobile the visible
    // viewport (URL bar collapsed/expanded) differs from 100vh, and a canvas
    // smaller than its parent gets letterboxed by autoCenter (blue border).
    const container = containerRef.current;

    const config: Phaser.Types.Core.GameConfig = {
      type: isMobile ? Phaser.CANVAS : Phaser.AUTO,
      parent: container,
      width: Math.round(container.clientWidth * dpr),
      height: Math.round(container.clientHeight * dpr),
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      // This limit is not meant to limit anything at 240: it exists so that
      // Phaser binds its RATE-LIMITED stepper at boot. TimeStep picks the
      // step function once, in start(), based on hasFpsLimit (which is just
      // `limit > 0`) — so without a limit here the unlimited stepper is bound
      // for the life of the game and writing loop.fpsLimit later does
      // literally nothing. With it, the limited stepper re-reads _limitRate
      // every frame and the idle throttle below works.
      //
      // 240 rather than 60 because the limiter discards the surplus delta
      // (`this.delta = 0` after each callback), so a limit equal to the
      // display's own rate drops roughly every other frame and judders.
      fps: { limit: ACTIVE_FPS_LIMIT },
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
        // Phaser otherwise listens for mousedown/touchstart on WINDOW and
        // deliberately processes events whose target is NOT the canvas, so a
        // click on any React panel above the game also hit whatever was behind
        // it: picking an outfit in the wardrobe opened the profile card of a
        // player standing under the board. With this off, Phaser only hears
        // clicks that land on the canvas itself.
        //
        // Nothing here depended on the window listeners: the joystick and the
        // pinch-zoom are React DOM handlers, and the scene's only pointer use
        // is the avatar hit zones (pointerdown on the canvas).
        windowEvents: false,
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

    // ResizeObserver tracks every container size change (window resize,
    // device rotation, mobile URL bar collapse) — more reliable than the
    // window resize event on mobile browsers.
    const observer = new ResizeObserver(() => {
      if (!gameRef.current) return;
      gameRef.current.scale.resize(
        Math.round(container.clientWidth * dpr),
        Math.round(container.clientHeight * dpr)
      );
    });

    // See the constants above. _limitRate is what stepLimitFPS actually reads
    // each frame; fpsLimit is kept in step so anything inspecting the loop
    // (or __solCityStats) reports the truth.
    let idle = false;
    let lastInput = performance.now();
    const applyFps = (fps: number) => {
      const loop = gameRef.current?.loop as
        (Phaser.Core.TimeStep & { _limitRate: number }) | undefined;
      if (!loop) return;
      loop.fpsLimit = fps;
      loop._limitRate = 1000 / fps;
    };
    const onInput = () => {
      lastInput = performance.now();
      if (!idle) return;
      idle = false;
      applyFps(ACTIVE_FPS_LIMIT);
    };
    const idleWatch = window.setInterval(() => {
      if (idle || performance.now() - lastInput < IDLE_AFTER_MS) return;
      idle = true;
      applyFps(IDLE_FPS_LIMIT);
    }, 2_000);
    // Capture phase, because the React panels and the touch joystick stop
    // plenty of these from bubbling to window.
    const INPUT_EVENTS = [
      "keydown", "pointerdown", "pointermove", "touchstart", "touchmove", "wheel",
    ] as const;
    for (const ev of INPUT_EVENTS) {
      window.addEventListener(ev, onInput, { capture: true, passive: true });
    }

    try {
      gameRef.current = new Phaser.Game(config);
      onGameReady?.(gameRef.current);
      observer.observe(container);
    } catch (err) {
      console.error("[PhaserGame] Failed to initialize:", err);
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    }

    return () => {
      observer.disconnect();
      window.clearInterval(idleWatch);
      for (const ev of INPUT_EVENTS) {
        window.removeEventListener(ev, onInput, { capture: true });
      }
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
