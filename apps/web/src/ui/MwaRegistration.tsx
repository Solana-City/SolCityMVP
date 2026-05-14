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
            chains: ["solana:mainnet", "solana:devnet"],
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
