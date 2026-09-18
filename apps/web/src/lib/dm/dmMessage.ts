/** The exact string a session key signs for a DM request. Client and server share it. */
export type DmAction = "poll" | "send" | "settings";

export function dmMessage(
  action: DmAction,
  wallet: string,
  ts: number,
  extra: { to?: string; text?: string; off?: boolean } = {},
): string {
  return [
    "solcity-dm", action, wallet, ts,
    extra.to ?? "", extra.off === undefined ? "" : extra.off ? "1" : "0", extra.text ?? "",
  ].join("|");
}
