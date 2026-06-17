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
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
      animation: "fadeIn 0.15s ease",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#0b0e1c", border: "1px solid rgba(20,241,149,0.25)",
        borderRadius: 16, minWidth: 320, maxWidth: "90vw",
        fontFamily: '"Fira Code", monospace', color: "#d0d0f0",
        overflow: "hidden",
        animation: "slideUp 0.18s ease",
      }}>
        <div style={{
          padding: "16px 20px", background: "rgba(20,241,149,0.05)",
          borderBottom: "1px solid rgba(20,241,149,0.1)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 10, color: "#14F195", letterSpacing: 0.5 }}>
            🏆 QUEST LEADERBOARD
          </span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#555", fontSize: 20,
            cursor: "pointer", lineHeight: 1, padding: "0 2px",
            transition: "color 0.15s",
          }}
            onMouseEnter={e => (e.currentTarget.style.color = "#aaa")}
            onMouseLeave={e => (e.currentTarget.style.color = "#555")}
          >×</button>
        </div>
        <div style={{ padding: "6px 20px 16px" }}>
          <div style={{ fontSize: 11, color: "#444466", marginBottom: 8, paddingTop: 10, textAlign: "center" }}>
            All-time daily quest points
          </div>
          {entries.length === 0 ? (
            <div style={{ color: "#444466", fontSize: 12, padding: "20px 0", textAlign: "center" }}>
              No points yet — complete quests to appear here!
            </div>
          ) : entries.map((e, i) => (
            <div key={e.wallet} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 0",
              borderBottom: i < entries.length - 1 ? "1px solid rgba(20,241,149,0.06)" : "none",
            }}>
              <span style={{
                fontFamily: '"Press Start 2P", monospace', fontSize: 9,
                color: i === 0 ? "#FFD700" : i === 1 ? "#c0c0cc" : i === 2 ? "#cd7f32" : "#333355",
                minWidth: 24,
              }}>#{i + 1}</span>
              <span style={{ flex: 1, fontSize: 12, color: "#9090cc" }}>{e.display}</span>
              <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: "#14F195" }}>
                {e.points} pts
              </span>
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
      setClaimFlash(`+${pts}`);
      setTimeout(() => setClaimFlash(null), 2000);
    }
    refresh();
  };

  const dailyEarned = wallet ? getDailyPointsEarned(wallet) : 0;
  const dailyMax = DAILY_QUESTS.reduce((s, q) => s + q.points, 0);

  return (
    <>
      <style>{`
        .quest-card { transition: box-shadow 0.2s ease; }
        .quest-card:hover { box-shadow: 0 6px 40px rgba(20,241,149,0.12) !important; }
        .quest-claim-btn { transition: opacity 0.15s ease, transform 0.1s ease; }
        .quest-claim-btn:hover { opacity: 0.9; transform: scale(1.02); }
        .quest-claim-btn:active { transform: scale(0.97); }
        .quest-collapse { transition: color 0.15s ease; }
        .quest-collapse:hover { color: #14F195 !important; }
        @keyframes claimPop {
          0% { transform: scale(0.8); opacity: 0; }
          60% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {showLeaderboard && <QuestLeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      <div className="quest-card" style={{
        background: "rgba(8,10,22,0.58)",
        border: "1px solid rgba(20,241,149,0.15)",
        borderRadius: 14,
        width: 210,
        backdropFilter: "blur(16px)",
        boxShadow: "0 4px 28px rgba(0,0,0,0.4)",
        fontFamily: '"Fira Code", monospace',
        color: "#d0d0f0",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "11px 13px",
          borderBottom: collapsed ? "none" : "1px solid rgba(20,241,149,0.08)",
          cursor: "pointer",
          userSelect: "none",
        }} onClick={() => setCollapsed(v => !v)}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>📋</span>
          <span style={{
            fontFamily: '"Press Start 2P", monospace', fontSize: 8,
            color: "#14F195", letterSpacing: 0.5, flex: 1,
            lineHeight: 1.4,
          }}>DAILY QUESTS</span>
          {wallet && (
            <span style={{ fontSize: 11, color: "#14F195" }}>
              {dailyEarned}/{dailyMax}
            </span>
          )}
          <button style={{
            background: "rgba(20,241,149,0.08)", border: "1px solid rgba(20,241,149,0.2)",
            borderRadius: 6, color: "#14F195", fontSize: 12,
            width: 22, height: 22, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "background 0.15s ease",
          }}
            onClick={e => { e.stopPropagation(); setShowLeaderboard(true); }}
            title="Quest Leaderboard"
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(20,241,149,0.16)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(20,241,149,0.08)")}
          >🏆</button>
          <span className="quest-collapse" style={{ color: "#444466", fontSize: 11, marginLeft: 2 }}>
            {collapsed ? "▲" : "▼"}
          </span>
        </div>

        {!collapsed && (
          <div style={{ padding: "10px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Claim flash */}
            {claimFlash && (
              <div style={{
                background: "rgba(20,241,149,0.1)", border: "1px solid rgba(20,241,149,0.3)",
                borderRadius: 8, padding: "7px 10px",
                textAlign: "center", fontSize: 13, color: "#14F195",
                fontWeight: 700, letterSpacing: 1,
                animation: "claimPop 0.25s ease, slideUp 0.2s ease",
              }}>{claimFlash} pts earned!</div>
            )}

            {/* All-time points */}
            {wallet && totalPoints > 0 && (
              <div style={{ fontSize: 11, color: "#555577", textAlign: "right" }}>
                All-time: <span style={{ color: "#14F195" }}>{totalPoints} pts</span>
              </div>
            )}

            {DAILY_QUESTS.map(quest => {
              const p = progress[quest.id] ?? { questId: quest.id, current: 0, completed: false };
              const pct = Math.min(100, Math.round((p.current / quest.target) * 100));
              const claimed = !!p.claimedAt;

              return (
                <div key={quest.id} style={{
                  background: claimed
                    ? "rgba(20,241,149,0.05)"
                    : p.completed
                    ? "rgba(20,241,149,0.08)"
                    : "rgba(153,69,255,0.04)",
                  border: `1px solid ${claimed
                    ? "rgba(20,241,149,0.12)"
                    : p.completed
                    ? "rgba(20,241,149,0.25)"
                    : "rgba(153,69,255,0.12)"}`,
                  borderRadius: 10,
                  padding: "9px 11px",
                  transition: "border-color 0.2s ease, background 0.2s ease",
                }}>
                  {/* Title row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                    <span style={{ fontSize: 12, lineHeight: 1 }}>
                      {claimed ? "✅" : p.completed ? "⭐" : "🔲"}
                    </span>
                    <span style={{
                      fontFamily: '"Press Start 2P", monospace', fontSize: 7,
                      color: claimed ? "#14F195" : p.completed ? "#FFD700" : "#c084fc",
                      flex: 1, lineHeight: 1.5,
                    }}>{quest.title}</span>
                    <span style={{ fontSize: 11, color: "#14F195", flexShrink: 0 }}>
                      {quest.points}pt
                    </span>
                  </div>

                  {/* Description */}
                  <div style={{ fontSize: 11, color: "#6060aa", lineHeight: 1.5, marginBottom: 7 }}>
                    {quest.description}
                    {quest.target > 1 && (
                      <span style={{ color: "#444466", marginLeft: 6 }}>
                        {p.current}/{quest.target}
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    height: 3, background: "rgba(255,255,255,0.05)",
                    borderRadius: 2, overflow: "hidden",
                    marginBottom: p.completed && !claimed ? 8 : 0,
                  }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: claimed
                        ? "#14F195"
                        : p.completed
                        ? "#FFD700"
                        : "linear-gradient(90deg, #9945FF, #c084fc)",
                      borderRadius: 2,
                      transition: "width 0.4s ease",
                    }} />
                  </div>

                  {/* Claim button */}
                  {p.completed && !claimed && (
                    <button className="quest-claim-btn"
                      onClick={() => handleClaim(quest.id)}
                      style={{
                        width: "100%",
                        background: "linear-gradient(135deg, #14F195 0%, #0db876 100%)",
                        border: "none", borderRadius: 7,
                        padding: "7px 0", fontSize: 9,
                        color: "#031a10", cursor: "pointer",
                        fontFamily: '"Press Start 2P", monospace',
                        letterSpacing: 0.5,
                        boxShadow: "0 2px 12px rgba(20,241,149,0.25)",
                      }}
                    >
                      CLAIM — {quest.rewardLabel}
                    </button>
                  )}
                  {claimed && (
                    <div style={{
                      fontSize: 9, color: "#14F195", textAlign: "center",
                      fontFamily: '"Press Start 2P", monospace',
                      opacity: 0.6,
                    }}>CLAIMED ✓</div>
                  )}
                </div>
              );
            })}

            {!wallet && (
              <div style={{ fontSize: 11, color: "#3a3a5a", textAlign: "center", padding: "6px 0" }}>
                Connect wallet to track progress
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
