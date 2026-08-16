"use client";

/**
 * Sol Mechs — main menu.
 *
 * The entry point used to be the mech roster: the player was dropped straight
 * into a grid of five mechs with no idea what pressing one would do, and the
 * mode buttons were an afterthought below the fold. Choosing a MODE is the
 * first real decision, so it comes first, and each row says what it is before
 * you commit to it.
 *
 * Mode labels use Unity's own menu art (Interface guidance/Menus) wherever the
 * baked-in wording is accurate — PvE, ARENA PvP, SOL MECH EDITOR. Squad 3v3
 * has no matching label in that set, so it is drawn in CSS in the same visual
 * language rather than mislabelled with a sprite that says something else.
 */
import { useEffect } from "react";

const UI = "/assets/minigames/sol-mechs/ui";
const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

const C = {
  teal: "#21dda0",
  cyan: "#3fe0ff",
  purple: "#9a46fe",
  ink: "#0b0616",
  panel: "#150c2b",
  panelHi: "#1d1140",
  line: "#33235c",
  text: "#e8e2f7",
  dim: "#9d8fc4",
  faint: "#6b5c92",
};

export type MenuChoice = "pve" | "squad" | "workshop";

export interface MainMenuProps {
  onChoose: (choice: MenuChoice) => void;
  onClose: () => void;
  wins: number;
  losses: number;
}

export default function MainMenu({ onChoose, onClose, wins, losses }: MainMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const played = wins + losses;

  return (
    <div style={sx.backdrop} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={sx.frame}>
        <button onClick={onClose} style={sx.close} aria-label="Close">×</button>

        <div style={sx.hero}>
          <img
            src={`${UI}/logo.png`}
            alt="Sol Mechs"
            style={{ ...PIXELATED, width: "min(300px, 80%)", height: "auto", display: "block" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <p style={sx.tagline}>
            Modular mech duels. Break a limb and you take its stats with it.
          </p>
          {played > 0 && (
            <div style={sx.record}>
              <span style={{ color: C.teal }}>{wins}W</span>
              <span style={{ color: C.faint }}>·</span>
              <span style={{ color: "#ff5468" }}>{losses}L</span>
            </div>
          )}
        </div>

        <div style={sx.list}>
          <MenuRow
            art={`${UI}/menu/pve.png`}
            fallback="PvE"
            desc="Duel one rival mech. Best place to learn the rules."
            onClick={() => onChoose("pve")}
          />
          <MenuRow
            label="SQUAD 3v3"
            desc="Three mechs, one at a time. Substituting costs your turn."
            onClick={() => onChoose("squad")}
          />
          <MenuRow
            art={`${UI}/menu/editor.png`}
            fallback="SOL MECH EDITOR"
            desc="Swap parts across chassis and save a loadout."
            onClick={() => onChoose("workshop")}
          />
          <MenuRow
            art={`${UI}/menu/pvp.png`}
            fallback="ARENA PvP"
            desc="Season ladder. One pass, an exclusive mech, USDC by placement."
            badge="SOON"
            disabled
          />
        </div>
      </div>
    </div>
  );
}

function MenuRow({ art, fallback, label, desc, onClick, disabled, badge }: {
  art?: string;
  fallback?: string;
  label?: string;
  desc: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...sx.row, opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <div style={sx.rowLabel}>
        {art ? (
          <img
            src={art}
            alt={fallback ?? ""}
            style={{ ...PIXELATED, height: 34, width: "auto", display: "block" }}
            onError={(e) => {
              // Fall back to the text so a missing sprite can never leave an
              // unlabelled button.
              const el = e.currentTarget as HTMLImageElement;
              el.replaceWith(Object.assign(document.createElement("span"), {
                textContent: fallback ?? "",
                className: "",
              }));
            }}
          />
        ) : (
          <span style={sx.cssLabel}>{label}</span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={sx.desc}>{desc}</div>
      </div>
      {badge
        ? <span style={sx.badge}>{badge}</span>
        : <span style={sx.chevron}>▸</span>}
    </button>
  );
}

const sx: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(4,2,10,.92)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  },
  frame: {
    position: "relative", background: C.panel,
    backgroundImage:
      `linear-gradient(${C.line}44 1px, transparent 1px), linear-gradient(90deg, ${C.line}44 1px, transparent 1px)`,
    backgroundSize: "26px 26px",
    border: `2px solid ${C.line}`, borderRadius: 12, padding: "26px 22px 22px",
    width: "min(520px, 100%)", maxHeight: "100%", overflowY: "auto", overflowX: "hidden",
    boxShadow: `0 0 0 1px ${C.teal}33, 0 18px 60px rgba(0,0,0,.7)`,
    fontFamily: "system-ui,sans-serif",
  },
  close: {
    position: "absolute", top: 10, right: 14, background: "none", border: "none",
    color: C.dim, fontSize: 26, cursor: "pointer", lineHeight: 1, padding: 0,
  },
  hero: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 22 },
  tagline: { margin: 0, fontSize: 12.5, color: C.dim, textAlign: "center", lineHeight: 1.6 },
  record: {
    display: "flex", gap: 7, fontSize: 12, fontFamily: "ui-monospace, monospace",
    fontWeight: 700, background: C.ink, border: `1px solid ${C.line}`,
    borderRadius: 999, padding: "4px 12px",
  },
  list: { display: "flex", flexDirection: "column", gap: 9 },
  row: {
    display: "flex", alignItems: "center", gap: 14, textAlign: "left",
    background: C.ink, border: `1px solid ${C.line}`, borderRadius: 9,
    padding: "12px 14px", color: C.text, fontFamily: "inherit", width: "100%",
  },
  rowLabel: { flexShrink: 0, width: 132, display: "flex", alignItems: "center" },
  /** Matches the baked gradient of the Unity labels, for modes with no art. */
  cssLabel: {
    display: "inline-block", padding: "7px 14px",
    background: `linear-gradient(180deg, ${C.cyan}, ${C.purple})`,
    color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: 1,
    WebkitTextStroke: "0.5px rgba(0,0,0,.55)",
    clipPath: "polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%)",
  },
  desc: { fontSize: 12, color: C.dim, lineHeight: 1.55 },
  chevron: { color: C.faint, fontSize: 14, flexShrink: 0 },
  badge: {
    flexShrink: 0, fontSize: 9, letterSpacing: 1.5, color: C.faint,
    border: `1px solid ${C.line}`, borderRadius: 4, padding: "3px 7px",
  },
};
