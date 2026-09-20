"use client";

import { useEffect, useState } from "react";

/**
 * "Nobody can see you" badge.
 *
 * Every player reads the city off the rollup, so a wallet whose PDA never got
 * delegated writes its position where nobody looks: it sees the whole city and
 * is absent from it. That failure used to be silent, and it reads exactly like
 * an empty city. OnChainMultiplayer emits `multiplayer:online`; this shows the
 * false case and offers another go at the on-chain setup.
 */
const PIXEL = '"Press Start 2P", monospace';
const DANGER = "#ff5a5a";

export default function OfflineBadge() {
  const [hidden, setHidden] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let off: (() => void) | null = null;

    const attach = (): boolean => {
      const bus = (globalThis as any).__solCityGameEvents as
        | { on: Function; off: Function } | undefined;
      if (!bus) return false;
      const handler = (online: boolean) => {
        setHidden(!online);
        if (online) setRetrying(false);
      };
      bus.on("multiplayer:online", handler);
      off = () => bus.off("multiplayer:online", handler);
      return true;
    };

    // The bus only exists once CityScene.create() has run.
    if (!attach()) {
      const timer = setInterval(() => { if (attach()) clearInterval(timer); }, 300);
      return () => { clearInterval(timer); off?.(); };
    }
    return () => off?.();
  }, []);

  if (!hidden) return null;

  return (
    <div style={{
      position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 8px)", left: "50%",
      transform: "translateX(-50%)", zIndex: 40, display: "flex", alignItems: "center", gap: 10,
      padding: "7px 10px", borderRadius: 8, pointerEvents: "auto",
      background: "rgba(18,8,12,0.94)", border: `1px solid ${DANGER}66`,
      boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: DANGER, flexShrink: 0,
        animation: "ob-pulse 1.4s ease-in-out infinite",
      }} />
      <span style={{ fontFamily: PIXEL, fontSize: 7, color: "#ffd9d9", lineHeight: 1.6 }}>
        NOBODY CAN SEE YOU
      </span>
      <button
        onClick={() => {
          setRetrying(true);
          (globalThis as any).__solCityGameEvents?.emit("multiplayer:retry");
        }}
        disabled={retrying}
        style={{
          fontFamily: PIXEL, fontSize: 7, padding: "6px 8px", borderRadius: 6, cursor: retrying ? "default" : "pointer",
          background: retrying ? "#3a2430" : DANGER, color: retrying ? "#b9b9cc" : "#1a0a0e", border: "none",
        }}
      >
        {retrying ? "TRYING..." : "FIX"}
      </button>
      <style>{`
        @keyframes ob-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
      `}</style>
    </div>
  );
}
