import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

export const PAYMENTS_API   = "https://payments.magicblock.app";
export const EPHEMERAL_RPC  = "https://tee.magicblock.app";
export const MAINNET_RPC    = "https://api.mainnet-beta.solana.com";
export const USDC_MINT      = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
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

// ── Auth via SDK (challenge-sign-login handled internally) ────────────────────

export async function authenticate(
  pubkey: import("@solana/web3.js").PublicKey,
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>
): Promise<{ token: string; expiresAt: number }> {
  const { getAuthToken } = await import("@magicblock-labs/ephemeral-rollups-sdk");
  // SDK calls ${EPHEMERAL_RPC}/auth/challenge and /auth/login internally
  return getAuthToken(EPHEMERAL_RPC, pubkey, signMessage);
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
  const qs = new URLSearchParams({ ...params, cluster: "mainnet" }).toString();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${PAYMENTS_API}${path}?${qs}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `Error ${res.status}`);
  return data;
}

// ── Balance ───────────────────────────────────────────────────────────────────

export async function getPrivateBalance(address: string, token: string): Promise<number> {
  const data = await get("/v1/spl/private-balance", { address, mint: USDC_MINT }, token);
  return parseInt(data.balance ?? "0", 10) / 10 ** USDC_DECIMALS;
}

// ── Build transactions ────────────────────────────────────────────────────────

export async function buildDeposit(owner: string, amountUsdc: number): Promise<TxData> {
  return post("/v1/spl/deposit", {
    owner,
    amount: Math.round(amountUsdc * 10 ** USDC_DECIMALS),
    mint: USDC_MINT,
    cluster: "mainnet",
    initIfMissing: true,
    initVaultIfMissing: true,
    initAtasIfMissing: true,
  });
}

export async function buildPrivateTransfer(
  from: string,
  to: string,
  amountUsdc: number,
  token: string
): Promise<TxData> {
  return post(
    "/v1/spl/transfer",
    {
      from,
      to,
      mint: USDC_MINT,
      amount: Math.round(amountUsdc * 10 ** USDC_DECIMALS),
      visibility: "private",
      fromBalance: "ephemeral",
      toBalance: "base",
      cluster: "mainnet",
      initAtasIfMissing: true,
      legacy: true,
    },
    token
  );
}

// ── Sign & submit ─────────────────────────────────────────────────────────────

export async function signAndSubmit(
  txData: TxData,
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>,
  token: string
): Promise<string> {
  const buffer = Buffer.from(txData.transactionBase64, "base64");
  const tx =
    txData.version === "v0"
      ? VersionedTransaction.deserialize(buffer)
      : Transaction.from(buffer);

  const signed = await signTransaction(tx);

  const rpcUrl =
    txData.sendTo === "ephemeral"
      ? `${EPHEMERAL_RPC}?token=${token}`
      : MAINNET_RPC;

  const conn = new Connection(rpcUrl, "confirmed");
  const sig = await conn.sendRawTransaction((signed as Transaction).serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}
