"use client";

import { useState } from "react";
import JokenpoMatch from "./JokenpoMatch";
import { STAKE_PRESETS_SOL } from "../../solana/rps/config";
import type { MiniGameComponentProps, JokenpoContext } from "../types";

/**
 * Solo (bot) matches let the player pick stake/best-of right here before
 * anything goes on-chain. PvP matches skip this screen — the host already
 * picked the stake when sending the challenge invite, and it travels in
 * `context` so both sides agree before either calls create/join_game.
 */
export default function JokenpoGame({ context, onResult, onClose }: MiniGameComponentProps<JokenpoContext>) {
  const isBot = context.opponent.kind === "bot";
  const [picked, setPicked] = useState<{ stakeSol: number; bestOf: 1 | 3 } | null>(
    isBot ? null : { stakeSol: context.stakeSol, bestOf: context.bestOf }
  );

  if (!picked) {
    return <StakeSetup onClose={onClose} onStart={setPicked} />;
  }

  return (
    <JokenpoMatch
      context={{ ...context, stakeSol: picked.stakeSol, bestOf: picked.bestOf }}
      onResult={onResult}
      onClose={onClose}
    />
  );
}

function StakeSetup({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (picked: { stakeSol: number; bestOf: 1 | 3 }) => void;
}) {
  const [stakeSol, setStakeSol] = useState<number>(STAKE_PRESETS_SOL[0]);
  const [bestOf, setBestOf] = useState<1 | 3>(1);

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
        .jokenpo-pill { transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease; }
        .jokenpo-pill:hover { transform: scale(1.04); }
      `}</style>
      <div
        style={{
          width: 320,
          background: "rgba(10,12,24,0.92)",
          border: "1px solid rgba(153,69,255,0.25)",
          borderRadius: 16,
          boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
          fontFamily: '"Fira Code", monospace',
          color: "#d0d0f0",
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: "#c084fc", textAlign: "center" }}>
          🪨📄✂️ JOKENPO MASTER
        </div>
        <div style={{ fontSize: 12, color: "#9090cc", textAlign: "center", lineHeight: 1.5 }}>
          Pick a wager — devnet SOL only. Your move stays private in a TEE until
          we've both chosen.
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#6060aa", marginBottom: 6 }}>Stake per player</div>
          <div style={{ display: "flex", gap: 8 }}>
            {STAKE_PRESETS_SOL.map((s) => (
              <button
                key={s}
                className="jokenpo-pill"
                onClick={() => setStakeSol(s)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: `1px solid ${stakeSol === s ? "rgba(20,241,149,0.5)" : "rgba(153,69,255,0.25)"}`,
                  background: stakeSol === s ? "rgba(20,241,149,0.12)" : "rgba(153,69,255,0.06)",
                  color: stakeSol === s ? "#14F195" : "#a0a0cc",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {s === 0 ? "Free" : `${s} SOL`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#6060aa", marginBottom: 6 }}>Match length</div>
          <div style={{ display: "flex", gap: 8 }}>
            {([1, 3] as const).map((b) => (
              <button
                key={b}
                className="jokenpo-pill"
                onClick={() => setBestOf(b)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: `1px solid ${bestOf === b ? "rgba(20,241,149,0.5)" : "rgba(153,69,255,0.25)"}`,
                  background: bestOf === b ? "rgba(20,241,149,0.12)" : "rgba(153,69,255,0.06)",
                  color: bestOf === b ? "#14F195" : "#a0a0cc",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Best of {b}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "9px 0",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "#555577",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onStart({ stakeSol, bestOf })}
            style={{
              flex: 2,
              padding: "9px 0",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, #9945FF, #c084fc)",
              color: "#0a0a14",
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            CHALLENGE
          </button>
        </div>
      </div>
    </div>
  );
}
