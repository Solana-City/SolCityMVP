import type { PublicKey } from "@solana/web3.js";

export interface MiniGameBaseContext {
  wallet: PublicKey | null;
}

/**
 * Food Cart runs with no money involved: no escrow accounts, no order
 * payment, no refunds. Only the round's deadline is passed in.
 */
export interface FoodCartContext extends MiniGameBaseContext {
  orderType: "sushi";
  /** Unix timestamp */
  expiresAt: number;
}

export type MiniGameContext = MiniGameBaseContext | FoodCartContext;

export interface MiniGameResult {
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface MiniGameManifest {
  id: string;
  displayName: string;
}

export interface MiniGameComponentProps<C extends MiniGameBaseContext = MiniGameBaseContext> {
  context: C;
  /** Called when the game ends (success or failure). Await on-chain settlement here. */
  onResult: (result: MiniGameResult) => Promise<void>;
  /** Called for explicit user dismissal (e.g. Escape). */
  onClose: () => void;
}
