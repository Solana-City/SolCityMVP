"use client";

import type { ChoiceName } from "../../solana/rps/client";

const EMOJI: Record<ChoiceName, string> = { rock: "🪨", paper: "📄", scissors: "✂️" };
const LABEL: Record<ChoiceName, string> = { rock: "Rock", paper: "Paper", scissors: "Scissors" };
const CHOICES: ChoiceName[] = ["rock", "paper", "scissors"];

export default function ChoicePicker({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (choice: ChoiceName) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
      {CHOICES.map((c) => (
        <button
          key={c}
          className="jokenpo-choice-btn"
          disabled={disabled}
          onClick={() => onPick(c)}
          style={{
            width: 76,
            height: 76,
            borderRadius: 14,
            border: "1px solid rgba(153,69,255,0.3)",
            background: "rgba(153,69,255,0.08)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.4 : 1,
            transition: "transform 0.12s ease, background 0.15s ease, border-color 0.15s ease",
          }}
        >
          <span style={{ fontSize: 28, lineHeight: 1 }}>{EMOJI[c]}</span>
          <span style={{ fontSize: 10, color: "#a0a0cc", fontFamily: '"Fira Code", monospace' }}>
            {LABEL[c]}
          </span>
        </button>
      ))}
    </div>
  );
}
