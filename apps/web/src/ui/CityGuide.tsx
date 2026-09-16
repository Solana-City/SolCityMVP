"use client";

/**
 * Sol, the city guide: a step-by-step tour of Solana City.
 *
 * One idea per card, each shown as a small scene built from the game's own
 * sprites (characters, the "!" balloon, the joystick and ACT buttons, the
 * quest and hunt icons, a live crop of the minimap) with a single line of
 * copy. Opens by itself the first time a player enters the city
 * (GUIDE_SEEN_KEY) and any time from Sol at the fountain.
 */
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getMinimapHost } from "@/game/minimap/MinimapHost";
import { Bust } from "@/game/minigames/sol-mechs/SquadPortraits";
import { PRESET_BUILDS } from "@/game/solmechs/data/catalog";
import { track } from "@/game/telemetry/track";

const PIXEL = '"Press Start 2P", monospace';
const GREEN = "#14F195";
const UI = "/assets/ui";

export const GUIDE_SEEN_KEY = "solcity:guide-seen";

export function markGuideSeen(): void {
  try { localStorage.setItem(GUIDE_SEEN_KEY, "1"); } catch { /* storage blocked */ }
}
export function guideSeen(): boolean {
  try { return localStorage.getItem(GUIDE_SEEN_KEY) === "1"; } catch { return true; }
}

function useIsTouch(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => { setTouch(window.matchMedia("(pointer: coarse)").matches); }, []);
  return touch;
}

/** Frame 0 (standing, facing the camera) of a 256x256 character sheet. */
function Citizen({ sheet, size = 64, style }: { sheet: string; size?: number; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        width: size, height: size, flexShrink: 0,
        backgroundImage: `url("/assets/sprites/${sheet}")`,
        backgroundSize: `${size * 4}px ${size * 4}px`, backgroundPosition: "0 0",
        imageRendering: "pixelated", ...style,
      }}
    />
  );
}

function Img({ src, h, style }: { src: string; h: number; style?: React.CSSProperties }) {
  return (
    <img
      src={src} alt="" draggable={false}
      style={{ height: h, width: "auto", display: "block", imageRendering: "pixelated", flexShrink: 0, ...style }}
    />
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 24, height: 22, padding: "0 5px", borderRadius: 4,
      background: "#f8fafc", color: "#0a0a14", fontFamily: PIXEL, fontSize: 8,
      boxShadow: "0 3px 0 #64748b",
    }}>
      {children}
    </span>
  );
}

function Label({ children, color = "#cbd5e1" }: { children: React.ReactNode; color?: string }) {
  return <span style={{ fontFamily: PIXEL, fontSize: 7, color, whiteSpace: "nowrap" }}>{children}</span>;
}

/** A citizen with its job underneath, for the apps and games scenes. */
function Role({ sheet, img, node, label, color }: { sheet?: string; img?: string; node?: React.ReactNode; label: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{
        width: 58, height: 58, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
        background: `${color}1f`, boxShadow: `inset 0 0 0 2px ${color}88`,
      }}>
        {node ?? (sheet ? <Citizen sheet={sheet} size={52} /> : img ? <Img src={img} h={40} /> : null)}
      </div>
      <Label color={color}>{label}</Label>
    </div>
  );
}

/** A circular crop of the real minimap around the fountain. */
function MapPreview({ size = 92 }: { size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const host = getMinimapHost();
    if (!host) return;
    const c = document.createElement("canvas");
    c.width = size * 2;
    c.height = size * 2;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const scale = host.image.width / host.worldW;
    const span = 1400 * scale;
    const cx = 78 * 24 * scale;
    const cy = 38 * 24 * scale;
    ctx.drawImage(host.image, cx - span / 2, cy - span / 2, span, span, 0, 0, c.width, c.height);
    setSrc(c.toDataURL());
  }, [size]);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
      border: "3px solid rgba(153,69,255,0.7)", background: "#0b3a5c",
      boxShadow: "0 0 0 1px rgba(20,241,149,0.3)", position: "relative",
    }}>
      {src && <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block" }} />}
      <span style={{
        position: "absolute", left: "50%", top: "50%", width: 10, height: 10, borderRadius: "50%",
        transform: "translate(-50%, -50%)", background: GREEN, border: "2px solid #fff",
      }} />
    </div>
  );
}

interface Step {
  title: string;
  line: string;
  scene: React.ReactNode;
}

function useSteps(touch: boolean): Step[] {
  return [
    {
      title: "WELCOME",
      line: "I'm Sol, your city guide. Here is Solana City in a few quick steps.",
      scene: (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
          <Citizen sheet="Sol.png" size={96} />
          <Img src="/assets/branding/icon.png" h={56} style={{ marginBottom: 16 }} />
        </div>
      ),
    },
    {
      title: "WALK",
      line: touch ? "Drag the joystick to walk around the city." : "Walk with WASD or the arrow keys.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Citizen sheet="main_char.png" size={80} />
          {touch ? (
            <div style={{ position: "relative", width: 76, height: 76 }}>
              <Img src={`${UI}/controller_bg.png`} h={76} style={{ position: "absolute", inset: 0 }} />
              <Img src={`${UI}/controller.png`} h={34} style={{ position: "absolute", left: 33, top: 21 }} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 26px)", gap: 5, justifyItems: "center" }}>
              <span /><Key>W</Key><span />
              <Key>A</Key><Key>S</Key><Key>D</Key>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "TALK",
      line: touch
        ? "See a ! above someone? Walk up and tap ACT."
        : "See a ! above someone? Walk up and press E.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Img src={`${UI}/attention_green.png`} h={28} />
            <Citizen sheet="Jupiter Joe.png" size={80} />
          </div>
          {touch ? <Img src={`${UI}/btn_act.png`} h={62} /> : <div style={{ transform: "scale(1.6)" }}><Key>E</Key></div>}
        </div>
      ),
    },
    {
      title: "REAL SOLANA APPS",
      line: "These citizens run real Solana apps. Each one shows you how before you use it.",
      scene: (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Role sheet="Jupiter Joe.png" label="SWAP" color="#14F195" />
          <Role sheet="send-npc.png" label="SEND" color="#00D1FF" />
          <Role sheet="Pratik.png" label="EARN" color="#9945FF" />
          <Role sheet="Magic Man.png" label="PRIVATE" color="#c026d3" />
        </div>
      ),
    },
    {
      title: "MINI-GAMES",
      line: "Play mini-games around the city to earn points and unlock outfits.",
      scene: (
        <div style={{ display: "flex", gap: 22, justifyContent: "center" }}>
          <Role img="/assets/minigames/kite/kites/kite_stb.png" label="KITES" color="#FFA94D" />
          <Role img="/assets/minigames/food-cart/salmon-nigiri.png" label="FOOD CART" color="#FFA94D" />
          <Role node={<Bust build={PRESET_BUILDS.titan} size={48} />} label="SOL MECHS" color="#FFA94D" />
        </div>
      ),
    },
    {
      title: "FIND YOUR WAY",
      line: touch
        ? "Tap the round map to see every citizen and place."
        : "Click the round map, or press M, to see every citizen and place.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <MapPreview size={96} />
          {!touch && <div style={{ transform: "scale(1.5)" }}><Key>M</Key></div>}
        </div>
      ),
    },
    {
      title: "QUESTS AND HUNTS",
      line: "Daily quests and Find Someone earn points and new outfits.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {[`${UI}/ico_tasks.png`, `${UI}/ico_achievements.png`, `${UI}/ico_wardrop.png`].map((src) => (
            <div key={src} style={{ position: "relative", width: 60, height: 60 }}>
              <Img src={`${UI}/bg_ico.png`} h={60} style={{ position: "absolute", inset: 0 }} />
              <Img src={src} h={40} style={{ position: "absolute", left: 10, top: 10 }} />
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "YOUR WALLET",
      line: "Connect a wallet to save your progress and use the apps.",
      scene: (
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Citizen sheet="main_char.png" size={80} />
          <Img src={`${UI}/btn_connect.png`} h={40} />
        </div>
      ),
    },
  ];
}

export default function CityGuide({ onDone }: { onDone: () => void }) {
  const touch = useIsTouch();
  const steps = useSteps(touch);
  const [i, setI] = useState(0);
  const { connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
  const step = steps[i];
  const last = i === steps.length - 1;

  const finish = () => {
    track("tutorial", "city-guide", { value: steps.length, success: true, label: "finished" });
    markGuideSeen();
    onDone();
  };

  // One event per card reached: the panel turns these into a drop-off funnel.
  useEffect(() => {
    track("tutorial", "city-guide", { value: i + 1, label: `step ${i + 1}/${steps.length}` });
  }, [i, steps.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === "e" || e.key === "E") { e.preventDefault(); if (last) finish(); else setI((n) => n + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontFamily: PIXEL, fontSize: 8, color: GREEN, margin: 0 }}>CITY GUIDE</h3>
        <span style={{ marginLeft: "auto", marginRight: 26, fontFamily: PIXEL, fontSize: 7, color: "#555566" }}>
          {i + 1}/{steps.length}
        </span>
      </div>

      <div key={i} className="sg-step" style={{
        height: touch ? 118 : 150, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
        background: "radial-gradient(circle at 50% 60%, rgba(20,241,149,0.12), rgba(10,10,30,0) 70%), #0d0d22",
        border: "1px solid rgba(20,241,149,0.18)", overflow: "hidden", padding: 8,
      }}>
        {step.scene}
      </div>

      <div style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 9, color: "#fff", margin: "12px 0 6px" }}>
        {step.title}
      </div>
      <div style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 8, color: "#b9b9cc", lineHeight: 1.7, minHeight: "3.4em", marginBottom: 12, padding: "0 4px" }}>
        {step.line}
      </div>

      {last && !connected && (
        <button
          onClick={() => openWalletModal(true)}
          style={{
            display: "block", width: "100%", marginBottom: 8, background: "rgba(153,69,255,0.85)", color: "#fff",
            border: "none", borderRadius: 8, padding: "10px 0", cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
          }}
        >
          CONNECT WALLET
        </button>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => setI((n) => Math.max(0, n - 1))}
          style={{
            background: "transparent", border: "1px solid #333344", color: "#888899", borderRadius: 8,
            padding: "9px 12px", cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
            visibility: i === 0 ? "hidden" : "visible",
          }}
        >
          BACK
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 4 }}>
          {steps.map((s, n) => (
            <span key={s.title} style={{ width: n === i ? 14 : 5, height: 5, borderRadius: 3, background: n === i ? GREEN : n < i ? "#3f6f5c" : "#333344", transition: "width .2s" }} />
          ))}
        </div>
        <button
          onClick={() => (last ? finish() : setI((n) => n + 1))}
          style={{
            background: GREEN, color: "#0a0a14", border: "none", borderRadius: 8,
            padding: "10px 14px", cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
          }}
        >
          {last ? "EXPLORE" : "NEXT"}
        </button>
      </div>
      {!last && (
        <button
          onClick={finish}
          style={{
            display: "block", margin: "10px auto 0", background: "none", border: "none",
            color: "#555566", fontFamily: PIXEL, fontSize: 7, cursor: "pointer",
          }}
        >
          SKIP TOUR
        </button>
      )}
      <style>{`
        @keyframes sg-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }
        .sg-step { animation: sg-in .22s ease; }
      `}</style>
    </>
  );
}
