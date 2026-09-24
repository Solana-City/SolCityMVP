"use client";

import { useState, useCallback } from "react";
import { CATEGORY_LABELS } from "@/game/config/paperDoll";
import { rollBooster, PACK_SIZE, type BoosterDrop } from "@/game/config/boosterPool";
import { unlockItem } from "@/game/config/wardrobeUnlocks";
import { progressionBus } from "@/game/progression/progressionBus";
import { ChromaPreview } from "@/ui/WardrobePanel";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";

/**
 * Booster pack — PREVIEW. Opens a pack of 5 random wardrobe pieces and unlocks
 * them via the shared unlockItem() foundation. Randomness is client-side here;
 * the shipped version draws the same pool via MagicBlock VRF on-chain and grants
 * the unlocks in a program instruction (see BOOSTER_SPEC.md). The reveal UX is
 * final — only the entropy source + grant change.
 */
export default function BoosterOverlay({
  wallet, onClose,
}: {
  wallet: string | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "opening" | "revealed">("idle");
  const [drops, setDrops] = useState<BoosterDrop[]>([]);

  const open = useCallback(() => {
    if (!wallet) return;
    setPhase("opening");
    const rolled = rollBooster(wallet, PACK_SIZE);
    // Brief suspense, then reveal + grant.
    setTimeout(() => {
      let newCount = 0;
      for (const d of rolled) {
        if (unlockItem(wallet, d.category, d.id, d.name, true)) newCount++;
      }
      // One summary event → single toast + wardrobe re-render (the 5 grants ran
      // silent so they don't spam 5 toasts).
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

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(2,3,10,0.82)", backdropFilter: "blur(6px)",
        fontFamily: '"Press Start 2P", monospace',
      }}
      onClick={e => { if (e.target === e.currentTarget && phase !== "opening") onClose(); }}
    >
      <style>{`
        @keyframes booster-shake { 0%,100%{transform:translateX(0) rotate(0)} 25%{transform:translateX(-4px) rotate(-3deg)} 75%{transform:translateX(4px) rotate(3deg)} }
        @keyframes booster-glow  { 0%,100%{filter:drop-shadow(0 0 12px rgba(153,69,255,0.6))} 50%{filter:drop-shadow(0 0 22px rgba(183,233,40,0.8))} }
        @keyframes booster-pop   { 0%{transform:scale(0.5) translateY(10px);opacity:0} 60%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
      `}</style>

      <div style={{
        width: "min(560px, 94vw)",
        background: "#0b0e1c",
        borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
        borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
        imageRendering: "pixelated",
        padding: "22px 22px 18px",
        color: "#d0d0f0",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 10, color: "#c084fc", letterSpacing: 2, marginBottom: 4 }}>
          BOOSTER PACK
        </div>
        <div style={{ fontSize: 6, color: "#FFD700", opacity: 0.7, letterSpacing: 1, marginBottom: 18 }}>
          PREVIEW · RANDOMNESS → MAGICBLOCK VRF
        </div>

        {!wallet ? (
          <div style={{ fontSize: 8, color: "#aaaacc", lineHeight: 1.8, padding: "20px 0" }}>
            Connect a wallet to open packs.
          </div>
        ) : phase === "revealed" ? (
          <>
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${PACK_SIZE}, 1fr)`,
              gap: 8, marginBottom: 18,
            }}>
              {drops.map((d, i) => (
                <div
                  key={`${d.category}:${d.id}`}
                  style={chamferBox(10, {
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                    padding: "10px 4px",
                    background: d.owned ? "rgba(255,255,255,0.02)" : "rgba(183,233,40,0.08)",
                    border: `2px solid ${d.owned ? "rgba(255,255,255,0.08)" : "rgba(183,233,40,0.5)"}`,
                    animation: `booster-pop 0.4s ${i * 0.09}s ease-out both`,
                  })}
                >
                  <ChromaPreview file={d.file} size={52} facingUp={d.category === "back"} />
                  <span style={{ fontSize: 6, color: "#e0d0ff", lineHeight: 1.3, textAlign: "center" }}>{d.name}</span>
                  <span style={{ fontSize: 5, color: "#7a7aa0", letterSpacing: 0.5 }}>
                    {CATEGORY_LABELS[d.category]}
                  </span>
                  <span style={{
                    fontSize: 5, letterSpacing: 0.5,
                    color: d.owned ? "#888" : "#B7E928",
                  }}>{d.owned ? "OWNED" : "NEW"}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => { setPhase("idle"); setDrops([]); }} style={btn("ghost")}>OPEN ANOTHER</button>
              <ChamferGlow glow={BTN_GLOW}><button onClick={onClose} style={btn("primary")}>DONE</button></ChamferGlow>
            </div>
          </>
        ) : (
          <>
            <div style={{
              width: 120, height: 120, margin: "6px auto 20px",
              animation: phase === "opening"
                ? "booster-shake 0.16s linear infinite, booster-glow 0.5s ease-in-out infinite"
                : "booster-glow 2.2s ease-in-out infinite",
            }}>
              <div style={chamferBox(16, {
                width: "100%", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 56,
                background: "linear-gradient(135deg, rgba(153,69,255,0.25), rgba(183,233,40,0.15))",
                border: "2px solid rgba(153,69,255,0.5)",
              })}>
                <img src="/assets/ui/ico_wardrop.png" alt="" draggable={false} style={{ width: 64, height: 64, imageRendering: "pixelated" }} />
              </div>
            </div>
            <div style={{ fontSize: 7, color: "#8a8aa7", lineHeight: 1.7, marginBottom: 18 }}>
              {PACK_SIZE} random pieces: hats, backpacks, hair, and more.
            </div>
            <ChamferGlow glow={BTN_GLOW} style={{ display: "inline-block" }}>
              <button onClick={open} disabled={phase === "opening"} style={btn("primary")}>
                {phase === "opening" ? "OPENING…" : "OPEN PACK"}
              </button>
            </ChamferGlow>
          </>
        )}
      </div>
    </div>
  );
}

const BTN_GLOW = "drop-shadow(0 0 10px rgba(153,69,255,0.45))";

function btn(kind: "primary" | "ghost"): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 9, letterSpacing: 1, padding: "12px 24px",
    cursor: "pointer",
  };
  return chamferBox(8, kind === "primary"
    ? { ...base, background: "linear-gradient(135deg, #9945FF, #7a2fd8)", color: "#fff",
        border: "1px solid rgba(200,150,255,0.5)" }
    : { ...base, background: "transparent", color: "#8a8aa7", border: "1px solid rgba(153,69,255,0.3)" });
}
