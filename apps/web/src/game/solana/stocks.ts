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

import { JUP_BASE, jupHeaders, getOrder, type OrderResponse } from "@/game/solana/jupiterSwap";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type StockIssuer = "sunrise" | "xstocks";
export type StockSector = "index" | "tech" | "chips" | "auto" | "crypto" | "space" | "consumer" | "gaming" | "fintech";

export interface StockInfo {
  /** Wall Street ticker shown to players (NVDA, not NVDAx). */
  ticker: string;
  /** On-chain token symbol. */
  tokenSymbol: string;
  name: string;
  mint: string;
  decimals: number;
  issuer: StockIssuer;
  sector: StockSector;
  /** Card accent color. */
  color: string;
  logo: string;
}

const XSTOCK_LOGO = (sym: string) => `https://xstocks-metadata.backed.fi/logos/tokens/${sym}.png`;
const BACKPACK_LOGO = (sym: string) => `https://backpack.exchange/api/stock-logo/${sym}`;

// Verified on Jupiter Tokens V2 (tag "verified" + issuer tag), 2026-09-15.
// Ordered for the trading floor: best-known brands first, then indexes and the rest.
export const STOCKS: readonly StockInfo[] = [
  { ticker: "AAPL",  tokenSymbol: "AAPLx",  name: "Apple",         mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8, issuer: "xstocks", sector: "tech",     color: "#A2AAAD", logo: XSTOCK_LOGO("AAPLx") },
  { ticker: "GOOGL", tokenSymbol: "GOOGLx", name: "Alphabet",      mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8, issuer: "xstocks", sector: "tech",     color: "#4285F4", logo: XSTOCK_LOGO("GOOGLx") },
  { ticker: "AMZN",  tokenSymbol: "AMZNx",  name: "Amazon",        mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8, issuer: "xstocks", sector: "consumer", color: "#FF9900", logo: XSTOCK_LOGO("AMZNx") },
  { ticker: "TSLA",  tokenSymbol: "TSLAx",  name: "Tesla",         mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8, issuer: "xstocks", sector: "auto",     color: "#E82127", logo: XSTOCK_LOGO("TSLAx") },
  { ticker: "NVDA",  tokenSymbol: "NVDAx",  name: "NVIDIA",        mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, issuer: "xstocks", sector: "chips",    color: "#76B900", logo: XSTOCK_LOGO("NVDAx") },
  { ticker: "SPCX",  tokenSymbol: "SPCX",   name: "SpaceX",        mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", decimals: 6, issuer: "sunrise", sector: "space",    color: "#C8D1DC", logo: "https://s3-symbol-logo.tradingview.com/spacex.svg" },
  { ticker: "META",  tokenSymbol: "METAx",  name: "Meta",          mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", decimals: 8, issuer: "xstocks", sector: "tech",     color: "#0866FF", logo: XSTOCK_LOGO("METAx") },
  { ticker: "NKE",   tokenSymbol: "NKE",    name: "Nike",          mint: "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg", decimals: 6, issuer: "sunrise", sector: "consumer", color: "#F5F5F5", logo: BACKPACK_LOGO("NKE") },
  { ticker: "RBLX",  tokenSymbol: "RBLX",   name: "Roblox",        mint: "RBLXDGRD64AtRamHMFVcjqne3Ar7NLWtFtYNtsrf1cE", decimals: 6, issuer: "sunrise", sector: "gaming",   color: "#E2231A", logo: BACKPACK_LOGO("RBLX") },
  { ticker: "SPY",   tokenSymbol: "SPYx",   name: "S&P 500",       mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8, issuer: "xstocks", sector: "index",    color: "#E23B3B", logo: XSTOCK_LOGO("SPYx") },
  { ticker: "QQQ",   tokenSymbol: "QQQx",   name: "Nasdaq 100",    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", decimals: 8, issuer: "xstocks", sector: "index",    color: "#3B82F6", logo: XSTOCK_LOGO("QQQx") },
  { ticker: "COIN",  tokenSymbol: "COINx",  name: "Coinbase",      mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", decimals: 8, issuer: "xstocks", sector: "crypto",   color: "#0052FF", logo: XSTOCK_LOGO("COINx") },
  { ticker: "HOOD",  tokenSymbol: "HOOD",   name: "Robinhood",     mint: "HooDYv5RewLRiMLnEVq3VJqdqxhuE6c5eYvqejMC3e9A", decimals: 6, issuer: "sunrise", sector: "fintech",  color: "#CCFF00", logo: BACKPACK_LOGO("HOOD") },
  { ticker: "MSTR",  tokenSymbol: "MSTRx",  name: "Strategy",      mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8, issuer: "xstocks", sector: "crypto",   color: "#F7931A", logo: XSTOCK_LOGO("MSTRx") },
  { ticker: "CRCL",  tokenSymbol: "CRCLx",  name: "Circle",        mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8, issuer: "xstocks", sector: "crypto",   color: "#3D8BFF", logo: XSTOCK_LOGO("CRCLx") },
  { ticker: "MU",    tokenSymbol: "MU",     name: "Micron",        mint: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1", decimals: 6, issuer: "sunrise", sector: "chips",    color: "#0072CE", logo: BACKPACK_LOGO("MU") },
];

const BY_MINT = new Map(STOCKS.map((s) => [s.mint, s]));
const BY_TICKER = new Map(STOCKS.map((s) => [s.ticker, s]));

export function getStockByMint(mint: string): StockInfo | undefined { return BY_MINT.get(mint); }
export function getStockByTicker(ticker: string): StockInfo | undefined { return BY_TICKER.get(ticker); }

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
  const ids = [...STOCKS.map((s) => s.mint), SOL_MINT].join(",");
  const res = await fetch(`${JUP_BASE}/price/v3?ids=${ids}`, { headers: jupHeaders() });
  if (!res.ok) throw new Error(res.status === 429 ? "Prices are busy, retrying." : `Price API failed (${res.status})`);
  const data = (await res.json()) as Record<string, any>;

  const quotes: Record<string, StockQuote> = {};
  for (const stock of STOCKS) {
    const p = data[stock.mint];
    if (!p || typeof p.usdPrice !== "number") continue;
    const wallStreet = typeof p.stockData?.price === "number" ? p.stockData.price : undefined;
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

/** Reads SOL, USDC and every catalog stock (SPL + Token-2022) via Jupiter. */
export async function fetchHoldings(owner: string): Promise<WalletHoldings> {
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

/** USD value of a holding. Uses the prescaled price so xStock dividends count. */
export function holdingUsd(holding: Holding, quote: StockQuote | undefined): number {
  return quote ? holding.amount * quote.usdPricePrescaled : 0;
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
  return getOrder({
    inputMint: stock.mint,
    outputMint: receive === "USDC" ? USDC_MINT : SOL_MINT,
    amount: amount.toString(),
    taker,
  });
}
