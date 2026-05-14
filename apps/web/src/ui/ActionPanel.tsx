"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { NPCAction } from "@/game/config/npcRegistry";
import type { EarnListing, EarnListingType } from "@/game/solana/superteamEarn";
import { transactionLog } from "@/game/telemetry/transactionLog";
import { profileManager } from "@/game/config/profileManager";
import { Connection } from "@solana/web3.js";

function emitGameEvent(event: string): void {
  ((globalThis as any).__solCityGameEvents)?.emit(event);
}

interface ActionPanelProps {
  action: NPCAction | null;
  onClose: () => void;
}

export default function ActionPanel({ action, onClose }: ActionPanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!action) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(6,10,20,0.6)" }}
        onClick={onClose}
      />
      <div
        className="relative rounded-2xl p-6 w-full max-w-md"
        style={{
          background: "rgba(10,10,30,0.97)",
          border: "1px solid rgba(153,69,255,0.25)",
          fontFamily: '"Fira Code", monospace',
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-lg cursor-pointer"
          style={{ background: "none", border: "none", color: "#555566" }}
        >
          ×
        </button>

        {action.type === "tutor"           && <TutorPanel           onClose={onClose} />}
        {action.type === "swap"            && <SwapPanel            onClose={onClose} />}
        {action.type === "transfer"        && <TransferPanel        onClose={onClose} />}
        {action.type === "bounties"        && <BountiesPanel        onClose={onClose} />}
        {action.type === "private-payment" && <PrivatePaymentPanel  onClose={onClose} />}
      </div>
    </div>
  );
}

// ── Swap Panel (Jupiter V6 — no API key required) ─────────────────────

function SwapPanel({ onClose }: { onClose: () => void }) {
  const { connected, publicKey, signTransaction } = useWallet();
  const [inputToken,  setInputToken]  = useState("SOL");
  const [outputToken, setOutputToken] = useState("USDC");
  const [amount,  setAmount]  = useState("0.1");
  const [quote,   setQuote]   = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [status,  setStatus]  = useState<"idle"|"quoting"|"signing"|"submitting"|"done"|"error">("idle");
  const [result,  setResult]  = useState<{ signature?: string; outAmount?: string; error?: string } | null>(null);

  const jupRef = useRef<typeof import("@/game/solana/jupiterSwap") | null>(null);
  useEffect(() => { import("@/game/solana/jupiterSwap").then(m => { jupRef.current = m; }); }, []);

  const handleQuote = useCallback(async () => {
    const jup = jupRef.current;
    if (!jup || !publicKey || !amount) return;
    const input  = jup.getTokenBySymbol(inputToken);
    const output = jup.getTokenBySymbol(outputToken);
    if (!input || !output) return;

    setLoading(true);
    setStatus("quoting");
    setResult(null);
    try {
      const smallest = jup.toSmallestUnit(amount, input.decimals);
      const q = await jup.getQuote(input.mint, output.mint, smallest);
      setQuote(q);
      setStatus("idle");
    } catch (err: any) {
      setResult({ error: err.message });
      setStatus("error");
    }
    setLoading(false);
  }, [publicKey, inputToken, outputToken, amount]);

  const handleSwap = useCallback(async () => {
    const jup = jupRef.current;
    if (!jup || !quote || !signTransaction || !publicKey) return;

    const logEntry = transactionLog.record({
      kind: "swap",
      layer: "jupiter",
      label: `Swap ${amount} ${inputToken} → ${outputToken}`,
      status: "pending",
    });

    setStatus("signing");
    try {
      // Build the transaction server-side (Jupiter signs the RFQ parts)
      const { swapTransaction } = await jup.buildSwapTransaction(quote, publicKey.toBase58());
      const tx = jup.deserializeTransaction(swapTransaction);

      // User signs with their wallet
      const signed = await signTransaction(tx as any);
      setStatus("submitting");

      // Submit to mainnet via a public RPC (Jupiter swaps are always mainnet)
      const mainnetConnection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const signature = await mainnetConnection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await mainnetConnection.confirmTransaction(signature, "confirmed");

      const outToken = jup.getTokenByMint(quote.outputMint);
      const outHuman = outToken
        ? jup.fromSmallestUnit(quote.outAmount, outToken.decimals)
        : quote.outAmount;

      setResult({ signature, outAmount: outHuman });
      setStatus("done");
      transactionLog.markConfirmed(logEntry.id, signature);
      profileManager.recordSwap({ inputToken, outputToken, amount });
      emitGameEvent("game:swap");
    } catch (err: any) {
      setResult({ error: err.message });
      setStatus("error");
      transactionLog.markFailed(logEntry.id, err.message ?? "swap failed");
    }
  }, [quote, signTransaction, publicKey, amount, inputToken, outputToken]);

  const tokens = TOKEN_LIST_SYMBOLS;

  const getTokenLogo = (symbol: string) => {
    const jup = jupRef.current;
    return jup?.getTokenBySymbol(symbol)?.logo ?? "";
  };

  if (status === "done" && result) {
    return (
      <>
        <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#FFD700", marginBottom: 16 }}>
          TOKEN SWAP
        </h3>
        <div className="text-center py-6">
          <div style={{ fontSize: 32, color: "#14F195" }}>OK</div>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "10px", color: "#14F195", marginTop: 8 }}>
            SWAP COMPLETE
          </div>
          <div style={{ fontSize: "12px", color: "#888899", marginTop: 8 }}>
            Received: {result.outAmount} {outputToken}
          </div>
          {result.signature && (
            <a href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", marginTop: 8, fontSize: "12px", color: "#00D1FF" }}>
              View on Solscan ↗
            </a>
          )}
          <button onClick={onClose} style={btnStyle("#14F195")} className="w-full mt-4">CLOSE</button>
        </div>
      </>
    );
  }

  if (status === "error" && result) {
    return (
      <>
        <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#FFD700", marginBottom: 16 }}>
          TOKEN SWAP
        </h3>
        <div className="text-center py-6">
          <div style={{ fontSize: "12px", color: "#ff4444", marginBottom: 12 }}>{result.error}</div>
          <button onClick={() => { setStatus("idle"); setResult(null); setQuote(null); }}
            style={btnStyle("#333344", "#888899")} className="px-4 py-2">Try again</button>
        </div>
      </>
    );
  }

  return (
    <>
      <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#FFD700", marginBottom: 16 }}>
        TOKEN SWAP
      </h3>

      {/* ⚠️ mainnet note */}
      <div style={{ fontSize: "9px", color: "#555566", marginBottom: 12, textAlign: "center" }}>
        Jupiter operates on mainnet · real SOL required
      </div>

      {/* Input token */}
      <TokenBox label="From" token={inputToken} onTokenChange={(t) => { setInputToken(t); setQuote(null); }}
        excludeToken={outputToken} tokens={tokens} getLogo={getTokenLogo}>
        <input type="text" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
          placeholder="0.0" style={{ background: "transparent", color: "#fff", border: "none", fontSize: 20, fontFamily: "monospace", width: "100%", outline: "none" }} />
      </TokenBox>

      <div style={{ textAlign: "center", color: "#555566", marginBottom: 4 }}>↓</div>

      {/* Output token */}
      <TokenBox label="To" token={outputToken} onTokenChange={(t) => { setOutputToken(t); setQuote(null); }}
        excludeToken={inputToken} tokens={tokens} getLogo={getTokenLogo}>
        <div style={{ fontSize: 20, fontFamily: "monospace", color: quote ? "#fff" : "#333344" }}>
          {quote
            ? (() => { const jup = jupRef.current; const out = jup?.getTokenBySymbol(outputToken); return out ? jup?.fromSmallestUnit(quote.outAmount, out.decimals) : "..."; })()
            : "..."}
        </div>
      </TokenBox>

      {quote && (
        <div style={{ fontSize: "11px", color: "#555566", display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <span>via Jupiter V6</span>
          <span>slippage: {quote.slippageBps ? `${(quote.slippageBps / 100).toFixed(1)}%` : "auto"}</span>
          <span>impact: {parseFloat(quote.priceImpactPct ?? "0").toFixed(3)}%</span>
        </div>
      )}

      <div className="flex gap-2 mt-4">
        {!quote ? (
          <button onClick={handleQuote} disabled={!connected || loading || !amount}
            style={btnStyle(connected ? "#FFD700" : "#333344", connected ? "#000" : "#666677")} className="flex-1 py-2.5">
            {!connected ? "CONNECT WALLET FIRST" : loading ? "GETTING QUOTE..." : "GET QUOTE"}
          </button>
        ) : (
          <button onClick={handleSwap} disabled={status === "signing" || status === "submitting"}
            style={btnStyle("#14F195", "#000")} className="flex-1 py-2.5">
            {status === "signing" ? "SIGN IN WALLET..." : status === "submitting" ? "SUBMITTING..." : "CONFIRM SWAP"}
          </button>
        )}
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #333344", color: "#666677", borderRadius: 8, padding: "0 16px", cursor: "pointer", fontSize: 12 }}>ESC</button>
      </div>
    </>
  );
}

// ── Transfer Panel ────────────────────────────────────────────────────

function TransferPanel({ onClose }: { onClose: () => void }) {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [result, setResult] = useState<{ signature?: string; error?: string } | null>(null);

  const handleSend = useCallback(async () => {
    if (!publicKey || !recipient || !amount) return;
    const { buildSolTransfer, isValidAddress } = await import("@/game/solana/transfer");
    const { PublicKey } = await import("@solana/web3.js");

    if (!isValidAddress(recipient)) { setResult({ error: "Invalid Solana address" }); setStatus("error"); return; }
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { setResult({ error: "Invalid amount" }); setStatus("error"); return; }

    setStatus("sending");
    const logEntry = transactionLog.record({
      kind: "transfer",
      layer: "base",
      label: `Send ${amount} SOL → ${recipient.slice(0, 4)}…${recipient.slice(-4)}`,
      status: "pending",
    });
    try {
      const tx = await buildSolTransfer(connection, publicKey, new PublicKey(recipient), parsed);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setResult({ signature: sig });
      setStatus("done");
      transactionLog.markConfirmed(logEntry.id, sig);
      profileManager.recordTransfer({ recipient, amount });
      emitGameEvent("game:transfer");
    } catch (err: any) {
      setResult({ error: err.message });
      setStatus("error");
      transactionLog.markFailed(logEntry.id, err.message ?? "transfer failed");
    }
  }, [publicKey, recipient, amount, connection, sendTransaction]);

  if (status === "done" && result?.signature) {
    return (
      <>
        <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#00D1FF", marginBottom: 16 }}>SEND SOL</h3>
        <div className="text-center py-6">
          <div style={{ fontSize: 32, color: "#14F195" }}>OK</div>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "10px", color: "#14F195", marginTop: 8 }}>TRANSFER SENT</div>
          <div style={{ fontSize: "12px", color: "#888899", marginTop: 8 }}>{amount} SOL sent</div>
          <a href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", marginTop: 8, fontSize: "12px", color: "#00D1FF" }}>View on Explorer ↗</a>
          <button onClick={onClose} style={btnStyle("#00D1FF", "#000")} className="w-full mt-4">CLOSE</button>
        </div>
      </>
    );
  }

  if (status === "error" && result) {
    return (
      <>
        <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#00D1FF", marginBottom: 16 }}>SEND SOL</h3>
        <div className="text-center py-6">
          <div style={{ fontSize: "12px", color: "#ff4444", marginBottom: 12 }}>{result.error}</div>
          <button onClick={() => { setStatus("idle"); setResult(null); }} style={btnStyle("#333344", "#888899")} className="px-4 py-2">Try again</button>
        </div>
      </>
    );
  }

  return (
    <>
      <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#00D1FF", marginBottom: 16 }}>SEND SOL</h3>
      <InputBox label="Recipient address">
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)}
          placeholder="Paste Solana address…"
          style={{ background: "transparent", color: "#fff", border: "none", fontSize: 12, fontFamily: "monospace", width: "100%", outline: "none" }} />
      </InputBox>
      <InputBox label="Amount (SOL)">
        <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01"
          style={{ background: "transparent", color: "#fff", border: "none", fontSize: 20, fontFamily: "monospace", width: "100%", outline: "none", fontWeight: "bold" }} />
      </InputBox>
      <div style={{ fontSize: "9px", color: "#555566", marginTop: 4, marginBottom: 12, textAlign: "center" }}>
        Transfers on devnet · requires devnet SOL
      </div>
      <div className="flex gap-2">
        <button onClick={handleSend} disabled={!connected || status === "sending" || !recipient || !amount}
          style={btnStyle(connected ? "#00D1FF" : "#333344", connected ? "#000" : "#666677")} className="flex-1 py-2.5">
          {!connected ? "CONNECT WALLET FIRST" : status === "sending" ? "SENDING…" : "SEND"}
        </button>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #333344", color: "#666677", borderRadius: 8, padding: "0 16px", cursor: "pointer", fontSize: 12 }}>ESC</button>
      </div>
    </>
  );
}

// ── Bounties Panel (Superteam Earn) ──────────────────────────────────

type EarnCategory = {
  type: EarnListingType;
  label: string;
  sublabel: string;
  color: string;
  viewAllUrl: string;
};

const EARN_CATEGORIES: EarnCategory[] = [
  { type: "bounty",    label: "Bounties",         sublabel: "Quick tasks, fast pay",  color: "#14F195", viewAllUrl: "https://superteam.fun/earn/all?tab=bounties"    },
  { type: "project",   label: "Projects",          sublabel: "Longer engagements",     color: "#00D1FF", viewAllUrl: "https://superteam.fun/earn/all?tab=projects"    },
  { type: "grant",     label: "Grants",            sublabel: "Build something bigger", color: "#9945FF", viewAllUrl: "https://superteam.fun/earn/grants"              },
  { type: "hackathon", label: "Hackathon Tracks",  sublabel: "Compete and win",        color: "#FFD700", viewAllUrl: "https://superteam.fun/earn/hackathon/frontier"  },
];

// ── Curated bounty list — update periodically from earn.superteam.fun ─
// Last updated: 2026-05-12
const CURATED_BOUNTIES: EarnListing[] = [
  { title: "Create Content about the Solana Summit in Germany",        rewardAmount: 10000, token: "USDG", deadline: "2026-06-05T21:59:59.000Z", sponsorName: "Superteam Germany",    slug: "create-content-about-the-solana-summit-in-germany",                          type: "bounty" },
  { title: "Solana Summit Kazakhstan — Startup Battle",                rewardAmount: 10000, token: "USDG", deadline: "2026-05-23T18:59:59.000Z", sponsorName: "Superteam Kazakhstan", slug: "solana-summit-kazakhstan-startup-battle-live-pitch-competition",              type: "bounty" },
  { title: "Promote Solana Summit Kazakhstan — Content & Community",   rewardAmount: 7000,  token: "USDG", deadline: "2026-05-21T18:59:59.000Z", sponsorName: "Superteam Kazakhstan", slug: "promote-solana-summit-kazakhstan-content-and-community-bounty",               type: "bounty" },
  { title: "Create Your Own Currency on Flipcash",                     rewardAmount: 2250,  token: "USDC", deadline: "2026-05-23T03:59:59.999Z", sponsorName: "Flipcash",             slug: "create-your-own-currency-on-flipcash",                                        type: "bounty" },
  { title: "Artist Competition at Solana Breakpoint London 2026",      rewardAmount: 1500,  token: "USDG", deadline: "2026-05-15T22:59:59.999Z", sponsorName: "Superteam UK",         slug: "bp26-artist-competition",                                                     type: "bounty" },
  { title: "Pitch & Demo Your Project at Kyiv Demo Day",               rewardAmount: 1700,  token: "USDG", deadline: "2026-05-16T20:59:59.999Z", sponsorName: "Superteam Ukraine",    slug: "pitch-and-demo-your-project-at-kyiv-demo-day",                                type: "bounty" },
  { title: "Birdeye Data 4-Week BIP Competition — Sprint 4",           rewardAmount: 500,   token: "USDC", deadline: "2026-05-16T16:59:59.999Z", sponsorName: "Birdeye Data",         slug: "birdeye-data-4-week-bip-competition-sprint-4",                                type: "bounty" },
  { title: "Write Engaging Twitter Thread on CoinEx Earn",             rewardAmount: 500,   token: "USDC", deadline: "2026-05-25T18:29:59.000Z", sponsorName: "CoinEx",               slug: "write-engaging-twitter-thread-on-coinex-earn-for-staking-rewards",            type: "bounty" },
  { title: "Write a Twitter thread on Raze",                           rewardAmount: 180,   token: "USDC", deadline: "2026-05-24T15:59:59.000Z", sponsorName: "Raze",                 slug: "write-a-twitter-thread-on-raze",                                              type: "bounty" },
  { title: "Write a Twitter Thread on Kimia Protocol",                 rewardAmount: 110,   token: "USDC", deadline: "2026-05-26T18:29:59.000Z", sponsorName: "Kimia",                slug: "write-a-twitter-thread-on-kimia-protocol",                                    type: "bounty" },
];

function BountiesPanel({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<EarnCategory | null>(null);

  if (selected) {
    return <EarnListingsStage category={selected} onBack={() => setSelected(null)} onClose={onClose} />;
  }

  return (
    <>
      <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#9945FF", marginBottom: 10 }}>
        SUPERTEAM EARN
      </h3>

      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: "12px", color: "#ccccdd", marginBottom: 6, lineHeight: 1.5 }}>
          Get paid to work on Solana. Tasks for designers, devs, and writers.
        </p>
        <p style={{ fontSize: "10px", color: "#14F195", marginBottom: 5 }}>
          Rewards from $50 to $5,000+ · Paid in USDC · Open to everyone
        </p>
        <p style={{ fontSize: "10px", color: "#777788", lineHeight: 1.5 }}>
          Whether you have 2 hours or 2 weeks, there's something here for you.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        {EARN_CATEGORIES.map((cat) => (
          <div
            key={cat.type}
            onClick={() => setSelected(cat)}
            style={{
              background: "#12122a",
              border: `1px solid ${cat.color}33`,
              borderRadius: 8,
              padding: 12,
              cursor: "pointer",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = `${cat.color}66`; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = `${cat.color}33`; }}
          >
            <div style={{ fontSize: "11px", color: cat.color, fontWeight: "bold", marginBottom: 4 }}>
              {cat.label}
            </div>
            <div style={{ fontSize: "10px", color: "#777788", marginBottom: 10 }}>
              {cat.sublabel}
            </div>
            <a
              href={cat.viewAllUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: "9px", color: cat.color, textDecoration: "none", borderBottom: `1px solid ${cat.color}44`, paddingBottom: 1 }}
            >
              View All →
            </a>
          </div>
        ))}
      </div>

      <button
        onClick={onClose}
        style={{ background: "transparent", border: "1px solid #333344", color: "#666677", borderRadius: 8, padding: "8px 0", cursor: "pointer", fontSize: 12, width: "100%" }}
      >
        ESC
      </button>
    </>
  );
}

function EarnListingsStage({
  category,
  onBack,
  onClose,
}: {
  category: EarnCategory;
  onBack: () => void;
  onClose: () => void;
}) {
  const isBounty = category.type === "bounty";

  const activeBounties = CURATED_BOUNTIES.filter(
    (b) => !b.deadline || new Date(b.deadline) > new Date()
  );
  const [listings, setListings] = useState<EarnListing[]>(isBounty ? activeBounties : []);
  const [loading, setLoading]   = useState(!isBounty);
  const [failed, setFailed]     = useState(false);

  useEffect(() => {
    if (isBounty) return; // bounties use the static curated list
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    import("@/game/solana/superteamEarn").then(({ fetchEarnListings }) => {
      fetchEarnListings(category.type, 5)
        .then((items) => {
          if (!cancelled) { setListings(items); setLoading(false); }
        })
        .catch(() => {
          if (!cancelled) { setFailed(true); setLoading(false); }
        });
    });

    return () => { cancelled = true; };
  }, [category.type, isBounty]);

  const formatDeadline = (deadline: string | null) => {
    if (!deadline) return "Open";
    try {
      const d = new Date(deadline);
      return `Due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    } catch {
      return "Open";
    }
  };

  const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

  const isGrants = category.type === "grant";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <button
          onClick={onBack}
          style={{ background: "transparent", border: `1px solid ${category.color}44`, color: category.color, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: '"Press Start 2P", monospace', fontSize: "8px" }}
        >
          ← BACK
        </button>
        <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "10px", color: category.color, margin: 0 }}>
          {category.label.toUpperCase()}
        </h3>
      </div>

      <div style={{ maxHeight: isGrants ? 360 : 280, overflowY: "auto" }}>

        {/* ── Grants: informational panel (always shown) ── */}
        {isGrants && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: "11px", color: "#888899", marginBottom: 10, lineHeight: 1.6 }}>
              Equity-free funding to build something real on Solana. No pitch deck, no investor meetings.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              <StepCard
                number={1}
                title="What is a grant?"
                color="#9945FF"
                description="No equity taken. You keep 100% of your project and ship on your own terms."
              />
              <StepCard
                number={2}
                title="Who can apply?"
                color="#00D1FF"
                description="Developers, designers, researchers, and community builders with a clear idea and the skills to ship it."
              />
              <StepCard
                number={3}
                title="How much can I get?"
                color="#14F195"
                description="Community grants start at a few hundred USDC. Larger ecosystem grants can reach $50,000+. Always paid in USDC."
              />
              <StepCard
                number={4}
                title="How do I apply?"
                color="#FFD700"
                description="Browse open grants, write a short proposal. Most decisions take 1–3 weeks. No VC meetings required."
              />
            </div>
            {/* Divider before live listings */}
            <div style={{ fontSize: "9px", color: "#333344", textAlign: "center", marginBottom: 10, letterSpacing: 2 }}>
              ── CURRENT OPEN GRANTS ──
            </div>
          </div>
        )}

        {/* ── Loading state ── */}
        {loading && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#555566", fontSize: "11px" }}>
            Loading listings…
          </div>
        )}

        {/* ── Empty / error state ── */}
        {!loading && (failed || listings.length === 0) && (
          <div style={{ textAlign: "center", padding: isGrants ? "12px 0" : "20px 0" }}>
            <div style={{ fontSize: "11px", color: "#777788", marginBottom: 12, lineHeight: 1.6 }}>
              {failed
                ? "Couldn't load listings right now."
                : isGrants
                  ? "No open grants at the moment. New rounds open regularly, check back soon."
                  : "No open listings right now. Check back soon!"}
            </div>
            <a
              href={category.viewAllUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "10px", color: category.color, textDecoration: "none" }}
            >
              Browse all {category.label.toLowerCase()} →
            </a>
          </div>
        )}

        {/* ── Live listings ── */}
        {!loading && !failed && listings.map((listing, i) => (
          <a
            key={i}
            href={`https://superteam.fun/earn/listings/${listing.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              background: "#12122a",
              border: "1px solid rgba(255,255,255,0.04)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
              textDecoration: "none",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = `${category.color}33`; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.04)"; }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#ccccdd", fontSize: "12px", marginBottom: 3 }}>
                  {truncate(listing.title, 40)}
                </div>
                <div style={{ fontSize: "10px", color: "#555566" }}>{listing.sponsorName}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "9px", color: category.color }}>
                  {listing.rewardAmount ? `$${listing.rewardAmount} ${listing.token}` : "Variable"}
                </div>
                <div style={{ fontSize: "9px", color: "#555566", marginTop: 3 }}>
                  {formatDeadline(listing.deadline)}
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <a
          href={category.viewAllUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flex: 1, background: `${category.color}18`, color: category.color, border: `1px solid ${category.color}33`, borderRadius: 8, padding: "10px 0", textAlign: "center", fontFamily: '"Press Start 2P", monospace', fontSize: "8px", textDecoration: "none", display: "block" }}
        >
          SEE ALL {category.label.toUpperCase()} →
        </a>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "1px solid #333344", color: "#666677", borderRadius: 8, padding: "0 16px", cursor: "pointer", fontSize: 12 }}
        >
          ESC
        </button>
      </div>
    </>
  );
}

// ── Tutor Panel ───────────────────────────────────────────────────────

function TutorPanel({ onClose }: { onClose: () => void }) {
  const { connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();

  return (
    <>
      <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#14F195", marginBottom: 16 }}>
        GETTING STARTED
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        <StepCard number={1} title="Connect your wallet" color="#9945FF"
          description="Your wallet is your identity here. Phantom and Solflare work great."
          action={!connected ? (
            <button onClick={() => openWalletModal(true)}
              style={{ ...btnStyle("rgba(153,69,255,0.8)"), marginTop: 8, fontSize: "7px", padding: "6px 12px" }}>
              CONNECT NOW
            </button>
          ) : (
            <span style={{ fontSize: "11px", color: "#14F195", display: "block", marginTop: 4 }}>✓ Connected</span>
          )}
        />
        <StepCard number={2} title="Swap tokens" color="#FFD700"
          description="Walk to Jupiter Joe (gold NPC, north) and press E to exchange tokens via Jupiter." />
        <StepCard number={3} title="Send SOL" color="#00D1FF"
          description="Visit Postmaster Ana (blue NPC) to transfer SOL to any wallet on devnet." />
        <StepCard number={4} title="Explore & earn" color="#9945FF"
          description="Check the Superteam Hub for bounties. Every interaction earns score and unlocks outfits!" />
      </div>
      <button onClick={onClose} style={btnStyle("#14F195", "#000")} className="w-full py-2.5">START EXPLORING</button>
    </>
  );
}

// ── Private Payment Panel (MagicBlock PER) ───────────────────────────

type PayStatus =
  | "idle"
  | "authenticating"
  | "ready"
  | "depositing"
  | "transferring"
  | "done"
  | "error";

function PrivatePaymentPanel({ onClose }: { onClose: () => void }) {
  const { connected, publicKey, signTransaction, signMessage } = useWallet();
  const [cluster, setCluster]           = useState<"mainnet" | "devnet">("devnet");
  const [status, setStatus]             = useState<PayStatus>("idle");
  const [authToken, setAuthToken]       = useState<string | null>(null);
  const [balance, setBalance]           = useState<number | null>(null);
  const [showBalance, setShowBalance]   = useState(false);
  const [recipient, setRecipient]       = useState("");
  const [amount, setAmount]             = useState("1");
  const [showAmount, setShowAmount]     = useState(false);
  const [depositAmt, setDepositAmt]     = useState("5");
  const [error, setError]               = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<"deposit" | "send">("send");

  // Re-authenticate whenever cluster changes
  useEffect(() => {
    if (!connected || !publicKey || !signMessage) return;
    setStatus("authenticating");
    setAuthToken(null);
    setBalance(null);
    setError(null);

    import("@/game/solana/magicblockPayments").then(async (mb) => {
      try {
        const { token } = await mb.authenticate(publicKey, signMessage, cluster);
        setAuthToken(token);
        const bal = await mb.getPrivateBalance(publicKey.toBase58(), token, cluster);
        setBalance(bal);
        setStatus("ready");
      } catch (e: any) {
        setError(e.message ?? "Authentication failed");
        setStatus("error");
      }
    });
  }, [connected, publicKey, signMessage, cluster]);

  const refreshBalance = async () => {
    if (!authToken || !publicKey) return;
    const mb = await import("@/game/solana/magicblockPayments");
    const bal = await mb.getPrivateBalance(publicKey.toBase58(), authToken, cluster);
    setBalance(bal);
  };

  const handleDeposit = async () => {
    if (!publicKey || !signTransaction || !authToken) return;
    const parsed = parseFloat(depositAmt);
    if (isNaN(parsed) || parsed <= 0) { setError("Invalid amount"); return; }

    setStatus("depositing");
    setError(null);
    try {
      const mb = await import("@/game/solana/magicblockPayments");
      const txData = await mb.buildDeposit(publicKey.toBase58(), parsed, cluster);
      await mb.signAndSubmit(txData, signTransaction as any, authToken, cluster);
      await refreshBalance();
      setStatus("ready");
    } catch (e: any) {
      setError(e.message ?? "Deposit failed");
      setStatus("ready");
    }
  };

  const handleTransfer = async () => {
    if (!publicKey || !signTransaction || !authToken) return;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { setError("Invalid amount"); return; }
    const { isValidAddress } = await import("@/game/solana/transfer");
    if (!isValidAddress(recipient)) { setError("Invalid recipient address"); return; }
    if (balance !== null && parsed > balance) { setError("Insufficient private balance"); return; }

    setStatus("transferring");
    setError(null);
    try {
      const mb = await import("@/game/solana/magicblockPayments");
      const txData = await mb.buildPrivateTransfer(publicKey.toBase58(), recipient, parsed, authToken, cluster);
      await mb.signAndSubmit(txData, signTransaction as any, authToken, cluster);
      // Success — don't show a transaction link (that's the whole point)
      setStatus("done");
      emitGameEvent("game:transfer");
      transactionLog.record({
        kind: "transfer",
        layer: "ephemeral",
        label: `Private ${parsed} USDC (shielded)`,
        status: "confirmed",
      });
    } catch (e: any) {
      setError(e.message ?? "Transfer failed");
      setStatus("ready");
    }
  };

  const FUCHSIA = "#c026d3";

  if (!connected) {
    return (
      <>
        <PanelHeader color={FUCHSIA} title="PRIVATE TRANSFER" />
        <ClusterToggle cluster={cluster} onChange={setCluster} />
        <div style={{ textAlign: "center", padding: "24px 0", color: "#888899", fontSize: 12 }}>
          Connect your wallet to access private payments.
        </div>
        <button onClick={onClose} style={btnStyle(FUCHSIA, "#fff")} className="w-full py-2.5 mt-2">CLOSE</button>
      </>
    );
  }

  if (status === "authenticating") {
    return (
      <>
        <PanelHeader color={FUCHSIA} title="PRIVATE TRANSFER" />
        <ClusterToggle cluster={cluster} onChange={setCluster} disabled />
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <div style={{ fontSize: 11, color: "#888899", marginBottom: 8 }}>Authenticating with wallet…</div>
          <div style={{ fontSize: 9, color: "#555566" }}>Sign the message in your wallet to verify identity</div>
        </div>
      </>
    );
  }

  if (status === "done") {
    return (
      <>
        <PanelHeader color={FUCHSIA} title="PRIVATE TRANSFER" />
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 28, color: FUCHSIA, marginBottom: 8 }}>◈</div>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: FUCHSIA, marginBottom: 12 }}>
            TRANSFER SHIELDED
          </div>
          <div style={{ fontSize: 11, color: "#888899", lineHeight: 1.6, marginBottom: 4 }}>
            Settled privately via MagicBlock PER.
          </div>
          <div style={{ fontSize: 10, color: "#555566" }}>No on-chain trace. No explorer link.</div>
        </div>
        <button onClick={onClose} style={btnStyle(FUCHSIA, "#fff")} className="w-full py-2.5 mt-2">CLOSE</button>
      </>
    );
  }

  return (
    <>
      <PanelHeader color={FUCHSIA} title="PRIVATE TRANSFER" />
      <ClusterToggle cluster={cluster} onChange={setCluster} />

      {/* Private balance */}
      <div style={{ background: "#0d0d22", border: `1px solid ${FUCHSIA}33`, borderRadius: 8, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#777788" }}>Private USDC balance</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 10, color: FUCHSIA }}>
            {balance === null ? "…" : showBalance ? `${balance.toFixed(2)} USDC` : "●●●●"}
          </span>
          <button
            onClick={() => setShowBalance(v => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#555566", fontSize: 14, padding: 0, lineHeight: 1 }}
            title={showBalance ? "Hide balance" : "Show balance"}
          >
            {showBalance ? "◉" : "◎"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {(["send", "deposit"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: "6px 0", borderRadius: 6, border: "none", cursor: "pointer",
              fontFamily: '"Press Start 2P", monospace', fontSize: 8,
              background: activeTab === tab ? `${FUCHSIA}22` : "#0d0d22",
              color: activeTab === tab ? FUCHSIA : "#444455",
              borderBottom: activeTab === tab ? `2px solid ${FUCHSIA}` : "2px solid transparent",
            }}
          >
            {tab === "send" ? "SEND" : "DEPOSIT"}
          </button>
        ))}
      </div>

      {/* Send tab */}
      {activeTab === "send" && (
        <>
          <InputBox label="Recipient address">
            <input
              type="text"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="Paste Solana address…"
              style={{ background: "transparent", color: "#fff", border: "none", fontSize: 11, fontFamily: "monospace", width: "100%", outline: "none" }}
            />
          </InputBox>
          <div style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#555566", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Amount (USDC)</span>
              <button
                onClick={() => setShowAmount(v => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#555566", fontSize: 13, padding: 0 }}
                title={showAmount ? "Hide amount" : "Show amount"}
              >
                {showAmount ? "◉" : "◎"}
              </button>
            </div>
            {showAmount ? (
              <input
                type="text"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                style={{ background: "transparent", color: "#fff", border: "none", fontSize: 20, fontFamily: "monospace", width: "100%", outline: "none", fontWeight: "bold" }}
              />
            ) : (
              <div style={{ fontSize: 20, fontFamily: "monospace", color: "#777788", letterSpacing: 4 }}>●●●●</div>
            )}
          </div>
          <div style={{ fontSize: 9, color: "#555566", textAlign: "center", marginBottom: 12 }}>
            Shielded via MagicBlock Private Ephemeral Rollup · Intel TDX
          </div>
          {error && <div style={{ fontSize: 11, color: "#ff4444", marginBottom: 8, textAlign: "center" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleTransfer}
              disabled={status === "transferring" || !balance || balance <= 0}
              style={btnStyle(balance && balance > 0 ? FUCHSIA : "#333344", "#fff")}
              className="flex-1 py-2.5"
            >
              {status === "transferring" ? "SIGNING…" : "SEND PRIVATELY"}
            </button>
            <button onClick={onClose} style={{ background: "transparent", border: "1px solid #333344", color: "#666677", borderRadius: 8, padding: "0 14px", cursor: "pointer", fontSize: 12 }}>ESC</button>
          </div>
        </>
      )}

      {/* Deposit tab */}
      {activeTab === "deposit" && (
        <>
          <div style={{ fontSize: 11, color: "#777788", marginBottom: 12, lineHeight: 1.6 }}>
            Deposit USDC from your wallet into the Private Ephemeral Rollup to enable shielded transfers.
          </div>
          <InputBox label="Amount to deposit (USDC)">
            <input
              type="text"
              value={depositAmt}
              onChange={e => setDepositAmt(e.target.value)}
              placeholder="5.00"
              style={{ background: "transparent", color: "#fff", border: "none", fontSize: 20, fontFamily: "monospace", width: "100%", outline: "none", fontWeight: "bold" }}
            />
          </InputBox>
          {error && <div style={{ fontSize: 11, color: "#ff4444", marginBottom: 8, textAlign: "center" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={handleDeposit}
              disabled={status === "depositing"}
              style={btnStyle(FUCHSIA, "#fff")}
              className="flex-1 py-2.5"
            >
              {status === "depositing" ? "SIGNING…" : "DEPOSIT"}
            </button>
            <button onClick={onClose} style={{ background: "transparent", border: "1px solid #333344", color: "#666677", borderRadius: 8, padding: "0 14px", cursor: "pointer", fontSize: 12 }}>ESC</button>
          </div>
        </>
      )}
    </>
  );
}

function PanelHeader({ title, color }: { title: string; color: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color, margin: 0 }}>{title}</h3>
      <div style={{ fontSize: 9, color: "#444455", marginTop: 4 }}>MagicBlock Private Ephemeral Rollup</div>
    </div>
  );
}

function ClusterToggle({ cluster, onChange, disabled }: {
  cluster: "mainnet" | "devnet";
  onChange: (c: "mainnet" | "devnet") => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 9, color: "#555566", fontFamily: '"Press Start 2P", monospace', flexShrink: 0 }}>NETWORK</span>
      <div style={{ display: "flex", gap: 0, background: "#0d0d22", border: "1px solid #1a1a3a", borderRadius: 6, overflow: "hidden", opacity: disabled ? 0.45 : 1 }}>
        {(["devnet", "mainnet"] as const).map(c => (
          <button
            key={c}
            onClick={() => !disabled && onChange(c)}
            style={{
              background: cluster === c ? "#c026d322" : "transparent",
              color: cluster === c ? "#c026d3" : "#444455",
              border: "none",
              borderRight: c === "devnet" ? "1px solid #1a1a3a" : "none",
              padding: "6px 12px",
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 8,
              cursor: disabled ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              fontWeight: cluster === c ? "bold" : "normal",
            }}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────

const TOKEN_LIST_SYMBOLS = ["SOL", "USDC", "USDT", "JUP", "BONK"];

function TokenBox({ label, token, onTokenChange, excludeToken, tokens, getLogo, children }: {
  label: string;
  token: string;
  onTokenChange: (t: string) => void;
  excludeToken: string;
  tokens: string[];
  getLogo: (s: string) => string;
  children: React.ReactNode;
}) {
  const logo = getLogo(token);
  return (
    <div style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: "11px", color: "#555566" }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {logo && <img src={logo} alt={token} style={{ width: 18, height: 18, borderRadius: "50%" }} />}
          <select value={token} onChange={(e) => onTokenChange(e.target.value)}
            style={{ background: "#1a1a3a", color: "#9945FF", border: "1px solid rgba(153,69,255,0.2)", borderRadius: 4, padding: "2px 6px", fontSize: "12px", cursor: "pointer", outline: "none" }}>
            {tokens.filter(t => t !== excludeToken).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      {children}
    </div>
  );
}

function InputBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ fontSize: "11px", color: "#555566", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function StepCard({ number, title, description, color, action }: {
  number: number; title: string; description: string; color: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", gap: 12, background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
      <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: `${color}22`, border: `1px solid ${color}44`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold" }}>
        {number}
      </div>
      <div>
        <div style={{ color: "#ccccdd", fontWeight: "bold", fontSize: "13px", marginBottom: 3 }}>{title}</div>
        <div style={{ color: "#777788", fontSize: "11px", lineHeight: 1.5 }}>{description}</div>
        {action}
      </div>
    </div>
  );
}

function btnStyle(bg: string, color = "#fff"): React.CSSProperties {
  return {
    background: bg,
    color,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: '"Press Start 2P", monospace',
    fontSize: "9px",
    display: "block",
    textAlign: "center",
  };
}
