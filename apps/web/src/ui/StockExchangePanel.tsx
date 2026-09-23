"use client";

/**
 * Stocks Broker panel: buy and sell tokenized stocks through Jupiter Swap V2.
 * Visual first: logo cards, colored moves, preset amounts, one line of copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  STOCKS, stockMarket, getMarketClock, fetchHoldings, holdingUsd, quoteBuy, quoteSell,
  getStockVenue, submitStockOrder, stockTxUrl, BASKETS, basketStocks, SECTOR_LABELS,
  type StockInfo, type StockBasket, type StockMarketState, type WalletHoldings, type PayToken, type StockSector,
} from "@/game/solana/stocks";

/** Sector filter chips, in display order (only sectors that have stocks). */
const SECTORS = (Object.keys(SECTOR_LABELS) as StockSector[]).filter((sct) => STOCKS.some((s) => s.sector === sct));
import { getShareTrades, setShareTrades } from "@/game/chat/tradeBroadcast";
import { ORDER_TTL_MS, deserializeTransaction, fromSmallestUnit, type OrderResponse } from "@/game/solana/jupiterSwap";
import { transactionLog } from "@/game/telemetry/transactionLog";
import { profileManager } from "@/game/config/profileManager";

const PIXEL = '"Press Start 2P", monospace';
const GOLD = "#FFB547";
const UP = "#14F195";
const DOWN = "#FF4D6D";
const MUTED = "#8A90A6";

const BUY_USD = [1, 5, 10, 25];
/** Read once per page load; ?stocks=mainnet|devnet switches it (see getStockVenue). */
const IS_DEVNET = typeof window !== "undefined" && getStockVenue() === "devnet";
const SELL_PCT = [0.25, 0.5, 1];

// ── Cost basis (local, per wallet) for the P&L on "MY STOCKS" ─────────────
type Basis = Record<string, { usd: number; amount: number }>;
const basisKey = (w: string) => `solcity:stocks:basis:${w}`;
function loadBasis(w: string): Basis {
  try { return JSON.parse(localStorage.getItem(basisKey(w)) || "{}"); } catch { return {}; }
}
function saveBasis(w: string, b: Basis) {
  try { localStorage.setItem(basisKey(w), JSON.stringify(b)); } catch { /* private mode */ }
}
/** Adds a buy to the local cost basis. `outRaw` is the stock amount received. */
function addBuyBasis(w: string, stock: StockInfo, usdIn: number, outRaw: string) {
  const basis = loadBasis(w);
  const cur = basis[stock.mint] ?? { usd: 0, amount: 0 };
  basis[stock.mint] = { usd: cur.usd + usdIn, amount: cur.amount + Number(fromSmallestUnit(outRaw, stock.decimals)) };
  saveBasis(w, basis);
}

const BASKET_USD = [5, 10, 25, 50];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emitGameEvent(event: string, payload?: unknown): void {
  ((globalThis as any).__solCityGameEvents)?.emit(event, payload);
}

const usd = (n: number) => `$${n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toFixed(2)}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
const moveColor = (n: number) => (n > 0 ? UP : n < 0 ? DOWN : MUTED);
const isPreIpo = (s: StockInfo) => s.issuer === "prestocks";
/** What the reference price is called: an exchange close, or the SPV mark. */
const refLabel = (s: StockInfo) => (isPreIpo(s) ? "SPV MARK" : "WALL ST");
function issuerLine(s: StockInfo): string {
  if (isPreIpo(s)) return "PRESTOCKS SPV . PRE-IPO, NOT A LISTED SHARE";
  const house = s.issuer === "backpack" ? "BACKPACK SECURITIES VIA SUNRISE" : "XSTOCKS BY BACKED";
  return house + " . 1:1 BACKED";
}

export default function StockExchangePanel({ onClose }: { onClose: () => void }) {
  const { connected, publicKey, signTransaction, signAllTransactions } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const wallet = publicKey?.toBase58() ?? "";

  const [market, setMarket] = useState<StockMarketState>(stockMarket.getState());
  const [holdings, setHoldings] = useState<WalletHoldings | null>(null);
  const [tab, setTab] = useState<"market" | "baskets" | "mine">("market");
  const [selected, setSelected] = useState<StockInfo | null>(null);
  const [selectedBasket, setSelectedBasket] = useState<StockBasket | null>(null);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<StockSector | "all">("all");
  const clock = useMemo(() => getMarketClock(), [market.updatedAt]);

  useEffect(() => stockMarket.subscribe(setMarket), []);

  const refreshHoldings = useCallback(async () => {
    if (!wallet) { setHoldings(null); return; }
    try { setHoldings(await fetchHoldings(wallet)); } catch { /* keep last */ }
  }, [wallet]);
  useEffect(() => { refreshHoldings(); }, [refreshHoldings]);

  const portfolioUsd = useMemo(() => {
    if (!holdings) return 0;
    return Object.entries(holdings.stocks).reduce((acc, [mint, h]) => acc + holdingUsd(h, market.quotes[mint]), 0);
  }, [holdings, market]);

  if (selected) {
    return (
      <TradeView
        stock={selected} market={market} holdings={holdings} wallet={wallet}
        connected={connected} signTransaction={signTransaction as any}
        onConnect={() => openWalletModal(true)}
        onBack={() => setSelected(null)}
        onTraded={() => { refreshHoldings(); setTimeout(refreshHoldings, 6000); stockMarket.refresh(); }}
      />
    );
  }

  if (selectedBasket) {
    return (
      <BasketView
        basket={selectedBasket} market={market} wallet={wallet} connected={connected}
        signTransaction={signTransaction as any} signAllTransactions={signAllTransactions as any}
        onConnect={() => openWalletModal(true)}
        onBack={() => setSelectedBasket(null)}
        onTraded={() => { refreshHoldings(); setTimeout(refreshHoldings, 6000); stockMarket.refresh(); }}
      />
    );
  }

  const owned = holdings ? STOCKS.filter((s) => holdings.stocks[s.mint]) : [];
  const q = query.trim().toLowerCase();
  const marketList = STOCKS.filter((s) =>
    (sector === "all" || s.sector === sector) &&
    (!q || s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
  const list = tab === "market" ? marketList : tab === "mine" ? owned : [];
  const basis = wallet ? loadBasis(wallet) : {};

  return (
    <div style={{ fontFamily: PIXEL }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingRight: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: GOLD }}>STOCKLANA</span>
          {IS_DEVNET && (
            <span style={{ fontSize: 5, padding: "3px 5px", borderRadius: 5, background: "rgba(0,209,255,0.14)", color: "#00D1FF" }}>DEVNET TEST</span>
          )}
        </div>
        <span style={{
          fontSize: 6, padding: "4px 6px", borderRadius: 6,
          background: clock.wallStreetOpen ? "rgba(20,241,149,0.12)" : "rgba(255,181,71,0.12)",
          color: clock.wallStreetOpen ? UP : GOLD,
        }}>
          {clock.wallStreetOpen ? "NYSE OPEN" : "AFTER HOURS"}
        </span>
      </div>
      <div style={{ fontSize: 6, color: MUTED, marginBottom: 12, lineHeight: 1.6 }}>
        Real stocks as Solana tokens. Trade 24/7.
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["market", "baskets", "mine"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, cursor: "pointer", fontFamily: PIXEL, fontSize: 6,
            border: `1px solid ${tab === t ? GOLD : "#2a2f45"}`,
            background: tab === t ? "rgba(255,181,71,0.12)" : "transparent",
            color: tab === t ? GOLD : MUTED,
          }}>
            {t === "market" ? "MARKET" : t === "baskets" ? "BASKETS" : `MINE${owned.length ? ` (${owned.length})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "market" && (
        <div style={{ marginBottom: 10 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Same signal the chat input uses: typing must not walk the avatar.
            onFocus={() => emitGameEvent("chat:focus", true)}
            onBlur={() => emitGameEvent("chat:focus", false)}
            placeholder={`SEARCH ${STOCKS.length} STOCKS`}
            style={{
              width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, marginBottom: 8,
              background: "#12162b", border: "1px solid #2a2f45", color: "#fff", fontFamily: PIXEL, fontSize: 7, outline: "none",
            }}
          />
          {/* Sector chips wrap onto a second line so every one stays visible
              (a sideways scroll hid the last ones behind the panel edge). */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(["all", ...SECTORS] as const).map((sct) => (
              <button key={sct} onClick={() => setSector(sct)} style={{
                ...chip(sector === sct), flex: "0 0 auto", padding: "6px 9px", fontSize: 6,
              }}>
                {sct === "all" ? "ALL" : SECTOR_LABELS[sct]}
              </button>
            ))}
          </div>
          {marketList.length === 0 && (
            <div style={{ textAlign: "center", padding: "18px 0", fontSize: 7, color: MUTED }}>No stock matches.</div>
          )}
        </div>
      )}

      {tab === "baskets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {BASKETS.map((b) => {
            const stocks = basketStocks(b);
            const moves = stocks.map((s) => market.quotes[s.mint]?.change24h).filter((v): v is number => v != null);
            const avg = moves.length ? moves.reduce((a, v) => a + v, 0) / moves.length : null;
            return (
              <button key={b.id} onClick={() => setSelectedBasket(b)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, cursor: "pointer",
                textAlign: "left", background: "#12162b", border: `1px solid ${b.color}44`, minWidth: 0,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: PIXEL, fontSize: 8, color: "#fff" }}>{b.name.toUpperCase()}</div>
                  <div style={{ fontFamily: PIXEL, fontSize: 5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{b.tagline}</div>
                  <div style={{ marginTop: 8 }}><LogoStack stocks={stocks} size={18} /></div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: PIXEL, fontSize: 7, color: avg == null ? MUTED : moveColor(avg) }}>{avg == null ? "..." : pct(avg)}</div>
                  <div style={{ fontFamily: PIXEL, fontSize: 5, color: MUTED, marginTop: 4 }}>{stocks.length} STOCKS</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {tab === "mine" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 12px", borderRadius: 10, background: "#12162b", marginBottom: 10 }}>
          <span style={{ fontSize: 6, color: MUTED }}>PORTFOLIO</span>
          <span style={{ fontSize: 11, color: "#fff" }}>{usd(portfolioUsd)}</span>
        </div>
      )}

      {tab === "mine" && !connected && (
        <button onClick={() => openWalletModal(true)} style={primaryBtn(GOLD)}>CONNECT WALLET</button>
      )}
      {tab === "mine" && connected && owned.length === 0 && (
        <div style={{ textAlign: "center", padding: "18px 0", fontSize: 7, color: MUTED }}>
          No stocks yet. Pick one in MARKET.
        </div>
      )}

      {/* Stock grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {list.map((s) => {
          const q = market.quotes[s.mint];
          const h = holdings?.stocks[s.mint];
          const value = h ? holdingUsd(h, q) : 0;
          const b = basis[s.mint];
          const pnl = h && b && b.usd > 0 ? ((value - b.usd) / b.usd) * 100 : null;
          return (
            <button key={s.mint} onClick={() => setSelected(s)} style={{
              display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 10, cursor: "pointer",
              textAlign: "left", background: "#12162b", border: `1px solid ${s.color}33`, minWidth: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <StockLogo stock={s} size={22} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontFamily: PIXEL, fontSize: 8, color: "#fff" }}>{s.ticker}</span>
                    {isPreIpo(s) && <span style={{ fontFamily: PIXEL, fontSize: 4, color: "#00D1FF", border: "1px solid #00D1FF55", borderRadius: 3, padding: "1px 2px" }}>PRE</span>}
                  </div>
                  <div style={{ fontFamily: PIXEL, fontSize: 5, color: MUTED, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                </div>
              </div>
              {tab === "market" ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: PIXEL }}>
                  <span style={{ fontSize: 7, color: "#fff" }}>{q ? usd(q.usdPrice) : "..."}</span>
                  <span style={{ fontSize: 6, color: q ? moveColor(q.change24h) : MUTED }}>{q ? pct(q.change24h) : ""}</span>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: PIXEL }}>
                  <span style={{ fontSize: 7, color: "#fff" }}>{usd(value)}</span>
                  <span style={{ fontSize: 6, color: pnl == null ? MUTED : moveColor(pnl) }}>{pnl == null ? "" : pct(pnl)}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 5, color: "#555a70", lineHeight: 1.6 }}>
        <span>{IS_DEVNET ? "Devnet test tokens at live prices." : "Mainnet via Jupiter. Not for US persons."}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED, fontFamily: PIXEL, fontSize: 6, cursor: "pointer" }}>ESC</button>
      </div>
    </div>
  );
}

// ── Trade view ───────────────────────────────────────────────────────────

type TradeStatus = "idle" | "quoting" | "ready" | "signing" | "submitting" | "done" | "error";

function TradeView(props: {
  stock: StockInfo;
  market: StockMarketState;
  holdings: WalletHoldings | null;
  wallet: string;
  connected: boolean;
  signTransaction?: <T>(tx: T) => Promise<T>;
  onConnect: () => void;
  onBack: () => void;
  onTraded: () => void;
}) {
  const { stock, market, holdings, wallet, connected, signTransaction, onConnect, onBack, onTraded } = props;
  const q = market.quotes[stock.mint];
  const holding = holdings?.stocks[stock.mint];

  const [side, setSide] = useState<"buy" | "sell">("buy");
  // Devnet test trades settle in devnet SOL only (there is no devnet USDC venue).
  const [payWith, setPayWith] = useState<PayToken>(IS_DEVNET ? "SOL" : "USDC");
  const [usdAmount, setUsdAmount] = useState<number | null>(null);
  const [sellPct, setSellPct] = useState<number | null>(null);
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [status, setStatus] = useState<TradeStatus>("idle");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ signature: string; text: string } | null>(null);
  const quotedAt = useRef(0);
  const reqSeq = useRef(0);

  const choice = side === "buy" ? usdAmount : sellPct;

  const requestOrder = useCallback(async (): Promise<OrderResponse | null> => {
    if (!wallet || choice == null) return null;
    if (side === "buy") {
      return quoteBuy({ stock, usd: choice, payWith, taker: wallet, solPrice: market.solPrice });
    }
    if (!holding) throw new Error("You don't own this stock yet.");
    return quoteSell({ stock, holding, fraction: choice, receive: payWith, taker: wallet });
  }, [wallet, choice, side, stock, payWith, market.solPrice, holding]);

  // Auto-quote whenever the choice changes.
  useEffect(() => {
    setOrder(null); setError("");
    if (!connected || choice == null) { setStatus("idle"); return; }
    const seq = ++reqSeq.current;
    setStatus("quoting");
    requestOrder()
      .then((o) => { if (seq !== reqSeq.current) return; quotedAt.current = Date.now(); setOrder(o); setStatus(o ? "ready" : "idle"); })
      .catch((e) => { if (seq !== reqSeq.current) return; setError(e.message); setStatus("error"); });
  }, [connected, choice, requestOrder]);

  const confirm = useCallback(async () => {
    if (!order || !signTransaction) return;
    const label = side === "buy"
      ? `Buy ${usd(usdAmount ?? 0)} of ${stock.ticker} with ${payWith}`
      : `Sell ${Math.round((sellPct ?? 0) * 100)}% of ${stock.ticker} for ${payWith}`;
    const entry = transactionLog.record({ kind: "stock", layer: IS_DEVNET ? "base" : "jupiter", label, status: "pending" });
    try {
      let o = order;
      if (Date.now() - quotedAt.current > ORDER_TTL_MS) {
        o = (await requestOrder()) ?? order;
      }
      setStatus("signing");
      const signed = await signTransaction(deserializeTransaction(o.transaction!));
      setStatus("submitting");
      const res = await submitStockOrder(o, signed as any);
      const outRaw = res.outAmount;

      // Cost basis for P&L
      if (side === "buy") {
        addBuyBasis(wallet, stock, o.inUsdValue ?? usdAmount ?? 0, outRaw);
      } else {
        const basis = loadBasis(wallet);
        const cur = basis[stock.mint] ?? { usd: 0, amount: 0 };
        const keep = 1 - (sellPct ?? 0);
        basis[stock.mint] = { usd: cur.usd * keep, amount: cur.amount * keep };
        if (keep <= 0) delete basis[stock.mint];
        saveBasis(wallet, basis);
      }

      const text = side === "buy"
        ? `+${trimAmount(fromSmallestUnit(outRaw, stock.decimals))} ${stock.ticker}`
        : `+${trimAmount(fromSmallestUnit(outRaw, payWith === "USDC" ? 6 : 9))} ${payWith}`;
      setDone({ signature: res.signature ?? "", text });
      setStatus("done");
      transactionLog.markConfirmed(entry.id, res.signature ?? "");
      profileManager.recordSwap({
        inputToken: side === "buy" ? payWith : stock.tokenSymbol,
        outputToken: side === "buy" ? stock.tokenSymbol : payWith,
        amount: side === "buy" ? String(usdAmount) : `${Math.round((sellPct ?? 0) * 100)}%`,
      });
      emitGameEvent("game:swap");
      emitGameEvent("game:stock-trade", {
        side, ticker: stock.ticker, sector: stock.sector, wallStreetOpen: getMarketClock().wallStreetOpen, share: getShareTrades(),
      });
      onTraded();
    } catch (e: any) {
      const msg = /reject|cancel|denied/i.test(e?.message ?? "") ? "Signature cancelled." : (e?.message ?? "Trade failed.");
      setError(msg); setStatus("error");
      transactionLog.markFailed(entry.id, msg);
    }
  }, [order, signTransaction, side, usdAmount, sellPct, stock, payWith, wallet, requestOrder, onTraded]);

  if (status === "done" && done) {
    return (
      <div style={{ fontFamily: PIXEL, textAlign: "center", padding: "12px 0" }}>
        <div style={{ display: "flex", justifyContent: "center" }}><StockLogo stock={stock} size={56} /></div>
        <div style={{ fontSize: 10, color: UP, marginTop: 14 }}>{side === "buy" ? "YOU OWN IT" : "SOLD"}</div>
        <div style={{ fontSize: 9, color: "#fff", marginTop: 10 }}>{done.text}</div>
        {done.signature && (
          <a href={stockTxUrl(done.signature)} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", marginTop: 12, fontSize: 6, color: "#00D1FF" }}>
            View on Solscan
          </a>
        )}
        <button onClick={onBack} style={{ ...primaryBtn(GOLD), marginTop: 16 }}>BACK TO MARKET</button>
      </div>
    );
  }

  const outPreview = order
    ? side === "buy"
      ? `${trimAmount(fromSmallestUnit(order.outAmount, stock.decimals))} ${stock.ticker}`
      : `${trimAmount(fromSmallestUnit(order.outAmount, payWith === "USDC" ? 6 : 9))} ${payWith}`
    : "";

  const busy = status === "quoting" || status === "signing" || status === "submitting";

  return (
    <div style={{ fontFamily: PIXEL }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: MUTED, fontFamily: PIXEL, fontSize: 7, cursor: "pointer", padding: 0, marginBottom: 12 }}>
        {"< MARKET"}
      </button>

      {/* Stock header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <StockLogo stock={stock} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "#fff" }}>{stock.ticker}</div>
          <div style={{ fontSize: 6, color: MUTED, marginTop: 4 }}>{stock.name}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#fff" }}>{q ? usd(q.usdPrice) : "..."}</div>
          <div style={{ fontSize: 7, color: q ? moveColor(q.change24h) : MUTED, marginTop: 4 }}>{q ? pct(q.change24h) : ""}</div>
        </div>
      </div>

      {/* Solana vs Wall Street */}
      {q?.wallStreetPrice != null && q.premiumPct != null && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: "#12162b", marginBottom: 10, fontSize: 6 }}>
          <span style={{ color: MUTED }}>{refLabel(stock)} {usd(q.wallStreetPrice)}</span>
          <span style={{ color: Math.abs(q.premiumPct) < 0.5 ? UP : GOLD }}>SOLANA {pct(q.premiumPct)}</span>
        </div>
      )}

      {/* Issuer badge */}
      <div style={{ fontSize: 5, color: isPreIpo(stock) ? "#00D1FF" : MUTED, marginBottom: 12 }}>
        {issuerLine(stock)}
      </div>

      {/* Buy / Sell */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); setUsdAmount(null); setSellPct(null); }}
            disabled={s === "sell" && !holding}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 8, fontFamily: PIXEL, fontSize: 8,
              cursor: s === "sell" && !holding ? "not-allowed" : "pointer",
              opacity: s === "sell" && !holding ? 0.35 : 1,
              border: `1px solid ${side === s ? (s === "buy" ? UP : DOWN) : "#2a2f45"}`,
              background: side === s ? (s === "buy" ? "rgba(20,241,149,0.12)" : "rgba(255,77,109,0.12)") : "transparent",
              color: side === s ? (s === "buy" ? UP : DOWN) : MUTED,
            }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {holding && (
        <div style={{ fontSize: 6, color: MUTED, marginBottom: 10 }}>
          YOU OWN {trimAmount(String(holding.amount))} {stock.ticker} . {usd(holdingUsd(holding, q))}
        </div>
      )}

      {/* Pay / receive token */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 6, color: MUTED, width: 44 }}>{side === "buy" ? "PAY" : "GET"}</span>
        {(IS_DEVNET ? (["SOL"] as const) : (["USDC", "SOL"] as const)).map((t) => (
          <button key={t} onClick={() => setPayWith(t)} style={chip(payWith === t)}>{t}</button>
        ))}
      </div>

      {/* Amount presets */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${side === "buy" ? BUY_USD.length : SELL_PCT.length}, 1fr)`, gap: 6, marginBottom: 12 }}>
        {side === "buy"
          ? BUY_USD.map((v) => (
            <button key={v} onClick={() => setUsdAmount(v)} style={{ ...chip(usdAmount === v), padding: "12px 0", fontSize: 8 }}>${v}</button>
          ))
          : SELL_PCT.map((v) => (
            <button key={v} onClick={() => setSellPct(v)} style={{ ...chip(sellPct === v), padding: "12px 0", fontSize: 8 }}>{v === 1 ? "ALL" : `${v * 100}%`}</button>
          ))}
      </div>

      {/* Quote preview */}
      <div style={{ minHeight: 30, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, marginBottom: 10, textAlign: "center", lineHeight: 1.6 }}>
        {status === "quoting" && <span style={{ color: MUTED }}>Finding best price...</span>}
        {status === "ready" && order && <span style={{ color: "#fff" }}>YOU GET <span style={{ color: UP }}>{outPreview}</span></span>}
        {status === "error" && <span style={{ color: DOWN }}>{error}</span>}
        {status === "signing" && <span style={{ color: GOLD }}>Sign in your wallet...</span>}
        {status === "submitting" && <span style={{ color: GOLD }}>Sending to Solana...</span>}
      </div>

      <ShareToggle />

      {!connected ? (
        <button onClick={onConnect} style={primaryBtn(GOLD)}>CONNECT WALLET</button>
      ) : (
        <button onClick={confirm} disabled={!order || busy}
          style={{ ...primaryBtn(side === "buy" ? UP : DOWN), opacity: !order || busy ? 0.4 : 1, cursor: !order || busy ? "not-allowed" : "pointer" }}>
          {side === "buy" ? `BUY ${stock.ticker}` : `SELL ${stock.ticker}`}
        </button>
      )}
    </div>
  );
}

// ── Basket view ──────────────────────────────────────────────────────────

type LegStatus = "waiting" | "quoting" | "ready" | "sent" | "failed";
interface Leg { stock: StockInfo; status: LegStatus; order?: OrderResponse; signature?: string; out?: string; error?: string }

function BasketView(props: {
  basket: StockBasket;
  market: StockMarketState;
  wallet: string;
  connected: boolean;
  signTransaction?: <T>(tx: T) => Promise<T>;
  signAllTransactions?: <T>(txs: T[]) => Promise<T[]>;
  onConnect: () => void;
  onBack: () => void;
  onTraded: () => void;
}) {
  const { basket, market, wallet, connected, signTransaction, signAllTransactions, onConnect, onBack, onTraded } = props;
  const stocks = useMemo(() => basketStocks(basket), [basket]);
  const [total, setTotal] = useState<number | null>(null);
  const [payWith, setPayWith] = useState<PayToken>(IS_DEVNET ? "SOL" : "USDC");
  const [open, setOpen] = useState<string | null>(null);
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [phase, setPhase] = useState<"idle" | "quoting" | "signing" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const perLeg = total ? total / stocks.length : 0;
  const busy = phase === "quoting" || phase === "signing" || phase === "sending";

  const moves = stocks.map((s) => market.quotes[s.mint]?.change24h).filter((v): v is number => v != null);
  const avg = moves.length ? moves.reduce((a, v) => a + v, 0) / moves.length : null;

  const buy = useCallback(async () => {
    if (!total || !wallet || !(signAllTransactions || signTransaction)) return;
    setError("");
    const next: Leg[] = stocks.map((s) => ({ stock: s, status: "waiting" }));
    const update = (i: number, patch: Partial<Leg>) => {
      next[i] = { ...next[i], ...patch };
      setLegs([...next]);
    };
    setLegs([...next]);

    // 1. Quote every leg. Sequential with a retry, so a keyless Jupiter rate
    //    limit (0.5 RPS) slows the basket down instead of failing it.
    setPhase("quoting");
    for (let i = 0; i < stocks.length; i++) {
      update(i, { status: "quoting" });
      for (let attempt = 0; ; attempt++) {
        try {
          const order = await quoteBuy({ stock: stocks[i], usd: perLeg, payWith, taker: wallet, solPrice: market.solPrice });
          update(i, { status: "ready", order });
          break;
        } catch (e: any) {
          if (attempt < 2 && /busy|429/i.test(e?.message ?? "")) { await sleep(2100); continue; }
          update(i, { status: "failed", error: e?.message ?? "Quote failed" });
          break;
        }
      }
    }
    const ready = next.map((l, i) => ({ l, i })).filter(({ l }) => l.status === "ready" && l.order?.transaction);
    if (!ready.length) { setError(next[0]?.error ?? "Could not price this basket."); setPhase("error"); return; }

    // 2. One wallet prompt for every leg (falls back to one per leg).
    setPhase("signing");
    let signed: unknown[];
    try {
      const txs = ready.map(({ l }) => deserializeTransaction(l.order!.transaction!));
      signed = signAllTransactions ? await signAllTransactions(txs) : await Promise.all(txs.map((t) => signTransaction!(t)));
    } catch (e: any) {
      const msg = /reject|cancel|denied/i.test(e?.message ?? "") ? "Signature cancelled." : (e?.message ?? "Signing failed.");
      setError(msg); setPhase("error"); return;
    }

    // 3. Land each leg; one failure doesn't stop the others.
    setPhase("sending");
    let okCount = 0;
    for (let k = 0; k < ready.length; k++) {
      const { l, i } = ready[k];
      const entry = transactionLog.record({
        kind: "stock", layer: IS_DEVNET ? "base" : "jupiter",
        label: `Basket ${basket.name}: buy ${usd(perLeg)} of ${l.stock.ticker} with ${payWith}`, status: "pending",
      });
      try {
        const res = await submitStockOrder(l.order!, signed[k] as any);
        addBuyBasis(wallet, l.stock, l.order!.inUsdValue ?? perLeg, res.outAmount);
        update(i, { status: "sent", signature: res.signature, out: res.outAmount });
        transactionLog.markConfirmed(entry.id, res.signature);
        okCount++;
      } catch (e: any) {
        update(i, { status: "failed", error: e?.message ?? "Failed" });
        transactionLog.markFailed(entry.id, e?.message ?? "failed");
      }
    }

    if (okCount) {
      profileManager.recordSwap({ inputToken: payWith, outputToken: `basket:${basket.id}`, amount: String(total) });
      emitGameEvent("game:swap");
      emitGameEvent("game:stock-trade", { side: "buy", basketId: basket.id, share: getShareTrades() });
      onTraded();
      setPhase("done");
    } else {
      setError(next.find((l) => l.error)?.error ?? "Basket failed.");
      setPhase("error");
    }
  }, [total, wallet, signAllTransactions, signTransaction, stocks, perLeg, payWith, market.solPrice, basket, onTraded]);

  if (phase === "done" && legs) {
    const ok = legs.filter((l) => l.status === "sent");
    return (
      <div style={{ fontFamily: PIXEL, textAlign: "center", padding: "12px 0" }}>
        <div style={{ display: "flex", justifyContent: "center" }}><LogoStack stocks={ok.map((l) => l.stock)} size={34} /></div>
        <div style={{ fontSize: 10, color: UP, marginTop: 14 }}>{ok.length === legs.length ? "BASKET BOUGHT" : `${ok.length} OF ${legs.length} BOUGHT`}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
          {legs.map((l) => (
            <div key={l.stock.mint} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 6, padding: "6px 8px", borderRadius: 6, background: "#12162b" }}>
              <span style={{ color: "#fff" }}>{l.stock.ticker}</span>
              {l.status === "sent" ? (
                <a href={stockTxUrl(l.signature ?? "")} target="_blank" rel="noopener noreferrer" style={{ color: UP }}>
                  +{trimAmount(fromSmallestUnit(l.out ?? "0", l.stock.decimals))}
                </a>
              ) : (
                <span style={{ color: DOWN }}>FAILED</span>
              )}
            </div>
          ))}
        </div>
        <button onClick={onBack} style={{ ...primaryBtn(GOLD), marginTop: 16 }}>BACK TO BASKETS</button>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: PIXEL }}>
      <button onClick={onBack} disabled={busy} style={{ background: "none", border: "none", color: MUTED, fontFamily: PIXEL, fontSize: 7, cursor: "pointer", padding: 0, marginBottom: 12 }}>
        {"< BASKETS"}
      </button>

      {/* Basket header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: GOLD }}>{basket.name.toUpperCase()}</div>
          <div style={{ fontSize: 6, color: MUTED, marginTop: 5, lineHeight: 1.5 }}>{basket.tagline}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 8, color: avg == null ? MUTED : moveColor(avg) }}>{avg == null ? "..." : pct(avg)}</div>
          <div style={{ fontSize: 5, color: MUTED, marginTop: 4 }}>24H AVG</div>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}><LogoStack stocks={stocks} size={30} /></div>

      {/* Stocks, each expandable */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {stocks.map((s) => {
          const q = market.quotes[s.mint];
          const isOpen = open === s.mint;
          const leg = legs?.find((l) => l.stock.mint === s.mint);
          return (
            <div key={s.mint} style={{ borderRadius: 8, background: "#12162b", border: `1px solid ${isOpen ? s.color + "66" : "transparent"}` }}>
              <button onClick={() => setOpen(isOpen ? null : s.mint)} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", padding: 8, background: "none", border: "none", cursor: "pointer", textAlign: "left",
              }}>
                <StockLogo stock={s} size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: PIXEL, fontSize: 7, color: "#fff" }}>{s.ticker}</div>
                  <div style={{ fontFamily: PIXEL, fontSize: 5, color: MUTED, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, fontFamily: PIXEL }}>
                  <div style={{ fontSize: 6, color: "#fff" }}>{q ? usd(q.usdPrice) : "..."}</div>
                  <div style={{ fontSize: 5, color: q ? moveColor(q.change24h) : MUTED, marginTop: 3 }}>{q ? pct(q.change24h) : ""}</div>
                </div>
                {leg ? (
                  <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, margin: "0 1px", background: legColor(leg.status) }} />
                ) : (
                  <span style={{ fontFamily: PIXEL, fontSize: 8, color: GOLD, width: 10, textAlign: "center", flexShrink: 0 }}>{isOpen ? "-" : "+"}</span>
                )}
              </button>
              {isOpen && (
                <div style={{ padding: "0 8px 8px", fontFamily: PIXEL, fontSize: 6, lineHeight: 1.7 }}>
                  <div style={{ color: "#c9cde0" }}>{s.about}</div>
                  {q?.wallStreetPrice != null && q.premiumPct != null && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: MUTED }}>
                      <span>{refLabel(s)} {usd(q.wallStreetPrice)}</span>
                      <span style={{ color: Math.abs(q.premiumPct) < 0.5 ? UP : GOLD }}>SOLANA {pct(q.premiumPct)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: MUTED }}>
                    <span style={{ color: isPreIpo(s) ? "#00D1FF" : MUTED }}>{isPreIpo(s) ? "PRE-IPO, NOT A LISTED SHARE" : s.issuer === "backpack" ? "BACKPACK SECURITIES" : "XSTOCKS BY BACKED"}</span>
                    {perLeg > 0 && <span style={{ color: "#fff" }}>YOU BUY {usd(perLeg)}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pay token */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 6, color: MUTED, width: 44 }}>PAY</span>
        {(IS_DEVNET ? (["SOL"] as const) : (["USDC", "SOL"] as const)).map((t) => (
          <button key={t} onClick={() => setPayWith(t)} disabled={busy} style={chip(payWith === t)}>{t}</button>
        ))}
      </div>

      {/* Total */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${BASKET_USD.length}, 1fr)`, gap: 6, marginBottom: 6 }}>
        {BASKET_USD.map((v) => (
          <button key={v} onClick={() => setTotal(v)} disabled={busy} style={{ ...chip(total === v), padding: "12px 0", fontSize: 8 }}>${v}</button>
        ))}
      </div>
      <div style={{ minHeight: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 6, textAlign: "center", lineHeight: 1.6, marginBottom: 6 }}>
        {phase === "idle" && total && <span style={{ color: MUTED }}>{usd(perLeg)} in each of {stocks.length} stocks</span>}
        {phase === "quoting" && <span style={{ color: MUTED }}>Finding best prices...</span>}
        {phase === "signing" && <span style={{ color: GOLD }}>Sign once in your wallet...</span>}
        {phase === "sending" && <span style={{ color: GOLD }}>Sending to Solana...</span>}
        {phase === "error" && <span style={{ color: DOWN }}>{error}</span>}
      </div>

      <ShareToggle />

      {!connected ? (
        <button onClick={onConnect} style={primaryBtn(GOLD)}>CONNECT WALLET</button>
      ) : (
        <button onClick={buy} disabled={!total || busy}
          style={{ ...primaryBtn(UP), opacity: !total || busy ? 0.4 : 1, cursor: !total || busy ? "not-allowed" : "pointer" }}>
          {total ? `BUY BASKET FOR ${usd(total)}` : "PICK AN AMOUNT"}
        </button>
      )}
    </div>
  );
}

/** Status dot per basket leg: green landed, red failed, gold in progress. */
function legColor(s: LegStatus): string {
  return s === "sent" ? UP : s === "failed" ? DOWN : s === "waiting" ? "#3a3f55" : GOLD;
}

/** Overlapping round logos, e.g. every stock in a basket. */
function LogoStack({ stocks, size }: { stocks: StockInfo[]; size: number }) {
  const overlap = Math.round(size * 0.3);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {stocks.map((s, i) => (
        <div key={s.mint} style={{ marginLeft: i ? -overlap : 0, borderRadius: "50%", boxShadow: "0 0 0 2px #0b0f24", zIndex: stocks.length - i, position: "relative", lineHeight: 0 }}>
          <StockLogo stock={s} size={size} />
        </div>
      ))}
    </div>
  );
}

/** "Show my trades in the city", remembered per browser. */
function ShareToggle() {
  const [share, setShare] = useState(true);
  useEffect(() => { setShare(getShareTrades()); }, []);
  const toggle = () => { const v = !share; setShare(v); setShareTrades(v); };
  return (
    <button onClick={toggle} style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 0", marginBottom: 10,
      background: "none", border: "none", cursor: "pointer", fontFamily: PIXEL, fontSize: 6, color: share ? "#c9cde0" : MUTED, textAlign: "left",
    }}>
      <span style={{
        width: 12, height: 12, borderRadius: 3, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${share ? UP : "#3a3f55"}`, background: share ? "rgba(20,241,149,0.15)" : "transparent",
      }}>
        {share && <span style={{ width: 6, height: 6, borderRadius: 1, background: UP }} />}
      </span>
      SHOW MY TRADES IN THE CITY
    </button>
  );
}

function StockLogo({ stock, size }: { stock: StockInfo; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%", background: stock.color, flexShrink: 0, display: "flex",
        alignItems: "center", justifyContent: "center", fontFamily: PIXEL, fontSize: Math.max(5, size / 5), color: "#0b0f24",
      }}>
        {stock.ticker.slice(0, 2)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={stock.logo} alt={stock.ticker} width={size} height={size} onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: "50%", background: "#fff", objectFit: "cover", flexShrink: 0 }} />
  );
}

function trimAmount(s: string): string {
  const n = Number(s);
  if (!isFinite(n)) return s;
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function chip(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "8px 0", borderRadius: 8, cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
    border: `1px solid ${active ? GOLD : "#2a2f45"}`,
    background: active ? "rgba(255,181,71,0.14)" : "transparent",
    color: active ? GOLD : "#c9cde0",
  };
}

function primaryBtn(bg: string): React.CSSProperties {
  return {
    width: "100%", padding: "12px 0", borderRadius: 10, border: "none", cursor: "pointer",
    fontFamily: PIXEL, fontSize: 8, background: bg, color: "#0b0f24",
  };
}
