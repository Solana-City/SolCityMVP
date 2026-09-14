"use client";

/**
 * Sol Mechs — PvP lobby: searching, the moment an opponent is found, and the
 * hand-off to the battle screen.
 *
 * Mounting starts the search and unmounting cancels it — unless a match was
 * already found, which then belongs to the battle screen and must survive.
 */
import { useEffect, useRef, useState } from "react";
import type { TeamBuild } from "@/game/solmechs/data/team";
import { getMatrix } from "@/game/solmechs/data/catalog";
import type { MatchInfo, PvpTransport, SearchPhase } from "@/game/solmechs/pvp";
import { C, T, SP, R, MONO, PIXELATED, DISPLAY, W, backdrop, panel, eyebrow, button } from "./theme";

const UI = "/assets/minigames/sol-mechs/ui";
/** Long enough to read who you are about to fight. */
const HANDOFF_MS = 1_800;

type LobbyStatus =
  | { phase: SearchPhase; detail?: string }
  | { phase: "found"; match: MatchInfo }
  | { phase: "error"; detail: string };

export interface PvpLobbyProps {
  team: TeamBuild;
  transport: PvpTransport;
  onMatched: (match: MatchInfo) => void;
  onCancel: () => void;
}

function squadNames(team: TeamBuild): string[] {
  return team.mechs.map((b) => getMatrix(b.matrixCode)?.matrixName ?? b.matrixCode);
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function PvpLobby({ team, transport, onMatched, onCancel }: PvpLobbyProps) {
  const [status, setStatus] = useState<LobbyStatus>({ phase: "preparing" });
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;

  useEffect(() => {
    const ac = new AbortController();
    let found = false;
    let handoff = 0;
    const startedAt = Date.now();
    setElapsed(0);
    setStatus({ phase: "preparing" });
    const tick = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);

    transport
      .findMatch(team, (phase, detail) => { if (!ac.signal.aborted) setStatus({ phase, detail }); }, ac.signal)
      .then((match) => {
        if (ac.signal.aborted) return;
        found = true;
        setStatus({ phase: "found", match });
        handoff = window.setTimeout(() => onMatchedRef.current(match), HANDOFF_MS);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setStatus({ phase: "error", detail: (err as Error)?.message ?? String(err) });
      })
      .finally(() => window.clearInterval(tick));

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(handoff);
      if (!found) ac.abort();
    };
  }, [transport, team, attempt]);

  const cancel = () => {
    // Found but not yet handed off: the opponent is already committed to this
    // match, so leave it properly rather than walking away from it.
    if (status.phase === "found") void transport.leave();
    onCancel();
  };

  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const searching = status.phase === "preparing" || status.phase === "searching";

  return (
    <div style={backdrop}>
      <div style={sx.card}>
        <img
          src={`${UI}/logo.png`}
          alt="Sol Mechs"
          style={{ ...PIXELATED, width: "min(200px, 56%)", height: "auto", display: "block" }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <div style={eyebrow}>PvP · just for fun</div>
        <div style={sx.network}>{transport.label}</div>

        <div style={sx.stage}>
          {searching && (
            <>
              <Pulse />
              <div style={sx.headline}>
                {status.phase === "preparing" ? "Getting ready" : "Searching for an opponent"}
              </div>
              {status.phase === "searching" && <div style={sx.detail}>{formatElapsed(elapsed)}</div>}
              {status.detail && (
                <div style={{ ...sx.hint, color: status.phase === "searching" ? C.warn : C.body }}>
                  {status.detail}
                </div>
              )}
            </>
          )}
          {status.phase === "found" && (
            <>
              <div style={{ ...sx.headline, color: C.teal }}>Opponent found</div>
              <div style={sx.opponent}>{status.match.opponent.name}</div>
              <SquadLine names={squadNames(status.match.opponent.team)} />
            </>
          )}
          {status.phase === "error" && (
            <>
              <div style={{ ...sx.headline, color: C.bad }}>Could not find a match</div>
              <div style={sx.detail}>{status.detail}</div>
            </>
          )}
        </div>

        <div style={sx.divider} />
        <div style={eyebrow}>Your squad</div>
        <SquadLine names={squadNames(team)} />

        <div style={sx.actions}>
          {status.phase === "error" && (
            <button style={button("primary")} onClick={() => setAttempt((n) => n + 1)}>RETRY</button>
          )}
          <button style={button("ghost")} onClick={cancel}>
            {status.phase === "found" ? "LEAVE" : "CANCEL"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SquadLine({ names }: { names: string[] }) {
  return (
    <div style={sx.squad}>
      {names.map((n, i) => (
        <span key={`${n}-${i}`} style={sx.chip}>{n}</span>
      ))}
    </div>
  );
}

function Pulse() {
  return (
    <div style={{ display: "flex", gap: 8, height: 16, alignItems: "center" }} aria-hidden>
      <style>{"@keyframes solmechs-pulse{0%,100%{opacity:.25;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}"}</style>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 10, height: 10, borderRadius: 2, background: C.teal,
            animation: `solmechs-pulse 1.1s ${i * 0.18}s infinite ease-in-out`,
          }}
        />
      ))}
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  card: {
    ...panel(W.narrow),
    padding: SP.xl,
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: SP.sm, textAlign: "center",
  },
  network: {
    fontSize: T.small, color: C.faint, fontFamily: MONO,
    border: `1px solid ${C.line}`, borderRadius: R.pill, padding: "3px 12px",
  },
  stage: {
    minHeight: 120, width: "100%",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: SP.sm, margin: `${SP.sm}px 0`,
  },
  headline: { fontSize: 20, fontWeight: 800, color: C.text, fontFamily: DISPLAY, letterSpacing: 1 },
  detail: { fontSize: T.body, color: C.body, fontFamily: MONO, maxWidth: 440, lineHeight: 1.5 },
  hint: { fontSize: T.small, maxWidth: 460, lineHeight: 1.5 },
  opponent: { fontSize: T.body, color: C.text, fontWeight: 700 },
  divider: { width: "100%", height: 1, background: C.line, margin: `${SP.xs}px 0` },
  squad: { display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" },
  chip: {
    fontSize: T.small, fontWeight: 700, color: C.body,
    border: `1px solid ${C.line}`, borderRadius: R.sm, padding: "3px 10px",
  },
  actions: { display: "flex", gap: SP.sm, marginTop: SP.md },
};
