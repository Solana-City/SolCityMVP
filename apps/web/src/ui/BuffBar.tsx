"use client";

import { useEffect, useState } from "react";
import { activeBuffs, formatBuffTime, onBuffsChanged, type ActiveBuff } from "@/game/buffs/playerBuffs";

/**
 * The timed-buff chips under the HUD card: one small framed square per buff,
 * carrying its icon and the time it has left. Nothing is drawn while no buff
 * is up, so the HUD is unchanged for a player who has not picked one up.
 */

/** The thin nested ring the rest of the HUD rows use. */
const BUFF_FRAME = "url(/assets/branding/ui/frame-map-test.png) 18 fill / 8px / 0 round";

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
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
      {buffs.map((buff) => (
        <div
          key={buff.def.id}
          title={buff.def.label}
          style={{
            borderWidth: 8, borderStyle: "solid", borderColor: "transparent",
            borderImage: BUFF_FRAME,
            imageRendering: "pixelated",
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <img
            src={buff.def.iconUrl}
            alt=""
            width={16}
            height={16}
            style={{ display: "block", imageRendering: "pixelated" }}
          />
          {/* Fixed width so the chip does not twitch as "3m" becomes "60s". */}
          <span style={{
            fontFamily: '"Press Start 2P", monospace', fontSize: 9, lineHeight: 1,
            color: "#f3e6c8", width: 30, textAlign: "center",
          }}>
            {formatBuffTime(buff.remainingMs)}
          </span>
        </div>
      ))}
    </div>
  );
}
