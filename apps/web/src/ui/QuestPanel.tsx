"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DAILY_QUESTS, getQuestProgress, claimQuest,
  getQuestLeaderboard, getMyQuestPoints, getDailyPointsEarned,
  type QuestProgress, type QuestLeaderEntry,
} from "@/game/quests/QuestManager";

// ── Leaderboard modal ─────────────────────────────────────────────────────────
function QuestLeaderboardModal({ onClose }: { onClose: () => void }) {
  const entries: QuestLeaderEntry[] = getQuestLeaderboard(10);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#0b0e1c", border: "1px solid rgba(20,241,149,0.3)",
        borderRadius: 14, minWidth: 320, maxWidth: "90vw",
        fontFamily: '"Fira Code", monospace', color: "#d0d0f0",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 18px", background: "rgba(20,241,149,0.06)",
          borderBottom: "1px solid rgba(20,241,149,0.12)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: "#14F195" }}>
            🏆 QUEST LEADERBOARD
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "10px 18px 16px" }}>
          <div style={{ fontSize: 9, color: "#555577", marginBottom: 10, textAlign: "center" }}>
            Total daily quest points — all time
          </div>
          {entries.length === 0 ? (
            <div style={{ color: "#444466", fontSize: 11, padding: "16px 0", textAlign: "center" }}>
              No points yet. Complete quests to appear here!
            </div>
          ) : entries.map((e, i) => (
            <div key={e.wallet} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0",
              borderBottom: i < entries.length - 1 ? "1px solid rgba(20,241,149,0.08)" : "none",
            }}>
              <span style={{
                fontFamily: '"Press Start 2P", monospace', fontSize: 9,
                color: i === 0 ? "#FFD700" : i === 1 ? "#aaaacc" : i === 2 ? "#cd7f32" : "#444466",
                minWidth: 22,
              }}>#{i + 1}</span>
              <span style={{ flex: 1, fontSize: 11, color: "#9090cc" }}>{e.display}</span>
              <span style={{
                fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: "#14F195",
              }}>{e.points} pts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
interface Props {
  wallet: string | null;
}

export default function QuestPanel({ wallet }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [progress, setProgress] = useState<Record<string, QuestProgress>>({});
  const [totalPoints, setTotalPoints] = useState(0);
  const [claimFlash, setClaimFlash] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!wallet) return;
    setProgress(getQuestProgress(wallet));
    setTotalPoints(getMyQuestPoints(wallet));
  }, [wallet]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleClaim = (questId: string) => {
    if (!wallet) return;
    const pts = claimQuest(wallet, questId);
    if (pts > 0) {
      setClaimFlash(`+${pts} pts`);
      setTimeout(() => setClaimFlash(null), 1800);
    }
    refresh();
  };

  const dailyEarned = wallet ? getDailyPointsEarned(wallet) : 0;
  const dailyMax = DAILY_QUESTS.reduce((s, q) => s + q.points, 0);

  return (
    <>
      {showLeaderboard && <QuestLeaderboardModal onClose={() => setShowLeaderboard(false)} />}

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
          {wallet && (
            <span style={{ fontSize: 8, color: "#14F195", fontFamily: '"Press Start 2P", monospace' }}>
              {dailyEarned}/{dailyMax}
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); setShowLeaderboard(true); }}
            style={{
              background: "rgba(20,241,149,0.08)", border: "1px solid rgba(20,241,149,0.2)",
              borderRadius: 5, padding: "3px 6px",
              color: "#14F195", fontSize: 9, cursor: "pointer",
              fontFamily: '"Press Start 2P", monospace',
            }}
            title="Quest Leaderboard"
          >🏆</button>
          <span style={{ color: "#444466", fontSize: 12 }}>{collapsed ? "▲" : "▼"}</span>
        </div>

        {!collapsed && (
          <div style={{ padding: "8px 11px", display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Claim flash */}
            {claimFlash && (
              <div style={{
                background: "rgba(20,241,149,0.12)", border: "1px solid rgba(20,241,149,0.3)",
                borderRadius: 6, padding: "5px 8px",
                textAlign: "center", fontSize: 10, color: "#14F195",
                fontFamily: '"Press Start 2P", monospace',
              }}>{claimFlash} earned!</div>
            )}

            {/* All-time points */}
            {wallet && totalPoints > 0 && (
              <div style={{ fontSize: 8, color: "#555577", textAlign: "right" }}>
                Total: <span style={{ color: "#14F195" }}>{totalPoints} pts</span>
              </div>
            )}

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
                  border: `1px solid ${claimed
                    ? "rgba(20,241,149,0.15)"
                    : p.completed
                    ? "rgba(20,241,149,0.3)"
                    : "rgba(153,69,255,0.15)"}`,
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
                    <span style={{ fontSize: 8, color: "#14F195", fontFamily: '"Press Start 2P", monospace' }}>
                      {quest.points}pts
                    </span>
                  </div>

                  {/* Description + counter */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ fontSize: 9, color: "#7070aa", flex: 1, lineHeight: 1.4 }}>
                      {quest.description}
                    </div>
                    {quest.target > 1 && (
                      <span style={{ fontSize: 8, color: "#555577", flexShrink: 0 }}>
                        {p.current}/{quest.target}
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    height: 3, background: "rgba(255,255,255,0.06)",
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
    </>
  );
}
