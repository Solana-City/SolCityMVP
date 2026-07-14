"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { PlayerProfile } from "@/game/config/profileManager";
import type { ProfileManager } from "@/game/config/profileManager";
import type { OnChainPlayer } from "@/game/multiplayer/OnChainMultiplayer";
import { ACHIEVEMENTS, TIER_COLORS } from "@/game/progression/achievementRegistry";
import { fetchLeaderboard, type LeaderboardEntry } from "@/game/solana/leaderboard";

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
  const [onlinePlayers, setOnlinePlayers] = useState<OnChainPlayer[]>([]);
  const [lbTab, setLbTab] = useState<"online" | "alltime">("online");
  const [allTimeEntries, setAllTimeEntries] = useState<LeaderboardEntry[]>([]);
  const [allTimeLoading, setAllTimeLoading] = useState(false);
  const [allTimeError, setAllTimeError] = useState<string | null>(null);
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

  // Poll online players from the multiplayer network every 2s
  useEffect(() => {
    if (!gameRef || !isOpen) return;
    const poll = setInterval(() => {
      const scene = gameRef.scene.getScene("CityScene");
      if (!scene) return;
      const net = scene.registry.get("network") as { getActivePlayers?: () => OnChainPlayer[] } | undefined;
      if (net?.getActivePlayers) setOnlinePlayers(net.getActivePlayers());
    }, 2000);
    // Initial fetch
    const scene = gameRef.scene.getScene("CityScene");
    const net = scene?.registry.get("network") as { getActivePlayers?: () => OnChainPlayer[] } | undefined;
    if (net?.getActivePlayers) setOnlinePlayers(net.getActivePlayers());
    return () => clearInterval(poll);
  }, [gameRef, isOpen]);

  // Fetch all-time leaderboard when the "All Time" tab is selected
  useEffect(() => {
    if (!isOpen || lbTab !== "alltime") return;
    let cancelled = false;
    setAllTimeLoading(true);
    setAllTimeError(null);
    fetchLeaderboard()
      .then((entries) => { if (!cancelled) setAllTimeEntries(entries); })
      .catch((err) => { if (!cancelled) setAllTimeError(err?.message ?? "Failed to load"); })
      .finally(() => { if (!cancelled) setAllTimeLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, lbTab]);

  const refreshAllTime = useCallback(() => {
    setAllTimeLoading(true);
    setAllTimeError(null);
    fetchLeaderboard(true)
      .then(setAllTimeEntries)
      .catch((err) => setAllTimeError(err?.message ?? "Failed to load"))
      .finally(() => setAllTimeLoading(false));
  }, []);

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
            {editingName ? (
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
              <div
                className="cursor-pointer"
                onClick={() => {
                  setNameInput(profile.displayName);
                  setEditingName(true);
                }}
              >
                <div className="text-sm font-bold" style={{ color: "#fff" }}>
                  {profile.displayName}
                </div>
                <div className="text-xs" style={{ color: "#555566" }}>
                  tap to edit name
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Wallet */}
        <div className="mb-4">
          <div className="text-xs mb-1" style={{ color: "#555566" }}>
            Wallet
          </div>
          {connected && profile.wallet ? (
            <div className="px-2 py-1.5 rounded" style={{ background: "#12122a" }}>
              <span style={{ color: "#00D1FF", fontSize: "9px" }}>
                {profile.wallet}
              </span>
            </div>
          ) : (
            <button
              onClick={() => openWalletModal(true)}
              className="w-full px-3 py-2 rounded text-xs cursor-pointer"
              style={{
                background: "rgba(153,69,255,0.8)",
                color: "#fff",
                border: "none",
                fontFamily: '"Press Start 2P", monospace',
                fontSize: "7px",
              }}
            >
              CONNECT WALLET
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <StatCard label="Score" value={profile.score} color="#FFD700" />
          <StatCard label="Swaps" value={profile.swapCount} color="#14F195" />
          <StatCard label="Transfers" value={profile.transferCount} color="#00D1FF" />
          <StatCard label="Bounties" value={profile.bountyCount} color="#9945FF" />
        </div>

        {/* Outfits */}
        <div className="mb-2">
          <div className="text-xs mb-2" style={{ color: "#555566" }}>
            Outfits ({profile.unlockedOutfits.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profile.unlockedOutfits.map((id) => (
              <button
                key={id}
                onClick={() => selectOutfit(id)}
                className="px-2 py-1 rounded text-xs cursor-pointer"
                style={{
                  background:
                    profile.outfitId === id
                      ? "rgba(20,241,149,0.15)"
                      : "#12122a",
                  color:
                    profile.outfitId === id ? "#14F195" : "#888899",
                  border:
                    profile.outfitId === id
                      ? "1px solid rgba(20,241,149,0.3)"
                      : "1px solid rgba(255,255,255,0.05)",
                  fontFamily: "monospace",
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </div>

        {/* On-chain activity */}
        <div className="mb-4 mt-4">
          <div className="text-xs mb-2" style={{ color: "#555566" }}>
            On-chain activity
          </div>
          <div
            className="rounded-lg p-3"
            style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}
          >
            <div className="flex justify-between mb-2">
              <span className="text-xs" style={{ color: "#888899" }}>Total interactions</span>
              <span className="text-xs font-bold" style={{ color: "#14F195" }}>
                {profile.swapCount + profile.transferCount + profile.bountyCount}
              </span>
            </div>
            <div className="w-full rounded-full h-1.5 mb-3" style={{ background: "#1a1a3a" }}>
              <div
                className="rounded-full h-1.5 transition-all"
                style={{
                  background: "linear-gradient(90deg, #9945FF, #14F195)",
                  width: `${Math.min((profile.swapCount + profile.transferCount + profile.bountyCount) * 5, 100)}%`,
                }}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-bold" style={{ color: "#14F195" }}>{profile.swapCount}</div>
                <div className="text-xs" style={{ color: "#555566" }}>Swaps</div>
              </div>
              <div>
                <div className="text-lg font-bold" style={{ color: "#00D1FF" }}>{profile.transferCount}</div>
                <div className="text-xs" style={{ color: "#555566" }}>Transfers</div>
              </div>
              <div>
                <div className="text-lg font-bold" style={{ color: "#9945FF" }}>{profile.bountyCount}</div>
                <div className="text-xs" style={{ color: "#555566" }}>Bounties</div>
              </div>
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="mb-4">
          {/* Tab bar */}
          <div className="flex items-center gap-0 mb-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              onClick={() => setLbTab("online")}
              className="text-xs px-3 py-1.5 cursor-pointer"
              style={{
                background: "none",
                border: "none",
                borderBottom: lbTab === "online" ? "2px solid #14F195" : "2px solid transparent",
                color: lbTab === "online" ? "#14F195" : "#555566",
                fontFamily: '"Press Start 2P", monospace',
                marginBottom: -1,
              }}
            >
              <span
                className="inline-block rounded-full mr-1.5"
                style={{ width: 5, height: 5, background: "#14F195", boxShadow: "0 0 4px #14F195", verticalAlign: "middle" }}
              />
              Online {onlinePlayers.length > 0 && `(${onlinePlayers.length})`}
            </button>
            <button
              onClick={() => setLbTab("alltime")}
              className="text-xs px-3 py-1.5 cursor-pointer"
              style={{
                background: "none",
                border: "none",
                borderBottom: lbTab === "alltime" ? "2px solid #FFD700" : "2px solid transparent",
                color: lbTab === "alltime" ? "#FFD700" : "#555566",
                fontFamily: '"Press Start 2P", monospace',
                marginBottom: -1,
              }}
            >
              All Time
            </button>
            {lbTab === "alltime" && (
              <button
                onClick={refreshAllTime}
                disabled={allTimeLoading}
                title="Refresh"
                className="ml-auto text-xs cursor-pointer"
                style={{
                  background: "none",
                  border: "none",
                  color: allTimeLoading ? "#333344" : "#555566",
                  padding: "4px 8px",
                  fontFamily: "monospace",
                }}
              >
                ↻
              </button>
            )}
          </div>

          {/* Online tab */}
          {lbTab === "online" && (
            onlinePlayers.length === 0 ? (
              <div className="text-xs py-3 text-center" style={{ color: "#333344" }}>
                No other players online right now
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {[...onlinePlayers]
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                  .map((p, i) => {
                    const isSelf = p.wallet === profile.wallet;
                    const name = p.displayName ?? p.wallet.slice(0, 8);
                    return (
                      <LeaderboardRow
                        key={p.wallet}
                        rank={i + 1}
                        name={name}
                        score={p.score ?? 0}
                        isSelf={isSelf}
                        wallet={p.wallet}
                      />
                    );
                  })}
              </div>
            )
          )}

          {/* All Time tab */}
          {lbTab === "alltime" && (
            allTimeLoading ? (
              <div className="text-xs py-4 text-center" style={{ color: "#555566" }}>
                Fetching from devnet…
              </div>
            ) : allTimeError ? (
              <div className="text-xs py-3 text-center" style={{ color: "#ff4444" }}>
                {allTimeError}
              </div>
            ) : allTimeEntries.length === 0 ? (
              <div className="text-xs py-3 text-center" style={{ color: "#333344" }}>
                No on-chain records found
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {allTimeEntries.slice(0, 50).map((entry, i) => {
                  const isSelf = entry.wallet === profile.wallet;
                  const name = entry.displayName || entry.wallet.slice(0, 8);
                  return (
                    <LeaderboardRow
                      key={entry.wallet}
                      rank={i + 1}
                      name={name}
                      score={entry.score}
                      isSelf={isSelf}
                      wallet={entry.wallet}
                      extra={
                        <span className="text-xs" style={{ color: "#444455", fontSize: 7 }}>
                          {entry.swapCount}s·{entry.transferCount}t·{entry.bountyCount}b
                        </span>
                      }
                    />
                  );
                })}
                {allTimeEntries.length > 50 && (
                  <div className="text-xs text-center pt-1" style={{ color: "#333344" }}>
                    +{allTimeEntries.length - 50} more
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Achievements */}
        <div className="mb-4">
          <div className="text-xs mb-2 flex items-center justify-between" style={{ color: "#555566" }}>
            <span>Achievements</span>
            <span style={{ color: "#444455" }}>
              {profile.unlockedAchievements.length}/{ACHIEVEMENTS.length}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {ACHIEVEMENTS.map((ach) => {
              const unlocked = profile.unlockedAchievements.includes(ach.id);
              const color = TIER_COLORS[ach.tier];
              return (
                <div
                  key={ach.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{
                    background: unlocked ? `${color}10` : "rgba(255,255,255,0.02)",
                    border: `1px solid ${unlocked ? `${color}30` : "rgba(255,255,255,0.04)"}`,
                    opacity: unlocked ? 1 : 0.45,
                  }}
                >
                  <span style={{ fontSize: 15, filter: unlocked ? "none" : "grayscale(1)" }}>
                    {unlocked ? ach.icon : "🔒"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      style={{
                        fontSize: 8,
                        fontFamily: '"Press Start 2P", monospace',
                        color: unlocked ? color : "#555566",
                        marginBottom: 2,
                      }}
                    >
                      {ach.title}
                    </div>
                    <div style={{ fontSize: 8, color: "#666677", lineHeight: 1.4 }}>
                      {ach.description}
                    </div>
                  </div>
                  {unlocked && (
                    <span
                      style={{
                        fontSize: 7,
                        fontFamily: '"Press Start 2P", monospace',
                        color,
                        textTransform: "uppercase",
                        flexShrink: 0,
                      }}
                    >
                      {ach.tier}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Member info */}
        <div className="flex justify-between text-xs mt-2" style={{ color: "#333344" }}>
          <span>Member since {new Date(profile.joinedAt).toLocaleDateString()}</span>
          <span>Last active {new Date(profile.lastActive).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

function LeaderboardRow({
  rank,
  name,
  score,
  isSelf,
  wallet,
  extra,
}: {
  rank: number;
  name: string;
  score: number;
  isSelf: boolean;
  wallet: string;
  extra?: React.ReactNode;
}) {
  const rankColor =
    rank === 1 ? "#FFD700" :
    rank === 2 ? "#C0C0C0" :
    rank === 3 ? "#CD7F32" :
    "#444455";

  return (
    <div
      className="flex items-center justify-between px-2 py-1 rounded"
      style={{
        background: isSelf ? "rgba(20,241,149,0.06)" : "#12122a",
        border: isSelf ? "1px solid rgba(20,241,149,0.2)" : "1px solid rgba(255,255,255,0.03)",
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="text-xs flex-shrink-0"
          style={{ color: rankColor, width: 18, textAlign: "right", fontWeight: rank <= 3 ? "bold" : "normal" }}
        >
          {rank <= 3 ? ["🥇","🥈","🥉"][rank - 1] : rank}
        </span>
        <span
          className="text-xs truncate"
          style={{ color: isSelf ? "#14F195" : "#aaaacc", maxWidth: 150 }}
          title={wallet}
        >
          {name}{isSelf ? " (you)" : ""}
        </span>
        {extra && <span className="flex-shrink-0">{extra}</span>}
      </div>
      <span className="text-xs font-bold flex-shrink-0" style={{ color: "#FFD700" }}>
        {score}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className="rounded-lg p-2.5 text-center"
      style={{ background: "#12122a" }}
    >
      <div className="text-xs" style={{ color: "#555566" }}>
        {label}
      </div>
      <div
        className="text-lg font-bold mt-0.5"
        style={{ color, fontFamily: '"Press Start 2P", monospace', fontSize: "11px" }}
      >
        {value}
      </div>
    </div>
  );
}
