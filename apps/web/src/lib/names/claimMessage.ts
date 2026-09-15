/** The exact text a wallet signs to claim a nickname; the server rebuilds it to verify. */
export function claimMessage(wallet: string, name: string, ts: number): string {
  return `Solana City nickname\nName: ${name}\nWallet: ${wallet}\nTime: ${ts}`;
}
