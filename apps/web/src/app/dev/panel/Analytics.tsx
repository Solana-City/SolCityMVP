"use client";

/**
 * Developer panel — analytics tab.
 *
 * Every number here is derived from accounts that already exist on-chain, so
 * nothing had to be instrumented in the game and there is no separate
 * tracking database to keep honest. What that buys is also its limit: the
 * chain knows about wallets, actions and scores, not about visits or
 * mini-game rounds, which stay in the player's browser.
 */
import { useCallback, useEffect, useState } from "react";

interface Series { day: string; count: number }

interface Data {
  ok: boolean;
  generatedAt: number;
  players: {
    total: number; online: number; played: number;
    activeDay: number; activeWeek: number;
    newDay: number; newWeek: number; returningPct: number | null;
  };
  signups: Series[];
  activity: Series[];
  actions: { swaps: number; transfers: number; bounties: number; convertedPct: number; score: number };
  top: { wallet: string; name: string; score: number; actions: number }[];
  mechs: { duelists: number; ladderEntries: number; rankedMatches: number; rooms: number };
  nicknames: number;
  errors: string[];
}

export default function Analytics({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/analytics${force ? "?force=1" : ""}`, {
        headers: { "x-admin-key": adminKey },
      });
      if (!res.ok) throw new Error(res.status === 401 ? "Wrong admin key." : `HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [adminKey]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p style={sx.error}>{error}</p>;
  if (!data) return <p style={sx.dim}>Reading the chain...</p>;

  const p = data.players;
  const a = data.actions;

  return (
    <>
      <div style={sx.toolbar}>
        <span style={sx.dim}>
          Snapshot from {new Date(data.generatedAt).toLocaleTimeString()}, cached for a minute.
        </span>
        <button style={sx.ghost} disabled={busy} onClick={() => void load(true)}>
          {busy ? "READING..." : "RECOMPUTE"}
        </button>
      </div>

      {data.errors.length > 0 && (
        <p style={sx.warn}>{data.errors.join(" · ")}</p>
      )}

      <section style={sx.grid}>
        <Stat label="Wallets ever" value={p.total} hint="Player accounts created on-chain" />
        <Stat label="Actually played" value={p.played} hint="Moved, scored or acted at least once" />
        <Stat label="Online now" value={p.online} hint="Delegated to the rollup" />
        <Stat label="Active 24h" value={p.activeDay} />
        <Stat label="Active 7d" value={p.activeWeek} />
        <Stat label="New 24h" value={p.newDay} />
        <Stat label="New 7d" value={p.newWeek} />
        <Stat
          label="Came back"
          value={p.returningPct === null ? "-" : `${p.returningPct}%`}
          hint="Of wallets older than a week, active in the last week"
        />
      </section>

      <Panel title="New wallets per day (30d)">
        <Bars series={data.signups} color="#14F195" />
      </Panel>

      <Panel title="Last seen per day (30d)">
        <Bars series={data.activity} color="#6ea8ff" />
        <p style={sx.dim}>
          One bar per player, on the day they were last active. The right-hand
          edge is today, so a healthy game keeps its mass on the right.
        </p>
      </Panel>

      <Panel title="On-chain actions">
        <section style={sx.grid}>
          <Stat label="Swaps" value={a.swaps} />
          <Stat label="Transfers" value={a.transfers} />
          <Stat label="Bounties" value={a.bounties} />
          <Stat label="Did something" value={`${a.convertedPct}%`} hint="Players with at least one action" />
          <Stat label="Total score" value={a.score} />
          <Stat label="Nicknames claimed" value={data.nicknames} />
        </section>
      </Panel>

      <Panel title="Sol Mechs">
        <section style={sx.grid}>
          <Stat label="Duelists" value={data.mechs.duelists} hint="Accounts delegated to the rollup" />
          <Stat label="Ladder entries" value={data.mechs.ladderEntries} />
          <Stat label="Ranked matches" value={data.mechs.rankedMatches} />
          <Stat label="Match rooms" value={data.mechs.rooms} />
        </section>
      </Panel>

      <Panel title="Top players">
        {data.top.length === 0 ? (
          <p style={sx.dim}>No scores yet.</p>
        ) : (
          <table style={sx.table}>
            <thead>
              <tr>
                <th style={sx.th}>#</th>
                <th style={sx.th}>Player</th>
                <th style={sx.th}>Wallet</th>
                <th style={sx.thNum}>Score</th>
                <th style={sx.thNum}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((row, i) => (
                <tr key={row.wallet}>
                  <td style={sx.td}>{i + 1}</td>
                  <td style={sx.td}>{row.name}</td>
                  <td style={{ ...sx.td, fontFamily: "monospace", fontSize: 12 }}>
                    {row.wallet.slice(0, 4)}...{row.wallet.slice(-4)}
                  </td>
                  <td style={sx.tdNum}>{row.score}</td>
                  <td style={sx.tdNum}>{row.actions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <p style={sx.dim}>
        Not measurable from the chain: page visits, mini-game rounds, tutorial
        completion and quest progress. Those live in the player&apos;s browser. If
        any of them matter, they need a small event endpoint before they can be
        counted.
      </p>
    </>
  );
}

/** A day-by-day bar chart. Plain divs: 30 bars need no chart library. */
function Bars({ series, color }: { series: Series[]; color: string }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  return (
    <div style={sx.bars}>
      {series.map((s) => (
        <div key={s.day} style={sx.barCol} title={`${s.day}: ${s.count}`}>
          <div style={{ ...sx.bar, height: `${(s.count / max) * 100}%`, background: color, opacity: s.count ? 1 : 0.18 }} />
          <span style={sx.barLabel}>{s.day.slice(8)}</span>
        </div>
      ))}
      <span style={sx.barMax}>max {max}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={sx.panel}>
      <h2 style={sx.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div style={sx.stat}>
      <div style={sx.statValue}>{value}</div>
      <div style={{ ...sx.dim, color: "#aab3d4" }}>{label}</div>
      {hint && <div style={{ ...sx.dim, fontSize: 11, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  toolbar: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 },
  dim: { color: "#7d86a8", fontSize: 13 },
  error: { color: "#ff9aa6", fontSize: 13 },
  warn: { background: "#2a1d10", border: "1px solid #6b4a1f", color: "#ffcb8a", padding: 10, borderRadius: 8, fontSize: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 },
  stat: { background: "#0d1020", border: "1px solid #232a44", borderRadius: 10, padding: 14 },
  statValue: { fontSize: 24, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" },
  panel: { background: "#0d1020", border: "1px solid #232a44", borderRadius: 12, padding: 16, marginBottom: 16 },
  h2: { fontSize: 13, margin: "0 0 12px", color: "#9fb0ff", letterSpacing: 1, textTransform: "uppercase" },
  bars: { position: "relative", display: "flex", alignItems: "flex-end", gap: 3, height: 130, paddingBottom: 16 },
  barCol: { flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", position: "relative" },
  bar: { width: "100%", borderRadius: "3px 3px 0 0", minHeight: 2 },
  barLabel: { position: "absolute", bottom: -15, left: 0, right: 0, textAlign: "center", fontSize: 9, color: "#5b6485" },
  barMax: { position: "absolute", top: 0, right: 0, fontSize: 11, color: "#5b6485" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "6px 8px", color: "#7d86a8", fontWeight: 500, fontSize: 12, borderBottom: "1px solid #232a44" },
  thNum: { textAlign: "right", padding: "6px 8px", color: "#7d86a8", fontWeight: 500, fontSize: 12, borderBottom: "1px solid #232a44" },
  td: { padding: "7px 8px", borderBottom: "1px solid #161c30" },
  tdNum: { padding: "7px 8px", borderBottom: "1px solid #161c30", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  ghost: { padding: "8px 12px", borderRadius: 8, border: "1px solid #2b3358", background: "transparent", color: "#aab3d4", cursor: "pointer", fontSize: 13 },
};
