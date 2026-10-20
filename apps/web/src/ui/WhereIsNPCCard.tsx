"use client";

import { PixelImg, ICON, RankBadge, CloseButton } from "@/ui/PixelIcons";
import { useState, useEffect, useRef, useCallback, type CSSProperties, type ReactNode } from "react";
import {
  getRoundIndex, getCitizenMsRemaining, CITIZEN_MS, recordFind, getMyScore,
  getLeaderboard, recordRoundWinner, getHuntWinner,
  type ScoreEntry,
} from "@/game/minigames/whereIsNPC/WhereIsNPCGame";
import {
  LAYER_ORDER, getVariant,
  SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, type Loadout,
} from "@/game/config/paperDoll";
import { recolorHairCanvas } from "@/game/config/hairPalette";
import { incrementQuest } from "@/game/quests/QuestManager";
import { useNicknames, shortWallet } from "@/ui/useNicknames";
import { fetchBoard, invalidateBoard, type BoardResult } from "@/game/leaderboards/boards";
import { track } from "@/game/telemetry/track";
import { cachedName, requestNames } from "@/game/names/nameService";
import { chamferBox, octagonFrame } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";
import { useEscape } from "@/ui/useEscape";
import Presence from "@/ui/Presence";

// ── Chroma key ────────────────────────────────────────────────────────────────
const CHROMA_R = 215, CHROMA_G = 123, CHROMA_B = 186, CHROMA_TOL = 30;

const AVATAR_BORDER_W = 2;

/** How long a phone shows who found the citizen before the window shrinks back. */
const FOUND_NEWS_MS = 10_000;

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
          // willReadFrequently: de-chroma reads this back, and maskHairWithHat
          // reads the hair/hat canvases again. Must be the first getContext for
          // the canvas — later calls reuse the context and ignore the options.
          const oc = off.getContext("2d", { willReadFrequently: true })!;
          oc.drawImage(
            img, 0, 0, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT,
            0, 0, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT,
          );
          removeChroma(oc, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
          // Before maskHairWithHat reads it back.
          if (cat === "hair") {
            recolorHairCanvas(oc, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, loadout.hairColor);
          }
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
/** One line of the board: place, name, finds. `you` lights it up. */
function BoardRowView({ rank, name, count, you, compact, last, rowRef }: {
  rank: number | null; name: string; count: number; you: boolean; compact: boolean; last?: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={rowRef} style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: compact ? "6px 8px" : "10px 10px",
      borderBottom: last ? "none" : "1px solid rgba(183,233,40,0.07)",
      ...(you ? { background: "rgba(183,233,40,0.14)", boxShadow: "inset 3px 0 0 #B7E928" } : null),
    }}>
      <span style={{ minWidth: 34, fontSize: you ? 9 : 7, color: you ? "#B7E928" : undefined }}>
        {rank === null ? "—" : you && rank > 3 ? `#${rank}` : <RankBadge rank={rank} size={18} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 9, color: you ? "#fff" : "#9090cc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
        {you && <span style={{ marginLeft: 8, fontSize: 7, color: "#B7E928" }}>YOU</span>}
      </span>
      <span style={{ fontSize: 7, color: "#B7E928", flexShrink: 0 }}>{count} ★</span>
    </div>
  );
}

/**
 * The hunt's top 10 and where you stand. Your own line is lit wherever it is; a
 * player outside the top 10 gets a line of their own under the list, with their
 * exact place, which stays on screen while the list scrolls.
 */
function LeaderboardModal({ wallet, me, compact, onClose }: {
  /** The connected wallet; null for a guest, who has no place on the city board. */
  wallet: string | null;
  /** The id this browser files its own finds under ("guest" without a wallet). */
  me: string;
  compact: boolean;
  onClose: () => void;
}) {
  useEscape(onClose);
  // City-wide board, with this browser's own history as the fallback while it
  // loads (and if the store is unreachable).
  const [board, setBoard] = useState<BoardResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchBoard("hunt", { wallet, limit: 10, force: true })
      // Only a board that ANSWERED replaces the local fallback. An empty answer
      // is still an answer: a city board that has just been cleared shows
      // nobody, rather than resurrecting this browser's own old scores.
      .then((r) => { if (!cancelled && r.ok) setBoard(r); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [wallet]);

  const local = board ? null : getLeaderboard(100);
  const entries = board
    ? board.rows.map((r) => ({ wallet: r.wallet, display: r.name ?? shortWallet(r.wallet), count: r.value }))
    : local!.slice(0, 10);
  const myId = wallet ?? me;
  const myIndex = entries.findIndex((e) => e.wallet === myId);

  // Where I stand when I am not in the ten shown: the city's own answer, or
  // this browser's list when the city did not answer.
  let outside: { rank: number | null; count: number } | null = null;
  if (myIndex < 0 && (wallet || !board)) {
    if (board) outside = { rank: board.mine?.rank ?? null, count: board.mine?.value ?? 0 };
    else {
      const at = local!.findIndex((e) => e.wallet === myId);
      outside = { rank: at < 0 ? null : at + 1, count: getMyScore(myId) };
    }
  }

  const { display } = useNicknames(wallet ? [...entries.map((e) => e.wallet), wallet] : entries.map((e) => e.wallet));
  const myName = wallet ? display(wallet, shortWallet(wallet)) : "YOU";

  // The list scrolls on a small screen: bring my line into view when it is there.
  const mineRef = useRef<HTMLDivElement>(null);
  useEffect(() => { mineRef.current?.scrollIntoView({ block: "nearest" }); }, [myIndex, board]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
      // A phone's own edges and notch, so the window is never cut off by them.
      padding: "max(env(safe-area-inset-top, 0px), 8px) max(env(safe-area-inset-right, 0px), 8px) max(env(safe-area-inset-bottom, 0px), 8px) max(env(safe-area-inset-left, 0px), 8px)",
      background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sc-pop" style={{
        ...octagonFrame(1),
        background: "#0b0e1c",
        width: "min(420px, 100%)", maxHeight: "100%",
        display: "flex", flexDirection: "column",
        fontFamily: '"Press Start 2P", monospace', color: "#d0d0f0",
        overflow: "hidden",
      }}>
        <div style={{
          padding: compact ? "6px 12px" : "16px 20px", background: "rgba(183,233,40,0.07)",
          borderBottom: "1px solid rgba(183,233,40,0.1)", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PixelImg src="/assets/ui/icon_leaderboard1.png" size={compact ? 20 : 24} />
            <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: compact ? 10 : 12, color: "#B7E928", letterSpacing: 2 }}>
              LEADERBOARD
            </span>
          </div>
          <CloseButton onClick={onClose} size={20} />
        </div>

        {/* The only part that scrolls: the header and my own line stay put. */}
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: compact ? "4px 8px" : "8px 12px" }}>
          {entries.length === 0 ? (
            <div style={{ color: "#444466", fontSize: 9, padding: "20px 0", textAlign: "center" }}>
              No finds yet. Be the first!
            </div>
          ) : entries.map((e, i) => (
            <BoardRowView
              key={e.wallet} rank={i + 1} name={display(e.wallet, e.display)} count={e.count}
              you={i === myIndex} compact={compact} last={i === entries.length - 1}
              rowRef={i === myIndex ? mineRef : undefined}
            />
          ))}
        </div>

        {outside && (
          <div style={{ flexShrink: 0, padding: compact ? "0 8px 6px" : "0 12px 12px", borderTop: "1px solid rgba(183,233,40,0.25)", background: "#0b0e1c" }}>
            <div style={{ fontSize: 7, color: "#6060aa", padding: compact ? "4px 8px 0" : "8px 10px 2px" }}>
              {outside.rank === null ? "NOT RANKED YET" : "YOUR PLACE"}
            </div>
            <BoardRowView rank={outside.rank} name={myName} count={outside.count} you compact={compact} last />
          </div>
        )}
        {!wallet && board && (
          <div style={{ flexShrink: 0, padding: "8px 12px", borderTop: "1px solid rgba(183,233,40,0.1)", fontSize: 7, color: "#6060aa", textAlign: "center", lineHeight: 1.6 }}>
            CONNECT A WALLET TO GET A PLACE
          </div>
        )}
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
  // Touch gets its own layout (MobileHunt): wide and short beside the rail
  // button, so it does not swallow the small game view.
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
  // With the time it was said, so the same line said twice (two lost claims
  // in a row) still counts as news and restarts the phone's countdown.
  const [found, setFound] = useState<{ msg: string; at: number } | null>(null);
  const foundMsg = found?.msg ?? null;
  const announce = useCallback((msg: string) => setFound({ msg, at: Date.now() }), []);
  const [round, setRound] = useState(getRoundIndex());
  const infoFeel = useButtonFeel();
  const collapseFeel = useButtonFeel();

  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft(getCitizenMsRemaining());
      const newRound = getRoundIndex();
      if (newRound === round) return;
      setRound(newRound);
      // A round only ends two ways, and the chain says which: somebody claimed
      // the citizen, or it ran out of time. Everyone used to see neither —
      // the "found" event is local to the winner, so to every other player a
      // citizen simply vanished and another took its place. The claim is on
      // chain with the finder on it, so the city can be told who got there
      // first, in the line the finder's own message already uses.
      const winner = getHuntWinner();
      if (!winner) { setFound(null); return; }             // nobody found that one
      if (winner === effectiveWallet) return;              // my own message stands
      requestNames([winner]);
      announce(`${cachedName(winner) ?? shortWallet(winner)} found them!`);
    }, 1000);
    return () => clearInterval(id);
  }, [round, effectiveWallet, announce]);

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
      announce(isMe ? `You found them! ★ ${newScore}` : `${known ?? shortWallet(w)} found them!`);
      if (isMe) setMyScore(newScore);
      setTargetLoadout(null);
      // The game layer reset the per-citizen timer before firing this event,
      // so reflect the fresh full countdown immediately.
      setMsLeft(getCitizenMsRemaining());
    };
    // The press did not reach the chain, so it did not count and the citizen is
    // back. Said once, in the same spot the find message uses.
    const onClaimLost = () => announce("Did not count. Try again!");
    const onRoundCheck = () => {
      setMsLeft(getCitizenMsRemaining());
      gameRef.events.emit("whereIsNPC:requestTarget");
    };
    const onTargetInfo = (loadout: Loadout) => setTargetLoadout(loadout);

    gameRef.events.on("whereIsNPC:found", onFound);
    gameRef.events.on("whereIsNPC:claimLost", onClaimLost);
    gameRef.events.on("whereIsNPC:roundCheck", onRoundCheck);
    gameRef.events.on("whereIsNPC:targetInfo", onTargetInfo);
    gameRef.events.emit("whereIsNPC:requestTarget");
    return () => {
      gameRef.events.off("whereIsNPC:found", onFound);
      gameRef.events.off("whereIsNPC:claimLost", onClaimLost);
      gameRef.events.off("whereIsNPC:roundCheck", onRoundCheck);
      gameRef.events.off("whereIsNPC:targetInfo", onTargetInfo);
    };
  }, [gameRef, effectiveWallet, round, announce]);

  // The player's own total follows them across devices; the local count is
  // what shows until the board answers, and for guests.
  useEffect(() => {
    setMyScore(getMyScore(effectiveWallet));
    if (!wallet) return;
    let cancelled = false;
    fetchBoard("hunt", { wallet, limit: 50 })
      // The city's number wins once it arrives, zero included. Keeping the
      // local count whenever the board said zero meant a cleared board left
      // every player still looking at their old total, which reads as a reset
      // that did nothing.
      .then((r) => { if (!cancelled && r.ok) setMyScore(r.mine?.value ?? 0); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [effectiveWallet, wallet, foundMsg]);

  // On a phone the news is up for FOUND_NEWS_MS and then the panel or strip
  // shrinks back; the desktop card keeps it until the round after.
  const [newsUp, setNewsUp] = useState(false);
  useEffect(() => {
    setNewsUp(found !== null);
    if (!found) return;
    const id = setTimeout(() => setNewsUp(false), FOUND_NEWS_MS);
    return () => clearTimeout(id);
  }, [found]);

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
        .hunt-card:hover { box-shadow: 0 6px 40px rgba(183,233,40,0.18) !important; }
        .hunt-btn { transition: background 0.15s ease, transform 0.1s ease; }
        .hunt-btn:hover { transform: scale(1.05); }
        .hunt-btn:active { transform: scale(0.97); }
        .hunt-collapse { transition: color 0.15s ease; }
        .hunt-collapse:hover { color: #B7E928 !important; }
        @keyframes huntIn { from { transform: translateX(-6px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
      `}</style>

      <Presence show={showLeaderboard}>
        <LeaderboardModal wallet={wallet} me={effectiveWallet} compact={isTouch} onClose={() => setShowLeaderboard(false)} />
      </Presence>

      <Presence show={showInfo}>
        <HuntHowTo loadout={targetLoadout} isTouch={isTouch} onClose={() => setShowInfo(false)} />
      </Presence>

      {isTouch ? (
        <MobileHunt
          collapsed={collapsed} onCollapse={setCollapsed}
          loadout={targetLoadout} time={`${mm}:${ss}`} pct={pct}
          score={wallet ? myScore : null} foundMsg={newsUp ? foundMsg : null} infoOpen={showInfo}
          onInfo={() => setShowInfo(v => !v)} onLeaderboard={() => setShowLeaderboard(true)}
        />
      ) : (
      <div className="hunt-card" style={{
        borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
        borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
        imageRendering: "pixelated",
        width: 224,
        fontFamily: '"Press Start 2P", monospace',
        color: "#d0d0f0",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "11px 13px",
          borderBottom: collapsed ? "none" : "1px solid rgba(183,233,40,0.1)",
          cursor: "pointer",
          userSelect: "none",
        }} onClick={() => setCollapsed(v => !v)}>
          <PixelImg src={ICON.hunt} size={26} />
          <span style={{
            fontFamily: '"Press Start 2P", monospace', fontSize: 7,
            color: "#B7E928", letterSpacing: 0.5, flex: 1,
            lineHeight: 1.4,
          }}>FIND SOMEONE</span>
          <span style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <button className="hunt-btn" style={{
              backgroundImage: "url(/assets/ui/icon_frame_btn.png)", backgroundSize: "100% 100%",
              imageRendering: "pixelated", border: "none",
              color: showInfo ? "#B7E928" : "#9a9ab5",
              fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: "bold", fontSize: 11,
              width: 22, height: 22, padding: 0, lineHeight: "12px", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              ...feelStyle(infoFeel),
            }}
              onClick={e => { e.stopPropagation(); setShowInfo(v => !v); }}
              {...infoFeel.handlers}
              title="How to play"
            >?</button>
            <button
              onClick={e => { e.stopPropagation(); setCollapsed(v => !v); }}
              {...collapseFeel.handlers}
              style={{
                backgroundImage: "url(/assets/ui/icon_frame_btn.png)", backgroundSize: "100% 100%",
                imageRendering: "pixelated", border: "none",
                width: 22, height: 22, padding: 0, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                ...feelStyle(collapseFeel),
              }}
              title={collapsed ? "Expand" : "Collapse"}
            >
              <PixelImg src="/assets/ui/icon_down1.png" size={12} style={{ transform: collapsed ? "rotate(180deg)" : undefined }} />
            </button>
          </span>
        </div>

        {!collapsed && (
          <div style={{ padding: "23.5px 13px", display: "flex", flexDirection: "column", gap: 10 }}>
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
                  background: "rgba(183,233,40,0.18)",
                })}>
                  <div style={chamferBox(10 - AVATAR_BORDER_W, {
                    background: "rgba(183,233,40,0.07)",
                    padding: 8,
                  })}>
                    <MiniAvatar loadout={targetLoadout} size={88} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                height: 104, display: "flex", alignItems: "center", justifyContent: "center",
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
              <TimerBar pct={pct} />
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
              <LeaderboardButton onClick={() => setShowLeaderboard(true)} />
            </div>
          </div>
        )}
      </div>
      )}
    </>
  );
}

/** Time left on the current citizen, as a lime bar. */
function TimerBar({ pct, height = 3 }: { pct: number; height?: number }) {
  return (
    <div style={{ height, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
      <div style={{
        height: "100%", width: `${pct}%`,
        background: "#B7E928",
        borderRadius: 2,
        transition: "width 1s linear",
      }} />
    </div>
  );
}

// ── Mobile layout ─────────────────────────────────────────────────────────────

/**
 * The panel art drawn at half the desktop card's 20px, with a 5px layout
 * border: content starts where the art's teal band ends instead of a whole
 * band further in, which is what keeps the mobile panel short.
 */
const THIN_FRAME: CSSProperties = {
  borderWidth: 5, borderStyle: "solid", borderColor: "transparent",
  borderImage: "url(/assets/branding/ui/frame-panel-test.png) 64 fill / 10px / 0 round",
  imageRendering: "pixelated",
};

/** A square button on the frame-button art, like the desktop card's header ones. */
function FrameBtn({ size, title, onClick, children }: {
  size: number; title: string; onClick: () => void; children: ReactNode;
}) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      {...feel.handlers}
      title={title} aria-label={title}
      style={{
        backgroundImage: "url(/assets/ui/icon_frame_btn.png)", backgroundSize: "100% 100%",
        imageRendering: "pixelated", border: "none",
        width: size, height: size, padding: 0, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        ...feelStyle(feel),
      }}
    >
      {children}
    </button>
  );
}

/** The ▼ art turned to point left (collapse, toward the rail icon) or right (expand). */
function Arrow({ dir }: { dir: "left" | "right" }) {
  return <PixelImg src="/assets/ui/icon_down1.png" size={12} style={{ transform: `rotate(${dir === "left" ? 90 : -90}deg)` }} />;
}

/**
 * The citizen to find, in the lime-ringed box. `small` is the strip's version:
 * the whole figure at half size, in a 32px box. Halving keeps the pixels
 * square (each CSS pixel is 2x2 of the sprite), and on a 2x phone screen
 * every sprite pixel is still one device pixel.
 */
function HuntPortrait({ loadout, small = false }: { loadout: Loadout | null; small?: boolean }) {
  const corner = small ? 6 : 10;
  return (
    <div style={chamferBox(corner, { padding: AVATAR_BORDER_W, background: "rgba(183,233,40,0.18)", flexShrink: 0 })}>
      <div style={chamferBox(corner - AVATAR_BORDER_W, {
        background: "rgba(183,233,40,0.07)",
        width: small ? 32 : 64, height: small ? 32 : 64, padding: small ? 0 : 4, boxSizing: "content-box",
        position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      })}>
        {!loadout ? (
          <span style={{ fontSize: 8, color: "#3a3a5a" }}>...</span>
        ) : small ? (
          <div style={{ position: "absolute", left: 0, top: 0, transform: "scale(0.5)", transformOrigin: "0 0" }}>
            <MiniAvatar loadout={loadout} />
          </div>
        ) : (
          <MiniAvatar loadout={loadout} />
        )}
      </div>
    </div>
  );
}

/**
 * Who found the last citizen (or that your claim did not count), along the
 * bottom of the panel or the strip: the window grows by this one row while
 * there is news, rather than a separate toast covering the city.
 */
function FoundBanner({ msg }: { msg: string }) {
  return (
    <div style={chamferBox(6, {
      marginTop: 5, padding: "5px 6px",
      background: "rgba(183,233,40,0.08)", border: "1px solid rgba(183,233,40,0.25)",
      fontSize: 8, color: "#B7E928", textAlign: "center", lineHeight: 1.5,
      overflowWrap: "anywhere",
      animation: "slideUp 0.2s ease",
    })}>
      {msg}
    </div>
  );
}

/**
 * Find Someone on a phone: the portrait on the left and everything else on
 * its right, in one short panel beside the rail button, so the hunt costs the
 * game view as little height as possible. The ◀ folds it toward the rail icon
 * into a strip with just the citizen and the time left, which can stay up
 * while you search; the › (or a tap on the strip) opens the full panel again.
 */
function MobileHunt({
  collapsed, onCollapse, loadout, time, pct, score, foundMsg, infoOpen, onInfo, onLeaderboard,
}: {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  loadout: Loadout | null;
  /** m:ss left on this citizen. */
  time: string;
  pct: number;
  /** Citizens found, or null for a guest (no wallet, so nothing is counted). */
  score: number | null;
  foundMsg: string | null;
  infoOpen: boolean;
  onInfo: () => void;
  onLeaderboard: () => void;
}) {
  if (collapsed) {
    return (
      <div
        className="hunt-strip"
        onClick={() => onCollapse(false)}
        style={{
          // A set width, so a long finder's name wraps inside the strip
          // instead of stretching it sideways.
          ...THIN_FRAME, padding: 3, width: 140, boxSizing: "border-box",
          fontFamily: PIX, cursor: "pointer", userSelect: "none",
          animation: "huntIn 0.15s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <HuntPortrait loadout={loadout} small />
          <div style={{ width: 48, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, color: "#fff" }}>{time}</span>
            <TimerBar pct={pct} height={4} />
          </div>
          <FrameBtn size={28} title="Expand" onClick={() => onCollapse(false)}>
            <Arrow dir="right" />
          </FrameBtn>
        </div>
        {foundMsg && <FoundBanner msg={foundMsg} />}
      </div>
    );
  }

  return (
    <div
      className="hunt-panel"
      style={{
        ...THIN_FRAME, padding: 5, width: 300, boxSizing: "border-box",
        fontFamily: PIX, color: "#d0d0f0",
        animation: "huntIn 0.15s ease",
      }}
    >
      <div style={{ display: "flex", gap: 10 }}>
        <HuntPortrait loadout={loadout} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PixelImg src={ICON.hunt} size={18} />
            <span style={{ fontSize: 8, color: "#B7E928", flex: 1, whiteSpace: "nowrap" }}>FIND SOMEONE</span>
            <FrameBtn size={24} title="How to play" onClick={onInfo}>
              <span style={{
                color: infoOpen ? "#B7E928" : "#9a9ab5",
                fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: "bold", fontSize: 11, lineHeight: "12px",
              }}>?</span>
            </FrameBtn>
            <FrameBtn size={24} title="Collapse" onClick={() => onCollapse(true)}>
              <Arrow dir="left" />
            </FrameBtn>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#fff" }}>{time}</span>
            <span style={{ fontSize: 8, color: "#6060aa" }}>NEXT CITIZEN</span>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <TimerBar pct={pct} height={4} />
              {score !== null
                ? <span style={{ fontSize: 8, color: "#B7E928" }}>★ {score} FOUND</span>
                : <span style={{ fontSize: 8, color: "#3a3a5a" }}>CONNECT WALLET</span>}
            </div>
            <LeaderboardButton onClick={onLeaderboard} />
          </div>
        </div>
      </div>

      {foundMsg && <FoundBanner msg={foundMsg} />}
    </div>
  );
}

/**
 * Opens the leaderboard, styled like the HUD icon buttons (Wardrobe,
 * Calendar, Map in page.tsx: a bare image with a hover glow, no separate
 * background/border chrome) rather than the chamfer-box button it used to
 * be — just smaller, since this one sits inside a card instead of the HUD.
 */
function LeaderboardButton({ onClick }: { onClick: () => void }) {
  const feel = useButtonFeel();
  return (
    <button
      onClick={onClick} title="Leaderboard" aria-label="Leaderboard"
      {...feel.handlers}
      style={{
        width: 22, height: 22, padding: 0, border: "none", background: "none",
        cursor: "pointer", flexShrink: 0, display: "block",
        filter: feel.pressed ? "brightness(1.1)" : feel.hover ? "brightness(1.25) drop-shadow(0 0 4px rgba(20,240,198,0.7))" : "none",
        transform: feel.pressed ? "scale(0.92)" : feel.hover ? "translateY(-1px)" : "none",
        transition: "filter 0.12s, transform 0.08s",
      }}
    >
      <img src="/assets/ui/icon_leaderboard.png" alt="" draggable={false}
        style={{ width: "100%", height: "100%", imageRendering: "pixelated", display: "block" }} />
    </button>
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
  const backFeel = useButtonFeel();
  const nextFeel = useButtonFeel();
  const target = loadout
    ? <MiniAvatar loadout={loadout} size={96} />
    : <div aria-hidden style={{ width: 96, height: 96, backgroundImage: 'url("/assets/sprites/main_char.png")', backgroundSize: "384px 384px", backgroundPosition: "0 0", imageRendering: "pixelated" }} />;

  const steps = [
    {
      title: "WHO TO FIND",
      line: "The card shows who to find. Look for them in the city.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={chamferBox(10, { border: "2px solid rgba(183,233,40,0.6)", padding: 4, background: "rgba(183,233,40,0.08)" })}>{target}</div>
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
            <div className="hunt-timer-demo" style={{ height: "100%", background: "#B7E928" }} />
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, onClose]);
  useEscape(onClose);

  return (
    <div
      className="sc-fade"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(4,6,16,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
    >
      <style>{`@keyframes hunt-timer { from { width: 100%; } to { width: 4%; } } .hunt-timer-demo { animation: hunt-timer 3s linear infinite; }`}</style>
      <div className="sc-pop" style={{
        ...octagonFrame(1),
        width: "min(400px, 100%)", maxHeight: "100%", overflowY: "auto", padding: 8,
        background: "#0c0f1e", fontFamily: PIX,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <PixelImg src={ICON.hunt} size={26} />
          <span style={{ color: "#B7E928", fontSize: 8 }}>FIND SOMEONE</span>
          <span style={{ marginLeft: "auto", color: "#555577", fontSize: 7 }}>{i + 1}/{steps.length}</span>
          <CloseButton onClick={onClose} />
        </div>
        <div key={i} style={chamferBox(10, {
          height: isTouch ? 118 : 140, display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 50% 60%, rgba(183,233,40,0.14), rgba(12,15,30,0) 70%), #10132a",
          border: "1px solid rgba(183,233,40,0.18)", overflow: "hidden",
        })}>
          {step.scene}
        </div>
        <div style={{ textAlign: "center", color: "#fff", fontSize: 9, margin: "12px 0 6px" }}>{step.title}</div>
        <div style={{ textAlign: "center", color: "#a0a0cc", fontSize: 8, lineHeight: 1.7, minHeight: "3.4em", marginBottom: 12 }}>{step.line}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setI((n) => Math.max(0, n - 1))}
            {...backFeel.handlers}
            style={chamferBox(8, { background: "transparent", border: "1px solid #333355", color: "#8888aa", padding: "9px 12px", cursor: "pointer", fontFamily: PIX, fontSize: 7, visibility: i === 0 ? "hidden" : "visible", ...feelStyle(backFeel) })}
          >
            BACK
          </button>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 5 }}>
            {steps.map((st, n) => (
              <span key={st.title} style={{ width: n === i ? 16 : 6, height: 6, background: n === i ? "#B7E928" : "#333355", transition: "width .2s" }} />
            ))}
          </div>
          <button
            onClick={next}
            {...nextFeel.handlers}
            style={chamferBox(8, { background: "#B7E928", color: "#0a0a14", border: "none", padding: "10px 16px", cursor: "pointer", fontFamily: PIX, fontSize: 7, ...feelStyle(nextFeel) })}
          >
            {last ? "GOT IT" : "NEXT"}
          </button>
        </div>
      </div>
    </div>
  );
}
