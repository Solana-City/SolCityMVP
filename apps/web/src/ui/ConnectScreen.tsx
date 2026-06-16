"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback } from "react";

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

      {/* Logo — top center, floating over art */}
      <div
        style={{
          position: "absolute",
          top: "6%",
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <img
          src="/assets/branding/icon.png"
          alt="Solana City"
          style={{ width: 72, height: 72, filter: "drop-shadow(0 0 18px rgba(153,69,255,0.7))" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 28,
            color: "#fff",
            letterSpacing: 3,
            textShadow: "0 0 24px rgba(153,69,255,0.9), 0 2px 8px rgba(0,0,0,0.8)",
            lineHeight: 1,
          }}
        >
          SOLANA CITY
        </div>
        <div
          style={{
            fontFamily: '"Fira Code", monospace',
            fontSize: 12,
            color: "rgba(255,255,255,0.6)",
            letterSpacing: 2,
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          A Solana social RPG
        </div>
      </div>

      {/* Bottom actions — floating pill buttons like Spellborne */}
      <div
        style={{
          position: "absolute",
          bottom: "8%",
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          onClick={openModal}
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 11,
            padding: "16px 48px",
            background: "rgba(153,69,255,0.88)",
            color: "#fff",
            border: "1px solid rgba(200,150,255,0.5)",
            borderRadius: 50,
            cursor: "pointer",
            letterSpacing: 1,
            boxShadow: "0 0 24px rgba(153,69,255,0.5), 0 4px 20px rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
            transition: "background 0.15s, box-shadow 0.15s, transform 0.1s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(153,69,255,1)";
            e.currentTarget.style.boxShadow = "0 0 36px rgba(153,69,255,0.75), 0 4px 20px rgba(0,0,0,0.5)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(153,69,255,0.88)";
            e.currentTarget.style.boxShadow = "0 0 24px rgba(153,69,255,0.5), 0 4px 20px rgba(0,0,0,0.5)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          CONNECT WALLET
        </button>

        <button
          onClick={() => {
            const el = document.getElementById("solcity-connect-overlay");
            if (el) el.style.display = "none";
          }}
          style={{
            fontFamily: '"Fira Code", monospace',
            fontSize: 11,
            color: "rgba(255,255,255,0.45)",
            background: "none",
            border: "none",
            cursor: "pointer",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            letterSpacing: 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.45)"; }}
        >
          continue as guest
        </button>

        {/* Devnet badge */}
        <div
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 8,
            color: "#FFD700",
            letterSpacing: 1,
            opacity: 0.7,
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          ⚠ DEVNET
        </div>
      </div>
    </div>
  );
}
