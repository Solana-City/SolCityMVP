import * as Phaser from "phaser";

/**
 * A memory census of the running city, for chasing growth during play.
 *
 * The Chrome task manager says HOW MUCH a tab uses; this says WHAT holds it.
 * Everything counted here is something that can only grow if something is
 * leaking: tile cells, texture pixels, display objects, tweens, timers,
 * animations, physics bodies. Take one reading after load and another after
 * a few minutes of walking; whichever column climbs is the leak.
 *
 * Exposed as `__solCityStats()` in the console, and logged once a minute as
 * `[mem]` so a tester can just play and read the trend afterwards.
 */

/**
 * Timestamps of the frames actually drawn in the last second.
 *
 * Fed by the game's own `prerender`, which fires once per DRAWN frame — unlike
 * Phaser's framesThisSecond, which is incremented before the frame limiter
 * decides whether to draw at all.
 */
const renderTimes: number[] = [];

function renderedFps(): number {
  const cutoff = performance.now() - 1000;
  while (renderTimes.length && renderTimes[0] < cutoff) renderTimes.shift();
  return renderTimes.length;
}

export interface MemStats {
  /** Frames actually DRAWN in the last second — counted here, not read off Phaser. */
  fps: number;
  /** Animation frames the browser delivered, i.e. the display's own rate. */
  rafHz: number;
  /** The frame limiter's current setting: ~65 active, 30 idle, 0 if uncapped. */
  fpsCap: number;
  /** "canvas" on phones, "webgl" on desktop — their costs are not comparable. */
  renderer: "canvas" | "webgl";
  /** JS heap in use, MB (Chrome only). */
  heapMB: number | null;
  /** Cells across every tilemap layer — each is a Tile object. */
  tileCells: number;
  textures: number;
  /** Decoded texture memory, MB (width x height x 4 over every source). */
  textureMB: number;
  displayObjects: number;
  tweens: number;
  timers: number;
  animations: number;
  bodies: number;
  canvasTextures: number;
}

export function readMemStats(scene: Phaser.Scene): MemStats {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };

  let tileCells = 0;
  scene.children.list.forEach((o) => {
    if (o instanceof Phaser.Tilemaps.TilemapLayer) {
      tileCells += o.layer.width * o.layer.height;
    }
  });

  const tm = scene.textures;
  let texturePixels = 0;
  let textures = 0;
  let canvasTextures = 0;
  for (const key of tm.getTextureKeys()) {
    const tex = tm.get(key);
    textures++;
    if (tex instanceof Phaser.Textures.CanvasTexture || tex.source[0]?.isCanvas) canvasTextures++;
    for (const src of tex.source) texturePixels += (src.width || 0) * (src.height || 0);
  }

  const world = (scene.physics as Phaser.Physics.Arcade.ArcadePhysics | undefined)?.world;

  // NOT loop.actualFps for the drawn rate. Phaser's limited stepper counts
  // framesThisSecond BEFORE its own rate gate (TimeStep.js), so actualFps is
  // every animation frame the browser delivered — the display's refresh rate —
  // whether or not the frame was drawn. It reads 144 on a 144Hz screen with the
  // limiter pinned at 15, which is exactly backwards from what this log is for.
  // Both are reported: fps is what was drawn, rafHz is what the display offered.
  //
  // Frame rate belongs here because on a phone this log is the instrument.
  // Reaching it needs a DEBUG build either way: the Android shell only
  // enables WebView debugging when BuildConfig.DEBUG is set, and its
  // WebChromeClient drops every console message below ERROR in release. So
  // a release APK reports none of this — measure on a debug build over
  // chrome://inspect or `adb logcat -s SolCity`, or in the browser PWA.
  const loop = scene.game.loop as Phaser.Core.TimeStep & { _limitRate?: number };
  const rate = loop._limitRate ?? 0;

  return {
    fps: renderedFps(),
    rafHz: Math.round(loop.actualFps),
    // What the frame limiter is set to right now: ~65 active, 30 idle. The
    // pair (fps, fpsCap) is what says whether the idle throttle engaged, or
    // whether the device simply cannot reach the cap.
    fpsCap: rate > 0 ? Math.round(1000 / rate) : 0,
    // Phones are forced to Canvas2D (see PhaserGame), where cost scales with
    // the number of draws rather than with batched quads — so a desktop
    // profile does not transfer, and this says which renderer produced the
    // numbers below.
    renderer: scene.game.renderer instanceof Phaser.Renderer.Canvas.CanvasRenderer
      ? "canvas" : "webgl",
    heapMB: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null,
    tileCells,
    textures,
    textureMB: Math.round((texturePixels * 4) / 1048576),
    displayObjects: scene.children.list.length,
    tweens: scene.tweens.getTweens().length,
    timers: (scene.time as unknown as { _active: unknown[] })._active?.length ?? 0,
    animations: (scene.anims as unknown as { anims: { size: number } }).anims?.size ?? 0,
    bodies: world ? world.bodies.size : 0,
    canvasTextures,
  };
}

/** Installs `__solCityStats()` and the once-a-minute `[mem]` log. Returns a stop function. */
export function startMemStats(scene: Phaser.Scene): () => void {
  const read = () => readMemStats(scene);
  (globalThis as { __solCityStats?: () => MemStats }).__solCityStats = read;

  // One push per drawn frame; renderedFps() drops anything older than a second,
  // so this never grows past the display's refresh rate.
  const onRender = () => { renderTimes.push(performance.now()); };
  scene.game.events.on(Phaser.Core.Events.PRE_RENDER, onRender);

  const log = () => {
    const s = read();
    console.log(
      `[mem] ${s.fps}fps drawn (cap ${s.fpsCap || "∞"}, ${s.rafHz}Hz panel) ${s.renderer}` +
      ` | heap ${s.heapMB ?? "?"}MB | tiles ${s.tileCells.toLocaleString()}` +
      ` | tex ${s.textures} (${s.textureMB}MB, ${s.canvasTextures} canvas)` +
      ` | objs ${s.displayObjects} | tweens ${s.tweens} | timers ${s.timers}` +
      ` | anims ${s.animations} | bodies ${s.bodies}`,
    );
  };
  const first = setTimeout(log, 5_000);
  const id = setInterval(log, 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(id);
    scene.game.events.off(Phaser.Core.Events.PRE_RENDER, onRender);
    renderTimes.length = 0;
  };
}
