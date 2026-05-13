import type { ComponentType } from "react";
import type { MiniGameManifest, MiniGameContext, MiniGameComponentProps } from "./types";

export interface MiniGameEntry {
  manifest: MiniGameManifest;
  loader: () => Promise<{ default: ComponentType<MiniGameComponentProps<any>> }>;
}

const _registry = new Map<string, MiniGameEntry>();

export function registerMiniGame(
  manifest: MiniGameManifest,
  loader: () => Promise<{ default: ComponentType<MiniGameComponentProps<any>> }>
): void {
  _registry.set(manifest.id, { manifest, loader });
}

export function getEntry(id: string): MiniGameEntry | undefined {
  return _registry.get(id);
}

/**
 * Trigger a mini-game from game code (CityScene, NPC handlers, etc.).
 * Emits "minigame:launch" on the shared game events bus; page.tsx
 * listens and mounts the overlay, CityScene pauses automatically.
 *
 * Example:
 *   import { launch } from "@/game/minigames";
 *   launch("food-cart", { wallet, cartPda, orderPda, orderType: "burger", expiresAt, amountLamports });
 */
export function launch(id: string, context: MiniGameContext): void {
  const events = (globalThis as any).__solCityGameEvents as
    | { emit: (event: string, data?: unknown) => void }
    | undefined;
  if (!events) {
    console.warn("[MiniGameRegistry] game events bus not ready — is CityScene running?");
    return;
  }
  events.emit("minigame:launch", { id, context });
}
