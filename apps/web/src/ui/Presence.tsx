"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** How long a closing window stays mounted so its exit can play. Longer than the exit in globals.css. */
const EXIT_MS = 140;

/**
 * Keeps a window on screen for the length of its exit. `show` going false would
 * unmount it at once; this holds it for EXIT_MS first, in a `closed` state
 * where globals.css plays the exit on any `.sc-fade` (backdrop) or `.sc-pop`
 * (window) inside, and the window stops taking taps. While `show` is true it
 * is `open`, and the same classes play the enter.
 *
 * The wrapper is `display: contents`, so it adds no box of its own. While
 * closing it is `inert`: nothing inside can be tapped, focused or typed into,
 * so a second Enter or tap cannot fire the window's action twice.
 */
export default function Presence({ show, children }: { show: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) { setMounted(true); return; }
    const id = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(id);
  }, [show]);

  if (!show && !mounted) return null;
  return (
    <div
      className="sc-presence" data-state={show ? "open" : "closed"} style={{ display: "contents" }}
      // React 18 does not know `inert`; an empty string is what puts the attribute on.
      {...(show ? {} : ({ inert: "" } as Record<string, unknown>))}
    >
      {children}
    </div>
  );
}

/**
 * The last value that was not null. For a window driven by a prop that goes
 * null to close it (an NPC, an action): the exit still has something to draw.
 */
export function useLast<T>(value: T | null): T | null {
  const last = useRef(value);
  if (value !== null) last.current = value;
  return last.current;
}
