// What can be asserted about sol-city on devnet TODAY.
//
// Read this before adding to it: the deployed sol-city predates the current
// source. The redeploy that carries `player_v3`, wardrobe enforcement and the
// `address =` constraints on the delegation CPI is prepared and deliberately
// held (see the BLOCKER at the top of REDEPLOY_CHECKLIST.md). So the tests here
// are limited to claims that hold for the deployed build AND will still hold
// afterwards. The constraint tests that mirror `cpiTargets.test.ts` land with
// the redeploy, not before, because asserting them now would only prove the
// obvious: they are not deployed yet.

import { describe, expect, it } from "vitest";
import { Connection, SystemProgram } from "@solana/web3.js";
import {
  ANCHOR_ERROR,
  FEE_PAYER,
  RPC_URL,
  SOL_CITY,
  SOL_MECHS,
  discriminator,
  simulate,
} from "./helpers";

const TIMEOUT = 30_000;

describe("the programs are live", () => {
  it.each([
    { name: "sol-city", id: SOL_CITY },
    { name: "sol-mechs", id: SOL_MECHS },
  ])(
    "$name is deployed and executable",
    async ({ id }) => {
      const info = await new Connection(RPC_URL, "confirmed").getAccountInfo(id);
      expect(info).not.toBeNull();
      expect(info!.executable).toBe(true);
    },
    TIMEOUT,
  );
});

describe("claim_free_outfit is not callable", () => {
  // It granted any index in the quest block to whoever called it, because the
  // condition was checked in the client. It was pulled before it ever shipped,
  // so the chain has never exposed it and the redeploy does not add it. This
  // test is the standing proof of that, and it is meant to keep passing.
  it(
    "answers InstructionFallbackNotFound for its discriminator",
    async () => {
      const { anchor } = await simulate({
        programId: SOL_CITY,
        keys: [
          { pubkey: FEE_PAYER, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        // The instruction took a u16 index; the two trailing bytes stand in for it.
        data: Buffer.concat([discriminator("claim_free_outfit"), Buffer.from([0, 0])]),
      });
      expect(anchor).not.toBeNull();
      expect(anchor!.number).toBe(ANCHOR_ERROR.InstructionFallbackNotFound);
    },
    TIMEOUT,
  );
});
