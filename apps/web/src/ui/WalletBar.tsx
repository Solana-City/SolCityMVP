"use client";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSeekerDevice } from "@/ui/useSeekerDevice";
import { progressionBus } from "@/game/progression/progressionBus";

function useIsTouch() {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isTouch;
}

interface WalletBarProps {
  onWalletChange?: (wallet: string | null) => void;
  /** "panel" = embedded in the unified HUD card (desktop only, vertical) */
  layout?: "default" | "panel";
}

export default function WalletBar({ onWalletChange, layout = "default" }: WalletBarProps) {
  const { publicKey, connected, disconnect } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [balance, setBalance] = useState<number | null>(null);
  const { isAndroid, hasSGT } = useSeekerDevice();
  const isTouch = useIsTouch();
  const cancelRef = useRef(false);

  const address = publicKey?.toBase58() ?? null;
  const shortAddr = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : null;

  useEffect(() => {
    onWalletChange?.(address);
  }, [address, onWalletChange]);

  const fetchBalance = useCallback(() => {
    if (!publicKey || !connection) return;
    cancelRef.current = false;
    connection.getBalance(publicKey).then((lamports) => {
      if (!cancelRef.current) {
        setBalance(Math.round((lamports / LAMPORTS_PER_SOL) * 100) / 100);
      }
    }).catch(() => {
      // Silently ignore RPC errors (429 rate limit, network blip) —
      // stale balance shown is better than crashing the ErrorBoundary.
    });
  }, [publicKey, connection]);

  useEffect(() => {
    if (!publicKey || !connection) {
      setBalance(null);
      return;
    }

    // Fetch immediately on connect / wallet change
    fetchBalance();

    // Re-fetch after every confirmed on-chain action (swap, transfer, bounty)
    const unsub = progressionBus.on("score-gained", fetchBalance);

    // Fallback poll every 30s to catch external balance changes
    const interval = setInterval(fetchBalance, 30_000);

    return () => {
      cancelRef.current = true;
      unsub();
      clearInterval(interval);
    };
  }, [publicKey, connection, fetchBalance]);

  const handleClick = useCallback(() => {
    if (connected) {
      disconnect();
    } else {
      setVisible(true);
    }
  }, [connected, disconnect, setVisible]);

  // ── Panel layout: single compact row for the unified HUD card ───────────────
  if (layout === "panel") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: '"Fira Code", monospace' }}>
        {/* Status dot */}
        <span style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: connected ? "#14F195" : "#444",
          boxShadow: connected ? "0 0 6px #14F19588" : "none",
        }} />

        {/* Wallet info — balance + short address stacked */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          {connected ? (
            <>
              {balance !== null && (
                <span style={{ fontSize: 11, color: "#e0e0ff", lineHeight: 1 }}>
                  {balance} <span style={{ color: "#14F195" }}>SOL</span>
                </span>
              )}
              {shortAddr && (
                <span style={{ fontSize: 9, color: "#00D1FF", letterSpacing: 0.3, opacity: 0.8 }}>
                  {shortAddr}
                  {isAndroid && hasSGT && <span style={{ color: "#FFD700", marginLeft: 4 }}>⬡</span>}
                </span>
              )}
            </>
          ) : (
            <span style={{ fontSize: 9, color: "#555", letterSpacing: 1,
              fontFamily: '"Press Start 2P", monospace' }}>OFFLINE</span>
          )}
        </div>

        {/* Action button */}
        <button
          onClick={handleClick}
          style={{
            background: connected ? "rgba(20,241,149,0.1)" : "rgba(153,69,255,0.8)",
            color: connected ? "#14F195" : "#fff",
            border: connected ? "1px solid rgba(20,241,149,0.3)" : "1px solid rgba(153,69,255,0.5)",
            borderRadius: 6,
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 7,
            padding: "6px 9px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {connected ? "●" : "CONNECT"}
        </button>
      </div>
    );
  }

  // ── Mobile layout: compact row (status dot + address + button) ───────────────
  if (isTouch) {
    return (
      <div className="flex items-center gap-2" style={{ fontFamily: '"Fira Code", monospace' }}>
        {/* Seeker badge — only when SGT is confirmed to keep it meaningful */}
        {hasSGT && (
          <span
            className="text-[8px] px-1.5 py-1 rounded"
            style={{
              background: "rgba(255,215,0,0.15)",
              color: "#FFD700",
              border: "1px solid rgba(255,215,0,0.4)",
              fontFamily: '"Press Start 2P", monospace',
            }}
            title="Seeker Genesis Token holder"
          >
            ⬡
          </span>
        )}
        {/* Status dot + short address (or balance) in one pill */}
        {connected && shortAddr && (
          <span
            className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded"
            style={{
              background: "rgba(10,10,30,0.88)",
              color: "#00D1FF",
              border: "1px solid rgba(0,209,255,0.2)",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block", background: "#14F195", flexShrink: 0 }} />
            {balance !== null ? `${balance} ◎` : shortAddr}
          </span>
        )}
        {connected ? (
          <button
            onClick={handleClick}
            className="rounded cursor-pointer"
            style={{
              background: "rgba(20,241,149,0.12)",
              color: "#14F195",
              border: "1px solid rgba(20,241,149,0.3)",
              fontFamily: '"Press Start 2P", monospace',
              fontSize: "8px",
              padding: "10px 12px",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            ●
          </button>
        ) : (
          /* Pixel-art CONNECT button (90x30 source at 1.5x) */
          <button
            onClick={handleClick}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
              lineHeight: 0,
            }}
          >
            <img
              src="/assets/ui/btn_connect.png"
              width={135} height={45} alt="Connect wallet" draggable={false}
              style={{ imageRendering: "pixelated" }}
            />
          </button>
        )}
      </div>
    );
  }

  // ── Desktop layout: full row ──────────────────────────────────────────────
  return (
    <div
      className="flex items-center gap-3 flex-wrap justify-end"
      style={{ fontFamily: '"Fira Code", monospace' }}
    >
      {/* Seeker device badge — shown on Android Chrome, gold if SGT confirmed */}
      {isAndroid && (
        <span
          className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded"
          style={{
            background: hasSGT ? "rgba(255,215,0,0.15)" : "rgba(153,69,255,0.12)",
            color: hasSGT ? "#FFD700" : "#9945FF",
            border: `1px solid ${hasSGT ? "rgba(255,215,0,0.4)" : "rgba(153,69,255,0.3)"}`,
            fontFamily: '"Press Start 2P", monospace',
          }}
          title={hasSGT ? "Seeker Genesis Token holder" : "Android / Seeker device detected"}
        >
          {hasSGT ? "⬡ SEEKER" : "📱 MOBILE"}
        </span>
      )}
      <span
        className="inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded"
        style={{
          background: "rgba(10,10,30,0.88)",
          color: connected ? "#14F195" : "#8a8aa7",
          border: "1px solid rgba(153,69,255,0.18)",
        }}
        title={connected ? "Wallet online" : "Wallet offline"}
      >
        <span style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          display: "inline-block",
          background: connected ? "#14F195" : "#555566",
        }} />
        {connected ? "ON-CHAIN" : "OFFLINE"}
      </span>
      {connected && shortAddr && (
        <>
          {balance !== null && (
            <span
              className="text-xs px-2 py-1 rounded"
              style={{
                background: "rgba(10,10,30,0.88)",
                color: "#14F195",
                border: "1px solid rgba(20,241,149,0.2)",
              }}
            >
              {balance} SOL
            </span>
          )}
          <span
            className="text-xs px-2 py-1 rounded"
            style={{
              background: "rgba(10,10,30,0.88)",
              color: "#00D1FF",
              border: "1px solid rgba(0,209,255,0.2)",
            }}
          >
            {shortAddr}
          </span>
        </>
      )}
      <button
        onClick={handleClick}
        className="rounded cursor-pointer transition-colors"
        style={{
          background: connected ? "rgba(20,241,149,0.12)" : "rgba(153,69,255,0.8)",
          color: connected ? "#14F195" : "#ffffff",
          border: connected ? "1px solid rgba(20,241,149,0.3)" : "1px solid rgba(153,69,255,0.5)",
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "9px",
          padding: "6px 16px",
          minHeight: 44,
          display: "flex",
          alignItems: "center",
        }}
      >
        {connected ? "CONNECTED" : "CONNECT WALLET"}
      </button>
    </div>
  );
}
