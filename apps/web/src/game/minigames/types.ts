import type { PublicKey } from "@solana/web3.js";

export interface MiniGameBaseContext {
  wallet: PublicKey | null;
}

export interface FoodCartContext extends MiniGameBaseContext {
  /** null until real on-chain order accounts are wired in */
  cartPda: PublicKey | null;
  /** null until real on-chain order accounts are wired in */
  orderPda: PublicKey | null;
  orderType: "burger" | "sushi";
  /** Unix timestamp */
  expiresAt: number;
  amountLamports: number;
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
