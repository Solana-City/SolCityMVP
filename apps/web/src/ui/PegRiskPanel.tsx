"use client";

/**
 * Raffx's stand: Pegana's peg risk, live.
 *
 * Two steps and no paragraphs. Pick an asset from the watch list (filtered by
 * typing), and its current reading comes back as one word plus the gap between
 * what the asset is worth and what it trades for. When Pegana's own feed is
 * cold, the card says so instead of dressing an old number up as a quote.
 */
import { useEffect, useMemo, useState } from "react";
import type { PegAsset } from "@/app/api/peg-risk/route";

const TEAL = "#00c2a8";

/** Pegana's five states, plus UNKNOWN for a cold or broken anchor. */
const STATE_COLOR: Record<string, string> = {
  PEGGED: "#14f195",
  DRIFT: "#ffd166",
  DEPEG: "#ff8c42",
  CRITICAL: "#ff4d4d",
  BLACK_SWAN: "#ff2d55",
  UNKNOWN: "#6b7280",
};

const STATE_WORD: Record<string, string> = {
  PEGGED: "HOLDING",
  DRIFT: "DRIFTING",
  DEPEG: "OFF PEG",
  CRITICAL: "CRITICAL",
  BLACK_SWAN: "BLACK SWAN",
  UNKNOWN: "NO READING",
};

interface Reading {
  symbol: string;
  state: string;
  discount: number | null;
  intrinsicUsd: number | null;
  marketUsd: number | null;
  updatedAt: string | null;
  stale: boolean;
}

/**
 * Pegana watches 67 assets, most of them LSTs nobody in the city holds. The
 * ones a player recognises go first; everything else keeps the API order.
 */
const FIRST = ["USDC", "USDT", "PYUSD", "USDe", "jitoSOL", "mSOL", "bSOL", "JupSOL", "INF"];
const rank = (symbol: string): number => {
  const i = FIRST.findIndex((s) => s.toLowerCase() === symbol.toLowerCase());
  return i === -1 ? FIRST.length : i;
};

export default function PegRiskPanel({ onClose }: { onClose: () => void }) {
  const [assets, setAssets] = useState<PegAsset[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PegAsset | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/peg-risk")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.ok) setAssets(d.assets as PegAsset[]);
        else setListError("Pegana is not answering right now.");
      })
      .catch(() => alive && setListError("Pegana is not answering right now."));
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = assets ?? [];
    const matches = q
      ? list.filter((a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      : [...list].sort((a, b) => rank(a.symbol) - rank(b.symbol));
    return matches.slice(0, 18);
  }, [assets, query]);

  const pick = async (asset: PegAsset) => {
    setPicked(asset);
    setReading(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/peg-risk?asset=${encodeURIComponent(asset.symbol)}`);
      const d = await res.json();
      setReading(d.ok ? (d.state as Reading) : null);
    } catch {
      setReading(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: '"Press Start 2P", monospace' }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 9, color: TEAL, margin: 0 }}>PEG RISK</h3>
        <div style={{ fontSize: 7, color: "#555566", marginTop: 5 }}>Pegana, live on mainnet</div>
      </div>

      {picked ? (
        <ReadingCard
          asset={picked}
          reading={reading}
          loading={loading}
          onBack={() => { setPicked(null); setReading(null); }}
        />
      ) : (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search USDC, jitoSOL…"
            style={{
              width: "100%", background: "#12122a", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8, padding: "10px 12px", color: "#fff", fontSize: 9,
              fontFamily: "monospace", outline: "none", marginBottom: 10,
            }}
          />

          {listError && <Note>{listError}</Note>}
          {!assets && !listError && <Note>Reading the watch list…</Note>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, maxHeight: 260, overflowY: "auto" }}>
            {shown.map((a) => (
              <button
                key={a.symbol}
                onClick={() => pick(a)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, minWidth: 0,
                  background: "#12122a", border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 8, padding: "9px 10px", cursor: "pointer",
                  fontFamily: "inherit", textAlign: "left",
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: STATE_COLOR[a.state] ?? STATE_COLOR.UNKNOWN,
                }} />
                <span style={{ color: "#ccccdd", fontSize: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.symbol}
                </span>
              </button>
            ))}
          </div>

          {assets && shown.length === 0 && <Note>Pegana does not watch that one.</Note>}
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <a
          href="https://pegana.xyz/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, textAlign: "center", padding: "12px 0", borderRadius: 8,
            fontSize: 7, color: TEAL, background: "rgba(0,194,168,0.1)",
            border: "1px solid rgba(0,194,168,0.4)", textDecoration: "none",
          }}
        >
          PEGANA.XYZ
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

function ReadingCard({ asset, reading, loading, onBack }: {
  asset: PegAsset; reading: Reading | null; loading: boolean; onBack: () => void;
}) {
  const state = reading?.state ?? asset.state;
  const color = STATE_COLOR[state] ?? STATE_COLOR.UNKNOWN;
  const stale = reading?.stale ?? asset.stale;
  const discount = reading?.discount ?? asset.discount;
  const intrinsic = reading?.intrinsicUsd ?? asset.intrinsicUsd;
  const market = reading?.marketUsd ?? asset.marketUsd;

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: "none", border: "none", color: "#8888aa", cursor: "pointer",
          fontFamily: "inherit", fontSize: 7, padding: 0, marginBottom: 10,
        }}
      >
        ◂ BACK
      </button>

      <div style={{
        background: "#12122a", border: `1px solid ${color}55`, borderRadius: 10,
        padding: 14, textAlign: "center",
      }}>
        <div style={{ fontSize: 8, color: "#8888aa" }}>{asset.symbol}</div>
        <div style={{ fontSize: 14, color, margin: "10px 0 6px" }}>
          {loading ? "READING…" : (STATE_WORD[state] ?? state)}
        </div>
        <div style={{ fontSize: 7, color: "#666677" }}>
          {asset.class === "lst" ? `LST against ${asset.pegTarget || "SOL"}` : `Stablecoin against ${asset.pegTarget || "USD"}`}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
        <Stat label="GAP" value={bps(discount)} />
        <Stat label="RISK" value={asset.riskScore === null ? "n/a" : `${Math.round(asset.riskScore)}/100`} />
        <Stat label="WORTH" value={usd(intrinsic)} />
        <Stat label="TRADES AT" value={usd(market)} />
      </div>

      {stale && (
        <Note>
          The feed for this one is cold, so the reading is history, not a quote.
        </Note>
      )}
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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 7, color: "#777788", lineHeight: 1.7, marginTop: 10 }}>{children}</div>
  );
}

/** The gap in basis points. Under 10 bps it needs a decimal to say anything. */
function bps(discount: number | null): string {
  if (discount === null) return "n/a";
  const b = Math.abs(discount) * 10_000;
  return `${b < 10 ? b.toFixed(1) : Math.round(b)} bps`;
}

function usd(v: number | null): string {
  if (v === null) return "n/a";
  // Pinned locale: a pt-BR machine renders 5.000 for five thousand, which
  // reads as five here.
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 4 : 2 })}`;
}
