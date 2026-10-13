"use client";

/**
 * Where the "? HOW IT WORKS" link of a protocol window goes.
 *
 * Beside the close button, on the title row, wherever the window is wide
 * enough to hold it there (everything but a phone held upright). The gate
 * offers the button through this context; a title bar that takes it says so
 * with `claim`, and the gate then drops the row of its own it would use
 * otherwise.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";

// useLayoutEffect warns on the server; these windows only ever render on the
// client, but the guard keeps that true if one is ever server-rendered.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface HowItWorksSlot {
  /** The button, ready to draw, or null when the window has room for its own row. */
  inlineButton: React.ReactNode;
  /** A title bar calls this while it is mounted and will draw `inlineButton`. */
  claim: (taken: boolean) => void;
}

export const HowItWorksContext = createContext<HowItWorksSlot | null>(null);

/** Takes the replay link into this title bar when the gate offers it. */
export function useHowItWorksSlot(): React.ReactNode {
  const slot = useContext(HowItWorksContext);
  const claim = slot?.claim;
  const offered = Boolean(slot?.inlineButton);
  useIsoLayoutEffect(() => {
    if (!claim || !offered) return;
    claim(true);
    return () => claim(false);
  }, [claim, offered]);
  return slot?.inlineButton ?? null;
}

/** Room on the title row for the link: anything wider than a phone held upright. */
export function useRoomyTitleRow(): boolean {
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 480px)");
    setRoomy(mq.matches);
    const on = (e: MediaQueryListEvent) => setRoomy(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return roomy;
}
