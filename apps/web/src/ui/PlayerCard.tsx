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
import { AchievementIcon, CloseButton } from "@/ui/PixelIcons";
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
  none:            { label: "ADD FRIEND",     action: "invite",  color: "#14F0C6", border: "rgba(20,240,198,0.7)" },
  "invited-them":  { label: "INVITE SENT",    action: "cancel",  color: "#8a8aa7", border: "rgba(138,138,167,0.4)" },
  "invited-me":    { label: "ACCEPT FRIEND",  action: "accept",  color: "#FFD700", border: "rgba(255,215,0,0.5)"  },
  friends:         { label: "FRIENDS",        action: null,      color: "#14F0C6", border: "rgba(20,240,198,0.7)" },
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

  const CYAN = "#14F0C6";
  const cta = (extra: React.CSSProperties) => ({
    width: "100%", padding: "11px 0",
    fontFamily: '"Press Start 2P", monospace', fontSize: 8, letterSpacing: 1,
    cursor: "pointer", ...extra,
  });

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
          width: "min(640px, 94vw)",
          maxHeight: "96%", overflowY: "auto",
          background: "#061A3A",
          borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
          borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
          imageRendering: "pixelated",
          boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
          fontFamily: '"Press Start 2P", monospace',
          color: "#d0d0f0",
          padding: "0 16px 16px",
          animation: "pcFade 0.15s ease",
        }}
      >
        {/* Title bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 0", borderBottom: "1px solid rgba(20,240,198,0.6)",
        }}>
          <span style={{ fontSize: 13, color: CYAN, letterSpacing: 2 }}>PLAYER PROFILE</span>
          <CloseButton onClick={onClose} size={24} />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 14 }}>
          {/* Who this is: their character wearing what they have on right now,
              then the name and, right under it, the wallet. The loadout rides
              along with their position, so it is as current as the sprite the
              player just clicked in the city. */}
          <div style={{ flex: "1 1 250px", minWidth: 0, paddingRight: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <AvatarPortrait loadout={player?.loadout ?? null} size={84} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, color: "#B7E928", lineHeight: 1.5, overflowWrap: "anywhere",
                }}>
                  {name}
                </div>
                <div style={{ fontSize: 7, color: "#8fa0d0", margin: "8px 0 4px" }}>
                  WALLET{isSelf ? " (you)" : ""}
                </div>
                <div style={chamferBox(8, {
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  background: "rgba(255,255,255,0.05)", padding: "5px 6px 5px 10px",
                })}>
                  <span style={{ fontSize: 9, color: "#aab6e8" }}>{short}</span>
                  <button
                    onClick={copyWallet}
                    {...copyFeel.handlers}
                    style={chamferBox(6, {
                      fontFamily: '"Press Start 2P", monospace', fontSize: 7,
                      color: copied ? "#B7E928" : CYAN,
                      background: "rgba(20,240,198,0.1)",
                      border: "1px solid rgba(20,240,198,0.7)",
                      padding: "5px 8px", cursor: "pointer", flexShrink: 0,
                      ...feelStyle(copyFeel),
                    })}
                    title="Copy wallet address"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Stat label="Score" value={player?.score ?? 0} color="#B7E928" />
              <Stat label="Streak" value={player?.streakCurrent ?? 0} color="#B7E928"
                hint={best > 0 ? `best ${best}` : undefined} />
            </div>

            <Badges indices={player?.achievements} />

            {isSelf && (
              <div style={{ fontSize: 7, color: "#6f7fb0", lineHeight: 1.6, marginTop: 12 }}>
                Score, streak and badges are shared live.
              </div>
            )}
          </div>

          {/* What you can do with them */}
          {!isSelf && (
            <div style={{
              flex: "1.1 1 270px", minWidth: 0, paddingLeft: 16,
              borderLeft: "1px solid rgba(20,240,198,0.45)",
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ fontSize: 9, color: "#aab6e8", letterSpacing: 1 }}>INTERACT</div>

              {flags.chat && (
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent(OPEN_DM_EVENT, { detail: { wallet, name } }));
                    onClose();
                  }}
                  {...messageFeel.handlers}
                  style={chamferBox(8, cta({
                    color: CYAN, background: "rgba(20,240,198,0.08)",
                    border: "2px solid rgba(20,240,198,0.75)",
                    ...feelStyle(messageFeel),
                  }))}
                >
                  MESSAGE
                </button>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                {standing !== "self" && (
                  <button
                    onClick={() => void onFriend()}
                    disabled={friendBusy || FRIEND_BUTTON[standing].action === null}
                    {...friendFeel.handlers}
                    style={chamferBox(8, cta({
                      flex: 1, minWidth: 0,
                      color: FRIEND_BUTTON[standing].color,
                      background: "rgba(20,240,198,0.08)",
                      border: `2px solid ${FRIEND_BUTTON[standing].border}`,
                      cursor: FRIEND_BUTTON[standing].action ? "pointer" : "default",
                      opacity: friendBusy ? 0.6 : 1,
                      ...feelStyle(friendFeel),
                    }))}
                  >
                    {friendBusy ? "..." : FRIEND_BUTTON[standing].label}
                  </button>
                )}
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent(SEND_TOKENS_EVENT, { detail: { wallet, name } }));
                    onClose();
                  }}
                  {...sendFeel.handlers}
                  style={chamferBox(8, cta({
                    flex: 1, minWidth: 0,
                    color: CYAN, background: "rgba(20,240,198,0.08)",
                    border: "2px solid rgba(20,240,198,0.75)",
                    ...feelStyle(sendFeel),
                  }))}
                >
                  SEND TOKENS
                </button>
              </div>

              {friendNote && (
                <div style={{ fontSize: 6, color: "#FFD700", lineHeight: 1.6 }}>
                  {friendNote}
                </div>
              )}

              <div style={chamferBox(10, {
                background: "rgba(255,255,255,0.03)",
                border: "2px solid rgba(20,240,198,0.35)",
                padding: "10px 12px 12px",
                display: "flex", flexDirection: "column", gap: 8,
              })}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <SwordsIcon size={28} />
                  <span style={{ fontSize: 9, color: "#cfe6ff", letterSpacing: 1 }}>FRIENDLY DUEL</span>
                </div>
                <div style={{ fontSize: 7, color: "#8fa0d0", lineHeight: 1.7 }}>
                  {flags.duels
                    ? "A friendly Sol Mechs duel, 3v3. Nothing is at stake and no rating moves."
                    : "Duels are off right now."}
                </div>
                {flags.duels && (
                  <button
                    onClick={() => {
                      track("duel", "invite", { value: 1, label: "challenged a player" });
                      window.dispatchEvent(new CustomEvent(DUEL_INVITE_EVENT, {
                        detail: { kind: "challenge", opponent: wallet, name: displayName || player?.displayName },
                      }));
                      onClose();
                    }}
                    {...battleFeel.handlers}
                    style={chamferBox(8, cta({
                      color: "#04140c", background: "#B7E928", border: "none",
                      fontWeight: 700,
                      ...feelStyle(battleFeel),
                    }))}
                  >
                    MECH BATTLE
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Two crossed swords, drawn on a pixel grid (there is no such sprite in the build). */
function SwordsIcon({ size = 28 }: { size?: number }) {
  const px: Array<[number, number, string]> = [];
  const sword = (flip: boolean) => {
    const X = (x: number) => (flip ? 15 - x : x);
    for (let t = 4; t <= 13; t++) {
      px.push([X(t), 14 - t, "#bfeeff"]);          // blade
      if (t < 13) px.push([X(t + 1), 14 - t, "#4aa8d8"]); // its shaded edge
    }
    px.push([X(2), 10, "#e0a030"], [X(3), 11, "#e0a030"], [X(4), 12, "#e0a030"]); // guard
    px.push([X(2), 12, "#9a5a20"], [X(1), 13, "#9a5a20"]);                         // grip
    px.push([X(0), 14, "#e0a030"], [X(1), 14, "#e0a030"]);                         // pommel
  };
  sword(true);
  sword(false);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" style={{ display: "block", flexShrink: 0 }}>
      {px.map(([x, y, fill], i) => <rect key={i} x={x} y={y} width={1} height={1} fill={fill} />)}
    </svg>
  );
}

function Stat({ label, value, color, hint }: {
  label: string; value: number; color: string; hint?: string;
}) {
  return (
    <div style={chamferBox(8, {
      flex: 1, minWidth: 0,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(20,240,198,0.3)",
      padding: "9px 12px 10px",
    })}>
      <div style={{ fontSize: 8, color: "#aab6e8" }}>{label}</div>
      <div style={{ fontSize: 16, color, marginTop: 8 }}>{value}</div>
      {hint && <div style={{ fontSize: 6, color: "#6f7fb0", marginTop: 4 }}>{hint}</div>}
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
