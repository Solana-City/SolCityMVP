"use client";

/**
 * Nicknames for React screens.
 *
 * The scene resolves names through `nameService` for the tags above heads;
 * this is the same cache for the UI, so a wallet is looked up once and every
 * list, card and banner agrees. Requests are batched by the service, so
 * passing a whole leaderboard's worth of wallets costs one call.
 *
 * `display` is what to show: the nickname when there is one, and a short
 * address otherwise, never a raw 44-character key.
 */
import { useEffect, useMemo, useState } from "react";
import { cachedName, onNames, requestNames } from "@/game/names/nameService";

export function shortWallet(wallet: string): string {
  if (!wallet) return "";
  if (wallet === "guest") return "A visitor";
  return wallet.length > 10 ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}` : wallet;
}

/** Resolves many wallets at once. Re-renders as names arrive. */
export function useNicknames(wallets: readonly string[]): {
  names: Record<string, string>;
  display: (wallet: string, fallback?: string) => string;
} {
  const key = wallets.join(",");
  const [, bump] = useState(0);

  useEffect(() => {
    const list = key ? key.split(",").filter((w) => w && w !== "guest") : [];
    if (list.length === 0) return;
    requestNames(list);
    return onNames((found) => {
      // Only re-render when one of OUR wallets resolved.
      if (list.some((w) => found[w])) bump((n) => n + 1);
    });
  }, [key]);

  return useMemo(() => {
    const names: Record<string, string> = {};
    for (const w of key ? key.split(",") : []) {
      const name = cachedName(w);
      if (name) names[w] = name;
    }
    return {
      names,
      display: (wallet: string, fallback?: string) =>
        names[wallet] ?? cachedName(wallet) ?? fallback ?? shortWallet(wallet),
    };
    // `key` changing or a resolve bumping is what makes this recompute.
  }, [key]);
}

/** One wallet. */
export function useNickname(wallet: string | null | undefined): string | null {
  const list = useMemo(() => (wallet ? [wallet] : []), [wallet]);
  const { names } = useNicknames(list);
  return wallet ? names[wallet] ?? null : null;
}
