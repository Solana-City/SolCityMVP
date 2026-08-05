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

// The wallet adapter's ConnectionProvider is what WalletSignBridge hands to
// `sendTransaction`, so every wallet-signed base-layer tx (init / authorize /
// delegate) is broadcast through THIS endpoint. It must be the Magic Router,
// not api.devnet.solana.com: the public devnet RPC rate-bans (429) under load,
// which made the delegate send hang until the 60s "wallet sign timeout". The
// router is healthy and forwards base-layer txs to devnet transparently.
const RPC_ENDPOINT = "https://devnet-router.magicblock.app";

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
    <ConnectionProvider endpoint={endpoint}>
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
