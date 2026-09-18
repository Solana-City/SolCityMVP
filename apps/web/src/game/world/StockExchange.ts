/**
 * Live screens on the Stocklana building (Tiled layer BuildStocklana).
 *
 * The art ships with blank dark screens; this draws market data into them:
 *   - the wide band under the STOCKLANA sign: a scrolling LED ticker
 *   - the two tall side screens: big rows of logo + ticker + 24h move,
 *     gainers first, rotating
 * Positions are measured in the art's own pixels and anchored to wherever the
 * layer's tiles sit, so moving the building in Tiled moves the screens too.
 * They also copy the building layer's fade when the player walks behind it.
 *
 * Data comes from the shared stockMarket feed (one Price API poll for the
 * whole game).
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

const FONT = '"Press Start 2P", monospace';
const UP = "#14F195";
const DOWN = "#FF4D6D";
const FLAT = "#9AA4B2";

type Rect = { x: number; y: number; w: number; h: number };
type Row = { stock: StockInfo; change: number };

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
  const objects: Phaser.GameObjects.GameObject[] = [];

  // ── LED ticker in the band ────────────────────────────────────────────
  const band = world(BAND);
  const ticker = scene.add.container(band.x + band.w, band.y + band.h / 2).setDepth(depth + 1);
  const maskShape = scene.make.graphics({}, false).fillRect(band.x, band.y, band.w, band.h);
  ticker.setMask(maskShape.createGeometryMask());
  objects.push(ticker, maskShape);
  let tickerWidth = 0;

  const rebuildTicker = (state: StockMarketState) => {
    ticker.removeAll(true);
    let x = 0;
    const clock = getMarketClock();
    const lead = scene.add.text(x, 0, clock.wallStreetOpen ? "NYSE OPEN" : "WALL ST CLOSED. SOLANA IS OPEN", {
      fontFamily: FONT, fontSize: "7px", color: "#FFD27A",
    }).setOrigin(0, 0.5).setResolution(4);
    x += lead.width + 24;
    ticker.add(lead);
    for (const s of STOCKS) {
      const q = state.quotes[s.mint];
      const label = scene.add.text(x, 0, s.ticker, { fontFamily: FONT, fontSize: "7px", color: "#FFFFFF" })
        .setOrigin(0, 0.5).setResolution(4);
      x += label.width + 5;
      const change = q ? q.change24h : 0;
      const val = scene.add.text(x, 0, q ? `$${fmtPrice(q.usdPrice)} ${fmtPct(change)}` : "...", {
        fontFamily: FONT, fontSize: "7px", color: !q ? FLAT : change > 0 ? UP : change < 0 ? DOWN : FLAT,
      }).setOrigin(0, 0.5).setResolution(4);
      x += val.width + 22;
      ticker.add([label, val]);
    }
    tickerWidth = x;
  };

  // ── Side screens ──────────────────────────────────────────────────────
  const screens = [buildScreen(scene, world(SCREEN_LEFT), depth), buildScreen(scene, world(SCREEN_RIGHT), depth)];
  const perPage = ROWS_PER_SCREEN * screens.length;
  let ranked: Row[] = [];
  let page = 0;
  const showPage = () => {
    const gainers = ranked.filter((r) => r.change > 0);
    // Rotate through the gainers; top up with the best of the rest if short.
    const pool = gainers.length >= perPage ? gainers : ranked.slice(0, perPage);
    const pages = Math.max(1, Math.ceil(pool.length / perPage));
    page %= pages;
    const rows = pool.slice(page * perPage, page * perPage + perPage);
    screens.forEach((s, i) => s.show(rows.slice(i * ROWS_PER_SCREEN, (i + 1) * ROWS_PER_SCREEN)));
  };
  const pageTimer = scene.time.addEvent({ delay: PAGE_MS, loop: true, callback: () => { page++; showPage(); } });
  cleanups.push(() => pageTimer.remove());

  // Company logos, served same-origin by /api/stock-logo so the canvas may
  // draw them. Rows show a colored dot until (or if never) a logo loads.
  let pendingLogos = 0;
  for (const s of STOCKS) {
    if (scene.textures.exists(logoKey(s))) continue;
    scene.load.image(logoKey(s), `/api/stock-logo/${s.ticker}`);
    pendingLogos++;
  }
  if (pendingLogos) {
    const onLogos = () => { if (ranked.length) showPage(); };
    scene.load.once(Phaser.Loader.Events.COMPLETE, onLogos);
    cleanups.push(() => scene.load.off(Phaser.Loader.Events.COMPLETE, onLogos));
    scene.load.start();
  }

  // ── Per frame: scroll the ticker, follow the building's fade ──────────
  const onUpdate = (_t: number, dt: number) => {
    const alpha = building.alpha;
    ticker.setAlpha(alpha);
    for (const s of screens) s.setAlpha(alpha);
    if (!tickerWidth) return;
    ticker.x -= (dt / 1000) * 24;
    if (ticker.x < band.x - tickerWidth) ticker.x = band.x + band.w;
  };
  scene.events.on("update", onUpdate);
  cleanups.push(() => scene.events.off("update", onUpdate));

  let lastUpdate = -1;
  cleanups.push(stockMarket.subscribe((state) => {
    if (state.updatedAt === lastUpdate) return;
    lastUpdate = state.updatedAt;
    rebuildTicker(state);
    ranked = STOCKS
      .filter((s) => state.quotes[s.mint])
      .map((s) => ({ stock: s, change: state.quotes[s.mint].change24h }))
      .sort((a, b) => b.change - a.change);
    showPage();
  }));

  cleanups.push(() => {
    for (const o of objects) o.destroy();
    for (const s of screens) s.destroy();
  });
  return () => { for (const c of cleanups.splice(0)) c(); };
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

/** A tall screen split into a few stacked cells: logo, ticker, 24h move. */
function buildScreen(scene: Phaser.Scene, r: Rect, depth: number) {
  const pad = 2;
  const cellH = (r.h - pad * (ROWS_PER_SCREEN + 1)) / ROWS_PER_SCREEN;
  const logoSize = 16;
  const cells = Array.from({ length: ROWS_PER_SCREEN }, (_, i) => {
    const cy = r.y + pad + i * (cellH + pad);
    const cx = r.x + r.w / 2;
    const bg = scene.add.rectangle(r.x + pad, cy, r.w - pad * 2, cellH, 0x16323a).setOrigin(0).setDepth(depth + 1);
    const logoY = cy + 3 + logoSize / 2;
    // White disc behind the logo so dark marks (Apple, Tesla) stay visible.
    const disc = scene.add.circle(cx, logoY, logoSize / 2 + 1, 0xffffff).setDepth(depth + 2);
    const logo = scene.add.image(cx, logoY, "__MISSING").setDepth(depth + 3).setVisible(false);
    const name = scene.add.text(cx, logoY + logoSize / 2 + 5, "", {
      fontFamily: FONT, fontSize: "6px", color: "#FFFFFF",
    }).setOrigin(0.5, 0.5).setDepth(depth + 3).setResolution(4);
    const move = scene.add.text(cx, logoY + logoSize / 2 + 12, "", {
      fontFamily: FONT, fontSize: "6px", color: UP,
    }).setOrigin(0.5, 0.5).setDepth(depth + 3).setResolution(4);
    return { bg, disc, logo, name, move };
  });
  const all = cells.flatMap((c) => [c.bg, c.disc, c.logo, c.name, c.move]);

  return {
    show(rows: Row[]) {
      cells.forEach((c, i) => {
        const row = rows[i];
        for (const o of [c.bg, c.disc, c.name, c.move]) o.setVisible(!!row);
        if (!row) { c.logo.setVisible(false); return; }
        // Tint the cell by the move; stronger move, stronger tint (capped at 3%).
        const k = Math.min(Math.abs(row.change) / 3, 1);
        c.bg.setFillStyle(row.change >= 0 ? lerpColor(0x14303a, 0x0f6b4c, k) : lerpColor(0x14303a, 0x6b1f33, k));
        c.name.setText(row.stock.ticker);
        c.move.setText(fmtPct(row.change)).setColor(row.change > 0 ? UP : row.change < 0 ? DOWN : FLAT);
        const key = logoKey(row.stock);
        if (scene.textures.exists(key)) {
          c.logo.setTexture(key).setDisplaySize(logoSize, logoSize).setVisible(true);
          c.disc.setFillStyle(0xffffff);
        } else {
          c.logo.setVisible(false);
          c.disc.setFillStyle(Phaser.Display.Color.HexStringToColor(row.stock.color).color);
        }
      });
    },
    setAlpha(a: number) { for (const o of all) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(a); },
    destroy() { for (const o of all) o.destroy(); },
  };
}

const logoKey = (s: StockInfo) => `stock-logo-${s.ticker}`;

function lerpColor(a: number, b: number, k: number): number {
  const ch = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const [ar, ag, ab] = ch(a), [br, bg, bb] = ch(b);
  return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
}

export function fmtPrice(n: number): string {
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

export function fmtPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}
