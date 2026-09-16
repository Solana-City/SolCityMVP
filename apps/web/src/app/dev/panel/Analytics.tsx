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

interface KindSummary {
  id: string;
  count: number;
  users: number;
  last7: number;
  ok: number;
  steps: number[];
  top: { wallet: string; count: number }[];
  best: { wallet: string; score: number }[];
}

interface FeedItem {
  kind: string; id: string; wallet: string; value: number;
  success: boolean | null; label: string; at: number;
}

interface Events {
  enabled: boolean;
  protocols: KindSummary[];
  opens: KindSummary[];
  minigames: KindSummary[];
  tutorials: KindSummary[];
  quests: KindSummary[];
  hunt: KindSummary | null;
  duels: KindSummary[];
  feed: FeedItem[];
}

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
  events: Events | null;
  errors: string[];
}

export default function Analytics({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Wallet -> nickname, so the tables read as people rather than addresses. */
  const [names, setNames] = useState<Record<string, string>>({});

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

  // Resolve every wallet the tables mention in one request.
  useEffect(() => {
    if (!data) return;
    const wallets = new Set<string>();
    for (const row of data.top) wallets.add(row.wallet);
    const ev = data.events;
    if (ev) {
      const groups = [...ev.protocols, ...ev.opens, ...ev.minigames, ...ev.duels, ...(ev.hunt ? [ev.hunt] : [])];
      for (const g of groups) {
        for (const t of g.top) wallets.add(t.wallet);
        for (const b of g.best) wallets.add(b.wallet);
      }
      for (const f of ev.feed) wallets.add(f.wallet);
    }
    if (wallets.size === 0) return;
    fetch(`/api/names?wallets=${encodeURIComponent([...wallets].slice(0, 100).join(","))}`)
      .then((r) => r.json())
      .then((body) => setNames(body.names ?? {}))
      .catch(() => undefined);
  }, [data]);

  const who = (wallet: string) => names[wallet] ?? `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;

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

      {data.events && !data.events.enabled && (
        <p style={sx.warn}>
          Gameplay events need the key-value store. Everything below fills in
          once players act with it configured.
        </p>
      )}

      {data.events?.enabled && (
        <>
          <Panel title="Protocols: opened vs used">
            <p style={sx.dim}>
              Opened counts a player walking up to an NPC and starting the flow.
              Used counts a confirmed transaction. The gap between them is where
              people give up.
            </p>
            <table style={sx.table}>
              <thead>
                <tr>
                  <th style={sx.th}>Protocol</th>
                  <th style={sx.thNum}>Opened</th>
                  <th style={sx.thNum}>Players</th>
                  <th style={sx.thNum}>Used</th>
                  <th style={sx.thNum}>Players</th>
                  <th style={sx.thNum}>7d</th>
                  <th style={sx.th}>Heaviest users</th>
                </tr>
              </thead>
              <tbody>
                {mergeProtocols(data.events).map((row) => (
                  <tr key={row.id}>
                    <td style={sx.td}>{row.id}</td>
                    <td style={sx.tdNum}>{row.opened}</td>
                    <td style={sx.tdNum}>{row.openedUsers}</td>
                    <td style={{ ...sx.tdNum, color: row.used ? "#14F195" : undefined }}>{row.used}</td>
                    <td style={sx.tdNum}>{row.usedUsers}</td>
                    <td style={sx.tdNum}>{row.last7}</td>
                    <td style={sx.td}>
                      {row.top.length === 0 ? <span style={sx.dim}>-</span> : row.top.map((t) => (
                        <span key={t.wallet} style={sx.chip}>{who(t.wallet)} · {t.count}</span>
                      ))}
                    </td>
                  </tr>
                ))}
                {mergeProtocols(data.events).length === 0 && (
                  <tr><td style={sx.td} colSpan={7}><span style={sx.dim}>No protocol activity recorded yet.</span></td></tr>
                )}
              </tbody>
            </table>
          </Panel>

          <Panel title="Mini-games">
            {data.events.minigames.length === 0 ? (
              <p style={sx.dim}>No rounds recorded yet.</p>
            ) : (
              <table style={sx.table}>
                <thead>
                  <tr>
                    <th style={sx.th}>Game</th>
                    <th style={sx.thNum}>Rounds</th>
                    <th style={sx.thNum}>Players</th>
                    <th style={sx.thNum}>7d</th>
                    <th style={sx.th}>Best scores</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.minigames.map((g) => (
                    <tr key={g.id}>
                      <td style={sx.td}>{g.id}</td>
                      <td style={sx.tdNum}>{g.count}</td>
                      <td style={sx.tdNum}>{g.users}</td>
                      <td style={sx.tdNum}>{g.last7}</td>
                      <td style={sx.td}>
                        {g.best.length === 0 ? <span style={sx.dim}>-</span> : g.best.map((b, i) => (
                          <span key={b.wallet} style={sx.chip}>{i + 1}. {who(b.wallet)} · {b.score}</span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Tutorials">
            <p style={sx.dim}>
              Each bar is how many players reached that card. A cliff between
              two bars is the card people quit on.
            </p>
            {data.events.tutorials.length === 0 ? (
              <p style={sx.dim}>No tutorial has been opened yet.</p>
            ) : data.events.tutorials.map((t) => (
              <div key={t.id} style={sx.tutorial}>
                <div style={sx.tutorialHead}>
                  <strong>{t.id}</strong>
                  <span style={sx.dim}>{t.users} players</span>
                  <span style={{ marginLeft: "auto", color: t.ok ? "#14F195" : "#7d86a8" }}>
                    {t.ok} finished
                    {t.steps[0] ? ` · ${Math.round((t.ok / t.steps[0]) * 100)}%` : ""}
                  </span>
                </div>
                {t.steps.length > 1 && <Funnel steps={t.steps} />}
              </div>
            ))}
          </Panel>

          <Panel title="Daily quests">
            {data.events.quests.length === 0 ? (
              <p style={sx.dim}>No quest progress recorded yet.</p>
            ) : (
              <table style={sx.table}>
                <thead>
                  <tr>
                    <th style={sx.th}>Quest</th>
                    <th style={sx.thNum}>Progress events</th>
                    <th style={sx.thNum}>Players</th>
                    <th style={sx.thNum}>Claimed</th>
                    <th style={sx.thNum}>7d</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.quests.map((q) => (
                    <tr key={q.id}>
                      <td style={sx.td}>{q.id}</td>
                      <td style={sx.tdNum}>{q.count}</td>
                      <td style={sx.tdNum}>{q.users}</td>
                      <td style={{ ...sx.tdNum, color: q.ok ? "#14F195" : undefined }}>{q.ok}</td>
                      <td style={sx.tdNum}>{q.last7}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Find Someone">
            {!data.events.hunt ? (
              <p style={sx.dim}>Nobody has found the hidden citizen yet.</p>
            ) : (
              <>
                <section style={sx.grid}>
                  <Stat label="Citizens found" value={data.events.hunt.count} />
                  <Stat label="Finders" value={data.events.hunt.users} />
                  <Stat label="Last 7 days" value={data.events.hunt.last7} />
                </section>
                <table style={sx.table}>
                  <thead>
                    <tr>
                      <th style={sx.th}>#</th>
                      <th style={sx.th}>Finder</th>
                      <th style={sx.thNum}>Finds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.hunt.top.map((t, i) => (
                      <tr key={t.wallet}>
                        <td style={sx.td}>{i + 1}</td>
                        <td style={sx.td}>{who(t.wallet)}</td>
                        <td style={sx.tdNum}>{t.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Panel>

          {data.events.duels.length > 0 && (
            <Panel title="Mech battles">
              <section style={sx.grid}>
                {data.events.duels.map((d) => (
                  <Stat key={d.id} label={d.id === "invite" ? "Invites sent" : "Invites accepted"} value={d.count} hint={`${d.users} players`} />
                ))}
              </section>
            </Panel>
          )}

          <Panel title="Recent activity">
            {data.events.feed.length === 0 ? (
              <p style={sx.dim}>Nothing recorded yet.</p>
            ) : (
              <div style={sx.feed}>
                {data.events.feed.slice(0, 40).map((f, i) => (
                  <div key={`${f.at}-${i}`} style={sx.feedRow}>
                    <span style={sx.feedTime}>{new Date(f.at).toLocaleTimeString()}</span>
                    <span style={sx.feedKind}>{f.kind}</span>
                    <span style={{ flex: 1 }}>{who(f.wallet)} · {f.id}{f.label ? ` · ${f.label}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

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
        Still not measured: people who never connect a wallet, since every
        event is keyed by one. Everything else on this page is either on-chain
        or reported by the game as it happens.
      </p>
    </>
  );
}

/**
 * One row per protocol, joining "opened the flow" with "confirmed a
 * transaction". They are separate event kinds because they are separate
 * moments, but a partner only wants to see one line per protocol.
 */
function mergeProtocols(ev: Events) {
  const rows = new Map<string, {
    id: string; opened: number; openedUsers: number; used: number; usedUsers: number;
    last7: number; top: { wallet: string; count: number }[];
  }>();
  for (const o of ev.opens) {
    rows.set(o.id, { id: o.id, opened: o.count, openedUsers: o.users, used: 0, usedUsers: 0, last7: o.last7, top: o.top });
  }
  for (const u of ev.protocols) {
    const row = rows.get(u.id) ?? { id: u.id, opened: 0, openedUsers: 0, used: 0, usedUsers: 0, last7: 0, top: [] };
    row.used = u.count;
    row.usedUsers = u.users;
    row.last7 = Math.max(row.last7, u.last7);
    if (u.top.length) row.top = u.top;
    rows.set(u.id, row);
  }
  return [...rows.values()].sort((a, b) => (b.used + b.opened) - (a.used + a.opened));
}

/** Tutorial drop-off: how many players reached each card. */
function Funnel({ steps }: { steps: number[] }) {
  const max = Math.max(1, ...steps);
  return (
    <div style={sx.funnel}>
      {steps.map((count, i) => (
        <div key={i} style={sx.funnelCol} title={`Card ${i + 1}: ${count}`}>
          <div style={{ ...sx.funnelBar, height: `${(count / max) * 100}%` }} />
          <span style={sx.funnelLabel}>{count}</span>
        </div>
      ))}
    </div>
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
  tutorial: { padding: "10px 0", borderBottom: "1px solid #161c30" },
  tutorialHead: { display: "flex", gap: 10, alignItems: "baseline", fontSize: 13, marginBottom: 6 },
  funnel: { display: "flex", alignItems: "flex-end", gap: 4, height: 56 },
  funnelCol: { flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 2 },
  funnelBar: { width: "100%", background: "#9945FF", borderRadius: "3px 3px 0 0", minHeight: 2 },
  funnelLabel: { fontSize: 10, color: "#7d86a8" },
  chip: { display: "inline-block", fontSize: 11, padding: "2px 7px", margin: "2px 4px 2px 0", borderRadius: 6, background: "#141a2e", border: "1px solid #232a44" },
  feed: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12 },
  feedRow: { display: "flex", gap: 10, padding: "4px 0", borderBottom: "1px solid #161c30", alignItems: "center" },
  feedTime: { color: "#5b6485", fontFamily: "monospace", flexShrink: 0 },
  feedKind: { color: "#9fb0ff", width: 92, flexShrink: 0 },
  ghost: { padding: "8px 12px", borderRadius: 8, border: "1px solid #2b3358", background: "transparent", color: "#aab3d4", cursor: "pointer", fontSize: 13 },
};
