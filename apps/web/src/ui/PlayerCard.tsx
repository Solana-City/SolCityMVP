"use client";

import { useEffect, useMemo, useState } from "react";
import type { OnChainMultiplayer, OnChainPlayer } from "@/game/multiplayer/OnChainMultiplayer";
import { useFlags } from "@/ui/useFlags";

/** The city opens Sol Mechs on this, with the player to duel. */
export const DUEL_INVITE_EVENT = "solcity:solmechs-duel";

/**
 * Opened by clicking another connected player's avatar in the city
 * (CityScene emits "player:cardOpen"). Shows what we know about them —
 * on-chain score synced via OnChainMultiplayer — and invites them to a
 * friendly Sol Mechs duel (3v3), which the city picks up as
 * DUEL_INVITE_EVENT.
 */
interface Props {
  gameRef: Phaser.Game | null;
  wallet: string | null;
  displayName?: string;
  myWallet: string | null;
  onClose: () => void;
}

export default function PlayerCard({ gameRef, wallet, displayName, myWallet, onClose }: Props) {
  const [player, setPlayer] = useState<OnChainPlayer | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const flags = useFlags();

  const copyWallet = () => {
    if (!wallet) return;
    navigator.clipboard?.writeText(wallet)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
      .catch(() => {});
  };

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

  if (!wallet) return null;
  const short = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
  const name = displayName || player?.displayName || short;
  const isSelf = wallet === myWallet;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 90,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(6,10,20,0.7)", backdropFilter: "blur(5px)",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <style>{`@keyframes pcFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div
        style={{
          width: 280,
          background: "rgba(10,12,24,0.94)",
          border: "1px solid rgba(153,69,255,0.25)",
          borderRadius: 16,
          boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
          fontFamily: '"Press Start 2P", monospace',
          color: "#d0d0f0",
          padding: "18px 20px",
          animation: "pcFade 0.15s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 8, color: "#c084fc" }}>
            {name}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 13, cursor: "pointer" }}>
            ×
          </button>
        </div>

        {/* Wallet + copy */}
        <div style={{ fontSize: 7, color: "#555577", marginBottom: 5 }}>
          WALLET{isSelf ? " (you)" : ""}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px",
        }}>
          <span style={{ fontSize: 9, color: "#9a9ad0", flex: 1, minWidth: 0 }}>{short}</span>
          <button
            onClick={copyWallet}
            style={{
              fontFamily: '"Press Start 2P", monospace', fontSize: 7,
              color: copied ? "#14F195" : "#c084fc",
              background: "rgba(153,69,255,0.12)",
              border: "1px solid rgba(153,69,255,0.3)",
              borderRadius: 6, padding: "5px 8px", cursor: "pointer", flexShrink: 0,
            }}
            title="Copy wallet address"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div style={{ margin: "12px 0 4px" }}>
          <Stat label="Score" value={player?.score ?? 0} color="#14F195" />
        </div>

        {!isSelf && flags.duels && (
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent(DUEL_INVITE_EVENT, {
                detail: { kind: "challenge", opponent: wallet, name: displayName || player?.displayName },
              }));
              onClose();
            }}
            style={{
              width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 8,
              fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
              color: "#04140c", background: "linear-gradient(135deg, #14F195, #0db876)",
              border: "none", cursor: "pointer",
            }}
          >
            MECH BATTLE
          </button>
        )}

        <div style={{ fontSize: 7, color: "#3a3a5a", lineHeight: 1.5, marginTop: 10 }}>
          {isSelf
            ? "Presence score is shared live. Achievements and mini-game scores are still local for now."
            : flags.duels
              ? "A friendly Sol Mechs duel, 3v3. Nothing is at stake and no rating moves."
              : "Duels are off right now."}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 7, color: "#555577" }}>{label}</div>
      <div style={{ fontSize: 11, color, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
