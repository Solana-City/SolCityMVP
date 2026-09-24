import * as Phaser from "phaser";
import { basketStocks, getBasket, getStockByTicker, type StockInfo } from "@/game/solana/stockCatalog";
import { tradeHeadline, type TradeAnnouncement } from "./tradeBroadcast";

const DURATION = 5000;
const LOGO = 12;
const LOGO_OVERLAP = 4;
const PAD = 5;
const Y = -46; // just above the head, where chat bubbles sit

/**
 * "BOUGHT NVDA" over a trader's head: the stock logo(s) and the headline in
 * green (buy) or red (sell) on a dark, gold-edged tag, so it reads as a
 * market event rather than chat. Logos come from the textures the Stocklana
 * screens load; a brand-color dot stands in if one isn't loaded yet.
 */
export class TradeBubble {
  private container: Phaser.GameObjects.Container;
  private timer: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, target: Phaser.GameObjects.Container, trade: TradeAnnouncement) {
    const stocks: StockInfo[] = trade.basketId
      ? (getBasket(trade.basketId) ? basketStocks(getBasket(trade.basketId)!) : [])
      : [getStockByTicker(trade.ticker ?? "")].filter((s): s is StockInfo => !!s);

    const text = scene.add.text(0, 0, tradeHeadline(trade), {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: "7px",
      color: trade.side === "buy" ? "#B7E928" : "#FF4D6D",
      resolution: 2,
    }).setOrigin(0, 0.5);

    const logosW = stocks.length ? LOGO + (stocks.length - 1) * (LOGO - LOGO_OVERLAP) : 0;
    const gap = logosW ? 4 : 0;
    const w = PAD * 2 + logosW + gap + text.width;
    const h = Math.max(LOGO, text.height) + PAD * 2;
    const left = -w / 2;

    const bg = scene.add.graphics();
    bg.fillStyle(0x0b0f24, 0.92).fillRoundedRect(left, -h, w, h, 4);
    bg.lineStyle(1, 0xffb547, 1).strokeRoundedRect(left, -h, w, h, 4);
    bg.fillStyle(0x0b0f24, 0.92).fillTriangle(-3, 0, 3, 0, 0, 5);

    const parts: Phaser.GameObjects.GameObject[] = [bg];
    const midY = -h / 2;
    stocks.forEach((s, i) => {
      const cx = left + PAD + LOGO / 2 + i * (LOGO - LOGO_OVERLAP);
      // White disc so dark marks (Apple, Tesla) stay visible; brand color
      // until the logo texture exists.
      const key = `stock-logo-${s.ticker}`;
      const has = scene.textures.exists(key);
      parts.push(scene.add.circle(cx, midY, LOGO / 2 + 1, has ? 0xffffff : Phaser.Display.Color.HexStringToColor(s.color).color));
      if (has) parts.push(scene.add.image(cx, midY, key).setDisplaySize(LOGO, LOGO));
    });
    text.setPosition(left + PAD + logosW + gap, midY);
    parts.push(text);

    this.container = scene.add.container(0, Y, parts);
    target.add(this.container);

    // Pop in, hold, fade out.
    this.container.setScale(0.6);
    scene.tweens.add({ targets: this.container, scale: 1, duration: 180, ease: "Back.Out" });
    scene.tweens.add({ targets: this.container, alpha: 0, delay: DURATION - 500, duration: 500 });
    this.timer = scene.time.delayedCall(DURATION, () => this.destroy());
  }

  destroy(): void {
    this.timer?.destroy();
    this.container?.destroy();
  }
}
