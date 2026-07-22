"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  getRoundIndex, getCitizenMsRemaining, CITIZEN_MS, recordFind, getMyScore,
  getLeaderboard, recordRoundWinner,
  type ScoreEntry,
} from "@/game/minigames/whereIsNPC/WhereIsNPCGame";
import {
  LAYER_ORDER, getVariant,
  SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, type Loadout,
} from "@/game/config/paperDoll";
import { incrementQuest } from "@/game/quests/QuestManager";

// ── Chroma key ────────────────────────────────────────────────────────────────
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

// ── Mini avatar ───────────────────────────────────────────────────────────────

/**
 * Applies the same hat-coverage hair masking the overworld uses (see
 * AvatarSprite.getHairTextureFor), on the single idle-down frame:
 *   "band"  — erase hair only exactly under the band's own ink;
 *   "full"  — per column, erase hair above the hat's topmost opaque pixel;
 *             columns with no hat ink lose their hair entirely (stops wide
 *             hairstyles poking out past the hat's sides).
 * ("suppress" never reaches here — the hair layer is skipped outright.)
 */
function maskHairWithHat(
  hair: HTMLCanvasElement,
  hat: HTMLCanvasElement,
  coverage: "full" | "band" | "suppress",
) {
  const w = hair.width, h = hair.height;
  const hairCtx = hair.getContext("2d")!;
  const hatData = hat.getContext("2d")!.getImageData(0, 0, w, h).data;
  const hairImage = hairCtx.getImageData(0, 0, w, h);
  const hd = hairImage.data;

  if (coverage === "band") {
    for (let i = 0; i < w * h; i++) {
      if (hatData[i * 4 + 3] > 10) hd[i * 4 + 3] = 0;
    }
  } else {
    for (let x = 0; x < w; x++) {
      let cutoff = h; // no hat ink in this column → whole column erased
      for (let y = 0; y < h; y++) {
        if (hatData[(y * w + x) * 4 + 3] > 10) { cutoff = y; break; }
      }
      for (let y = 0; y < cutoff; y++) hd[(y * w + x) * 4 + 3] = 0;
    }
  }
  hairCtx.putImageData(hairImage, 0, 0);
}

function MiniAvatar({ loadout, size = 64 }: { loadout: Loadout; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // The canvas composites at the NATIVE 64x64 frame size and is displayed
  // at an integer multiple only — fractional scaling shears the pixel grid
  // (the old size/64 stretch is what looked cracked).
  const displaySize = size >= 96 ? SPRITE_FRAME_WIDTH * 2 : SPRITE_FRAME_WIDTH;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    const hatVariant = getVariant("hat", loadout.hat);

    // Same layer rules as the overworld: a "suppress" hat hides hair entirely.
    const cats = LAYER_ORDER.filter((cat) => {
      const variantId = loadout[cat];
      if (!variantId) return false;
      if (cat === "hair" && hatVariant?.hatCoverage === "suppress") return false;
      return getVariant(cat, variantId) !== undefined;
    });

    let cancelled = false;

    Promise.all(
      cats.map((cat) => new Promise<{ cat: string; frame: HTMLCanvasElement } | null>((resolve) => {
        const variant = getVariant(cat, loadout[cat])!;
        const img = new Image();
        img.onload = () => {
          // Crop the idle-down frame and de-chroma it.
          const off = document.createElement("canvas");
          off.width = SPRITE_FRAME_WIDTH;
          off.height = SPRITE_FRAME_HEIGHT;
          const oc = off.getContext("2d")!;
          oc.drawImage(
            img, 0, 0, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT,
            0, 0, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT,
          );
          removeChroma(oc, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
          resolve({ cat, frame: off });
        };
        img.onerror = () => resolve(null);
        img.src = `/assets/sprites/paperdoll/${variant.file}`;
      })),
    ).then((results) => {
      if (cancelled || !ref.current) return;
      const byCat = new Map(
        results.filter((r): r is { cat: string; frame: HTMLCanvasElement } => r !== null)
          .map((r) => [r.cat, r.frame]),
      );

      const hairFrame = byCat.get("hair");
      const hatFrame = byCat.get("hat");
      if (hairFrame && hatFrame) {
        maskHairWithHat(hairFrame, hatFrame, hatVariant?.hatCoverage ?? "full");
      }

      ctx.clearRect(0, 0, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
      for (const cat of cats) {
        const frame = byCat.get(cat);
        if (frame) ctx.drawImage(frame, 0, 0);
      }
    });

    return () => { cancelled = true; };
  }, [loadout]);

  return (
    <canvas
      ref={ref}
      width={SPRITE_FRAME_WIDTH}
      height={SPRITE_FRAME_HEIGHT}
      style={{
        imageRendering: "pixelated",
        display: "block",
        width: displaySize,
        height: displaySize,
      }}
    />
  );
}

// ── Leaderboard modal ─────────────────────────────────────────────────────────
function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const entries = getLeaderboard(10);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
      animation: "fadeIn 0.15s ease",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "#0b0e1c", border: "1px solid rgba(153,69,255,0.3)",
        borderRadius: 16, minWidth: 320, maxWidth: "90vw",
        fontFamily: '"Press Start 2P", monospace', color: "#d0d0f0",
        overflow: "hidden",
        animation: "slideUp 0.18s ease",
      }}>
        <div style={{
          padding: "16px 20px", background: "rgba(153,69,255,0.07)",
          borderBottom: "1px solid rgba(153,69,255,0.1)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 8, color: "#c084fc", letterSpacing: 0.5 }}>
            🏆 LEADERBOARD
          </span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#555", fontSize: 15,
            cursor: "pointer", lineHeight: 1, padding: "0 2px",
            transition: "color 0.15s",
          }}
            onMouseEnter={e => (e.currentTarget.style.color = "#aaa")}
            onMouseLeave={e => (e.currentTarget.style.color = "#555")}
          >×</button>
        </div>
        <div style={{ padding: "8px 20px 18px" }}>
          {entries.length === 0 ? (
            <div style={{ color: "#444466", fontSize: 9, padding: "20px 0", textAlign: "center" }}>
              No finds yet — be the first!
            </div>
          ) : entries.map((e, i) => (
            <div key={e.wallet} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 0",
              borderBottom: i < entries.length - 1 ? "1px solid rgba(153,69,255,0.07)" : "none",
            }}>
              <span style={{
                fontFamily: '"Press Start 2P", monospace', fontSize: 7,
                color: i === 0 ? "#FFD700" : i === 1 ? "#c0c0cc" : i === 2 ? "#cd7f32" : "#333355",
                minWidth: 24,
              }}>#{i + 1}</span>
              <span style={{ flex: 1, fontSize: 9, color: "#9090cc" }}>{e.display}</span>
              <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 7, color: "#14F195" }}>
                {e.count} ★
              </span>
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
  // CityScene falls back to "guest" when no wallet is connected — match that
  // identifier here so score lookups and "you found it" checks line up.
  const effectiveWallet = wallet ?? "guest";
  // Compact sizing on touch devices — the card opens as an overlay next to
  // the icon rail and must not swallow the small game view.
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);
  const [collapsed, setCollapsed] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [targetLoadout, setTargetLoadout] = useState<Loadout | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [msLeft, setMsLeft] = useState(getCitizenMsRemaining());
  const [foundMsg, setFoundMsg] = useState<string | null>(null);
  const [round, setRound] = useState(getRoundIndex());

  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft(getCitizenMsRemaining());
      const newRound = getRoundIndex();
      if (newRound !== round) { setRound(newRound); setFoundMsg(null); }
    }, 1000);
    return () => clearInterval(id);
  }, [round]);

  useEffect(() => {
    if (!gameRef) return;
    const onFound = ({ wallet: w, loadout }: { wallet: string; loadout: Loadout }) => {
      const newScore = recordFind(w);
      recordRoundWinner(getRoundIndex(), w);
      const isMe = w === effectiveWallet;
      if (isMe) incrementQuest(w, "hunt_3_npcs");
      const short = w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : (w === "guest" ? "A visitor" : w);
      setFoundMsg(isMe ? `You found them! ★ ${newScore}` : `${short} found them!`);
      if (isMe) setMyScore(newScore);
      setTargetLoadout(null);
      // The game layer reset the per-citizen timer before firing this event,
      // so reflect the fresh full countdown immediately.
      setMsLeft(getCitizenMsRemaining());
    };
    const onRoundCheck = () => {
      setMsLeft(getCitizenMsRemaining());
      gameRef.events.emit("whereIsNPC:requestTarget");
    };
    const onTargetInfo = (loadout: Loadout) => setTargetLoadout(loadout);

    gameRef.events.on("whereIsNPC:found", onFound);
    gameRef.events.on("whereIsNPC:roundCheck", onRoundCheck);
    gameRef.events.on("whereIsNPC:targetInfo", onTargetInfo);
    gameRef.events.emit("whereIsNPC:requestTarget");
    return () => {
      gameRef.events.off("whereIsNPC:found", onFound);
      gameRef.events.off("whereIsNPC:roundCheck", onRoundCheck);
      gameRef.events.off("whereIsNPC:targetInfo", onTargetInfo);
    };
  }, [gameRef, effectiveWallet, round]);

  useEffect(() => { setMyScore(getMyScore(effectiveWallet)); }, [effectiveWallet]);

  const mm = Math.floor(msLeft / 60000);
  const ss = String(Math.floor((msLeft % 60000) / 1000)).padStart(2, "0");
  const pct = Math.round((msLeft / CITIZEN_MS) * 100);

  return (
    <>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes pulseGreen { 0%,100% { opacity: 1 } 50% { opacity: 0.6 } }
        .hunt-card { transition: box-shadow 0.2s ease; }
        .hunt-card:hover { box-shadow: 0 6px 40px rgba(153,69,255,0.18) !important; }
        .hunt-btn { transition: background 0.15s ease, transform 0.1s ease; }
        .hunt-btn:hover { transform: scale(1.05); }
        .hunt-btn:active { transform: scale(0.97); }
        .hunt-collapse { transition: color 0.15s ease; }
        .hunt-collapse:hover { color: #9945FF !important; }
      `}</style>

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {showInfo && (
        <div style={{
          position: "fixed", top: 12, left: isTouch ? 236 : 224, zIndex: 200,
          background: "#0c0f1e", border: "1px solid rgba(153,69,255,0.3)",
          borderRadius: 12, padding: "14px 16px", width: 248,
          fontSize: 9, color: "#a0a0cc", lineHeight: 1.65,
          boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
          fontFamily: '"Press Start 2P", monospace',
          animation: "slideUp 0.15s ease",
        }} onClick={() => setShowInfo(false)}>
          <div style={{ color: "#c084fc", marginBottom: 10, fontFamily: '"Press Start 2P", monospace', fontSize: 7, letterSpacing: 0.5 }}>
            HOW TO PLAY
          </div>
          Find the citizen shown below. Walk up to them and {isTouch ? "tap" : "press"}{" "}
          <span style={{ color: "#14F195", fontWeight: 600 }}>{isTouch ? "ACT" : "E"}</span> to greet them.
          <br /><br />
          A new citizen appears every{" "}
          <span style={{ color: "#FFD700", fontWeight: 600 }}>5 minutes</span>.
          First to find them wins the round!
        </div>
      )}

      <div className="hunt-card" style={{
        background: "rgba(8,10,22,0.58)",
        border: "1px solid rgba(153,69,255,0.2)",
        borderRadius: 14,
        width: isTouch ? 172 : 210,
        backdropFilter: "blur(16px)",
        boxShadow: "0 4px 28px rgba(0,0,0,0.4)",
        fontFamily: '"Press Start 2P", monospace',
        color: "#d0d0f0",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: isTouch ? "8px 10px" : "11px 13px",
          borderBottom: collapsed ? "none" : "1px solid rgba(153,69,255,0.1)",
          cursor: "pointer",
          userSelect: "none",
        }} onClick={() => setCollapsed(v => !v)}>
          <span style={{ fontSize: 11, lineHeight: 1 }}>🔍</span>
          <span style={{
            fontFamily: '"Press Start 2P", monospace', fontSize: 7,
            color: "#c084fc", letterSpacing: 0.5, flex: 1,
            lineHeight: 1.4,
          }}>FIND SOMEONE</span>
          <button className="hunt-btn" style={{
            background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.25)",
            borderRadius: 6, color: "#9945FF", fontSize: 8,
            width: 22, height: 22, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
            onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }}
            title="How to play"
          >ℹ</button>
          <span className="hunt-collapse" style={{ color: "#444466", fontSize: 8, marginLeft: 2 }}>
            {collapsed ? "▲" : "▼"}
          </span>
        </div>

        {!collapsed && (
          <div style={{ padding: isTouch ? "9px 10px" : "12px 13px", display: "flex", flexDirection: "column", gap: isTouch ? 7 : 10 }}>
            {/* Found banner */}
            {foundMsg && (
              <div style={{
                background: "rgba(20,241,149,0.08)", border: "1px solid rgba(20,241,149,0.25)",
                borderRadius: 8, padding: "7px 10px",
                fontSize: 8, color: "#14F195",
                textAlign: "center", lineHeight: 1.4,
                animation: "slideUp 0.2s ease",
              }}>
                {foundMsg}
              </div>
            )}

            {/* Avatar */}
            {targetLoadout ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div style={{
                  background: "rgba(153,69,255,0.07)",
                  border: "1px solid rgba(153,69,255,0.18)",
                  borderRadius: 10, padding: isTouch ? 6 : 8,
                  transition: "border-color 0.2s ease",
                }}>
                  <MiniAvatar loadout={targetLoadout} size={isTouch ? 60 : 88} />
                </div>
              </div>
            ) : (
              <div style={{
                height: isTouch ? 72 : 104, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: "#3a3a5a",
              }}>
                {foundMsg ? "New citizen incoming…" : "Loading…"}
              </div>
            )}

            {/* Timer bar */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 8, color: "#6060aa" }}>
                  ⏱ {mm}:{ss}
                </span>
                <span style={{ fontSize: 8, color: "#6060aa" }}>next citizen</span>
              </div>
              <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                <div style={{
                  height: "100%", width: `${pct}%`,
                  background: "linear-gradient(90deg, #9945FF, #c084fc)",
                  borderRadius: 2,
                  transition: "width 1s linear",
                }} />
              </div>
            </div>

            {/* Score + leaderboard */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {wallet ? (
                <span style={{ fontSize: 9, color: "#14F195", flex: 1 }}>
                  ★ {myScore} found
                </span>
              ) : (
                <span style={{ fontSize: 8, color: "#3a3a5a", flex: 1 }}>Connect wallet</span>
              )}
              <button className="hunt-btn" onClick={() => setShowLeaderboard(true)} style={{
                background: "rgba(153,69,255,0.1)",
                border: "1px solid rgba(153,69,255,0.22)",
                borderRadius: 7, padding: "5px 10px",
                color: "#9945FF", fontSize: 9, cursor: "pointer",
              }}>
                🏆
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
