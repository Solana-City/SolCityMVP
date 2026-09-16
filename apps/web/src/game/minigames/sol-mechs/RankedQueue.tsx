"use client";

/**
 * Sol Mechs — the ranked queue.
 *
 * Mounting joins the queue (1 energy) and waits for the program to pair us.
 * Unmounting without a match cancels and refunds. The search band is drawn
 * rather than described: the bar fills as the accepted rating gap widens, so
 * the wait shows what it is buying.
 */
import { useEffect, useRef, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { RankedClient, type PairedRoom } from "@/game/solmechs/ranked/rankedClient";
import { MATCHMAKING } from "@/game/solmechs/season/config";
import { tolerance } from "@/game/solmechs/season/matchmaking";
import { C, T, SP, R, MONO, DISPLAY, PIXELATED, backdrop, panel, eyebrow, button, W } from "./theme";

const UI = "/assets/minigames/sol-mechs/ui";

export interface RankedQueueProps {
  client: RankedClient;
  rating: number;
  onPaired: (room: PairedRoom) => void;
  onCancel: () => void;
}

type Phase =
  | { kind: "joining" }
  | { kind: "searching"; detail: string }
  | { kind: "found"; opponent: PublicKey }
  | { kind: "error"; detail: string };

export default function RankedQueue({ client, rating, onPaired, onCancel }: RankedQueueProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "joining" });
  const [elapsed, setElapsed] = useState(0);
  const pairedRef = useRef(false);
  const onPairedRef = useRef(onPaired);
  onPairedRef.current = onPaired;

  useEffect(() => {
    const ac = new AbortController();
    const startedAt = Date.now();
    const tick = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);

    (async () => {
      try {
        const entry = await client.ensureEntry();
        if (!entry.queued) await client.joinQueue();
        if (ac.signal.aborted) return;
        setPhase({ kind: "searching", detail: "Looking for a pilot near your rating" });
        const room = await client.waitForPairing(ac.signal, (detail) => {
          if (!ac.signal.aborted) setPhase({ kind: "searching", detail });
        });
        if (ac.signal.aborted) return;
        pairedRef.current = true;
        setPhase({ kind: "found", opponent: room.opponent });
        window.setTimeout(() => onPairedRef.current(room), 1_400);
      } catch (err) {
        if (ac.signal.aborted) return;
        setPhase({ kind: "error", detail: (err as Error).message });
      }
    })();

    return () => {
      window.clearInterval(tick);
      ac.abort();
      // Leaving the screen before a match: give the energy back.
      if (!pairedRef.current) void client.cancelQueue();
    };
  }, [client]);

  const band = Math.round(tolerance(elapsed * 1000));
  const bandPct = Math.min(100, (band / MATCHMAKING.MAX_TOLERANCE) * 100);

  return (
    <div style={backdrop}>
      <div style={{ ...panel(W.narrow), padding: `${SP.xl}px ${SP.xl}px ${SP.lg}px`, textAlign: "center" }}>
        <div style={eyebrow}>Ranked queue</div>

        <div style={sx.radar}>
          <img
            src={`${UI}/icon-ranking.png`}
            alt=""
            style={{ ...PIXELATED, height: 40, width: "auto", opacity: phase.kind === "found" ? 1 : 0.8 }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div style={sx.timer}>{formatElapsed(elapsed)}</div>
        </div>

        {phase.kind === "found" ? (
          <>
            <div style={sx.found}>OPPONENT FOUND</div>
            <div style={sx.opponent}>{shortWallet(phase.opponent.toBase58())}</div>
          </>
        ) : phase.kind === "error" ? (
          <div style={{ ...sx.status, color: C.bad }}>{phase.detail}</div>
        ) : (
          <div style={sx.status}>
            {phase.kind === "joining" ? "Joining the queue. Approve in your wallet." : phase.detail}
          </div>
        )}

        {/* Search band: your rating in the middle, the accepted gap growing. */}
        <div style={sx.bandWrap}>
          <div style={sx.bandTrack}>
            <div style={{ ...sx.bandFill, width: `${bandPct}%` }} />
            <span style={sx.bandCenter} />
          </div>
          <div style={sx.bandLabels}>
            <span>{rating - band}</span>
            <span style={{ color: C.text }}>{rating}</span>
            <span>{rating + band}</span>
          </div>
        </div>

        <button style={{ ...button("ghost"), marginTop: SP.lg }} onClick={onCancel}>
          {phase.kind === "found" ? "..." : "CANCEL"}
        </button>
        <p style={sx.foot}>Cancelling gives the energy back.</p>
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

const sx: Record<string, React.CSSProperties> = {
  radar: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: SP.sm,
    margin: `${SP.lg}px 0`,
  },
  timer: { fontFamily: DISPLAY, fontSize: T.display, color: C.text },
  status: { fontSize: T.body, color: C.body, minHeight: 44 },
  found: { fontFamily: DISPLAY, fontSize: T.title, color: C.teal, letterSpacing: 2 },
  opponent: { fontFamily: MONO, fontSize: T.body, color: C.body, marginTop: SP.xs },
  bandWrap: { marginTop: SP.lg },
  bandTrack: {
    position: "relative", height: 10, background: C.ink,
    border: `1px solid ${C.line}`, borderRadius: R.pill, overflow: "hidden",
  },
  bandFill: {
    position: "absolute", left: "50%", top: 0, bottom: 0,
    transform: "translateX(-50%)",
    background: `linear-gradient(90deg, ${C.purple}, ${C.teal}, ${C.purple})`,
    transition: "width .4s linear",
  },
  bandCenter: {
    position: "absolute", left: "50%", top: -3, bottom: -3, width: 2,
    background: C.text, transform: "translateX(-50%)",
  },
  bandLabels: {
    display: "flex", justifyContent: "space-between",
    fontFamily: MONO, fontSize: T.eyebrow, color: C.faint, marginTop: SP.xs,
  },
  foot: { fontSize: T.small, color: C.faint, marginTop: SP.sm },
};
