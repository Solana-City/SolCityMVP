"use client";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useState, useEffect, useCallback } from "react";

interface WalletBarProps {
  onWalletChange?: (wallet: string | null) => void;
}

export default function WalletBar({ onWalletChange }: WalletBarProps) {
  const { publicKey, connected, disconnect } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [balance, setBalance] = useState<number | null>(null);

  const address = publicKey?.toBase58() ?? null;
  const shortAddr = address
    ? `${address.slice(0, 4)}...${address.slice(-4)}`
    : null;

  useEffect(() => {
    onWalletChange?.(address);
  }, [address, onWalletChange]);

  useEffect(() => {
    if (!publicKey || !connection) {
      setBalance(null);
      return;
    }

    let cancelled = false;
    connection.getBalance(publicKey).then((lamports) => {
      if (!cancelled) {
        setBalance(Math.round((lamports / LAMPORTS_PER_SOL) * 100) / 100);
      }
    });

    return () => { cancelled = true; };
  }, [publicKey, connection]);

  const handleClick = useCallback(() => {
    if (connected) {
      disconnect();
    } else {
      setVisible(true);
    }
  }, [connected, disconnect, setVisible]);

  return (
    <div
      className="fixed top-4 right-4 z-20 flex items-center gap-3"
      style={{ fontFamily: '"Fira Code", monospace' }}
    >
      {connected && shortAddr && (
        <>
          {balance !== null && (
            <span
              className="text-xs px-2 py-1 rounded"
              style={{
                background: "rgba(10,10,30,0.88)",
                color: "#14F195",
                border: "1px solid rgba(20,241,149,0.2)",
              }}
            >
              {balance} SOL
            </span>
          )}
          <span
            className="text-xs px-2 py-1 rounded"
            style={{
              background: "rgba(10,10,30,0.88)",
              color: "#00D1FF",
              border: "1px solid rgba(0,209,255,0.2)",
            }}
          >
            {shortAddr}
          </span>
        </>
      )}
      <button
        onClick={handleClick}
        className="text-xs px-4 py-2 rounded cursor-pointer transition-colors"
        style={{
          background: connected
            ? "rgba(20,241,149,0.12)"
            : "rgba(153,69,255,0.8)",
          color: connected ? "#14F195" : "#ffffff",
          border: connected
            ? "1px solid rgba(20,241,149,0.3)"
            : "1px solid rgba(153,69,255,0.5)",
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "9px",
        }}
      >
        {connected ? "CONNECTED" : "CONNECT WALLET"}
      </button>
    </div>
  );
}
