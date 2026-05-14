"use client";

/**
 * useSeekerDevice
 *
 * React hook that exposes:
 *   isAndroid   — soft UA detection (instant)
 *   hasSGT      — hard on-chain SGT check (async, mainnet)
 *   sgtLoading  — true while the on-chain check is running
 *
 * Usage:
 *   const { isAndroid, hasSGT, sgtLoading } = useSeekerDevice(publicKey);
 */

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { isAndroidChrome, hasSeekerGenesisToken } from "@/game/solana/seekerDetection";

export function useSeekerDevice() {
  const { publicKey } = useWallet();
  const [isAndroid, setIsAndroid] = useState(false);
  const [hasSGT, setHasSGT] = useState(false);
  const [sgtLoading, setSgtLoading] = useState(false);

  // Soft detection — runs once on mount
  useEffect(() => {
    setIsAndroid(isAndroidChrome());
  }, []);

  // Hard detection — runs when wallet connects
  useEffect(() => {
    if (!publicKey) {
      setHasSGT(false);
      return;
    }
    let cancelled = false;
    setSgtLoading(true);
    hasSeekerGenesisToken(publicKey.toBase58())
      .then((result) => {
        if (!cancelled) setHasSGT(result);
      })
      .finally(() => {
        if (!cancelled) setSgtLoading(false);
      });
    return () => { cancelled = true; };
  }, [publicKey]);

  return { isAndroid, hasSGT, sgtLoading };
}
