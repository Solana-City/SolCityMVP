"use client";

/**
 * Vitin's stand: Cloak, private transfers on Solana.
 *
 * The tutorial gate in front of this panel (CLOAK_INTRO in ActionPanel) draws
 * the three steps; this is the working side of it. The numbers are Cloak's
 * own, so a player can see what a private send would actually cost before
 * they go and make one, and the signing step hands off to Cloak itself for
 * the reason the panel states plainly: their SDK signs against mainnet, and
 * the city runs on devnet.
 */
import { useState } from "react";
import { CLOAK_APP, CLOAK_DOCS, CLOAK_FEES, CLOAK_LIVE, withdrawFee } from "@/lib/cloak/privateSend";

const VIOLET = "#8b7cf6";
const LAMPORTS = 1_000_000_000;

const FLOW = [
  { step: "SHIELD", line: "Move SOL into a private balance only you can spend." },
  { step: "SEND", line: "Pay any address. The chain never sees your wallet as the sender." },
  { step: "UNSHIELD", line: "Take it back out to a normal wallet whenever you want." },
];

export default function CloakPanel({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState("0.1");

  const sol = parseFloat(amount);
  const lamports = Number.isFinite(sol) ? Math.round(sol * LAMPORTS) : 0;
  const tooSmall = lamports > 0 && lamports < CLOAK_FEES.minShieldLamports;
  const fee = lamports > 0 ? withdrawFee(lamports) : 0;

  return (
    <div style={{ fontFamily: '"Press Start 2P", monospace' }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 9, color: VIOLET, margin: 0 }}>PRIVATE TRANSFERS</h3>
        <div style={{ fontSize: 7, color: "#555566", marginTop: 5 }}>Cloak, live on mainnet</div>
      </div>

      {/* The flow, as three cards rather than a paragraph. */}
      {FLOW.map((f, i) => (
        <div
          key={f.step}
          style={{
            display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 6,
            background: "#12122a", border: "1px solid rgba(255,255,255,0.04)",
            borderRadius: 8, padding: "10px 11px",
          }}
        >
          <span style={{
            width: 20, height: 20, flexShrink: 0, borderRadius: "50%",
            background: `${VIOLET}22`, border: `1px solid ${VIOLET}66`, color: VIOLET,
            fontSize: 7, display: "flex", alignItems: "center", justifyContent: "center",
          }}>{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 8, color: "#ccccdd", marginBottom: 5 }}>{f.step}</div>
            <div style={{ fontSize: 7, color: "#777788", lineHeight: 1.7 }}>{f.line}</div>
          </div>
        </div>
      ))}

      {/* What it would cost, with Cloak's published numbers. */}
      <div style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12, marginTop: 10 }}>
        <div style={{ fontSize: 8, color: "#555566", marginBottom: 6 }}>Amount to shield (SOL)</div>
        <input
          type="number"
          value={amount}
          min={0}
          step={0.01}
          onChange={(e) => setAmount(e.target.value)}
          style={{
            background: "transparent", color: "#fff", border: "none", fontSize: 11,
            fontFamily: "monospace", width: "100%", outline: "none",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
        <Stat label="MINIMUM" value={`${(CLOAK_FEES.minShieldLamports / LAMPORTS).toFixed(2)} SOL`} />
        <Stat label="TAKING IT OUT" value={fee ? `${(fee / LAMPORTS).toFixed(4)} SOL` : "n/a"} />
      </div>
      <div style={{ fontSize: 7, color: "#777788", lineHeight: 1.7, marginTop: 8 }}>
        {tooSmall
          ? `Under the minimum. Cloak shields ${(CLOAK_FEES.minShieldLamports / LAMPORTS).toFixed(2)} SOL and up.`
          : "Shielding and private sends are free. Only taking funds back out pays a fee: 0.005 SOL plus 0.3%."}
      </div>

      {/* Why the signing happens over there and not here. */}
      <div style={{
        background: "rgba(139,124,246,0.08)", border: `1px solid ${VIOLET}44`,
        borderRadius: 8, padding: "10px 11px", marginTop: 10,
      }}>
        <div style={{ fontSize: 7, color: "#ccccdd", lineHeight: 1.8 }}>
          {CLOAK_LIVE
            ? "Sign a private send right here."
            : "Cloak's proofs are signed against mainnet, and Solana City runs on devnet, so the last step happens on Cloak itself. Everything above is their live model, not a mock."}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <a
          href={CLOAK_APP}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, textAlign: "center", padding: "12px 0", borderRadius: 8,
            fontSize: 7, color: "#fff", background: VIOLET,
            border: "none", textDecoration: "none",
          }}
        >
          OPEN CLOAK
        </a>
        <a
          href={CLOAK_DOCS}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, textAlign: "center", padding: "12px 0", borderRadius: 8,
            fontSize: 7, color: VIOLET, background: "rgba(139,124,246,0.1)",
            border: `1px solid ${VIOLET}66`, textDecoration: "none",
          }}
        >
          HOW IT WORKS
        </a>
      </div>
      <button
        onClick={onClose}
        style={{
          width: "100%", marginTop: 8, padding: "11px 0", borderRadius: 8, fontFamily: "inherit",
          fontSize: 7, color: "#8888aa", background: "#12122a",
          border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer",
        }}
      >
        CLOSE
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: "10px 11px" }}>
      <div style={{ fontSize: 6, color: "#555566", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 9, color: "#ccccdd", fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}
