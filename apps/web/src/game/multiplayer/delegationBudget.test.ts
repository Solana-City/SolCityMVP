import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  COMMITS_BEFORE_UNDELEGATE, leaveAction, readCommits, recordCommit, resetCommits,
} from "./delegationBudget";

/**
 * Leaving keeps the delegation (no fee, no signature next time) until the
 * commit allowance runs out. These pin that rule and the per-wallet count.
 */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

describe("leaving the rollup", () => {
  it("commits and stays delegated while the allowance lasts", () => {
    for (let n = 0; n < COMMITS_BEFORE_UNDELEGATE; n++) {
      expect(leaveAction(n, false)).toBe("commit");
    }
  });

  it("ends the delegation once the allowance is spent", () => {
    expect(leaveAction(COMMITS_BEFORE_UNDELEGATE, false)).toBe("undelegate");
  });

  it("stays under MagicBlock's ten commits per delegation", () => {
    // Ten are allowed; one of them may come from another device.
    expect(COMMITS_BEFORE_UNDELEGATE).toBeLessThan(10);
  });

  it("ends the delegation whenever the caller asks, whatever the count", () => {
    expect(leaveAction(0, true)).toBe("undelegate");
  });
});

describe("the commit count", () => {
  it("is kept per wallet", () => {
    recordCommit("A");
    recordCommit("A");
    recordCommit("B");
    expect(readCommits("A")).toBe(2);
    expect(readCommits("B")).toBe(1);
  });

  it("starts over with a new delegation", () => {
    recordCommit("A");
    resetCommits("A");
    expect(readCommits("A")).toBe(0);
  });

  it("reads as zero when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(readCommits("A")).toBe(0);
    expect(() => recordCommit("A")).not.toThrow();
  });
});
