"use client";

import { useEffect, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

import { BASE_RPC_PRIMARY, resilientBaseFetch } from "@/game/solana/baseRpc";

// The wallet adapter's ConnectionProvider. Uses the same failover fetch as the
// game (Helius devnet + api.devnet) — never the Magic Router, which hangs on
// sends. See baseRpc.ts. Signing itself needs no RPC, so this mainly backs
// balance reads and the adapter's own housekeeping.
const RPC_ENDPOINT = BASE_RPC_PRIMARY;
const RPC_CONFIG = {
  commitment: "confirmed" as const,
  fetch: resilientBaseFetch as unknown as typeof fetch,
};

// Solana-native wallets allowed to auto-connect.
// Includes MWA names used by Android/Seeker mobile wallets.
const SOLANA_WALLET_NAMES = [
  "Phantom", "Solflare", "Backpack",
  "Seeker", "Mobile Wallet Adapter", "MWA", "Seed Vault",
];

// Auto-connect function — returns true only for known Solana wallets.
// EVM wallets that self-register via Wallet Standard are excluded so they
// cannot crash the app during auto-connect.
// Must return Promise<boolean> to match the WalletProvider prop type.
const autoConnectFilter = (adapter: { name: string }): Promise<boolean> =>
  Promise.resolve(
    SOLANA_WALLET_NAMES.some(name =>
      adapter.name.toLowerCase().includes(name.toLowerCase())
    )
  );

export default function SolanaProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const endpoint = useMemo(() => RPC_ENDPOINT, []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  // Clear any non-Solana wallet stored in localStorage so it is never
  // auto-connected on the next page load.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("walletName");
      if (stored && !SOLANA_WALLET_NAMES.some(n => stored.includes(n))) {
        localStorage.removeItem("walletName");
      }
    } catch { /* ignore */ }
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint} config={RPC_CONFIG}>
      <WalletProvider
        wallets={wallets}
        autoConnect={autoConnectFilter}
        onError={(error) => {
          // Suppress all wallet adapter errors — connection failures, network
          // mismatches, and EVM extension interference are handled gracefully
          // via the in-game chat and offline mode fallback.
          console.warn("[WalletProvider] suppressed:", error.name, error.message);
        }}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
