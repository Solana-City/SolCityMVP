/**
 * The exact strings a session key signs for the quest and event writes.
 * Client and server share them, so the two can never drift apart.
 */

export type QuestAction = "increment" | "claim";

/** `target` and `points` are signed as the client sent them, "" when absent. */
export function questMessage(
  action: QuestAction,
  wallet: string,
  questId: string,
  ts: number,
  extra: { target?: unknown; points?: unknown } = {},
): string {
  return [
    "solcity-quest", action, wallet, questId, ts, String(extra.target ?? ""), String(extra.points ?? ""),
  ].join("|");
}

/** `payload` is the JSON text of the events array, byte for byte what is sent. */
export function eventsMessage(wallet: string, ts: number, payload: string): string {
  return ["solcity-events", wallet, ts, payload].join("|");
}
