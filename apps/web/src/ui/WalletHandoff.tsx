"use client";

import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

/**
 * The one place that tells the rest of the app which wallet is logged in.
 *
 * This used to be a side job of WalletBar, the little address + balance row in
 * the HUD. On desktop that row is always on screen, so it worked. On a phone
 * the same row lives behind the arrow next to the map icon and is unmounted
 * until the player opens it — so the wallet never reached Phaser, the on-chain
 * session never started, and the connect screen sat on "ENTERING THE CITY"
 * until its escape hatch let the player in with no session at all.
 *
 * So the handoff is headless and mounted unconditionally: what the HUD happens
 * to be showing can no longer decide whether the player gets a session.
 *
 * Keyed off `publicKey`, not `connected`: the key is the thing the game needs,
 * and it is what every other wallet reader in the app already uses.
 */
export default function WalletHandoff({ onWallet }: { onWallet: (wallet: string | null) => void }) {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;

  useEffect(() => {
    onWallet(address);
  }, [address, onWallet]);

  return null;
}
