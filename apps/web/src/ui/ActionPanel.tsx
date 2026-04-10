"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { NPCAction } from "@/game/config/npcRegistry";

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

        {action.type === "tutor" && <TutorPanel onClose={onClose} />}
        {action.type === "swap" && <SwapPanel onClose={onClose} />}
        {action.type === "transfer" && <TransferPanel onClose={onClose} />}
        {action.type === "bounties" && <BountiesPanel onClose={onClose} />}
      </div>
    </div>
  );
}

function SwapPanel({ onClose }: { onClose: () => void }) {
  const { connected, publicKey, signTransaction } = useWallet();
  const [inputToken, setInputToken] = useState("SOL");
  const [outputToken, setOutputToken] = useState("USDC");
  const [amount, setAmount] = useState("0.1");
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "quoting" | "signing" | "executing" | "done" | "error">("idle");
  const [result, setResult] = useState<{ signature?: string; outAmount?: string; error?: string } | null>(null);

  // Lazy import to avoid SSR issues
  const jupRef = useRef<typeof import("@/game/solana/jupiterSwap") | null>(null);

  useEffect(() => {
    import("@/game/solana/jupiterSwap").then((mod) => { jupRef.current = mod; });
  }, []);

  const handleQuote = useCallback(async () => {
    const jup = jupRef.current;
    if (!jup || !publicKey || !amount) return;

    const input = jup.getTokenBySymbol(inputToken);
    const output = jup.getTokenBySymbol(outputToken);
    if (!input || !output) return;

    setLoading(true);
    setStatus("quoting");
    try {
      const smallestAmount = jup.toSmallestUnit(amount, input.decimals);
      const order = await jup.getSwapOrder(
        input.mint, output.mint, smallestAmount, publicKey.toBase58()
      );
      setQuote(order);
      setStatus("idle");
    } catch (err: any) {
      setResult({ error: err.message });
      setStatus("error");
    }
    setLoading(false);
  }, [publicKey, inputToken, outputToken, amount]);

  const handleSwap = useCallback(async () => {
    const jup = jupRef.current;
    if (!jup || !quote?.transaction || !signTransaction) return;

    setStatus("signing");
    try {
      const tx = jup.deserializeTransaction(quote.transaction);
      const signed = await signTransaction(tx as any);
      const serialized = Buffer.from(signed.serialize()).toString("base64");

      setStatus("executing");
      const execResult = await jup.executeSwap(serialized, quote.requestId);

      if (execResult.status === "Success") {
        const output = jup.getTokenByMint(quote.outputMint);
        const outHuman = output
          ? jup.fromSmallestUnit(execResult.outputAmountResult, output.decimals)
          : execResult.outputAmountResult;
        setResult({ signature: execResult.signature, outAmount: outHuman });
        setStatus("done");
      } else {
        setResult({ error: execResult.error || "Swap failed" });
        setStatus("error");
      }
    } catch (err: any) {
      setResult({ error: err.message });
      setStatus("error");
    }
  }, [quote, signTransaction]);

  const tokens = ["SOL", "USDC", "USDT", "JUP", "BONK", "WIF"];

  return (
    <>
      <h3 className="text-sm mb-4" style={{
        fontFamily: '"Press Start 2P", monospace', fontSize: "11px", color: "#FFD700",
      }}>
        TOKEN SWAP
      </h3>

      {status === "done" && result ? (
        <div className="text-center py-6">
          <div className="text-3xl mb-2" style={{ color: "#14F195" }}>OK</div>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: "10px", color: "#14F195" }}>
            SWAP COMPLETE
          </div>
          <div className="text-xs mt-2" style={{ color: "#888899" }}>
            Received: {result.outAmount} {outputToken}
          </div>
          {result.signature && (
            <a
              href={`https://solscan.io/tx/${result.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs mt-2 inline-block"
              style={{ color: "#00D1FF" }}
            >
              View on Solscan
            </a>
          )}
          <button onClick={onClose} className="w-full mt-4 py-2 rounded-lg cursor-pointer"
            style={{ background: "#14F195", color: "#000", border: "none", fontFamily: '"Press Start 2P", monospace', fontSize: "9px" }}>
            CLOSE
          </button>
        </div>
      ) : status === "error" && result ? (
        <div className="text-center py-6">
          <div className="text-xs mb-3" style={{ color: "#ff4444" }}>{result.error}</div>
          <button onClick={() => { setStatus("idle"); setResult(null); setQuote(null); }}
            className="px-4 py-2 rounded-lg cursor-pointer text-xs"
            style={{ background: "transparent", border: "1px solid #333344", color: "#888899" }}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* Input token */}
          <div className="rounded-lg p-3 mb-2" style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs" style={{ color: "#555566" }}>From</span>
              <select value={inputToken} onChange={(e) => { setInputToken(e.target.value); setQuote(null); }}
                className="text-xs rounded px-2 py-1 outline-none cursor-pointer"
                style={{ background: "#1a1a3a", color: "#9945FF", border: "1px solid rgba(153,69,255,0.2)" }}>
                {tokens.filter((t) => t !== outputToken).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <input type="text" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
              placeholder="0.0" className="w-full text-xl font-bold outline-none"
              style={{ background: "transparent", color: "#fff", border: "none", fontFamily: "monospace" }} />
          </div>

          {/* Output token */}
          <div className="rounded-lg p-3 mb-3" style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs" style={{ color: "#555566" }}>To</span>
              <select value={outputToken} onChange={(e) => { setOutputToken(e.target.value); setQuote(null); }}
                className="text-xs rounded px-2 py-1 outline-none cursor-pointer"
                style={{ background: "#1a1a3a", color: "#9945FF", border: "1px solid rgba(153,69,255,0.2)" }}>
                {tokens.filter((t) => t !== inputToken).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="text-xl font-bold" style={{ color: quote ? "#fff" : "#333344" }}>
              {quote ? (() => {
                const jup = jupRef.current;
                const out = jup?.getTokenBySymbol(outputToken);
                return out ? jup?.fromSmallestUnit(quote.outAmount, out.decimals) : quote.outAmount;
              })() : "..."}
            </div>
          </div>

          {/* Quote info */}
          {quote && (
            <div className="text-xs mb-3 flex justify-between" style={{ color: "#555566" }}>
              <span>via Jupiter {quote.gasless ? "· gasless" : ""}</span>
              <span>slippage: {quote.slippageBps ? `${(quote.slippageBps / 100).toFixed(1)}%` : "auto"}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {!quote ? (
              <button onClick={handleQuote} disabled={!connected || loading || !amount}
                className="flex-1 py-2.5 rounded-lg text-xs cursor-pointer"
                style={{
                  background: connected ? "#FFD700" : "#333344",
                  color: connected ? "#000" : "#666677",
                  border: "none", fontFamily: '"Press Start 2P", monospace', fontSize: "9px",
                }}>
                {!connected ? "CONNECT WALLET FIRST" : loading ? "GETTING QUOTE..." : "GET QUOTE"}
              </button>
            ) : (
              <button onClick={handleSwap} disabled={status === "signing" || status === "executing"}
                className="flex-1 py-2.5 rounded-lg text-xs cursor-pointer"
                style={{
                  background: "#14F195", color: "#000", border: "none",
                  fontFamily: '"Press Start 2P", monospace', fontSize: "9px",
                }}>
                {status === "signing" ? "SIGN IN WALLET..." : status === "executing" ? "EXECUTING..." : "CONFIRM SWAP"}
              </button>
            )}
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-xs cursor-pointer"
              style={{ background: "transparent", border: "1px solid #333344", color: "#666677" }}>
              ESC
            </button>
          </div>
        </>
      )}
    </>
  );
}

function TransferPanel({ onClose }: { onClose: () => void }) {
  const { connected } = useWallet();

  return (
    <>
      <h3
        className="text-sm mb-4"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "11px",
          color: "#00D1FF",
        }}
      >
        TRANSFER
      </h3>
      <div
        className="rounded-lg p-3 mb-2"
        style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="text-xs" style={{ color: "#555566" }}>Destination</div>
        <div className="text-sm mt-1" style={{ color: "#ffffff", fontFamily: "monospace" }}>
          8kNr...x9Dq
        </div>
      </div>
      <div
        className="rounded-lg p-3 mb-4"
        style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="text-xs" style={{ color: "#555566" }}>Amount</div>
        <div className="text-lg font-bold mt-1" style={{ color: "#ffffff" }}>
          0.5 SOL
        </div>
      </div>
      <div className="flex gap-2">
        <button
          disabled={!connected}
          className="flex-1 py-2.5 rounded-lg text-xs cursor-pointer"
          style={{
            background: connected ? "#00D1FF" : "#333344",
            color: connected ? "#000" : "#666677",
            border: "none",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "9px",
          }}
        >
          {connected ? "SEND" : "CONNECT WALLET FIRST"}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2.5 rounded-lg cursor-pointer"
          style={{ background: "transparent", border: "1px solid #333344", color: "#666677", fontSize: "12px" }}
        >
          ESC
        </button>
      </div>
    </>
  );
}

function BountiesPanel({ onClose }: { onClose: () => void }) {
  const bounties = [
    { title: "Create tutorial video", reward: "500 USDC", tag: "Content" },
    { title: "Build analytics dashboard", reward: "800 USDC", tag: "Dev" },
    { title: "Translate docs to PT-BR", reward: "200 USDC", tag: "Translation" },
  ];

  return (
    <>
      <h3
        className="text-sm mb-4"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "11px",
          color: "#9945FF",
        }}
      >
        BOUNTY BOARD
      </h3>
      {bounties.map((b, i) => (
        <div
          key={i}
          className="flex justify-between items-center rounded-lg p-3 mb-2"
          style={{
            background: "#12122a",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div>
            <div className="text-sm" style={{ color: "#ccccdd" }}>{b.title}</div>
            <span
              className="text-xs px-2 py-0.5 rounded mt-1 inline-block"
              style={{
                background: "rgba(153,69,255,0.12)",
                color: "#9945FF",
              }}
            >
              {b.tag}
            </span>
          </div>
          <div
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: "9px",
              color: "#14F195",
            }}
          >
            {b.reward}
          </div>
        </div>
      ))}
      <button
        onClick={onClose}
        className="w-full mt-2 py-2 rounded-lg cursor-pointer"
        style={{
          background: "transparent",
          border: "1px solid #333344",
          color: "#666677",
          fontSize: "12px",
        }}
      >
        Close [ESC]
      </button>
    </>
  );
}

function TutorPanel({ onClose }: { onClose: () => void }) {
  const { connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();

  return (
    <>
      <h3
        className="text-sm mb-4"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "11px",
          color: "#14F195",
        }}
      >
        GETTING STARTED
      </h3>

      <div className="space-y-3 mb-4">
        <StepCard
          number={1}
          title="Connect your wallet"
          description="Your wallet is your identity. It holds your tokens, items, and reputation. Phantom and Solflare are recommended."
          color="#9945FF"
          action={
            !connected ? (
              <button
                onClick={() => openWalletModal(true)}
                className="mt-2 px-3 py-1.5 rounded text-xs cursor-pointer"
                style={{
                  background: "rgba(153,69,255,0.8)",
                  color: "#fff",
                  border: "none",
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: "7px",
                }}
              >
                CONNECT NOW
              </button>
            ) : (
              <span className="text-xs mt-1 inline-block" style={{ color: "#14F195" }}>
                Connected
              </span>
            )
          }
        />
        <StepCard
          number={2}
          title="Swap tokens"
          description="Walk to Jupiter Joe (the gold NPC near the top) and press E. You can exchange any Solana token for another."
          color="#FFD700"
        />
        <StepCard
          number={3}
          title="Send tokens"
          description="Visit Postmaster Ana (the blue NPC) to transfer SOL or any token to another address."
          color="#00D1FF"
        />
        <StepCard
          number={4}
          title="Explore the city"
          description="Check the Superteam Hub for bounties and jobs. Walk around to discover new services. Every interaction earns you score and unlocks outfits!"
          color="#9945FF"
        />
      </div>

      <button
        onClick={onClose}
        className="w-full py-2.5 rounded-lg cursor-pointer"
        style={{
          background: "#14F195",
          color: "#000",
          border: "none",
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "9px",
        }}
      >
        START EXPLORING
      </button>
    </>
  );
}

function StepCard({
  number,
  title,
  description,
  color,
  action,
}: {
  number: number;
  title: string;
  description: string;
  color: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex gap-3 rounded-lg p-3"
      style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}
    >
      <div
        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
      >
        {number}
      </div>
      <div>
        <div className="text-sm font-bold mb-0.5" style={{ color: "#ccccdd" }}>{title}</div>
        <div className="text-xs" style={{ color: "#777788", lineHeight: 1.5 }}>{description}</div>
        {action}
      </div>
    </div>
  );
}
