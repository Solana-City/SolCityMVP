import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelLeave, confirmLeave, getLeaveStake, getPendingLeave,
  requestLeave, resetLeaveGuard, setLeaveStake,
} from "./leaveGuard";

/**
 * The guard decides whether a keypress closes a game or asks a question, so
 * the case that must never regress is the boring one: with nothing at stake,
 * leaving is immediate. A dialog in front of a menu would be worse than the
 * accident it is meant to prevent.
 */
describe("leave guard", () => {
  beforeEach(() => resetLeaveGuard());

  it("lets the player straight out when nothing is at stake", () => {
    const close = vi.fn();
    requestLeave(close);
    expect(close).toHaveBeenCalledTimes(1);
    expect(getPendingLeave()).toBeNull();
  });

  it("asks first while a round is running", () => {
    const close = vi.fn();
    setLeaveStake({ message: "You lose this battle." });
    requestLeave(close);
    expect(close).not.toHaveBeenCalled();
    expect(getPendingLeave()).not.toBeNull();
  });

  it("leaves on yes, and forgets the stake", () => {
    const close = vi.fn();
    setLeaveStake({ message: "You lose this battle." });
    requestLeave(close);
    confirmLeave();
    expect(close).toHaveBeenCalledTimes(1);
    expect(getLeaveStake()).toBeNull();
    expect(getPendingLeave()).toBeNull();
  });

  it("stays on no, with the round still at stake", () => {
    const close = vi.fn();
    setLeaveStake({ message: "You lose this battle." });
    requestLeave(close);
    cancelLeave();
    expect(close).not.toHaveBeenCalled();
    expect(getPendingLeave()).toBeNull();
    expect(getLeaveStake()).not.toBeNull();
  });

  it("releases a waiting player when the round ends under the question", () => {
    // The last mech falls while the dialog is open: there is nothing left to
    // lose, so the answer the player already gave stands.
    const close = vi.fn();
    setLeaveStake({ message: "You lose this battle." });
    requestLeave(close);
    setLeaveStake(null);
    expect(close).toHaveBeenCalledTimes(1);
    expect(getPendingLeave()).toBeNull();
  });

  it("does not strand a stake from one game in the next", () => {
    setLeaveStake({ message: "You lose this battle." });
    resetLeaveGuard();
    const close = vi.fn();
    requestLeave(close);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
