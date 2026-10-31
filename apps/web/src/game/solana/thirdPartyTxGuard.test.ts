import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT,
  createApproveInstruction, createApproveCheckedInstruction, createSetAuthorityInstruction,
  createCloseAccountInstruction, createTransferInstruction, AuthorityType,
} from "@solana/spl-token";
import { staticViolations, balanceViolations } from "./thirdPartyTxGuard";

/**
 * The guard on transactions other people build (audit R-12), pinned on the
 * cases the audit named: an order with an extra Approve, one with a
 * SetAuthority, one that drains more than it quoted. And the honest shapes
 * that must keep passing, because a guard that blocks a real swap gets
 * switched off.
 */
const owner = Keypair.generate().publicKey;
const thief = Keypair.generate().publicKey;
const account = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const usdc = Keypair.generate().publicKey.toBase58();

describe("instructions no honest integration needs", () => {
  it("refuses an Approve of the player's tokens", () => {
    expect(staticViolations([createApproveInstruction(account, thief, owner, BigInt(1))], owner)).toHaveLength(1);
    expect(staticViolations([createApproveCheckedInstruction(account, mint, thief, owner, BigInt(1), 6)], owner)).toHaveLength(1);
  });

  it("refuses handing authority over one of the player's accounts", () => {
    const ix = createSetAuthorityInstruction(account, owner, AuthorityType.AccountOwner, thief);
    expect(staticViolations([ix], owner)).toHaveLength(1);
  });

  it("refuses closing the player's account into someone else's, in Token-2022 too", () => {
    expect(staticViolations([createCloseAccountInstruction(account, thief, owner)], owner)).toHaveLength(1);
    expect(staticViolations([createCloseAccountInstruction(account, thief, owner, [], TOKEN_2022_PROGRAM_ID)], owner)).toHaveLength(1);
  });

  it("refuses reassigning the player's wallet", () => {
    const ix = SystemProgram.assign({ accountPubkey: owner, programId: thief });
    expect(staticViolations([ix], owner)).toHaveLength(1);
  });

  it("passes the honest shapes: a transfer, closing into the player, a SOL transfer", () => {
    expect(staticViolations([
      createTransferInstruction(account, Keypair.generate().publicKey, owner, BigInt(5)),
      createCloseAccountInstruction(account, owner, owner),
      SystemProgram.transfer({ fromPubkey: owner, toPubkey: account, lamports: 10 }),
    ], owner)).toEqual([]);
  });

  it("does not care what others approve: only the player's own authority counts", () => {
    const someoneElse = Keypair.generate().publicKey;
    expect(staticViolations([createApproveInstruction(account, thief, someoneElse, BigInt(1))], owner)).toEqual([]);
    expect(TOKEN_PROGRAM_ID instanceof PublicKey).toBe(true);
  });
});

describe("what the player would lose", () => {
  const losses = (pairs: [string, number][]) => new Map(pairs.map(([k, v]) => [k, BigInt(v)]));

  it("passes a swap that spends what it quoted, plus fees", () => {
    expect(balanceViolations(losses([[usdc, 1_000_000], ["SOL", 5_000]]), [{ mint: usdc, amount: BigInt(1_000_000) }])).toEqual([]);
  });

  it("passes slippage inside the 1% margin and refuses past it", () => {
    const spend = [{ mint: usdc, amount: BigInt(1_000_000) }];
    expect(balanceViolations(losses([[usdc, 1_009_000]]), spend)).toEqual([]);
    expect(balanceViolations(losses([[usdc, 1_020_000]]), spend)).toHaveLength(1);
  });

  it("refuses losing a token the player never agreed to spend", () => {
    expect(balanceViolations(losses([[mint.toBase58(), 1]]), [{ mint: usdc, amount: BigInt(10) }])).toHaveLength(1);
  });

  it("counts a native-mint spend as SOL", () => {
    const spend = [{ mint: NATIVE_MINT.toBase58(), amount: BigInt(1_000_000_000) }];
    expect(balanceViolations(losses([["SOL", 1_000_000_000]]), spend)).toEqual([]);
    expect(balanceViolations(losses([["SOL", 1_200_000_000]]), spend)).toHaveLength(1);
  });

  it("allows fees and new-account rent in SOL, and no more", () => {
    expect(balanceViolations(losses([["SOL", 15_000_000]]), [])).toEqual([]);
    expect(balanceViolations(losses([["SOL", 500_000_000]]), [])).toHaveLength(1);
  });

  it("never judges a gain", () => {
    expect(balanceViolations(losses([[usdc, -5_000_000], ["SOL", -1]]), [])).toEqual([]);
  });
});
