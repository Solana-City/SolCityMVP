"use client";

import { useEffect, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import type { Transaction } from "@solana/web3.js";

/**
 * Headless bridge between the Phaser game layer and the wallet adapter.
 *
 * OnChainMultiplayer emits `wallet:needSign` with the Transaction to sign.
 * This component catches it, sends it via the connected wallet, and replies
 * with `wallet:signedTx` (signature string) or `wallet:signError` (Error).
 *
 * Refs keep the handler stable so we only register the bus listener once —
 * prevents duplicate-signing if the wallet adapter re-renders.
 * Renders nothing — pure side-effect.
 */
export default function WalletSignBridge() {
  const { sendTransaction } = useWallet() as { sendTransaction?: Function };
  const { connection } = useConnection();

  const sendRef = useRef(sendTransaction);
  const connRef = useRef(connection);
  sendRef.current = sendTransaction;
  connRef.current = connection;

  useEffect(() => {
    let off: (() => void) | null = null;

    const attach = (): boolean => {
      const bus = (globalThis as any).__solCityGameEvents as
        | { on: Function; off: Function; emit: Function } | undefined;
      if (!bus) return false;

      const handler = async (tx: Transaction) => {
        try {
          if (!sendRef.current) throw new Error("Wallet not connected");
          const sig = await sendRef.current(tx, connRef.current, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
          bus.emit("wallet:signedTx", sig);
        } catch (err) {
          bus.emit("wallet:signError", err);
        }
      };

      bus.on("wallet:needSign", handler);
      off = () => bus.off("wallet:needSign", handler);
      return true;
    };

    if (!attach()) {
      const poll = setInterval(() => { if (attach()) clearInterval(poll); }, 300);
      return () => { clearInterval(poll); off?.(); };
    }
    return () => off?.();
  }, []);

  return null;
}
