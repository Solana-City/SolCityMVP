"use client";

/**
 * Content toggles, read once per page load from /api/flags.
 *
 * The defaults are what the game does when the store is unreachable, so a
 * flag outage never takes a feature down by accident — it only ever leaves
 * things as they normally are. One fetch is shared by every caller.
 */
import { useEffect, useState } from "react";

export type Flags = Record<string, boolean>;

/** Mirrors FLAGS in lib/flags.ts. Keep the two in step. */
export const FLAG_DEFAULTS: Flags = {
  pvp: true,
  duels: true,
  ranked: false,
  nicknames: true,
  chat: true,
};

let cache: Flags = { ...FLAG_DEFAULTS };
let inFlight: Promise<Flags> | null = null;
const listeners = new Set<(f: Flags) => void>();

function fetchFlags(): Promise<Flags> {
  if (inFlight) return inFlight;
  inFlight = fetch("/api/flags")
    .then((r) => r.json())
    .then((body) => {
      cache = { ...FLAG_DEFAULTS, ...(body.flags ?? {}) };
      for (const cb of listeners) cb(cache);
      return cache;
    })
    .catch(() => cache)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Synchronous read, for code outside React. */
export function flagsSnapshot(): Flags {
  return cache;
}

export function useFlags(): Flags {
  const [flags, setFlags] = useState<Flags>(cache);
  useEffect(() => {
    listeners.add(setFlags);
    void fetchFlags();
    return () => { listeners.delete(setFlags); };
  }, []);
  return flags;
}
