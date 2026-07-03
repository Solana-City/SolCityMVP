"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useCallback, useState } from "react";

export default function ConnectScreen() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const openModal = useCallback(() => setVisible(true), [setVisible]);
  const [dismissed, setDismissed] = useState(false);

  if (connected || dismissed) return null;

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
            fontSize: 15,
            color: "#fff",
            letterSpacing: 3,
            textShadow: "0 0 16px rgba(153,69,255,0.8)",
            marginBottom: 8,
          }}>
            SOLANA CITY
          </div>
          <div style={{
            fontFamily: '"Fira Code", monospace',
            fontSize: 12,
            color: "rgba(180,180,255,0.65)",
            letterSpacing: 2,
          }}>
            A Solana social RPG
          </div>
        </div>

        <button
          onClick={openModal}
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 13,
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
          onClick={() => setDismissed(true)}
          style={{
            fontFamily: '"Fira Code", monospace',
            fontSize: 12,
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
          fontSize: 8,
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
