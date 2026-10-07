"use client";

import { useEffect, useMemo, useState } from "react";
import type { OnChainMultiplayer, OnChainPlayer } from "@/game/multiplayer/OnChainMultiplayer";
import { useFlags } from "@/ui/useFlags";
import { track } from "@/game/telemetry/track";
import { useNickname } from "@/ui/useNicknames";
import { OPEN_DM_EVENT, SEND_TOKENS_EVENT } from "@/game/chat/dmEvents";
import { chamferBox } from "@/ui/chamfer";
import { AvatarPortrait } from "@/ui/AvatarPortrait";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { levelsFromMask } from "@/game/social/profilePublisher";
import { TRACKS, TIER_COLORS, levelName } from "@/game/progression/achievementRegistry";
import { AchievementIcon } from "@/ui/PixelIcons";
import { runFriendAction, type FriendAction } from "@/game/social/friendActions";
import { standingWith, type FriendStanding } from "@/game/social/friends";

/** The city opens Sol Mechs on this, with the player to duel. */
export const DUEL_INVITE_EVENT = "solcity:solmechs-duel";

/** What the one friend button says and does, per standing. */
const FRIEND_BUTTON: Record<Exclude<FriendStanding, "self">, {
  label: string;
  action: FriendAction | null;
  color: string;
  border: string;
}> = {
  none:            { label: "ADD FRIEND",     action: "invite",  color: "#14F195", border: "rgba(20,241,149,0.45)" },
  "invited-them":  { label: "INVITE SENT",    action: "cancel",  color: "#8a8aa7", border: "rgba(138,138,167,0.4)" },
  "invited-me":    { label: "ACCEPT FRIEND",  action: "accept",  color: "#FFD700", border: "rgba(255,215,0,0.5)"  },
  friends:         { label: "FRIENDS",        action: null,      color: "#14F195", border: "rgba(20,241,149,0.45)" },
};

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
  const { signTransaction } = useWallet();
  const [standing, setStanding] = useState<FriendStanding>("none");
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendNote, setFriendNote] = useState<string | null>(null);

  // Where we stand with them, read once when the card opens. Cached in
  // social/friends, so opening the same card again usually costs no query.
  useEffect(() => {
    if (!wallet || !myWallet || wallet === myWallet) return;
    let alive = true;
    standingWith(new PublicKey(myWallet), new PublicKey(wallet))
      .then((s) => { if (alive) setStanding(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, [wallet, myWallet]);

  const onFriend = async (): Promise<void> => {
    const action = standing === "self" ? null : FRIEND_BUTTON[standing].action;
    if (!action || !wallet || !myWallet || !signTransaction) return;
    setFriendBusy(true);
    setFriendNote(null);
    const res = await runFriendAction(
      action, new PublicKey(myWallet), new PublicKey(wallet), signTransaction,
    );
    setFriendBusy(false);
    if (res.ok) {
      setStanding(
        action === "invite" ? "invited-them"
        : action === "accept" ? "friends"
        : "none",
      );
    } else {
      setFriendNote(res.message);
    }
  };

  const closeFeel = useButtonFeel();
  const copyFeel = useButtonFeel();
  const friendFeel = useButtonFeel();
  const sendFeel = useButtonFeel();
  const messageFeel = useButtonFeel();
  const battleFeel = useButtonFeel();

  if (!wallet) return null;
  const short = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
  const name = nickname || displayName || player?.displayName || short;
  const isSelf = wallet === myWallet;
  const best = player?.streakBest ?? 0;

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
        {/* Who this is: their character wearing what they have on right now.
            The loadout rides along with their position, so it is as current
            as the sprite the player just clicked in the city. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <AvatarPortrait loadout={player?.loadout ?? null} size={70} />
          <span style={{
            fontFamily: '"Press Start 2P", monospace', fontSize: 8, color: "#B7E928",
            flex: 1, minWidth: 0, lineHeight: 1.6, overflowWrap: "anywhere",
          }}>
            {name}
          </span>
          <button onClick={onClose} {...closeFeel.handlers} style={{ background: "none", border: "none", color: "#14F0C6", fontSize: 13, cursor: "pointer", alignSelf: "flex-start", ...feelStyle(closeFeel) }}>
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
            {...copyFeel.handlers}
            style={chamferBox(6, {
              fontFamily: '"Press Start 2P", monospace', fontSize: 7,
              color: copied ? "#B7E928" : "#14F0C6",
              background: "rgba(20,240,198,0.12)",
              border: "1px solid rgba(20,240,198,0.3)",
              padding: "5px 8px", cursor: "pointer", flexShrink: 0,
              ...feelStyle(copyFeel),
            })}
            title="Copy wallet address"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, margin: "12px 0 4px" }}>
          <Stat label="Score" value={player?.score ?? 0} color="#B7E928" />
          <Stat label="Streak" value={player?.streakCurrent ?? 0} color="#FFD700"
            hint={best > 0 ? `best ${best}` : undefined} />
        </div>

        <Badges indices={player?.achievements} />

        {!isSelf && standing !== "self" && (
          <button
            onClick={() => void onFriend()}
            disabled={friendBusy || FRIEND_BUTTON[standing].action === null}
            {...friendFeel.handlers}
            style={chamferBox(8, {
              width: "100%", marginTop: 10, padding: "11px 0",
              fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
              color: FRIEND_BUTTON[standing].color,
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${FRIEND_BUTTON[standing].border}`,
              cursor: FRIEND_BUTTON[standing].action ? "pointer" : "default",
              opacity: friendBusy ? 0.6 : 1,
              ...feelStyle(friendFeel),
            })}
          >
            {friendBusy ? "..." : FRIEND_BUTTON[standing].label}
          </button>
        )}

        {friendNote && (
          <div style={{ fontSize: 6, color: "#FFD700", lineHeight: 1.6, marginTop: 8 }}>
            {friendNote}
          </div>
        )}

        {!isSelf && (
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent(SEND_TOKENS_EVENT, { detail: { wallet, name } }));
              onClose();
            }}
            {...sendFeel.handlers}
            style={chamferBox(8, {
              width: "100%", marginTop: 10, padding: "11px 0",
              fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
              color: "#14F0C6", background: "rgba(20,240,198,0.1)",
              border: "1px solid rgba(20,240,198,0.45)", cursor: "pointer",
              ...feelStyle(sendFeel),
})}
          >
            SEND TOKENS
          </button>
        )}

        {!isSelf && flags.chat && (
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent(OPEN_DM_EVENT, { detail: { wallet, name } }));
              onClose();
            }}
            {...messageFeel.handlers}
            style={chamferBox(8, {
              width: "100%", marginTop: 10, padding: "11px 0",
              fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
              color: "#FFD700", background: "rgba(255,215,0,0.1)",
              border: "1px solid rgba(255,215,0,0.45)", cursor: "pointer",
              ...feelStyle(messageFeel),
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
            {...battleFeel.handlers}
            style={chamferBox(8, {
              width: "100%", marginTop: 10, padding: "11px 0",
              fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 1,
              color: "#04140c", background: "linear-gradient(135deg, #B7E928, #0db876)",
              border: "none", cursor: "pointer",
              ...feelStyle(battleFeel),
            })}
          >
            MECH BATTLE
          </button>
        )}

        <div style={{ fontSize: 7, color: "#3a3a5a", lineHeight: 1.5, marginTop: 10 }}>
          {isSelf
            ? "Score, streak and badges are shared live."
            : flags.duels
              ? "A friendly Sol Mechs duel, 3v3. Nothing is at stake and no rating moves."
              : "Duels are off right now."}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, hint }: {
  label: string; value: number; color: string; hint?: string;
}) {
  return (
    <div style={chamferBox(8, {
      flex: 1, minWidth: 0,
      background: "rgba(255,255,255,0.03)", padding: "8px 10px",
    })}>
      <div style={{ fontSize: 7, color: "#555577" }}>{label}</div>
      <div style={{ fontSize: 11, color, fontWeight: 600 }}>{value}</div>
      {hint && <div style={{ fontSize: 5, color: "#555577", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** How many tracks to show before the row turns into a count. */
const BADGES_SHOWN = 10;

/**
 * The badges, as one per TRACK with the level on it, which is the same shape
 * the owner's own board uses.
 *
 * A card showing a separate badge per rung would repeat the same sprite three
 * times for someone who has petted the dog fifty times, and say less than one
 * badge reading "x4" does. Sorted by level, so the deepest tracks lead.
 *
 * Nothing earned renders nothing at all: an absent row says "new here" without
 * spending a line on it.
 */
function Badges({ indices }: { indices?: Set<number> }) {
  if (!indices || indices.size === 0) return null;

  const levels = levelsFromMask(indices);
  const earned = TRACKS
    .map((track, i) => ({ track, level: levels.get(track.id) ?? 0, i }))
    .filter((r) => r.level > 0)
    .sort((a, b) => b.level - a.level || a.i - b.i);
  if (earned.length === 0) return null;

  const shown = earned.slice(0, BADGES_SHOWN);
  const rest = earned.length - shown.length;
  const totalLevels = earned.reduce((n, r) => n + r.level, 0);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 7, color: "#555577" }}>BADGES</span>
        <span style={{ fontSize: 7, color: "#8a8aa7" }}>{totalLevels}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {shown.map(({ track, level }) => (
          <span
            key={track.id}
            title={`${levelName(track, level)} - ${track.description}`}
            style={chamferBox(4, {
              position: "relative",
              width: 26, height: 26,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${TIER_COLORS[track.levels[level - 1]?.tier ?? "common"]}`,
            })}
          >
            <AchievementIcon id={track.art ?? track.id} size={18} />
            {level > 1 && (
              <span style={{
                position: "absolute", right: -1, bottom: -2,
                fontSize: 5, lineHeight: 1,
                color: "#0b0e1c", background: TIER_COLORS[track.levels[level - 1]?.tier ?? "common"],
                padding: "1px 2px",
              }}>{level}</span>
            )}
          </span>
        ))}
        {rest > 0 && (
          <span style={{
            fontSize: 7, color: "#8a8aa7", alignSelf: "center", paddingLeft: 2,
          }}>+{rest}</span>
        )}
      </div>
    </div>
  );
}
