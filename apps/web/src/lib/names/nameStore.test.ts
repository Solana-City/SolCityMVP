import { describe, expect, it } from "vitest";
import { claim, lock, namesFor, unlock, validate, NAME_MAX, NAME_MIN } from "./nameStore";

/**
 * Nickname rules. The store falls back to process memory outside production,
 * so these run against the real code path with no Redis.
 *
 * Each test claims its own names: the memory store is shared across a file.
 */

const WALLET_A = "9592QS34mPUwqA7sPAkug1kcuFddjn59QPQMzzCgKhEp";
const WALLET_B = "3DTbrwYvQhKbFCPrTZ5DcRYPkCSxTyLJEHxFPkfZnPJS";

describe("validate", () => {
  it("accepts an ordinary name", async () => {
    expect(await validate("Mazza")).toBeNull();
  });

  it("enforces the length bounds", async () => {
    expect(await validate("ab")).toBe("length");
    expect(await validate("a".repeat(NAME_MAX + 1))).toBe("length");
    expect(await validate("a".repeat(NAME_MIN))).toBeNull();
  });

  it("requires a letter first and allows only letters, digits and underscore", async () => {
    expect(await validate("1player")).toBe("chars");
    expect(await validate("has space")).toBe("chars");
    expect(await validate("emoji😀name")).toBe("chars");
    expect(await validate("Player_1")).toBeNull();
  });

  it("blocks offensive names, including leetspeak", async () => {
    expect(await validate("fuckyou")).toBe("offensive");
    expect(await validate("Sh1tLord")).toBe("offensive");
    expect(await validate("c4ralho")).toBe("offensive");
  });

  it("does not block ordinary words that merely contain a banned substring", async () => {
    // The banned list is chosen so real names survive it.
    expect(await validate("Analyst")).toBeNull();
    expect(await validate("Computador")).toBeNull();
  });

  it("reserves staff-sounding names", async () => {
    expect(await validate("admin")).toBe("reserved");
    expect(await validate("SolanaCity")).toBe("reserved");
  });
});

describe("claim", () => {
  it("stores the name as typed and answers lookups by wallet", async () => {
    expect(await claim(WALLET_A, "CityMayor")).toBeNull();
    expect(await namesFor([WALLET_A])).toEqual({ [WALLET_A]: "CityMayor" });
  });

  it("refuses a name another wallet already holds, whatever the case", async () => {
    await claim(WALLET_A, "TakenName");
    expect(await claim(WALLET_B, "takenname")).toBe("taken");
  });

  it("lets a wallet rename, and frees the old name for someone else", async () => {
    await claim(WALLET_A, "FirstName");
    expect(await claim(WALLET_A, "SecondName")).toBeNull();
    expect(await namesFor([WALLET_A])).toEqual({ [WALLET_A]: "SecondName" });
    expect(await claim(WALLET_B, "FirstName")).toBeNull();
  });

  it("is idempotent for the wallet that already owns the name", async () => {
    await claim(WALLET_A, "SameName");
    expect(await claim(WALLET_A, "SameName")).toBeNull();
  });
});

describe("lock", () => {
  it("takes the name away, keeps it unavailable and stops the wallet renaming", async () => {
    await claim(WALLET_A, "BadName");
    await lock({ name: "BadName" }, "offensive");

    expect(await namesFor([WALLET_A])).toEqual({});
    expect(await validate("BadName", WALLET_B)).toBe("locked");
    expect(await validate("AnythingElse", WALLET_A)).toBe("wallet-locked");
  });

  it("unlock lets both the name and the wallet go again", async () => {
    await claim(WALLET_B, "OopsName");
    await lock({ name: "OopsName" }, "mistake");
    await unlock({ name: "OopsName", wallet: WALLET_B });

    expect(await validate("OopsName", WALLET_B)).toBeNull();
  });
});
