"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  getRoundIndex, getMsRemaining, recordFind, getMyScore,
  getLeaderboard, recordRoundWinner, getRoundWinner,
  type ScoreEntry,
} from "@/game/minigames/whereIsNPC/WhereIsNPCGame";
import {
  LAYER_ORDER, getVariant,
  SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, type Loadout,
} from "@/game/config/paperDoll";

// ── Chroma key (same constants as BootScene) ─────────────────────────────────
const CHROMA_R = 215, CHROMA_G = 123, CHROMA_B = 186, CHROMA_TOL = 30;

function removeChroma(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (Math.abs(px[i] - CHROMA_R) <= CHROMA_TOL &&
        Math.abs(px[i+1] - CHROMA_G) <= CHROMA_TOL &&
        Math.abs(px[i+2] - CHROMA_B) <= CHROMA_TOL) px[i+3] = 0;
  }
  ctx.putImageData(d, 0, 0);
}

// ── Mini avatar preview ───────────────────────────────────────────────────────
function MiniAvatar({ loadout, size = 64 }: { loadout: Loadout; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const SCALE = size / SPRITE_FRAME_WIDTH;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;

    let loaded = 0;
    const imgs: { img: HTMLImageElement; cat: typeof LAYER_ORDER[number] }[] = [];

    for (const cat of LAYER_ORDER) {
      const variantId = loadout[cat];
      if (!variantId) continue;
      const variant = getVariant(cat, variantId);
      if (!variant) continue;
      const img = new Image();
      img.src = `/assets/sprites/paperdoll/${variant.file}`;
      imgs.push({ img, cat });
      img.onload = () => {
        loaded++;
        if (loaded === imgs.length) {
          ctx.clearRect(0, 0, size, size);
          for (const { img } of imgs) {
            const off = document.createElement("canvas");
            off.width = img.naturalWidth; off.height = img.naturalHeight;
            const oc = off.getContext("2d")!;
            oc.drawImage(img, 0, 0);
            removeChroma(oc, img.naturalWidth, img.naturalHeight);
            ctx.drawImage(off, 0, 0, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, 0, 0, size, size);
          }
        }
      };
    }
  }, [loadout, size, SCALE]);

  return (
    <canvas ref={ref} width={size} height={size}
      style={{ imageRendering: "pixelated", display: "block" }} />
  );
}


// ── Leaderboard modal ─────────────────────────────────────────────────────────
function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const entries = getLeaderboard(10);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#0b0e1c", border: "1px solid rgba(153,69,255,0.35)",
        borderRadius: 14, minWidth: 320, maxWidth: "90vw",
        fontFamily: '"Fira Code", monospace', color: "#d0d0f0",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 18px", background: "rgba(153,69,255,0.08)",
          borderBottom: "1px solid rgba(153,69,255,0.12)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 10, color: "#c084fc" }}>
            🏆 LEADERBOARD
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "10px 18px 16px" }}>
          {entries.length === 0 ? (
            <div style={{ color: "#444466", fontSize: 11, padding: "16px 0", textAlign: "center" }}>
              No finds yet. Be the first!
            </div>
          ) : entries.map((e, i) => (
            <div key={e.wallet} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0",
              borderBottom: i < entries.length - 1 ? "1px solid rgba(153,69,255,0.08)" : "none",
            }}>
              <span style={{
                fontFamily: '"Press Start 2P", monospace', fontSize: 9,
                color: i === 0 ? "#FFD700" : i === 1 ? "#aaaacc" : i === 2 ? "#cd7f32" : "#444466",
                minWidth: 22,
              }}>#{i + 1}</span>
              <span style={{ flex: 1, fontSize: 11, color: "#9090cc" }}>{e.display}</span>
              <span style={{
                fontFamily: '"Press Start 2P", monospace', fontSize: 9,
                color: "#14F195",
              }}>{e.count} ★</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────
interface Props {
  gameRef: Phaser.Game | null;
  wallet: string | null;
}

export default function WhereIsNPCCard({ gameRef, wallet }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [targetLoadout, setTargetLoadout] = useState<Loadout | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [msLeft, setMsLeft] = useState(getMsRemaining());
  const [foundMsg, setFoundMsg] = useState<string | null>(null);
  const [round, setRound] = useState(getRoundIndex());

  // Countdown timer
  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft(getMsRemaining());
      const newRound = getRoundIndex();
      if (newRound !== round) {
        setRound(newRound);
        setFoundMsg(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [round]);

  // Listen for found event from Phaser
  useEffect(() => {
    if (!gameRef) return;

    const onFound = ({ wallet: w, loadout }: { wallet: string; loadout: Loadout }) => {
      const newScore = recordFind(w);
      recordRoundWinner(getRoundIndex(), w);
      const short = `${w.slice(0, 4)}…${w.slice(-4)}`;
      setFoundMsg(w === wallet ? `You found them! ★ Total: ${newScore}` : `${short} found them!`);
      setMyScore(getMyScore(wallet ?? ""));
      setTargetLoadout(null); // will refresh on next roundCheck
    };

    const onRoundCheck = () => {
      setMsLeft(getMsRemaining());
      // Request current target loadout from Phaser
      gameRef.events.emit("whereIsNPC:requestTarget");
    };

    const onTargetInfo = (loadout: Loadout) => {
      setTargetLoadout(loadout);
    };

    gameRef.events.on("whereIsNPC:found", onFound);
    gameRef.events.on("whereIsNPC:roundCheck", onRoundCheck);
    gameRef.events.on("whereIsNPC:targetInfo", onTargetInfo);

    // Request initial target
    gameRef.events.emit("whereIsNPC:requestTarget");

    return () => {
      gameRef.events.off("whereIsNPC:found", onFound);
      gameRef.events.off("whereIsNPC:roundCheck", onRoundCheck);
      gameRef.events.off("whereIsNPC:targetInfo", onTargetInfo);
    };
  }, [gameRef, wallet, round]);

  useEffect(() => {
    setMyScore(getMyScore(wallet ?? ""));
  }, [wallet]);

  const mm = Math.floor(msLeft / 60000);
  const ss = String(Math.floor((msLeft % 60000) / 1000)).padStart(2, "0");

  return (
    <>
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      <div style={{
        background: "rgba(8,10,22,0.52)",
        border: "1px solid rgba(153,69,255,0.22)",
        borderRadius: 12,
        overflow: "hidden",
        minWidth: 200,
        backdropFilter: "blur(14px)",
        boxShadow: "0 4px 32px rgba(0,0,0,0.35)",
        fontFamily: '"Fira Code", monospace',
        color: "#d0d0f0",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "9px 11px",
          borderBottom: collapsed ? "none" : "1px solid rgba(153,69,255,0.1)",
          cursor: "pointer",
        }} onClick={() => setCollapsed(v => !v)}>
          <span style={{ fontSize: 14 }}>🔍</span>
          <span style={{
            fontFamily: '"Press Start 2P", monospace', fontSize: 8,
            color: "#c084fc", letterSpacing: 1, flex: 1,
          }}>WHERE'S THE NPC?

          {/* Info button */}
          <div style={{ position: "relative" }}
            onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }}>
            <button style={{
              background: "none", border: "1px solid rgba(153,69,255,0.3)",
              borderRadius: 4, color: "#9945FF", fontSize: 10,
              width: 18, height: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>ℹ</button>
            {showInfo && (
              <div style={{
                position: "absolute", right: 0, top: 24, zIndex: 50,
                background: "#0b0e1c", border: "1px solid rgba(153,69,255,0.3)",
                borderRadius: 8, padding: "10px 12px", width: 220,
                fontSize: 10, color: "#aaaacc", lineHeight: 1.6,
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              }}>
                <div style={{ color: "#c084fc", marginBottom: 6, fontFamily: '"Press Start 2P", monospace', fontSize: 7 }}>HOW TO PLAY</div>
                Find the NPC shown in the card. Get close and press <b style={{ color: "#14F195" }}>E</b> to catch them.
                <br /><br />
                Target changes every <b style={{ color: "#FFD700" }}>5 minutes</b>. First to find wins the round!
              </div>
            )}
          </div>

          <span style={{ color: "#444466", fontSize: 12 }}>{collapsed ? "▲" : "▼"}</span>
        </div>

        {!collapsed && (
          <div style={{ padding: "10px 11px", display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Found message */}
            {foundMsg && (
              <div style={{
                background: "rgba(20,241,149,0.1)", border: "1px solid rgba(20,241,149,0.3)",
                borderRadius: 6, padding: "6px 8px",
                fontSize: 9, color: "#14F195",
                fontFamily: '"Press Start 2P", monospace', letterSpacing: 0.5,
                textAlign: "center",
              }}>
                {foundMsg}
              </div>
            )}

            {/* Target — avatar only, no trait list */}
            {targetLoadout ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div style={{
                  background: "rgba(153,69,255,0.08)",
                  border: "1px solid rgba(153,69,255,0.2)",
                  borderRadius: 8, padding: 6,
                }}>
                  <MiniAvatar loadout={targetLoadout} size={80} />
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 9, color: "#444466", textAlign: "center", padding: "8px 0" }}>
                {foundMsg ? "New target incoming…" : "Loading target…"}
              </div>
            )}

            {/* Timer + score row */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 9, color: "#555577" }}>⏱ {mm}:{ss}</span>
              <div style={{ flex: 1 }} />
              {wallet && (
                <span style={{
                  fontSize: 8, color: "#14F195",
                  fontFamily: '"Press Start 2P", monospace',
                }}>★ {myScore}</span>
              )}
              <button
                onClick={() => setShowLeaderboard(true)}
                style={{
                  background: "rgba(153,69,255,0.12)",
                  border: "1px solid rgba(153,69,255,0.25)",
                  borderRadius: 5, padding: "4px 8px",
                  color: "#9945FF", fontSize: 9, cursor: "pointer",
                  fontFamily: '"Press Start 2P", monospace',
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(153,69,255,0.22)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(153,69,255,0.12)"}
              >
                🏆
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
