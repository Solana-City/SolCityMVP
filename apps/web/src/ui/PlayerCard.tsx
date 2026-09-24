"use client";

import { useEffect, useMemo, useState } from "react";
import type { OnChainMultiplayer, OnChainPlayer } from "@/game/multiplayer/OnChainMultiplayer";
import { useFlags } from "@/ui/useFlags";
import { track } from "@/game/telemetry/track";
import { useNickname } from "@/ui/useNicknames";
import { OPEN_DM_EVENT } from "@/game/chat/dmEvents";
import { chamferBox } from "@/ui/chamfer";

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
  const nickname = useNickname(wallet);

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
  const name = nickname || displayName || player?.displayName || short;
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
          borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
          borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
          imageRendering: "pixelated",
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
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#14F0C6", fontSize: 13, cursor: "pointer" }}>
            ×
          </button>
        </div>

        {/* Wallet + copy */}
        <div style={{ fontSize: 7, color: "#555577", marginBottom: 5 }}>
          WALLET{isSelf ? " (you)" : ""}
        </div>
        <div style={chamferBox(8, {
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(255,255,255,0.03)", padding: "8px 10px",
        })}>
          <span style={{ fontSize: 9, color: "#9a9ad0", flex: 1, minWidth: 0 }}>{short}</span>
          <button
            onClick={copyWallet}
            style={chamferBox(6, {
              fontFamily: '"Press Start 2P", monospace', fontSize: 7,
              color: copied ? "#B7E928" : "#c084fc",
              background: "rgba(153,69,255,0.12)",
              border: "1px solid rgba(153,69,255,0.3)",
              padding: "5px 8px", cursor: "pointer", flexShrink: 0,
            })}
            title="Copy wallet address"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div style={{ margin: "12px 0 4px" }}>
          <Stat label="Score" value={player?.score ?? 0} color="#B7E928" />
        </div>

        {!isSelf && flags.chat && (
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent(OPEN_DM_EVENT, { detail: { wallet, name } }));
              onClose();
            }}
            style={chamferBox(8, {
              width: "100%", marginTop: 10, padding: "11px 0", 
              fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
              color: "#FFD700", background: "rgba(255,215,0,0.1)",
              border: "1px solid rgba(255,215,0,0.45)", cursor: "pointer",
            })}
          >
            MESSAGE
          </button>
        )}

        {!isSelf && flags.duels && (
          <button
            onClick={() => {
              track("duel", "invite", { value: 1, label: "challenged a player" });
              window.dispatchEvent(new CustomEvent(DUEL_INVITE_EVENT, {
                detail: { kind: "challenge", opponent: wallet, name: displayName || player?.displayName },
              }));
              onClose();
            }}
            style={chamferBox(8, {
              width: "100%", marginTop: 10, padding: "11px 0", 
              fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
              color: "#04140c", background: "linear-gradient(135deg, #B7E928, #0db876)",
              border: "none", cursor: "pointer",
            })}
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
    <div style={chamferBox(8, { background: "rgba(255,255,255,0.03)", padding: "8px 10px" })}>
      <div style={{ fontSize: 7, color: "#555577" }}>{label}</div>
      <div style={{ fontSize: 11, color, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
