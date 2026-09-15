/**
 * Devnet test venue for the stock exchange.
 *
 * Tokenized stocks and Jupiter only exist on mainnet, so on devnet each
 * catalog stock has a MOCK SPL mint and trades settle against a test
 * treasury at the live mainnet prices:
 *   buy  = [create mock mint if new] + player pays SOL to treasury
 *          + create player's token account + treasury mints the stock to them
 *   sell = player burns the stock + treasury pays SOL back
 * Each is ONE transaction the treasury pre-signs and the wallet co-signs, the
 * same "get order, sign, submit" flow as Jupiter on mainnet.
 *
 * DEVNET ONLY, WORTHLESS BY DESIGN. The treasury and mint keys derive from
 * public seeds in this file, so anyone can mint these mock tokens. That is
 * fine for a test venue and means there is no secret or setup step: mints
 * are created lazily by the first buyer (who pays the ~0.0015 SOL rent) and
 * the treasury is funded by the SOL buyers pay in.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createBurnInstruction,
  createInitializeMint2Instruction, createMintToInstruction, getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";
import { BASE_RPC_PRIMARY, resilientBaseFetch } from "@/game/solana/baseRpc";
import { STOCKS, SOL_MINT, type StockInfo } from "@/game/solana/stockCatalog";
import type { OrderResponse } from "@/game/solana/jupiterSwap";
import type { Holding, WalletHoldings } from "@/game/solana/stocks";

const seedKeypair = (label: string) => Keypair.fromSeed(sha256(new TextEncoder().encode(label)));

export const DEVNET_TREASURY = seedKeypair("solcity:devnet-stocks:treasury:v1");

const mintCache = new Map<string, Keypair>();
export function devnetMintKeypair(stock: StockInfo): Keypair {
  let kp = mintCache.get(stock.ticker);
  if (!kp) { kp = seedKeypair(`solcity:devnet-stocks:mint:v1:${stock.ticker}`); mintCache.set(stock.ticker, kp); }
  return kp;
}

let connection: Connection | null = null;
export function devnetConnection(): Connection {
  // Same Helius -> api.devnet failover the rest of the game sends through.
  return (connection ??= new Connection(BASE_RPC_PRIMARY, {
    commitment: "confirmed",
    fetch: resilientBaseFetch as unknown as typeof fetch,
  }));
}

/** Rent-exempt minimum for a 0-byte system account (the treasury). */
const SYSTEM_RENT_MIN = 890_880;
/** Player keeps this much for fees + token account rent. */
const FEE_BUFFER_LAMPORTS = 5_000_000;

async function compileSigned(
  payer: PublicKey, ixs: TransactionInstruction[], signers: Keypair[],
): Promise<{ tx: VersionedTransaction; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } = await devnetConnection().getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign(signers); // the wallet adds the player's signature
  return { tx, lastValidBlockHeight };
}

function toOrder(p: {
  tx: VersionedTransaction; lastValidBlockHeight: number; inputMint: string; outputMint: string;
  inAmount: bigint; outAmount: bigint; inUsdValue: number;
}): OrderResponse {
  return {
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    inAmount: p.inAmount.toString(),
    outAmount: p.outAmount.toString(),
    otherAmountThreshold: p.outAmount.toString(),
    swapMode: "ExactIn",
    slippageBps: 0,
    router: "devnet-test",
    inUsdValue: p.inUsdValue,
    transaction: Buffer.from(p.tx.serialize()).toString("base64"),
    requestId: "devnet",
    lastValidBlockHeight: String(p.lastValidBlockHeight),
  };
}

/** Buy `usd` of a mock stock with devnet SOL at the live price. */
export async function devnetBuyOrder(params: {
  stock: StockInfo; usd: number; owner: string; solPrice: number; stockPrice: number;
}): Promise<OrderResponse> {
  const { stock, usd, solPrice, stockPrice } = params;
  if (!(solPrice > 0) || !(stockPrice > 0)) throw new Error("Prices not loaded yet.");
  const owner = new PublicKey(params.owner);
  const conn = devnetConnection();
  const mintKp = devnetMintKeypair(stock);
  const mint = mintKp.publicKey;

  const lamports = BigInt(Math.round((usd / solPrice) * 1e9));
  const raw = BigInt(Math.floor((usd / stockPrice) * 10 ** stock.decimals));
  if (raw <= BigInt(0)) throw new Error("Amount too small.");

  const [mintInfo, balance] = await Promise.all([conn.getAccountInfo(mint), conn.getBalance(owner)]);
  const ixs: TransactionInstruction[] = [];
  const signers = [DEVNET_TREASURY];
  let rent = 0;
  if (!mintInfo) {
    rent = await getMinimumBalanceForRentExemptMint(conn);
    ixs.push(
      SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: mint, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint, stock.decimals, DEVNET_TREASURY.publicKey, null),
    );
    signers.push(mintKp);
  }
  if (balance < Number(lamports) + rent + FEE_BUFFER_LAMPORTS) {
    throw new Error("Not enough devnet SOL. Get some free at faucet.solana.com.");
  }

  const ata = getAssociatedTokenAddressSync(mint, owner);
  ixs.push(
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: DEVNET_TREASURY.publicKey, lamports }),
    createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, mint),
    createMintToInstruction(mint, ata, DEVNET_TREASURY.publicKey, raw),
  );
  const { tx, lastValidBlockHeight } = await compileSigned(owner, ixs, signers);
  return toOrder({ tx, lastValidBlockHeight, inputMint: SOL_MINT, outputMint: stock.mint, inAmount: lamports, outAmount: raw, inUsdValue: usd });
}

/** Sell `raw` units of a mock stock back to the treasury for devnet SOL. */
export async function devnetSellOrder(params: {
  stock: StockInfo; raw: bigint; owner: string; solPrice: number; stockPrice: number;
}): Promise<OrderResponse> {
  const { stock, raw, solPrice, stockPrice } = params;
  if (!(solPrice > 0) || !(stockPrice > 0)) throw new Error("Prices not loaded yet.");
  const owner = new PublicKey(params.owner);
  const mint = devnetMintKeypair(stock).publicKey;

  const usd = (Number(raw) / 10 ** stock.decimals) * stockPrice;
  const lamports = BigInt(Math.floor((usd / solPrice) * 1e9));
  const treasuryBalance = await devnetConnection().getBalance(DEVNET_TREASURY.publicKey);
  if (treasuryBalance - Number(lamports) < SYSTEM_RENT_MIN) {
    throw new Error("The devnet exchange is low on SOL. Try a smaller sell.");
  }

  const ata = getAssociatedTokenAddressSync(mint, owner);
  const ixs = [
    createBurnInstruction(ata, mint, owner, raw),
    SystemProgram.transfer({ fromPubkey: DEVNET_TREASURY.publicKey, toPubkey: owner, lamports }),
  ];
  const { tx, lastValidBlockHeight } = await compileSigned(owner, ixs, [DEVNET_TREASURY]);
  return toOrder({ tx, lastValidBlockHeight, inputMint: stock.mint, outputMint: SOL_MINT, inAmount: raw, outAmount: lamports, inUsdValue: usd });
}

/** Sends a wallet-signed devnet order and waits for confirmation. */
export async function submitDevnetOrder(order: OrderResponse, signed: VersionedTransaction): Promise<string> {
  const conn = devnetConnection();
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  const blockhash = signed.message.recentBlockhash;
  const res = await conn.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight: Number(order.lastValidBlockHeight ?? 0) },
    "confirmed",
  );
  if (res.value.err) throw new Error("Devnet transaction failed.");
  return signature;
}

/** SOL + mock stock balances on devnet, keyed by the catalog (mainnet) mint. */
export async function fetchDevnetHoldings(ownerStr: string): Promise<WalletHoldings> {
  const conn = devnetConnection();
  const owner = new PublicKey(ownerStr);
  const [lamports, accounts] = await Promise.all([
    conn.getBalance(owner),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
  ]);
  const byDevnetMint = new Map(STOCKS.map((s) => [devnetMintKeypair(s).publicKey.toBase58(), s]));
  const stocks: Record<string, Holding> = {};
  for (const { account } of accounts.value) {
    const info = (account.data as any)?.parsed?.info;
    const stock = info && byDevnetMint.get(info.mint);
    if (!stock) continue;
    const raw = BigInt(info.tokenAmount?.amount ?? "0") + (stocks[stock.mint]?.raw ?? BigInt(0));
    if (raw > BigInt(0)) stocks[stock.mint] = { raw, amount: Number(raw) / 10 ** stock.decimals };
  }
  return { sol: lamports / 1e9, usdc: 0, stocks };
}
