"use client";

import { useEffect, useState } from "react";
import {
  getValidZooms, snapZoom, loadZoom, saveZoom, formatViewScale,
} from "@/game/config/zoomConfig";

function emitGame(event: string, data?: unknown) {
  (globalThis as any).__solCityGameEvents?.emit(event, data);
}

export default function ZoomControl() {
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
  const btnSize = isTouch ? 30 : 22;

  function change(next: number) {
    setZoom(next);
    saveZoom(next);
    emitGame("camera:zoom", next);
    window.dispatchEvent(new CustomEvent("solcity:zoom", { detail: next }));
  }

  return (
    <div
      className="flex items-center gap-1 rounded-lg px-2 py-1.5"
      style={{
        background: "rgba(10,10,30,0.85)",
        border: "1px solid rgba(153,69,255,0.25)",
        backdropFilter: "blur(4px)",
        fontFamily: '"Fira Code", monospace',
      }}
    >
      <ZBtn size={btnSize} disabled={!canDec} onClick={() => change(zooms[idx - 1])}>−</ZBtn>

      <span
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "8px",
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
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        border: "1px solid rgba(153,69,255,0.3)",
        background: disabled ? "transparent" : "rgba(153,69,255,0.12)",
        color: disabled ? "#333344" : "#9945FF",
        fontSize: "14px",
        lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        transition: "background 0.1s",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}
