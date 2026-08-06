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

// The wallet adapter's ConnectionProvider endpoint. Must be a real devnet RPC:
// api.devnet.solana.com 429-bans for hours, and the Magic Router is a routing
// proxy that times out on sends and lacks simulate. Helius devnet is reliable.
// Free devnet key — client-side and low-risk; override via NEXT_PUBLIC_HELIUS_DEVNET.
const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_HELIUS_DEVNET ||
  "https://devnet.helius-rpc.com/?api-key=92175bf8-4484-4c09-a60a-4d08ee821058";

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
