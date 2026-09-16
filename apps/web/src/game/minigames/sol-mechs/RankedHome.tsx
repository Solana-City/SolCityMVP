"use client";

/**
 * Sol Mechs — ranked hub.
 *
 * One screen answering the three questions a ladder player has: where do I
 * stand, can I play right now, and what does a match cost me. Rating is the
 * only standing there is (no tiers); energy is a row of pips, because a
 * number alone never reads as "how many games do I have left".
 */
import { useCallback, useEffect, useState } from "react";
import {
  RankedClient, effectiveEnergy, type RankedSnapshot,
} from "@/game/solmechs/ranked/rankedClient";
import { C, T, SP, R, MONO, DISPLAY, PIXELATED, backdrop, panel, eyebrow, button, W } from "./theme";
import { SpriteButton } from "./SpriteButton";

const UI = "/assets/minigames/sol-mechs/ui";
const MAX_ENERGY = 10;

export interface RankedHomeProps {
  client: RankedClient | null;
  /** Why ranked is unavailable, when `client` is null. */
  unavailable?: string | null;
  onQueue: () => void;
  onLeaderboard: () => void;
  onClose: () => void;
}

export default function RankedHome({ client, unavailable, onQueue, onLeaderboard, onClose }: RankedHomeProps) {
  const [snap, setSnap] = useState<RankedSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      setSnap(await client.load());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const entry = snap?.entry ?? null;
  const rating = entry?.rating ?? 1000;
  const energy = entry ? effectiveEnergy(entry) : 0;
  const played = (entry?.wins ?? 0) + (entry?.losses ?? 0);
  const seasonOpen = !!snap?.season && (snap.endsIn ?? 0) > 0;

  return (
    <div style={backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...panel(W.narrow), padding: `${SP.lg}px ${SP.xl}px ${SP.lg}px`, overflowY: "auto" }}>
        <button onClick={onClose} style={sx.close} aria-label="Close">×</button>

        <header style={sx.hero}>
          <img
            src={`${UI}/menu/ranked.png`}
            alt="Ranked"
            style={{ ...PIXELATED, height: 54, width: "auto" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={eyebrow}>Season {snap?.season?.id ?? "-"}</div>
            <div style={sx.rating}>{rating}</div>
            <div style={sx.record}>
              <span style={{ color: C.good }}>{entry?.wins ?? 0}W</span>
              <span style={{ color: C.faint }}>·</span>
              <span style={{ color: C.bad }}>{entry?.losses ?? 0}L</span>
              {played > 0 && <span style={{ color: C.faint }}>· {entry?.distinctOpponents ?? 0} rivals</span>}
            </div>
          </div>
          {snap?.endsIn != null && snap.endsIn > 0 && (
            <div style={sx.clock}>
              <div style={eyebrow}>Ends in</div>
              <div style={sx.clockValue}>{formatDays(snap.endsIn)}</div>
            </div>
          )}
        </header>

        {/* Energy: one pip per match you can still play today. */}
        <div style={sx.block}>
          <div style={eyebrow}>Energy</div>
          <div style={sx.pips}>
            {Array.from({ length: MAX_ENERGY }, (_, i) => (
              <span key={i} style={{ ...sx.pip, ...(i < energy ? sx.pipOn : null) }} />
            ))}
            <span style={sx.pipCount}>{energy} / {MAX_ENERGY}</span>
          </div>
          <div style={sx.hint}>One match costs 1. Five come back every day.</div>
        </div>

        {unavailable && <div style={sx.notice}>{unavailable}</div>}
        {error && <div style={{ ...sx.notice, color: C.bad, borderColor: C.bad }}>{error}</div>}
        {client && !snap?.season && !error && (
          <div style={sx.notice}>No season is open yet.</div>
        )}

        <div style={sx.actions}>
          <SpriteButton
            onClick={onQueue}
            disabled={!client || !seasonOpen || !entry || energy < 1 || !!busy}
            style={{ flex: 1, textAlign: "center", fontSize: T.body }}
          >
            FIND RANKED MATCH
          </SpriteButton>
          <SpriteButton onClick={onLeaderboard} disabled={!client} style={sx.iconBtn}>
            <img
              src={`${UI}/icon-ranking.png`}
              alt="Leaderboard"
              style={{ ...PIXELATED, height: 22, width: "auto", display: "block" }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          </SpriteButton>
        </div>

        <div style={sx.secondary}>
          {client && seasonOpen && !entry && (
            <button
              style={button("primary")}
              disabled={!!busy}
              onClick={() => run("entry", async () => { await client.ensureEntry(); })}
            >
              {busy === "entry" ? "SIGN IN YOUR WALLET..." : "JOIN THE SEASON"}
            </button>
          )}
          {client && entry && energy < MAX_ENERGY && (
            <button
              style={button("ghost")}
              disabled={!!busy || (entry.packsToday ?? 0) >= 1}
              onClick={() => run("energy", () => client.buyEnergy())}
              title={entry.packsToday >= 1 ? "One pack per day" : "0.01 SOL"}
            >
              {busy === "energy" ? "SIGNING..." : entry.packsToday >= 1 ? "PACK USED TODAY" : "+5 ENERGY · 0.01 SOL"}
            </button>
          )}
          <button style={button("ghost")} onClick={onClose}>BACK</button>
        </div>

        <p style={sx.foot}>
          Opponents are assigned by rating, never chosen. Both players report the
          result and the ladder moves when they agree.
        </p>
      </div>
    </div>
  );
}

function formatDays(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

const sx: Record<string, React.CSSProperties> = {
  close: {
    position: "absolute", top: SP.sm, right: SP.md,
    background: "none", border: "none", color: C.faint,
    fontSize: 22, lineHeight: 1, cursor: "pointer",
  },
  hero: { display: "flex", alignItems: "center", gap: SP.lg, marginBottom: SP.lg },
  rating: {
    fontFamily: DISPLAY, fontSize: T.display, color: C.text,
    display: "flex", alignItems: "baseline", gap: SP.sm, lineHeight: 1.1,
  },
  record: { display: "flex", gap: SP.sm, fontFamily: MONO, fontSize: T.small, marginTop: 2 },
  clock: { textAlign: "right", flexShrink: 0 },
  clockValue: { fontFamily: DISPLAY, fontSize: T.lead, color: C.warn },
  block: { marginBottom: SP.lg },
  pips: { display: "flex", alignItems: "center", gap: 4, marginTop: SP.xs },
  pip: {
    width: 18, height: 10, borderRadius: 2,
    background: C.ink, border: `1px solid ${C.line}`,
  },
  pipOn: { background: C.teal, borderColor: C.teal, boxShadow: `0 0 8px ${C.teal}66` },
  pipCount: { marginLeft: SP.sm, fontFamily: MONO, fontSize: T.small, color: C.dim },
  hint: { fontSize: T.small, color: C.faint, marginTop: SP.xs },
  notice: {
    border: `1px solid ${C.line}`, borderRadius: R.sm, padding: SP.sm,
    fontSize: T.small, color: C.body, marginBottom: SP.md,
  },
  actions: { display: "flex", gap: SP.sm, marginBottom: SP.md },
  iconBtn: { width: 56, display: "flex", alignItems: "center", justifyContent: "center" },
  secondary: { display: "flex", gap: SP.sm, flexWrap: "wrap" },
  foot: { fontSize: T.small, color: C.faint, marginTop: SP.md, lineHeight: 1.6 },
};
