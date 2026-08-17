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
  const { sendTransaction, signTransaction, signMessage } = useWallet() as {
    sendTransaction?: Function;
    signTransaction?: Function;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  };
  const { connection } = useConnection();

  const sendRef = useRef(sendTransaction);
  const signRef = useRef(signTransaction);
  const signMsgRef = useRef(signMessage);
  const connRef = useRef(connection);
  sendRef.current = sendTransaction;
  signRef.current = signTransaction;
  signMsgRef.current = signMessage;
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
            skipPreflight: true,
          });
          bus.emit("wallet:signedTx", sig);
        } catch (err) {
          bus.emit("wallet:signError", err);
        }
      };

      // Sign WITHOUT sending — for transactions that must be submitted to a
      // different cluster than the app connection (e.g. authorize_session on
      // the ephemeral rollup, which needs an ER blockhash and ER endpoint).
      const signOnlyHandler = async (tx: Transaction) => {
        try {
          if (!signRef.current) throw new Error("Wallet cannot sign transactions");
          const signed = await signRef.current(tx);
          bus.emit("wallet:signedTxOnly", signed);
        } catch (err) {
          bus.emit("wallet:signOnlyError", err);
        }
      };

      // Sign an arbitrary MESSAGE (not a transaction) — used to derive a
      // deterministic session key: the same wallet always produces the same
      // ed25519 signature for a fixed message, so the session key is identical
      // on every device/browser and never falls out of sync with the ER.
      const signMessageHandler = async (message: Uint8Array) => {
        try {
          if (!signMsgRef.current) throw new Error("Wallet cannot sign messages");
          const sig = await signMsgRef.current(message);
          bus.emit("wallet:signedMessage", sig);
        } catch (err) {
          bus.emit("wallet:signMessageError", err);
        }
      };

      bus.on("wallet:needSign", handler);
      bus.on("wallet:needSignOnly", signOnlyHandler);
      bus.on("wallet:needSignMessage", signMessageHandler);
      off = () => {
        bus.off("wallet:needSign", handler);
        bus.off("wallet:needSignOnly", signOnlyHandler);
        bus.off("wallet:needSignMessage", signMessageHandler);
      };
      // Signal readiness so CityScene can detect WalletSignBridge is live
      // and skip the fixed 700ms delay on the next wallet connect.
      bus.emit("walletBridge:ready");
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
