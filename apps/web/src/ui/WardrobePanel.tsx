"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  LAYER_ORDER,
  LAYER_VARIANTS,
  CATEGORY_LABELS,
  LayerCategory,
  Loadout,
  DEFAULT_LOADOUT,
  saveLoadout,
  loadSavedLoadout,
  getVariant,
  SPRITE_FRAME_WIDTH,
  SPRITE_FRAME_HEIGHT,
} from "@/game/config/paperDoll";

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

function AvatarPreview({ loadout }: { loadout: Loadout }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SCALE = 3;
  const FW = SPRITE_FRAME_WIDTH * SCALE;
  const FH = SPRITE_FRAME_HEIGHT * SCALE;

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
      for (const { img } of imgs) {
        const off = document.createElement("canvas");
        off.width = img.naturalWidth;
        off.height = img.naturalHeight;
        const oc = off.getContext("2d")!;
        oc.drawImage(img, 0, 0);
        removeChroma(oc, img.naturalWidth, img.naturalHeight);
        ctx.drawImage(off, 0, 0, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, 0, 0, FW, FH);
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
  }, [loadout, FW, FH]);

  return (
    <canvas
      ref={canvasRef}
      width={FW}
      height={FH}
      style={{ imageRendering: "pixelated", display: "block" }}
    />
  );
}

function ChromaPreview({ file, size }: { file: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      ctx.drawImage(off, 0, 0, SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT, 0, 0, size, size);
    };
  }, [file, size]);
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: "pixelated", display: "block" }}
    />
  );
}

const CATEGORY_ICONS: Record<LayerCategory, string> = {
  skin:      "🧬",
  eyesFace:  "👁",
  pants:     "👖",
  tshirt:    "👕",
  accessory: "💍",
  hair:      "💇",
  hat:       "🎩",
};

const OPTIONAL: LayerCategory[] = ["hat", "accessory"];

function randomLoadout(): Loadout {
  const out: Loadout = {};
  for (const cat of LAYER_ORDER) {
    const variants = LAYER_VARIANTS[cat];
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

  useEffect(() => {
    gameRef?.events.emit("wardrobe:loadout", loadout);
  }, [loadout, gameRef]);

  const selectVariant = useCallback((category: LayerCategory, variantId: string | undefined) => {
    setLoadout(prev => ({ ...prev, [category]: variantId }));
    setFlash(`${category}:${variantId}`);
    setTimeout(() => setFlash(null), 600);
  }, []);

  const handleRandom = useCallback(() => {
    const next = randomLoadout();
    setLoadout(next);
  }, []);

  const handleSave = useCallback(() => {
    saveLoadout(loadout);
    gameRef?.events.emit("wardrobe:loadout", loadout);
    onClose();
  }, [loadout, gameRef, onClose]);

  const handleReset = useCallback(() => setLoadout({ ...DEFAULT_LOADOUT }), []);

  const variants = LAYER_VARIANTS[activeCategory];
  const currentVariantId = loadout[activeCategory];

  // Reverse so topmost layer (hat) appears first in the tab list
  const tabOrder = [...LAYER_ORDER].reverse() as LayerCategory[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "#0b0e1c",
        border: "1px solid rgba(153,69,255,0.3)",
        borderRadius: 16,
        width: 700,
        maxWidth: "96vw",
        maxHeight: "92vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: '"Press Start 2P", monospace',
        color: "#d0d0f0",
        boxShadow: "0 0 60px rgba(153,69,255,0.15), 0 24px 64px rgba(0,0,0,0.6)",
      }}>

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid rgba(153,69,255,0.12)",
          background: "rgba(153,69,255,0.06)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13 }}>👗</span>
            <span style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 8,
              color: "#c084fc",
              letterSpacing: 2,
            }}>WARDROBE</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Random button */}
            <button
              onClick={handleRandom}
              title="Random outfit"
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 7,
                padding: "7px 14px",
                background: "rgba(20,241,149,0.1)",
                color: "#14F195",
                border: "1px solid rgba(20,241,149,0.3)",
                borderRadius: 8,
                cursor: "pointer",
                letterSpacing: 1,
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(20,241,149,0.2)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(20,241,149,0.1)"}
            >
              🎲 RANDOM
            </button>
            <button onClick={onClose} style={{
              background: "none", border: "none", color: "#444466",
              fontSize: 16, cursor: "pointer", lineHeight: 1, padding: "0 2px",
            }}>×</button>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* ── LEFT: preview + category tabs ── */}
          <div style={{
            width: 168,
            borderRight: "1px solid rgba(153,69,255,0.1)",
            display: "flex",
            flexDirection: "column",
            background: "rgba(0,0,0,0.2)",
          }}>
            {/* Avatar preview */}
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: "16px 12px 10px",
              gap: 6,
            }}>
              <div style={{
                background: "rgba(153,69,255,0.06)",
                border: "1px solid rgba(153,69,255,0.14)",
                borderRadius: 10,
                padding: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <AvatarPreview loadout={loadout} />
              </div>
              <span style={{ fontSize: 7, color: "#444466", letterSpacing: 1 }}>PREVIEW</span>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "rgba(153,69,255,0.1)", margin: "0 12px" }} />

            {/* Category tabs */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
              {tabOrder.map(cat => {
                const isActive = activeCategory === cat;
                const hasItem = !!loadout[cat];
                const isOptional = OPTIONAL.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "9px 10px",
                      marginBottom: 2,
                      background: isActive ? "rgba(153,69,255,0.18)" : "transparent",
                      border: isActive ? "1px solid rgba(153,69,255,0.4)" : "1px solid transparent",
                      borderRadius: 8,
                      cursor: "pointer",
                      color: isActive ? "#e0d0ff" : "#666688",
                      textAlign: "left",
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(153,69,255,0.08)"; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 11, flexShrink: 0 }}>{CATEGORY_ICONS[cat]}</span>
                    <span style={{ fontSize: 8, flex: 1, fontFamily: '"Press Start 2P", monospace' }}>
                      {CATEGORY_LABELS[cat]}
                    </span>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      background: hasItem ? "#14F195" : isOptional ? "#333344" : "#ff4444",
                      opacity: hasItem ? 1 : 0.5,
                    }} />
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
              padding: "12px 16px 10px",
              borderBottom: "1px solid rgba(153,69,255,0.08)",
            }}>
              <span style={{ fontSize: 12 }}>{CATEGORY_ICONS[activeCategory]}</span>
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
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                gap: 10,
              }}>
                {/* None option for optional categories */}
                {OPTIONAL.includes(activeCategory) && (
                  <VariantCard
                    isSelected={!currentVariantId}
                    isFlashing={flash === `${activeCategory}:undefined`}
                    onClick={() => selectVariant(activeCategory, undefined)}
                  >
                    <div style={{
                      width: 64, height: 64,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#333344", fontSize: 17,
                      border: "1px dashed #2a2a4a", borderRadius: 6,
                    }}>∅</div>
                    <span style={{ color: !currentVariantId ? "#14F195" : "#444466" }}>None</span>
                  </VariantCard>
                )}

                {variants.map(v => {
                  const isSelected = currentVariantId === v.id;
                  const isFlashing = flash === `${activeCategory}:${v.id}`;
                  return (
                    <VariantCard
                      key={v.id}
                      isSelected={isSelected}
                      isFlashing={isFlashing}
                      onClick={() => selectVariant(activeCategory, v.id)}
                    >
                      <ChromaPreview file={v.file} size={64} />
                      <span style={{
                        color: isSelected ? "#c084fc" : "#aaaacc",
                        lineHeight: 1.3,
                        textAlign: "center",
                      }}>{v.name}</span>
                    </VariantCard>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: "flex", gap: 10, padding: "12px 18px",
          borderTop: "1px solid rgba(153,69,255,0.12)",
          background: "rgba(0,0,0,0.2)",
          alignItems: "center",
        }}>
          <button onClick={handleReset} style={{
            padding: "9px 18px",
            background: "transparent",
            border: "1px solid rgba(153,69,255,0.2)",
            borderRadius: 8, color: "#555577", cursor: "pointer",
            fontSize: 8, fontFamily: '"Press Start 2P", monospace',
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(153,69,255,0.45)"; e.currentTarget.style.color = "#9945FF"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(153,69,255,0.2)"; e.currentTarget.style.color = "#555577"; }}
          >
            Reset
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={handleSave} style={{
            padding: "10px 32px",
            background: "linear-gradient(135deg, #14F195, #0db876)",
            border: "none",
            borderRadius: 8,
            color: "#050a14",
            cursor: "pointer",
            fontSize: 9,
            fontWeight: 700,
            fontFamily: '"Press Start 2P", monospace',
            letterSpacing: 1,
            boxShadow: "0 0 16px rgba(20,241,149,0.3)",
            transition: "box-shadow 0.15s, transform 0.1s",
          }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 28px rgba(20,241,149,0.5)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 16px rgba(20,241,149,0.3)"; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            SAVE OUTFIT
          </button>
        </div>
      </div>
    </div>
  );
}

function VariantCard({
  isSelected, isFlashing, onClick, children,
}: {
  isSelected: boolean;
  isFlashing: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "10px 8px",
        background: isSelected
          ? "rgba(153,69,255,0.15)"
          : isFlashing
          ? "rgba(20,241,149,0.08)"
          : "rgba(255,255,255,0.02)",
        border: isSelected
          ? "2px solid rgba(153,69,255,0.7)"
          : "2px solid rgba(255,255,255,0.05)",
        borderRadius: 10,
        cursor: "pointer",
        fontSize: 8,
        fontFamily: '"Press Start 2P", monospace',
        transition: "background 0.15s, border-color 0.15s, transform 0.1s",
        transform: isFlashing ? "scale(1.04)" : "scale(1)",
        outline: isFlashing ? "2px solid rgba(20,241,149,0.5)" : "none",
        outlineOffset: 2,
      }}
      onMouseEnter={e => {
        if (!isSelected) {
          e.currentTarget.style.background = "rgba(153,69,255,0.09)";
          e.currentTarget.style.borderColor = "rgba(153,69,255,0.35)";
        }
        e.currentTarget.style.transform = "scale(1.03)";
      }}
      onMouseLeave={e => {
        if (!isSelected) {
          e.currentTarget.style.background = "rgba(255,255,255,0.02)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
        }
        e.currentTarget.style.transform = isFlashing ? "scale(1.04)" : "scale(1)";
      }}
    >
      {children}
    </button>
  );
}
