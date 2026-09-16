"use client";

/**
 * Developer panel — /dev/panel
 *
 * The team's view of the live game: who is in the city, what the Sol Mechs
 * program is doing, the nickname registry with its moderation actions, and the
 * content toggles.
 *
 * The admin key is typed in here and kept in sessionStorage, never in the
 * bundle and never in a cookie: it is the same `NAMES_ADMIN_KEY` the server
 * checks, so a leaked build cannot carry it. Closing the tab forgets it.
 */
import { useCallback, useEffect, useState } from "react";

const KEY_STORAGE = "solcity:admin-key";

interface Player {
  wallet: string;
  displayName: string;
  nickname: string | null;
  x: number;
  y: number;
  score: number;
  lastActive: number;
}

interface FlagDef { id: string; label: string; effect: string; default: boolean }

interface Overview {
  ok: boolean;
  store: "redis" | "memory" | "off";
  city: { online: number; players: Player[]; error: string | null };
  mechs: {
    configured: boolean; programId: string | null; deployed: boolean;
    duelists: number; seasonOpen: boolean; queueOpen: boolean; poolOpen: boolean; error?: string;
  };
  names: { count: number; list: string[] };
  flags: Record<string, boolean>;
  flagDefs: FlagDef[];
}

export default function DeveloperPanel() {
  const [key, setKey] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY_STORAGE);
      if (saved) setKey(saved);
    } catch { /* private mode */ }
  }, []);

  const say = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 30));

  const load = useCallback(async (adminKey: string) => {
    if (!adminKey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/overview", { headers: { "x-admin-key": adminKey } });
      if (res.status === 401) throw new Error("Wrong admin key, or NAMES_ADMIN_KEY is not set on the server.");
      const body = await res.json();
      setData(body);
      try { sessionStorage.setItem(KEY_STORAGE, adminKey); } catch { /* ignore */ }
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  // Live-ish: the online roster is the reason to keep this tab open.
  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => void load(key), 20_000);
    return () => clearInterval(t);
  }, [data, key, load]);

  const admin = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/names/admin", {
        method: "POST",
        headers: { "x-admin-key": key, "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await res.json();
      say(`${action}: ${body.ok ? "ok" : body.message ?? "failed"}${body.name ? ` (${body.name})` : ""}`);
      await load(key);
      return body;
    } catch (err) {
      say(`${action}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const setFlag = async (id: string, value: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "x-admin-key": key, "content-type": "application/json" },
        body: JSON.stringify({ id, value }),
      });
      const body = await res.json();
      say(`flag ${id} -> ${value ? "on" : "off"}: ${body.ok ? "ok" : body.message}`);
      if (body.ok) setData((d) => (d ? { ...d, flags: body.flags } : d));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <main style={sx.gate}>
        <div style={sx.card}>
          <h1 style={sx.h1}>Developer panel</h1>
          <p style={sx.dim}>Enter the admin key (NAMES_ADMIN_KEY).</p>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load(key); }}
            placeholder="admin key"
            style={sx.input}
            autoFocus
          />
          <button style={sx.primary} disabled={busy || !key} onClick={() => void load(key)}>
            {busy ? "CHECKING..." : "OPEN"}
          </button>
          {error && <p style={sx.error}>{error}</p>}
        </div>
      </main>
    );
  }

  const storeBad = data.store === "off";

  return (
    <main style={sx.page}>
      <header style={sx.head}>
        <h1 style={sx.h1}>Developer panel</h1>
        <span style={{ ...sx.pill, background: storeBad ? "#5a1b24" : "#14331f", color: storeBad ? "#ff9aa6" : "#5fe3a1" }}>
          store: {data.store}
        </span>
        <button style={sx.ghost} disabled={busy} onClick={() => void load(key)}>REFRESH</button>
        <button
          style={sx.ghost}
          onClick={() => { try { sessionStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ } setData(null); setKey(""); }}
        >
          LOCK
        </button>
      </header>

      {storeBad && (
        <p style={sx.warn}>
          The key-value store is not configured, so nicknames and flags are read-only
          defaults. Set KV_REST_API_URL and KV_REST_API_TOKEN to enable them.
        </p>
      )}

      <section style={sx.grid}>
        <Stat label="Online now" value={data.city.online} />
        <Stat label="Nicknames" value={data.names.count} />
        <Stat label="Duelists on the rollup" value={data.mechs.duelists} />
        <Stat label="Sol Mechs season" value={data.mechs.seasonOpen ? "open" : "none"} />
      </section>

      {/* ── City ── */}
      <Panel title={`City (${data.city.online} online)`}>
        {data.city.error && <p style={sx.error}>{data.city.error}</p>}
        {data.city.players.length === 0 && <p style={sx.dim}>Nobody is in the city right now.</p>}
        {data.city.players.length > 0 && (
          <table style={sx.table}>
            <thead>
              <tr>
                <th style={sx.th}>Player</th>
                <th style={sx.th}>Wallet</th>
                <th style={sx.thNum}>Score</th>
                <th style={sx.thNum}>Tile</th>
                <th style={sx.thNum}>Last move</th>
                <th style={sx.th}></th>
              </tr>
            </thead>
            <tbody>
              {data.city.players.map((p) => (
                <tr key={p.wallet}>
                  <td style={sx.td}>{p.nickname ?? p.displayName}</td>
                  <td style={{ ...sx.td, fontFamily: "monospace", fontSize: 12 }}>
                    {p.wallet.slice(0, 4)}...{p.wallet.slice(-4)}
                  </td>
                  <td style={sx.tdNum}>{p.score}</td>
                  <td style={sx.tdNum}>{Math.round(p.x / 24)},{Math.round(p.y / 24)}</td>
                  <td style={sx.tdNum}>{ago(p.lastActive)}</td>
                  <td style={sx.td}>
                    {p.nickname && (
                      <button
                        style={sx.danger}
                        disabled={busy || storeBad}
                        onClick={() => {
                          const reason = prompt(`Lock the name "${p.nickname}"? Reason:`, "offensive");
                          if (reason) void admin("lock", { name: p.nickname, reason });
                        }}
                      >
                        LOCK NAME
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {/* ── Nicknames ── */}
      <Panel title={`Nicknames (${data.names.count})`}>
        <Row>
          <Action
            label="Look up a wallet"
            placeholder="wallet address"
            button="LOOK UP"
            disabled={busy}
            onSubmit={async (wallet) => {
              const body = await admin("lookup", { wallet });
              if (body?.ok) say(`  name=${body.name ?? "none"} locked=${body.locked ? "yes" : "no"}`);
            }}
          />
          <Action
            label="Lock a name"
            placeholder="name to take away"
            button="LOCK"
            danger
            disabled={busy || storeBad}
            onSubmit={(name) => {
              const reason = prompt(`Reason for locking "${name}"`, "offensive");
              if (reason) void admin("lock", { name, reason });
            }}
          />
          <Action
            label="Unlock"
            placeholder="name or wallet"
            button="UNLOCK"
            disabled={busy || storeBad}
            onSubmit={(value) => {
              void admin("unlock", value.length > 20 ? { wallet: value } : { name: value });
            }}
          />
          <Action
            label="Block a word"
            placeholder="word banned in names"
            button="BLOCK"
            danger
            disabled={busy || storeBad}
            onSubmit={(word) => void admin("block-word", { word })}
          />
          <Action
            label="Unblock a word"
            placeholder="word to allow again"
            button="UNBLOCK"
            disabled={busy || storeBad}
            onSubmit={(word) => void admin("unblock-word", { word })}
          />
        </Row>
        {data.names.list.length > 0 && (
          <div style={sx.chips}>
            {data.names.list.map((n) => <span key={n} style={sx.chip}>{n}</span>)}
          </div>
        )}
      </Panel>

      {/* ── Content toggles ── */}
      <Panel title="Content toggles">
        {data.flagDefs.map((f) => {
          const on = data.flags[f.id];
          return (
            <div key={f.id} style={sx.flagRow}>
              <button
                style={{ ...sx.toggle, background: on ? "#14F195" : "#2a2a45", color: on ? "#04140c" : "#8b8ba7" }}
                disabled={busy || storeBad}
                onClick={() => void setFlag(f.id, !on)}
              >
                {on ? "ON" : "OFF"}
              </button>
              <div>
                <div style={{ fontWeight: 600 }}>{f.label}</div>
                <div style={sx.dim}>{f.effect}</div>
              </div>
            </div>
          );
        })}
      </Panel>

      {/* ── Sol Mechs ── */}
      <Panel title="Sol Mechs program">
        <dl style={sx.dl}>
          <Item k="Configured" v={data.mechs.configured ? "yes" : "no (NEXT_PUBLIC_SOLMECHS_PROGRAM unset)"} />
          <Item k="Program" v={data.mechs.programId ?? "-"} mono />
          <Item k="Deployed" v={data.mechs.deployed ? "yes" : "no"} />
          <Item k="Season 1" v={data.mechs.seasonOpen ? "open" : "not created"} />
          <Item k="Queue" v={data.mechs.queueOpen ? "open" : "not created"} />
          <Item k="Prize pool" v={data.mechs.poolOpen ? "open" : "not created"} />
          <Item k="Duelists on the rollup" v={String(data.mechs.duelists)} />
        </dl>
        {data.mechs.error && <p style={sx.error}>{data.mechs.error}</p>}
      </Panel>

      {log.length > 0 && (
        <Panel title="Actions">
          <pre style={sx.log}>{log.join("\n")}</pre>
        </Panel>
      )}
    </main>
  );
}

function ago(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={sx.panel}>
      <h2 style={sx.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={sx.row}>{children}</div>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={sx.stat}>
      <div style={sx.statValue}>{value}</div>
      <div style={sx.dim}>{label}</div>
    </div>
  );
}

function Item({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt style={sx.dt}>{k}</dt>
      <dd style={{ ...sx.dd, fontFamily: mono ? "monospace" : undefined }}>{v}</dd>
    </>
  );
}

function Action({ label, placeholder, button, onSubmit, disabled, danger }: {
  label: string;
  placeholder: string;
  button: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const [value, setValue] = useState("");
  const go = () => { if (value.trim()) { onSubmit(value.trim()); setValue(""); } };
  return (
    <div style={sx.action}>
      <label style={sx.dim}>{label}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          placeholder={placeholder}
          style={{ ...sx.input, marginBottom: 0 }}
        />
        <button style={danger ? sx.danger : sx.ghost} disabled={disabled || !value.trim()} onClick={go}>
          {button}
        </button>
      </div>
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#070910", color: "#d8d8ea", padding: 24, fontFamily: "system-ui, sans-serif" },
  gate: { minHeight: "100vh", background: "#070910", display: "flex", alignItems: "center", justifyContent: "center" },
  card: { width: 360, padding: 24, background: "#0d1020", border: "1px solid #232a44", borderRadius: 12, color: "#d8d8ea", fontFamily: "system-ui, sans-serif" },
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" },
  h1: { fontSize: 20, margin: 0, fontWeight: 700 },
  h2: { fontSize: 14, margin: "0 0 12px", color: "#9fb0ff", letterSpacing: 1, textTransform: "uppercase" },
  pill: { fontSize: 12, padding: "3px 10px", borderRadius: 999 },
  dim: { color: "#7d86a8", fontSize: 13 },
  warn: { background: "#2a1d10", border: "1px solid #6b4a1f", color: "#ffcb8a", padding: 10, borderRadius: 8, fontSize: 13 },
  error: { color: "#ff9aa6", fontSize: 13 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 },
  stat: { background: "#0d1020", border: "1px solid #232a44", borderRadius: 10, padding: 14 },
  statValue: { fontSize: 26, fontWeight: 700, color: "#fff" },
  panel: { background: "#0d1020", border: "1px solid #232a44", borderRadius: 12, padding: 16, marginBottom: 16 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "6px 8px", color: "#7d86a8", fontWeight: 500, fontSize: 12, borderBottom: "1px solid #232a44" },
  thNum: { textAlign: "right", padding: "6px 8px", color: "#7d86a8", fontWeight: 500, fontSize: 12, borderBottom: "1px solid #232a44" },
  td: { padding: "7px 8px", borderBottom: "1px solid #161c30" },
  tdNum: { padding: "7px 8px", borderBottom: "1px solid #161c30", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 },
  action: { display: "flex", flexDirection: "column", gap: 4 },
  input: { width: "100%", boxSizing: "border-box", padding: "9px 10px", marginBottom: 10, borderRadius: 8, border: "1px solid #2b3358", background: "#0a0d1a", color: "#fff", fontSize: 14 },
  primary: { width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "#14F195", color: "#04140c", fontWeight: 700, cursor: "pointer" },
  ghost: { padding: "8px 12px", borderRadius: 8, border: "1px solid #2b3358", background: "transparent", color: "#aab3d4", cursor: "pointer", fontSize: 13 },
  danger: { padding: "8px 12px", borderRadius: 8, border: "1px solid #6b2230", background: "#2a1017", color: "#ff9aa6", cursor: "pointer", fontSize: 13 },
  toggle: { width: 56, padding: "7px 0", borderRadius: 8, border: "none", fontWeight: 700, cursor: "pointer", fontSize: 12 },
  flagRow: { display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #161c30" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 },
  chip: { fontSize: 12, padding: "3px 8px", borderRadius: 6, background: "#141a2e", border: "1px solid #232a44" },
  dl: { display: "grid", gridTemplateColumns: "200px 1fr", gap: "6px 12px", margin: 0, fontSize: 14 },
  dt: { color: "#7d86a8" },
  dd: { margin: 0, wordBreak: "break-all" },
  log: { margin: 0, fontSize: 12, color: "#9fb0ff", whiteSpace: "pre-wrap", fontFamily: "monospace" },
};
