// The delegation CPI must not be steerable by the caller.
//
// `delegate_duelist` and `delegate_lobby` take the program they CPI into as
// accounts. Until 2026-10-15 both were bare `UncheckedAccount`s with no
// constraint, which is the shape a mainnet-readiness review stops on. They now
// carry `address =`, and these tests prove it on the deployed bytecode rather
// than on the source.
//
// Each case ends before any account data is read, so none of these needs the
// duelist or lobby account to exist.

import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ANCHOR_ERROR,
  DELEGATION_PROGRAM,
  FEE_PAYER,
  SOL_MECHS,
  delegationKeys,
  discriminator,
  duelistPda,
  lobbyPda,
  simulate,
} from "./helpers";

const TIMEOUT = 30_000;

/** Any valid program that is not the one the instruction expects. */
const WRONG_PROGRAM = SystemProgram.programId;

function delegateIx(
  name: "delegate_duelist" | "delegate_lobby",
  pda: PublicKey,
  ownerProgram: PublicKey,
  delegationProgram: PublicKey,
) {
  return {
    programId: SOL_MECHS,
    keys: delegationKeys({ payer: FEE_PAYER, pda, ownerProgram, delegationProgram }),
    data: discriminator(name),
  };
}

describe.each([
  { name: "delegate_duelist" as const, pda: duelistPda(FEE_PAYER) },
  { name: "delegate_lobby" as const, pda: lobbyPda() },
])("$name pins its CPI targets", ({ name, pda }) => {
  it(
    "rejects an owner_program that is not this program",
    async () => {
      const { anchor } = await simulate(
        delegateIx(name, pda, WRONG_PROGRAM, DELEGATION_PROGRAM),
      );
      expect(anchor).not.toBeNull();
      expect(anchor!.account).toBe("owner_program");
      expect(anchor!.number).toBe(ANCHOR_ERROR.ConstraintAddress);
    },
    TIMEOUT,
  );

  it(
    "rejects a delegation_program that is not MagicBlock's",
    async () => {
      const { anchor } = await simulate(delegateIx(name, pda, SOL_MECHS, WRONG_PROGRAM));
      expect(anchor).not.toBeNull();
      expect(anchor!.account).toBe("delegation_program");
      expect(anchor!.number).toBe(ANCHOR_ERROR.ConstraintAddress);
    },
    TIMEOUT,
  );

  it(
    "gets past the account constraints when both are correct",
    async () => {
      // It still fails: simulation cannot carry out the real delegation, which
      // reassigns the PDA mid-CPI. What matters is that the failure is no
      // longer an address constraint, so the accounts themselves were accepted.
      const { anchor } = await simulate(
        delegateIx(name, pda, SOL_MECHS, DELEGATION_PROGRAM),
      );
      expect(anchor?.number).not.toBe(ANCHOR_ERROR.ConstraintAddress);
    },
    TIMEOUT,
  );
});

describe("seed derivation is enforced", () => {
  it(
    "rejects a duelist PDA that is not derived from the signer",
    async () => {
      // A real PDA of this program, but seeded for somebody else.
      const someoneElse = new PublicKey("11111111111111111111111111111112");
      const { anchor } = await simulate(
        delegateIx("delegate_duelist", duelistPda(someoneElse), SOL_MECHS, DELEGATION_PROGRAM),
      );
      expect(anchor).not.toBeNull();
      expect(anchor!.account).toBe("duelist");
      expect(anchor!.number).toBe(ANCHOR_ERROR.ConstraintSeeds);
    },
    TIMEOUT,
  );
});
