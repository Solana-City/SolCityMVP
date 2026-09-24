"use client";

import { useEffect, useState } from "react";
import {
  getValidZooms, snapZoom, loadZoom, saveZoom, formatViewScale,
} from "@/game/config/zoomConfig";
import { chamferBox } from "@/ui/chamfer";

function emitGame(event: string, data?: unknown) {
  (globalThis as any).__solCityGameEvents?.emit(event, data);
}

const CHAMFER_BORDER_W = 2;

// clip-path alone cuts the corner off a rectangular `border` without leaving
// a stroke along the new diagonal edge. Faking a chamfered outline instead
// needs two stacked, independently-clipped layers: an outer one filled with
// the border color, and an inset inner one (by the border width) filled with
// the real background — the visible ring between them reads as the outline.
function chamferClip(corner: number): string {
  return `polygon(${corner}px 0, calc(100% - ${corner}px) 0, 100% ${corner}px, 100% calc(100% - ${corner}px), calc(100% - ${corner}px) 100%, ${corner}px 100%, 0 calc(100% - ${corner}px), 0 ${corner}px)`;
}

/** `compact`: just the two buttons, no scale label or frame (for the phone HUD card). */
export default function ZoomControl({ compact = false }: { compact?: boolean }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setZoom(loadZoom());
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
    // Sync display when pinch gesture changes zoom (pinch snaps to nearest valid)
    const handler = (e: Event) => setZoom(snapZoom((e as CustomEvent<number>).detail));
    window.addEventListener("solcity:zoom", handler);
    return () => window.removeEventListener("solcity:zoom", handler);
  }, []);

  if (zoom === null) return null;

  const zooms = getValidZooms();
  const idx = zooms.indexOf(zoom);
  const canDec = idx > 0;
  const canInc = idx >= 0 && idx < zooms.length - 1;
  const btnSize = compact ? 24 : isTouch ? 26 : 22;

  function change(next: number) {
    setZoom(next);
    saveZoom(next);
    emitGame("camera:zoom", next);
    window.dispatchEvent(new CustomEvent("solcity:zoom", { detail: next }));
  }

  if (compact) {
    return (
      <div
        style={chamferBox(6, {
          padding: CHAMFER_BORDER_W,
          background: "#9945FF",
        })}
      >
        <div
          className="flex items-center"
          style={chamferBox(6 - CHAMFER_BORDER_W, {
            gap: 3,
            padding: "2px 4px",
            background: "rgba(10,10,30,0.85)",
          })}
        >
          <ZBtn size={btnSize} disabled={!canDec} onClick={() => change(zooms[idx - 1])}>−</ZBtn>
          <ZBtn size={btnSize} disabled={!canInc} onClick={() => change(zooms[idx + 1])}>+</ZBtn>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5"
      style={chamferBox(8, {
        background: "rgba(10,10,30,0.85)",
        border: "1px solid rgba(153,69,255,0.25)",
        backdropFilter: "blur(4px)",
        fontFamily: "monospace",
      })}
    >
      <ZBtn size={btnSize} disabled={!canDec} onClick={() => change(zooms[idx - 1])}>−</ZBtn>

      <span
        style={{
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#9945FF",
          minWidth: 36,
          textAlign: "center",
          userSelect: "none",
        }}
      >
        {formatViewScale(zoom)}
      </span>

      <ZBtn size={btnSize} disabled={!canInc} onClick={() => change(zooms[idx + 1])}>+</ZBtn>
    </div>
  );
}

function ZBtn({
  children,
  onClick,
  disabled,
  size,
}: {
  children: string;
  onClick: () => void;
  disabled: boolean;
  size: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={chamferBox(6, {
        width: size,
        height: size,
        border: "1px solid rgba(153,69,255,0.3)",
        background: disabled ? "transparent" : "rgba(153,69,255,0.12)",
        color: disabled ? "#333344" : "#9945FF",
        fontSize: "11px",
        lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        transition: "background 0.1s",
        WebkitTapHighlightColor: "transparent",
      })}
    >
      {children}
    </button>
  );
}
