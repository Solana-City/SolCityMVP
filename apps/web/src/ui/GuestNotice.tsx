"use client";

/**
 * Shown when a player picks "continue as guest": three quick cards on what
 * playing without a wallet means, drawn with the game's sprites like the
 * city and chat guides. Ends on a choice: connect a wallet or play solo.
 */
import { useEffect, useState } from "react";
import { Citizen, Img } from "./CityGuide";
import { track } from "@/game/telemetry/track";
import { chamferBox } from "@/ui/chamfer";

const PIXEL = '"Press Start 2P", monospace';
const PURPLE = "#9945FF";
const GREEN = "#B7E928";
const DANGER = "#ff5a5a";
const UI = "/assets/ui";

const OFF: React.CSSProperties = { filter: "grayscale(1)", opacity: 0.35 };

/** A red slash across whatever it wraps: "not available". */
function Crossed({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative" }}>
      {children}
      <span style={{
        position: "absolute", left: -4, right: -4, top: "50%", height: 3,
        background: DANGER, transform: "rotate(-20deg)", borderRadius: 2,
      }} />
    </div>
  );
}

interface Step {
  title: string;
  line: string;
  scene: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "SOLO MODE",
    line: "You're offline from the chain, so you can't see other players and they can't see you.",
    scene: (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
        <Citizen sheet="Kuka.png" size={44} style={OFF} />
        <Citizen sheet="main_char.png" size={72} />
        <Citizen sheet="Sushi Man.png" size={44} style={OFF} />
      </div>
    ),
  },
  {
    title: "NO ONCHAIN ACTIONS",
    line: "Swaps, sends and every other onchain app need a wallet.",
    scene: (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
        <Crossed><Citizen sheet="Jupiter Joe.png" size={56} style={OFF} /></Crossed>
        <Img src={`${UI}/attention_red.png`} h={34} style={{ marginBottom: 12 }} />
        <Crossed><Citizen sheet="send-npc.png" size={56} style={OFF} /></Crossed>
      </div>
    ),
  },
  {
    title: "NOTHING IS SAVED",
    line: "Points, quests and outfits are lost when you leave.",
    scene: (
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {[`${UI}/ico_tasks.png`, `${UI}/ico_achievements.png`, `${UI}/ico_wardrop.png`].map((src) => (
          <Crossed key={src}>
            <div style={{ position: "relative", width: 52, height: 52, ...OFF }}>
              <Img src={`${UI}/bg_ico.png`} h={52} style={{ position: "absolute", inset: 0 }} />
              <Img src={src} h={34} style={{ position: "absolute", left: 9, top: 9 }} />
            </div>
          </Crossed>
        ))}
      </div>
    ),
  },
];

const btn = (over: React.CSSProperties): React.CSSProperties => chamferBox(6, {
  border: "none", padding: "9px 12px", cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
  ...over,
});

export default function GuestNotice({ onConnect, onPlay }: { onConnect: () => void; onPlay: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    track("tutorial", "guest-notice", { value: i + 1, label: `step ${i + 1}/${STEPS.length}` });
  }, [i]);

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,10,0.55)", padding: 16,
    }}>
      <div style={{
        width: "min(340px, 100%)", padding: 12,
        // A phone held sideways has ~330px of height: never cut the buttons off.
        maxHeight: "calc(100dvh - 32px)", overflowY: "auto",
        background: "linear-gradient(180deg, rgba(15,18,40,0.98) 0%, rgba(8,10,24,0.98) 100%)",
        borderWidth: 20, borderStyle: "solid", borderColor: "transparent",
        borderImage: 'url(/assets/branding/ui/frame-panel-test.png) 64 fill / 20px / 0 round',
        imageRendering: "pixelated",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontFamily: PIXEL, fontSize: 8, color: "#FFD700" }}>GUEST MODE</span>
          <span style={{ marginLeft: "auto", fontFamily: PIXEL, fontSize: 7, color: "#555566" }}>{i + 1}/{STEPS.length}</span>
        </div>

        <div key={i} className="gn-step gn-scene" style={chamferBox(8, {
          height: 118, display: "flex", alignItems: "center", justifyContent: "center",
          background: "radial-gradient(circle at 50% 60%, rgba(255,90,90,0.10), rgba(10,10,30,0) 70%), #0d0d22",
          border: "1px solid rgba(255,90,90,0.18)", overflow: "hidden",
        })}>
          {step.scene}
        </div>

        <div style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 8, color: "#fff", margin: "10px 0 6px" }}>
          {step.title}
        </div>
        <div style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 7, color: "#b9b9cc", lineHeight: 1.8, minHeight: "3.6em", marginBottom: 10 }}>
          {step.line}
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 10 }}>
          {STEPS.map((s, n) => (
            <span key={s.title} style={{ width: n === i ? 14 : 5, height: 5, borderRadius: 3, background: n === i ? GREEN : n < i ? "#3f6f5c" : "#333344", transition: "width .2s" }} />
          ))}
        </div>

        {last ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onPlay} style={btn({ flex: 1, background: "transparent", border: "1px solid #333344", color: "#b9b9cc" })}>
              PLAY SOLO
            </button>
            <button onClick={onConnect} style={btn({ flex: 1, background: PURPLE, color: "#fff" })}>
              CONNECT WALLET
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setI((n) => Math.max(0, n - 1))}
              style={btn({ background: "transparent", border: "1px solid #333344", color: "#888899", visibility: i === 0 ? "hidden" : "visible" })}
            >
              BACK
            </button>
            <button onClick={() => setI((n) => n + 1)} style={btn({ marginLeft: "auto", background: GREEN, color: "#0a0a14" })}>
              NEXT
            </button>
          </div>
        )}
      </div>
      <style>{`
        @keyframes gn-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
        .gn-step { animation: gn-in .2s ease; }
        @media (max-height: 420px) { .gn-scene { height: 84px !important; } }
      `}</style>
    </div>
  );
}
