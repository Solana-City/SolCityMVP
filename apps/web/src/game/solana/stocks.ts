/**
 * Sunrise Stock Exchange data layer: tokenized stocks on Solana mainnet.
 *
 * Everything goes through Jupiter, no issuer SDK:
 *   - Catalog: fixed list of VERIFIED mints. Never search by ticker at runtime,
 *     Jupiter search returns dozens of fake "NVDAx" pump tokens.
 *   - Prices:  Price API V3, one request for every mint. Includes `stockData`,
 *     the Wall Street price, so we can show the on-chain premium.
 *   - Wallet:  Swap V2 /holdings, which covers SPL + Token-2022 (all stock
 *     tokens are Token-2022) without a mainnet RPC on our side.
 *   - Trades:  Swap V2 /order + /execute via jupiterSwap.ts.
 *
 * Issuers: Backpack Securities stocks are listed on Solana through Sunrise
 * (Wormhole Labs); xStocks are issued by Backed. Both are 1:1 backed.
 *
 * xStocks use the Token-2022 scaled UI amount extension (a dividend
 * multiplier), so value = raw amount x usdPricePrescaled, not ui x usdPrice.
 */

import type { VersionedTransaction } from "@solana/web3.js";
import { JUP_BASE, jupHeaders, getOrder, executeOrder, type OrderResponse } from "@/game/solana/jupiterSwap";

export * from "@/game/solana/stockCatalog";
import { STOCKS, SOL_MINT, USDC_MINT, type StockInfo } from "@/game/solana/stockCatalog";

// ── Prices ──────────────────────────────────────────────────────────────

export interface StockQuote {
  /** USD per displayed (scaled) token. */
  usdPrice: number;
  /** USD per raw-decimals token; differs from usdPrice only for scaled xStocks. */
  usdPricePrescaled: number;
  /** 24h change in percent (e.g. -0.42). */
  change24h: number;
  /** Last Wall Street price reported by the issuer, if any. */
  wallStreetPrice?: number;
  /** On-chain price vs Wall Street in percent (+0.3 = on-chain is 0.3% higher). */
  premiumPct?: number;
}

export interface StockMarketState {
  quotes: Record<string, StockQuote>;
  solPrice: number;
  /** ms epoch of the last successful price fetch, 0 before the first. */
  updatedAt: number;
  error?: string;
}

/** One Price V3 call for every stock + SOL (limit is 50 ids). */
export async function fetchStockPrices(): Promise<Omit<StockMarketState, "error">> {
  // Price V3 takes at most 50 ids per call, so the catalog goes in chunks.
  const ids = [SOL_MINT, ...STOCKS.map((s) => s.mint)];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const data: Record<string, any> = {};
  for (const chunk of chunks) {
    const res = await fetch(`${JUP_BASE}/price/v3?ids=${chunk.join(",")}`, { headers: jupHeaders() });
    if (!res.ok) throw new Error(res.status === 429 ? "Prices are busy, retrying." : `Price API failed (${res.status})`);
    Object.assign(data, await res.json());
  }

  // Pre-IPO tokens have no exchange price behind them; PreStocks publishes the
  // SPV's mark for the private company instead, which plays the same role as
  // the Wall Street price for listed stocks.
  const marks = await fetchPreIpoMarks();

  const quotes: Record<string, StockQuote> = {};
  for (const stock of STOCKS) {
    const p = data[stock.mint];
    if (!p || typeof p.usdPrice !== "number") continue;
    const wallStreet = stock.issuer === "prestocks"
      ? marks[stock.mint]
      : typeof p.stockData?.price === "number" ? p.stockData.price : undefined;
    quotes[stock.mint] = {
      usdPrice: p.usdPrice,
      usdPricePrescaled: typeof p.scaledUiConfig?.usdPricePrescaled === "number" ? p.scaledUiConfig.usdPricePrescaled : p.usdPrice,
      change24h: typeof p.priceChange24h === "number" ? p.priceChange24h : 0,
      wallStreetPrice: wallStreet,
      premiumPct: wallStreet ? ((p.usdPrice - wallStreet) / wallStreet) * 100 : undefined,
    };
  }
  return { quotes, solPrice: data[SOL_MINT]?.usdPrice ?? 0, updatedAt: Date.now() };
}

/**
 * PreStocks' own public list, mint -> the SPV's mark for the private company.
 * Never fails the price poll: without it the pre-IPO cards simply show no
 * premium.
 */
async function fetchPreIpoMarks(): Promise<Record<string, number>> {
  if (!STOCKS.some((s) => s.issuer === "prestocks")) return {};
  try {
    const res = await fetch("https://prestocks.com/api/prestocks");
    if (!res.ok) return {};
    const out: Record<string, number> = {};
    for (const a of (await res.json()) as Array<{ contract_address?: string; markPrice?: number | string }>) {
      const mark = Number(a.markPrice);
      if (a.contract_address && mark > 0) out[a.contract_address] = mark;
    }
    return out;
  } catch {
    return {};
  }
}

const POLL_MS = 15_000;
type MarketListener = (state: StockMarketState) => void;

/**
 * Shared live price feed. The ticker board, the exchange panel and the
 * portfolio all subscribe to this one poll instead of fetching on their own.
 * Polls only while someone is subscribed and the tab is visible.
 */
class StockMarketFeed {
  private state: StockMarketState = { quotes: {}, solPrice: 0, updatedAt: 0 };
  private listeners = new Set<MarketListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;

  getState(): StockMarketState { return this.state; }

  subscribe(listener: MarketListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    if (this.listeners.size === 1) {
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
      this.tick();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  /** Force a refresh now (e.g. right after a trade). */
  refresh(): Promise<void> { return this.tick(); }

  private onVisibility = () => {
    if (document.hidden) { if (this.timer) clearTimeout(this.timer); this.timer = null; }
    else if (!this.timer && this.listeners.size) this.tick();
  };

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private async tick(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.inFlight) {
      this.inFlight = true;
      try {
        this.state = await fetchStockPrices();
      } catch (err: any) {
        // Keep the last good prices on screen; just flag the error.
        this.state = { ...this.state, error: err?.message ?? "Price feed failed" };
      } finally {
        this.inFlight = false;
      }
      this.notify();
    }
    const hidden = typeof document !== "undefined" && document.hidden;
    if (this.listeners.size && !hidden) this.timer = setTimeout(() => this.tick(), POLL_MS);
  }

  private notify() {
    for (const l of this.listeners) {
      try { l(this.state); } catch (err) { console.error("[stockMarket] listener", err); }
    }
  }
}

export const stockMarket = new StockMarketFeed();

// ── Wall Street clock ───────────────────────────────────────────────────

// NYSE full-day closures, 2026. Early closes are treated as normal days.
const NYSE_HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);

export interface MarketClock {
  /** True during the NYSE regular session (9:30 to 16:00 New York time). */
  wallStreetOpen: boolean;
  /** New York time, "HH:MM". */
  nyTime: string;
  /** Minutes until the session opens (when closed) or closes (when open). */
  minutesToChange: number;
}

export function getMarketClock(now: Date = new Date()): MarketClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;
  const tradingDay = (weekday: string, isoDate: string) =>
    weekday !== "Sat" && weekday !== "Sun" && !NYSE_HOLIDAYS_2026.has(isoDate);

  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const open = tradingDay(parts.weekday, today) && minutes >= OPEN && minutes < CLOSE;

  let minutesToChange: number;
  if (open) {
    minutesToChange = CLOSE - minutes;
  } else {
    // Walk forward day by day to the next trading day's open.
    const isTodayBeforeOpen = tradingDay(parts.weekday, today) && minutes < OPEN;
    if (isTodayBeforeOpen) {
      minutesToChange = OPEN - minutes;
    } else {
      let days = 1;
      for (; days < 10; days++) {
        const d = new Date(now.getTime() + days * 86_400_000);
        const p = Object.fromEntries(
          new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
          }).formatToParts(d).map((x) => [x.type, x.value]),
        );
        if (tradingDay(p.weekday, `${p.year}-${p.month}-${p.day}`)) break;
      }
      minutesToChange = (24 * 60 - minutes) + (days - 1) * 24 * 60 + OPEN;
    }
  }
  return { wallStreetOpen: open, nyTime: `${parts.hour}:${parts.minute}`, minutesToChange };
}

// ── Wallet holdings ─────────────────────────────────────────────────────

export interface Holding {
  /** Raw smallest-unit amount, summed across the owner's token accounts. */
  raw: bigint;
  /** raw / 10^decimals, before any scaled-UI multiplier. */
  amount: number;
}

export interface WalletHoldings {
  sol: number;
  usdc: number;
  /** Stock mint -> holding. Only catalog stocks with a positive balance. */
  stocks: Record<string, Holding>;
}

// ── Venue: devnet test tokens or real mainnet stocks ───────────────────

export type StockVenue = "mainnet" | "devnet";
const VENUE_KEY = "solcity:stocks:venue";

/**
 * Where trades settle. Follows NEXT_PUBLIC_STOCKS_NETWORK, else
 * NEXT_PUBLIC_NETWORK (mainnet-beta -> mainnet, anything else -> devnet).
 * A ?stocks=mainnet or ?stocks=devnet URL param overrides it and sticks for
 * this browser, so the mainnet path can be demoed on the devnet deploy.
 */
export function getStockVenue(): StockVenue {
  if (typeof window !== "undefined") {
    try {
      const param = new URLSearchParams(window.location.search).get("stocks");
      if (param === "mainnet" || param === "devnet") localStorage.setItem(VENUE_KEY, param);
      const saved = localStorage.getItem(VENUE_KEY);
      if (saved === "mainnet" || saved === "devnet") return saved;
    } catch { /* storage blocked */ }
  }
  const env = process.env.NEXT_PUBLIC_STOCKS_NETWORK || process.env.NEXT_PUBLIC_NETWORK;
  return env === "mainnet" || env === "mainnet-beta" ? "mainnet" : "devnet";
}

const devnet = () => import("@/game/solana/devnetStocks");

/** Reads SOL, USDC and every catalog stock for the active venue. */
export async function fetchHoldings(owner: string): Promise<WalletHoldings> {
  if (getStockVenue() === "devnet") return (await devnet()).fetchDevnetHoldings(owner);
  return fetchMainnetHoldings(owner);
}

/** Mainnet: SOL, USDC and catalog stocks (SPL + Token-2022) via Jupiter. */
async function fetchMainnetHoldings(owner: string): Promise<WalletHoldings> {
  const res = await fetch(`${JUP_BASE}/swap/v2/holdings/${owner}`, { headers: jupHeaders() });
  if (!res.ok) throw new Error(`Holdings failed (${res.status})`);
  const data = (await res.json()) as { amount?: string; tokens?: Record<string, Array<{ amount: string; decimals: number }>> };

  const sumRaw = (mint: string) =>
    (data.tokens?.[mint] ?? []).reduce((acc, a) => acc + BigInt(a.amount || "0"), BigInt(0));
  const toAmount = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

  const stocks: Record<string, Holding> = {};
  for (const s of STOCKS) {
    const raw = sumRaw(s.mint);
    if (raw > BigInt(0)) stocks[s.mint] = { raw, amount: toAmount(raw, s.decimals) };
  }
  return {
    sol: toAmount(BigInt(data.amount || "0"), 9),
    usdc: toAmount(sumRaw(USDC_MINT), 6),
    stocks,
  };
}

/**
 * USD value of a holding. Mainnet uses the prescaled price so xStock dividends
 * count; devnet test tokens were minted at the plain price.
 */
export function holdingUsd(holding: Holding, quote: StockQuote | undefined): number {
  if (!quote) return 0;
  return holding.amount * (getStockVenue() === "mainnet" ? quote.usdPricePrescaled : quote.usdPrice);
}

// ── Trades ──────────────────────────────────────────────────────────────

export type PayToken = "USDC" | "SOL";

/** Keep this much SOL for fees + the stock's token account rent (~0.002). */
export const SOL_FEE_RESERVE = 0.01;

/** Order to buy `usd` worth of a stock, paid in USDC or SOL. */
export async function quoteBuy(params: {
  stock: StockInfo; usd: number; payWith: PayToken; taker: string; solPrice: number;
}): Promise<OrderResponse> {
  const { stock, usd, payWith, taker, solPrice } = params;
  if (!(usd > 0)) throw new Error("Pick an amount first.");
  if (getStockVenue() === "devnet") {
    const stockPrice = stockMarket.getState().quotes[stock.mint]?.usdPrice ?? 0;
    return (await devnet()).devnetBuyOrder({ stock, usd, owner: taker, solPrice, stockPrice });
  }
  let inputMint: string, amount: bigint;
  if (payWith === "USDC") {
    inputMint = USDC_MINT;
    amount = BigInt(Math.round(usd * 1e6));
  } else {
    if (!(solPrice > 0)) throw new Error("SOL price not loaded yet.");
    inputMint = SOL_MINT;
    amount = BigInt(Math.round((usd / solPrice) * 1e9));
  }
  return getOrder({ inputMint, outputMint: stock.mint, amount: amount.toString(), taker });
}

/** Order to sell `fraction` (0..1] of a holding into USDC or SOL. */
export async function quoteSell(params: {
  stock: StockInfo; holding: Holding; fraction: number; receive: PayToken; taker: string;
}): Promise<OrderResponse> {
  const { stock, holding, fraction, receive, taker } = params;
  if (!(fraction > 0 && fraction <= 1)) throw new Error("Invalid sell size.");
  // Integer math: selling 100% must send the exact raw balance, no float dust.
  const amount = fraction === 1 ? holding.raw : (holding.raw * BigInt(Math.round(fraction * 10_000))) / BigInt(10_000);
  if (amount <= BigInt(0)) throw new Error("Nothing to sell.");
  if (getStockVenue() === "devnet") {
    const { solPrice, quotes } = stockMarket.getState();
    return (await devnet()).devnetSellOrder({ stock, raw: amount, owner: taker, solPrice, stockPrice: quotes[stock.mint]?.usdPrice ?? 0 });
  }
  return getOrder({
    inputMint: stock.mint,
    outputMint: receive === "USDC" ? USDC_MINT : SOL_MINT,
    amount: amount.toString(),
    taker,
  });
}

/**
 * Lands a wallet-signed order on the active venue. Returns the signature and
 * the raw output amount that reached the wallet.
 */
export async function submitStockOrder(
  order: OrderResponse, signed: VersionedTransaction,
): Promise<{ signature: string; outAmount: string }> {
  if (getStockVenue() === "devnet") {
    const signature = await (await devnet()).submitDevnetOrder(order, signed);
    return { signature, outAmount: order.outAmount };
  }
  const res = await executeOrder(signed, order.requestId);
  return { signature: res.signature ?? "", outAmount: res.totalOutputAmount ?? res.outputAmountResult ?? order.outAmount };
}

/** Explorer link for a trade on the active venue. */
export function stockTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}${getStockVenue() === "devnet" ? "?cluster=devnet" : ""}`;
}
