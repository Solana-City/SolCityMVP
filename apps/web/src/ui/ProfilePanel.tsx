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

interface ProfilePanelProps {
  gameRef: Phaser.Game | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function ProfilePanel({ gameRef, isOpen, onClose }: ProfilePanelProps) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [manager, setManager] = useState<ProfileManager | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [panelTab, setPanelTab] = useState<"profile" | "settings">("profile");
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const saveName = useCallback(() => {
    if (manager && nameInput.trim()) {
      manager.setDisplayName(nameInput.trim());
    }
    setEditingName(false);
  }, [manager, nameInput]);

  const selectOutfit = useCallback(
    (outfitId: string) => {
      if (!manager || !gameRef) return;
      manager.setOutfit(outfitId);
      gameRef.events.emit("profile:outfit", outfitId);
    },
    [manager, gameRef]
  );

  const handlePfpUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !manager) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        manager.setPfp(dataUrl);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(6,10,20,0.6)" }}
        onClick={onClose}
      />
      <div
        className="relative rounded-2xl p-4 sm:p-6 w-full max-w-md mx-4"
        style={{
          background: "rgba(10,10,30,0.97)",
          border: "1px solid rgba(153,69,255,0.25)",
          fontFamily: '"Press Start 2P", monospace',
          // dvh falls back to vh; on landscape phones dvh tracks the actual
          // viewport height after browser chrome collapses, giving ~10% more room.
          maxHeight: "min(92dvh, 640px)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 cursor-pointer"
          style={{
            background: "none",
            border: "none",
            color: "#555566",
            fontSize: "15px",
            // Ensure 44×44px touch target on mobile
            minWidth: 44,
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
          }}
          aria-label="Close"
        >
          ×
        </button>

        {/* PFP + Name header */}
        <div className="flex items-center gap-4 mb-5">
          <div
            className="relative cursor-pointer group"
            onClick={() => fileInputRef.current?.click()}
          >
            {profile.pfp ? (
              <img
                src={profile.pfp}
                alt="PFP"
                className="rounded-full object-cover"
                style={{ width: 56, height: 56, border: "2px solid #9945FF" }}
              />
            ) : (
              <div
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 56,
                  height: 56,
                  background: "rgba(153,69,255,0.15)",
                  border: "2px solid #9945FF",
                  color: "#9945FF",
                  fontSize: "15px",
                  fontWeight: "bold",
                }}
              >
                {profile.displayName[0]?.toUpperCase()}
              </div>
            )}
            <div
              className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
              style={{ background: "rgba(0,0,0,0.6)", fontSize: "8px", color: "#fff" }}
            >
              edit
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePfpUpload}
            />
          </div>

          <div className="flex-1">
            {false ? (
              <div className="flex gap-1">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveName()}
                  maxLength={20}
                  autoFocus
                  className="flex-1 px-2 py-1 text-sm rounded outline-none"
                  style={{
                    background: "#12122a",
                    color: "#fff",
                    border: "1px solid rgba(153,69,255,0.2)",
                    fontFamily: "monospace",
                  }}
                />
                <button
                  onClick={saveName}
                  className="px-2 py-1 rounded text-xs cursor-pointer"
                  style={{ background: "#14F195", color: "#000", border: "none" }}
                >
                  ok
                </button>
              </div>
            ) : (
              <div>
                <div className="text-sm font-bold" style={{ color: "#fff" }}>
                  {profile.displayName}
                </div>
                {connected ? (
                  <button
                    onClick={() => window.dispatchEvent(new Event("solcity:open-nickname"))}
                    style={{
                      marginTop: 5, background: "rgba(20,241,149,0.1)", border: "1px solid rgba(20,241,149,0.4)",
                      color: "#14F195", borderRadius: 6, padding: "4px 8px", cursor: "pointer",
                      fontFamily: '"Press Start 2P", monospace', fontSize: 7,
                    }}
                  >
                    CHANGE NICKNAME
                  </button>
                ) : (
                  <div className="text-xs" style={{ color: "#555566", marginTop: 3 }}>
                    connect a wallet to pick a nickname
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Profile / Settings tab bar */}
        <div className="flex items-center gap-0 mb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {(["profile", "settings"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setPanelTab(tab)}
              className="px-3 py-1.5 cursor-pointer"
              style={{
                background: "none",
                border: "none",
                borderBottom: panelTab === tab ? "2px solid #9945FF" : "2px solid transparent",
                color: panelTab === tab ? "#c084fc" : "#555566",
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 8,
                marginBottom: -1,
                textTransform: "uppercase",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {panelTab === "settings" && <SettingsTab />}

        {panelTab === "profile" && (<>
        <ProfileTab
          profile={profile}
          wallet={connected ? profile.wallet : null}
          onConnect={() => openWalletModal(true)}
        />

        {/* Member info */}
        <div className="flex justify-between text-xs mt-2" style={{ color: "#333344" }}>
          <span>Member since {new Date(profile.joinedAt).toLocaleDateString()}</span>
          <span>Last active {new Date(profile.lastActive).toLocaleDateString()}</span>
        </div>
        </>)}
      </div>
    </div>
  );
}

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
    <div className="mb-2">
      <div className="text-xs mb-3" style={{ color: "#555566" }}>
        Sound
      </div>
      <div
        className="rounded-lg p-3"
        style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs" style={{ color: "#aaaacc" }}>Effects volume</span>
          <button
            onClick={() => { const m = soundManager.toggleMuted(); setMuted(m); }}
            title={muted ? "Unmute" : "Mute"}
            style={{
              background: "none", border: "none", cursor: "pointer",
              lineHeight: 0, padding: 0,
            }}
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
            style={{ flex: 1, accentColor: "#9945FF", cursor: "pointer" }}
          />
          <span className="text-xs" style={{ color: "#888899", width: 34, textAlign: "right", fontFamily: "monospace" }}>
            {Math.round((muted ? 0 : volume) * 100)}%
          </span>
        </div>
        <div className="text-xs mt-3" style={{ color: "#444455", lineHeight: 1.5, fontSize: 8 }}>
          All in-game effects: clicks, chimes, footsteps. Saved on this device.
        </div>
      </div>

      <div className="text-xs mb-3 mt-4" style={{ color: "#555566" }}>
        Chat
      </div>
      <label
        className="rounded-lg p-3 flex items-center gap-3"
        style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={dmsOff}
          onChange={(e) => { setDmsOff(e.target.checked); setDmsOffPref(e.target.checked); }}
          style={{ accentColor: "#9945FF", width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
        />
        <span className="text-xs" style={{ color: "#aaaacc", lineHeight: 1.6 }}>
          Turn off direct messages
          <span style={{ display: "block", color: "#444455", fontSize: 8 }}>
            Nobody can send you a DM while this is on.
          </span>
        </span>
      </label>
    </div>
  );
}

// ── Profile tab: you in the city ────────────────────────────────────────────

const PIXEL = '"Press Start 2P", monospace';
const GOLD = "#FFD700";
const GREEN = "#14F195";

function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Your own progress, most alive first: the daily streak, your numbers, what is
 * left to do today, and what you have unlocked. The city at large (calendar,
 * leaders, who is online) lives in the calendar panel.
 */
function ProfileTab({ profile, wallet, onConnect }: {
  profile: PlayerProfile;
  wallet: string | null;
  onConnect: () => void;
}) {
  const [streak, setStreak] = useState<StreakView | null>(null);
  const [mine, setMine] = useState({ finds: 0, kite: 0, quest: 0 });
  const [copied, setCopied] = useState(false);
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
      <div className="mb-4">
        <div style={{ fontSize: 8, color: "#94a3b8", lineHeight: 1.8, marginBottom: 10 }}>
          Connect a wallet to keep a daily streak, track your numbers and claim quests.
        </div>
        <button
          onClick={onConnect}
          className="w-full px-3 py-2 rounded cursor-pointer"
          style={{ background: "rgba(153,69,255,0.8)", color: "#fff", border: "none", fontFamily: PIXEL, fontSize: 7 }}
        >
          CONNECT WALLET
        </button>
      </div>
    );
  }

  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    days.push(utcDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i))));
  }
  const checked = new Set(streak?.recent ?? []);
  const progress = getQuestProgress(wallet);

  const copy = () => {
    navigator.clipboard?.writeText(wallet)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
      .catch(() => {});
  };

  return (
    <div className="mb-3">
      {/* ── Streak ── */}
      <Section>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22, color: GOLD, lineHeight: 1 }}>{streak?.current ?? 0}</span>
          <span style={{ fontSize: 7, color: "#94a3b8", lineHeight: 1.6, flex: 1 }}>DAY<br />STREAK</span>
          <button
            onClick={() => window.dispatchEvent(new Event(OPEN_CALENDAR_EVENT))}
            style={{
              background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.35)", borderRadius: 6,
              color: GOLD, padding: "5px 7px", cursor: "pointer", fontFamily: PIXEL, fontSize: 6,
            }}
          >
            CALENDAR
          </button>
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
          {days.map((d) => {
            const on = checked.has(d);
            const isToday = d === utcDay();
            return (
              <div key={d} style={{
                flex: 1, height: 20, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
                background: on ? GOLD : "#1e1e3a",
                boxShadow: isToday ? `0 0 0 1px ${on ? "#fff" : "#64748b"}` : "none",
                fontFamily: PIXEL, fontSize: 6, color: on ? "#0a0a14" : "#64748b",
              }}>
                {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 6, color: "#64748b" }}>
          <span>BEST {Math.max(streak?.best ?? 0, profile.streakBest ?? 0)}</span>
          <span>{streak?.checkedInToday ? "COME BACK TOMORROW" : "CHECKING IN..."}</span>
        </div>
      </Section>

      {/* ── Wallet, one line ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 12px" }}>
        <span style={{ fontSize: 6, color: "#555566" }}>WALLET</span>
        <span style={{ fontSize: 7, color: "#00D1FF", flex: 1 }}>{wallet.slice(0, 4)}…{wallet.slice(-4)}</span>
        <button
          onClick={copy}
          style={{
            background: "none", border: "1px solid rgba(0,209,255,0.35)", borderRadius: 5, color: "#00D1FF",
            padding: "3px 6px", cursor: "pointer", fontFamily: PIXEL, fontSize: 6,
          }}
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>

      {/* ── Your numbers: only ones that move ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
        <Num label="SCORE" value={profile.score} color={GOLD} />
        <Num label="SWAPS" value={profile.swapCount} color={GREEN} />
        <Num label="TRANSFERS" value={profile.transferCount} color="#00D1FF" />
        <Num label="FINDS" value={mine.finds} color="#c084fc" />
        <Num label="BEST KITE" value={mine.kite} color="#FFA94D" />
        <Num label="QUEST PTS" value={mine.quest} color={GREEN} />
      </div>

      {/* ── Today's quests ── */}
      <Label icon={ICON.tasks}>TODAY&apos;S QUESTS</Label>
      <Section>
        {DAILY_QUESTS.map((q) => {
          const p = progress[q.id];
          const current = Math.min(p?.current ?? 0, q.target);
          const done = !!p?.completed;
          const claimed = !!p?.claimedAt;
          return (
            <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, margin: "3px 0" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 7, color: claimed ? "#475569" : done ? GREEN : "#cbd5e1" }}>{q.title}</div>
                <div style={{ height: 4, background: "#1e1e3a", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
                  <div style={{ width: `${(current / q.target) * 100}%`, height: "100%", background: done ? GREEN : "#9945FF" }} />
                </div>
              </div>
              {done && !claimed ? (
                <button
                  onClick={() => { claimQuest(wallet, q.id); bump((n) => n + 1); }}
                  style={{
                    background: GREEN, color: "#0a0a14", border: "none", borderRadius: 5, padding: "5px 7px",
                    cursor: "pointer", fontFamily: PIXEL, fontSize: 6, flexShrink: 0,
                  }}
                >
                  CLAIM {q.rewardLabel.toUpperCase()}
                </button>
              ) : (
                <span style={{ fontSize: 6, color: claimed ? "#475569" : "#64748b", flexShrink: 0, width: 56, textAlign: "right" }}>
                  {claimed ? "CLAIMED" : `${current}/${q.target}`}
                </span>
              )}
            </div>
          );
        })}
      </Section>

      {/* ── Achievements: a plain list ── */}
      <Label icon={ICON.trophy} right={`${profile.unlockedAchievements.length}/${ACHIEVEMENTS.length}`}>ACHIEVEMENTS</Label>
      <Section>
        {ACHIEVEMENTS.map((ach) => {
          const unlocked = profile.unlockedAchievements.includes(ach.id);
          const color = TIER_COLORS[ach.tier];
          return (
            <div key={ach.id} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0", opacity: unlocked ? 1 : 0.5 }}>
              <span style={{ position: "relative", lineHeight: 0, flexShrink: 0, filter: unlocked ? "none" : "grayscale(1)" }}>
                <AchievementIcon id={ach.id} size={20} />
                {!unlocked && <span style={{ position: "absolute", right: -4, bottom: -4 }}><LockIcon size={10} /></span>}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 7, color: unlocked ? color : "#94a3b8" }}>{ach.title}</div>
                <div style={{ fontSize: 7, color: "#555566", marginTop: 3 }}>{ach.description}</div>
              </div>
            </div>
          );
        })}
      </Section>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg" style={{
      background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", padding: 10, marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Label({ icon, right, children }: { icon: string; right?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
      <PixelImg src={icon} size={12} />
      <span style={{ fontSize: 7, color: "#94a3b8", flex: 1 }}>{children}</span>
      {right && <span style={{ fontSize: 7, color: "#555566" }}>{right}</span>}
    </div>
  );
}

function Num({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg" style={{
      background: "#12122a", border: "1px solid rgba(255,255,255,0.04)", padding: "8px 4px", textAlign: "center",
    }}>
      <div style={{ fontSize: 11, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 5, color: "#64748b", marginTop: 6 }}>{label}</div>
    </div>
  );
}
