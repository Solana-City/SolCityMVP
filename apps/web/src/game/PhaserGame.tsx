"use client";

import { useEffect, useRef, useState } from "react";
import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { CityScene } from "./scenes/CityScene";
import { computeRenderDpr, setRenderScale } from "./config/zoomConfig";

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
/**
 * 65, not 60, and not "uncapped".
 *
 * Uncapped means the display's rate, and on a 144Hz monitor this game was
 * measured rendering at 111-141fps — paying well over twice the per-frame
 * cost (thousands of batched quads each time) for frames nobody can see in
 * slow-moving pixel art. That was the bulk of the CPU while walking.
 *
 * The limiter accumulates delta and resets it to zero after each callback,
 * so the achieved rate is the display's rate divided by a whole number. A
 * limit of exactly 60 on a 60Hz display sits right on that boundary and
 * risks dropping every other frame (30fps). Sitting just above it is safe
 * and lands well on every common panel:
 *   60Hz -> 60    90Hz -> 45    120Hz -> 60    144Hz -> 48
 */
const ACTIVE_FPS_LIMIT = 65;
/**
 * 31, not 30, for exactly the reason ACTIVE_FPS_LIMIT is 65 and not 60 — this
 * one was wrong on the first pass.
 *
 * At 30 the gate sits at 33.33ms, and a browser throttled to 30Hz (Chrome's
 * Energy Saver, or a laptop on battery) delivers frames about 33.3ms apart.
 * Jitter puts most of them a hair under the gate, so they are skipped and the
 * next carries double the delta: measured 10fps, with visibly choppy idle
 * animation, on precisely the battery-saving setup this throttle exists to
 * help. 31 puts the gate at 32.26ms, just under a 30Hz frame, so every one
 * lands: a steady 30 on 30Hz, 60Hz and 120Hz panels alike.
 */
const IDLE_FPS_LIMIT = 31;
/** Window visible but not focused — the city still moves, just slowly. */
const BLUR_FPS_LIMIT = 15;
/** 5s, not 10: ten seconds at full rate is most of an ordinary pause. */
const IDLE_AFTER_MS = 5_000;

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

    // Switch render scale from the console and reload, for side-by-side tests
    // before this is worth a settings entry. `?render=1` does the same for one
    // visit without storing anything.
    (globalThis as { __solCityRenderScale?: (v: number | "auto") => void })
      .__solCityRenderScale = (v) => { setRenderScale(v); window.location.reload(); };

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
      // It is also a real cap now — see ACTIVE_FPS_LIMIT for why 65.
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
    // One place decides the frame rate. Nothing else in the codebase writes
    // loop.fpsLimit, and nothing else should: two owners of a rate that is
    // changed from events is how you get a game stuck at 15fps.
    //
    // A hidden TAB needs nothing from us — the browser stops delivering
    // animation frames, so the loop stops on its own.
    let lastInput = performance.now();
    let focused = typeof document !== "undefined" ? document.hasFocus() : true;
    let currentFps = 0;
    const applyFps = (fps: number) => {
      const loop = gameRef.current?.loop as
        (Phaser.Core.TimeStep & { _limitRate: number }) | undefined;
      if (!loop) return;
      loop.fpsLimit = fps;
      loop._limitRate = 1000 / fps;
    };
    const desiredFps = () => {
      if (!focused) return BLUR_FPS_LIMIT;
      return performance.now() - lastInput > IDLE_AFTER_MS
        ? IDLE_FPS_LIMIT : ACTIVE_FPS_LIMIT;
    };
    const syncFps = () => {
      const fps = desiredFps();
      if (fps === currentFps) return;
      currentFps = fps;
      applyFps(fps);
    };
    const onInput = () => { lastInput = performance.now(); syncFps(); };
    const onFocus = () => { focused = true; lastInput = performance.now(); syncFps(); };
    const onBlur = () => { focused = false; syncFps(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    const idleWatch = window.setInterval(syncFps, 1_000);
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
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
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
