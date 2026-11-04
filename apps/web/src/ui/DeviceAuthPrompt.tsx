"use client";

import { useEffect, useState } from "react";
import { getNetwork, DEVICE_AUTH_EVENT } from "@/game/multiplayer/OnChainMultiplayer";

/**
 * Shown when this device's session key is not the one the rollup holds, so
 * nobody else can see this player. The button matters: on a phone the wallet
 * only opens right after a tap, so the authorization has to start from one
 * (OnChainMultiplayer.authorizeThisDevice).
 */
export function DeviceAuthPrompt() {
  const [needed, setNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const on = (e: Event) => setNeeded((e as CustomEvent<{ needed: boolean }>).detail.needed);
    window.addEventListener(DEVICE_AUTH_EVENT, on);
    return () => window.removeEventListener(DEVICE_AUTH_EVENT, on);
  }, []);

  if (!needed) return null;

  const authorize = async () => {
    setBusy(true);
    setError("");
    try {
      await getNetwork()?.authorizeThisDevice();
    } catch (err) {
      setError((err as Error).message?.split("\n")[0] ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", left: "50%", top: 12, transform: "translateX(-50%)", zIndex: 150,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        padding: "10px 14px", maxWidth: "calc(100vw - 32px)",
        background: "rgba(6,10,20,0.92)", border: "1px solid #14F0C6",
        fontFamily: '"Press Start 2P", monospace', color: "#d0d0f0", textAlign: "center",
      }}
    >
      <div style={{ fontSize: 8, lineHeight: 1.6 }}>Others cannot see you yet</div>
      <button
        onClick={authorize}
        disabled={busy}
        style={{
          padding: "9px 14px", fontFamily: "inherit", fontSize: 8, letterSpacing: 1,
          color: "#061A3A", background: busy ? "#4a5068" : "#14F0C6", border: "none",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "APPROVE IN WALLET" : "AUTHORIZE THIS DEVICE"}
      </button>
      {error && <div style={{ fontSize: 7, color: "#ff5c7a", lineHeight: 1.6 }}>{error}</div>}
    </div>
  );
}

export default DeviceAuthPrompt;
