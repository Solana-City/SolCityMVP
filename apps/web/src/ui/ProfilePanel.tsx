"use client";

import { AchievementIcon, LockIcon, SpeakerIcon, PixelImg, ICON } from "@/ui/PixelIcons";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { PlayerProfile } from "@/game/config/profileManager";
import type { ProfileManager } from "@/game/config/profileManager";
import { ACHIEVEMENTS, TIER_COLORS } from "@/game/progression/achievementRegistry";
import { fetchBoard } from "@/game/leaderboards/boards";
import { DAILY_QUESTS, claimQuest, getQuestProgress, onQuestsChanged } from "@/game/quests/QuestManager";
import { OPEN_CALENDAR_EVENT, STREAK_EVENT, type StreakView } from "@/game/daily/calendarEvents";
import { soundManager } from "@/game/audio/SoundManager";
import { dmsOffPref, setDmsOffPref } from "@/game/chat/dmEvents";
import { chamferBox, octagonFrame, avatarFrame, avatarPhoto } from "@/ui/chamfer";

const PIXEL = '"Press Start 2P", monospace';
const CYAN = "#14F0C6";
const GREEN = "#B7E928";
const PURPLE = "#9945FF";
const MUTED = "#7f88a8";

type PanelTab = "profile" | "achievements" | "settings";
const TABS: PanelTab[] = ["profile", "achievements", "settings"];
import { useViewportBox, overlayBox } from "@/ui/useViewportBox";

interface ProfilePanelProps {
  gameRef: Phaser.Game | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function ProfilePanel({ gameRef, isOpen, onClose }: ProfilePanelProps) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [manager, setManager] = useState<ProfileManager | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("profile");
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
          setManager(pm);
          setProfile(pm.get());
          pm.onChange((p) => setProfile({ ...p }));
          clearInterval(check);
        }
      }
    }, 200);
    return () => clearInterval(check);
  }, [gameRef]);

  const handlePfpUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !manager) return;
      const reader = new FileReader();
      reader.onload = () => {
        manager.setPfp(reader.result as string);
      };
      reader.readAsDataURL(file);
    },
    [manager]
  );

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
        <button
          onClick={onClose}
          className="absolute cursor-pointer"
          style={{
            top: 10, right: 12,
            background: "none", border: "none", color: CYAN, fontSize: 22, lineHeight: 1,
            minWidth: 36, minHeight: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
          }}
          aria-label="Close"
        >
          ×
        </button>

        {/* Header: avatar + name, wallet */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", paddingRight: 40 }}>
          <div
            className="relative cursor-pointer"
            style={{ flexShrink: 0 }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div style={{
              ...avatarFrame(2, 96),
              ...avatarPhoto(profile.pfp),
              display: "flex", alignItems: "center", justifyContent: "center",
              color: GREEN, fontSize: 22, position: "relative",
            }}>
              {!profile.pfp && profile.displayName[0]?.toUpperCase()}
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                style={{ background: "rgba(0,0,0,0.6)", fontSize: 8, color: "#fff" }}
              >
                edit
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePfpUpload} />
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
              {profile.displayName}
            </div>
            {connected ? (
              <button
                onClick={() => window.dispatchEvent(new Event("solcity:open-nickname"))}
                style={chamferBox(6, {
                  marginTop: 8, background: "rgba(20,240,198,0.1)", border: "1px solid rgba(20,240,198,0.6)",
                  color: CYAN, padding: "7px 12px", cursor: "pointer", fontFamily: PIXEL, fontSize: 8,
                })}
              >
                CHANGE NICKNAME
              </button>
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
                  <button
                    onClick={copyWallet}
                    style={chamferBox(6, {
                      background: "none", border: "1px solid rgba(20,240,198,0.6)", color: CYAN,
                      padding: "6px 10px", cursor: "pointer", fontFamily: PIXEL, fontSize: 8,
                    })}
                  >
                    {copied ? "COPIED" : "COPY"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, paddingBottom: 0, borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
          {TABS.map((tab) => {
            const active = panelTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setPanelTab(tab)}
                className="cursor-pointer"
                style={chamferBox(6, {
                  background: active ? "rgba(20,240,198,0.08)" : "rgba(255,255,255,0.02)",
                  border: `2px solid ${active ? CYAN : "#2b3358"}`,
                  color: active ? CYAN : MUTED,
                  fontFamily: PIXEL, fontSize: 10, padding: "8px 16px",
                  marginBottom: 6, textTransform: "uppercase",
                })}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 14 }}>
          {panelTab === "profile" && (
            <ProfileTab profile={profile} wallet={wallet} onConnect={() => openWalletModal(true)} />
          )}
          {panelTab === "achievements" && <AchievementsTab profile={profile} />}
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
    <div style={chamferBox(8, {
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
      padding: 14, ...style,
    })}>
      {children}
    </div>
  );
}

function Num({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={{ padding: "14px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 20, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 8, color: "#cbd5e1", marginTop: 10 }}>{label}</div>
    </Card>
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
  const [mine, setMine] = useState({ finds: 0, kite: 0, quest: 0 });
  const [, bump] = useState(0);

  useEffect(() => {
    if (!wallet) { setStreak(null); return; }
    let cancelled = false;
    fetch(`/api/checkin?wallet=${wallet}`)
      .then((r) => r.json())
      .then((b) => { if (!cancelled && b.streak) setStreak(b.streak); })
      .catch(() => undefined);
    const onStreak = (e: Event) => setStreak((e as CustomEvent<StreakView>).detail);
    window.addEventListener(STREAK_EVENT, onStreak);
    return () => { cancelled = true; window.removeEventListener(STREAK_EVENT, onStreak); };
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
        <button
          onClick={onConnect}
          className="w-full cursor-pointer"
          style={chamferBox(8, { background: "rgba(153,69,255,0.85)", color: "#fff", border: "none", padding: "12px 12px", fontFamily: PIXEL, fontSize: 8 })}
        >
          CONNECT WALLET
        </button>
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
            <button
              onClick={() => window.dispatchEvent(new Event(OPEN_CALENDAR_EVENT))}
              style={chamferBox(6, {
                background: "rgba(183,233,40,0.1)", border: "1px solid rgba(183,233,40,0.7)",
                color: GREEN, padding: "8px 10px", cursor: "pointer", fontFamily: PIXEL, fontSize: 8,
              })}
            >
              CALENDAR
            </button>
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
            <span>{streak?.checkedInToday ? "COME BACK TOMORROW" : "CHECKING IN..."}</span>
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <Num label="SCORE" value={profile.score} color={GREEN} />
          <Num label="SWAPS" value={profile.swapCount} color={CYAN} />
          <Num label="TRANSFERS" value={profile.transferCount} color={CYAN} />
          <Num label="FINDS" value={mine.finds} color="#c084fc" />
          <Num label="BEST KITE" value={mine.kite} color="#FFA94D" />
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
                    <button
                      onClick={() => { claimQuest(wallet, q.id); bump((n) => n + 1); }}
                      style={chamferBox(5, {
                        background: GREEN, color: "#0a0a14", border: "none", padding: "6px 8px",
                        cursor: "pointer", fontFamily: PIXEL, fontSize: 7, flexShrink: 0,
                      })}
                    >
                      CLAIM {q.rewardLabel.toUpperCase()}
                    </button>
                  ) : (
                    <span style={{ fontSize: 9, color: claimed ? "#475569" : "#94a3b8", flexShrink: 0 }}>
                      {claimed ? "CLAIMED" : `${current}/${q.target}`}
                    </span>
                  )}
                </div>
                <div style={{ height: 12, background: "#171d42", marginTop: 12, overflow: "hidden" }}>
                  <div style={{ width: `${(current / q.target) * 100}%`, height: "100%", background: done ? GREEN : PURPLE }} />
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

function AchievementsTab({ profile }: { profile: PlayerProfile }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <PixelImg src={ICON.trophy} size={20} />
        <span style={{ fontSize: 10, color: "#fff", flex: 1 }}>ACHIEVEMENTS</span>
        <span style={{ fontSize: 9, color: MUTED }}>{profile.unlockedAchievements.length}/{ACHIEVEMENTS.length}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 10 }}>
        {ACHIEVEMENTS.map((ach) => {
          const unlocked = profile.unlockedAchievements.includes(ach.id);
          const color = TIER_COLORS[ach.tier];
          return (
            <Card key={ach.id} style={{ display: "flex", alignItems: "center", gap: 12, opacity: unlocked ? 1 : 0.55, padding: 12 }}>
              <span style={{ position: "relative", lineHeight: 0, flexShrink: 0, filter: unlocked ? "none" : "grayscale(1)" }}>
                <AchievementIcon id={ach.id} size={28} />
                {!unlocked && <span style={{ position: "absolute", right: -4, bottom: -4 }}><LockIcon size={12} /></span>}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, color: unlocked ? color : "#94a3b8" }}>{ach.title}</div>
                <div style={{ fontSize: 7, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>{ach.description}</div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Settings tab ────────────────────────────────────────────────────────────

function SettingsTab() {
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [dmsOff, setDmsOff] = useState(false);
  useEffect(() => {
    setVolume(soundManager.getVolume());
    setMuted(soundManager.isMuted());
    setDmsOff(dmsOffPref());
  }, []);

  const onVolume = (v: number) => {
    setVolume(v);
    soundManager.setVolume(v);
    setMuted(soundManager.isMuted()); // setVolume clears mute when raised off 0
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 14, alignItems: "start" }}>
      <div>
        <div style={{ fontSize: 9, color: "#cbd5e1", marginBottom: 10 }}>SOUND</div>
        <Card>
          <div className="flex items-center justify-between mb-3">
            <span style={{ fontSize: 8, color: "#aaaacc" }}>Effects volume</span>
            <button
              onClick={() => { const m = soundManager.toggleMuted(); setMuted(m); }}
              title={muted ? "Unmute" : "Mute"}
              style={{ background: "none", border: "none", cursor: "pointer", lineHeight: 0, padding: 0 }}
            >
              <SpeakerIcon size={18} muted={muted} color={muted ? "#666677" : "#c084fc"} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((muted ? 0 : volume) * 100)}
              onChange={(e) => onVolume(parseInt(e.target.value, 10) / 100)}
              // Play a preview tick on release so the level is audible immediately.
              onMouseUp={() => soundManager.play("click")}
              onTouchEnd={() => soundManager.play("click")}
              style={{ flex: 1, accentColor: PURPLE, cursor: "pointer" }}
            />
            <span style={{ fontSize: 8, color: "#888899", width: 34, textAlign: "right", fontFamily: "monospace" }}>
              {Math.round((muted ? 0 : volume) * 100)}%
            </span>
          </div>
          <div style={{ color: "#5f6788", lineHeight: 1.6, fontSize: 7, marginTop: 12 }}>
            All in-game effects: clicks, chimes, footsteps. Saved on this device.
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
              style={{ accentColor: PURPLE, width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
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
