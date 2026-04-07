"use client";

import { useState, useCallback, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import type { NPCAction } from "@/game/config/npcRegistry";

interface ActionPanelProps {
  action: NPCAction | null;
  onClose: () => void;
}

export default function ActionPanel({ action, onClose }: ActionPanelProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!action) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(6,10,20,0.6)" }}
        onClick={onClose}
      />
      <div
        className="relative rounded-2xl p-6 w-full max-w-md"
        style={{
          background: "rgba(10,10,30,0.97)",
          border: "1px solid rgba(153,69,255,0.25)",
          fontFamily: '"Fira Code", monospace',
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-lg cursor-pointer"
          style={{ background: "none", border: "none", color: "#555566" }}
        >
          ×
        </button>

        {action.type === "swap" && <SwapPanel onClose={onClose} />}
        {action.type === "transfer" && <TransferPanel onClose={onClose} />}
        {action.type === "bounties" && <BountiesPanel onClose={onClose} />}
        {action.type === "explore" && <ExplorePanel onClose={onClose} />}
        {action.type === "port" && <PortPanel onClose={onClose} />}
      </div>
    </div>
  );
}

function SwapPanel({ onClose }: { onClose: () => void }) {
  const { connected } = useWallet();
  const [done, setDone] = useState(false);

  const handleSwap = useCallback(() => {
    // In production: call Jupiter Ultra API here
    setDone(true);
    setTimeout(onClose, 2000);
  }, [onClose]);

  return (
    <>
      <h3
        className="text-sm mb-4"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "11px",
          color: "#FFD700",
        }}
      >
        TOKEN SWAP
      </h3>

      {done ? (
        <div className="text-center py-8">
          <div className="text-3xl mb-2" style={{ color: "#14F195" }}>
            ✓
          </div>
          <div
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: "10px",
              color: "#14F195",
            }}
          >
            SWAP EXECUTED
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <TokenBox label="From" amount="1.0" token="SOL" />
            <span style={{ color: "#444455", fontSize: "18px" }}>→</span>
            <TokenBox label="To" amount="142.50" token="USDC" />
          </div>
          <p className="text-xs mb-4" style={{ color: "#444455" }}>
            via Jupiter · gasless · slippage 0.5%
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSwap}
              disabled={!connected}
              className="flex-1 py-2.5 rounded-lg text-xs cursor-pointer"
              style={{
                background: connected ? "#14F195" : "#333344",
                color: connected ? "#000" : "#666677",
                border: "none",
                fontFamily: '"Press Start 2P", monospace',
                fontSize: "9px",
              }}
            >
              {connected ? "CONFIRM SWAP" : "CONNECT WALLET FIRST"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-xs cursor-pointer"
              style={{
                background: "transparent",
                border: "1px solid #333344",
                color: "#666677",
              }}
            >
              ESC
            </button>
          </div>
        </>
      )}
    </>
  );
}

function TokenBox({
  label,
  amount,
  token,
}: {
  label: string;
  amount: string;
  token: string;
}) {
  return (
    <div
      className="flex-1 rounded-lg p-3"
      style={{
        background: "#12122a",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div className="text-xs mb-1" style={{ color: "#555566" }}>
        {label}
      </div>
      <div className="flex justify-between items-baseline">
        <span className="text-lg font-bold" style={{ color: "#ffffff" }}>
          {amount}
        </span>
        <span className="text-sm" style={{ color: "#9945FF" }}>
          {token}
        </span>
      </div>
    </div>
  );
}

function TransferPanel({ onClose }: { onClose: () => void }) {
  const { connected } = useWallet();

  return (
    <>
      <h3
        className="text-sm mb-4"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "11px",
          color: "#00D1FF",
        }}
      >
        TRANSFER
      </h3>
      <div
        className="rounded-lg p-3 mb-2"
        style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="text-xs" style={{ color: "#555566" }}>Destination</div>
        <div className="text-sm mt-1" style={{ color: "#ffffff", fontFamily: "monospace" }}>
          8kNr...x9Dq
        </div>
      </div>
      <div
        className="rounded-lg p-3 mb-4"
        style={{ background: "#12122a", border: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="text-xs" style={{ color: "#555566" }}>Amount</div>
        <div className="text-lg font-bold mt-1" style={{ color: "#ffffff" }}>
          0.5 SOL
        </div>
      </div>
      <div className="flex gap-2">
        <button
          disabled={!connected}
          className="flex-1 py-2.5 rounded-lg text-xs cursor-pointer"
          style={{
            background: connected ? "#00D1FF" : "#333344",
            color: connected ? "#000" : "#666677",
            border: "none",
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "9px",
          }}
        >
          {connected ? "SEND" : "CONNECT WALLET FIRST"}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2.5 rounded-lg cursor-pointer"
          style={{ background: "transparent", border: "1px solid #333344", color: "#666677", fontSize: "12px" }}
        >
          ESC
        </button>
      </div>
    </>
  );
}

function BountiesPanel({ onClose }: { onClose: () => void }) {
  const bounties = [
    { title: "Create tutorial video", reward: "500 USDC", tag: "Content" },
    { title: "Build analytics dashboard", reward: "800 USDC", tag: "Dev" },
    { title: "Translate docs to PT-BR", reward: "200 USDC", tag: "Translation" },
  ];

  return (
    <>
      <h3
        className="text-sm mb-4"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "11px",
          color: "#9945FF",
        }}
      >
        BOUNTY BOARD
      </h3>
      {bounties.map((b, i) => (
        <div
          key={i}
          className="flex justify-between items-center rounded-lg p-3 mb-2"
          style={{
            background: "#12122a",
            border: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div>
            <div className="text-sm" style={{ color: "#ccccdd" }}>{b.title}</div>
            <span
              className="text-xs px-2 py-0.5 rounded mt-1 inline-block"
              style={{
                background: "rgba(153,69,255,0.12)",
                color: "#9945FF",
              }}
            >
              {b.tag}
            </span>
          </div>
          <div
            style={{
              fontFamily: '"Press Start 2P", monospace',
              fontSize: "9px",
              color: "#14F195",
            }}
          >
            {b.reward}
          </div>
        </div>
      ))}
      <button
        onClick={onClose}
        className="w-full mt-2 py-2 rounded-lg cursor-pointer"
        style={{
          background: "transparent",
          border: "1px solid #333344",
          color: "#666677",
          fontSize: "12px",
        }}
      >
        Close [ESC]
      </button>
    </>
  );
}

function ExplorePanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      <h3
        className="text-sm mb-3"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "11px",
          color: "#FF6B35",
        }}
      >
        EXPLORER&apos;S GUILD
      </h3>
      <p className="text-sm mb-4" style={{ color: "#888899", lineHeight: 1.6 }}>
        Browse ecosystem services: Marinade, Tensor, Orca, Raydium, and more.
        Complete expeditions to earn the Explorer Badge.
      </p>
      <button
        onClick={onClose}
        className="w-full py-2 rounded-lg cursor-pointer"
        style={{
          background: "transparent",
          border: "1px solid #333344",
          color: "#666677",
          fontSize: "12px",
        }}
      >
        Close [ESC]
      </button>
    </>
  );
}

function PortPanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      <h3
        className="text-sm mb-3"
        style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "11px",
          color: "#4A9EFF",
        }}
      >
        BLOCK PORT
      </h3>
      <p className="text-sm mb-4" style={{ color: "#888899", lineHeight: 1.6 }}>
        Each ship that departs carries a block of transactions.
        Bigger ships carry more transactions. If ships keep sailing,
        the network is healthy and operating.
      </p>
      <button
        onClick={onClose}
        className="w-full py-2 rounded-lg cursor-pointer"
        style={{
          background: "transparent",
          border: "1px solid #333344",
          color: "#666677",
          fontSize: "12px",
        }}
      >
        Close [ESC]
      </button>
    </>
  );
}
