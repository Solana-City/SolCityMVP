/**
 * Sunrise Stock Exchange: the north district of the city.
 *
 * PLACEHOLDER ART. The building and the two quote boards are drawn with
 * Phaser graphics until the original sprites land. Their footprint is written
 * into the hidden ColliderAuto layer as solid tiles, so everything that asks
 * "is this tile walkable?" (player collision, NPC spawn, NPC wander, fast
 * travel) treats them like any Tiled building, with no special cases.
 *
 * Live data: the LED ticker, the two heat-map boards and the NYSE sign all
 * read the shared stockMarket feed (one Price API poll for the whole game).
 */
import * as Phaser from "phaser";
import { STOCKS, stockMarket, getMarketClock, type StockMarketState } from "../solana/stocks";

/** Empty north plaza, straight up the fountain axis (col 78). */
const BUILDING = { col: 72, row: 6, w: 14, h: 10 };
const BOARD_LEFT = { col: 65, row: 11, w: 6, h: 5 };
const BOARD_RIGHT = { col: 87, row: 11, w: 6, h: 5 };

const FONT = '"Press Start 2P", monospace';
const UP = "#14F195";
const DOWN = "#FF4D6D";
const FLAT = "#9AA4B2";

export function createStockExchange(
  scene: Phaser.Scene,
  map: Phaser.Tilemaps.Tilemap,
  colliderLayer: Phaser.Tilemaps.TilemapLayer | undefined,
): () => void {
  const T = map.tileWidth;
  const px = (tiles: number) => tiles * T;
  const cleanups: Array<() => void> = [];

  blockFootprint(colliderLayer, BUILDING.col, BUILDING.row, BUILDING.w, BUILDING.h);
  // Boards stand on two posts; only the posts block, you can walk under the face.
  for (const b of [BOARD_LEFT, BOARD_RIGHT]) {
    blockFootprint(colliderLayer, b.col + 1, b.row + b.h - 1, 1, 1);
    blockFootprint(colliderLayer, b.col + b.w - 2, b.row + b.h - 1, 1, 1);
  }

  // ── Building ──────────────────────────────────────────────────────────
  const bx = px(BUILDING.col), by = px(BUILDING.row), bw = px(BUILDING.w), bh = px(BUILDING.h);
  const baseDepth = by + bh; // y-sort like a Tiled building: its ground line
  const g = scene.add.graphics().setDepth(baseDepth);

  // Shadow + body
  g.fillStyle(0x000000, 0.25).fillRect(bx + 6, by + 10, bw, bh);
  g.fillStyle(0x1b2140, 1).fillRect(bx, by + px(1.5), bw, bh - px(1.5));
  // Pediment roof with sunrise gold trim
  g.fillStyle(0x262d55, 1).fillTriangle(bx - 6, by + px(1.6), bx + bw / 2, by - px(0.6), bx + bw + 6, by + px(1.6));
  g.fillStyle(0xffb547, 1).fillRect(bx - 6, by + px(1.5), bw + 12, 4);
  // Rising sun in the pediment
  g.fillStyle(0xffb547, 1).fillCircle(bx + bw / 2, by + px(1.45), 14);
  g.fillStyle(0x262d55, 1).fillRect(bx + bw / 2 - 16, by + px(1.45), 32, 16);
  // Sign band + LED band
  g.fillStyle(0x0b0f24, 1).fillRect(bx + 8, by + px(1.9), bw - 16, px(1));
  g.fillStyle(0x000000, 1).fillRect(bx + 8, by + px(3.1), bw - 16, px(1));
  g.lineStyle(2, 0xffb547, 1).strokeRect(bx + 8, by + px(3.1), bw - 16, px(1));
  // Columns
  g.fillStyle(0xd9dce8, 1);
  for (let i = 0; i < 6; i++) {
    const cx = bx + px(1) + i * ((bw - px(2)) / 5) - 5;
    g.fillRect(cx, by + px(4.4), 10, px(5.1));
    g.fillStyle(0xb8bccb, 1).fillRect(cx - 3, by + px(4.3), 16, 4).fillRect(cx - 3, by + px(9.4), 16, 4);
    g.fillStyle(0xd9dce8, 1);
  }
  // Door + steps
  g.fillStyle(0x0b0f24, 1).fillRect(bx + bw / 2 - px(1), by + px(7), px(2), px(2.5));
  g.fillStyle(0xffb547, 0.9).fillRect(bx + bw / 2 - px(1), by + px(7), px(2), 3);
  g.fillStyle(0x8c93a8, 1).fillRect(bx + px(3), by + bh - 8, bw - px(6), 8);

  const sign = scene.add.text(bx + bw / 2, by + px(2.4), "SUNRISE STOCK EXCHANGE", {
    fontFamily: FONT, fontSize: "8px", color: "#FFD27A",
  }).setOrigin(0.5).setDepth(baseDepth + 1).setResolution(4);

  // NYSE status plate over the door
  const nyse = scene.add.text(bx + bw / 2, by + px(6.4), "", {
    fontFamily: FONT, fontSize: "5px", color: UP, backgroundColor: "#0b0f24", padding: { x: 3, y: 2 },
  }).setOrigin(0.5).setDepth(baseDepth + 1).setResolution(4);
  const updateClock = () => {
    const c = getMarketClock();
    nyse.setText(c.wallStreetOpen ? "NYSE OPEN" : "AFTER HOURS. SOLANA IS OPEN");
    nyse.setColor(c.wallStreetOpen ? UP : "#FFD27A");
  };
  updateClock();
  const clockTimer = scene.time.addEvent({ delay: 30_000, loop: true, callback: updateClock });
  cleanups.push(() => clockTimer.remove());

  // ── LED ticker (scrolls right to left, masked to the band) ────────────
  const bandX = bx + 10, bandW = bw - 20, bandY = by + px(3.6);
  const ticker = scene.add.container(bandX + bandW, bandY).setDepth(baseDepth + 2);
  const maskShape = scene.make.graphics({}, false).fillRect(bandX, by + px(3.1), bandW, px(1));
  ticker.setMask(maskShape.createGeometryMask());
  let tickerWidth = 0;

  const rebuildTicker = (state: StockMarketState) => {
    ticker.removeAll(true);
    let x = 0;
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

  const onUpdate = (_t: number, dt: number) => {
    if (!tickerWidth) return;
    ticker.x -= (dt / 1000) * 28;
    if (ticker.x < bandX - tickerWidth) ticker.x = bandX + bandW;
  };
  scene.events.on("update", onUpdate);
  cleanups.push(() => scene.events.off("update", onUpdate));

  // ── Heat-map quote boards ─────────────────────────────────────────────
  const half = Math.ceil(STOCKS.length / 2);
  const boards = [
    buildBoard(scene, BOARD_LEFT, T, STOCKS.slice(0, half)),
    buildBoard(scene, BOARD_RIGHT, T, STOCKS.slice(half)),
  ];

  let lastRebuild = -1;
  const unsubscribe = stockMarket.subscribe((state) => {
    if (state.updatedAt === lastRebuild) return;
    lastRebuild = state.updatedAt;
    rebuildTicker(state);
    for (const b of boards) b.update(state);
  });
  cleanups.push(unsubscribe);

  cleanups.push(() => {
    g.destroy(); sign.destroy(); nyse.destroy(); ticker.destroy(); maskShape.destroy();
    for (const b of boards) b.destroy();
  });
  return () => { for (const c of cleanups.splice(0)) c(); };
}

/** Writes solid tiles into the hidden collider layer under a footprint. */
function blockFootprint(layer: Phaser.Tilemaps.TilemapLayer | undefined, col: number, row: number, w: number, h: number) {
  if (!layer) return;
  let index = 0;
  layer.forEachTile((t: Phaser.Tilemaps.Tile) => { if (!index && t.index > 0) index = t.index; });
  if (!index) return;
  for (let y = row; y < row + h; y++) {
    for (let x = col; x < col + w; x++) {
      const tile = layer.putTileAt(index, x, y);
      tile?.setCollision(true, true, true, true);
    }
  }
}

function buildBoard(
  scene: Phaser.Scene,
  area: { col: number; row: number; w: number; h: number },
  T: number,
  stocks: typeof STOCKS,
) {
  const x = area.col * T, y = area.row * T, w = area.w * T, h = area.h * T;
  const depth = y + h;
  const g = scene.add.graphics().setDepth(depth);
  // Posts + frame
  g.fillStyle(0x3a3f55, 1).fillRect(x + T + 8, y + h - T, 8, T).fillRect(x + w - 2 * T + 8, y + h - T, 8, T);
  g.fillStyle(0x000000, 0.25).fillRect(x + 4, y + 6, w, h - T);
  g.fillStyle(0x0b0f24, 1).fillRect(x, y, w, h - T);
  g.lineStyle(2, 0xffb547, 1).strokeRect(x, y, w, h - T);

  const cols = 2, rows = Math.ceil(stocks.length / cols);
  const pad = 4, cellW = (w - pad * 3) / cols, cellH = (h - T - pad * (rows + 1)) / rows;
  const cells = stocks.map((s, i) => {
    const cx = x + pad + (i % cols) * (cellW + pad);
    const cy = y + pad + Math.floor(i / cols) * (cellH + pad);
    const rect = scene.add.rectangle(cx, cy, cellW, cellH, 0x2a3048).setOrigin(0).setDepth(depth + 1);
    const label = scene.add.text(cx + cellW / 2, cy + cellH / 2, s.ticker, {
      fontFamily: FONT, fontSize: "5px", color: "#FFFFFF",
    }).setOrigin(0.5).setDepth(depth + 2).setResolution(4);
    return { s, rect, label };
  });

  return {
    update(state: StockMarketState) {
      for (const c of cells) {
        const q = state.quotes[c.s.mint];
        if (!q) continue;
        // Stronger move, stronger color; capped at 3% so one outlier doesn't wash the board.
        const k = Math.min(Math.abs(q.change24h) / 3, 1);
        const color = q.change24h >= 0 ? lerpColor(0x1f3a33, 0x14f195, k) : lerpColor(0x3d1f2a, 0xff4d6d, k);
        c.rect.setFillStyle(color);
        c.label.setText(`${c.s.ticker} ${fmtPct(q.change24h)}`);
      }
    },
    destroy() {
      g.destroy();
      for (const c of cells) { c.rect.destroy(); c.label.destroy(); }
    },
  };
}

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
