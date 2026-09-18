/**
 * Tokenized stock catalog, shared by the client and API routes (no deps).
 *
 * Mainnet mints are the real tokens, verified on Jupiter Tokens V2. Never look
 * a stock up by ticker at runtime: search returns fake "NVDAx" pump tokens.
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** backpack = Backpack Securities (listed on Solana through Sunrise); xstocks = Backed. */
export type StockIssuer = "backpack" | "xstocks";
export type StockSector = "index" | "tech" | "chips" | "auto" | "crypto" | "space" | "consumer" | "gaming" | "fintech";

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
}

const XSTOCK_LOGO = (sym: string) => `https://xstocks-metadata.backed.fi/logos/tokens/${sym}.png`;
const BACKPACK_LOGO = (sym: string) => `https://backpack.exchange/api/stock-logo/${sym}`;

// Verified on Jupiter Tokens V2 (tag "verified" + issuer tag), 2026-09-15.
// Ordered for the trading floor: best-known brands first, then indexes and the rest.
export const STOCKS: readonly StockInfo[] = [
  { ticker: "AAPL",  tokenSymbol: "AAPLx",  name: "Apple", about: "iPhone, Mac and services. The most valuable brand on Earth.",         mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8, issuer: "xstocks", sector: "tech",     color: "#A2AAAD", logo: XSTOCK_LOGO("AAPLx") },
  { ticker: "GOOGL", tokenSymbol: "GOOGLx", name: "Alphabet", about: "Google Search, YouTube, Android and Gemini AI.",      mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8, issuer: "xstocks", sector: "tech",     color: "#4285F4", logo: XSTOCK_LOGO("GOOGLx") },
  { ticker: "AMZN",  tokenSymbol: "AMZNx",  name: "Amazon", about: "The online store giant, plus AWS, the biggest cloud.",        mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8, issuer: "xstocks", sector: "consumer", color: "#FF9900", logo: XSTOCK_LOGO("AMZNx") },
  { ticker: "TSLA",  tokenSymbol: "TSLAx",  name: "Tesla", about: "Electric cars, batteries and robotaxis.",         mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8, issuer: "xstocks", sector: "auto",     color: "#E82127", logo: XSTOCK_LOGO("TSLAx") },
  { ticker: "NVDA",  tokenSymbol: "NVDAx",  name: "NVIDIA", about: "Makes the chips that power AI.",        mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, issuer: "xstocks", sector: "chips",    color: "#76B900", logo: XSTOCK_LOGO("NVDAx") },
  { ticker: "SPCX",  tokenSymbol: "SPCX",   name: "SpaceX", about: "Rockets and Starlink satellite internet.",        mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb", decimals: 6, issuer: "backpack", sector: "space",    color: "#C8D1DC", logo: "https://s3-symbol-logo.tradingview.com/spacex.svg" },
  { ticker: "META",  tokenSymbol: "METAx",  name: "Meta", about: "Facebook, Instagram, WhatsApp and AI.",          mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", decimals: 8, issuer: "xstocks", sector: "tech",     color: "#0866FF", logo: XSTOCK_LOGO("METAx") },
  { ticker: "NKE",   tokenSymbol: "NKE",    name: "Nike", about: "The biggest sportswear brand in the world.",          mint: "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg", decimals: 6, issuer: "backpack", sector: "consumer", color: "#F5F5F5", logo: BACKPACK_LOGO("NKE") },
  { ticker: "RBLX",  tokenSymbol: "RBLX",   name: "Roblox", about: "Game platform where players build the worlds.",        mint: "RBLXDGRD64AtRamHMFVcjqne3Ar7NLWtFtYNtsrf1cE", decimals: 6, issuer: "backpack", sector: "gaming",   color: "#E2231A", logo: BACKPACK_LOGO("RBLX") },
  { ticker: "SPY",   tokenSymbol: "SPYx",   name: "S&P 500", about: "The 500 biggest US companies in one token.",       mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8, issuer: "xstocks", sector: "index",    color: "#E23B3B", logo: XSTOCK_LOGO("SPYx") },
  { ticker: "QQQ",   tokenSymbol: "QQQx",   name: "Nasdaq 100", about: "The 100 biggest Nasdaq companies, heavy on tech.",    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", decimals: 8, issuer: "xstocks", sector: "index",    color: "#3B82F6", logo: XSTOCK_LOGO("QQQx") },
  { ticker: "COIN",  tokenSymbol: "COINx",  name: "Coinbase", about: "The largest US crypto exchange.",      mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", decimals: 8, issuer: "xstocks", sector: "crypto",   color: "#0052FF", logo: XSTOCK_LOGO("COINx") },
  { ticker: "HOOD",  tokenSymbol: "HOOD",   name: "Robinhood", about: "Trading app for stocks and crypto.",     mint: "HooDYv5RewLRiMLnEVq3VJqdqxhuE6c5eYvqejMC3e9A", decimals: 6, issuer: "backpack", sector: "fintech",  color: "#CCFF00", logo: BACKPACK_LOGO("HOOD") },
  { ticker: "MSTR",  tokenSymbol: "MSTRx",  name: "Strategy", about: "A company holding billions in bitcoin.",      mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8, issuer: "xstocks", sector: "crypto",   color: "#F7931A", logo: XSTOCK_LOGO("MSTRx") },
  { ticker: "CRCL",  tokenSymbol: "CRCLx",  name: "Circle", about: "The company behind the USDC stablecoin.",        mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8, issuer: "xstocks", sector: "crypto",   color: "#3D8BFF", logo: XSTOCK_LOGO("CRCLx") },
  { ticker: "MU",    tokenSymbol: "MU",     name: "Micron", about: "Memory chips for AI data centers and phones.",        mint: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1", decimals: 6, issuer: "backpack", sector: "chips",    color: "#0072CE", logo: BACKPACK_LOGO("MU") },
];

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
 * legs). Every ticker must exist in STOCKS.
 */
export const BASKETS: readonly StockBasket[] = [
  { id: "big-tech",  name: "Big Tech",        tagline: "The giants you use every day.",     tickers: ["AAPL", "GOOGL", "AMZN", "META", "NVDA"], color: "#4285F4" },
  { id: "ai",        name: "AI Builders",     tagline: "Chips and models behind AI.",       tickers: ["NVDA", "MU", "GOOGL", "META"],          color: "#76B900" },
  { id: "future",    name: "Moonshots",       tagline: "Space, robotaxis and virtual worlds.", tickers: ["SPCX", "TSLA", "NVDA", "RBLX"],     color: "#C8D1DC" },
  { id: "crypto",    name: "Crypto Economy",  tagline: "Companies built on crypto.",        tickers: ["COIN", "HOOD", "CRCL", "MSTR"],         color: "#F7931A" },
  { id: "brands",    name: "Everyday Brands", tagline: "Names you already know and love.",  tickers: ["AAPL", "NKE", "AMZN", "RBLX"],          color: "#FF9900" },
  { id: "index",     name: "Whole Market",    tagline: "The S&P 500 and Nasdaq 100.",        tickers: ["SPY", "QQQ"],                           color: "#E23B3B" },
];

export function basketStocks(basket: StockBasket): StockInfo[] {
  return basket.tickers.map((t) => {
    const s = BY_TICKER.get(t);
    if (!s) throw new Error(`Basket ${basket.id} has unknown ticker ${t}`);
    return s;
  });
}

export function getBasket(id: string): StockBasket | undefined {
  return BASKETS.find((b) => b.id === id);
}
