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
      {/* Background banner */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/assets/branding/banner.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "brightness(0.45)",
        }}
      />

      {/* Vignette overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.72) 100%)",
        }}
      />

      {/* Card */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          background: "rgba(8,10,22,0.72)",
          border: "1px solid rgba(153,69,255,0.35)",
          borderRadius: 18,
          padding: "36px 44px",
          backdropFilter: "blur(18px)",
          maxWidth: 360,
          width: "90vw",
          boxShadow: "0 0 48px rgba(153,69,255,0.18), 0 0 120px rgba(20,241,149,0.06)",
        }}
      >
        {/* Icon */}
        <img
          src="/assets/branding/icon.png"
          alt="Solana City"
          style={{ width: 80, height: 80, imageRendering: "pixelated" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />

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
            SOL CITY
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
          DEVNET — testnet only. No real funds.
        </div>
      </div>
    </div>
  );
}
