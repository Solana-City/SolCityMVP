"use client";

/**
 * MwaRegistration
 *
 * Registers the Mobile Wallet Adapter into the Wallet Standard so that
 * @solana/wallet-adapter-react picks it up automatically on Android Chrome
 * and Seeker's built-in browser.
 *
 * On Android: the MWA wallet fires an Android Intent to the installed wallet
 * app (Seed Vault, Phantom, Solflare), which establishes a local WebSocket
 * for signing — no browser extension, no QR code required.
 *
 * On non-Android (desktop, iOS): this is a no-op, no wallet is added.
 */

import { useEffect } from "react";

/**
 * The chain the wallet is asked to authorize, from the same env var the rest of
 * the app reads. It must be ONE chain: createDefaultChainSelector picks mainnet
 * whenever mainnet is in the list, so passing both made a devnet game ask for
 * mainnet authorization, and wallets in devnet mode answered with "Sol City is
 * trying to connect to mainnet, disable devnet mode".
 */
const NETWORK = process.env.NEXT_PUBLIC_NETWORK;
const CHAIN: `solana:${string}` =
  NETWORK === "mainnet" || NETWORK === "mainnet-beta" ? "solana:mainnet" : "solana:devnet";

const APP_IDENTITY = {
  name: "The Solana City",
  uri:
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "https://solana.city"),
  icon: "/icons/icon-192.png",
};

export default function MwaRegistration() {
  useEffect(() => {
    // Only register on Android — MWA uses Android Intents and won't work elsewhere
    const isAndroid = /android/i.test(navigator.userAgent);
    if (!isAndroid) return;

    let cancelled = false;

    import("@solana-mobile/wallet-standard-mobile")
      .then(
        ({
          registerMwa,
          createDefaultAuthorizationCache,
          createDefaultChainSelector,
          createDefaultWalletNotFoundHandler,
        }) => {
          if (cancelled) return;
          registerMwa({
            appIdentity: APP_IDENTITY,
            authorizationCache: createDefaultAuthorizationCache(),
            chains: [CHAIN],
            chainSelector: createDefaultChainSelector(),
            onWalletNotFound: createDefaultWalletNotFoundHandler(),
          });
        }
      )
      .catch((err) => {
        console.warn("[MWA] Registration failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
