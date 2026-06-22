"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Connection, Transaction } from "@solana/web3.js";
import { SessionKeyManager } from "../../solana/sessionKeys";
import { useJokenpoMachine } from "./useJokenpoMachine";
import ChoicePicker from "./ChoicePicker";
import OnchainLog from "./OnchainLog";
import type { MiniGameResult, JokenpoContext } from "../types";

const EMOJI: Record<string, string> = { rock: "🪨", paper: "📄", scissors: "✂️" };

interface Props {
  context: JokenpoContext;
  onResult: (result: MiniGameResult) => Promise<void>;
  onClose: () => void;
}

/** The actual match UI, once stake/best-of are settled (picked or pre-agreed via invite). */
export default function JokenpoMatch({ context, onResult, onClose }: Props) {
  const { opponent, stakeSol, bestOf } = context;
  const { publicKey, sendTransaction } = useWallet();
  const sessionManagerRef = useRef<SessionKeyManager | null>(null);
  if (!sessionManagerRef.current) sessionManagerRef.current = new SessionKeyManager();
  const sessionKeypair = sessionManagerRef.current.getSessionKey();

  const m = useJokenpoMachine({
    opponent,
    stakeSol,
    bestOf,
    walletPublicKey: publicKey,
    sendTransaction: sendTransaction
      ? (tx: Transaction, connection: Connection) => sendTransaction(tx, connection)
      : null,
    sessionKeypair,
  });

  // Auto-settle once the match is decided, then report the result up.
  const settledReportedRef = useRef(false);
  useEffect(() => {
    if (m.phase === "done" && !m.settled) {
      m.settle().catch(() => undefined);
    }
  }, [m.phase, m.settled, m.settle]);

  useEffect(() => {
    if (m.settled && !settledReportedRef.current) {
      settledReportedRef.current = true;
      const iWon = m.myWins >= m.targetWins;
      onResult({ success: iWon, metadata: { stakeSol, opponent: opponent.kind, myWins: m.myWins, theirWins: m.theirWins } }).catch(
        () => undefined
      );
    }
  }, [m.settled, m.myWins, m.theirWins, m.targetWins, onResult, stakeSol, opponent.kind]);

  const opponentLabel = opponent.kind === "bot" ? "JoKenPo Master" : "Challenger";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(6,10,20,0.82)",
        backdropFilter: "blur(6px)",
      }}
    >
      <style>{`
        .jokenpo-choice-btn:hover:not(:disabled) { background: rgba(153,69,255,0.18) !important; border-color: rgba(153,69,255,0.5) !important; transform: scale(1.05); }
        .jokenpo-choice-btn:active:not(:disabled) { transform: scale(0.96); }
        .jokenpo-log-collapse:hover { color: #9945FF !important; }
        @keyframes jokenpoFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div
        style={{
          width: 340,
          background: "rgba(10,12,24,0.92)",
          border: "1px solid rgba(153,69,255,0.25)",
          borderRadius: 16,
          boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
          fontFamily: '"Fira Code", monospace',
          color: "#d0d0f0",
          overflow: "hidden",
          animation: "jokenpoFade 0.18s ease",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid rgba(153,69,255,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: "#c084fc" }}>
            🪨📄✂️ JOKENPO
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#9090cc" }}>vs {opponentLabel}</span>
            <span style={{ color: "#14F195" }}>
              {m.myWins} : {m.theirWins} {stakeSol > 0 ? `· ${stakeSol * 2} SOL pot` : "· free"}
            </span>
          </div>

          {m.error && (
            <div style={{ color: "#ff6b6b", fontSize: 12, textAlign: "center" }}>{m.error}</div>
          )}

          {m.phase === "loading" && <Status text="Loading..." />}
          {m.phase === "needs-funds" && (
            <Status text={`Approve the wallet popup to fund ~${m.fundNeededSol.toFixed(3)} SOL for this match`} />
          )}
          {m.phase === "setting-up" && <Status text="Setting up the match on-chain..." />}

          {(m.phase === "pick" || m.phase === "submitting") && (
            <>
              <div style={{ textAlign: "center", fontSize: 12, color: "#6060aa" }}>
                {m.opponentLocked ? `${opponentLabel} has chosen` : `Waiting on ${opponentLabel}...`}
              </div>
              <ChoicePicker disabled={m.phase === "submitting"} onPick={m.pick} />
            </>
          )}

          {m.phase === "waiting" && <Status text="Both choices locked — revealing soon..." />}

          {m.phase === "revealing" && m.result && (
            <div style={{ textAlign: "center", animation: "jokenpoFade 0.2s ease" }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 10 }}>
                <span style={{ fontSize: 40 }}>{EMOJI[m.result.me]}</span>
                <span style={{ fontSize: 18, color: "#444", alignSelf: "center" }}>vs</span>
                <span style={{ fontSize: 40 }}>{EMOJI[m.result.them]}</span>
              </div>
              <div
                style={{
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: 13,
                  color:
                    m.result.outcome === "win" ? "#14F195" : m.result.outcome === "lose" ? "#ff6b6b" : "#FFD700",
                }}
              >
                {m.result.outcome === "win" ? "YOU WIN ROUND" : m.result.outcome === "lose" ? "YOU LOSE ROUND" : "TIE"}
              </div>
            </div>
          )}

          {m.phase === "round-over" && <Status text={`Round ${m.round} — next round starting...`} />}
          {m.phase === "settling" && <Status text="Settling the pot..." />}

          {m.phase === "done" && (
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: 14,
                  marginBottom: 10,
                  color: m.myWins >= m.targetWins ? "#14F195" : "#ff6b6b",
                }}
              >
                {m.myWins >= m.targetWins ? "MATCH WON 🏆" : "MATCH LOST"}
              </div>
              {!m.settled ? (
                <Status text="Finalizing on-chain..." />
              ) : (
                <button
                  onClick={onClose}
                  style={{
                    background: "rgba(153,69,255,0.15)",
                    border: "1px solid rgba(153,69,255,0.35)",
                    borderRadius: 8,
                    padding: "8px 20px",
                    color: "#c084fc",
                    fontFamily: '"Press Start 2P", monospace',
                    fontSize: 10,
                    cursor: "pointer",
                  }}
                >
                  CLOSE
                </button>
              )}
            </div>
          )}

          {m.phase === "error" && (
            <button
              onClick={onClose}
              style={{
                background: "rgba(255,107,107,0.1)",
                border: "1px solid rgba(255,107,107,0.3)",
                borderRadius: 8,
                padding: "8px 20px",
                color: "#ff6b6b",
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 10,
                cursor: "pointer",
                alignSelf: "center",
              }}
            >
              CLOSE
            </button>
          )}

          <OnchainLog log={m.log} />
        </div>
      </div>
    </div>
  );
}

function Status({ text }: { text: string }) {
  return <div style={{ textAlign: "center", fontSize: 12, color: "#7070aa", padding: "8px 0" }}>{text}</div>;
}
