"use client";

import { useState, useEffect } from "react";
import {
  DAILY_QUESTS, getQuestProgress, claimQuest,
  type QuestProgress,
} from "@/game/quests/QuestManager";

interface Props {
  wallet: string | null;
}

export default function QuestPanel({ wallet }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [progress, setProgress] = useState<Record<string, QuestProgress>>({});

  const refresh = () => {
    if (wallet) setProgress(getQuestProgress(wallet));
  };

  useEffect(() => {
    refresh();
    // Re-check every 5s to pick up increments from other components
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [wallet]);

  const handleClaim = (questId: string) => {
    if (!wallet) return;
    claimQuest(wallet, questId);
    refresh();
  };

  return (
    <div style={{
      background: "rgba(8,10,22,0.52)",
      border: "1px solid rgba(153,69,255,0.22)",
      borderRadius: 12,
      minWidth: 200,
      backdropFilter: "blur(14px)",
      boxShadow: "0 4px 32px rgba(0,0,0,0.35)",
      fontFamily: '"Fira Code", monospace',
      color: "#d0d0f0",
    }}>
      {/* Header */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "9px 11px",
          borderBottom: collapsed ? "none" : "1px solid rgba(153,69,255,0.1)",
          cursor: "pointer",
        }}
        onClick={() => setCollapsed(v => !v)}
      >
        <span style={{ fontSize: 14 }}>📋</span>
        <span style={{
          fontFamily: '"Press Start 2P", monospace', fontSize: 8,
          color: "#c084fc", letterSpacing: 1, flex: 1,
        }}>DAILY QUESTS</span>
        <span style={{ color: "#444466", fontSize: 12 }}>{collapsed ? "▲" : "▼"}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: "8px 11px", display: "flex", flexDirection: "column", gap: 8 }}>
          {DAILY_QUESTS.map(quest => {
            const p = progress[quest.id] ?? { questId: quest.id, current: 0, completed: false };
            const pct = Math.min(100, Math.round((p.current / quest.target) * 100));
            const claimed = !!p.claimedAt;

            return (
              <div key={quest.id} style={{
                background: claimed
                  ? "rgba(20,241,149,0.06)"
                  : p.completed
                  ? "rgba(20,241,149,0.1)"
                  : "rgba(153,69,255,0.05)",
                border: `1px solid ${claimed ? "rgba(20,241,149,0.15)" : p.completed ? "rgba(20,241,149,0.3)" : "rgba(153,69,255,0.15)"}`,
                borderRadius: 8,
                padding: "8px 10px",
              }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 10 }}>
                    {claimed ? "✅" : p.completed ? "⭐" : "🔲"}
                  </span>
                  <span style={{
                    fontFamily: '"Press Start 2P", monospace', fontSize: 7,
                    color: claimed ? "#14F195" : p.completed ? "#FFD700" : "#c084fc",
                    flex: 1,
                  }}>{quest.title}</span>
                  <span style={{ fontSize: 8, color: "#555577" }}>
                    {p.current}/{quest.target}
                  </span>
                </div>

                {/* Description */}
                <div style={{ fontSize: 9, color: "#7070aa", marginBottom: 6, lineHeight: 1.4 }}>
                  {quest.description}
                </div>

                {/* Progress bar */}
                <div style={{
                  height: 4, background: "rgba(255,255,255,0.06)",
                  borderRadius: 2, overflow: "hidden", marginBottom: 6,
                }}>
                  <div style={{
                    height: "100%", width: `${pct}%`,
                    background: claimed ? "#14F195" : p.completed ? "#FFD700" : "#9945FF",
                    borderRadius: 2,
                    transition: "width 0.4s ease",
                  }} />
                </div>

                {/* Claim button */}
                {p.completed && !claimed && (
                  <button
                    onClick={() => handleClaim(quest.id)}
                    style={{
                      width: "100%",
                      background: "linear-gradient(135deg, #14F195, #0db876)",
                      border: "none", borderRadius: 5,
                      padding: "5px 0", fontSize: 8,
                      color: "#031a10", cursor: "pointer",
                      fontFamily: '"Press Start 2P", monospace',
                      letterSpacing: 0.5,
                    }}
                  >
                    CLAIM — {quest.rewardLabel}
                  </button>
                )}
                {claimed && (
                  <div style={{
                    fontSize: 8, color: "#14F195", textAlign: "center",
                    fontFamily: '"Press Start 2P", monospace',
                  }}>CLAIMED ✓</div>
                )}
              </div>
            );
          })}

          {!wallet && (
            <div style={{ fontSize: 9, color: "#444466", textAlign: "center", padding: "4px 0" }}>
              Connect wallet to track progress
            </div>
          )}
        </div>
      )}
    </div>
  );
}
