"use client";

import { useEffect, useState } from "react";
import { getNetwork, REGION_EVENT, type RegionState } from "@/game/multiplayer/OnChainMultiplayer";

const EMPTY: RegionState = { current: null, advice: null, switching: false };

/**
 * Which region's rollup this account lives on, kept current from REGION_EVENT.
 * Shared by the Settings picker and the "faster region" hint.
 */
export function useRegion(): RegionState {
  const [state, setState] = useState<RegionState>(EMPTY);
  useEffect(() => {
    setState(getNetwork()?.regionState() ?? EMPTY);
    const on = (e: Event) => setState((e as CustomEvent<RegionState>).detail);
    window.addEventListener(REGION_EVENT, on);
    return () => window.removeEventListener(REGION_EVENT, on);
  }, []);
  return state;
}
