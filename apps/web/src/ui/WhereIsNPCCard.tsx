"use client";

import { PixelImg, ICON, RankBadge } from "@/ui/PixelIcons";
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
import { useNicknames, shortWallet } from "@/ui/useNicknames";
import { fetchBoard, invalidateBoard, type BoardRow } from "@/game/leaderboards/boards";
import { track } from "@/game/telemetry/track";
import { cachedName, requestNames } from "@/game/names/nameService";
import { chamferBox, octagonFrame } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";

// ── Chroma key ────────────────────────────────────────────────────────────────
const CHROMA_R = 215, CHROMA_G = 123, CHROMA_B = 186, CHROMA_TOL = 30;

const AVATAR_BORDER_W = 2;

// clip-path alone cuts the corner off a rectangular `border` without leaving
// a stroke along the new diagonal edge. Faking a chamfered outline instead
// needs two stacked, independently-clipped layers: an outer one filled with
// the border color, and an inset inner one (by the border width) filled with
// the real background — the visible ring between them reads as the outline.
function chamferClip(corner: number): string {
  return `polygon(${corner}px 0, calc(100% - ${corner}px) 0, 100% ${corner}px, 100% calc(100% - ${corner}px), calc(100% - ${corner}px) 100%, ${corner}px 100%, 0 calc(100% - ${corner}px), 0 ${corner}px)`;
}

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
  // City-wide board, with this browser's own history as the fallback while it
  // loads (and if the store is unreachable).
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchBoard("hunt", { limit: 10 })
      .then((r) => { if (!cancelled) setRows(r.rows); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const entries = rows?.length
    ? rows.map((r) => ({ wallet: r.wallet, display: r.name ?? shortWallet(r.wallet), count: r.value }))
    : getLeaderboard(10);
  const { display } = useNicknames(entries.map((e) => e.wallet));
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
      animation: "fadeIn 0.15s ease",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        ...octagonFrame(1),
        background: "#0b0e1c",
        minWidth: 320, maxWidth: "90vw",
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
            <span style={{ marginRight: 6, verticalAlign: "middle", display: "inline-block" }}><RankBadge rank={1} size={16} /></span>LEADERBOARD
          </span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#14F0C6", fontSize: 15,
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
              No finds yet. Be the first!
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
              }}><RankBadge rank={i + 1} size={18} /></span>
              <span style={{ flex: 1, fontSize: 9, color: "#9090cc" }}>{display(e.wallet, e.display)}</span>
              <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 7, color: "#B7E928" }}>
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
      invalidateBoard("hunt");
      recordRoundWinner(getRoundIndex(), w);
      const isMe = w === effectiveWallet;
      if (isMe) incrementQuest(w, "hunt_3_npcs");
      // The finder's nickname when the city knows it; the short wallet is the
      // fallback while the name service answers, and for guests.
      requestNames([w]);
      const known = cachedName(w);
      setFoundMsg(isMe ? `You found them! ★ ${newScore}` : `${known ?? shortWallet(w)} found them!`);
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

  // The player's own total follows them across devices; the local count is
  // what shows until the board answers, and for guests.
  useEffect(() => {
    setMyScore(getMyScore(effectiveWallet));
    if (!wallet) return;
    let cancelled = false;
    fetchBoard("hunt", { wallet, limit: 50 })
      .then((r) => { if (!cancelled && r.mine && r.mine.value > 0) setMyScore(r.mine.value); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [effectiveWallet, wallet, foundMsg]);

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
        <HuntHowTo loadout={targetLoadout} isTouch={isTouch} onClose={() => setShowInfo(false)} />
      )}

      <div className="hunt-card" style={{
        borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
        borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
        imageRendering: "pixelated",
        width: isTouch ? 172 : 220,
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
          <PixelImg src={ICON.hunt} size={16} />
          <span style={{
            fontFamily: '"Press Start 2P", monospace', fontSize: 7,
            color: "#c084fc", letterSpacing: 0.5, flex: 1,
            lineHeight: 1.4,
          }}>FIND SOMEONE</span>
          <button className="hunt-btn" style={chamferBox(6, {
            background: "rgba(153,69,255,0.1)", border: "1px solid rgba(153,69,255,0.25)",
            color: "#9945FF", fontSize: 8,
            width: 22, height: 22, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          })}
            onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }}
            title="How to play"
          >?</button>
          <span className="hunt-collapse" style={{ color: "#444466", fontSize: 8, marginLeft: 2 }}>
            {collapsed ? "▲" : "▼"}
          </span>
        </div>

        {!collapsed && (
          <div style={{ padding: isTouch ? "9px 10px" : "12px 13px", display: "flex", flexDirection: "column", gap: isTouch ? 7 : 10 }}>
            {/* Found banner */}
            {foundMsg && (
              <div style={chamferBox(8, {
                background: "rgba(183,233,40,0.08)", border: "1px solid rgba(183,233,40,0.25)",
                padding: "7px 10px",
                fontSize: 8, color: "#B7E928",
                textAlign: "center", lineHeight: 1.4,
                animation: "slideUp 0.2s ease",
              })}>
                {foundMsg}
              </div>
            )}

            {/* Avatar */}
            {targetLoadout ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div style={chamferBox(10, {
                  padding: AVATAR_BORDER_W,
                  background: "rgba(153,69,255,0.18)",
                })}>
                  <div style={chamferBox(10 - AVATAR_BORDER_W, {
                    background: "rgba(153,69,255,0.07)",
                    padding: isTouch ? 6 : 8,
                  })}>
                    <MiniAvatar loadout={targetLoadout} size={isTouch ? 60 : 88} />
                  </div>
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
                  {mm}:{ss}
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
                <span style={{ fontSize: 9, color: "#B7E928", flex: 1 }}>
                  ★ {myScore} found
                </span>
              ) : (
                <span style={{ fontSize: 8, color: "#3a3a5a", flex: 1 }}>Connect wallet</span>
              )}
              <button className="hunt-btn" onClick={() => setShowLeaderboard(true)} style={chamferBox(7, {
                background: "rgba(153,69,255,0.1)",
                border: "1px solid rgba(153,69,255,0.22)",
                padding: "5px 10px",
                color: "#9945FF", fontSize: 9, cursor: "pointer",
              })}>
                <RankBadge rank={1} size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── How to play (cards) ───────────────────────────────────────────────────────

const PIX = '"Press Start 2P", monospace';

function HuntKey({ label }: { label: string }) {
  return (
    <ChamferGlow glow="drop-shadow(0 4px 0 #64748b)" style={{ display: "inline-flex" }}>
      <span style={chamferBox(5, {
        display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 34, height: 32, padding: "0 6px",
        background: "#f8fafc", color: "#0a0a14", fontFamily: PIX, fontSize: 11,
      })}>
        {label}
      </span>
    </ChamferGlow>
  );
}

function HuntHowTo({ loadout, isTouch, onClose }: { loadout: Loadout | null; isTouch: boolean; onClose: () => void }) {
  useEffect(() => { track("tutorial", "find-someone", { value: 1, label: "opened" }); }, []);
  const [i, setI] = useState(0);
  const target = loadout
    ? <MiniAvatar loadout={loadout} size={96} />
    : <div aria-hidden style={{ width: 96, height: 96, backgroundImage: 'url("/assets/sprites/main_char.png")', backgroundSize: "384px 384px", backgroundPosition: "0 0", imageRendering: "pixelated" }} />;

  const steps = [
    {
      title: "WHO TO FIND",
      line: "The card shows who to find. Look for them in the city.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={chamferBox(10, { border: "2px solid rgba(153,69,255,0.6)", padding: 4, background: "rgba(153,69,255,0.08)" })}>{target}</div>
          <PixelImg src={ICON.hunt} size={40} />
        </div>
      ),
    },
    {
      title: "SAY HI",
      line: isTouch ? "Walk up to them and tap ACT." : "Walk up to them and press E.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {target}
          {isTouch
            ? <img src="/assets/ui/btn_act.png" alt="" style={{ height: 60, imageRendering: "pixelated" }} />
            : <HuntKey label="E" />}
        </div>
      ),
    },
    {
      title: "BE FIRST",
      line: "The first player to find them wins. A new citizen every 5 minutes.",
      scene: (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <RankBadge rank={1} size={44} />
          <div style={{ width: 180, height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
            <div className="hunt-timer-demo" style={{ height: "100%", background: "linear-gradient(90deg, #9945FF, #c084fc)" }} />
          </div>
        </div>
      ),
    },
  ];
  const step = steps[i];
  const last = i === steps.length - 1;
  const next = () => (last ? onClose() : setI((n) => n + 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); if (last) onClose(); else setI((n) => n + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, onClose]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(4,6,16,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
    >
      <style>{`@keyframes hunt-timer { from { width: 100%; } to { width: 4%; } } .hunt-timer-demo { animation: hunt-timer 3s linear infinite; }`}</style>
      <div style={{
        ...octagonFrame(1),
        width: "min(400px, 100%)", maxHeight: "100%", overflowY: "auto", padding: 8,
        background: "#0c0f1e", fontFamily: PIX,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <PixelImg src={ICON.hunt} size={16} />
          <span style={{ color: "#c084fc", fontSize: 8 }}>FIND SOMEONE</span>
          <span style={{ marginLeft: "auto", color: "#555577", fontSize: 7 }}>{i + 1}/{steps.length}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "#14F0C6", fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
        <div key={i} style={chamferBox(10, {
          height: isTouch ? 118 : 140, display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 50% 60%, rgba(153,69,255,0.14), rgba(12,15,30,0) 70%), #10132a",
          border: "1px solid rgba(153,69,255,0.18)", overflow: "hidden",
        })}>
          {step.scene}
        </div>
        <div style={{ textAlign: "center", color: "#fff", fontSize: 9, margin: "12px 0 6px" }}>{step.title}</div>
        <div style={{ textAlign: "center", color: "#a0a0cc", fontSize: 8, lineHeight: 1.7, minHeight: "3.4em", marginBottom: 12 }}>{step.line}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setI((n) => Math.max(0, n - 1))}
            style={chamferBox(8, { background: "transparent", border: "1px solid #333355", color: "#8888aa", padding: "9px 12px", cursor: "pointer", fontFamily: PIX, fontSize: 7, visibility: i === 0 ? "hidden" : "visible" })}
          >
            BACK
          </button>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 5 }}>
            {steps.map((st, n) => (
              <span key={st.title} style={{ width: n === i ? 16 : 6, height: 6, borderRadius: 3, background: n === i ? "#9945FF" : "#333355", transition: "width .2s" }} />
            ))}
          </div>
          <button
            onClick={next}
            style={chamferBox(8, { background: "#9945FF", color: "#fff", border: "none", padding: "10px 16px", cursor: "pointer", fontFamily: PIX, fontSize: 7 })}
          >
            {last ? "GOT IT" : "NEXT"}
          </button>
        </div>
      </div>
    </div>
  );
}
