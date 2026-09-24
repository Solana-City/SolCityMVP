"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback, useEffect, useState } from "react";
import GuestNotice from "./GuestNotice";
import ConnectingOverlay from "./ConnectingOverlay";
import { chamferBox } from "@/ui/chamfer";
import ChamferGlow from "@/ui/ChamferGlow";

export default function ConnectScreen() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const openModal = useCallback(() => setVisible(true), [setVisible]);
  const [dismissed, setDismissed] = useState(false);
  const [guestNotice, setGuestNotice] = useState(false);
  /** The on-chain session is up (or the player chose to go in without it). */
  const [sessionReady, setSessionReady] = useState(false);

  // Reset "continue as guest" dismissal whenever the wallet disconnects so
  // clicking the disconnect button always returns the user to this screen.
  useEffect(() => {
    if (!connected) { setDismissed(false); setSessionReady(false); }
  }, [connected]);

  // A connected wallet is not a working session: creating the player,
  // authorizing the session key and delegating to the rollup each take a
  // signature. The city waits here until that finishes, so nobody plays in a
  // city that cannot see them without knowing it (see ConnectingOverlay).
  useEffect(() => {
    let off: (() => void) | null = null;
    const attach = (): boolean => {
      const bus = (globalThis as any).__solCityGameEvents as
        | { on: Function; off: Function } | undefined;
      if (!bus) return false;
      const onReady = (online: boolean) => { if (online) setSessionReady(true); };
      // "ready" is the end of the handshake; "online" also fires when a retry
      // from the overlay succeeds, or when the first position write lands.
      bus.on("multiplayer:ready", onReady);
      bus.on("multiplayer:online", onReady);
      off = () => {
        bus.off("multiplayer:ready", onReady);
        bus.off("multiplayer:online", onReady);
      };
      return true;
    };
    if (!attach()) {
      const poll = setInterval(() => { if (attach()) clearInterval(poll); }, 300);
      return () => { clearInterval(poll); off?.(); };
    }
    return () => off?.();
  }, []);

  // Tell the page the player is in the city (connected or guest), so the
  // first-time city guide can open over the map instead of this screen.
  const entered = (connected && sessionReady) || dismissed;
  useEffect(() => {
    if (entered) window.dispatchEvent(new Event("solcity:entered-city"));
  }, [entered]);

  if (entered) return null;

  // Wallet connected, session still coming up: the handshake, not the menu.
  const connecting = connected && !sessionReady;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        overflow: "hidden",
      }}
    >
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
          borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
          borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
          imageRendering: "pixelated",
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

        <ChamferGlow
          glow="drop-shadow(0 0 14px rgba(153,69,255,0.55)) drop-shadow(0 4px 8px rgba(0,0,0,0.4))"
          style={{ width: "100%", transition: "filter 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.filter = "drop-shadow(0 0 21px rgba(153,69,255,0.8)) drop-shadow(0 4px 8px rgba(0,0,0,0.4))"; }}
          onMouseLeave={(e) => { e.currentTarget.style.filter = "drop-shadow(0 0 14px rgba(153,69,255,0.55)) drop-shadow(0 4px 8px rgba(0,0,0,0.4))"; }}
        >
          <button
            onClick={openModal}
            style={chamferBox(16, {
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 10,
              padding: "18px 52px",
              background: "rgba(153,69,255,0.9)",
              color: "#fff",
              border: "1px solid rgba(200,150,255,0.45)",
              cursor: "pointer",
              letterSpacing: 2,
              width: "100%",
              transition: "background 0.15s, transform 0.1s",
            })}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(153,69,255,1)";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(153,69,255,0.9)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            CONNECT WALLET
          </button>
        </ChamferGlow>

        <button
          onClick={() => setGuestNotice(true)}
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

      {connecting && (
        <ConnectingOverlay
          onEnter={() => setSessionReady(true)}
          onRetry={() => (globalThis as any).__solCityGameEvents?.emit("multiplayer:retry")}
        />
      )}

      {guestNotice && (
        <GuestNotice
          onPlay={() => { setGuestNotice(false); setDismissed(true); }}
          onConnect={() => { setGuestNotice(false); openModal(); }}
        />
      )}
    </div>
  );
}
