/** The exact string a session key signs to check in. Client and server share it. */
export function checkinMessage(wallet: string, ts: number): string {
  return `solcity-checkin|${wallet}|${ts}`;
}
