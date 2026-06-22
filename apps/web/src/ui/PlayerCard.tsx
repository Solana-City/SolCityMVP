"use client";

import { useEffect, useMemo, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { launch as launchMiniGame } from "@/game/minigames";
import { STAKE_PRESETS_SOL } from "@/game/solana/rps/config";
import type { OnChainMultiplayer, OnChainPlayer } from "@/game/multiplayer/OnChainMultiplayer";

/**
 * Opened by clicking another connected player's avatar in the city
 * (CityScene emits "player:cardOpen"). Shows what we actually know about
 * them today — on-chain score/swap/transfer/bounty counts synced via
 * OnChainMultiplayer — and a "Challenge" list. JoKenPo is the first game;
 * more can be appended to GAMES without touching the invite plumbing.
 */
const GAMES = [{ id: "jokenpo", label: "🪨📄✂️ JoKenPo" }] as const;

interface Props {
  gameRef: Phaser.Game | null;
  wallet: string | null;
  displayName?: string;
  myWallet: string | null;
  onClose: () => void;
}

type ChallengeState = "idle" | "picking" | "waiting" | "declined" | "accepted";

export default function PlayerCard({ gameRef, wallet, displayName, myWallet, onClose }: Props) {
  const [player, setPlayer] = useState<OnChainPlayer | undefined>(undefined);
  const [challengeState, setChallengeState] = useState<ChallengeState>("idle");
  const [stakeSol, setStakeSol] = useState<number>(STAKE_PRESETS_SOL[0]);
  const [bestOf, setBestOf] = useState<1 | 3>(1);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);

  const network = useMemo<OnChainMultiplayer | null>(() => {
    if (!gameRef) return null;
    const scene = gameRef.scene.getScene("CityScene");
    return (scene?.registry.get("network") as OnChainMultiplayer) ?? null;
  }, [gameRef]);

  useEffect(() => {
    if (!wallet || !network) return;
    setPlayer(network.getPlayer(wallet));
    const id = setInterval(() => setPlayer(network.getPlayer(wallet)), 2000);
    return () => clearInterval(id);
  }, [wallet, network]);

  useEffect(() => {
    if (!gameRef || !wallet) return;
    const onReply = (data: { from: string; gameId: string; accept: boolean }) => {
      if (data.from !== wallet || data.gameId !== pendingGameId) return;
      if (data.accept) {
        setChallengeState("accepted");
        if (myWallet) {
          launchMiniGame("jokenpo", {
            wallet: null,
            opponent: { kind: "player", wallet, gameId: pendingGameId, isHost: true },
            stakeSol,
            bestOf,
          });
        }
        onClose();
      } else {
        setChallengeState("declined");
      }
    };
    gameRef.events.on("network:inviteReply", onReply);
    return () => { gameRef.events.off("network:inviteReply", onReply); };
  }, [gameRef, wallet, pendingGameId, myWallet, stakeSol, bestOf, onClose]);

  if (!wallet) return null;
  const short = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
  const name = displayName || player?.displayName || short;
  const isSelf = wallet === myWallet;

  const sendChallenge = (gameId_: string) => {
    if (!network || !myWallet) return;
    const gameId = Date.now().toString();
    setPendingGameId(gameId);
    setChallengeState("waiting");
    network.sendGameInvite(wallet, {
      game: gameId_,
      gameId,
      stakeLamports: Math.round(stakeSol * LAMPORTS_PER_SOL),
      bestOf,
    });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 90,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(6,10,20,0.7)", backdropFilter: "blur(5px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <style>{`
        .pc-pill { transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease; }
        .pc-pill:hover { transform: scale(1.04); }
        @keyframes pcFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div
        style={{
          width: 300,
          background: "rgba(10,12,24,0.94)",
          border: "1px solid rgba(153,69,255,0.25)",
          borderRadius: 16,
          boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
          fontFamily: '"Fira Code", monospace',
          color: "#d0d0f0",
          padding: "18px 20px",
          animation: "pcFade 0.15s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: "#c084fc" }}>
            {name}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer" }}>
            ×
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#6060aa", marginBottom: 4 }}>{short}</div>

        <div style={{ margin: "12px 0 16px" }}>
          <Stat label="Score" value={player?.score ?? 0} color="#14F195" />
        </div>
        <div style={{ fontSize: 10, color: "#3a3a5a", marginBottom: 14, lineHeight: 1.4 }}>
          Only live position-sync score is shared between players today —
          achievements and mini-game scores stay local to each player for now.
        </div>

        {isSelf ? (
          <div style={{ fontSize: 11, color: "#3a3a5a", textAlign: "center" }}>That's you!</div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: "#9090cc", marginBottom: 8 }}>Challenge to a game</div>

            {challengeState === "idle" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {GAMES.map((g) => (
                  <button
                    key={g.id}
                    className="pc-pill"
                    onClick={() => setChallengeState("picking")}
                    style={{
                      padding: "9px 0", borderRadius: 8,
                      border: "1px solid rgba(153,69,255,0.3)",
                      background: "rgba(153,69,255,0.08)",
                      color: "#c084fc", fontSize: 12, cursor: "pointer",
                    }}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            )}

            {challengeState === "picking" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#6060aa", marginBottom: 5 }}>Stake per player</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {STAKE_PRESETS_SOL.map((s) => (
                      <button
                        key={s}
                        className="pc-pill"
                        onClick={() => setStakeSol(s)}
                        style={{
                          flex: 1, padding: "6px 0", borderRadius: 7,
                          border: `1px solid ${stakeSol === s ? "rgba(20,241,149,0.5)" : "rgba(153,69,255,0.2)"}`,
                          background: stakeSol === s ? "rgba(20,241,149,0.12)" : "rgba(153,69,255,0.05)",
                          color: stakeSol === s ? "#14F195" : "#a0a0cc",
                          fontSize: 11, cursor: "pointer",
                        }}
                      >
                        {s === 0 ? "Free" : `${s} SOL`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#6060aa", marginBottom: 5 }}>Match length</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {([1, 3] as const).map((b) => (
                      <button
                        key={b}
                        className="pc-pill"
                        onClick={() => setBestOf(b)}
                        style={{
                          flex: 1, padding: "6px 0", borderRadius: 7,
                          border: `1px solid ${bestOf === b ? "rgba(20,241,149,0.5)" : "rgba(153,69,255,0.2)"}`,
                          background: bestOf === b ? "rgba(20,241,149,0.12)" : "rgba(153,69,255,0.05)",
                          color: bestOf === b ? "#14F195" : "#a0a0cc",
                          fontSize: 11, cursor: "pointer",
                        }}
                      >
                        Bo{b}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => sendChallenge("jokenpo")}
                  style={{
                    padding: "9px 0", borderRadius: 8, border: "none",
                    background: "linear-gradient(135deg, #9945FF, #c084fc)",
                    color: "#0a0a14", fontFamily: '"Press Start 2P", monospace',
                    fontSize: 10, cursor: "pointer",
                  }}
                >
                  SEND CHALLENGE
                </button>
              </div>
            )}

            {challengeState === "waiting" && (
              <div style={{ fontSize: 12, color: "#7070aa", textAlign: "center", padding: "8px 0" }}>
                Waiting for {name} to respond...
              </div>
            )}
            {challengeState === "declined" && (
              <div style={{ fontSize: 12, color: "#ff6b6b", textAlign: "center", padding: "8px 0" }}>
                {name} declined.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, color: "#555577" }}>{label}</div>
      <div style={{ fontSize: 15, color, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
