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

  const PX = '"Press Start 2P", monospace';
  return (
    <div className="sc-root" style={{ position: "fixed", inset: 0, zIndex: 100, overflow: "hidden", background: "#07152E" }}>
      <style>{`
        .sc-root { display: flex; flex-direction: row-reverse; }
        .sc-side { width: min(600px, 36vw); min-width: 340px; flex-shrink: 0; overflow-y: auto; }
        .sc-hero { flex: 1; min-width: 0; background: url(/assets/branding/city-hero.webp) center / cover no-repeat; image-rendering: pixelated; }
        @media (max-width: 820px) {
          .sc-root { flex-direction: column-reverse; }
          .sc-side { width: 100%; min-width: 0; flex: 1; }
          .sc-hero { flex: 0 0 30vh; }
        }
      `}</style>

      <div className="sc-side" style={{
        background: "#07152E", fontFamily: PX,
        padding: "clamp(20px, 5vh, 56px) clamp(20px, 3.2vw, 56px)",
        display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 24,
        boxSizing: "border-box",
      }}>
        <div>
          <img src="/assets/branding/logo.png" alt="SolanaCity" draggable={false}
            style={{ display: "block", width: "clamp(200px, 24vw, 380px)", maxWidth: "100%", height: "auto", imageRendering: "pixelated" }} />
          <div style={{ marginTop: 10, fontSize: "clamp(6px, 0.72vw, 10px)", letterSpacing: 2, color: "#8FA6E6" }}>
            BUILD · PLAY · OWN · TOGETHER
          </div>
        </div>

        <div>
          <div style={{ fontSize: "clamp(6px, 0.72vw, 10px)", letterSpacing: 2, color: "#14F0C6", marginBottom: 20 }}>
            YOUR NEXT ADVENTURE
          </div>
          <div style={{ fontSize: "clamp(16px, 2.1vw, 30px)", lineHeight: 1.15, color: "#fff", textShadow: "3px 3px 0 rgba(0,0,0,0.35)" }}>
            Welcome to<br />SolanaCity
          </div>
          <div style={{ marginTop: 22, fontSize: "clamp(6px, 0.72vw, 10px)", lineHeight: 1.9, color: "#8FA6E6" }}>
            Explore the city. Meet your people.<br />Make yourself at home.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ChamferGlow
            glow="drop-shadow(0 0 12px rgba(183,233,40,0.35))"
            style={{ width: "100%", transition: "filter 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = "drop-shadow(0 0 18px rgba(183,233,40,0.7))"; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = "drop-shadow(0 0 12px rgba(183,233,40,0.35))"; }}
          >
            <button
              onClick={openModal}
              style={chamferBox(10, {
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
                fontFamily: PX, fontSize: "clamp(9px, 1vw, 14px)", letterSpacing: 1,
                padding: "clamp(16px, 2.4vh, 24px) 24px",
                background: "#B7E928", color: "#0a1a14", border: "none", cursor: "pointer",
                transition: "transform 0.1s",
              })}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <img src="/assets/ui/icon_wallet2.png" alt="" draggable={false}
                style={{ height: "clamp(22px, 2.6vw, 34px)", width: "auto", imageRendering: "pixelated", display: "block" }} />
              CONNECT WALLET
            </button>
          </ChamferGlow>

          <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#5F7BB8", fontSize: 10 }}>
            <span style={{ flex: 1, height: 1, background: "rgba(143,166,230,0.35)" }} />OR
            <span style={{ flex: 1, height: 1, background: "rgba(143,166,230,0.35)" }} />
          </div>

          <button
            onClick={() => setGuestNotice(true)}
            style={chamferBox(10, {
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
              fontFamily: PX, fontSize: "clamp(8px, 0.9vw, 12px)", letterSpacing: 1,
              padding: "clamp(14px, 2.2vh, 22px) 24px",
              background: "transparent", color: "#fff", border: "2px solid #14F0C6", cursor: "pointer",
              transition: "background-color 0.15s",
            })}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(20,240,198,0.12)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            CONTINUE AS GUEST
            <svg width="18" height="14" viewBox="0 0 9 7" shapeRendering="crispEdges" fill="#14F0C6">
              <path d="M0 3h7v1H0zM5 1h1v1H5zM6 2h1v1H6zM6 4h1v1H6zM5 5h1v1H5zM7 3h1v1H7z" />
            </svg>
          </button>

          <div style={{ textAlign: "center", fontSize: "clamp(6px, 0.62vw, 9px)", lineHeight: 1.8, color: "#6F88C8" }}>
            Start exploring. Connect your wallet later.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: "clamp(6px, 0.62vw, 9px)" }}>
          <span style={chamferBox(6, { border: "2px solid #FFD700", color: "#FFD700", padding: "8px 14px", letterSpacing: 1 })}>DEVNET</span>
          <span style={{ width: 1, height: 22, background: "rgba(143,166,230,0.35)" }} />
          <span style={{ color: "#6F88C8" }}>A Solana social RPG</span>
        </div>
      </div>

      <div className="sc-hero" />

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
