"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

const NETWORK = "devnet";

// Wallet names that are safe to auto-connect to (Solana native only).
// MetaMask and other EVM wallets may register via Wallet Standard and crash
// when the Solana app tries to auto-connect to them.
const ALLOWED_AUTO_CONNECT = ["Phantom", "Solflare", "Backpack"];

export default function SolanaProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const endpoint = useMemo(() => clusterApiUrl(NETWORK), []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  // Custom autoConnect: only reconnect to known-safe Solana wallets.
  // Prevents MetaMask (EVM, auto-detected via Wallet Standard) from crashing
  // the game when it fails to connect to a Solana app.
  const autoConnect = (adapter: { name: string }) =>
    ALLOWED_AUTO_CONNECT.some(name =>
      adapter.name.toLowerCase().includes(name.toLowerCase())
    );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect={autoConnect}
        onError={(error) => {
          // Swallow all wallet adapter errors so they never reach ErrorBoundary.
          console.warn("[WalletProvider] suppressed:", error.name, error.message);
        }}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
