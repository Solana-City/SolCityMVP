/**
 * Live screens on the Stocklana building (Tiled layer BuildStocklana).
 *
 * The art ships with blank dark screens; this draws market data into them:
 *   - the wide band under the STOCKLANA sign: a scrolling LED ticker
 *   - the two tall side screens: big rows of logo + ticker + 24h move,
 *     gainers first, rotating
 *
 * Each screen is ONE canvas texture sized exactly to its rectangle in the
 * art and painted with the 2D canvas API. Nothing can spill outside it (no
 * masks), and it looks the same under WebGL (desktop) and the Canvas
 * renderer (mobile), which disagreed when this was built from loose text,
 * shape and masked-container objects. Textures are painted at the camera's
 * zoom, so one art pixel is exactly one screen pixel block and text stays
 * crisp at every zoom level.
 *
 * Positions are measured in the art's own pixels and anchored to wherever the
 * layer's tiles sit, so moving the building in Tiled moves the screens too.
 * They follow the building's fade when the player walks behind it. Data comes
 * from the shared stockMarket feed (one Price API poll for the whole game).
 */
import * as Phaser from "phaser";
import { STOCKS, stockMarket, getMarketClock, type StockInfo, type StockMarketState } from "../solana/stocks";

/** Screen rectangles in BuildStocklana art pixels (from its top-left tile). */
const BAND = { x: 33, y: 67, w: 270, h: 17 };
const SCREEN_LEFT = { x: 37, y: 102, w: 49, h: 75 };
const SCREEN_RIGHT = { x: 250, y: 102, w: 49, h: 75 };
/** Stocks per side screen, kept low so each stays legible when zoomed out. */
const ROWS_PER_SCREEN = 2;
const PAGE_MS = 6000;
/** LED scroll speed in art pixels per second. */
const SCROLL_SPEED = 24;

const FONT = '"Press Start 2P", monospace';
const UP = "#14F195";
const DOWN = "#FF4D6D";
const FLAT = "#9AA4B2";
const SCREEN_BG = "#0f222f";

type Rect = { x: number; y: number; w: number; h: number };
type Row = { stock: StockInfo; change: number };
type TickerItem = { text: string; color: string; gapAfter: number };

let surfaceSeq = 0;

/**
 * A rectangle of the building painted through one canvas texture. `scale` is
 * texture pixels per art pixel; the image is always displayed at the art
 * rectangle's size, so the scale only changes sharpness, never size.
 */
class Surface {
  private readonly key = `stocklana-screen-${++surfaceSeq}`;
  private tex: Phaser.Textures.CanvasTexture | null = null;
  readonly image: Phaser.GameObjects.Image;
  scale = 0;

  constructor(private scene: Phaser.Scene, readonly rect: Rect, depth: number) {
    this.image = scene.add.image(rect.x, rect.y, "__DEFAULT").setOrigin(0).setDepth(depth);
  }

  /** Recreates the texture when the scale changes. Returns true if it did. */
  ensureScale(scale: number): boolean {
    if (scale === this.scale && this.tex) return false;
    this.scale = scale;
    const textures = this.scene.textures;
    if (textures.exists(this.key)) textures.remove(this.key);
    this.tex = textures.createCanvas(this.key, Math.round(this.rect.w * scale), Math.round(this.rect.h * scale));
    this.image.setTexture(this.key).setDisplaySize(this.rect.w, this.rect.h);
    return true;
  }

  /** Paints with art-pixel coordinates (the context is pre-scaled). */
  paint(draw: (ctx: CanvasRenderingContext2D) => void) {
    if (!this.tex) return;
    const ctx = this.tex.getContext();
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, this.rect.w, this.rect.h);
    ctx.fillStyle = SCREEN_BG;
    ctx.fillRect(0, 0, this.rect.w, this.rect.h);
    draw(ctx);
    ctx.restore();
    this.tex.refresh();
  }

  destroy() {
    this.image.destroy();
    if (this.scene.textures.exists(this.key)) this.scene.textures.remove(this.key);
  }
}

export function createStockExchange(
  scene: Phaser.Scene,
  building: Phaser.Tilemaps.TilemapLayer | undefined,
): () => void {
  if (!building) return () => {};
  const origin = layerOrigin(building);
  if (!origin) return () => {};
  const world = (r: Rect): Rect => ({ x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h });
  // Just above the building layer: same y-sort, so the player still walks in
  // front of it from the south and behind it from the north.
  const depth = building.depth + 1;
  const cleanups: Array<() => void> = [];

  const band = new Surface(scene, world(BAND), depth);
  const screens = [new Surface(scene, world(SCREEN_LEFT), depth), new Surface(scene, world(SCREEN_RIGHT), depth)];
  const surfaces = [band, ...screens];

  // ── State ─────────────────────────────────────────────────────────────
  let items: TickerItem[] = [];
  let tickerWidth = 0; // art px, measured at the current scale
  let offset = 0;      // art px scrolled so far
  let ranked: Row[] = [];
  let page = 0;

  const rebuildTicker = (state: StockMarketState) => {
    const clock = getMarketClock();
    items = [{ text: clock.wallStreetOpen ? "NYSE OPEN" : "WALL ST CLOSED. SOLANA IS OPEN", color: "#FFD27A", gapAfter: 24 }];
    for (const s of STOCKS) {
      const q = state.quotes[s.mint];
      const change = q ? q.change24h : 0;
      items.push({ text: s.ticker, color: "#FFFFFF", gapAfter: 5 });
      items.push({
        text: q ? `$${fmtPrice(q.usdPrice)} ${fmtPct(change)}` : "...",
        color: !q ? FLAT : change > 0 ? UP : change < 0 ? DOWN : FLAT,
        gapAfter: 22,
      });
    }
    tickerWidth = 0; // re-measured on the next paint
  };

  const paintBand = () => band.paint((ctx) => {
    ctx.font = `7px ${FONT}`;
    ctx.textBaseline = "middle";
    if (!tickerWidth) {
      tickerWidth = items.reduce((w, it) => w + ctx.measureText(it.text).width + it.gapAfter, 0);
    }
    if (!tickerWidth) return;
    // Loop: the strip enters from the right edge and wraps once it has left.
    const cycle = tickerWidth + band.rect.w;
    let x = band.rect.w - (offset % cycle);
    const y = band.rect.h / 2 + 0.5;
    for (const it of items) {
      const w = ctx.measureText(it.text).width;
      if (x + w > 0 && x < band.rect.w) {
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, x, y);
      }
      x += w + it.gapAfter;
    }
  });

  const paintScreens = () => {
    const gainers = ranked.filter((r) => r.change > 0);
    const perPage = ROWS_PER_SCREEN * screens.length;
    // Rotate through the gainers; top up with the best of the rest if short.
    const pool = gainers.length >= perPage ? gainers : ranked.slice(0, perPage);
    if (!pool.length) return;
    const pages = Math.max(1, Math.ceil(pool.length / perPage));
    page %= pages;
    // Wrap around the end of the list so every page is full: with 5 gainers
    // the second page shows #5 plus #1-#3, never one stock and an empty half.
    // (pool.length >= perPage whenever there are enough stocks, so a page
    // never repeats a stock.)
    const rows = Array.from({ length: Math.min(perPage, pool.length) }, (_, j) => pool[(page * perPage + j) % pool.length]);
    screens.forEach((s, i) => s.paint((ctx) => paintScreen(ctx, scene, s.rect, rows.slice(i * ROWS_PER_SCREEN, (i + 1) * ROWS_PER_SCREEN))));
  };

  // ── Scale follows the camera zoom (1 art px = 1 screen px block) ──────
  const syncScale = () => {
    const scale = Phaser.Math.Clamp(Math.round(scene.cameras.main.zoom), 1, 8);
    let changed = false;
    for (const s of surfaces) changed = s.ensureScale(scale) || changed;
    if (changed) { tickerWidth = 0; paintBand(); paintScreens(); }
  };
  syncScale();

  // ── Timers and per-frame work ─────────────────────────────────────────
  const pageTimer = scene.time.addEvent({ delay: PAGE_MS, loop: true, callback: () => { page++; paintScreens(); } });
  cleanups.push(() => pageTimer.remove());

  let sinceBandPaint = 0;
  const onUpdate = (_t: number, dt: number) => {
    syncScale();
    const alpha = building.alpha;
    for (const s of surfaces) s.image.setAlpha(alpha);
    offset += (dt / 1000) * SCROLL_SPEED;
    // ~30 fps is plenty for a 24 px/s scroll and halves the canvas work.
    sinceBandPaint += dt;
    if (sinceBandPaint >= 33) { sinceBandPaint = 0; paintBand(); }
  };
  scene.events.on("update", onUpdate);
  cleanups.push(() => scene.events.off("update", onUpdate));

  // Company logos, served same-origin by /api/stock-logo so the canvas may
  // draw them without tainting. Rows show a colored dot until one loads.
  let pendingLogos = 0;
  for (const s of STOCKS) {
    if (scene.textures.exists(logoKey(s))) continue;
    scene.load.image(logoKey(s), `/api/stock-logo/${s.ticker}`);
    pendingLogos++;
  }
  if (pendingLogos) {
    const onLogos = () => paintScreens();
    scene.load.once(Phaser.Loader.Events.COMPLETE, onLogos);
    cleanups.push(() => scene.load.off(Phaser.Loader.Events.COMPLETE, onLogos));
    scene.load.start();
  }

  let lastUpdate = -1;
  cleanups.push(stockMarket.subscribe((state) => {
    if (state.updatedAt === lastUpdate) return;
    lastUpdate = state.updatedAt;
    rebuildTicker(state);
    ranked = STOCKS
      .filter((s) => state.quotes[s.mint])
      .map((s) => ({ stock: s, change: state.quotes[s.mint].change24h }))
      .sort((a, b) => b.change - a.change);
    paintScreens();
  }));

  cleanups.push(() => { for (const s of surfaces) s.destroy(); });
  return () => { for (const c of cleanups.splice(0)) c(); };
}

/** One side screen: stacked cells of logo, ticker and 24h move. */
function paintScreen(ctx: CanvasRenderingContext2D, scene: Phaser.Scene, r: Rect, rows: Row[]) {
  const pad = 2;
  const cellW = r.w - pad * 2;
  const cellH = (r.h - pad * (ROWS_PER_SCREEN + 1)) / ROWS_PER_SCREEN;
  const logoSize = 16;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `6px ${FONT}`;

  rows.forEach((row, i) => {
    const top = pad + i * (cellH + pad);
    const cx = r.w / 2;
    // Tint the cell by the move; stronger move, stronger tint (capped at 3%).
    const k = Math.min(Math.abs(row.change) / 3, 1);
    ctx.fillStyle = row.change >= 0 ? mix("#14303a", "#0f6b4c", k) : mix("#14303a", "#6b1f33", k);
    ctx.fillRect(pad, top, cellW, cellH);

    const logoY = top + 3 + logoSize / 2;
    const tex = scene.textures.exists(logoKey(row.stock)) ? scene.textures.get(logoKey(row.stock)) : null;
    // White disc behind the logo so dark marks (Apple, Tesla) stay visible;
    // the brand color stands in until the logo has loaded.
    ctx.fillStyle = tex ? "#FFFFFF" : row.stock.color;
    ctx.beginPath();
    ctx.arc(cx, logoY, logoSize / 2 + 1, 0, Math.PI * 2);
    ctx.fill();
    if (tex) {
      const img = tex.getSourceImage() as CanvasImageSource;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, logoY, logoSize / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, cx - logoSize / 2, logoY - logoSize / 2, logoSize, logoSize);
      ctx.restore();
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(row.stock.ticker, cx, logoY + logoSize / 2 + 5, cellW - 2);
    ctx.fillStyle = row.change > 0 ? UP : row.change < 0 ? DOWN : FLAT;
    ctx.fillText(fmtPct(row.change), cx, logoY + logoSize / 2 + 12, cellW - 2);
  });
}

/** World position of the layer's top-left painted tile. */
function layerOrigin(layer: Phaser.Tilemaps.TilemapLayer): { x: number; y: number } | null {
  let col = Infinity, row = Infinity;
  layer.forEachTile((t: Phaser.Tilemaps.Tile) => {
    if (t.index <= 0) return;
    if (t.x < col) col = t.x;
    if (t.y < row) row = t.y;
  });
  if (!isFinite(col)) return null;
  return { x: layer.tileToWorldX(col)!, y: layer.tileToWorldY(row)! };
}

const logoKey = (s: StockInfo) => `stock-logo-${s.ticker}`;

/** Linear mix of two #rrggbb colors. */
function mix(a: string, b: string, k: number): string {
  const ch = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const ca = ch(a), cb = ch(b);
  return `rgb(${ca.map((v, i) => Math.round(v + (cb[i] - v) * k)).join(",")})`;
}

export function fmtPrice(n: number): string {
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

export function fmtPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}
