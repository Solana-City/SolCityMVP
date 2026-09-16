"use client";

/**
 * Micro-tutorial shown before a protocol NPC's panel: a few step cards over
 * a small flow picture built from the city's own sprites (frame 0 of each
 * character sheet), one short line per step.
 *
 * Seen once per NPC (localStorage), replayable from the "? HOW IT WORKS"
 * link above the panel. Each NPC opts in by wrapping its panel in
 * <ProtocolIntroGate>, so removing one tutorial is removing one wrapper.
 */
import { useEffect, useState } from "react";
import { track } from "@/game/telemetry/track";

const PIXEL = '"Press Start 2P", monospace';

export interface FlowNode {
  /** File in /assets/sprites (a 256x256 sheet of 64px frames). */
  sheet: string;
  label: string;
}

export interface IntroStep {
  title: string;
  line: string;
  /** Which arrow is lit: 0 = between node 0 and 1, and so on. */
  edge: number;
  /** Optional chip travelling along the lit arrow, e.g. "SOL" or "USDC". */
  chip?: string;
}

export interface IntroSpec {
  id: string;
  title: string;
  color: string;
  nodes: FlowNode[];
  steps: IntroStep[];
}

const storageKey = (id: string) => `solcity:intro:${id}`;

function Flow({ spec, step }: { spec: IntroSpec; step: IntroStep }) {
  const n = spec.nodes.length;
  const W = 320;
  const gap = W / n;
  const cx = (i: number) => gap / 2 + i * gap;
  const Y = 54;
  return (
    <svg viewBox={`0 0 ${W} 108`} style={{ width: "100%", height: "auto", display: "block" }}>
      {spec.nodes.map((node, i) => {
        const lit = i === step.edge || i === step.edge + 1;
        return (
          <g key={node.label}>
            <rect x={cx(i) - 30} y={Y - 34} width={60} height={56} rx={10}
              fill={lit ? `${spec.color}22` : "#12122a"} stroke={lit ? spec.color : "#2a2a45"} strokeWidth={lit ? 2 : 1} />
            <svg x={cx(i) - 26} y={Y - 34} width={52} height={56} viewBox="8 2 48 52" overflow="hidden">
              <image href={`/assets/sprites/${node.sheet}`} width={256} height={256} style={{ imageRendering: "pixelated" }} />
            </svg>
            <text x={cx(i)} y={Y + 36} textAnchor="middle" fontSize={7} fontFamily={PIXEL}
              fill={lit ? "#f1f5f9" : "#8b8ba7"}>{node.label}</text>
          </g>
        );
      })}
      {spec.nodes.slice(0, -1).map((_, i) => {
        const on = i === step.edge;
        const x1 = cx(i) + 34;
        const x2 = cx(i + 1) - 36;
        const path = `M ${x1} ${Y - 6} L ${x2} ${Y - 6}`;
        return (
          <g key={`e${i}`}>
            <path d={path} stroke={on ? spec.color : "#3a3a55"} strokeWidth={on ? 3 : 2}
              strokeDasharray={on ? "6 4" : undefined} fill="none">
              {on && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.8s" repeatCount="indefinite" />}
            </path>
            <path d={`M ${x2} ${Y - 11} L ${x2 + 7} ${Y - 6} L ${x2} ${Y - 1} z`} fill={on ? spec.color : "#3a3a55"} />
            {on && step.chip && (
              <g>
                <animateMotion dur="1.6s" repeatCount="indefinite" path={`M ${x1 - 4} 0 L ${x2 - 10} 0`} />
                <rect x={0} y={Y - 16} width={step.chip.length * 6 + 10} height={18} rx={9} fill="#FFD700" stroke="#7a5b00" />
                <text x={(step.chip.length * 6 + 10) / 2} y={Y - 4} textAnchor="middle" fontSize={7}
                  fontFamily={PIXEL} fill="#1a1405">{step.chip}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function IntroCards({ spec, onDone }: { spec: IntroSpec; onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = spec.steps[i];
  const last = i === spec.steps.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E" || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        if (last) onDone(); else setI((n) => n + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, onDone]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontFamily: PIXEL, fontSize: 8, color: spec.color, margin: 0 }}>{spec.title}</h3>
        <span style={{ marginLeft: "auto", marginRight: 26, fontSize: 7, color: "#555566" }}>
          {i + 1}/{spec.steps.length}
        </span>
      </div>
      <Flow spec={spec} step={step} />
      <div style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 9, color: "#fff", margin: "8px 0 6px" }}>
        {i + 1}. {step.title}
      </div>
      <div style={{ textAlign: "center", fontFamily: PIXEL, fontSize: 8, color: "#b9b9cc", lineHeight: 1.7, minHeight: "3.4em", marginBottom: 12 }}>
        {step.line}
      </div>
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
        <div style={{ flex: 1, display: "flex", justifyContent: "center", gap: 5 }}>
          {spec.steps.map((s, n) => (
            <span key={s.title} style={{ width: n === i ? 16 : 6, height: 6, borderRadius: 3, background: n === i ? spec.color : "#333344", transition: "width .2s" }} />
          ))}
        </div>
        <button
          onClick={() => (last ? onDone() : setI((n) => n + 1))}
          style={{
            background: spec.color, color: "#0a0a14", border: "none", borderRadius: 8,
            padding: "10px 16px", cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
          }}
        >
          {last ? "START" : "NEXT"}
        </button>
      </div>
    </>
  );
}

/** Shows the intro the first time, then the panel with a replay link. */
export function ProtocolIntroGate({ spec, children }: { spec: IntroSpec; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(localStorage.getItem(storageKey(spec.id)) !== "1"); } catch { /* storage blocked */ }
  }, [spec.id]);
  const done = () => {
    track("tutorial", spec.id, { success: true, label: "finished" });
    try { localStorage.setItem(storageKey(spec.id), "1"); } catch { /* storage blocked */ }
    setOpen(false);
  };

  useEffect(() => {
    if (open) track("tutorial", spec.id, { value: 1, label: "opened" });
  }, [open, spec.id]);
  if (open) return <IntroCards spec={spec} onDone={done} />;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "block", marginLeft: "auto", marginRight: 26, marginBottom: 6,
          background: "transparent", border: `1px solid ${spec.color}66`, color: spec.color,
          borderRadius: 6, padding: "4px 7px", cursor: "pointer", fontFamily: PIXEL, fontSize: 7,
        }}
      >
        ? HOW IT WORKS
      </button>
      {children}
    </>
  );
}
