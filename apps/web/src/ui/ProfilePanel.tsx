"use client";

import { AchievementIcon, LockIcon, SpeakerIcon, MusicIcon, PixelImg, ICON, CloseButton } from "@/ui/PixelIcons";
import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { PlayerProfile } from "@/game/config/profileManager";
import type { ProfileManager } from "@/game/config/profileManager";
import {
  TIER_COLORS, TRACKS, levelName, trackProgress,
} from "@/game/progression/achievementRegistry";
import { fetchBoard } from "@/game/leaderboards/boards";
import { DAILY_QUESTS, claimQuest, getQuestProgress, onQuestsChanged } from "@/game/quests/QuestManager";
import { OPEN_CALENDAR_EVENT, STREAK_EVENT, CHECKIN_STALLED_EVENT, type StreakView } from "@/game/daily/calendarEvents";
import { soundManager } from "@/game/audio/SoundManager";
import { musicManager } from "@/game/audio/MusicManager";
import { dmsOffPref, setDmsOffPref } from "@/game/chat/dmEvents";
import { chamferBox, octagonFrame, octagonFrameThin } from "@/ui/chamfer";
import { AvatarPortrait, useLiveLoadout } from "@/ui/AvatarPortrait";
import { KeysRows } from "@/ui/KeysCard";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";
import { PublicKey } from "@solana/web3.js";
import { useNickname } from "@/ui/useNicknames";
import type { OnChainMultiplayer } from "@/game/multiplayer/OnChainMultiplayer";
import {
  listFriends, listInboundRequests, listOutboundRequests,
} from "@/game/social/friends";
import { runFriendAction, type FriendAction } from "@/game/social/friendActions";
import type { FriendRequest } from "@/game/solana/program";

const PIXEL = '"Press Start 2P", monospace';
const CYAN = "#14F0C6";
const GREEN = "#B7E928";
const MUTED = "#7f88a8";

type PanelTab = "profile" | "achievements" | "friends" | "keys" | "settings";
const TABS: PanelTab[] = ["profile", "achievements", "friends", "keys", "settings"];
import { useViewportBox, overlayBox } from "@/ui/useViewportBox";

interface ProfilePanelProps {
  gameRef: Phaser.Game | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function ProfilePanel({ gameRef, isOpen, onClose }: ProfilePanelProps) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("profile");
  const myLoadout = useLiveLoadout(gameRef);
  const [copied, setCopied] = useState(false);
  const viewport = useViewportBox();
  const { connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();

  useEffect(() => {
    if (!gameRef) return;
    const check = setInterval(() => {
      const scene = gameRef.scene.getScene("CityScene");
      if (scene) {
        const pm = scene.registry.get("profileManager") as ProfileManager | undefined;
        if (pm) {
          setProfile(pm.get());
          pm.onChange((p) => setProfile({ ...p }));
          clearInterval(check);
        }
      }
    }, 200);
    return () => clearInterval(check);
  }, [gameRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen || !profile) return null;

  const wallet = connected ? profile.wallet : null;
  const copyWallet = () => {
    if (!wallet) return;
    navigator.clipboard?.writeText(wallet)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
      .catch(() => {});
  };

  return (
    <div className="z-50 flex items-center justify-center" style={overlayBox(viewport)}>
      <div
        className="absolute inset-0"
        style={{ background: "rgba(6,10,20,0.6)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full mx-4"
        style={{
          ...octagonFrame(1),
          maxWidth: 760,
          background: "rgba(8,10,30,0.98)",
          padding: "12px 14px 8px",
          fontFamily: PIXEL,
          // dvh falls back to vh; on landscape phones dvh tracks the actual
          // viewport height after browser chrome collapses, giving ~10% more room.
          maxHeight: "min(100%, 640px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <CloseButton
          onClick={onClose}
          size={26}
          style={{
            position: "absolute", top: 10, right: 12,
            minWidth: 36, minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
          }}
        />

        {/* Header: avatar + name, wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", paddingRight: 40 }}>
          {/* The player's own character, wearing what they have on right
              now. Changing it is the wardrobe's job, so this is a picture and
              not a button. */}
          <AvatarPortrait loadout={myLoadout} size={88} frame={2} />

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
              {profile.displayName}
            </div>
            {connected ? (
              <NicknameButton />
            ) : (
              <div style={{ fontSize: 7, color: MUTED, marginTop: 8, lineHeight: 1.6 }}>
                connect a wallet to pick a nickname
              </div>
            )}
          </div>

          {wallet && (
            <>
              <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.08)", margin: "0 8px" }} />
              <div>
                <div style={{ fontSize: 8, color: MUTED }}>WALLET</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: CYAN }}>{wallet.slice(0, 4)}…{wallet.slice(-4)}</span>
                  <CopyWalletButton onClick={copyWallet} copied={copied} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, paddingBottom: 0, borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
          {TABS.map((tab) => (
            <TabButton key={tab} active={panelTab === tab} onClick={() => setPanelTab(tab)}>{tab}</TabButton>
          ))}
        </div>

        <div style={{ marginTop: 14 }}>
          {panelTab === "profile" && (
            <ProfileTab profile={profile} wallet={wallet} onConnect={() => openWalletModal(true)} />
          )}
          {panelTab === "achievements" && <AchievementsTab profile={profile} />}
          {panelTab === "friends" && <FriendsTab gameRef={gameRef} />}
          {panelTab === "keys" && <KeysTab />}
          {panelTab === "settings" && <SettingsTab />}
        </div>

        {/* Member info */}
        <div style={{
          display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap",
          marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)",
          fontSize: 8, color: MUTED,
        }}>
          <span>Member since {new Date(profile.joinedAt).toLocaleDateString()}</span>
          <span style={{ opacity: 0.4 }}>|</span>
          <span>Last active {new Date(profile.lastActive).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      ...octagonFrameThin(),
      background: "rgba(255,255,255,0.03)",
      padding: 14, ...style,
    }}>
      {children}
    </div>
  );
}

function Num({ label, value, color, icon }: { label: string; value: number; color: string; icon?: string }) {
  return (
    <Card style={{ padding: "14px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 20, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 8, color: "#cbd5e1", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
        {icon && <img src={icon} alt="" draggable={false} style={{ height: 16, width: "auto", imageRendering: "pixelated" }} />}
        {label}
      </div>
    </Card>
  );
}

function NicknameButton() {
  const feel = useButtonFeel();
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("solcity:open-nickname"))}
      {...feel.handlers}
      style={chamferBox(6, {
        marginTop: 8, background: "rgba(20,240,198,0.1)", border: "1px solid rgba(20,240,198,0.6)",
        color: CYAN, padding: "7px 12px", cursor: "pointer", fontFamily: PIXEL, fontSize: 8,
        ...feelStyle(feel),
      })}
    >
      CHANGE NICKNAME
    </button>
  );
}

function CopyWalletButton({ onClick, copied }: { onClick: () => void; copied: boolean }) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      {...feel.handlers}
      style={chamferBox(6, {
        background: "none", border: "1px solid rgba(20,240,198,0.6)", color: CYAN,
        padding: "6px 10px", cursor: "pointer", fontFamily: PIXEL, fontSize: 8,
        ...feelStyle(feel),
      })}
    >
      {copied ? "COPIED" : "COPY"}
    </button>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      className="cursor-pointer"
      {...feel.handlers}
      style={chamferBox(6, {
        background: active ? "rgba(20,240,198,0.08)" : "rgba(255,255,255,0.02)",
        border: `2px solid ${active ? CYAN : "#2b3358"}`,
        color: active ? CYAN : MUTED,
        fontFamily: PIXEL, fontSize: 10, padding: "8px 16px",
        marginBottom: 6, textTransform: "uppercase",
        ...feelStyle(feel),
      })}
    >
      {children}
    </button>
  );
}

function ConnectWalletButton({ onConnect }: { onConnect: () => void }) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onConnect}
      className="w-full cursor-pointer"
      {...feel.handlers}
      style={chamferBox(8, {
        background: "#B7E928", color: "#0a0a14", border: "none", padding: "12px 12px",
        fontFamily: PIXEL, fontSize: 8, ...feelStyle(feel),
      })}
    >
      CONNECT WALLET
    </button>
  );
}

function CalendarOpenButton() {
  const feel = useButtonFeel();
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(OPEN_CALENDAR_EVENT))}
      {...feel.handlers}
      style={chamferBox(6, {
        background: "rgba(183,233,40,0.1)", border: "1px solid rgba(183,233,40,0.7)",
        color: GREEN, padding: "8px 10px", cursor: "pointer", fontFamily: PIXEL, fontSize: 8,
        ...feelStyle(feel),
      })}
    >
      CALENDAR
    </button>
  );
}

function ClaimButton({ onClick, label }: { onClick: () => void; label: string }) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      {...feel.handlers}
      style={chamferBox(5, {
        background: GREEN, color: "#0a0a14", border: "none", padding: "6px 8px",
        cursor: "pointer", fontFamily: PIXEL, fontSize: 7, flexShrink: 0,
        ...feelStyle(feel),
      })}
    >
      {label}
    </button>
  );
}

// ── Profile tab: you in the city ────────────────────────────────────────────

function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Your own progress: the daily streak and your numbers on the left, what is
 * left to do today on the right. The city at large (calendar, leaders, who is
 * online) lives in the calendar panel.
 */
function ProfileTab({ profile, wallet, onConnect }: {
  profile: PlayerProfile;
  wallet: string | null;
  onConnect: () => void;
}) {
  const [streak, setStreak] = useState<StreakView | null>(null);
  /** The check-in stopped trying. The strip said "CHECKING IN..." either way
   *  before, which is how a broken check-in went unseen for eight days. */
  const [checkinStalled, setCheckinStalled] = useState(false);
  const [mine, setMine] = useState({ finds: 0, kite: 0, quest: 0 });
  const [, bump] = useState(0);

  useEffect(() => {
    if (!wallet) { setStreak(null); return; }
    let cancelled = false;
    fetch(`/api/checkin?wallet=${wallet}`)
      .then((r) => r.json())
      .then((b) => { if (!cancelled && b.streak) setStreak(b.streak); })
      .catch(() => undefined);
    const onStreak = (e: Event) => {
      setStreak((e as CustomEvent<StreakView>).detail);
      setCheckinStalled(false);
    };
    const onStalled = () => setCheckinStalled(true);
    window.addEventListener(STREAK_EVENT, onStreak);
    window.addEventListener(CHECKIN_STALLED_EVENT, onStalled);
    return () => {
      cancelled = true;
      window.removeEventListener(STREAK_EVENT, onStreak);
      window.removeEventListener(CHECKIN_STALLED_EVENT, onStalled);
    };
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    Promise.all([
      fetchBoard("hunt", { wallet, limit: 1 }),
      fetchBoard("game:kite-clash", { wallet, limit: 1 }),
      fetchBoard("quests", { wallet, limit: 1 }),
    ]).then(([hunt, kite, quest]) => {
      if (!cancelled) setMine({ finds: hunt.mine?.value ?? 0, kite: kite.mine?.value ?? 0, quest: quest.mine?.value ?? 0 });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [wallet]);

  useEffect(() => onQuestsChanged(() => bump((n) => n + 1)), []);

  if (!wallet) {
    return (
      <Card>
        <div style={{ fontSize: 8, color: "#94a3b8", lineHeight: 1.8, marginBottom: 12 }}>
          Connect a wallet to keep a daily streak, track your numbers and claim quests.
        </div>
        <ConnectWalletButton onConnect={onConnect} />
      </Card>
    );
  }

  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    days.push(utcDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i))));
  }
  const checked = new Set(streak?.recent ?? []);
  const progress = getQuestProgress(wallet);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14, alignItems: "start" }}>
      {/* ── Left: streak + numbers ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 30, color: GREEN, lineHeight: 1 }}>{streak?.current ?? 0}</span>
            <span style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.6, flex: 1 }}>DAY<br />STREAK</span>
            <CalendarOpenButton />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
            {days.map((d) => {
              const on = checked.has(d);
              const isToday = d === utcDay();
              return (
                <div key={d} style={{
                  flex: 1, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
                  background: on ? GREEN : "#161b3a",
                  boxShadow: isToday ? `0 0 0 1px ${on ? "#fff" : "#64748b"}` : "none",
                  fontFamily: PIXEL, fontSize: 9, color: on ? "#0a0a14" : MUTED,
                }}>
                  {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12, fontSize: 8, color: MUTED }}>
            <span>BEST {Math.max(streak?.best ?? 0, profile.streakBest ?? 0)}</span>
            <span>{
              streak?.checkedInToday ? "COME BACK TOMORROW"
                : checkinStalled ? "CHECK-IN DID NOT GO THROUGH"
                : "CHECKING IN..."
            }</span>
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <Num label="SCORE" value={profile.score} color={GREEN} />
          <Num label="SWAPS" value={profile.swapCount} color={CYAN} />
          <Num label="TRANSFERS" value={profile.transferCount} color={CYAN} />
          <Num label="FINDS" value={mine.finds} color="#c084fc" />
          <Num label="BEST KITE" value={mine.kite} color="#FFA94D" icon="/assets/minigames/kite/kites/kite_stb.png" />
          <Num label="QUEST PTS" value={mine.quest} color={CYAN} />
        </div>
      </div>

      {/* ── Right: today's quests ── */}
      <Card style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <PixelImg src={ICON.tasks} size={24} />
          <span style={{ fontSize: 11, color: "#fff" }}>TODAY&apos;S QUESTS</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {DAILY_QUESTS.map((q) => {
            const p = progress[q.id];
            const current = Math.min(p?.current ?? 0, q.target);
            const done = !!p?.completed;
            const claimed = !!p?.claimedAt;
            return (
              <Card key={q.id} style={{ padding: "12px 12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: claimed ? "#475569" : done ? GREEN : "#e2e8f0" }}>{q.title}</span>
                  {done && !claimed ? (
                    <ClaimButton onClick={() => { claimQuest(wallet, q.id); bump((n) => n + 1); }} label={`CLAIM ${q.rewardLabel.toUpperCase()}`} />
                  ) : (
                    <span style={{ fontSize: 9, color: claimed ? "#475569" : "#94a3b8", flexShrink: 0 }}>
                      {claimed ? "CLAIMED" : `${current}/${q.target}`}
                    </span>
                  )}
                </div>
                <div style={{ height: 12, background: "#171d42", marginTop: 12, overflow: "hidden" }}>
                  <div style={{ width: `${(current / q.target) * 100}%`, height: "100%", background: done ? GREEN : CYAN }} />
                </div>
              </Card>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Achievements tab ────────────────────────────────────────────────────────

/**
 * One row per thing you can do, with the level reached and a bar to the next
 * rung.
 *
 * The old board was one card per number: "Good Dog", "Dog Person" and "Best
 * Friend" sat as three separate rows, two of them greyed out, and none of them
 * said how close the next was. A player could not tell a locked achievement
 * they were one pet away from one they would never reach. The bar is the whole
 * point: it turns a list of things you have not done into a list of things you
 * are partway through.
 */
function AchievementsTab({ profile }: { profile: PlayerProfile }) {
  const rows = TRACKS.map((track) => ({ track, p: trackProgress(track, profile) }));
  const levels = rows.reduce((n, r) => n + r.p.level, 0);
  const total = TRACKS.reduce((n, t) => n + t.levels.length, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <PixelImg src={ICON.trophy} size={20} />
        <span style={{ fontSize: 10, color: "#fff", flex: 1 }}>ACHIEVEMENTS</span>
        <span style={{ fontSize: 9, color: MUTED }}>{levels}/{total}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 10 }}>
        {rows.map(({ track, p }) => (
          <TrackCard key={track.id} track={track} progress={p} />
        ))}
      </div>
    </div>
  );
}

function TrackCard({ track, progress }: {
  track: (typeof TRACKS)[number];
  progress: ReturnType<typeof trackProgress>;
}) {
  const { level, value, next, fraction } = progress;
  const started = level > 0;
  const color = TIER_COLORS[progress.tier];
  const done = next === null;

  return (
    <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, opacity: started ? 1 : 0.7 }}>
      <span style={{ position: "relative", lineHeight: 0, flexShrink: 0, filter: started ? "none" : "grayscale(1)" }}>
        <AchievementIcon id={track.art ?? track.id} size={28} />
        {!started && <span style={{ position: "absolute", right: -4, bottom: -4 }}><LockIcon size={12} /></span>}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 9, color: started ? color : "#94a3b8", flex: 1, minWidth: 0 }}>
            {started ? levelName(track, level) : track.title}
          </span>
          {/* The level is the headline number, so it reads before the bar. */}
          <span style={{ fontSize: 7, color: started ? color : MUTED, flexShrink: 0 }}>
            {done ? "MAX" : `LV ${level}`}
          </span>
        </div>

        {/* The bar. Full and in tier colour when the ladder is finished, so a
            maxed track reads as an achievement rather than a stalled one. */}
        <div style={{
          height: 6, marginTop: 7,
          background: "rgba(255,255,255,0.07)",
          ...chamferBox(3, {}),
        }}>
          <div style={{
            width: `${Math.round(fraction * 100)}%`, height: "100%",
            background: color,
            transition: "width 0.3s",
          }} />
        </div>

        <div style={{ fontSize: 7, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>
          {done
            ? `${track.title}: every level`
            : `${value} / ${next.at}${track.unit ? ` ${track.unit}` : ""}`}
        </div>
      </div>
    </Card>
  );
}

// ── Friends tab ──────────────────────────────────────────────────────────────

/**
 * Who you are friends with, and who is in the city right now.
 *
 * Online costs nothing to know: the city is already polling every citizen's
 * state, so a friend being present is just whether the multiplayer roster has
 * them. No request of its own, no server.
 *
 * The lists themselves are two chain queries, made when this tab opens and
 * cached after that. Invites are the part worth noticing: one waits on-chain
 * indefinitely, so an invite sent while you were away is simply here when you
 * arrive.
 */
function FriendsTab({ gameRef }: { gameRef: Phaser.Game | null }) {
  const { publicKey, signTransaction } = useWallet();
  const me = publicKey?.toBase58() ?? null;

  const [friends, setFriends] = useState<string[] | null>(null);
  const [inbound, setInbound] = useState<FriendRequest[]>([]);
  const [outbound, setOutbound] = useState<FriendRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());

  const load = useCallback(async (force = false) => {
    if (!publicKey) return;
    try {
      const [f, i, o] = await Promise.all([
        listFriends(publicKey, force),
        listInboundRequests(publicKey, force),
        listOutboundRequests(publicKey, force),
      ]);
      setFriends(f); setInbound(i); setOutbound(o);
    } catch {
      setFriends([]);
      setNote("Could not read the friend list right now.");
    }
  }, [publicKey]);

  useEffect(() => { void load(); }, [load]);

  // Who is in the city, straight off the roster the game already keeps.
  useEffect(() => {
    const read = () => {
      const scene = gameRef?.scene?.getScene("CityScene");
      const net = scene?.registry?.get("network") as OnChainMultiplayer | undefined;
      setOnline(new Set((net?.getActivePlayers() ?? []).map((p) => p.wallet)));
    };
    read();
    const id = setInterval(read, 3_000);
    return () => clearInterval(id);
  }, [gameRef]);

  const act = async (action: FriendAction, other: string) => {
    if (!publicKey || !signTransaction) return;
    setBusy(other); setNote(null);
    const res = await runFriendAction(action, publicKey, new PublicKey(other), signTransaction);
    setBusy(null);
    if (res.ok) await load(true);
    else setNote(res.message);
  };

  if (!me) {
    return (
      <Card>
        <div style={{ fontSize: 8, color: MUTED, lineHeight: 1.8 }}>
          Connect a wallet to add friends.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {note && <div style={{ fontSize: 7, color: "#FFD700", lineHeight: 1.6 }}>{note}</div>}

      {inbound.length > 0 && (
        <div>
          <SectionTitle icon={ICON.chat} label="INVITES" count={inbound.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {inbound.map((r) => {
              const who = r.from.toBase58();
              return (
                <FriendRow key={who} wallet={who} online={online.has(who)}>
                  <RowButton label="ACCEPT" color={GREEN} busy={busy === who}
                    onClick={() => void act("accept", who)} />
                  <RowButton label="NO" color={MUTED} busy={busy === who}
                    onClick={() => void act("decline", who)} />
                </FriendRow>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <SectionTitle icon="/assets/ui/icon_friends.png" label="FRIENDS" count={friends?.length ?? 0} />
        {friends === null ? (
          <Card><div style={{ fontSize: 8, color: MUTED }}>Reading the chain...</div></Card>
        ) : friends.length === 0 ? (
          <Card>
            <div style={{ fontSize: 8, color: MUTED, lineHeight: 1.8 }}>
              Click a player in the city to add them.
            </div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* In the city first: a friend who is here right now is the one you
                might actually do something with. */}
            {[...friends]
              .sort((a, b) => Number(online.has(b)) - Number(online.has(a)))
              .map((w) => (
                <FriendRow key={w} wallet={w} online={online.has(w)}>
                  <RowButton label="REMOVE" color={MUTED} busy={busy === w}
                    onClick={() => void act("remove", w)} />
                </FriendRow>
              ))}
          </div>
        )}
      </div>

      {outbound.length > 0 && (
        <div>
          <SectionTitle icon={ICON.chat} label="SENT" count={outbound.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {outbound.map((r) => {
              const who = r.to.toBase58();
              return (
                <FriendRow key={who} wallet={who} online={online.has(who)}>
                  <RowButton label="CANCEL" color={MUTED} busy={busy === who}
                    onClick={() => void act("cancel", who)} />
                </FriendRow>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon, label, count }: { icon: string; label: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <PixelImg src={icon} size={16} />
      <span style={{ fontSize: 9, color: "#fff", flex: 1 }}>{label}</span>
      <span style={{ fontSize: 8, color: MUTED }}>{count}</span>
    </div>
  );
}

/** One friend or invite: who they are, whether they are here, what you can do. */
function FriendRow({ wallet, online, children }: {
  wallet: string; online: boolean; children: React.ReactNode;
}) {
  const nickname = useNickname(wallet);
  const short = `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  return (
    <Card style={{ display: "flex", alignItems: "center", gap: 10, padding: 10 }}>
      {/* A dot, not the word "online". It is the only thing on this row that
          changes on its own, so it should be the thing the eye finds. */}
      <span style={{
        width: 8, height: 8, flexShrink: 0,
        background: online ? GREEN : "rgba(255,255,255,0.14)",
        boxShadow: online ? `0 0 6px ${GREEN}` : "none",
      }} />
      <span style={{ fontSize: 8, color: online ? "#fff" : "#94a3b8", flex: 1, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {nickname || short}
      </span>
      {children}
    </Card>
  );
}

function RowButton({ label, color, busy, onClick }: {
  label: string; color: string; busy: boolean; onClick: () => void;
}) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick}
      disabled={busy}
      {...feel.handlers}
      style={chamferBox(5, {
        fontFamily: PIXEL, fontSize: 6, letterSpacing: 0.5,
        color, background: "rgba(255,255,255,0.04)",
        border: `1px solid ${color}55`,
        padding: "6px 8px", cursor: busy ? "default" : "pointer",
        flexShrink: 0, opacity: busy ? 0.5 : 1,
        ...feelStyle(feel),
      })}
    >
      {busy ? "..." : label}
    </button>
  );
}

// ── Keys tab ─────────────────────────────────────────────────────────────────

function KeysTab() {
  return (
    <Card>
      <KeysRows />
    </Card>
  );
}

// ── Settings tab ────────────────────────────────────────────────────────────

/**
 * One volume line: an icon that doubles as the mute toggle, a slider, a
 * readout. Effects and music are independent (different managers, different
 * saved keys), so the row takes them as props rather than reaching for one.
 */
function VolumeRow({ label, icon, volume, muted, onVolume, onToggleMute, preview }: {
  label: string;
  icon: (muted: boolean, color: string) => React.ReactNode;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  preview?: () => void;
}) {
  const muteFeel = useButtonFeel();
  const pct = Math.round((muted ? 0 : volume) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontSize: 8, color: "#aaaacc" }}>{label}</span>
        <button
          onClick={onToggleMute}
          title={muted ? "Unmute" : "Mute"}
          {...muteFeel.handlers}
          style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 0, padding: 0, ...feelStyle(muteFeel) }}
        >
          {icon(muted, muted ? "#666677" : "#B7E928")}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => onVolume(parseInt(e.target.value, 10) / 100)}
          // Play a preview tick on release so the level is audible immediately.
          onMouseUp={preview}
          onTouchEnd={preview}
          className="pixel-range"
          style={{ flex: 1, cursor: "pointer", ["--p" as string]: `${pct}%` }}
        />
        <span style={{ fontSize: 8, color: "#888899", width: 34, textAlign: "right", fontFamily: "monospace" }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

function SettingsTab() {
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0);
  const [musicMuted, setMusicMuted] = useState(false);
  const [track, setTrack] = useState<string | null>(null);
  const [dmsOff, setDmsOff] = useState(false);
  useEffect(() => {
    setVolume(soundManager.getVolume());
    setMuted(soundManager.isMuted());
    setMusicVolume(musicManager.getVolume());
    setMusicMuted(musicManager.isMuted());
    setDmsOff(dmsOffPref());
    // The rotation moves on its own, so follow it instead of snapshotting.
    const sync = () => {
      setMusicMuted(musicManager.isMuted());
      setTrack(musicManager.nowPlaying()?.title ?? null);
    };
    sync();
    return musicManager.subscribe(sync);
  }, []);

  const onVolume = (v: number) => {
    setVolume(v);
    soundManager.setVolume(v);
    setMuted(soundManager.isMuted()); // setVolume clears mute when raised off 0
  };

  const onMusicVolume = (v: number) => {
    setMusicVolume(v);
    musicManager.setVolume(v);
    setMusicMuted(musicManager.isMuted());
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14, alignItems: "start" }}>
      <div>
        <div style={{ fontSize: 9, color: "#cbd5e1", marginBottom: 10 }}>SOUND</div>
        <Card>
          <VolumeRow
            label="Effects"
            icon={(m, c) => <SpeakerIcon size={18} muted={m} color={c} />}
            volume={volume}
            muted={muted}
            onVolume={onVolume}
            onToggleMute={() => { const m = soundManager.toggleMuted(); setMuted(m); }}
            preview={() => soundManager.play("click")}
          />
          <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "14px 0" }} />
          <VolumeRow
            label="Music"
            icon={(m, c) => <MusicIcon size={18} muted={m} color={c} />}
            volume={musicVolume}
            muted={musicMuted}
            onVolume={onMusicVolume}
            onToggleMute={() => { const m = musicManager.toggleMuted(); setMusicMuted(m); }}
          />
          <div style={{ color: track ? "#7c6fb0" : "#5f6788", lineHeight: 1.6, fontSize: 7, marginTop: 10, minHeight: 11 }}>
            {track ?? "Music off"}
          </div>
          <div style={{ color: "#5f6788", lineHeight: 1.6, fontSize: 7, marginTop: 10 }}>
            Saved on this device.
          </div>
        </Card>
      </div>

      <div>
        <div style={{ fontSize: 9, color: "#cbd5e1", marginBottom: 10 }}>CHAT</div>
        <label style={{ cursor: "pointer", display: "block" }}>
          <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              type="checkbox"
              checked={dmsOff}
              onChange={(e) => { setDmsOff(e.target.checked); setDmsOffPref(e.target.checked); }}
              style={{ accentColor: GREEN, width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
            />
            <span style={{ fontSize: 8, color: "#aaaacc", lineHeight: 1.6 }}>
              Turn off direct messages
              <span style={{ display: "block", color: "#5f6788", fontSize: 7, marginTop: 4 }}>
                Nobody can send you a DM while this is on.
              </span>
            </span>
          </Card>
        </label>
      </div>
    </div>
  );
}
