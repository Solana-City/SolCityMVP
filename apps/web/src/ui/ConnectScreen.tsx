"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback, useEffect, useState } from "react";

export default function ConnectScreen({
  sessionPhase = "idle",
  sessionError = false,
  sessionProgress = null,
}: {
  /** Login-gate phase driven by CityScene: "connecting" holds this screen up
      (with a spinner) until the on-chain session is established. */
  sessionPhase?: "idle" | "connecting" | "ready";
  /** connect() failed/timed out → show an error + RETRY instead of entering. */
  sessionError?: boolean;
  /** Real connect stage label (overrides the time-based copy when present). */
  sessionProgress?: string | null;
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
  if (connected && sessionPhase === "ready" && !sessionError) return null;

  // Which face of the gate to show:
  //   error     → connect() failed/timed out → message + RETRY (full reload)
  //   preparing → session establishing (init + delegate + confirm) → spinner
  //   connect   → not connected yet → connect + guest actions
  const mode: "connect" | "preparing" | "error" =
    sessionError ? "error" : connected ? "preparing" : "connect";

  return (
    <GateView
      mode={mode}
      progressLabel={sessionProgress}
      openModal={openModal}
      onGuest={() => setDismissed(true)}
      onRetry={forceReconnect}
    />
  );
}

/**
 * Retry the session from scratch with a full reload. We deliberately KEEP the
 * stored session key: for a delegated PDA the ER already trusts that exact key,
 * so dropping it forces an ER re-authorize (the fragile step that hangs). A
 * reload with the same key re-runs connect cleanly — matching key → no prompt.
 */
function forceReconnect() {
  window.location.reload();
}

// Staged spinner copy so a multi-second session setup feels alive rather than
// frozen. Times are approximate to the real connect() flow (init → authorize →
// delegate → confirm); the last message holds until the gate releases.
const PREPARING_STAGES: { at: number; label: string }[] = [
  { at: 0,     label: "Connecting wallet…" },
  { at: 2500,  label: "Creating your player…" },
  { at: 6000,  label: "Delegating to the rollup…" },
  { at: 10500, label: "Almost there — confirming…" },
  { at: 17000, label: "Taking longer than usual…" },
];

function GateView({
  mode, progressLabel, openModal, onGuest, onRetry,
}: {
  mode: "connect" | "preparing" | "error";
  progressLabel?: string | null;
  openModal: () => void;
  onGuest: () => void;
  onRetry: () => void;
}) {
  const [stage, setStage] = useState(0);

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

        {mode === "error" ? (
          /* ── Session failed: message + RETRY (never enter in local/sim) ── */
          <>
            <div style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 8, color: "#ff8080", letterSpacing: 1,
              textAlign: "center", lineHeight: 1.9, maxWidth: 280,
              padding: "2px 0 4px",
            }}>
              Couldn’t reach the network. Your session isn’t on-chain yet.
            </div>
            <button
              onClick={onRetry}
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
              }}
            >
              RETRY
            </button>
            <button
              onClick={onGuest}
              style={{
                fontFamily: '"Press Start 2P", monospace',
                fontSize: 9, color: "rgba(255,255,255,0.4)",
                background: "none", border: "none", cursor: "pointer",
                letterSpacing: 1, marginTop: -4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
            >
              continue as guest
            </button>
          </>
        ) : mode === "preparing" ? (
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
              {progressLabel ?? PREPARING_STAGES[stage].label}
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
            {/* Manual escape once it's been a while — forces a clean session. */}
            {stage >= 3 && (
              <button
                onClick={onRetry}
                style={{
                  fontFamily: '"Press Start 2P", monospace',
                  fontSize: 7, color: "rgba(180,180,255,0.7)",
                  background: "none",
                  border: "1px solid rgba(153,69,255,0.35)",
                  borderRadius: 8, padding: "8px 14px",
                  cursor: "pointer", letterSpacing: 1, marginTop: 4,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(20,241,149,0.6)"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(153,69,255,0.35)"; e.currentTarget.style.color = "rgba(180,180,255,0.7)"; }}
              >
                Force reconnect
              </button>
            )}
          </div>
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
