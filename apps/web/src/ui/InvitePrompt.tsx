"use client";

import { useEffect, useState } from "react";
import { launch as launchMiniGame } from "@/game/minigames";
import type { OnChainMultiplayer } from "@/game/multiplayer/OnChainMultiplayer";

const GAME_LABELS: Record<string, string> = { jokenpo: "🪨📄✂️ JoKenPo" };

interface IncomingInvite {
  from: string;
  game: string;
  gameId: string;
  stakeLamports: number;
  bestOf: 1 | 3;
}

/**
 * Always-mounted (like ToastStack) — shows up whenever another player
 * challenges us, regardless of what we're looking at. Lives outside
 * PlayerCard because the recipient isn't necessarily looking at one.
 */
export default function InvitePrompt({ gameRef }: { gameRef: Phaser.Game | null }) {
  const [invite, setInvite] = useState<IncomingInvite | null>(null);

  useEffect(() => {
    if (!gameRef) return;
    const onInvite = (data: IncomingInvite) => setInvite(data);
    gameRef.events.on("network:invite", onInvite);
    return () => { gameRef.events.off("network:invite", onInvite); };
  }, [gameRef]);

  if (!invite || !gameRef) return null;

  const network = gameRef.scene.getScene("CityScene")?.registry.get("network") as OnChainMultiplayer | undefined;
  const fromShort = `${invite.from.slice(0, 4)}…${invite.from.slice(-4)}`;
  const stakeSol = invite.stakeLamports / 1_000_000_000;

  const respond = (accept: boolean) => {
    network?.sendGameInviteReply(invite.from, { game: invite.game, gameId: invite.gameId, accept });
    if (accept) {
      launchMiniGame(invite.game, {
        wallet: null,
        opponent: { kind: "player", wallet: invite.from, gameId: invite.gameId, isHost: false },
        stakeSol,
        bestOf: invite.bestOf,
      });
    }
    setInvite(null);
  };

  return (
    <div
      style={{
        position: "fixed", top: 16, right: "50%", transform: "translateX(50%)", zIndex: 150,
        background: "rgba(10,12,24,0.95)", border: "1px solid rgba(153,69,255,0.35)",
        borderRadius: 12, padding: "12px 16px", minWidth: 260,
        fontFamily: '"Fira Code", monospace', color: "#d0d0f0",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        animation: "fadeIn 0.15s ease",
      }}
    >
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translate(50%, -8px); } to { opacity: 1; transform: translate(50%, 0); } }`}</style>
      <div style={{ fontSize: 12, marginBottom: 8 }}>
        <span style={{ color: "#c084fc" }}>{fromShort}</span> challenges you to{" "}
        <span style={{ color: "#14F195" }}>{GAME_LABELS[invite.game] ?? invite.game}</span>
        {stakeSol > 0 ? ` for ${stakeSol} SOL` : " (free)"}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => respond(false)}
          style={{
            flex: 1, padding: "7px 0", borderRadius: 7,
            border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
            color: "#777", fontSize: 11, cursor: "pointer",
          }}
        >
          Decline
        </button>
        <button
          onClick={() => respond(true)}
          style={{
            flex: 1, padding: "7px 0", borderRadius: 7, border: "none",
            background: "linear-gradient(135deg, #14F195, #0db876)",
            color: "#031a10", fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
