"use client";

import { useEffect } from "react";

/**
 * Asking before a mini-game is closed mid-round.
 *
 * Escape and the X are one keystroke and one click away from a battle the
 * player is winning, and both used to take effect immediately. Playtesters hit
 * them by accident — Escape especially, because it closes everything else in
 * the city — and lost the round with no way back.
 *
 * So a game DECLARES what a player stands to lose while a round is running
 * (`useLeaveStake`), and every exit goes through `requestLeave`. With nothing
 * at stake the exit happens on the spot, exactly as before: menus, the hangar,
 * the result screen and the whole of a game that has no round in progress
 * never see a dialog.
 *
 * The state lives in a module rather than React context because the asking is
 * done by the overlay that hosts the game while the stake is known deep inside
 * it, and the exits are scattered (each game's own Escape handler, each X, and
 * Sol Mechs' own "back to the menu" from inside a battle). One small store is
 * less machinery than threading a callback through all of them.
 */

export interface LeaveStake {
  /** One line: what is lost by leaving now. Shown under the question. */
  message: string;
}

let stake: LeaveStake | null = null;
let pending: (() => void) | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function subscribeLeaveGuard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What the player would lose right now, or null when leaving is free. */
export function getLeaveStake(): LeaveStake | null {
  return stake;
}

/** The exit waiting on an answer, or null when nothing was asked. */
export function getPendingLeave(): (() => void) | null {
  return pending;
}

export function setLeaveStake(next: LeaveStake | null): void {
  if (stake === next) return;
  stake = next;
  // A round that ends while the question is on screen answers it: there is
  // nothing left to lose, so the player is let out.
  if (!stake && pending) {
    const go = pending;
    pending = null;
    notify();
    go();
    return;
  }
  notify();
}

/**
 * Leave, or ask first.
 *
 * Every exit from a mini-game goes through here. `action` is what leaving
 * means for that particular exit: closing the overlay, or going back to the
 * Sol Mechs menu from inside a battle, which costs the player just as much.
 */
export function requestLeave(action: () => void): void {
  if (!stake) {
    action();
    return;
  }
  pending = action;
  notify();
}

/** The player said yes. The round is over either way, so the stake clears. */
export function confirmLeave(): void {
  const go = pending;
  pending = null;
  stake = null;
  notify();
  go?.();
}

/** The player said no: back to the game, still at stake. */
export function cancelLeave(): void {
  if (!pending) return;
  pending = null;
  notify();
}

/** Drops everything — the overlay calls it when a game unmounts, so a stake
 *  can never outlive the round that set it. */
export function resetLeaveGuard(): void {
  stake = null;
  pending = null;
  notify();
}

/**
 * Declares, from inside a game, what closing would cost right now. Pass null
 * whenever the round is not running.
 */
export function useLeaveStake(message: string | null): void {
  useEffect(() => {
    setLeaveStake(message ? { message } : null);
  }, [message]);
  useEffect(() => () => setLeaveStake(null), []);
}
