"use client";

import { useEffect, useState } from "react";
import { getNetwork, OTHER_TAB_EVENT } from "@/game/multiplayer/OnChainMultiplayer";

/**
 * Shown on a tab that another tab of this browser has taken over.
 *
 * Both tabs share the wallet, the session key and the delegation, so only one
 * may write (OnChainMultiplayer.playHere). This one keeps reading the city
 * behind the veil, and "Play here" takes it back at once: no signature, no SOL.
 */
export function OtherTabOverlay() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setPaused(!(e as CustomEvent<{ playing: boolean }>).detail.playing);
    window.addEventListener(OTHER_TAB_EVENT, on);
    return () => window.removeEventListener(OTHER_TAB_EVENT, on);
  }, []);

  if (!paused) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 18, padding: 16,
        background: "rgba(6,10,20,0.78)", backdropFilter: "blur(4px)",
        fontFamily: '"Press Start 2P", monospace', color: "#d0d0f0", textAlign: "center",
      }}
    >
      <div style={{ fontSize: 11, lineHeight: 1.6 }}>Playing in another tab</div>
      <button
        onClick={() => getNetwork()?.playHere()}
        style={{
          padding: "12px 20px", fontFamily: "inherit", fontSize: 9, letterSpacing: 1,
          color: "#061A3A", background: "#14F0C6", border: "none", cursor: "pointer",
        }}
      >
        PLAY HERE
      </button>
    </div>
  );
}

export default OtherTabOverlay;
