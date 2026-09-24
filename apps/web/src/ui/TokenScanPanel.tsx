"use client";

/**
 * Crash's stand: SolSentry's token risk read.
 *
 * Paste a mint, get a verdict. No wallet, no signature, no signup: the free
 * SolSentry endpoint answers on the address alone, and the panel shows what it
 * found plus the one thing their own summary insists on, which is that no
 * signal is not the same as safe.
 */
import { useState } from "react";
import type { TokenScan } from "@/app/api/token-scan/route";

const RED = "#ff5c5c";

const LEVEL_COLOR: Record<string, string> = {
  CRITICAL: "#ff2d55",
  HIGH: "#ff4d4d",
  MEDIUM: "#ffd166",
  LOW: "#14f195",
  UNKNOWN: "#6b7280",
};

export default function TokenScanPanel({ onClose }: { onClose: () => void }) {
  const [mint, setMint] = useState("");
  const [scan, setScan] = useState<TokenScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const address = mint.trim();
    if (!address) return;
    setLoading(true);
    setError(null);
    setScan(null);
    try {
      const res = await fetch(`/api/token-scan?mint=${encodeURIComponent(address)}`);
      const d = await res.json();
      if (d.ok) setScan(d.scan as TokenScan);
      // The route sends a sentence when the address itself is the problem;
      // anything else is upstream noise the player cannot act on.
      else setError(res.status < 500 ? String(d.error) : "SolSentry is not answering right now.");
    } catch {
      setError("SolSentry is not answering right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: '"Press Start 2P", monospace' }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 9, color: RED, margin: 0 }}>TOKEN SCAN</h3>
        <div style={{ fontSize: 7, color: "#555566", marginTop: 5 }}>SolSentry, free read</div>
      </div>

      <div style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 8, color: "#555566", marginBottom: 6 }}>Mint address</div>
        <input
          type="text"
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="Paste the token address…"
          style={{
            background: "transparent", color: "#fff", border: "none", fontSize: 9,
            fontFamily: "monospace", width: "100%", outline: "none",
          }}
        />
      </div>

      <button
        onClick={run}
        disabled={loading || !mint.trim()}
        style={{
          width: "100%", padding: "13px 0", borderRadius: 8, fontFamily: "inherit",
          fontSize: 8, color: mint.trim() ? "#fff" : "#666677",
          background: mint.trim() ? RED : "#12122a",
          border: "none", cursor: mint.trim() && !loading ? "pointer" : "default",
        }}
      >
        {loading ? "SCANNING…" : "SCAN"}
      </button>

      {error && <div style={{ fontSize: 7, color: "#ff8c42", lineHeight: 1.7, marginTop: 10 }}>{error}</div>}

      {scan && <Verdict scan={scan} />}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <a
          href="https://solsentry.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, textAlign: "center", padding: "12px 0", borderRadius: 8,
            fontSize: 7, color: RED, background: "rgba(255,92,92,0.1)",
            border: "1px solid rgba(255,92,92,0.4)", textDecoration: "none",
          }}
        >
          SOLSENTRY.APP
        </a>
        <button
          onClick={onClose}
          style={{
            flex: 1, padding: "12px 0", borderRadius: 8, fontFamily: "inherit",
            fontSize: 7, color: "#8888aa", background: "#12122a",
            border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer",
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

function Verdict({ scan }: { scan: TokenScan }) {
  const color = LEVEL_COLOR[scan.riskLevel] ?? LEVEL_COLOR.UNKNOWN;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        background: "#12122a", border: `1px solid ${color}55`, borderRadius: 10,
        padding: 14, textAlign: "center",
      }}>
        <div style={{ fontSize: 8, color: "#8888aa" }}>{scan.symbol ?? "UNLISTED"}</div>
        <div style={{ fontSize: 14, color, margin: "10px 0 8px" }}>{scan.riskLevel} RISK</div>
        {scan.riskScore !== null && (
          <>
            <div style={{ height: 6, background: "#0a0a1e", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Math.max(0, scan.riskScore))}%`, height: "100%", background: color }} />
            </div>
            <div style={{ fontSize: 7, color: "#666677", marginTop: 6 }}>{Math.round(scan.riskScore)} / 100</div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
        <Stat label="OPERATOR RUGS" value={scan.operator.confirmedRugs === null ? "n/a" : String(scan.operator.confirmedRugs)} />
        <Stat label="TOP 10 HOLD" value={scan.holders.top10Pct === null ? "n/a" : `${scan.holders.top10Pct.toFixed(1)}%`} />
      </div>

      {scan.factors.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {scan.factors.map((f) => (
            <div
              key={`${f.severity}-${f.detail}`}
              style={{
                display: "flex", alignItems: "center", gap: 8, marginTop: 6,
                background: "#12122a", border: "1px solid rgba(255,255,255,0.04)",
                borderRadius: 8, padding: "9px 10px",
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: LEVEL_COLOR[f.severity] ?? LEVEL_COLOR.UNKNOWN,
              }} />
              <span style={{ fontSize: 7, color: "#ccccdd", lineHeight: 1.6 }}>{f.detail}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 7, color: "#777788", lineHeight: 1.7, marginTop: 10 }}>
        No signal is not proof of safety.
      </div>
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
