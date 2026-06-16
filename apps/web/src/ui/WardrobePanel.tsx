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

// Must match BootScene's chroma key values
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

/** Canvas that draws all loadout layers stacked, chroma-keyed, at 3× scale. */
function AvatarPreview({ loadout }: { loadout: Loadout }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SCALE = 3;
  const FW = SPRITE_FRAME_WIDTH * SCALE;   // 192
  const FH = SPRITE_FRAME_HEIGHT * SCALE;  // 192

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
      // Composite each layer via offscreen canvas (for chroma key)
      for (const { img, cat } of imgs) {
        const off = document.createElement("canvas");
        off.width = img.naturalWidth;
        off.height = img.naturalHeight;
        const oc = off.getContext("2d")!;
        oc.drawImage(img, 0, 0);
        removeChroma(oc, img.naturalWidth, img.naturalHeight);
        // Draw only frame col=0, row=0 (idle down)
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

interface WardrobePanelProps {
  gameRef: Phaser.Game | null;
  onClose: () => void;
}

export default function WardrobePanel({ gameRef, onClose }: WardrobePanelProps) {
  const [loadout, setLoadout] = useState<Loadout>(() => loadSavedLoadout());
  const [activeCategory, setActiveCategory] = useState<LayerCategory>("skin");

  useEffect(() => {
    gameRef?.events.emit("wardrobe:loadout", loadout);
  }, [loadout, gameRef]);

  const selectVariant = useCallback((category: LayerCategory, variantId: string | undefined) => {
    setLoadout(prev => ({ ...prev, [category]: variantId }));
  }, []);

  const handleSave = useCallback(() => {
    saveLoadout(loadout);
    gameRef?.events.emit("wardrobe:loadout", loadout);
    onClose();
  }, [loadout, gameRef, onClose]);

  const handleReset = useCallback(() => setLoadout({ ...DEFAULT_LOADOUT }), []);

  const variants = LAYER_VARIANTS[activeCategory];
  const currentVariantId = loadout[activeCategory];
  const optionalCategories: LayerCategory[] = ["hat", "accessory"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "#0d1117",
        border: "1px solid #2a2a4a",
        borderRadius: 12,
        width: 680,
        maxWidth: "96vw",
        maxHeight: "92vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "monospace",
        color: "#e0e0ff",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "13px 18px", borderBottom: "1px solid #1e1e3a", background: "#0a0c14",
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#14F195", letterSpacing: 1 }}>
            WARDROBE
          </span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer",
          }}>×</button>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* LEFT: live avatar preview + category tabs */}
          <div style={{
            width: 160, borderRight: "1px solid #1e1e3a",
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "12px 8px", gap: 10, background: "#090b12",
          }}>
            {/* Avatar preview — always visible */}
            <div style={{
              background: "#111827",
              border: "1px solid #1e1e3a",
              borderRadius: 8,
              padding: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <AvatarPreview loadout={loadout} />
            </div>

            <div style={{ fontSize: 9, color: "#444", textAlign: "center" }}>
              IDLE PREVIEW
            </div>

            {/* Category tabs */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
              {([...LAYER_ORDER] as LayerCategory[]).reverse().map(cat => {
                const isActive = activeCategory === cat;
                const has = !!loadout[cat];
                return (
                  <button key={cat} onClick={() => setActiveCategory(cat)} style={{
                    background: isActive ? "#1a1f3a" : "transparent",
                    border: isActive ? "1px solid #9945FF" : "1px solid transparent",
                    borderRadius: 5,
                    padding: "6px 8px",
                    cursor: "pointer",
                    color: isActive ? "#e0e0ff" : "#666",
                    fontSize: 11,
                    textAlign: "left",
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: has ? "#14F195" : "#222", flexShrink: 0,
                    }} />
                    {CATEGORY_LABELS[cat]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT: variant grid */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>
              {CATEGORY_LABELS[activeCategory].toUpperCase()}
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
              gap: 8,
            }}>
              {optionalCategories.includes(activeCategory) && (
                <button
                  onClick={() => selectVariant(activeCategory, undefined)}
                  style={{
                    background: !currentVariantId ? "#111" : "#0d1117",
                    border: !currentVariantId ? "2px solid #14F195" : "1px solid #2a2a4a",
                    borderRadius: 7, padding: "8px 6px",
                    cursor: "pointer", color: !currentVariantId ? "#14F195" : "#444",
                    fontSize: 10, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 4,
                  }}>
                  <div style={{
                    width: 64, height: 64, border: "1px dashed #2a2a4a", borderRadius: 4,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#333", fontSize: 18,
                  }}>∅</div>
                  None
                </button>
              )}

              {variants.map(v => {
                const isSelected = currentVariantId === v.id;
                return (
                  <button key={v.id} onClick={() => selectVariant(activeCategory, v.id)} style={{
                    background: isSelected ? "#111" : "#0d1117",
                    border: isSelected ? "2px solid #14F195" : "1px solid #2a2a4a",
                    borderRadius: 7, padding: "8px 6px",
                    cursor: "pointer", color: isSelected ? "#14F195" : "#999",
                    fontSize: 10, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 4,
                  }}>
                    <ChromaPreview file={v.file} size={64} />
                    <span style={{ textAlign: "center", lineHeight: 1.3 }}>{v.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", gap: 8, padding: "11px 16px",
          borderTop: "1px solid #1e1e3a", background: "#0a0c14",
        }}>
          <button onClick={handleReset} style={{
            flex: 1, padding: "8px 0",
            background: "transparent", border: "1px solid #2a2a4a",
            borderRadius: 6, color: "#555", cursor: "pointer", fontSize: 11, fontFamily: "monospace",
          }}>Reset</button>
          <button onClick={handleSave} style={{
            flex: 2, padding: "8px 0",
            background: "#14F195", border: "none",
            borderRadius: 6, color: "#050a14", cursor: "pointer",
            fontSize: 12, fontWeight: 700, fontFamily: "monospace",
          }}>Save Outfit</button>
        </div>
      </div>
    </div>
  );
}

/** Single-variant chroma-keyed first-frame preview. */
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
