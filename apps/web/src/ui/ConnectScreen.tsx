"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback } from "react";

/**
 * Full-screen login overlay shown before the wallet is connected.
 * Uses the branding banner as background and the icon in the card.
 * Disappears as soon as the wallet connects.
 */
export default function ConnectScreen() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const openModal = useCallback(() => setVisible(true), [setVisible]);

  if (connected) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Background banner — full visible, slight dim only at edges */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/assets/branding/banner.png)",
          backgroundSize: "cover",
          backgroundPosition: "top center",
          filter: "brightness(0.72) saturate(1.1)",
        }}
      />

      {/* Bottom-heavy vignette so banner reads clearly at top */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Card — solid dark base matching icon background, no blur clash */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          background: "#0a0d18",
          border: "1px solid rgba(153,69,255,0.4)",
          borderRadius: 18,
          overflow: "hidden",
          maxWidth: 360,
          width: "90vw",
          boxShadow: "0 0 56px rgba(153,69,255,0.22), 0 8px 48px rgba(0,0,0,0.6)",
        }}
      >
        {/* Icon — fills top of card edge-to-edge, no padding gap */}
        <img
          src="/assets/branding/icon.png"
          alt="Solana City"
          style={{ width: "100%", display: "block", maxHeight: 200, objectFit: "cover", objectPosition: "center top" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />

        {/* Content below icon */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "0 40px 32px" }}>

        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: 18,
              color: "#e0e0ff",
              letterSpacing: 2,
              marginBottom: 8,
              lineHeight: 1.4,
            }}
          >
            SOLANA CITY
          </div>
          <div
            style={{
              fontFamily: '"Fira Code", monospace',
              fontSize: 12,
              color: "#9945FF",
              letterSpacing: 1,
            }}
          >
            A Solana social RPG
          </div>
        </div>

        {/* Connect button */}
        <button
          onClick={openModal}
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 11,
            padding: "14px 28px",
            background: "rgba(153,69,255,0.85)",
            color: "#fff",
            border: "1px solid rgba(153,69,255,0.6)",
            borderRadius: 10,
            cursor: "pointer",
            letterSpacing: 1,
            width: "100%",
            transition: "background 0.15s, box-shadow 0.15s",
            boxShadow: "0 0 18px rgba(153,69,255,0.35)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(153,69,255,1)";
            e.currentTarget.style.boxShadow = "0 0 28px rgba(153,69,255,0.55)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(153,69,255,0.85)";
            e.currentTarget.style.boxShadow = "0 0 18px rgba(153,69,255,0.35)";
          }}
        >
          CONNECT WALLET
        </button>

        {/* Play as guest — smaller, subtle */}
        <button
          onClick={() => {
            /* dismiss overlay without connecting — lets guest explore */
            const overlay = document.getElementById("solcity-connect-overlay");
            if (overlay) overlay.style.display = "none";
          }}
          style={{
            fontFamily: '"Fira Code", monospace',
            fontSize: 11,
            color: "#555577",
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
            marginTop: -8,
          }}
        >
          continue as guest
        </button>

        {/* Devnet notice */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(255,200,0,0.07)",
            border: "1px solid rgba(255,200,0,0.2)",
            borderRadius: 6,
            padding: "7px 12px",
            fontSize: 9,
            color: "#FFD700",
            fontFamily: '"Press Start 2P", monospace',
            letterSpacing: 0.5,
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 12 }}>⚠</span>
          DEVNET
        </div>
        </div>{/* end inner content */}
      </div>{/* end card */}
    </div>
  );
}
