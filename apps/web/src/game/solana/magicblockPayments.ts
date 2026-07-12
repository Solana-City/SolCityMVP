import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

export const PAYMENTS_API   = "https://payments.magicblock.app";

export const CLUSTERS = {
  mainnet: {
    cluster:      "mainnet",
    ephemeralRpc: "https://tee.magicblock.app",
    solanaRpc:    "https://api.mainnet-beta.solana.com",
    usdcMint:     "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  devnet: {
    cluster:      "devnet",
    ephemeralRpc: "https://devnet.magicblock.app",
    solanaRpc:    "https://api.devnet.solana.com",
    usdcMint:     "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
} as const;

export type ClusterKey = keyof typeof CLUSTERS;

// Keep legacy exports for backwards compat
export const EPHEMERAL_RPC  = CLUSTERS.mainnet.ephemeralRpc;
export const MAINNET_RPC    = CLUSTERS.mainnet.solanaRpc;
export const USDC_MINT      = CLUSTERS.mainnet.usdcMint;
export const USDC_DECIMALS  = 6;

export interface TxData {
  kind: string;
  version: "legacy" | "v0";
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  requiredSigners: string[];
  validator?: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
// Auth challenge lives only on the TEE mainnet endpoint (tee.magicblock.app).
// devnet.magicblock.app is RPC-only; payments API has no /auth/ routes.
// The issued token is cluster-agnostic — cluster is specified per API call.

export async function authenticate(
  pubkey: import("@solana/web3.js").PublicKey,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
  _clusterKey: ClusterKey = "mainnet"
): Promise<{ token: string; expiresAt: number }> {
  const { getAuthToken } = await import("@magicblock-labs/ephemeral-rollups-sdk");
  return getAuthToken(CLUSTERS.mainnet.ephemeralRpc, pubkey, signMessage);
}

// ── Payments REST API helpers ─────────────────────────────────────────────────

async function post(path: string, body: unknown, token?: string): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${PAYMENTS_API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Error ${res.status}`);
  return data;
}

async function get(path: string, params: Record<string, string>, token?: string): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${PAYMENTS_API}${path}?${qs}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Error ${res.status}`);
  return data;
}

// ── Balance ───────────────────────────────────────────────────────────────────

export async function getPrivateBalance(
  address: string,
  token: string,
  clusterKey: ClusterKey = "mainnet"
): Promise<number> {
  const c = CLUSTERS[clusterKey];
  const data = await get("/v1/spl/private-balance", { address, mint: c.usdcMint, cluster: c.cluster }, token);
  return parseInt(data.balance ?? "0", 10) / 10 ** USDC_DECIMALS;
}

// ── Build transactions ────────────────────────────────────────────────────────

export async function buildDeposit(
  owner: string,
  amountUsdc: number,
  clusterKey: ClusterKey = "mainnet"
): Promise<TxData> {
  const c = CLUSTERS[clusterKey];
  return post("/v1/spl/deposit", {
    owner,
    amount: Math.round(amountUsdc * 10 ** USDC_DECIMALS),
    mint: c.usdcMint,
    cluster: c.cluster,
    initIfMissing: true,
    initVaultIfMissing: true,
    initAtasIfMissing: true,
  });
}

export async function buildPrivateTransfer(
  from: string,
  to: string,
  amountUsdc: number,
  token: string,
  clusterKey: ClusterKey = "mainnet"
): Promise<TxData> {
  const c = CLUSTERS[clusterKey];
  return post(
    "/v1/spl/transfer",
    {
      from,
      to,
      mint: c.usdcMint,
      amount: Math.round(amountUsdc * 10 ** USDC_DECIMALS),
      visibility: "private",
      fromBalance: "ephemeral",
      toBalance: "base",
      cluster: c.cluster,
      initAtasIfMissing: true,
      legacy: true,
    },
    token
  );
}

export async function buildWithdraw(
  owner: string,
  amountUsdc: number,
  token: string,
  clusterKey: ClusterKey = "mainnet"
): Promise<TxData> {
  const c = CLUSTERS[clusterKey];
  return post(
    "/v1/spl/withdraw",
    {
      owner,
      amount: Math.round(amountUsdc * 10 ** USDC_DECIMALS),
      mint:    c.usdcMint,
      cluster: c.cluster,
    },
    token
  );
}

// ── Sign & submit ─────────────────────────────────────────────────────────────

export async function signAndSubmit(
  txData: TxData,
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>,
  token: string,
  clusterKey: ClusterKey = "mainnet"
): Promise<string> {
  const c = CLUSTERS[clusterKey];
  const buffer = Buffer.from(txData.transactionBase64, "base64");
  const tx =
    txData.version === "v0"
      ? VersionedTransaction.deserialize(buffer)
      : Transaction.from(buffer);

  const signed = await signTransaction(tx);

  const rpcUrl =
    txData.sendTo === "ephemeral"
      ? `${c.ephemeralRpc}?token=${token}`
      : c.solanaRpc;

  const conn = new Connection(rpcUrl, "confirmed");
  const sig = await conn.sendRawTransaction((signed as Transaction).serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}
