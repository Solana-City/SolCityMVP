"use client";

import { useEffect, useState } from "react";
import { profileManager, type PlayerProfile } from "@/game/config/profileManager";
import { progressionBus } from "@/game/progression/progressionBus";

/**
 * Top-left HUD with live score + swap/transfer/bounty counters.
 *
 * Subscribes to `profile-updated` on the progression bus so any profile
 * mutation (score gain, counter increment, achievement unlock) refreshes
 * the display without polling.
 *
 * Animated score pulse on change gives immediate visual confirmation that
 * a real action happened — one of the main "feedback loop" wins.
 */
export default function HUD() {
  const [profile, setProfile] = useState<PlayerProfile | null>(
    typeof window === "undefined" ? null : profileManager.get()
  );
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    // Sync on mount.
    setProfile(profileManager.get());

    // Full profile replaces entries when anything changes.
    const unsubProfile = progressionBus.on("profile-updated", (e) => {
      setProfile(e.profile);
    });

    // Trigger the pulse animation whenever score ticks up.
    const unsubScore = progressionBus.on("score-gained", () => {
      setPulse((n) => n + 1);
    });

    return () => {
      unsubProfile();
      unsubScore();
    };
  }, []);

  if (!profile) return null;

  return (
    <div
      className="fixed top-4 left-4 z-20 rounded-lg px-4 py-3"
      style={{
        background: "rgba(10,10,30,0.85)",
        border: "1px solid rgba(153,69,255,0.25)",
        fontFamily: '"Fira Code", monospace',
        backdropFilter: "blur(4px)",
        minWidth: 180,
      }}
    >
      {/* Score — the headline */}
      <div className="flex items-baseline gap-2">
        <span
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "10px",
            color: "#777788",
            letterSpacing: "0.05em",
          }}
        >
          SCORE
        </span>
        <span
          key={pulse}
          className="score-value"
          style={{
            fontFamily: '"Press Start 2P", monospace',
            fontSize: "16px",
            color: "#14F195",
            fontWeight: "bold",
          }}
        >
          {profile.score.toLocaleString()}
        </span>
      </div>

      {/* Counters row — compact */}
      <div className="flex gap-3 mt-2" style={{ fontSize: "10px", color: "#aaaacc" }}>
        <Counter label="swaps" value={profile.swapCount} color="#FFD700" />
        <Counter label="sends" value={profile.transferCount} color="#00D1FF" />
        <Counter label="bounties" value={profile.bountyCount} color="#9945FF" />
      </div>

      <style jsx>{`
        .score-value {
          display: inline-block;
          animation: scorePulse 0.6s ease-out;
        }
        @keyframes scorePulse {
          0% { transform: scale(1); color: #14F195; }
          40% { transform: scale(1.25); color: #FFFFFF; }
          100% { transform: scale(1); color: #14F195; }
        }
      `}</style>
    </div>
  );
}

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span>
      <span style={{ color }}>{value}</span>
      <span style={{ color: "#555566", marginLeft: 3 }}>{label}</span>
    </span>
  );
}
