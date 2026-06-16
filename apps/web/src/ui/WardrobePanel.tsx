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
} from "@/game/config/paperDoll";

interface WardrobePanelProps {
  gameRef: Phaser.Game | null;
  onClose: () => void;
}

/** Shows the first frame (row 0, col 0) of a 4×4 spritesheet. */
function SpritePreview({ src, size = 64 }: { src: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        overflow: "hidden",
        imageRendering: "pixelated",
        flexShrink: 0,
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          width: size * 4,
          height: size * 4,
          maxWidth: "none",
          imageRendering: "pixelated",
          display: "block",
        }}
      />
    </div>
  );
}

export default function WardrobePanel({ gameRef, onClose }: WardrobePanelProps) {
  const [loadout, setLoadout] = useState<Loadout>(() => loadSavedLoadout());
  const [activeCategory, setActiveCategory] = useState<LayerCategory>("skin");
  const saved = useRef(false);

  // Emit loadout to Phaser whenever it changes
  useEffect(() => {
    gameRef?.events.emit("wardrobe:loadout", loadout);
  }, [loadout, gameRef]);

  const selectVariant = useCallback((category: LayerCategory, variantId: string | undefined) => {
    setLoadout((prev) => ({ ...prev, [category]: variantId }));
  }, []);

  const handleSave = useCallback(() => {
    saveLoadout(loadout);
    gameRef?.events.emit("wardrobe:loadout", loadout);
    saved.current = true;
    onClose();
  }, [loadout, gameRef, onClose]);

  const handleReset = useCallback(() => {
    setLoadout({ ...DEFAULT_LOADOUT });
  }, []);

  const variants = LAYER_VARIANTS[activeCategory];
  const currentVariantId = loadout[activeCategory];

  const optionalCategories: LayerCategory[] = ["hat", "accessory"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex flex-col"
        style={{
          background: "#0d1117",
          border: "1px solid #2a2a4a",
          borderRadius: 12,
          width: 520,
          maxWidth: "95vw",
          maxHeight: "90vh",
          overflow: "hidden",
          fontFamily: "monospace",
          color: "#e0e0ff",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid #1e1e3a",
            background: "#0a0c14",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "#14F195", letterSpacing: 1 }}>
            WARDROBE
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#666", fontSize: 20, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Category tabs */}
          <div
            style={{
              width: 110,
              borderRight: "1px solid #1e1e3a",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "8px 6px",
              overflowY: "auto",
            }}
          >
            {LAYER_ORDER.slice().reverse().map((cat) => {
              const isActive = activeCategory === cat;
              const hasSelection = !!loadout[cat];
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    background: isActive ? "#1a1f3a" : "transparent",
                    border: isActive ? "1px solid #9945FF" : "1px solid transparent",
                    borderRadius: 6,
                    padding: "8px 6px",
                    cursor: "pointer",
                    color: isActive ? "#e0e0ff" : "#777",
                    fontSize: 11,
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: hasSelection ? "#14F195" : "#333",
                      flexShrink: 0,
                    }}
                  />
                  {CATEGORY_LABELS[cat]}
                </button>
              );
            })}
          </div>

          {/* Variant grid */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                gap: 8,
              }}
            >
              {/* "None" option for optional categories */}
              {optionalCategories.includes(activeCategory) && (
                <button
                  onClick={() => selectVariant(activeCategory, undefined)}
                  style={{
                    background: !currentVariantId ? "#1a2a1a" : "#0d1117",
                    border: !currentVariantId ? "2px solid #14F195" : "1px solid #2a2a4a",
                    borderRadius: 8,
                    padding: "10px 8px",
                    cursor: "pointer",
                    color: !currentVariantId ? "#14F195" : "#555",
                    fontSize: 11,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      border: "1px dashed #333",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#333",
                      fontSize: 20,
                    }}
                  >
                    ∅
                  </div>
                  None
                </button>
              )}

              {variants.map((v) => {
                const isSelected = currentVariantId === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => selectVariant(activeCategory, v.id)}
                    style={{
                      background: isSelected ? "#1a2a1a" : "#0d1117",
                      border: isSelected ? "2px solid #14F195" : "1px solid #2a2a4a",
                      borderRadius: 8,
                      padding: "10px 8px",
                      cursor: "pointer",
                      color: isSelected ? "#14F195" : "#aaa",
                      fontSize: 11,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      transition: "border-color 0.1s",
                    }}
                  >
                    <div
                      style={{
                        border: isSelected ? "1px solid #14F19540" : "1px solid #1e1e3a",
                        borderRadius: 4,
                        overflow: "hidden",
                        background: "#111",
                      }}
                    >
                      <SpritePreview
                        src={`/assets/sprites/paperdoll/${v.file}`}
                        size={64}
                      />
                    </div>
                    <span style={{ textAlign: "center", lineHeight: 1.3 }}>{v.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid #1e1e3a",
            background: "#0a0c14",
          }}
        >
          <button
            onClick={handleReset}
            style={{
              flex: 1,
              padding: "9px 0",
              background: "transparent",
              border: "1px solid #2a2a4a",
              borderRadius: 7,
              color: "#666",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 2,
              padding: "9px 0",
              background: "#14F195",
              border: "none",
              borderRadius: 7,
              color: "#050a14",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "monospace",
            }}
          >
            Save Outfit
          </button>
        </div>
      </div>
    </div>
  );
}
