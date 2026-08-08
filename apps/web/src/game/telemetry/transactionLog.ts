/**
 * TransactionLog — observable singleton that captures every transaction
 * the client emits (position updates, swaps, transfers, bounty records,
 * delegate/undelegate) and makes them available to any UI surface.
 *
 * Design goals:
 *   1. Decoupled. Solana modules (jupiterSwap, transfer, OnChainMultiplayer)
 *      push entries; the UI subscribes. Neither knows about the other.
 *   2. Bounded memory. Ring buffer capped at MAX_ENTRIES, oldest evicted.
 *   3. Movement-aware. Position updates arrive at 10/s. Rather than logging
 *      each individually, we coalesce consecutive move entries into a single
 *      "batch" entry that tallies count + span, and is live-updated via
 *      subscriber events. The UI stays legible, but the full activity is
 *      still represented.
 *   4. Source-of-truth for status transitions. An entry starts "pending",
 *      transitions to "confirmed" (with signature) or "failed" (with error).
 */

export type TxKind =
  | "move"       // update_position on ephemeral rollup
  | "swap"       // Jupiter swap
  | "transfer"   // SOL / SPL transfer
  | "bounty"     // record_bounty (legacy — Superteam bounties can't be tracked from the game wallet)
  | "init"       // initialize_player
  | "delegate"   // PDA delegation to ER
  | "commit"     // periodic ER → base layer commit (informational)
  | "undelegate" // session end
  | "outfit"     // update_look_session (wardrobe)
  | "expression" // set_expression_session
  | "chat"       // send_chat_session
  | "hunt"       // Find Someone: claim_find + the finder's +1
  | "minigame"   // record_mini_game_session
  | "system";    // non-tx internal event (e.g. "session started")

export type TxLayer = "base" | "ephemeral" | "jupiter" | "local";

export type TxStatus = "pending" | "confirmed" | "failed";

export interface TxEntry {
  id: string;              // client-side unique
  kind: TxKind;
  layer: TxLayer;
  status: TxStatus;
  label: string;           // human summary ("Swap 0.1 SOL → USDC")
  signature?: string;      // set once confirmed
  error?: string;          // set on failure
  createdAt: number;       // ms epoch
  updatedAt: number;
  // Move-batch specific: coalesces N consecutive move txs into one entry.
  batchCount?: number;
  batchSpanMs?: number;
}

type Listener = (entries: ReadonlyArray<TxEntry>) => void;

const MAX_ENTRIES = 200;
// If a move arrives within this window of the previous move entry,
// fold it into that batch instead of creating a new entry.
const MOVE_COALESCE_WINDOW_MS = 1500;

class TransactionLogService {
  private entries: TxEntry[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;

  // Reference to the current in-progress move batch (if any).
  // Kept separate from `entries` only for fast-path access; it's still
  // the same object stored in `entries`.
  private currentMoveBatch: TxEntry | null = null;

  /**
   * Records a move transaction. These arrive at up to 10 Hz during
   * active gameplay, so we coalesce into a batch entry.
   *
   * Returns the batch entry so callers can attach a signature later.
   */
  recordMove(params: { signature?: string; status?: TxStatus; layer?: TxLayer }): TxEntry {
    const now = Date.now();
    const signature = params.signature;
    const status = params.status ?? "confirmed";
    const layer = params.layer ?? "ephemeral";

    if (
      this.currentMoveBatch &&
      now - this.currentMoveBatch.updatedAt < MOVE_COALESCE_WINDOW_MS
    ) {
      const batch = this.currentMoveBatch;
      batch.batchCount = (batch.batchCount ?? 1) + 1;
      batch.batchSpanMs = now - batch.createdAt;
      batch.updatedAt = now;
      // Only keep the latest signature as a sample, for linking to explorer.
      if (signature) batch.signature = signature;
      // Layer follows the latest sample so the explorer link queries the
      // cluster that latest signature actually landed on.
      batch.layer = layer;
      batch.label = this.formatMoveBatchLabel(batch);
      batch.status = status;
      this.notify();
      return batch;
    }

    const entry: TxEntry = {
      id: this.mintId(),
      kind: "move",
      layer,
      status,
      label: "Position update",
      signature,
      createdAt: now,
      updatedAt: now,
      batchCount: 1,
      batchSpanMs: 0,
    };
    entry.label = this.formatMoveBatchLabel(entry);
    this.currentMoveBatch = entry;
    this.push(entry);
    return entry;
  }

  /**
   * Records a discrete, non-batched transaction. Returns the entry so the
   * caller can later call `markConfirmed` / `markFailed` with the signature.
   */
  record(params: {
    kind: Exclude<TxKind, "move">;
    layer: TxLayer;
    label: string;
    status?: TxStatus;
    signature?: string;
  }): TxEntry {
    const now = Date.now();
    const entry: TxEntry = {
      id: this.mintId(),
      kind: params.kind,
      layer: params.layer,
      label: params.label,
      status: params.status ?? "pending",
      signature: params.signature,
      createdAt: now,
      updatedAt: now,
    };
    // Any non-move entry closes the active move batch so the next move
    // starts fresh (keeps the timeline readable).
    this.currentMoveBatch = null;
    this.push(entry);
    return entry;
  }

  /**
   * Attaches a signature without changing status — used right after
   * sendRawTransaction with skipPreflight, where we hold a real signature
   * but don't yet know whether the instruction executed.
   */
  attachSignature(id: string, signature: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.signature = signature;
    entry.updatedAt = Date.now();
    this.notify();
  }

  markConfirmed(id: string, signature: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.status = "confirmed";
    entry.signature = signature;
    entry.updatedAt = Date.now();
    this.notify();
  }

  markFailed(id: string, error: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.status = "failed";
    entry.error = error;
    entry.updatedAt = Date.now();
    this.notify();
  }

  getAll(): ReadonlyArray<TxEntry> {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.currentMoveBatch = null;
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Immediate emission so subscribers render current state.
    listener(this.entries);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── internal ─────────────────────────────────────────────────────────

  private push(entry: TxEntry): void {
    // Newest first. Ring buffer: drop oldest when over capacity.
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.length = MAX_ENTRIES;
    }
    this.notify();
  }

  private notify(): void {
    // Freeze a snapshot so subscribers can't mutate internal state.
    const snapshot = this.entries.slice();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[TransactionLog] listener error:", err);
      }
    }
  }

  private mintId(): string {
    return `tx-${Date.now().toString(36)}-${(this.nextId++).toString(36)}`;
  }

  private formatMoveBatchLabel(entry: TxEntry): string {
    const count = entry.batchCount ?? 1;
    if (count <= 1) return "Position update";
    const span = entry.batchSpanMs ?? 0;
    if (span < 1000) return `${count} moves`;
    return `${count} moves in ${(span / 1000).toFixed(1)}s`;
  }
}

// Singleton. One log per client session.
export const transactionLog = new TransactionLogService();

/**
 * Explorer URL builder. The ephemeral rollup sequencer has its own explorer;
 * everything else lives on the Solana devnet. We expose a single helper so
 * the UI doesn't have to know which base to pick per layer.
 */
export function getExplorerUrl(entry: TxEntry): string | null {
  if (!entry.signature) return null;
  // sim: prefixed signatures are local-only; router-returned move sigs are
  // router IDs (not Solana base58 tx hashes) so they won't resolve on explorers.
  if (entry.signature.startsWith("sim:")) return null;
  switch (entry.layer) {
    case "ephemeral":
      // The ephemeral rollup is a standard SVM node, so Solana Explorer can
      // query it directly as a custom cluster — no dependency on MagicBlock's
      // own explorer indexing. Caveat: the rollup only retains recent
      // history, so links naturally expire once the ER session is committed
      // and pruned.
      return `https://explorer.solana.com/tx/${entry.signature}?cluster=custom&customUrl=${encodeURIComponent("https://devnet.magicblock.app")}`;
    case "base":
      return `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet`;
    case "jupiter":
      return `https://solscan.io/tx/${entry.signature}`;
    case "local":
    default:
      return null;
  }
}
