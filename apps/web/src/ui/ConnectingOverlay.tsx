"use client";

/**
 * What happens between "wallet connected" and "you are really in the city".
 *
 * The city used to open the moment the wallet connected, while the on-chain
 * handshake (create player, authorize the session, delegate to the rollup)
 * was still running and waiting on signatures. A player who missed those
 * prompts — easy on a phone, where the wallet opens in another app — walked
 * around a city that could not see them, with nothing saying why.
 *
 * So the connect screen stays up and shows the handshake: three steps, the
 * current one lit, and a clear "approve in your wallet" whenever a step is
 * waiting on a signature. Nobody is trapped here: there is always a way into
 * the city, and a retry when it fails.
 */
import { useEffect, useState } from "react";
import { Citizen, Img } from "./CityGuide";
import { chamferBox, octagonFrame } from "@/ui/chamfer";

const PIXEL = '"Press Start 2P", monospace';
const GREEN = "#B7E928";
const PURPLE = "#9945FF";
const DANGER = "#ff5a5a";
const UI = "/assets/ui";

/** Progress labels from OnChainMultiplayer, mapped onto the three steps. */
const STEPS = ["YOUR PLAYER", "SESSION KEY", "ROLLUP"] as const;

function stepOf(label: string): number {
  const l = label.toLowerCase();
  if (l.includes("delegat")) return 2;
  if (l.includes("session") || l.includes("authoriz") || l.includes("funding")) return 1;
  return 0;
}

/** Seconds before we offer a way in regardless — a handshake can stall. */
const ESCAPE_AFTER_MS = 25_000;

export default function ConnectingOverlay({ onEnter, onRetry }: { onEnter: () => void; onRetry: () => void }) {
  const [label, setLabel] = useState("Starting your session...");
  const [failed, setFailed] = useState(false);
  const [canSkip, setCanSkip] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setCanSkip(true), ESCAPE_AFTER_MS);
    let off: (() => void) | null = null;
    const attach = (): boolean => {
      const bus = (globalThis as any).__solCityGameEvents as
        | { on: Function; off: Function } | undefined;
      if (!bus) return false;
      const onProgress = (text: string) => { setLabel(text); setFailed(false); };
      const onReady = (online: boolean) => setFailed(!online);
      bus.on("game:sessionProgress", onProgress);
      bus.on("multiplayer:ready", onReady);
      bus.on("multiplayer:online", onReady);
      off = () => {
        bus.off("game:sessionProgress", onProgress);
        bus.off("multiplayer:ready", onReady);
        bus.off("multiplayer:online", onReady);
      };
      return true;
    };
    if (!attach()) {
      const poll = setInterval(() => { if (attach()) clearInterval(poll); }, 300);
      return () => { clearInterval(poll); clearTimeout(timer); off?.(); };
    }
    return () => { clearTimeout(timer); off?.(); };
  }, []);

  const step = stepOf(label);
  const needsSignature = label.toLowerCase().includes("sign");

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,10,0.72)", padding: 16,
    }}>
      <div style={{
        width: "min(340px, 100%)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto",
        padding: 22, textAlign: "center",
        background: "linear-gradient(180deg, rgba(15,18,40,0.98) 0%, rgba(8,10,24,0.98) 100%)",
        ...octagonFrame(1),
      }}>
        <div style={{ fontFamily: PIXEL, fontSize: 8, color: failed ? DANGER : GREEN, marginBottom: 12 }}>
          {failed ? "COULD NOT CONNECT" : "ENTERING THE CITY"}
        </div>

        {/* The player, and what the wallet wants from them right now */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 12, marginBottom: 12 }}>
          <Citizen sheet="main_char.png" size={64} />
          {failed
            ? <Img src={`${UI}/attention_red.png`} h={30} style={{ marginBottom: 18 }} />
            : needsSignature
              ? <Img src={`${UI}/attention_yellow.png`} h={30} style={{ marginBottom: 18, animation: "co-bob 0.9s ease-in-out infinite" }} />
              : <Img src={`${UI}/btn_connect.png`} h={30} style={{ marginBottom: 18, opacity: 0.85 }} />}
        </div>

        {/* Three steps, the current one lit */}
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 10 }}>
          {STEPS.map((s, n) => (
            <div key={s} style={chamferBox(6, {
              flex: 1, padding: "6px 2px", 
              fontFamily: PIXEL, fontSize: 6, lineHeight: 1.5,
              color: n < step ? "#0a0a14" : n === step ? "#fff" : "#6a6a7d",
              background: n < step ? GREEN : n === step ? "rgba(153,69,255,0.35)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${n === step && !failed ? PURPLE : "transparent"}`,
            })}>
              {s}
            </div>
          ))}
        </div>

        <div style={{ fontFamily: PIXEL, fontSize: 7, color: "#b9b9cc", lineHeight: 1.8, minHeight: "3.6em" }}>
          {failed
            ? "The city could not reach the chain. Nobody would see you in there."
            : needsSignature
              ? "Approve it in your wallet. On a phone, switch to the wallet app."
              : label}
        </div>

        {(failed || canSkip) && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={onEnter}
              style={chamferBox(6, {
                flex: 1, fontFamily: PIXEL, fontSize: 7, padding: "9px 10px", cursor: "pointer",
                background: "transparent", border: "1px solid #333344", color: "#b9b9cc",
              })}
            >
              ENTER ANYWAY
            </button>
            <button
              onClick={onRetry}
              style={chamferBox(6, {
                flex: 1, fontFamily: PIXEL, fontSize: 7, padding: "9px 10px", cursor: "pointer",
                background: failed ? DANGER : PURPLE, color: "#fff", border: "none",
              })}
            >
              TRY AGAIN
            </button>
          </div>
        )}
      </div>
      <style>{`
        @keyframes co-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      `}</style>
    </div>
  );
}
