"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback, useEffect, useState } from "react";
import { profileManager } from "@/game/config/profileManager";

// A stored name that still looks like a wallet ("7NXk...uqbA") or the default
// "Citizen" counts as "unset" — so the name picker pre-fills empty.
function isRealName(n: string): boolean {
  return !!n && n !== "Citizen" && !/^[1-9A-HJ-NP-Za-km-z]{4}\.\.\.[1-9A-HJ-NP-Za-km-z]{4}$/.test(n);
}

export default function ConnectScreen({
  sessionPhase = "idle",
  namePrompt = false,
  onNameSubmit,
}: {
  /** Login-gate phase driven by CityScene: "connecting" holds this screen up
      (with a spinner) until the on-chain session is established. */
  sessionPhase?: "idle" | "connecting" | "ready";
  /** CityScene detected a brand-new wallet with no name yet → ask for one
      before the session (and initialize_player) proceeds. */
  namePrompt?: boolean;
  /** Called with the chosen name; CityScene resumes connecting once it fires. */
  onNameSubmit?: (name: string) => void;
}) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const openModal = useCallback(() => setVisible(true), [setVisible]);
  const [dismissed, setDismissed] = useState(false);

  // Reset "continue as guest" dismissal whenever the wallet disconnects so
  // clicking the disconnect button always returns the user to this screen.
  useEffect(() => {
    if (!connected) setDismissed(false);
  }, [connected]);

  // Guest chose local mode → never gate them.
  if (dismissed) return null;
  // Wallet connected AND the on-chain session is fully established → enter world.
  if (connected && sessionPhase === "ready" && !namePrompt) return null;

  // Which face of the gate to show:
  //   name      → brand-new wallet, waiting for the player to pick a name
  //   preparing → session establishing (init + delegate + confirm) → spinner
  //   connect   → not connected yet → connect + guest actions
  const mode: "connect" | "name" | "preparing" =
    namePrompt ? "name" : connected ? "preparing" : "connect";

  return (
    <GateView
      mode={mode}
      openModal={openModal}
      onGuest={() => setDismissed(true)}
      onNameSubmit={onNameSubmit}
    />
  );
}

// Staged spinner copy so a multi-second session setup feels alive rather than
// frozen. Times are approximate to the real connect() flow (init → authorize →
// delegate → confirm); the last message holds until the gate releases.
const PREPARING_STAGES: { at: number; label: string }[] = [
  { at: 0,     label: "Connecting wallet…" },
  { at: 2500,  label: "Creating your player…" },
  { at: 6000,  label: "Delegating to the rollup…" },
  { at: 10500, label: "Almost there — confirming…" },
];

function GateView({
  mode, openModal, onGuest, onNameSubmit,
}: {
  mode: "connect" | "name" | "preparing";
  openModal: () => void;
  onGuest: () => void;
  onNameSubmit?: (name: string) => void;
}) {
  const [stage, setStage] = useState(0);
  const [name, setName] = useState(() => {
    const stored = profileManager?.get().displayName ?? "";
    return isRealName(stored) ? stored : "";
  });

  const submitName = () => {
    const clean = name.trim().slice(0, 20);
    if (!clean) return;
    onNameSubmit?.(clean);
  };

  // Advance the spinner copy while the session is being established.
  useEffect(() => {
    if (mode !== "preparing") { setStage(0); return; }
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      let next = 0;
      for (let i = 0; i < PREPARING_STAGES.length; i++) {
        if (elapsed >= PREPARING_STAGES[i].at) next = i;
      }
      setStage(next);
    }, 400);
    return () => clearInterval(tick);
  }, [mode]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      <style>{`@keyframes solcity-gate-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Background — full brightness, let the art breathe */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/assets/branding/banner.png)",
          backgroundSize: "cover",
          backgroundPosition: "top center",
        }}
      />

      {/* Subtle gradient at very bottom only — keeps buttons readable */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to bottom, transparent 50%, rgba(0,0,10,0.65) 100%)",
        }}
      />

      {/* Bottom card — subtle glass panel with actions */}
      <div
        style={{
          position: "absolute",
          bottom: "max(env(safe-area-inset-bottom, 0px), 6%)",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          background: "rgba(6,8,20,0.58)",
          border: "1px solid rgba(153,69,255,0.28)",
          borderRadius: 20,
          padding: "28px 32px 22px",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.45)",
          width: "min(360px, 90vw)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 11,
            color: "#fff",
            letterSpacing: 3,
            textShadow: "0 0 16px rgba(153,69,255,0.8)",
            marginBottom: 8,
          }}>
            SOLANA CITY
          </div>
          <div style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 9,
            color: "rgba(180,180,255,0.65)",
            letterSpacing: 2,
          }}>
            A Solana social RPG
          </div>
        </div>

        {mode === "preparing" ? (
          /* ── Session establishing: spinner, no interactive buttons ── */
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
            padding: "6px 0 2px",
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              border: "3px solid rgba(153,69,255,0.25)",
              borderTopColor: "#14F195",
              animation: "solcity-gate-spin 0.8s linear infinite",
            }} />
            <div style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 9,
              color: "#fff",
              letterSpacing: 1,
              textAlign: "center",
              lineHeight: 1.6,
              minHeight: 14,
              transition: "opacity 0.2s",
            }}>
              {PREPARING_STAGES[stage].label}
            </div>
            <div style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 7,
              color: "rgba(180,180,255,0.6)",
              letterSpacing: 1,
              textAlign: "center",
              lineHeight: 1.8,
              maxWidth: 260,
            }}>
              Setting up your on-chain session. Sign the prompts to enter.
            </div>
          </div>
        ) : mode === "name" ? (
          /* ── Brand-new wallet: pick a name, then enter ── */
          <>
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 7, color: "rgba(180,180,255,0.6)", letterSpacing: 1,
                textAlign: "center",
              }}>
                CHOOSE YOUR NAME
              </label>
              <input
                autoFocus
                value={name}
                // Phaser captures WASD / arrows / space at the window level and
                // preventDefaults them — stop the event here so those keys type
                // into the field instead of driving the (hidden) game.
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") submitName();
                }}
                onKeyUp={(e) => e.stopPropagation()}
                onChange={(e) => setName(e.target.value.slice(0, 20))}
                maxLength={20}
                placeholder="pick a name"
                spellCheck={false}
                style={{
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: 9,
                  textAlign: "center",
                  color: "#fff",
                  background: "rgba(0,0,10,0.5)",
                  border: "1px solid rgba(153,69,255,0.4)",
                  borderRadius: 10,
                  padding: "12px 10px",
                  width: "100%",
                  outline: "none",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(20,241,149,0.6)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(153,69,255,0.4)"; }}
              />
              <span style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 6, color: "rgba(180,180,255,0.4)", letterSpacing: 0.5,
                textAlign: "center", lineHeight: 1.7,
              }}>
                shows above your character
              </span>
            </div>

            <button
              onClick={submitName}
              disabled={!name.trim()}
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 10,
                padding: "18px 52px",
                background: name.trim() ? "rgba(20,241,149,0.9)" : "rgba(80,80,100,0.5)",
                color: name.trim() ? "#052015" : "rgba(255,255,255,0.4)",
                border: "1px solid rgba(20,241,149,0.45)",
                borderRadius: 50,
                cursor: name.trim() ? "pointer" : "not-allowed",
                letterSpacing: 2,
                width: "100%",
                boxShadow: name.trim() ? "0 0 28px rgba(20,241,149,0.45), 0 4px 16px rgba(0,0,0,0.4)" : "none",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            >
              ENTER CITY
            </button>
          </>
        ) : (
          /* ── Not connected: connect + guest actions ── */
          <>
            <button
              onClick={openModal}
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 10,
                padding: "18px 52px",
                background: "rgba(153,69,255,0.9)",
                color: "#fff",
                border: "1px solid rgba(200,150,255,0.45)",
                borderRadius: 50,
                cursor: "pointer",
                letterSpacing: 2,
                width: "100%",
                boxShadow: "0 0 28px rgba(153,69,255,0.55), 0 4px 16px rgba(0,0,0,0.4)",
                transition: "background 0.15s, box-shadow 0.15s, transform 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(153,69,255,1)";
                e.currentTarget.style.boxShadow = "0 0 42px rgba(153,69,255,0.8), 0 4px 16px rgba(0,0,0,0.4)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(153,69,255,0.9)";
                e.currentTarget.style.boxShadow = "0 0 28px rgba(153,69,255,0.55), 0 4px 16px rgba(0,0,0,0.4)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              CONNECT WALLET
            </button>

            <button
              onClick={onGuest}
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 9,
                color: "rgba(255,255,255,0.4)",
                background: "none",
                border: "none",
                cursor: "pointer",
                letterSpacing: 1,
                marginTop: -4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
            >
              continue as guest
            </button>
          </>
        )}

        <div style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: 7,
          color: "#FFD700",
          opacity: 0.6,
          letterSpacing: 1,
          marginTop: -4,
        }}>
          ⚠ DEVNET
        </div>
      </div>
    </div>
  );
}
