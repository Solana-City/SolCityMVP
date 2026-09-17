import { describe, expect, it } from "vitest";
import { commitHash, decodeTeam, encodeTeam, matchSeed, sameBytes, ACTION_BYTES, TEAM_BYTES } from "./protocol";
import { PRESET_BUILDS } from "../data/catalog";
import { TEAM_SIZE, type TeamBuild } from "../data/team";

/**
 * The wire format the program stores. Both clients and the Rust program read
 * these bytes, so a change to the encoding is a change to the protocol: an old
 * client and a new one would disagree about which mech is which.
 */

const team: TeamBuild = {
  mechs: [PRESET_BUILDS.titan, PRESET_BUILDS.striker, PRESET_BUILDS.arclight],
};

describe("encodeTeam", () => {
  it("fits the fixed team field the program declares", () => {
    expect(encodeTeam(team)).toHaveLength(TEAM_BYTES);
    expect(TEAM_BYTES).toBe(TEAM_SIZE * 4);
  });

  it("round-trips through decode", () => {
    const decoded = decodeTeam(encodeTeam(team));
    expect(decoded.mechs.map((m) => m.matrixCode)).toEqual(team.mechs.map((m) => m.matrixCode));
    expect(decoded.mechs.map((m) => m.rightArm)).toEqual(team.mechs.map((m) => m.rightArm));
    expect(decoded.mechs.map((m) => m.leftArm)).toEqual(team.mechs.map((m) => m.leftArm));
    expect(decoded.mechs.map((m) => m.lowerBody)).toEqual(team.mechs.map((m) => m.lowerBody));
  });

  it("encodes the part NUMBER, not its place in the catalog", () => {
    // "M01" is index 0 whatever order the catalog happens to be in, which is
    // what lets the catalog grow without breaking a stored team.
    const bytes = encodeTeam({ mechs: [PRESET_BUILDS.titan, PRESET_BUILDS.titan, PRESET_BUILDS.titan] });
    const matrixNumber = Number(PRESET_BUILDS.titan.matrixCode.replace(/\D/g, ""));
    expect(bytes[0]).toBe(matrixNumber - 1);
  });

  it("refuses a team that is not exactly the squad size", () => {
    expect(() => encodeTeam({ mechs: [PRESET_BUILDS.titan] })).toThrow();
  });
});

describe("decodeTeam", () => {
  it("rejects a part number the catalog does not know", () => {
    const bytes = encodeTeam(team);
    bytes[0] = 250; // no such matrix
    expect(() => decodeTeam(bytes)).toThrow();
  });

  it("rejects data that is too short to be a team", () => {
    expect(() => decodeTeam(new Uint8Array(4))).toThrow();
  });
});

describe("commitHash", () => {
  const action = new Uint8Array(ACTION_BYTES).fill(3);
  const salt = new Uint8Array(32).fill(7);

  it("is stable for the same inputs", () => {
    expect(sameBytes(commitHash(1n, 0, action, salt), commitHash(1n, 0, action, salt))).toBe(true);
  });

  it("changes with the match, the step, the action and the salt", () => {
    const base = commitHash(1n, 0, action, salt);
    expect(sameBytes(base, commitHash(2n, 0, action, salt))).toBe(false);
    expect(sameBytes(base, commitHash(1n, 1, action, salt))).toBe(false);
    expect(sameBytes(base, commitHash(1n, 0, new Uint8Array(ACTION_BYTES).fill(4), salt))).toBe(false);
    expect(sameBytes(base, commitHash(1n, 0, action, new Uint8Array(32).fill(8)))).toBe(false);
  });

  it("is the 32 bytes the program compares against", () => {
    expect(commitHash(1n, 0, action, salt)).toHaveLength(32);
  });
});

describe("matchSeed", () => {
  it("gives both clients the same tie-breaker for a match", () => {
    expect(matchSeed(42n)).toBe(matchSeed(42n));
    expect(matchSeed(42n)).not.toBe(matchSeed(43n));
  });
});
