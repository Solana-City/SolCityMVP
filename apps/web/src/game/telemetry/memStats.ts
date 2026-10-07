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

export interface MemStats {
  /** Frames actually achieved over the last second. */
  fps: number;
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

  // Frame rate belongs here because on a phone this log IS the instrument:
  // a release APK has WebView debugging off, so there is no DevTools to
  // attach — but the shell forwards console to logcat, so `adb logcat` can
  // read these lines off a real device with no cable ceremony beyond USB.
  const loop = scene.game.loop as Phaser.Core.TimeStep & { _limitRate?: number };
  const rate = loop._limitRate ?? 0;

  return {
    fps: Math.round(loop.actualFps),
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

  const log = () => {
    const s = read();
    console.log(
      `[mem] ${s.fps}fps/${s.fpsCap || "∞"} ${s.renderer}` +
      ` | heap ${s.heapMB ?? "?"}MB | tiles ${s.tileCells.toLocaleString()}` +
      ` | tex ${s.textures} (${s.textureMB}MB, ${s.canvasTextures} canvas)` +
      ` | objs ${s.displayObjects} | tweens ${s.tweens} | timers ${s.timers}` +
      ` | anims ${s.animations} | bodies ${s.bodies}`,
    );
  };
  const first = setTimeout(log, 5_000);
  const id = setInterval(log, 60_000);
  return () => { clearTimeout(first); clearInterval(id); };
}
