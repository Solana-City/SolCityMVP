"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "solcity:zoom";
const MIN = 1;
const MAX = 3;
const STEP = 0.25;

function emitGame(event: string, data?: unknown) {
  (globalThis as any).__solCityGameEvents?.emit(event, data);
}

function defaultZoom(): number {
  return window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2;
}

function loadZoom(): number {
  const stored = parseFloat(localStorage.getItem(STORAGE_KEY) ?? "");
  return isNaN(stored) ? defaultZoom() : stored;
}

export default function ZoomControl() {
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    setZoom(loadZoom());
  }, []);

  if (zoom === null) return null;

  function change(next: number) {
    const clamped = Math.round(next * 100) / 100;
    setZoom(clamped);
    localStorage.setItem(STORAGE_KEY, String(clamped));
    emitGame("camera:zoom", clamped);
  }

  const canDec = zoom > MIN;
  const canInc = zoom < MAX;

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
      <ZBtn disabled={!canDec} onClick={() => change(zoom - STEP)}>−</ZBtn>

      <span
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "8px",
          color: "#9945FF",
          minWidth: 32,
          textAlign: "center",
          userSelect: "none",
        }}
      >
        {zoom.toFixed(zoom % 1 === 0 ? 0 : 2)}×
      </span>

      <ZBtn disabled={!canInc} onClick={() => change(zoom + STEP)}>+</ZBtn>
    </div>
  );
}

function ZBtn({
  children,
  onClick,
  disabled,
}: {
  children: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22,
        height: 22,
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
      }}
    >
      {children}
    </button>
  );
}
