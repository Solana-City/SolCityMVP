"use client";

import { useEffect, useState, useCallback } from "react";
import { CATEGORY_LABELS } from "@/game/config/paperDoll";
import {
  PACKS, RARITY_COLOR, RARITY_LABEL, RARITY_ORDER, CURRENT_SEASON,
  rollPack, type PackDef, type PackDrop,
} from "@/game/config/packs";
import { unlockItem } from "@/game/config/wardrobeUnlocks";
import { progressionBus } from "@/game/progression/progressionBus";
import { ChromaPreview } from "@/ui/WardrobePanel";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";
import { useButtonFeel, feelStyle, type ButtonFeel } from "@/ui/useButtonFeel";

/**
 * Outfit packs — PREVIEW. Three packs, each with its own odds per rarity,
 * drawing from the season the city is in.
 *
 * Randomness is client-side here; the shipped version draws the same pool
 * through MagicBlock VRF and grants the unlocks in a program instruction. The
 * program does NOT know about packs, rarities or seasons yet — that is the
 * work listed in BOOSTER_SPEC.md under "Before the redeploy", and none of this
 * can take money until it lands. Reveal UX is final.
 *
 * Pack art is an animated strip (see SPRITE_REQUESTS.md). Until a pack's sheet
 * is drawn, its card falls back to the wardrobe icon rather than an empty box.
 */
export default function BoosterOverlay({
  wallet, onClose,
}: {
  wallet: string | null;
  onClose: () => void;
}) {
  const [pack, setPack] = useState<PackDef | null>(null);
  const [phase, setPhase] = useState<"choose" | "opening" | "revealed">("choose");
  const [drops, setDrops] = useState<PackDrop[]>([]);
  const laterFeel = useButtonFeel();
  const anotherFeel = useButtonFeel();
  const doneFeel = useButtonFeel();

  const open = useCallback((chosen: PackDef) => {
    if (!wallet) return;
    setPack(chosen);
    setPhase("opening");
    const rolled = rollPack(wallet, chosen);
    // Brief suspense, then reveal + grant.
    setTimeout(() => {
      let newCount = 0;
      for (const d of rolled) {
        if (unlockItem(wallet, d.category, d.id, d.name, true)) newCount++;
      }
      // One summary event → single toast + wardrobe re-render (the grants ran
      // silent so they don't spam a toast each).
      if (newCount > 0) {
        progressionBus.emit({
          type: "outfit-unlocked",
          outfitId: "booster",
          outfitName: `${newCount} new item${newCount === 1 ? "" : "s"} from a pack`,
        });
      }
      setDrops(rolled);
      setPhase("revealed");
    }, 650);
  }, [wallet]);

  const backToPacks = () => { setPhase("choose"); setDrops([]); setPack(null); };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(2,3,10,0.82)", backdropFilter: "blur(6px)",
        fontFamily: '"Press Start 2P", monospace',
        padding: 12, overflowY: "auto",
      }}
      onClick={e => { if (e.target === e.currentTarget && phase !== "opening") onClose(); }}
    >
      <style>{`
        @keyframes booster-shake { 0%,100%{transform:translateX(0) rotate(0)} 25%{transform:translateX(-4px) rotate(-3deg)} 75%{transform:translateX(4px) rotate(3deg)} }
        @keyframes booster-glow  { 0%,100%{filter:drop-shadow(0 0 12px rgba(183,233,40,0.5))} 50%{filter:drop-shadow(0 0 22px rgba(183,233,40,0.9))} }
        @keyframes booster-pop   { 0%{transform:scale(0.5) translateY(10px);opacity:0} 60%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
        @keyframes pack-roll     { from { background-position: 0 0 } to { background-position: var(--roll) 0 } }
      `}</style>

      <div style={{
        width: phase === "choose" ? "min(720px, 96vw)" : "min(560px, 94vw)",
        background: "#0b0e1c",
        borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
        borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
        imageRendering: "pixelated",
        padding: "22px 22px 18px",
        color: "#d0d0f0",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 10, color: "#B7E928", letterSpacing: 2, marginBottom: 4 }}>
          {phase === "choose" ? "OUTFIT PACKS" : pack?.name}
        </div>
        <div style={{ fontSize: 6, color: "#FFD700", opacity: 0.7, letterSpacing: 1, marginBottom: 18 }}>
          SEASON {CURRENT_SEASON} · PREVIEW · RANDOMNESS → MAGICBLOCK VRF
        </div>

        {!wallet ? (
          <div style={{ fontSize: 8, color: "#aaaacc", lineHeight: 1.8, padding: "20px 0" }}>
            Connect a wallet to open packs.
          </div>
        ) : phase === "choose" ? (
          <>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 12, marginBottom: 16,
            }}>
              {PACKS.map((p) => (
                <PackCard key={p.id} pack={p} onOpen={() => open(p)} />
              ))}
            </div>
            <button onClick={onClose} {...laterFeel.handlers} style={btn("ghost", laterFeel)}>LATER</button>
          </>
        ) : phase === "revealed" ? (
          <>
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.max(1, drops.length)}, 1fr)`,
              gap: 8, marginBottom: 18,
            }}>
              {drops.map((d, i) => (
                <div
                  key={`${d.category}:${d.id}`}
                  style={chamferBox(10, {
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                    padding: "10px 4px",
                    background: d.owned ? "rgba(255,255,255,0.02)" : `${RARITY_COLOR[d.rarity]}14`,
                    border: `2px solid ${d.owned ? "rgba(255,255,255,0.08)" : RARITY_COLOR[d.rarity]}`,
                    animation: `booster-pop 0.4s ${i * 0.09}s ease-out both`,
                  })}
                >
                  <ChromaPreview file={d.file} size={52} facingUp={d.category === "back"} />
                  <span style={{ fontSize: 6, color: "#e0d0ff", lineHeight: 1.3, textAlign: "center" }}>{d.name}</span>
                  <span style={{ fontSize: 5, color: "#7a7aa0", letterSpacing: 0.5 }}>
                    {CATEGORY_LABELS[d.category]}
                  </span>
                  <span style={{ fontSize: 5, letterSpacing: 0.5, color: RARITY_COLOR[d.rarity] }}>
                    {RARITY_LABEL[d.rarity]}
                  </span>
                  <span style={{
                    fontSize: 5, letterSpacing: 0.5,
                    color: d.owned ? "#888" : "#B7E928",
                  }}>{d.owned ? "OWNED" : "NEW"}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={backToPacks} {...anotherFeel.handlers} style={btn("ghost", anotherFeel)}>OPEN ANOTHER</button>
              <ChamferGlow glow={BTN_GLOW}><button onClick={onClose} {...doneFeel.handlers} style={btn("primary", doneFeel)}>DONE</button></ChamferGlow>
            </div>
          </>
        ) : (
          <div style={{
            display: "inline-block", margin: "6px auto 24px",
            animation: "booster-shake 0.16s linear infinite, booster-glow 0.5s ease-in-out infinite",
          }}>
            {pack && <PackArt pack={pack} scale={3} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** One pack on the chooser: its art, what it costs, and what it rolls. */
function PackCard({ pack, onOpen }: { pack: PackDef; onOpen: () => void }) {
  const openFeel = useButtonFeel();
  return (
    <div style={chamferBox(12, {
      padding: "14px 12px 12px",
      background: "rgba(255,255,255,0.02)",
      border: `2px solid ${pack.accent}55`,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
    })}>
      <PackArt pack={pack} scale={2} />
      <div style={{ fontSize: 8, color: pack.accent, letterSpacing: 1 }}>{pack.name}</div>
      <div style={{ fontSize: 6, color: "#8a8aa7", lineHeight: 1.6, minHeight: 20 }}>{pack.blurb}</div>

      {/* The odds, as a bar per rarity: a table of four percentages is four
          numbers nobody reads, where the bar says "this one is better" at a
          glance and still carries the number for whoever wants it. */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 3 }}>
        {RARITY_ORDER.map((r) => (
          <div key={r} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, flexShrink: 0, background: RARITY_COLOR[r] }} />
            <span style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)" }}>
              <span style={{
                display: "block", height: "100%",
                width: `${pack.odds[r]}%`, background: RARITY_COLOR[r],
              }} />
            </span>
            <span style={{ fontSize: 5, color: "#7a7aa0", width: 24, textAlign: "right" }}>
              {pack.odds[r]}%
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 6, color: "#7a7aa0", letterSpacing: 0.5 }}>
        {pack.size} PIECES · {pack.priceSol} SOL
      </div>
      <ChamferGlow glow={`drop-shadow(0 0 10px ${pack.accent}55)`} style={{ display: "block", width: "100%" }}>
        <button
          onClick={onOpen}
          {...openFeel.handlers}
          style={chamferBox(8, {
            width: "100%", fontFamily: '"Press Start 2P", monospace',
            fontSize: 7, letterSpacing: 1, padding: "10px 8px", cursor: "pointer",
            background: pack.accent, color: "#04140c", border: "none",
            ...feelStyle(openFeel),
          })}
        >
          OPEN
        </button>
      </ChamferGlow>
    </div>
  );
}

/**
 * A pack's animated sheet, played on a CSS step animation so it costs no
 * JavaScript per frame.
 *
 * Drawn at a WHOLE multiple of the frame, never at a target size: a 51px tall
 * bag stretched to fit an 84px box lands its pixels on fractions of a screen
 * pixel, and pixel art resampled at a fraction is the tearing the interface
 * was fixed for (see ui/crispPixels.ts). So the caller asks for 2x or 3x and
 * the box takes the size that follows.
 *
 * A missing file falls back to the wardrobe icon in the pack's own colour,
 * which is what the chooser showed before the art arrived.
 */
function PackArt({ pack, scale }: { pack: PackDef; scale: number }) {
  const width = pack.art.frameWidth * scale;
  const height = pack.art.frameHeight * scale;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setReady(true); };
    img.onerror = () => { if (alive) setReady(false); };
    img.src = pack.art.file;
    return () => { alive = false; };
  }, [pack.art.file]);

  if (!ready) {
    return (
      <div style={chamferBox(14, {
        width, height,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(135deg, ${pack.accent}33, rgba(183,233,40,0.12))`,
        border: `2px solid ${pack.accent}77`,
      })}>
        <img
          src="/assets/ui/ico_wardrop.png" alt="" draggable={false}
          style={{ width: width * 0.6, height: width * 0.6, imageRendering: "pixelated" }}
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden
      style={{
        width, height,
        backgroundImage: `url("${pack.art.file}")`,
        backgroundSize: `${width * pack.art.frames}px ${height}px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
        // The strip is walked one frame at a time and wraps at its full width.
        ["--roll" as string]: `-${width * pack.art.frames}px`,
        animation: `pack-roll ${(pack.art.frames / 8).toFixed(2)}s steps(${pack.art.frames}) infinite`,
      }}
    />
  );
}

const BTN_GLOW = "drop-shadow(0 0 10px rgba(183,233,40,0.45))";

function btn(kind: "primary" | "ghost", feel?: Pick<ButtonFeel, "hover" | "pressed">): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 9, letterSpacing: 1, padding: "12px 24px",
    cursor: "pointer",
  };
  return chamferBox(8, kind === "primary"
    ? { ...base, background: "#B7E928", color: "#0a0a14",
        border: "none", ...(feel ? feelStyle(feel) : null) }
    : { ...base, background: "transparent", color: "#8a8aa7", border: "1px solid rgba(183,233,40,0.3)", ...(feel ? feelStyle(feel) : null) });
}
