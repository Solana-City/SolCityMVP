"use client";

/**
 * Sol Mechs — the connected wallet's roster, resolved from chain.
 *
 * Starts in the trial set rather than the full roster: showing everything and
 * then taking mechs away when the read lands would be worse than showing the
 * floor and adding to it.
 */
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { resolveOwnership, TRIAL_MECHS, type Ownership } from "@/game/solmechs/ownership";
import { isPassConfigured } from "@/game/solmechs/pass/config";
import { MECH_IDS } from "@/game/solmechs/data/types";

const INITIAL: Ownership = isPassConfigured()
  ? { mechs: [...TRIAL_MECHS], hasPass: false, source: "trial" }
  : { mechs: [...MECH_IDS], hasPass: true, source: "dev" };

export interface OwnershipState extends Ownership {
  loading: boolean;
}

export function useOwnership(): OwnershipState {
  const { publicKey } = useWallet();
  const [state, setState] = useState<OwnershipState>({ ...INITIAL, loading: isPassConfigured() });

  useEffect(() => {
    if (!isPassConfigured()) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    void resolveOwnership(publicKey ? publicKey.toBase58() : null).then((o) => {
      if (!cancelled) setState({ ...o, loading: false });
    });
    return () => { cancelled = true; };
  }, [publicKey]);

  return state;
}
