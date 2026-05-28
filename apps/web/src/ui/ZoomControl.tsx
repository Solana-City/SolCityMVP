"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "solcity:zoom";
// Valid zooms: only multiples of 2 so that sprite_scale(0.5) × zoom = integer.
// Any other zoom causes fractional screen pixels → irregular pixel sizes.
const VALID_ZOOMS = [2, 4] as const;
type ValidZoom = (typeof VALID_ZOOMS)[number];

function emitGame(event: string, data?: unknown) {
  (globalThis as any).__solCityGameEvents?.emit(event, data);
}

function snapZoom(z: number): ValidZoom {
  return VALID_ZOOMS.reduce((best, v) =>
    Math.abs(v - z) < Math.abs(best - z) ? v : best
  ) as ValidZoom;
}

function loadZoom(): ValidZoom {
  const stored = parseFloat(localStorage.getItem(STORAGE_KEY) ?? "");
  return isNaN(stored) ? 2 : snapZoom(stored);
}

export default function ZoomControl() {
  const [zoom, setZoom] = useState<ValidZoom | null>(null);

  useEffect(() => {
    setZoom(loadZoom());
    // Sync display when pinch gesture changes zoom (pinch snaps to nearest valid)
    const handler = (e: Event) => setZoom(snapZoom((e as CustomEvent<number>).detail));
    window.addEventListener("solcity:zoom", handler);
    return () => window.removeEventListener("solcity:zoom", handler);
  }, []);

  if (zoom === null) return null;

  const idx = VALID_ZOOMS.indexOf(zoom);
  const canDec = idx > 0;
  const canInc = idx < VALID_ZOOMS.length - 1;

  function change(next: ValidZoom) {
    setZoom(next);
    localStorage.setItem(STORAGE_KEY, String(next));
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
      <ZBtn disabled={!canDec} onClick={() => change(VALID_ZOOMS[idx - 1])}>−</ZBtn>

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
        {zoom}×
      </span>

      <ZBtn disabled={!canInc} onClick={() => change(VALID_ZOOMS[idx + 1])}>+</ZBtn>
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
