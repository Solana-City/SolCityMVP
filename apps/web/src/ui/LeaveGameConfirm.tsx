"use client";

/**
 * "Leave the round?" — the one question between an accidental Escape and a
 * lost battle.
 *
 * It only ever appears while a game has declared something at stake (see
 * game/minigames/leaveGuard), so a player closing a menu, the hangar or a
 * finished match still leaves in one press.
 *
 * Keeping playing is the safe answer, so it is the one on the right, in the
 * city's green, and the one Escape gives: the key that opened this dialog by
 * accident cannot also confirm it.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  cancelLeave, confirmLeave, getLeaveStake, getPendingLeave, subscribeLeaveGuard,
} from "@/game/minigames/leaveGuard";
import { chamferBox } from "@/ui/chamfer";

const PIX = '"Press Start 2P", monospace';

export default function LeaveGameConfirm() {
  const asking = useSyncExternalStore(
    subscribeLeaveGuard,
    () => getPendingLeave() !== null,
    () => false,
  );
  const stake = useSyncExternalStore(subscribeLeaveGuard, getLeaveStake, () => null);

  // Every game listens for Escape on the window to close itself. While this
  // dialog is up, Escape belongs to the dialog: caught on the way DOWN and
  // stopped there, so the game underneath never sees the press and cannot
  // re-ask the question it just answered.
  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelLeave();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [asking]);

  if (!asking) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        // Over every game's own backdrop: Sol Mechs sits at 1000, the kite at
        // 100, the food cart at 50.
        position: "fixed", inset: 0, zIndex: 2000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, background: "rgba(4,6,16,0.72)",
      }}
    >
      <div style={chamferBox(10, {
        width: "min(340px, 100%)",
        padding: "18px 18px 16px",
        background: "rgba(10,12,24,0.98)",
        border: "1px solid rgba(139,139,167,0.35)",
        fontFamily: PIX, color: "#d0d0f0",
        boxShadow: "0 12px 44px rgba(0,0,0,0.6)",
      })}>
        <div style={{ fontSize: 9, color: "#fff", lineHeight: 1.6 }}>
          LEAVE NOW?
        </div>
        <div style={{ fontSize: 7, color: "#8b8ba7", lineHeight: 1.9, margin: "10px 0 16px" }}>
          {stake?.message}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={confirmLeave}
            style={chamferBox(8, {
              flex: 1, fontFamily: PIX, fontSize: 7, padding: "11px 8px",
              background: "transparent", border: "1px solid rgba(139,139,167,0.4)",
              color: "#8b8ba7", cursor: "pointer",
            })}
          >
            LEAVE
          </button>
          <button
            onClick={cancelLeave}
            autoFocus
            style={chamferBox(8, {
              flex: 1, fontFamily: PIX, fontSize: 7, padding: "11px 8px",
              background: "#B7E928", border: "none", color: "#04140c", cursor: "pointer",
            })}
          >
            KEEP PLAYING
          </button>
        </div>
      </div>
    </div>
  );
}
