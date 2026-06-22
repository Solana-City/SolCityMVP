/**
 * Decoupling boundary for opponents (Section 6 of the build brief): the
 * engine never talks to AI logic or network code directly, only to this
 * interface. `LocalAIOpponentProvider` is the only implementation for this
 * MVP; a future `MagicBlockOpponentProvider` backed by real players over
 * Ephemeral Rollups can implement the same shape without touching
 * KiteClashEngine or the React wrapper.
 */
export interface OpponentKiteState {
  id: string;
  position: { x: number; y: number };
  lineLength: number;
  /** 0–1, derived from lineLength / maxLineLength. */
  exposure: number;
  skinColor: string;
  /** True for the brief window after a respawn/relaunch, before it's a valid cut target. */
  alive: boolean;
}

export type CutOutcome = "success" | "neutral" | "backfire";

export interface CutAttemptResult {
  outcome: CutOutcome;
  /** Only meaningful when outcome === "success". */
  scoreBonus: number;
}

export interface OpponentKiteProvider {
  /** Advance this tick's simulation (movement, exposure changes, respawns). */
  update(dtSeconds: number): void;
  getActiveOpponents(): OpponentKiteState[];
  /** Resolve a cut attempt the player makes against one opponent. */
  attemptCut(opponentId: string, attackerExposure: number): CutAttemptResult;
  /** Resolve a cut attempt an opponent makes against the player (called by the engine each tick). */
  rollOpponentAttacksOnPlayer(playerExposure: number): CutOutcome | null;
}

export type WindTier = "LOW" | "MEDIUM" | "HIGH";
export type WindDirection = "left" | "right";

export interface WindState {
  tier: WindTier;
  direction: WindDirection;
}
