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

/** "$10", "$2.50": whole dollars stay whole. */
function money(usd: number): string {
  return "$" + (Number.isInteger(usd) ? usd : usd.toFixed(2));
}

const TAG = "§trade:";

export type TradeSide = "buy" | "sell";

export interface TradeAnnouncement {
  side: TradeSide;
  /** Single-stock trade. */
  ticker?: string;
  /** Basket buy (tickers come from the catalog). */
  basketId?: string;
  /** Size of the trade in USD, shown in the tag and the chat line. */
  usd?: number;
}

export function encodeTrade(t: TradeAnnouncement): string {
  const what = t.basketId ? `basket:${t.basketId}` : t.ticker;
  // The amount is optional: an older client's tag still parses.
  return `${TAG}${t.side}:${what}${t.usd && t.usd > 0 ? `:${t.usd.toFixed(2)}` : ""}`;
}

/** Parses a chat line; null when it isn't a (valid) trade tag. */
export function decodeTrade(text: string): TradeAnnouncement | null {
  if (!text.startsWith(TAG)) return null;
  const parts = text.slice(TAG.length).split(":");
  const side = parts[0];
  if (side !== "buy" && side !== "sell") return null;
  const isBasket = parts[1] === "basket";
  const what = isBasket ? parts[2] : parts[1];
  const usd = Number(isBasket ? parts[3] : parts[2]);
  const amount = usd > 0 && isFinite(usd) ? { usd } : {};
  if (isBasket) return what && getBasket(what) ? { side, basketId: what, ...amount } : null;
  return what && getStockByTicker(what) ? { side, ticker: what, ...amount } : null;
}

/** "BOUGHT $10 OF APPLE" / "SOLD NVIDIA" / "BOUGHT $25 OF BIG TECH". */
export function tradeHeadline(t: TradeAnnouncement): string {
  const verb = t.side === "buy" ? "BOUGHT" : "SOLD";
  const what = (t.basketId ? getBasket(t.basketId)?.name : getStockByTicker(t.ticker ?? "")?.name) ?? t.ticker ?? "";
  const size = t.usd && t.usd > 0 ? `${money(t.usd)} OF ` : "";
  return `${verb} ${size}${what}`.trim().toUpperCase();
}

/** Chat-log line, e.g. "bought $10 of Apple" or "bought the Big Tech basket". */
export function tradeLogLine(t: TradeAnnouncement): string {
  const verb = t.side === "buy" ? "bought" : "sold";
  const size = t.usd && t.usd > 0 ? `${money(t.usd)} of ` : "";
  if (t.basketId) return `${verb} ${size}the ${getBasket(t.basketId)?.name ?? "stock"} basket`;
  const name = getStockByTicker(t.ticker ?? "")?.name ?? t.ticker;
  return `${verb} ${size}${name}`;
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
