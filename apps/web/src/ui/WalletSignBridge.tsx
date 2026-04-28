"use client";

import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Transaction } from "@solana/web3.js";

/**
 * Headless bridge between the Phaser game layer and the wallet adapter.
 *
 * The multiplayer manager (OnChainMultiplayer) lives inside Phaser and has
 * no access to React hooks. When it needs the user's wallet to sign a
 * transaction (e.g. initialize_player), it emits `wallet:needSign` on the
 * global game event bus. This component catches that event, signs using the
 * wallet adapter, and replies with `wallet:signedTx` (signature) or
 * `wallet:signError` (error).
 *
 * Renders nothing — pure side-effect.
 */
export default function WalletSignBridge() {
  const { signTransaction, sendTransaction, connection } = useWallet() as any;

  useEffect(() => {
    const interval = setInterval(() => {
      const bus = (globalThis as any).__solCityGameEvents as
        | { on: Function; once: Function; off: Function } | undefined;
      if (!bus) return;
      clearInterval(interval);

      const handler = async (tx: Transaction) => {
        try {
          if (!sendTransaction) throw new Error("No wallet connected");
          // Use sendTransaction so the wallet handles blockhash + fee payer
          // We need a connection — pull from the global bus context
          const { Connection, clusterApiUrl } = await import("@solana/web3.js");
          const conn = new Connection(clusterApiUrl("devnet"), "confirmed");
          const sig = await sendTransaction(tx, conn);
          (bus as any).emit("wallet:signedTx", sig);
        } catch (err) {
          (bus as any).emit("wallet:signError", err);
        }
      };

      bus.on("wallet:needSign", handler);
      return () => { bus.off("wallet:needSign", handler); };
    }, 300);

    return () => clearInterval(interval);
  }, [sendTransaction]);

  return null;
}
