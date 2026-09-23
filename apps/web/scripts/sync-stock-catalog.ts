/**
 * Regenerates src/game/solana/stockList.generated.ts from Jupiter.
 *
 *   npx tsx apps/web/scripts/sync-stock-catalog.ts
 *
 * Takes every VERIFIED token Jupiter tags "stocks" from three issuers: the
 * 1:1-backed xStocks (Backed) and Backpack Securities (listed via Sunrise),
 * plus PreStocks (pre-IPO exposure through an SPV, NOT a listed share). A
 * token is kept only if the issuer's own public list has that exact mint for
 * the same ticker. Thin markets (MIN_LIQUIDITY) are dropped and one token is
 * kept per ticker (the more liquid issuer). Leveraged (Shift) and near-zero
 * liquidity (Ondo) products are skipped.
 *
 * The output is committed and reviewed like code: the game never looks a
 * stock up by ticker at runtime (search returns fake "NVDAx" pump tokens).
 * Descriptions, sectors and colors live in stockCatalog.ts.
 */
import fs from "node:fs";
import path from "node:path";

const MIN_LIQUIDITY = 25_000;
const OUT = path.join(__dirname, "../src/game/solana/stockList.generated.ts");

type Issuer = "xstocks" | "backpack" | "prestocks";
interface JupToken {
  id: string; symbol: string; name: string; decimals: number; icon?: string;
  tags?: string[]; liquidity?: number; isVerified?: boolean;
}

function cleanName(name: string): string {
  return name
    .replace(/\s*-\s*Backpack Securities$/i, "")
    .replace(/\s+PreStocks$/i, "")
    .replace(/\s+xStock$/i, "")
    .replace(/\s+Common Stock$/i, "")
    .replace(/,?\s+(Inc\.?|Corp\.?|Corporation|Co\.|N\.V\.|Holdings?|Group Holding|Group)$/i, "")
    .trim();
}

/**
 * Mint -> real-world ticker, straight from each issuer's own public list.
 * A token only makes the catalog if its issuer lists that exact mint AND
 * says it tracks the same ticker, so a look-alike can't slip in even if it
 * were ever tagged verified.
 */
async function officialMints(): Promise<Map<string, { issuer: Issuer; ticker: string }>> {
  const out = new Map<string, { issuer: Issuer; ticker: string }>();

  // xStocks (Backed): paginated; each asset has its underlying symbol + ISIN.
  for (let page = 0; page < 50; page++) {
    const r = await fetch(`https://api.xstocks.fi/api/v2/public/assets?page=${page}`);
    if (!r.ok) throw new Error(`xStocks assets ${r.status}`);
    const j = (await r.json()) as { nodes: Array<{ underlyingSymbol: string; deployments?: Array<{ network: string; address: string }> }>; page?: { hasNextPage?: boolean } };
    for (const n of j.nodes ?? []) {
      for (const d of n.deployments ?? []) {
        if (d.network === "Solana") out.set(d.address, { issuer: "xstocks", ticker: n.underlyingSymbol });
      }
    }
    if (!j.page?.hasNextPage) break;
  }

  // PreStocks: pre-IPO exposure through an SPV, not a listed share.
  const p = await fetch("https://prestocks.com/api/prestocks");
  if (!p.ok) throw new Error(`PreStocks assets ${p.status}`);
  for (const a of (await p.json()) as Array<{ symbol: string; contract_address: string }>) {
    if (a.contract_address) out.set(a.contract_address, { issuer: "prestocks", ticker: a.symbol });
  }

  // Backpack Securities: symbols are "TICKER.US".
  const b = await fetch("https://api.backpack.exchange/api/v1/assets");
  if (!b.ok) throw new Error(`Backpack assets ${b.status}`);
  for (const a of (await b.json()) as Array<{ symbol: string; tokens?: Array<{ blockchain: string; contractAddress: string }> }>) {
    if (!a.symbol.endsWith(".US")) continue;
    for (const t of a.tokens ?? []) {
      if (t.blockchain === "Solana") out.set(t.contractAddress, { issuer: "backpack", ticker: a.symbol.slice(0, -3) });
    }
  }
  return out;
}

async function main() {
  const official = await officialMints();
  const res = await fetch("https://lite-api.jup.ag/tokens/v2/tag?query=verified");
  if (!res.ok) throw new Error(`Jupiter tokens ${res.status}`);
  const tokens = (await res.json()) as JupToken[];
  const rejected: string[] = [];

  const best = new Map<string, { token: JupToken; issuer: Issuer; ticker: string }>();
  const seen = new Set<string>();
  for (const t of tokens) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const tags = t.tags ?? [];
    if (!tags.includes("stocks") || !tags.includes("verified")) continue;
    const issuer: Issuer | null = tags.includes("xstocks") ? "xstocks"
      : tags.includes("backpack") ? "backpack"
      : tags.includes("prestocks") ? "prestocks"
      : null;
    if (!issuer || (t.liquidity ?? 0) < MIN_LIQUIDITY) continue;
    const ticker = issuer === "xstocks" ? t.symbol.replace(/x$/, "") : t.symbol;
    const listed = official.get(t.id);
    if (!listed || listed.issuer !== issuer || listed.ticker !== ticker) {
      rejected.push(`${t.symbol} ${t.id} (${listed ? `issuer says ${listed.issuer}:${listed.ticker}` : "not in issuer's list"})`);
      continue;
    }
    const cur = best.get(ticker);
    if (!cur || (t.liquidity ?? 0) > (cur.token.liquidity ?? 0)) best.set(ticker, { token: t, issuer, ticker });
  }

  const rows = [...best.values()]
    .sort((a, b) => (b.token.liquidity ?? 0) - (a.token.liquidity ?? 0))
    .map(({ token: t, issuer, ticker }) =>
      `  { ticker: ${JSON.stringify(ticker)}, tokenSymbol: ${JSON.stringify(t.symbol)}, name: ${JSON.stringify(cleanName(t.name))}, ` +
      `mint: ${JSON.stringify(t.id)}, decimals: ${t.decimals}, issuer: ${JSON.stringify(issuer)}, ` +
      `logo: ${JSON.stringify(t.icon ?? "")}, liquidity: ${Math.round(t.liquidity ?? 0)} },`);

  const file = `// GENERATED by scripts/sync-stock-catalog.ts on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.
// ${rows.length} verified tokenized stocks with at least $${MIN_LIQUIDITY.toLocaleString("en-US")} liquidity on
// Jupiter, each confirmed against its issuer's own public asset list.
// Liquidity (USD) is a snapshot, used only to order the catalog.

export interface GeneratedStock {
  ticker: string;
  tokenSymbol: string;
  name: string;
  mint: string;
  decimals: number;
  /** prestocks = pre-IPO SPV exposure, not a 1:1 listed share. */
  issuer: "xstocks" | "backpack" | "prestocks";
  logo: string;
  liquidity: number;
}

export const GENERATED_STOCKS: readonly GeneratedStock[] = [
${rows.join("\n")}
];
`;
  fs.writeFileSync(OUT, file);
  console.log(`wrote ${rows.length} stocks to ${path.relative(process.cwd(), OUT)}`);
  if (rejected.length) console.log(`rejected ${rejected.length} not matching the issuer's official list:\n  ${rejected.join("\n  ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
