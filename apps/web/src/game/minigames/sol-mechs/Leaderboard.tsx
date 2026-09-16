"use client";

/**
 * Sol Mechs — season leaderboard.
 *
 * Read straight from the ladder accounts, so it is the same data the program
 * settles against. Nicknames come from the city's name service when the wallet
 * has one; otherwise the short address.
 */
import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { RankedClient, tierOf } from "@/game/solmechs/ranked/rankedClient";
import type { LadderEntryAccount } from "@/game/solmechs/pvp/chain/mechProgram";
import { ELIGIBILITY } from "@/game/solmechs/season/config";
import { cachedName, onNames, requestNames } from "@/game/names/nameService";
import { C, T, SP, R, MONO, DISPLAY, PIXELATED, backdrop, panel, eyebrow, button, W } from "./theme";

const UI = "/assets/minigames/sol-mechs/ui";

export interface LeaderboardProps {
  client: RankedClient;
  me: PublicKey | null;
  onClose: () => void;
}

export default function Leaderboard({ client, me, onClose }: LeaderboardProps) {
  const [rows, setRows] = useState<LadderEntryAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, bumpNames] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client.leaderboard(50)
      .then((list) => {
        if (cancelled) return;
        setRows(list);
        requestNames(list.map((e) => e.authority.toBase58()));
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [client]);

  useEffect(() => onNames(() => bumpNames((n) => n + 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...panel(W.narrow), padding: `${SP.lg}px ${SP.xl}px`, overflowY: "auto" }}>
        <header style={sx.head}>
          <img
            src={`${UI}/icon-ranking.png`}
            alt=""
            style={{ ...PIXELATED, height: 26, width: "auto" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div style={eyebrow}>Season standings</div>
          <button onClick={onClose} style={sx.close} aria-label="Close">×</button>
        </header>

        {error && <div style={{ ...sx.empty, color: C.bad }}>{error}</div>}
        {!rows && !error && <div style={sx.empty}>Reading the ladder...</div>}
        {rows?.length === 0 && <div style={sx.empty}>Nobody has played a ranked match yet. Be first.</div>}

        {rows && rows.length > 0 && (
          <div style={sx.table}>
            {rows.map((row, i) => {
              const wallet = row.authority.toBase58();
              const isMe = !!me && row.authority.equals(me);
              const played = row.wins + row.losses;
              const eligible =
                played >= ELIGIBILITY.MIN_MATCHES &&
                row.distinctOpponents >= ELIGIBILITY.MIN_DISTINCT_OPPONENTS;
              return (
                <div key={wallet} style={{ ...sx.row, ...(isMe ? sx.rowMe : null) }}>
                  <span style={sx.place}>
                    {i < 3 ? (
                      <img
                        src={`${UI}/win-trophy.png`}
                        alt={`${i + 1}`}
                        style={{ ...PIXELATED, height: 18, width: "auto", opacity: 1 - i * 0.25 }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : i + 1}
                  </span>
                  <span style={sx.name}>
                    {cachedName(wallet) ?? `${wallet.slice(0, 4)}...${wallet.slice(-4)}`}
                    {isMe && <span style={sx.you}>YOU</span>}
                  </span>
                  <span style={sx.tier}>{tierOf(row.rating).name}</span>
                  <span style={sx.wl}>
                    <span style={{ color: C.good }}>{row.wins}</span>
                    <span style={{ color: C.faint }}>/</span>
                    <span style={{ color: C.bad }}>{row.losses}</span>
                  </span>
                  <span style={{ ...sx.rating, color: eligible ? C.text : C.dim }}>{row.rating}</span>
                </div>
              );
            })}
          </div>
        )}

        <p style={sx.foot}>
          A paying place needs {ELIGIBILITY.MIN_MATCHES} matches against{" "}
          {ELIGIBILITY.MIN_DISTINCT_OPPONENTS} different pilots. Dimmed ratings
          are not there yet.
        </p>
        <button style={{ ...button("ghost"), marginTop: SP.sm }} onClick={onClose}>BACK</button>
      </div>
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  head: { display: "flex", alignItems: "center", gap: SP.sm, marginBottom: SP.md },
  close: {
    marginLeft: "auto", background: "none", border: "none", color: C.faint,
    fontSize: 22, lineHeight: 1, cursor: "pointer",
  },
  table: { display: "flex", flexDirection: "column", gap: 2 },
  row: {
    display: "grid",
    gridTemplateColumns: "34px 1fr auto 60px 56px",
    alignItems: "center", gap: SP.sm,
    padding: "7px 10px", borderRadius: R.sm,
    background: C.ink, border: `1px solid ${C.line}`,
    fontSize: T.small,
  },
  rowMe: { borderColor: C.teal, background: `${C.teal}14` },
  place: { fontFamily: DISPLAY, color: C.faint, textAlign: "center" },
  name: {
    color: C.body, overflow: "hidden", textOverflow: "clip", whiteSpace: "nowrap",
    display: "flex", alignItems: "center", gap: SP.xs,
  },
  you: {
    fontFamily: MONO, fontSize: 10, color: C.ink, background: C.teal,
    borderRadius: R.sm, padding: "1px 4px", letterSpacing: 1,
  },
  tier: { fontFamily: MONO, fontSize: T.eyebrow, color: C.purple, letterSpacing: 1 },
  wl: { fontFamily: MONO, display: "flex", gap: 3, justifyContent: "flex-end" },
  rating: { fontFamily: DISPLAY, fontSize: T.lead, textAlign: "right" },
  empty: { fontSize: T.body, color: C.dim, padding: `${SP.lg}px 0`, textAlign: "center" },
  foot: { fontSize: T.small, color: C.faint, marginTop: SP.md, lineHeight: 1.6 },
};
