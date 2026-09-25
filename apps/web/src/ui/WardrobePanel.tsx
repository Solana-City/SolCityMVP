"use client";

import { PixelImg, ICON, LockIcon } from "@/ui/PixelIcons";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  LAYER_ORDER,
  CATEGORY_LABELS,
  LayerCategory,
  Loadout,
  DEFAULT_LOADOUT,
  saveLoadout,
  loadSavedLoadout,
  getVariant,
  getEnabledVariants,
  isFreeItem,
  unlockHintFor,
  SPRITE_FRAME_WIDTH,
  SPRITE_FRAME_HEIGHT,
  DIRECTION_ROW,
} from "@/game/config/paperDoll";
import { profileManager } from "@/game/config/profileManager";
import { isVariantUnlocked, unlockItem } from "@/game/config/wardrobeUnlocks";
import { progressionBus } from "@/game/progression/progressionBus";
import BoosterOverlay from "@/ui/BoosterOverlay";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";
import { useViewportBox, overlayBox } from "@/ui/useViewportBox";

const CHROMA_R = 215, CHROMA_G = 123, CHROMA_B = 186, CHROMA_TOL = 30;

function removeChroma(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (
      Math.abs(px[i]   - CHROMA_R) <= CHROMA_TOL &&
      Math.abs(px[i+1] - CHROMA_G) <= CHROMA_TOL &&
      Math.abs(px[i+2] - CHROMA_B) <= CHROMA_TOL
    ) px[i+3] = 0;
  }
  ctx.putImageData(d, 0, 0);
}

function AvatarPreview({ loadout, facingUp, scale = 3 }: { loadout: Loadout; facingUp?: boolean; scale?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SCALE = scale;
  const FW = SPRITE_FRAME_WIDTH * SCALE;
  const FH = SPRITE_FRAME_HEIGHT * SCALE;
  // Backpacks are worn on the back — from the front only the strap tops
  // peek over the shoulders, so browsing that category previews the
  // character facing away (north) instead of the usual front-facing pose.
  const rowY = (facingUp ? DIRECTION_ROW.up : DIRECTION_ROW.down) * SPRITE_FRAME_HEIGHT;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, FW, FH);
    ctx.imageSmoothingEnabled = false;

    const layers = LAYER_ORDER.filter(cat => loadout[cat]);
    if (layers.length === 0) return;

    let loaded = 0;
    const imgs: Array<{ img: HTMLImageElement; cat: LayerCategory }> = [];

    const draw = () => {
      ctx.clearRect(0, 0, FW, FH);

      // Chroma-remove every layer first (into its own off-canvas) before
      // drawing any of them, so the hat's silhouette is available in time
      // to mask the hair layer — hat is last in LAYER_ORDER but the mask
      // needs to be computed before hair gets drawn.
      const offByCategory = new Map<LayerCategory, HTMLCanvasElement>();
      for (const { img, cat } of imgs) {
        const off = document.createElement("canvas");
        off.width = img.naturalWidth;
        off.height = img.naturalHeight;
        const oc = off.getContext("2d")!;
        oc.drawImage(img, 0, 0);
        removeChroma(oc, img.naturalWidth, img.naturalHeight);
        offByCategory.set(cat, off);
      }

      // Cap the hair to the equipped hat's coverage in the row this preview
      // is showing (rowY). Three styles (LayerVariant.hatCoverage):
      //   "full" (default) — per-column cutoff from the hat's own silhouette,
      //     so hair wider/taller than the hat is masked exactly where the
      //     hat covers it and left alone where it doesn't reach at all.
      //   "band" — a headband/bandana only wraps the forehead; mask ONLY
      //     exactly where the band's own pixels are opaque, so the crown
      //     above it and everything below stay visible.
      //   "suppress" — a full head-covering mask (e.g. Ninja) narrower than
      //     some wide hairstyles; hides hair entirely rather than leaving a
      //     sliver visible past its edges.
      const hatOff = offByCategory.get("hat");
      const hairOff = offByCategory.get("hair");
      const hatVariantVal = getVariant("hat", loadout.hat);
      if (hatOff && hairOff && hatVariantVal?.hatCoverage === "suppress") {
        const hairCtx = hairOff.getContext("2d")!;
        hairCtx.clearRect(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
      } else if (hatOff && hairOff) {
        const hatCtx = hatOff.getContext("2d")!;
        const hatData = hatCtx.getImageData(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT).data;
        const hairCtx = hairOff.getContext("2d")!;
        const hairData = hairCtx.getImageData(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);

        if (hatVariantVal?.hatCoverage === "band") {
          let masked = false;
          for (let i = 0; i < hatData.length; i += 4) {
            if (hatData[i + 3] > 10) { hairData.data[i + 3] = 0; masked = true; }
          }
          if (masked) hairCtx.putImageData(hairData, 0, rowY);
        } else {
          const cutoffs = new Array<number>(SPRITE_FRAME_WIDTH).fill(SPRITE_FRAME_HEIGHT);
          for (let x = 0; x < SPRITE_FRAME_WIDTH; x++) {
            for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
              if (hatData[(y * SPRITE_FRAME_WIDTH + x) * 4 + 3] > 10) { cutoffs[x] = y; break; }
            }
          }
          if (cutoffs.some(c => c < SPRITE_FRAME_HEIGHT)) {
            for (let x = 0; x < SPRITE_FRAME_WIDTH; x++) {
              const cutoff = cutoffs[x];
              for (let y = 0; y < cutoff; y++) {
                hairData.data[(y * SPRITE_FRAME_WIDTH + x) * 4 + 3] = 0;
              }
            }
            hairCtx.putImageData(hairData, 0, rowY);
          }
        }
      }

      for (const { cat } of imgs) {
        const off = offByCategory.get(cat)!;
        ctx.drawImage(off, 0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, 0, 0, FW, FH);
      }
    };

    for (const cat of LAYER_ORDER) {
      const variantId = loadout[cat];
      if (!variantId) continue;
      const variant = getVariant(cat, variantId);
      if (!variant) continue;
      const img = new Image();
      img.src = `/assets/sprites/paperdoll/${variant.file}`;
      imgs.push({ img, cat });
      img.onload = () => { loaded++; if (loaded === imgs.length) draw(); };
    }
  }, [loadout, FW, FH, rowY]);

  return (
    <canvas
      ref={canvasRef}
      width={FW}
      height={FH}
      // Fill the (square) preview box and letterbox to preserve aspect — the
      // canvas backing store stays at FW×FH for crispness, but it never
      // overflows its container (which used to spill the preview onto the option
      // grid on desktop and clip the character on mobile).
      style={{ imageRendering: "pixelated", display: "block", width: "100%", height: "100%", objectFit: "contain" }}
    />
  );
}

export function ChromaPreview({ file, size, facingUp, crop }: { file: string; size: number; facingUp?: boolean; crop?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Backpacks are barely visible from the front (just the strap tops) —
  // show the "up" (back) row instead so items are actually distinguishable
  // in the selection grid.
  const rowY = (facingUp ? DIRECTION_ROW.up : DIRECTION_ROW.down) * SPRITE_FRAME_HEIGHT;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    const img = new Image();
    img.src = `/assets/sprites/paperdoll/${file}`;
    img.onload = () => {
      const off = document.createElement("canvas");
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      const oc = off.getContext("2d")!;
      oc.drawImage(img, 0, 0);
      removeChroma(oc, img.naturalWidth, img.naturalHeight);
      if (!crop) {
        ctx.drawImage(off, 0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, 0, 0, size, size);
        return;
      }
      // Icon mode: zoom to the item itself (a hat is a few pixels at the top
      // of a 64px frame), centred in a square.
      const { data } = oc.getImageData(0, rowY, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT);
      let x0 = SPRITE_FRAME_WIDTH, y0 = SPRITE_FRAME_HEIGHT, x1 = -1, y1 = -1;
      for (let y = 0; y < SPRITE_FRAME_HEIGHT; y++) {
        for (let x = 0; x < SPRITE_FRAME_WIDTH; x++) {
          if (data[(y * SPRITE_FRAME_WIDTH + x) * 4 + 3] < 16) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) return;
      const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) + 2;
      const cx = (x0 + x1 + 1) / 2;
      const cy = (y0 + y1 + 1) / 2;
      ctx.drawImage(off, cx - side / 2, rowY + cy - side / 2, side, side, 0, 0, size, size);
    };
  }, [file, size, rowY, crop]);
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: "pixelated", display: "block" }}
    />
  );
}

/**
 * Category icon: the category's own first item, drawn from its sprite sheet,
 * so the tabs show a real hat, shirt or backpack instead of an emoji.
 */
/** Item that stands for its category on the tab (else the first one). */
const CATEGORY_ICON_ITEM: Partial<Record<LayerCategory, string>> = { hair: "Anime" };

function CategoryIcon({ cat, size }: { cat: LayerCategory; size: number }) {
  const all = getEnabledVariants(cat);
  const first = all.find(v => v.id === CATEGORY_ICON_ITEM[cat]) ?? all[0];
  if (!first) return null;
  return <ChromaPreview file={first.file} size={size} facingUp={cat === "back"} crop />;
}

const OPTIONAL: LayerCategory[] = ["hat", "accessory", "back"];

function randomLoadout(wallet: string | null): Loadout {
  const out: Loadout = {};
  for (const cat of LAYER_ORDER) {
    // Only roll items the wallet can actually equip.
    const variants = getEnabledVariants(cat).filter(v => isVariantUnlocked(wallet, cat, v));
    if (variants.length === 0) continue;
    if (OPTIONAL.includes(cat) && Math.random() < 0.4) continue;
    out[cat] = variants[Math.floor(Math.random() * variants.length)].id;
  }
  return out;
}

interface WardrobePanelProps {
  gameRef: Phaser.Game | null;
  onClose: () => void;
}

export default function WardrobePanel({ gameRef, onClose }: WardrobePanelProps) {
  const [loadout, setLoadout] = useState<Loadout>(() => loadSavedLoadout());
  const [activeCategory, setActiveCategory] = useState<LayerCategory>("skin");
  const [flash, setFlash] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const viewport = useViewportBox();
  const [wallet] = useState<string | null>(() => profileManager?.get().wallet ?? null);
  const [boosterOpen, setBoosterOpen] = useState(false);
  // Bumped whenever an item is unlocked so the locked grid re-renders.
  const [, bumpUnlocks] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px), (pointer: coarse)");
    setIsMobile(mq.matches);
    const on = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    gameRef?.events.emit("wardrobe:loadout", loadout);
  }, [loadout, gameRef]);

  // Grandfather: any locked item the player already wears stays equippable.
  useEffect(() => {
    const saved = loadSavedLoadout();
    for (const cat of LAYER_ORDER) {
      const id = saved[cat];
      const v = id ? getVariant(cat, id) : undefined;
      if (v && !isFreeItem(cat, v.id)) unlockItem(wallet, cat, v.id, v.name, true);
    }
  }, [wallet]);

  // Re-render when an item is unlocked (from here, a quest, an NPC, or a booster).
  useEffect(() => {
    const unsub = progressionBus.on("outfit-unlocked", () => bumpUnlocks(n => n + 1));
    return () => unsub();
  }, []);

  // Dev helper: unlock from the console until quests/NPCs/boosters are wired in.
  //   solcityUnlock("hat", "Crown")
  useEffect(() => {
    (window as unknown as Record<string, unknown>).solcityUnlock =
      (cat: LayerCategory, id: string) => unlockItem(wallet, cat, id, getVariant(cat, id)?.name);
    return () => { delete (window as unknown as Record<string, unknown>).solcityUnlock; };
  }, [wallet]);

  const selectVariant = useCallback((category: LayerCategory, variantId: string | undefined) => {
    if (variantId) {
      const v = getVariant(category, variantId);
      // Locked and not yet unlocked → flash the hint instead of equipping.
      if (v && !isVariantUnlocked(wallet, category, v)) {
        setFlash(`locked:${category}:${variantId}`);
        setTimeout(() => setFlash(null), 1400);
        return;
      }
    }
    setLoadout(prev => ({ ...prev, [category]: variantId }));
    setFlash(`${category}:${variantId}`);
    setTimeout(() => setFlash(null), 600);
  }, [wallet]);

  const handleRandom = useCallback(() => {
    const next = randomLoadout(wallet);
    setLoadout(next);
  }, [wallet]);

  const handleSave = useCallback(() => {
    saveLoadout(loadout);
    gameRef?.events.emit("wardrobe:loadout", loadout);
    onClose();
  }, [loadout, gameRef, onClose]);

  const handleReset = useCallback(() => setLoadout({ ...DEFAULT_LOADOUT }), []);

  const variants = getEnabledVariants(activeCategory);
  const TILE = isMobile ? 40 : 52;
  const currentVariantId = loadout[activeCategory];

  // Reverse so topmost layer (hat) appears first in the tab list
  const tabOrder = [...LAYER_ORDER].reverse() as LayerCategory[];

  return (
    <div
      className="z-50 flex items-center justify-center"
      style={{ ...overlayBox(viewport), background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "#0b0e1c",
        ...(isMobile
          ? { border: "none" }
          : {
              borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
              borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
              imageRendering: "pixelated",
            }),
        width: isMobile ? "100vw" : 700,
        maxWidth: isMobile ? "100vw" : "96vw",
        height: isMobile ? "100%" : undefined,
        maxHeight: isMobile ? "100%" : "92vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: '"Press Start 2P", monospace',
        color: "#d0d0f0",
        boxShadow: isMobile ? "none" : "0 0 60px rgba(153,69,255,0.15), 0 24px 64px rgba(0,0,0,0.6)",
      }}>

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: isMobile ? "6px 12px" : "12px 20px",
          borderBottom: "1px solid rgba(153,69,255,0.12)",
          background: "rgba(153,69,255,0.06)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PixelImg src={ICON.wardrobe} size={24} />
            <span style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 12,
              color: "#c084fc",
              letterSpacing: 2,
            }}>WARDROBE</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Booster pack (preview) */}
            <button
              onClick={() => setBoosterOpen(true)}
              title="Open a booster pack"
              style={{
                ...chamferBox(9, { border: "2px solid rgba(153,69,255,0.6)" }),
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 7,
                padding: "7px 14px",
                backgroundColor: "rgba(153,69,255,0.14)",
                color: "#c084fc",
                cursor: "pointer",
                letterSpacing: 1,
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(153,69,255,0.25)"}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "rgba(153,69,255,0.14)"}
            >
              OPEN PACK
            </button>
            {/* Random button */}
            <button
              onClick={handleRandom}
              title="Random outfit"
              style={{
                ...chamferBox(9, { border: "2px solid rgba(183,233,40,0.55)" }),
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 7,
                padding: "7px 14px",
                backgroundColor: "rgba(183,233,40,0.1)",
                color: "#B7E928",
                cursor: "pointer",
                letterSpacing: 1,
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(183,233,40,0.2)"}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = "rgba(183,233,40,0.1)"}
            >
              RANDOM
            </button>
            <button onClick={onClose} style={{
              background: "none", border: "none", color: "#14F0C6",
              fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px",
            }}>×</button>
          </div>
        </div>

        {/* Always side by side: phones play in landscape, where stacking the
            preview over the grid left the grid a thin strip that had to scroll. */}
        <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0, overflow: "hidden" }}>

          {/* ── LEFT: preview + category tabs ── */}
          <div style={{
            width: isMobile ? 150 : 168,
            flexShrink: 0,
            borderRight: "1px solid rgba(153,69,255,0.1)",
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            background: "rgba(0,0,0,0.2)",
          }}>
            <div style={{ display: "flex", justifyContent: "center", padding: isMobile ? "8px 8px 4px" : "14px 12px 8px", flexShrink: 0 }}>
              <div style={chamferBox(10, {
                background: "rgba(153,69,255,0.06)",
                border: "1px solid rgba(153,69,255,0.14)",
                padding: isMobile ? 4 : 8,
                width: isMobile ? 84 : 132,
                height: isMobile ? 84 : 132,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              })}>
                <AvatarPreview loadout={loadout} facingUp={activeCategory === "back"} scale={3} />
              </div>
            </div>

            {/* Tabs: labelled list on desktop, a 4x2 icon grid on a phone. */}
            <div style={{
              display: isMobile ? "grid" : "flex",
              gridTemplateColumns: isMobile ? "repeat(4, 1fr)" : undefined,
              flexDirection: "column",
              gap: isMobile ? 4 : 0,
              padding: isMobile ? "4px 6px 6px" : "6px 8px",
            }}>
              {tabOrder.map(cat => {
                const isActive = activeCategory === cat;
                const hasItem = !!loadout[cat];
                const isOptional = OPTIONAL.includes(cat);
                const dot = hasItem ? "#B7E928" : isOptional ? "#333344" : "#ff4444";
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    title={CATEGORY_LABELS[cat]}
                    style={chamferBox(8, {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: isMobile ? "center" : "flex-start",
                      gap: 8,
                      width: "100%",
                      height: isMobile ? 30 : undefined,
                      padding: isMobile ? 0 : "7px 10px",
                      marginBottom: isMobile ? 0 : 2,
                      background: isActive ? "rgba(153,69,255,0.18)" : "transparent",
                      border: isActive ? "1px solid rgba(153,69,255,0.4)" : "1px solid transparent",
                      cursor: "pointer",
                      color: isActive ? "#e0d0ff" : "#666688",
                      textAlign: "left",
                      position: "relative",
                      transition: "background 0.12s, color 0.12s",
                    })}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(153,69,255,0.08)"; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <span style={{ flexShrink: 0, lineHeight: 0 }}>
                      <CategoryIcon cat={cat} size={22} />
                    </span>
                    {isMobile ? (
                      <span style={{
                        position: "absolute", top: 3, right: 3,
                        width: 4, height: 4, borderRadius: "50%", background: dot, opacity: hasItem ? 1 : 0.6,
                      }} />
                    ) : (
                      <>
                        <span style={{ fontSize: 8, flex: 1, fontFamily: '"Press Start 2P", monospace', whiteSpace: "nowrap" }}>
                          {CATEGORY_LABELS[cat]}
                        </span>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: dot, opacity: hasItem ? 1 : 0.5 }} />
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── RIGHT: variant grid ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Section header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: isMobile ? "7px 12px" : "10px 16px 8px",
              borderBottom: "1px solid rgba(153,69,255,0.08)",
            }}>
              <CategoryIcon cat={activeCategory} size={22} />
              <span style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 7,
                color: "#9945FF",
                letterSpacing: 2,
              }}>
                {CATEGORY_LABELS[activeCategory].toUpperCase()}
              </span>
              <span style={{ fontSize: 8, color: "#444466", marginLeft: "auto" }}>
                {variants.length} {variants.length === 1 ? "option" : "options"}
                {OPTIONAL.includes(activeCategory) && " · optional"}
              </span>
            </div>

            {/* Grid */}
            {/* Small tiles so a whole category fits without scrolling (scroll
                stays only as a fallback on very short screens). */}
            <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "8px 10px" : "12px 14px" }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 62 : 84}px, 1fr))`,
                gap: isMobile ? 5 : 8,
              }}>
                {/* None option for optional categories */}
                {OPTIONAL.includes(activeCategory) && (
                  <VariantCard
                    isSelected={!currentVariantId}
                    isFlashing={flash === `${activeCategory}:undefined`}
                    compact={isMobile}
                    onClick={() => selectVariant(activeCategory, undefined)}
                  >
                    <div style={chamferBox(6, {
                      width: TILE, height: TILE,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#333344", fontSize: 17,
                      border: "1px dashed #2a2a4a", 
                    })}>∅</div>
                    <span style={{ color: !currentVariantId ? "#B7E928" : "#444466" }}>None</span>
                  </VariantCard>
                )}

                {variants.map(v => {
                  const isSelected = currentVariantId === v.id;
                  const isFlashing = flash === `${activeCategory}:${v.id}`;
                  const locked = !isVariantUnlocked(wallet, activeCategory, v);
                  const hintFlashing = flash === `locked:${activeCategory}:${v.id}`;
                  return (
                    <VariantCard
                      key={v.id}
                      isSelected={isSelected}
                      isFlashing={isFlashing}
                      locked={locked}
                      hintFlashing={hintFlashing}
                      compact={isMobile}
                      onClick={() => selectVariant(activeCategory, v.id)}
                    >
                      <div style={{ position: "relative", lineHeight: 0 }}>
                        <ChromaPreview file={v.file} size={TILE} facingUp={activeCategory === "back"} />
                        {locked && (
                          <span style={chamferBox(6, {
                            position: "absolute", inset: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "rgba(6,8,20,0.55)", 
                          })}><LockIcon size={20} /></span>
                        )}
                      </div>
                      <span style={{
                        color: locked ? "#666688" : isSelected ? "#c084fc" : "#aaaacc",
                        lineHeight: 1.3,
                        textAlign: "center",
                      }}>{v.name}</span>
                      {locked && (
                        <span style={{
                          fontSize: 5,
                          color: hintFlashing ? "#FFD700" : "#7a7aa0",
                          letterSpacing: 0.5,
                          textAlign: "center",
                          lineHeight: 1.4,
                        }}>{unlockHintFor(v)}</span>
                      )}
                    </VariantCard>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: "flex", gap: 10, padding: isMobile ? "6px 12px" : "10px 18px",
          borderTop: "1px solid rgba(153,69,255,0.12)",
          background: "rgba(0,0,0,0.2)",
          alignItems: "center",
        }}>
          <button onClick={handleReset} style={chamferBox(8, {
            padding: "9px 18px",
            background: "transparent",
            border: "1px solid rgba(153,69,255,0.2)",
            color: "#555577", cursor: "pointer",
            fontSize: 8, fontFamily: '"Press Start 2P", monospace',
            transition: "border-color 0.15s, color 0.15s",
          })}
          onMouseEnter={e => { e.currentTarget.style.setProperty("--cbc", "rgba(153,69,255,0.45)"); e.currentTarget.style.color = "#9945FF"; }}
          onMouseLeave={e => { e.currentTarget.style.setProperty("--cbc", "rgba(153,69,255,0.2)"); e.currentTarget.style.color = "#555577"; }}
          >
            Reset
          </button>
          <div style={{ flex: 1 }} />
          <ChamferGlow
            glow="drop-shadow(0 0 8px rgba(183,233,40,0.4))"
            style={{ transition: "filter 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.filter = "drop-shadow(0 0 14px rgba(183,233,40,0.65))"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "drop-shadow(0 0 8px rgba(183,233,40,0.4))"; }}
          >
            <button onClick={handleSave} style={chamferBox(8, {
              padding: "10px 32px",
              background: "linear-gradient(135deg, #B7E928, #0db876)",
              border: "none",
              color: "#050a14",
              cursor: "pointer",
              fontSize: 9,
              fontWeight: 700,
              fontFamily: '"Press Start 2P", monospace',
              letterSpacing: 1,
              transition: "transform 0.1s",
            })}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
            >
              SAVE OUTFIT
            </button>
          </ChamferGlow>
        </div>
      </div>

      {boosterOpen && (
        <BoosterOverlay wallet={wallet} onClose={() => setBoosterOpen(false)} />
      )}
    </div>
  );
}

function VariantCard({
  isSelected, isFlashing, locked = false, hintFlashing = false, compact = false, onClick, children,
}: {
  compact?: boolean;
  isSelected: boolean;
  isFlashing: boolean;
  locked?: boolean;
  hintFlashing?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const baseBg = locked
    ? "rgba(255,255,255,0.015)"
    : isSelected ? "rgba(153,69,255,0.15)"
    : isFlashing ? "rgba(183,233,40,0.08)"
    : "rgba(255,255,255,0.02)";
  const baseBorder = hintFlashing
    ? "2px solid rgba(255,215,0,0.6)"
    : locked ? "2px solid rgba(255,255,255,0.04)"
    : isSelected ? "2px solid rgba(153,69,255,0.7)"
    : "2px solid rgba(255,255,255,0.05)";
  return (
    <button
      onClick={onClick}
      data-sfx={locked ? undefined : "outfit"}
      title={locked ? "Locked" : undefined}
      style={chamferBox(10, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: compact ? 3 : 5,
        padding: compact ? "5px 3px" : "8px 5px",
        background: baseBg,
        border: baseBorder,
        cursor: "pointer",
        fontSize: compact ? 5 : 6,
        fontFamily: '"Press Start 2P", monospace',
        opacity: locked ? 0.78 : 1,
        transition: "background 0.15s, border-color 0.15s, transform 0.1s",
        transform: isFlashing || hintFlashing ? "scale(1.04)" : "scale(1)",
        outline: isFlashing ? "2px solid rgba(183,233,40,0.5)" : "none",
        outlineOffset: 2,
      })}
      onMouseEnter={e => {
        if (!isSelected && !locked) {
          e.currentTarget.style.backgroundColor = "rgba(153,69,255,0.09)";
          e.currentTarget.style.setProperty("--cbc", "rgba(153,69,255,0.35)");
        }
        e.currentTarget.style.transform = "scale(1.03)";
      }}
      onMouseLeave={e => {
        if (!isSelected && !locked) {
          e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.02)";
          e.currentTarget.style.setProperty("--cbc", "rgba(255,255,255,0.05)");
        }
        e.currentTarget.style.transform = isFlashing || hintFlashing ? "scale(1.04)" : "scale(1)";
      }}
    >
      {children}
    </button>
  );
}
