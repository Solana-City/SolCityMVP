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
 * 75, not 60, and not "uncapped".
 *
 * Uncapped means the display's rate, and on a 144Hz monitor this game was
 * measured rendering at 111-141fps — paying well over twice the per-frame
 * cost (thousands of batched quads each time) for frames nobody can see in
 * slow-moving pixel art. That was the bulk of the CPU while walking.
 *
 * But the limiter accumulates delta and resets it to zero after each
 * callback, so the rate it achieves is the display's rate divided by a WHOLE
 * NUMBER — and which whole number is decided by where the gate falls. This
 * started at 65, whose gate is 15.38ms: a 143Hz panel delivers frames 6.99ms
 * apart, so two are skipped before the third clears the gate and the game
 * draws at 143/3, measured at 48fps. Smooth is not what that looks like next
 * to the 141 it used to run at, and it was reported as the game catching
 * while walking.
 *
 * 75 puts the gate at 13.33ms, which a second frame clears on any panel from
 * 143Hz up, so those draw at half their rate instead of a third:
 *   60Hz -> 60    90Hz -> 45    120Hz -> 60    143Hz -> 71    144Hz -> 72
 *
 * Not 72, which would be the obvious round choice: its gate is 13.89ms and a
 * 144Hz frame arrives at 13.889ms — the boundary itself, where jitter decides
 * each frame individually and the pacing comes out uneven. 75 clears it with
 * room.
 *
 * This does give back some of the saving on high-refresh screens: 71fps
 * against 48 is about half as much work again. That is the trade asked for —
 * the heat budget was never worth a game that reads as stuttering.
 */
const ACTIVE_FPS_LIMIT = 75;
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
      // `min` tightens how far a single long frame may be stretched. Phaser
      // clamps a frame's delta to 1000/minFps, and the default minFps of 5
      // allows a 200ms step — which, with the variable-step physics below,
      // would advance a walking character about 32px in one go, further than
      // a 24px tile and so potentially through a wall. 20 caps the step at
      // 50ms, around 8px. Below that the game runs in slow motion, which is
      // the right failure for a device that cannot keep up.
      fps: { limit: ACTIVE_FPS_LIMIT, min: 20 },
      physics: {
        default: "arcade",
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false,
          // Step with the real frame delta instead of a fixed 60Hz.
          //
          // Fixed-step physics advances the world 60 times a second while the
          // game draws ~72, so roughly one drawn frame in six repeats the
          // position of the one before it. Measured on the live site: 16 of 99
          // frames identical, in an irregular pattern. That single stalled
          // frame, scattered unevenly through smooth motion, is what reads as
          // the character trembling as it walks.
          //
          // Stepping on the real delta gives every drawn frame a new position,
          // whatever rate the display runs at, so the motion matches what is
          // actually on screen.
          //
          // Nothing depends on the fixed step for correctness: the football
          // has no arcade body, the hunted citizen is driven by the wall
          // clock, and the crowd is local decoration. Collision separation now
          // runs once per drawn frame, which at 72fps is more often than the
          // 60 it had.
          fixedStep: false,
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
    let currentFps = 0;

    /**
     * Read live, never cached, and overridden by recent input.
     *
     * This used to be a boolean seeded from document.hasFocus() at mount and
     * updated only by the focus/blur events. Both halves could strand it: at
     * mount the focus is often still in the address bar, or the tab opened in
     * the background, so it started false — and `focus` only fires on a
     * TRANSITION, so if the window was never really blurred the event never
     * came and the flag stayed false for the rest of the session. The game
     * then sat at the unfocused rate, 15fps, while the player walked around,
     * which is both the stutter and the slow-feeling moves: the scene update
     * that reads input and calls sendInput runs on that same loop.
     *
     * Recent input wins over hasFocus() because an embedded page can report
     * false while the player is plainly driving it — the Android WebView and
     * any iframe among them.
     */
    const isFocused = (): boolean => {
      if (performance.now() - lastInput < 1_000) return true;
      return typeof document === "undefined" || document.hasFocus();
    };
    const applyFps = (fps: number) => {
      const loop = gameRef.current?.loop as
        (Phaser.Core.TimeStep & { _limitRate: number }) | undefined;
      if (!loop) return;
      loop.fpsLimit = fps;
      loop._limitRate = 1000 / fps;
    };
    const desiredFps = () => {
      if (!isFocused()) return BLUR_FPS_LIMIT;
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
    // Nothing to store — these only ask for an immediate re-read instead of
    // waiting out the one-second tick below.
    const onFocusChange = () => syncFps();
    window.addEventListener("focus", onFocusChange);
    window.addEventListener("blur", onFocusChange);
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
      window.removeEventListener("focus", onFocusChange);
      window.removeEventListener("blur", onFocusChange);
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
