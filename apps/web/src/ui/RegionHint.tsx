"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getNetwork, DEVICE_AUTH_EVENT } from "@/game/multiplayer/OnChainMultiplayer";
import { clusterKey } from "@/game/config/clusterStorage";
import { chamferBox, octagonFrameThin } from "@/ui/chamfer";
import { useButtonFeel, feelStyle } from "@/ui/useButtonFeel";
import { useRegion } from "@/ui/useRegion";

const PIXEL = '"Press Start 2P", monospace';
const CYAN = "#14F0C6";

/** The region the player said "not now" to, per wallet. A new suggestion asks again. */
const dismissKey = (wallet: string) => clusterKey(`solcity-region-hint-${wallet}`);

function readDismissed(wallet: string): string | null {
  try { return localStorage.getItem(dismissKey(wallet)); } catch { return null; }
}

/**
 * Shown when another region's rollup is clearly faster than the one this
 * account is delegated to: a player who travelled keeps the region of their
 * first login until the delegation ends, which can be many sessions away.
 * One tap moves them (OnChainMultiplayer.switchValidator); the same choice is
 * in Settings, under REGION.
 */
export function RegionHint() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const { advice, switching } = useRegion();
  const [deviceAuth, setDeviceAuth] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [error, setError] = useState("");
  const moveFeel = useButtonFeel();
  const laterFeel = useButtonFeel();

  useEffect(() => { setDismissed(wallet ? readDismissed(wallet) : null); }, [wallet]);

  // One prompt at a time, and being seen at all comes first.
  useEffect(() => {
    const on = (e: Event) => setDeviceAuth((e as CustomEvent<{ needed: boolean }>).detail.needed);
    window.addEventListener(DEVICE_AUTH_EVENT, on);
    return () => window.removeEventListener(DEVICE_AUTH_EVENT, on);
  }, []);

  if (!wallet || deviceAuth) return null;
  if (!switching && (!advice || dismissed === advice.suggested.id)) return null;

  const later = () => {
    if (!advice) return;
    try { localStorage.setItem(dismissKey(wallet), advice.suggested.id); } catch { /* storage blocked */ }
    setDismissed(advice.suggested.id);
  };

  const move = async () => {
    if (!advice) return;
    setError("");
    try {
      await getNetwork()?.switchValidator(advice.suggested.id);
    } catch (err) {
      setError((err as Error).message?.split("\n")[0] ?? "Try again.");
    }
  };

  const ms = (n: number | null) => (n === null ? "no answer" : `${n}ms`);

  return (
    <div
      style={{
        // The window frame every panel wears, so this reads as the city's own.
        ...octagonFrameThin(),
        position: "fixed", left: "50%", top: 12, transform: "translateX(-50%)", zIndex: 150,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        padding: "12px 16px", maxWidth: "calc(100vw - 32px)",
        background: "rgba(8,10,30,0.98)",
        fontFamily: PIXEL, color: "#d0d0f0", textAlign: "center",
      }}
    >
      {switching ? (
        <div style={{ fontSize: 8, lineHeight: 1.6 }}>Moving... approve in your wallet</div>
      ) : advice && (
        <>
          <div style={{ fontSize: 8, lineHeight: 1.6 }}>
            {advice.suggested.label} is faster from here
          </div>
          <div style={{ fontSize: 7, lineHeight: 1.6, color: "#7f88a8" }}>
            {advice.suggested.label} {ms(advice.suggestedMs)} · {advice.current.label} {ms(advice.currentMs)}
          </div>
          <div className="flex" style={{ gap: 10 }}>
            <button
              onClick={later}
              {...laterFeel.handlers}
              style={chamferBox(6, {
                padding: "9px 14px", fontFamily: "inherit", fontSize: 8, letterSpacing: 1,
                color: "#aaaacc", background: "transparent", border: "1px solid #aaaacc",
                cursor: "pointer", ...feelStyle(laterFeel),
              })}
            >
              NOT NOW
            </button>
            <button
              onClick={move}
              {...moveFeel.handlers}
              style={chamferBox(6, {
                padding: "9px 14px", fontFamily: "inherit", fontSize: 8, letterSpacing: 1,
                color: "#061A3A", background: CYAN, border: "none",
                cursor: "pointer", ...feelStyle(moveFeel),
              })}
            >
              MOVE TO {advice.suggested.label.toUpperCase()}
            </button>
          </div>
          <div style={{ fontSize: 6, lineHeight: 1.6, color: "#5f6788" }}>
            About 0.003 SOL and one approval
          </div>
        </>
      )}
      {error && <div style={{ fontSize: 7, color: "#ff5c7a", lineHeight: 1.6 }}>{error}</div>}
    </div>
  );
}

export default RegionHint;
