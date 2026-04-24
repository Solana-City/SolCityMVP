"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { PlayerProfile } from "@/game/config/profileManager";
import type { ProfileManager } from "@/game/config/profileManager";

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
        className="relative rounded-2xl p-6 w-full max-w-md"
        style={{
          background: "rgba(10,10,30,0.97)",
          border: "1px solid rgba(153,69,255,0.25)",
          fontFamily: '"Fira Code", monospace',
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-lg cursor-pointer"
          style={{ background: "none", border: "none", color: "#555566" }}
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
                  fontSize: "20px",
                  fontWeight: "bold",
                }}
              >
                {profile.displayName[0]?.toUpperCase()}
              </div>
            )}
            <div
              className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
              style={{ background: "rgba(0,0,0,0.6)", fontSize: "10px", color: "#fff" }}
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
              <span style={{ color: "#00D1FF", fontSize: "12px" }}>
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
                fontSize: "8px",
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

        {/* Member info */}
        <div className="flex justify-between text-xs mb-2" style={{ color: "#444455" }}>
          <span>Member since {new Date(profile.joinedAt).toLocaleDateString()}</span>
          <span>Last active {new Date(profile.lastActive).toLocaleDateString()}</span>
        </div>

        <div
          className="mt-3 text-xs text-center"
          style={{ color: "#333344" }}
        >
          Press 1-6 in-game for quick emotes
        </div>

        {/* Dev-only: reset all progression. Keeps wallet/name/PFP intact. */}
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => {
              if (!manager) return;
              const ok = window.confirm(
                "Reset all progress?\n\nThis clears score, achievements, outfits, and visited NPCs. Your wallet, display name, and PFP stay.\n\nUseful for re-testing the onboarding flow."
              );
              if (ok) manager.resetProgress();
            }}
            className="text-xs cursor-pointer"
            style={{
              background: "transparent",
              border: "1px solid #333344",
              color: "#555566",
              padding: "4px 10px",
              borderRadius: 4,
              fontFamily: '"Fira Code", monospace',
            }}
            title="Clear achievements, score, counters, outfits, visited NPCs"
          >
            reset progress (dev)
          </button>
        </div>
      </div>
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
        style={{ color, fontFamily: '"Press Start 2P", monospace', fontSize: "14px" }}
      >
        {value}
      </div>
    </div>
  );
}
