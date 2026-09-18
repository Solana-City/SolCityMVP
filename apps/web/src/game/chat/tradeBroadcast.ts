/**
 * Stock trades shown in the city: "CitizenZero bought NVDA" floats over the
 * trader for everyone nearby.
 *
 * A trade rides the existing chat pipe (same ER message field, same poll) as
 * a short tagged line, and every client renders the tag as a trade bubble
 * instead of plain chat. Players can opt out in the Stocks Broker panel; the
 * bubble then only shows on their own screen.
 *
 * Note: the tag is plain chat text, so a player could type it by hand. That
 * only fakes a bubble about themselves, never moves funds, so it is accepted.
 */
import { getBasket, getStockByTicker } from "@/game/solana/stockCatalog";

const TAG = "§trade:";

export type TradeSide = "buy" | "sell";

export interface TradeAnnouncement {
  side: TradeSide;
  /** Single-stock trade. */
  ticker?: string;
  /** Basket buy (tickers come from the catalog). */
  basketId?: string;
}

export function encodeTrade(t: TradeAnnouncement): string {
  return t.basketId ? `${TAG}${t.side}:basket:${t.basketId}` : `${TAG}${t.side}:${t.ticker}`;
}

/** Parses a chat line; null when it isn't a (valid) trade tag. */
export function decodeTrade(text: string): TradeAnnouncement | null {
  if (!text.startsWith(TAG)) return null;
  const [side, a, b] = text.slice(TAG.length).split(":");
  if (side !== "buy" && side !== "sell") return null;
  if (a === "basket") return b && getBasket(b) ? { side, basketId: b } : null;
  return a && getStockByTicker(a) ? { side, ticker: a } : null;
}

/** "BOUGHT NVDA" / "SOLD NVDA" / "BOUGHT BIG TECH". */
export function tradeHeadline(t: TradeAnnouncement): string {
  const verb = t.side === "buy" ? "BOUGHT" : "SOLD";
  const what = t.basketId ? getBasket(t.basketId)?.name.toUpperCase() : t.ticker;
  return `${verb} ${what ?? ""}`.trim();
}

/** Chat-log line, e.g. "bought NVDA" or "bought the Big Tech basket". */
export function tradeLogLine(t: TradeAnnouncement): string {
  const verb = t.side === "buy" ? "bought" : "sold";
  if (t.basketId) return `${verb} the ${getBasket(t.basketId)?.name ?? "stock"} basket`;
  return `${verb} ${t.ticker}`;
}

// ── Share preference (per browser) ────────────────────────────────────────

const SHARE_KEY = "solcity:stocks:share-trades";

/** Whether this player's trades are announced to the city. On by default. */
export function getShareTrades(): boolean {
  try { return localStorage.getItem(SHARE_KEY) !== "0"; } catch { return true; }
}

export function setShareTrades(share: boolean): void {
  try { localStorage.setItem(SHARE_KEY, share ? "1" : "0"); } catch { /* storage blocked */ }
}
