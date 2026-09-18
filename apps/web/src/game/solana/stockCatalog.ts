/**
 * Tokenized stock catalog, shared by the client and API routes (no deps).
 *
 * The tokens themselves (mints, decimals, issuer, logo) come from
 * stockList.generated.ts, which scripts/sync-stock-catalog.ts builds from
 * Jupiter's VERIFIED list. This file adds what a player needs to recognize
 * a company: a short name, one line about it, a sector for filtering and an
 * accent color. Never look a stock up by ticker at runtime: search returns
 * fake "NVDAx" pump tokens.
 */
import { GENERATED_STOCKS } from "@/game/solana/stockList.generated";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** backpack = Backpack Securities (listed on Solana through Sunrise); xstocks = Backed. */
export type StockIssuer = "backpack" | "xstocks";
/** Market filter groups in the Broker panel. */
export type StockSector = "tech" | "chips" | "crypto" | "brands" | "fun" | "health" | "industry" | "finance" | "funds";

export const SECTOR_LABELS: Record<StockSector, string> = {
  tech: "TECH", chips: "CHIPS", crypto: "CRYPTO", brands: "BRANDS", fun: "FUN",
  health: "HEALTH", industry: "INDUSTRY", finance: "FINANCE", funds: "FUNDS",
};

export interface StockInfo {
  /** Wall Street ticker shown to players (NVDA, not NVDAx). */
  ticker: string;
  /** On-chain token symbol. */
  tokenSymbol: string;
  name: string;
  /** One short line shown when a stock is expanded (baskets, trade view). */
  about: string;
  mint: string;
  decimals: number;
  issuer: StockIssuer;
  sector: StockSector;
  /** Card accent color. */
  color: string;
  logo: string;
  /** Best-known names: listed first and run on the building's LED ticker. */
  featured: boolean;
}

type Meta = { name?: string; about: string; sector: StockSector; color: string; logo?: string };

/** Player-facing details per ticker. A ticker the sync adds later still works with defaults. */
const META: Record<string, Meta> = {
  AAPL:   { about: "iPhone, Mac and services. The most valuable brand on Earth.", sector: "tech", color: "#A2AAAD" },
  GOOGL:  { about: "Google Search, YouTube, Android and Gemini AI.", sector: "tech", color: "#4285F4" },
  AMZN:   { about: "The online store giant, plus AWS, the biggest cloud.", sector: "brands", color: "#FF9900" },
  TSLA:   { about: "Electric cars, batteries and robotaxis.", sector: "industry", color: "#E82127" },
  NVDA:   { about: "Makes the chips that power AI.", sector: "chips", color: "#76B900" },
  SPCX:   { about: "Rockets and Starlink satellite internet.", sector: "industry", color: "#C8D1DC", logo: "https://s3-symbol-logo.tradingview.com/spacex.svg" },
  META:   { about: "Facebook, Instagram, WhatsApp and AI.", sector: "tech", color: "#0866FF" },
  MSFT:   { about: "Windows, Office, Azure cloud and a big stake in OpenAI.", sector: "tech", color: "#00A4EF" },
  NKE:    { about: "The biggest sportswear brand in the world.", sector: "brands", color: "#F5F5F5" },
  RBLX:   { about: "Game platform where players build the worlds.", sector: "fun", color: "#E2231A" },
  MCD:    { about: "The biggest burger chain in the world.", sector: "brands", color: "#FFC72C" },
  KO:     { about: "The most famous soft drink on the planet.", sector: "brands", color: "#F40009" },
  COIN:   { about: "The largest US crypto exchange.", sector: "crypto", color: "#0052FF" },
  SPY:    { name: "S&P 500", about: "The 500 biggest US companies in one token.", sector: "funds", color: "#E23B3B" },
  QQQ:    { name: "Nasdaq 100", about: "The 100 biggest Nasdaq companies, heavy on tech.", sector: "funds", color: "#3B82F6" },
  GME:    { name: "GameStop", about: "Video game retailer and the original meme stock.", sector: "fun", color: "#E4002B" },
  PLTR:   { about: "Data and AI software for governments and companies.", sector: "tech", color: "#9CA3AF" },
  HOOD:   { about: "Trading app for stocks and crypto.", sector: "finance", color: "#CCFF00" },
  MSTR:   { name: "Strategy", about: "A company holding billions in bitcoin.", sector: "crypto", color: "#F7931A" },
  CRCL:   { about: "The company behind the USDC stablecoin.", sector: "crypto", color: "#3D8BFF" },
  MU:     { name: "Micron", about: "Memory chips for AI data centers and phones.", sector: "chips", color: "#0072CE" },
  GLD:    { name: "Gold", about: "Physical gold, one token at a time.", sector: "funds", color: "#D4AF37" },
  "BRK.B": { name: "Berkshire", about: "Warren Buffett's company. Owns dozens of businesses.", sector: "finance", color: "#1F3A93" },
  SKHY:   { name: "SK Hynix", about: "Korean maker of the memory inside AI chips.", sector: "chips", color: "#F58220" },
  SNDK:   { name: "Sandisk", about: "Flash storage for phones, laptops and AI servers.", sector: "chips", color: "#E31837" },
  AMD:    { name: "AMD", about: "CPUs and GPUs, rival to Intel and NVIDIA.", sector: "chips", color: "#ED1C24" },
  AVGO:   { name: "Broadcom", about: "Network and custom AI chips.", sector: "chips", color: "#CC092F" },
  INTC:   { name: "Intel", about: "The classic chipmaker, building US factories.", sector: "chips", color: "#0071C5" },
  DRAM:   { name: "Memory ETF", about: "A fund of memory chip makers.", sector: "funds", color: "#8B5CF6" },
  STRC:   { name: "Strategy Preferred", about: "Strategy's preferred stock, paying a monthly dividend.", sector: "crypto", color: "#F7931A" },
  DKNG:   { name: "DraftKings", about: "Sports betting and online games.", sector: "fun", color: "#53D337" },
  GRND:   { name: "Grindr", about: "Dating app for the LGBTQ+ community.", sector: "tech", color: "#F5C518" },
  MRNA:   { name: "Moderna", about: "mRNA vaccines and medicines.", sector: "health", color: "#E31937" },
  TTWO:   { name: "Take-Two", about: "Makers of GTA, NBA 2K and Red Dead.", sector: "fun", color: "#E11D48" },
  DJT:    { name: "Trump Media", about: "Owner of the Truth Social app.", sector: "tech", color: "#1D4ED8" },
  DFDV:   { name: "DeFi Development", about: "A company holding SOL on its balance sheet.", sector: "crypto", color: "#9945FF" },
  RDDT:   { name: "Reddit", about: "The front page of the internet.", sector: "tech", color: "#FF4500" },
  BOT:    { name: "RoboStrategy", about: "A company investing in robotics and AI.", sector: "tech", color: "#22D3EE" },
  PTN:    { name: "Palatin", about: "Small biotech developing new medicines.", sector: "health", color: "#0EA5E9" },
  LUV:    { name: "Southwest", about: "Low-cost US airline.", sector: "industry", color: "#304CB2" },
  HIMS:   { name: "Hims & Hers", about: "Online health and wellness care.", sector: "health", color: "#F59E0B" },
  AMC:    { name: "AMC", about: "Movie theater chain and famous meme stock.", sector: "fun", color: "#DC2626" },
  QUBT:   { name: "Quantum Computing", about: "Quantum computing hardware and software.", sector: "tech", color: "#7C3AED" },
  RUM:    { name: "Rumble", about: "Video platform and cloud.", sector: "tech", color: "#85C742" },
  BABA:   { name: "Alibaba", about: "China's biggest online shopping giant.", sector: "brands", color: "#FF6A00" },
  WULF:   { name: "TeraWulf", about: "Bitcoin mining and AI data centers.", sector: "crypto", color: "#10B981" },
  TQQQ:   { name: "Nasdaq 3x", about: "Triple the daily move of the Nasdaq 100. High risk.", sector: "funds", color: "#EF4444" },
  BROS:   { name: "Dutch Bros", about: "Drive-thru coffee chain.", sector: "brands", color: "#0E7490" },
  SNAP:   { name: "Snap", about: "Snapchat and AR glasses.", sector: "tech", color: "#FFFC00" },
  WEN:    { name: "Wendy's", about: "Fast food burgers and Frostys.", sector: "brands", color: "#E2203D" },
  SPHR:   { name: "Sphere", about: "The giant LED sphere venue in Las Vegas.", sector: "fun", color: "#6366F1" },
  FLWS:   { name: "1-800-Flowers", about: "Flowers and gifts delivered.", sector: "brands", color: "#9333EA" },
  SCHH:   { name: "Real Estate ETF", about: "A fund of US real estate companies.", sector: "funds", color: "#0EA5E9" },
  UPS:    { name: "UPS", about: "Package delivery around the world.", sector: "industry", color: "#FFB500" },
  COST:   { name: "Costco", about: "Members-only warehouse stores.", sector: "brands", color: "#E31837" },
  LULU:   { name: "Lululemon", about: "Yoga and athletic apparel.", sector: "brands", color: "#D22030" },
  JNJ:    { name: "Johnson & Johnson", about: "Medicines and medical devices.", sector: "health", color: "#D51900" },
  DELL:   { name: "Dell", about: "Computers and AI servers.", sector: "tech", color: "#007DB8" },
  BULL:   { name: "Webull", about: "Trading app for stocks and crypto.", sector: "finance", color: "#F59E0B" },
  DNUT:   { name: "Krispy Kreme", about: "Famous glazed doughnuts.", sector: "brands", color: "#00704A" },
  MGM:    { name: "MGM Resorts", about: "Casinos and hotels in Las Vegas.", sector: "fun", color: "#B8860B" },
  LMT:    { name: "Lockheed Martin", about: "Fighter jets, missiles and space.", sector: "industry", color: "#1E3A8A" },
  HTZ:    { name: "Hertz", about: "Car rentals worldwide.", sector: "industry", color: "#FFD100" },
};

/** Best-known names, in this order, lead every list. The rest follow by liquidity. */
const FEATURED = [
  "AAPL", "GOOGL", "AMZN", "TSLA", "NVDA", "SPCX", "META", "MSFT", "NKE", "RBLX",
  "MCD", "KO", "COIN", "SPY", "QQQ", "GME",
];

export const STOCKS: readonly StockInfo[] = (() => {
  const all = GENERATED_STOCKS.map((g): StockInfo => {
    const m = META[g.ticker];
    return {
      ticker: g.ticker,
      tokenSymbol: g.tokenSymbol,
      name: m?.name ?? g.name,
      about: m?.about || `${g.name}, tokenized on Solana.`,
      mint: g.mint,
      decimals: g.decimals,
      issuer: g.issuer,
      sector: m?.sector ?? "tech",
      color: m?.color ?? "#8A90A6",
      logo: m?.logo ?? g.logo,
      featured: FEATURED.includes(g.ticker),
    };
  });
  const rank = (s: StockInfo) => (s.featured ? FEATURED.indexOf(s.ticker) : FEATURED.length);
  // Generated order is by liquidity, and Array.sort is stable, so the
  // non-featured tail keeps that order.
  return all.sort((a, b) => rank(a) - rank(b));
})();

const BY_MINT = new Map(STOCKS.map((s) => [s.mint, s]));
const BY_TICKER = new Map(STOCKS.map((s) => [s.ticker, s]));

export function getStockByMint(mint: string): StockInfo | undefined { return BY_MINT.get(mint); }
export function getStockByTicker(ticker: string): StockInfo | undefined { return BY_TICKER.get(ticker); }

// ── Baskets ─────────────────────────────────────────────────────────────

export interface StockBasket {
  id: string;
  name: string;
  /** One line under the name. */
  tagline: string;
  /** Tickers, bought in equal dollar weights. */
  tickers: string[];
  color: string;
}

/**
 * Themed, equal-weight baskets bought in one go (one signature for all the
 * legs). A ticker missing from the catalog (dropped by a later sync) is
 * skipped rather than breaking the basket.
 */
export const BASKETS: readonly StockBasket[] = [
  { id: "big-tech",  name: "Big Tech",        tagline: "The giants you use every day.",        tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA"], color: "#4285F4" },
  { id: "ai",        name: "AI Builders",     tagline: "Chips and models behind AI.",          tickers: ["NVDA", "AMD", "AVGO", "MSFT", "PLTR"],          color: "#76B900" },
  { id: "memory",    name: "Memory Boom",     tagline: "The memory every AI server needs.",    tickers: ["MU", "SKHY", "SNDK"],                           color: "#0072CE" },
  { id: "future",    name: "Moonshots",       tagline: "Space, robotaxis and virtual worlds.", tickers: ["SPCX", "TSLA", "NVDA", "RBLX"],                 color: "#C8D1DC" },
  { id: "crypto",    name: "Crypto Economy",  tagline: "Companies built on crypto.",           tickers: ["COIN", "HOOD", "CRCL", "MSTR", "DFDV"],         color: "#F7931A" },
  { id: "snacks",    name: "Snack Break",     tagline: "Burgers, soda, coffee and doughnuts.", tickers: ["MCD", "KO", "WEN", "BROS", "DNUT"],             color: "#FFC72C" },
  { id: "brands",    name: "Everyday Brands", tagline: "Names you already know and love.",     tickers: ["AAPL", "NKE", "AMZN", "COST", "LULU"],          color: "#FF9900" },
  { id: "memes",     name: "Meme Stocks",     tagline: "The internet's favorite rollercoasters.", tickers: ["GME", "AMC", "DJT", "RDDT"],                 color: "#E4002B" },
  { id: "index",     name: "Whole Market",    tagline: "The S&P 500, the Nasdaq 100 and gold.", tickers: ["SPY", "QQQ", "GLD"],                           color: "#E23B3B" },
];

export function basketStocks(basket: StockBasket): StockInfo[] {
  return basket.tickers.map((t) => BY_TICKER.get(t)).filter((s): s is StockInfo => !!s);
}

export function getBasket(id: string): StockBasket | undefined {
  return BASKETS.find((b) => b.id === id);
}
