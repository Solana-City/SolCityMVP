"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { NPCAction } from "@/game/config/npcRegistry";
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

        {action.type === "tutor"    && <TutorPanel    onClose={onClose} />}
        {action.type === "swap"     && <SwapPanel     onClose={onClose} />}
        {action.type === "transfer" && <TransferPanel onClose={onClose} />}
        {action.type === "bounties" && <BountiesPanel onClose={onClose} />}
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

// ── Bounties Panel ────────────────────────────────────────────────────

const BOUNTIES = [
  { id: "b1", title: "Create tutorial video for Solana beginners", reward: "500 USDC", tag: "Content",     url: "https://earn.superteam.fun" },
  { id: "b2", title: "Build open-source analytics dashboard",       reward: "800 USDC", tag: "Development", url: "https://earn.superteam.fun" },
  { id: "b3", title: "Translate Solana docs to Portuguese",          reward: "200 USDC", tag: "Translation", url: "https://earn.superteam.fun" },
  { id: "b4", title: "Design social media templates",                reward: "300 USDC", tag: "Design",      url: "https://earn.superteam.fun" },
  { id: "b5", title: "Write thread about Ephemeral Rollups",         reward: "150 USDC", tag: "Content",     url: "https://earn.superteam.fun" },
];

const TAG_COLORS: Record<string, string> = {
  Content: "#14F195", Development: "#00D1FF", Translation: "#FFD700", Design: "#F72585",
};

function BountiesPanel({ onClose }: { onClose: () => void }) {
  const [claimed, setClaimed] = useState<Set<string>>(new Set());

  const handleClaim = useCallback((id: string, title: string) => {
    if (claimed.has(id)) return;
    setClaimed((s) => new Set([...s, id]));
    profileManager.recordBounty({ title });
    emitGameEvent("game:bounty");
  }, [claimed]);

  return (
    <>
      <h3 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#9945FF", marginBottom: 4 }}>
        BOUNTY BOARD
      </h3>
      <p style={{ fontSize: "11px", color: "#555566", marginBottom: 12 }}>Powered by Superteam Earn</p>

      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {BOUNTIES.map((b) => {
          const done = claimed.has(b.id);
          return (
            <div key={b.id} style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <a href={b.url} target="_blank" rel="noopener noreferrer"
                    style={{ color: done ? "#555566" : "#ccccdd", fontSize: "12px", textDecoration: "none" }}>
                    {b.title}
                  </a>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: 4, background: `${TAG_COLORS[b.tag] ?? "#9945FF"}18`, color: TAG_COLORS[b.tag] ?? "#9945FF" }}>
                      {b.tag}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                  <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "9px", color: "#14F195", marginBottom: 6 }}>
                    {b.reward}
                  </div>
                  <button
                    onClick={() => handleClaim(b.id, b.title)}
                    disabled={done}
                    style={{
                      fontSize: "8px",
                      fontFamily: '"Press Start 2P", monospace',
                      padding: "4px 8px",
                      borderRadius: 4,
                      cursor: done ? "default" : "pointer",
                      background: done ? "rgba(20,241,149,0.1)" : "rgba(20,241,149,0.85)",
                      color: done ? "#14F195" : "#000",
                      border: done ? "1px solid rgba(20,241,149,0.3)" : "none",
                    }}
                  >
                    {done ? "CLAIMED ✓" : "CLAIM"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-3">
        <a href="https://earn.superteam.fun" target="_blank" rel="noopener noreferrer"
          style={{ flex: 1, background: "#9945FF", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", textAlign: "center", fontFamily: '"Press Start 2P", monospace', fontSize: "8px", textDecoration: "none", display: "block" }}>
          VIEW ALL ON SUPERTEAM
        </a>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #333344", color: "#666677", borderRadius: 8, padding: "0 16px", cursor: "pointer", fontSize: 12 }}>ESC</button>
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
