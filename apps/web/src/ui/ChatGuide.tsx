"use client";

/**
 * The chat's "i" card: three quick steps on how the chat works, drawn with
 * the game's own sprites like the city guide. Opens from the chat header.
 */
import { useEffect, useState } from "react";
import { Citizen, Img, Key } from "./CityGuide";
import { track } from "@/game/telemetry/track";

const PIXEL = '"Press Start 2P", monospace';
const LOCAL = "#14F195";
const YOU = "#14F195";
const OTHERS = "#00D1FF";
const DANGER = "#ff5a5a";

/** A speech bubble like the ones that float over avatars in the city. */
function Bubble({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ position: "relative", marginBottom: 6 }}>
      <div style={{
        background: "#f8fafc", color: "#0a0a14", fontFamily: PIXEL, fontSize: 7,
        padding: "5px 7px", borderRadius: 6, whiteSpace: "nowrap",
        boxShadow: `0 0 0 2px ${color}`,
      }}>
        {text}
      </div>
      <span style={{
        position: "absolute", left: "50%", bottom: -5, transform: "translateX(-50%)",
        borderLeft: "5px solid transparent", borderRight: "5px solid transparent",
        borderTop: "5px solid #f8fafc",
      }} />
    </div>
  );
}

function Speaker({ sheet, text, color, size = 52 }: { sheet: string; text: string; color: string; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Bubble text={text} color={color} />
      <Citizen sheet={sheet} size={size} />
    </div>
  );
}

interface Step {
  title: string;
  line: string;
  scene: React.ReactNode;
}

function steps(touch: boolean): Step[] {
  return [
    {
      title: "CITY CHAT",
      line: "One chat for the whole city. Everyone online reads it, and your words float over your head.",
      scene: (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          <Speaker sheet="Kuka.png" text="gm!" color={OTHERS} size={44} />
          <Speaker sheet="main_char.png" text="hello!" color={YOU} size={52} />
          <Speaker sheet="Sushi Man.png" text="hi" color={OTHERS} size={44} />
        </div>
      ),
    },
    {
      title: "NO LINKS",
      line: "Links are blocked to keep scams out. Nobody here will ever send you one.",
      scene: (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          <div style={{ position: "relative" }}>
            <Speaker sheet="Kuka.png" text="free-sol.xyz" color={DANGER} size={52} />
            <span style={{
              position: "absolute", left: -4, right: -4, top: 12, height: 3,
              background: DANGER, transform: "rotate(-8deg)", borderRadius: 2,
            }} />
          </div>
          <Img src="/assets/ui/attention_red.png" h={34} style={{ marginBottom: 20 }} />
        </div>
      ),
    },
    {
      title: "TALK, THEN WALK",
      line: touch
        ? "Tap the box to type, then send. Tap the city to walk again."
        : "Enter to type, Enter or the arrow to send. Click the city to walk again.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {!touch && <Key>ENTER</Key>}
          <span style={{
            fontFamily: PIXEL, fontSize: 10, color: LOCAL, padding: "6px 9px", borderRadius: 4,
            background: "rgba(20,241,149,0.18)", border: "1px solid rgba(20,241,149,0.45)",
          }}>
            ▶
          </span>
          <Citizen sheet="main_char.png" size={60} />
          {touch
            ? (
              <div style={{ position: "relative", width: 52, height: 52 }}>
                <Img src="/assets/ui/controller_bg.png" h={52} style={{ position: "absolute", inset: 0 }} />
                <Img src="/assets/ui/controller.png" h={24} style={{ position: "absolute", left: 22, top: 14 }} />
              </div>
            )
            : <Key>WASD</Key>}
        </div>
      ),
    },
  ];
}

export default function ChatGuide({ touch, onClose }: { touch: boolean; onClose: () => void }) {
  const list = steps(touch);
  const [i, setI] = useState(0);
  const step = list[i];
  const last = i === list.length - 1;

  useEffect(() => {
    track("tutorial", "chat-guide", { value: i + 1, label: `step ${i + 1}/${list.length}` });
  }, [i, list.length]);

  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, bottom: "calc(100% + 6px)",
        background: "linear-gradient(180deg, rgba(15,18,40,0.98) 0%, rgba(8,10,24,0.98) 100%)",
        border: "1px solid rgba(153,69,255,0.35)", borderRadius: 8, padding: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontFamily: PIXEL, fontSize: 8, color: LOCAL }}>CHAT</span>
        <span style={{ marginLeft: "auto", fontFamily: PIXEL, fontSize: 7, color: "#555566" }}>{i + 1}/{list.length}</span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ marginLeft: 10, background: "none", border: "none", color: "#888899", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div key={i} className="cg-step" style={{
        height: touch ? 104 : 118, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
        background: "radial-gradient(circle at 50% 60%, rgba(20,241,149,0.12), rgba(10,10,30,0) 70%), #0d0d22",
        border: "1px solid rgba(20,241,149,0.18)", overflow: "hidden",
      }}>
        {step.scene}
      </div>

      <div style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 8, color: "#fff", margin: "10px 0 6px" }}>
        {step.title}
      </div>
      <div style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 7, color: "#b9b9cc", lineHeight: 1.8, minHeight: "3.6em", marginBottom: 10 }}>
        {step.line}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => setI((n) => Math.max(0, n - 1))}
          style={{
            background: "transparent", border: "1px solid #333344", color: "#888899", borderRadius: 6,
            padding: "7px 10px", cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
            visibility: i === 0 ? "hidden" : "visible",
          }}
        >
          BACK
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 4 }}>
          {list.map((s, n) => (
            <span key={s.title} style={{ width: n === i ? 14 : 5, height: 5, borderRadius: 3, background: n === i ? LOCAL : n < i ? "#3f6f5c" : "#333344", transition: "width .2s" }} />
          ))}
        </div>
        <button
          onClick={() => (last ? onClose() : setI((n) => n + 1))}
          style={{
            background: LOCAL, color: "#0a0a14", border: "none", borderRadius: 6,
            padding: "8px 12px", cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
          }}
        >
          {last ? "GOT IT" : "NEXT"}
        </button>
      </div>
      <style>{`
        @keyframes cg-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
        .cg-step { animation: cg-in .2s ease; }
      `}</style>
    </div>
  );
}
