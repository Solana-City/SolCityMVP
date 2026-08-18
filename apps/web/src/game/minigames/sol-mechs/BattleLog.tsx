"use client";

/**
 * Sol Mechs — turn-by-turn combat record.
 *
 * Framed as a record rather than a scrolling console, because that is what it
 * is meant to become: every line corresponds to an entry in the battle's
 * action history — the same list an on-chain verifier replays to confirm a
 * result. Showing the action count beside the text makes that connection
 * legible now, before the log is committed anywhere.
 *
 * See ONCHAIN.md: the per-action record already travels in the result
 * metadata; what is missing is the program that would attest to it.
 *
 * Lives in its own module rather than beside the 1v1 screen so the 3v3 screen
 * can use it without the two importing each other.
 */

import { useState } from "react";
import { C, T, SP, MONO, eyebrow } from "./theme";

/**
 * The Unity log panel as a 9-slice.
 *
 * `BattleSceneSprites/BattleLog.png` — the sprite the battle scene's Scroll
 * View actually uses, not `arena/log.png`, which an earlier pass reached for
 * because the filename looked right. The slice is 30px so the decorative
 * corner brackets fall inside the corner tiles rather than being stretched
 * along the edges; `fill` keeps the dark interior.
 */
const LOG_FRAME: React.CSSProperties = {
  borderStyle: "solid",
  borderWidth: 12,
  borderImage: "url(/assets/minigames/sol-mechs/ui/log-frame.png) 30 fill / 12px / 0 stretch",
};

export interface BattleLogProps {
  /** Newest first. */
  lines: string[];
  /** Actions resolved so far — the length of the replayable history. */
  turns: number;
  /** Start collapsed — useful on short screens. */
  initiallyCollapsed?: boolean;
}

export function BattleLog({ lines, turns, initiallyCollapsed = false }: BattleLogProps) {
  const [open, setOpen] = useState(!initiallyCollapsed);

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "none", border: "none", padding: "2px 0", cursor: "pointer",
          ...eyebrow, marginBottom: SP.xs, fontFamily: "inherit",
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        <span>COMBAT LOG</span>
        <span style={{ flex: 1, height: 1, background: C.line }} />
        <span>{turns} {turns === 1 ? "ACTION" : "ACTIONS"}</span>
      </button>

      {open ? (
        <div style={{
          ...LOG_FRAME,
          height: 132, overflowY: "auto", padding: SP.sm,
          fontSize: T.small, fontFamily: MONO,
          color: C.body, lineHeight: 1.8,
        }}>
          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                // Newest line reads brightest and older ones recede, so the eye
                // lands on what just happened without re-reading the whole panel.
                color: i === 0 ? C.text : i < 4 ? C.body : C.faint,
                whiteSpace: "pre-wrap",
              }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : (
        // Collapsed still shows the latest line: the record is the point, and
        // hiding it entirely would mean losing track of what just happened.
        <div style={{
          ...LOG_FRAME,
          padding: "6px 8px", fontSize: T.small, fontFamily: MONO,
          color: C.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {lines[0] ?? "—"}
        </div>
      )}
    </div>
  );
}

export default BattleLog;
