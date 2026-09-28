"use client";

import { useEffect, useState } from "react";
import { activeBuffs, formatBuffTime, onBuffsChanged, type ActiveBuff } from "@/game/buffs/playerBuffs";

/**
 * The timed-buff chips beside the HUD card: the buff's own framed icon with
 * the time it has left under it. Nothing is drawn while no buff is up, so the
 * HUD is unchanged for a player who has not picked one up.
 */

/** 1.5x the icon's own 32px, matching the badge over the player's head. */
const ICON_SIZE = 48;
/** How often the label is redrawn while a buff runs. */
const TICK_MS = 250;

export default function BuffBar() {
  const [buffs, setBuffs] = useState<ActiveBuff[]>([]);

  useEffect(() => {
    let tick: number | null = null;

    const read = () => {
      const next = activeBuffs();
      setBuffs(next);
      // The ticker only exists while there is a number counting down.
      if (next.length > 0 && tick === null) {
        tick = window.setInterval(read, TICK_MS);
      } else if (next.length === 0 && tick !== null) {
        window.clearInterval(tick);
        tick = null;
      }
    };

    read();
    const off = onBuffsChanged(read);
    return () => {
      off();
      if (tick !== null) window.clearInterval(tick);
    };
  }, []);

  if (buffs.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
      {buffs.map((buff) => (
        <div
          key={buff.def.id}
          title={buff.def.label}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
        >
          <img
            src={buff.def.iconUrl}
            alt={buff.def.label}
            width={ICON_SIZE}
            height={ICON_SIZE}
            style={{ display: "block", imageRendering: "pixelated" }}
          />
          {/* Fixed width so the chip does not twitch as "3m" becomes "60s". */}
          <span style={{
            fontFamily: '"Press Start 2P", monospace', fontSize: 9, lineHeight: 1,
            color: "#f3e6c8", width: ICON_SIZE, textAlign: "center",
            textShadow: "0 1px 0 #0a0a1e, 1px 0 0 #0a0a1e, -1px 0 0 #0a0a1e, 0 -1px 0 #0a0a1e",
          }}>
            {formatBuffTime(buff.remainingMs)}
          </span>
        </div>
      ))}
    </div>
  );
}
