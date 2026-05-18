"use client";

import { useState, useEffect } from "react";

/**
 * RotatePrompt
 *
 * Shows a full-screen overlay on touch (mobile) devices when the user is
 * holding the phone in portrait orientation. Disappears automatically when
 * they rotate to landscape. No-op on desktop.
 */
export default function RotatePrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only relevant on touch devices (phones/tablets)
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const mq = window.matchMedia("(orientation: portrait)");
    setShow(mq.matches);

    const onChange = (e: MediaQueryListEvent) => setShow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#06080e",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        fontFamily: '"Fira Code", monospace',
      }}
    >
      <style>{`
        @keyframes sc-rotate-hint {
          0%   { transform: rotate(0deg);   }
          30%  { transform: rotate(-90deg); }
          70%  { transform: rotate(-90deg); }
          100% { transform: rotate(0deg);   }
        }
      `}</style>

      <div style={{ fontSize: 64, animation: "sc-rotate-hint 2.4s ease-in-out infinite" }}>
        📱
      </div>

      <div style={{ textAlign: "center", padding: "0 32px" }}>
        <div
          style={{
            color: "#9945FF",
            fontSize: 18,
            fontWeight: "bold",
            marginBottom: 10,
            letterSpacing: -0.3,
          }}
        >
          Rotate your device
        </div>
        <div style={{ color: "#444466", fontSize: 13, lineHeight: 1.6 }}>
          Sol City is designed for landscape mode.
          <br />
          Turn your phone sideways to play.
        </div>
      </div>

      {/* Solana purple accent line */}
      <div
        style={{
          width: 48,
          height: 3,
          borderRadius: 2,
          background: "linear-gradient(90deg, #9945FF, #14F195)",
        }}
      />
    </div>
  );
}
